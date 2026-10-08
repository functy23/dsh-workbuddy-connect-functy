/**
 * The daily check-in: the request, the day boundary, and the catch-up rule.
 *
 * The three things pinned here are the three that go wrong quietly:
 *
 * - the day is UTC+8 regardless of the machine's zone, so a user elsewhere does
 *   not check in "tomorrow" because their laptop says so;
 * - `already-claimed` is distinguished from `claimed`, so the card can say the
 *   plugin did not just earn anything;
 * - a catch-up sweep runs a variant only when its moment has already passed, so
 *   a host started at 09:00 does not claim the 10:00 check-in early.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CHECK_IN_MINUTE,
  WorkBuddyCheckIn,
  isPastCheckInTime,
  msUntilCheckIn,
  normalizeCheckInMinute,
  utc8DateString,
} from '../src/checkin.ts'
import { WorkBuddyCheckInScheduler, WorkBuddyCheckInStore } from '../src/checkin-scheduler.ts'
import type { WorkBuddyCredential } from '../src/auth.ts'

const CLEANUP: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of CLEANUP.splice(0)) await dispose()
})

async function tempFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wb-checkin-'))
  CLEANUP.push(() => rm(root, { recursive: true, force: true }))
  return join(root, 'checkin.json')
}

/** A credential for one region, with everything the check-in reads. */
function credential(domain = 'copilot.tencent.com', enterpriseId?: string): WorkBuddyCredential {
  return {
    accessToken: 'at-token',
    refreshToken: 'rt',
    expiresAtMs: Date.now() + 3_600_000,
    domain,
    uid: 'uid-1',
    ...enterpriseId === undefined ? {} : { enterpriseId },
    source: 'dsh',
  }
}

/** A fetch double answering one status/body pair. */
function responding(status: number, body: unknown): { fetch: typeof fetch, calls: { url: string, init: RequestInit | undefined }[] } {
  const calls: { url: string, init: RequestInit | undefined }[] = []
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { fetch: impl, calls }
}

/** UTC+8 wall-clock moment as an epoch, so the assertions read in local terms. */
function utc8(year: number, month: number, day: number, hour: number, minute: number): number {
  return Date.UTC(year, month - 1, day, hour - 8, minute, 0)
}

describe('check-in day boundary', () => {
  it('measures the day in UTC+8, not the machine zone', () => {
    // 2026-10-08 07:00 UTC+8 is still 2026-10-07 in UTC.
    expect(utc8DateString(utc8(2026, 10, 8, 7, 0))).toBe('2026-10-08')
    // 2026-10-08 00:30 UTC+8 is 2026-10-07 16:30 UTC.
    expect(utc8DateString(utc8(2026, 10, 8, 0, 30))).toBe('2026-10-08')
    // One minute earlier belongs to the previous day.
    expect(utc8DateString(utc8(2026, 10, 7, 23, 59))).toBe('2026-10-07')
  })

  it('schedules the next occurrence at five seconds past the minute', () => {
    // 09:00 on the day: ten minutes to go, plus the five-second guard.
    expect(msUntilCheckIn(600, utc8(2026, 10, 8, 9, 50))).toBe(605_000)
    // Exactly at the configured minute the guard is still five seconds ahead,
    // so the run is due now rather than deferred a whole day — firing on the
    // boundary itself is what the guard exists to avoid.
    expect(msUntilCheckIn(600, utc8(2026, 10, 8, 10, 0))).toBe(5_000)
    // Once the guard itself has passed, the next one is tomorrow: 23:00 to
    // 10:00:05 is eleven hours and five seconds.
    expect(msUntilCheckIn(600, utc8(2026, 10, 8, 23, 0))).toBe(11 * 3_600_000 + 5_000)
  })

  it('decides whether the moment has passed', () => {
    expect(isPastCheckInTime(600, utc8(2026, 10, 8, 9, 59))).toBe(false)
    expect(isPastCheckInTime(600, utc8(2026, 10, 8, 10, 0))).toBe(true)
    expect(isPastCheckInTime(600, utc8(2026, 10, 8, 20, 0))).toBe(true)
  })

  it('clamps a nonsense minute onto the default', () => {
    expect(normalizeCheckInMinute(600)).toBe(600)
    expect(normalizeCheckInMinute(0)).toBe(0)
    expect(normalizeCheckInMinute(1439)).toBe(1439)
    for (const bad of [-1, 1440, 1.5e9, Number.NaN, '600', undefined, null]) {
      expect(normalizeCheckInMinute(bad)).toBe(DEFAULT_CHECK_IN_MINUTE)
    }
    // A fraction is truncated rather than rejected.
    expect(normalizeCheckInMinute(600.9)).toBe(600)
  })
})

describe('check-in request', () => {
  it('posts to the region\'s billing base with the credential headers', async () => {
    const cn = responding(200, { code: 0, data: { credit: 25 } })
    const service = new WorkBuddyCheckIn({ fetch: cn.fetch, now: () => utc8(2026, 10, 8, 10, 0) })
    const result = await service.checkIn('workbuddy', credential())

    expect(result.status).toBe('claimed')
    expect(result.amount).toBe(25)
    expect(result.date).toBe('2026-10-08')
    // The CN product bills through codebuddy.cn, not the workbuddy.cn UI host.
    expect(cn.calls[0]!.url).toBe('https://www.codebuddy.cn/v2/billing/meter/daily-checkin')
    const headers = cn.calls[0]!.init?.headers as Record<string, string>
    expect(headers['Authorization']).toBe('Bearer at-token')
    expect(headers['X-User-Id']).toBe('uid-1')
    // A check-in must never carry the refresh token: it is not needed, and the
    // chat path's own rule forbids it for the same reason.
    expect(JSON.stringify(headers)).not.toContain('rt')
  })

  it('uses the international base for the international credential', async () => {
    const intl = responding(200, { code: 0 })
    const service = new WorkBuddyCheckIn({ fetch: intl.fetch })
    const result = await service.checkIn('workbuddy-ai', credential('www.workbuddy.ai'))

    expect(result.status).toBe('claimed')
    expect(intl.calls[0]!.url).toBe('https://www.workbuddy.ai/v2/billing/meter/daily-checkin')
  })

  it('reads an already-claimed refusal from the code and from the text', async () => {
    // The measured shape: 400 with business code 10001.
    const byCode = responding(400, { code: 10001, msg: '今日已签到' })
    expect((await new WorkBuddyCheckIn({ fetch: byCode.fetch }).checkIn('workbuddy', credential())).status)
      .toBe('already-claimed')
    // And the text-only spelling, which a different build was seen sending.
    const byText = responding(200, { code: 1, msg: '今天已签到' })
    expect((await new WorkBuddyCheckIn({ fetch: byText.fetch }).checkIn('workbuddy', credential())).status)
      .toBe('already-claimed')
  })

  it('recognises a campaign that is not running', async () => {
    const inactive = responding(200, { code: 0, data: { active: false } })
    expect((await new WorkBuddyCheckIn({ fetch: inactive.fetch }).checkIn('workbuddy', credential())).status)
      .toBe('no-campaign')
    const expired = responding(200, { code: 1, msg: '活动已结束' })
    expect((await new WorkBuddyCheckIn({ fetch: expired.fetch }).checkIn('workbuddy', credential())).status)
      .toBe('no-campaign')
  })

  it('reports a plain failure as an error, with the upstream\'s own words', async () => {
    const refused = responding(500, { code: 500, msg: '内部错误' })
    const result = await new WorkBuddyCheckIn({ fetch: refused.fetch }).checkIn('workbuddy', credential())
    expect(result.status).toBe('error')
    expect(result.message).toBe('内部错误')
  })

  it('treats an unreadable body as an error rather than a claim', async () => {
    const garbage = responding(200, 'not json at all')
    const result = await new WorkBuddyCheckIn({ fetch: garbage.fetch }).checkIn('workbuddy', credential())
    // A 200 whose body cannot be read must NOT be reported as claimed: the
    // plugin would then tell the user it earned something it cannot name.
    expect(result.status).toBe('error')
    expect(result.message).toContain('http 200')
  })

  it('reports a missing credential instead of posting', async () => {
    const spy = responding(200, { code: 0 })
    const result = await new WorkBuddyCheckIn({ fetch: spy.fetch }).checkIn('workbuddy', undefined)
    expect(result.status).toBe('error')
    expect(spy.calls).toHaveLength(0)
  })

  it('turns a transport failure into an error result rather than throwing', async () => {
    const failing = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    const result = await new WorkBuddyCheckIn({ fetch: failing }).checkIn('workbuddy', credential())
    // The caller is a timer: an exception here would vanish into an unhandled
    // rejection and the day would silently go unclaimed.
    expect(result.status).toBe('error')
    expect(result.message).toBe('offline')
  })
})

describe('check-in scheduler', () => {
  /** One target whose check-in is counted and whose result is scripted. */
  function target(overrides: Partial<Parameters<typeof buildTarget>[0]> = {}) {
    return buildTarget(overrides)
  }

  function buildTarget(options: {
    variantId?: string
    enabled?: boolean
    minuteOfDay?: number
    result?: Awaited<ReturnType<WorkBuddyCheckIn['checkIn']>>
    throws?: boolean
  }) {
    const calls: string[] = []
    const claimed: string[] = []
    return {
      calls,
      claimed,
      target: {
        variantId: options.variantId ?? 'workbuddy',
        enabled: () => options.enabled ?? true,
        minuteOfDay: () => options.minuteOfDay ?? DEFAULT_CHECK_IN_MINUTE,
        checkIn: async (session: string) => {
          calls.push(session)
          if (options.throws === true) throw new Error('boom')
          return options.result ?? {
            variantId: options.variantId ?? 'workbuddy',
            date: session,
            timestamp: Date.now(),
            status: 'claimed' as const,
            amount: 10,
          }
        },
        onClaimed: () => { claimed.push('yes') },
      },
    }
  }

  it('claims once and records the row', async () => {
    const path = await tempFile()
    const store = new WorkBuddyCheckInStore(path)
    const t = target()
    const scheduler = new WorkBuddyCheckInScheduler({
      targets: [t.target],
      store,
      now: () => utc8(2026, 10, 8, 10, 0),
    })

    await scheduler.sweep(false)
    expect(t.calls).toEqual(['2026-10-08'])
    expect(t.claimed).toEqual(['yes'])
    const state = store.read('workbuddy')
    expect(state?.lastDate).toBe('2026-10-08')
    expect(state?.status).toBe('claimed')
    expect(state?.logs).toHaveLength(1)
    expect(state?.logs[0]!.amount).toBe(10)
  })

  it('does not claim twice in one day', async () => {
    const path = await tempFile()
    const store = new WorkBuddyCheckInStore(path)
    const t = target()
    const scheduler = new WorkBuddyCheckInScheduler({
      targets: [t.target],
      store,
      now: () => utc8(2026, 10, 8, 12, 0),
    })

    await scheduler.sweep(false)
    await scheduler.sweep(false)
    expect(t.calls).toHaveLength(1)
  })

  it('retries a failed day instead of writing it off', async () => {
    const path = await tempFile()
    const store = new WorkBuddyCheckInStore(path)
    const failed = target({
      result: { variantId: 'workbuddy', date: '2026-10-08', timestamp: 0, status: 'error', message: 'flaky' },
    })
    const scheduler = new WorkBuddyCheckInScheduler({
      targets: [failed.target],
      store,
      now: () => utc8(2026, 10, 8, 10, 0),
    })

    // An error row is not a settlement: the next sweep must try again, or one
    // transient failure would cost the user the whole day's benefit.
    await scheduler.sweep(false)
    await scheduler.sweep(false)
    expect(failed.calls).toHaveLength(2)
    expect(store.read('workbuddy')?.status).toBe('error')
  })

  it('treats already-claimed and no-campaign as settled', async () => {
    for (const status of ['already-claimed', 'no-campaign'] as const) {
      // A fresh log per case: these two are separate days' outcomes, and sharing
      // one file would let the first case's settlement answer for the second.
      const store = new WorkBuddyCheckInStore(await tempFile())
      const t = target({ result: { variantId: 'workbuddy', date: '2026-10-08', timestamp: 0, status } })
      const scheduler = new WorkBuddyCheckInScheduler({
        targets: [t.target],
        store,
        now: () => utc8(2026, 10, 8, 10, 0),
      })
      await scheduler.sweep(false)
      await scheduler.sweep(false)
      expect(t.calls, status).toHaveLength(1)
    }
  })

  it('waits for the moment when the host starts early', async () => {
    const path = await tempFile()
    const store = new WorkBuddyCheckInStore(path)
    const t = target({ minuteOfDay: 600 })
    const scheduler = new WorkBuddyCheckInScheduler({
      targets: [t.target],
      store,
      // 09:00: the 10:00 check-in is still ahead, so a catch-up must not run it.
      now: () => utc8(2026, 10, 8, 9, 0),
    })

    await scheduler.sweep(true)
    expect(t.calls).toHaveLength(0)
  })

  it('catches up the day the host was not running for', async () => {
    const path = await tempFile()
    const store = new WorkBuddyCheckInStore(path)
    const t = target({ minuteOfDay: 600 })
    const scheduler = new WorkBuddyCheckInScheduler({
      targets: [t.target],
      store,
      // 20:00: the moment passed while the host was down.
      now: () => utc8(2026, 10, 8, 20, 0),
    })

    await scheduler.sweep(true)
    expect(t.calls).toEqual(['2026-10-08'])
  })

  it('leaves a variant the user switched off alone', async () => {
    const path = await tempFile()
    const store = new WorkBuddyCheckInStore(path)
    const t = target({ enabled: false })
    const scheduler = new WorkBuddyCheckInScheduler({
      targets: [t.target],
      store,
      now: () => utc8(2026, 10, 8, 20, 0),
    })

    await scheduler.sweep(true)
    expect(t.calls).toHaveLength(0)
  })

  it('keeps one variant\'s failure out of the other\'s way', async () => {
    const path = await tempFile()
    const store = new WorkBuddyCheckInStore(path)
    const bad = target({ variantId: 'workbuddy', throws: true })
    const good = target({ variantId: 'workbuddy-ai' })
    const scheduler = new WorkBuddyCheckInScheduler({
      targets: [bad.target, good.target],
      store,
      now: () => utc8(2026, 10, 8, 20, 0),
    })

    await scheduler.sweep(true)
    // The throwing target is logged, and the other still ran.
    expect(store.read('workbuddy')?.status).toBe('error')
    expect(store.read('workbuddy')?.message).toBe('boom')
    expect(good.calls).toEqual(['2026-10-08'])
  })

  it('keeps one variant\'s history out of the other\'s', async () => {
    const path = await tempFile()
    const store = new WorkBuddyCheckInStore(path)
    const cn = target({ variantId: 'workbuddy' })
    const ai = target({ variantId: 'workbuddy-ai' })
    const scheduler = new WorkBuddyCheckInScheduler({
      targets: [cn.target, ai.target],
      store,
      now: () => utc8(2026, 10, 8, 20, 0),
    })

    await scheduler.sweep(true)
    expect(store.read('workbuddy')?.logs).toHaveLength(1)
    expect(store.read('workbuddy-ai')?.logs).toHaveLength(1)
    store.clearLogs('workbuddy')
    expect(store.read('workbuddy')?.logs).toHaveLength(0)
    expect(store.read('workbuddy-ai')?.logs).toHaveLength(1)
  })

  it('runs one variant on its own when a timer fires', async () => {
    const path = await tempFile()
    const store = new WorkBuddyCheckInStore(path)
    const cn = target({ variantId: 'workbuddy' })
    const ai = target({ variantId: 'workbuddy-ai' })
    const scheduler = new WorkBuddyCheckInScheduler({
      targets: [cn.target, ai.target],
      store,
      now: () => utc8(2026, 10, 8, 10, 0),
    })

    await scheduler.sweep(false, 'workbuddy-ai')
    expect(cn.calls).toHaveLength(0)
    expect(ai.calls).toHaveLength(1)
  })

  it('arms a timer for the next moment and disposes it', async () => {
    const path = await tempFile()
    const store = new WorkBuddyCheckInStore(path)
    const t = target({ minuteOfDay: 600 })
    const nowMs = utc8(2026, 10, 8, 9, 0)
    const scheduler = new WorkBuddyCheckInScheduler({ targets: [t.target], store, now: () => nowMs })
    scheduler.start()
    // 09:00 → 10:00:05 is 3605000 ms away.
    expect(scheduler.nextRunAt('workbuddy')).toBe(nowMs + 3_605_000)
    scheduler.dispose()
    // A disposed scheduler does not fire, and does not re-arm.
    await scheduler.sweep(false)
    expect(t.calls).toHaveLength(0)
    expect(scheduler.nextRunAt('workbuddy')).toBe(nowMs + 3_605_000)
  })

  it('survives a corrupt log file', async () => {
    const path = await tempFile()
    const { writeFile, mkdir } = await import('node:fs/promises')
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, '{ this is not json', 'utf8')
    const store = new WorkBuddyCheckInStore(path)
    // Unreadable state reads as "nothing recorded", so the day is claimed
    // rather than skipped for the rest of time.
    expect(store.read('workbuddy')).toBeUndefined()
    const t = target()
    const scheduler = new WorkBuddyCheckInScheduler({
      targets: [t.target],
      store,
      now: () => utc8(2026, 10, 8, 20, 0),
    })
    await scheduler.sweep(true)
    expect(t.calls).toHaveLength(1)
    expect(store.read('workbuddy')?.status).toBe('claimed')
  })

  it('reports a settle through onResult', async () => {
    const path = await tempFile()
    const store = new WorkBuddyCheckInStore(path)
    const t = target()
    const seen: string[] = []
    const scheduler = new WorkBuddyCheckInScheduler({
      targets: [t.target],
      store,
      now: () => utc8(2026, 10, 8, 20, 0),
      onResult: result => { seen.push(result.status) },
    })
    await scheduler.sweep(true)
    expect(seen).toEqual(['claimed'])
  })

  it('does not run the same variant twice at once', async () => {
    const path = await tempFile()
    const store = new WorkBuddyCheckInStore(path)
    let resolve: (() => void) | undefined
    const gate = new Promise<void>(done => { resolve = done })
    let started = 0
    const target = {
      variantId: 'workbuddy',
      enabled: () => true,
      minuteOfDay: () => DEFAULT_CHECK_IN_MINUTE,
      checkIn: async (session: string) => {
        started += 1
        await gate
        return { variantId: 'workbuddy', date: session, timestamp: Date.now(), status: 'claimed' as const }
      },
    }
    const scheduler = new WorkBuddyCheckInScheduler({ targets: [target], store, now: () => utc8(2026, 10, 8, 20, 0) })

    // Two sweeps that overlap while the first is still waiting: the in-flight
    // guard is what stops a timer and a startup sweep from both spending.
    const first = scheduler.sweep(true)
    const second = scheduler.sweep(true)
    resolve?.()
    await Promise.all([first, second])
    expect(started).toBe(1)
  })
})

describe('check-in store', () => {
  it('keeps at most thirty rows per variant, newest first', async () => {
    const path = await tempFile()
    const store = new WorkBuddyCheckInStore(path)
    vi.useFakeTimers()
    try {
      for (let i = 0; i < 35; i++) {
        // One per day, walking forward, so each row is distinct.
        const day = new Date(Date.UTC(2026, 8, 1 + i, 2, 0, 0))
        const date = day.toISOString().slice(0, 10)
        store.write('workbuddy', {
          variantId: 'workbuddy',
          date,
          timestamp: day.getTime(),
          status: 'claimed',
          amount: i,
        }, date)
      }
    } finally {
      vi.useRealTimers()
    }
    const logs = store.read('workbuddy')?.logs ?? []
    expect(logs).toHaveLength(30)
    // Newest first: the last write is the head.
    expect(logs[0]!.amount).toBe(34)
  })

  it('dates a catch-up run by the session, not by the attempt', async () => {
    const path = await tempFile()
    const store = new WorkBuddyCheckInStore(path)
    // A sweep at 00:30 UTC+8 that settles the PREVIOUS day's scheduled run: the
    // stored session has to be the day being settled, or the next sweep sees
    // "not settled" and claims again.
    store.write('workbuddy', {
      variantId: 'workbuddy',
      date: '2026-10-08',
      timestamp: utc8(2026, 10, 9, 0, 30),
      status: 'claimed',
    }, '2026-10-08')
    expect(store.read('workbuddy')?.lastDate).toBe('2026-10-08')
    // The row still records when it actually ran.
    expect(store.read('workbuddy')?.logs[0]!.timestamp).toBe(utc8(2026, 10, 9, 0, 30))
  })
})
