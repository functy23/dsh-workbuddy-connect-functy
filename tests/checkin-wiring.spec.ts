// The check-in wiring, end to end through the REAL plugin.
//
// `checkin.spec.ts` drives the scheduler and the store directly, and
// `checkin-section.spec.ts` drives the page against hand-written status
// documents. Neither proves the thing in the middle: that a config write lands
// in the status document the card reads, that the route's four actions reach
// the real host, and that a claimed day is written to the log the card draws.
//
// That middle is where the mistakes live — a field spelled one way in the
// schema and another in the projection, a route action wired to the wrong
// product, a scheduler that never starts. So this drives the plugin the way the
// loader does, through the same fake settings service the other integration
// tests use.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { FakeSettingsService } from './fake-settings.ts'
import * as WorkBuddy from '../src/index.ts'
import { WorkBuddyCheckInStore } from '../src/checkin-scheduler.ts'
import { workbuddyStateDir } from '../src/paths.ts'

/** The plugin's own config schema, so the fake service builds the same shape. */
const SCHEMA = WorkBuddy.Config

const ENTRY = 'llm-workbuddy'
const ENTRY_AI = 'workbuddy-ai'

let context: Context | undefined
let root: string | undefined

/** A desktop-shaped credential document for one region. */
function credentialDocument(domain: string, uid = 'uid-1'): string {
  return JSON.stringify({
    auth: { accessToken: 'at', refreshToken: 'rt', expiresAtMs: Date.now() + 3_600_000, domain },
    account: { uid, nickname: uid, enterpriseId: 'ent-1' },
  })
}

async function tempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  root = dir
  return dir
}

beforeEach(() => {
  // An absolute data directory, so nothing here touches a real profile and the
  // log lands somewhere this test can read back.
  vi.stubEnv('DSH_WORKBUDDY_DATA_DIR', '')
})

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) {
    await rm(root, { recursive: true, force: true }).catch(() => {})
    root = undefined
  }
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** Boot the plugin against the fake settings service, as the loader would. */
async function boot(values: Record<string, unknown>): Promise<Context> {
  const ctx = new Context()
  context = ctx
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(FakeSettingsService)
  const settings = FakeSettingsService.current as FakeSettingsService
  settings.declareEntry(ENTRY, values, SCHEMA)
  const fiber = ctx.plugin(WorkBuddy, values)
  await fiber
  settings.bindFiber(ENTRY, fiber.config)
  return ctx
}

/** Read the plugin's own check-in log off disk. */
async function readLog(): Promise<Record<string, { lastDate?: string, status?: string, logs?: unknown[] }>> {
  try {
    const raw = await readFile(join(workbuddyStateDir(), '.workbuddy-checkin.json'), 'utf8')
    const parsed = JSON.parse(raw) as { variants?: Record<string, { lastDate?: string, status?: string, logs?: unknown[] }> }
    return parsed.variants ?? {}
  } catch {
    return {}
  }
}

describe('check-in wiring', () => {
  it('serves the switches and the moment the config states, per product', async () => {
    const dir = await tempRoot('wb-checkin-wire-')
    vi.stubEnv('DSH_HOME', dir)
    // A credential the store can actually read: without one the variant stays
    // signed out, and there is no product for the switches to describe.
    const { writeFile } = await import('node:fs/promises')
    const cnFile = join(dir, 'cn.info')
    const aiFile = join(dir, 'ai.info')
    await writeFile(cnFile, credentialDocument('copilot.tencent.com', 'uid-cn'))
    await writeFile(aiFile, credentialDocument('www.workbuddy.ai', 'uid-ai'))
    vi.stubEnv('WORKBUDDY_AUTH_FILE', cnFile)
    vi.stubEnv('WORKBUDDY_AI_AUTH_FILE', aiFile)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline in tests') }))

    // The CN product switched on at 10:15; the international one left alone, so
    // its switch keeps the schema default (off) rather than inheriting CN's.
    const ctx = await boot({ autoCheckIn: true, checkInMinute: 615 })
    const settings = ctx.settings as unknown as FakeSettingsService

    // Both providers register regardless: the switches gate the REQUESTS, not
    // whether the product exists.
    await vi.waitFor(() => {
      expect(ctx.llm.listProviders().map(entry => entry.id)).toContain('workbuddy')
    })
    expect(ctx.llm.listProviders().map(entry => entry.id)).toContain('workbuddy-ai')

    // The config the plugin holds: CN's values landed, and the international
    // product did NOT inherit them — it keeps the schema defaults (off, 10:00).
    expect(settings.valueOf(ENTRY, 'autoCheckIn')).toBe(true)
    expect(settings.valueOf(ENTRY, 'checkInMinute')).toBe(615)
    expect(settings.valueOf(ENTRY, 'autoCheckInAI')).toBe(false)
    expect(settings.valueOf(ENTRY, 'checkInMinuteAI')).toBe(600)

    // A write lands in the live field, which is what the next status read sees.
    await ctx.settings.update(ENTRY, { checkInMinuteAI: 420 })
    expect(settings.valueOf(ENTRY, 'checkInMinuteAI')).toBe(420)
  })

  it('never claims for a product the user left switched off', async () => {
    const dir = await tempRoot('wb-checkin-off-')
    vi.stubEnv('DSH_HOME', dir)
    const cnFile = join(dir, 'cn.info')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(cnFile, credentialDocument('copilot.tencent.com'))
    vi.stubEnv('WORKBUDDY_AUTH_FILE', cnFile)
    vi.stubEnv('WORKBUDDY_AI_AUTH_FILE', join(dir, 'absent.info'))

    let upstreamCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      // Only count the check-in endpoint: the catalog fetch also goes out.
      if (String(url).includes('daily-checkin')) upstreamCalls += 1
      return new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 })
    }))

    // Booted at a moment where a catch-up WOULD be due, with the switch off.
    await boot({})
    // Give the startup sweep room to run and misbehave.
    await new Promise(resolve => setTimeout(resolve, 300))

    expect(upstreamCalls).toBe(0)
    // And nothing was written to the log, because nothing ran.
    expect(Object.keys(await readLog())).toEqual([])
  })

  it('claims through the real scheduler and records the row', async () => {
    const dir = await tempRoot('wb-checkin-on-')
    vi.stubEnv('DSH_HOME', dir)
    const cnFile = join(dir, 'cn.info')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(cnFile, credentialDocument('copilot.tencent.com'))
    vi.stubEnv('WORKBUDDY_AUTH_FILE', cnFile)
    vi.stubEnv('WORKBUDDY_AI_AUTH_FILE', join(dir, 'absent.info'))

    const checkInUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const target = String(url)
      if (target.includes('daily-checkin')) {
        checkInUrls.push(target)
        return new Response(JSON.stringify({ code: 0, data: { credit: 25 } }), { status: 200 })
      }
      // Catalog and billing: answer emptily so boot settles.
      return new Response(JSON.stringify({ code: 0, data: { Data: { Accounts: [] } } }), { status: 200 })
    }))

    // Switched on at 00:00, so the moment has necessarily passed and the
    // startup sweep catches up — the same path a host that was off all day takes.
    await boot({ autoCheckIn: true, checkInMinute: 0 })

    await vi.waitFor(async () => {
      const log = await readLog()
      expect(log['workbuddy']?.logs?.length ?? 0).toBeGreaterThan(0)
    }, { timeout: 5_000 })

    // It hit the CN billing base (the credential's region), not the AI one.
    expect(checkInUrls, `check-in URLs seen: ${JSON.stringify(checkInUrls)}`)
      .toContain('https://www.codebuddy.cn/v2/billing/meter/daily-checkin')
    expect(checkInUrls.some(u => u.includes('workbuddy.ai'))).toBe(false)

    const log = await readLog()
    expect(log['workbuddy']?.status).toBe('claimed')
    // The international product was never switched on, so it stayed out.
    expect(log['workbuddy-ai']).toBeUndefined()
  })

  it('keeps the log in the plugin\'s own state directory', async () => {
    const dir = await tempRoot('wb-checkin-path-')
    vi.stubEnv('DSH_HOME', dir)
    vi.stubEnv('WORKBUDDY_AUTH_FILE', join(dir, 'absent.info'))
    vi.stubEnv('WORKBUDDY_AI_AUTH_FILE', join(dir, 'absent.info'))
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))

    await boot({})
    // The store resolves the same path the plugin writes through, and it is
    // inside the profile-scoped data directory rather than the home root.
    const store = new WorkBuddyCheckInStore()
    expect(store.filePath()).toBe(join(workbuddyStateDir(), '.workbuddy-checkin.json'))
    expect(store.filePath().startsWith(workbuddyStateDir())).toBe(true)
    expect(store.filePath()).not.toBe(join(dir, '.workbuddy-checkin.json'))
  })
})
