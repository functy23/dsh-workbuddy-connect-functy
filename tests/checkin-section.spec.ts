// @vitest-environment jsdom
//
// The check-in section is drawn inside the settings page, so it needs the real
// DOM the page's dialogs already require.
//
// What this covers that `checkin.spec.ts` cannot: that file drives the host's
// scheduler and store directly, and never proves the SECTION renders — that the
// switch reflects the host's config, that the log is drawn, or that pressing
// the buttons posts the right action to the right product's route. Those are
// exactly the wiring mistakes a type-check cannot see.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkBuddySettingsPage } from '../src/client/WorkBuddySettingsPage.tsx'
import { AI_CARD_VARIANT, CN_CARD_VARIANT } from '../src/client/card-variants.ts'
import { en } from '../src/client/locales.ts'
import type { WorkBuddyWebStatus } from '../src/status-paths.ts'

const t = (key: keyof typeof en, params: Record<string, unknown> = {}): string =>
  Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    en[key] as string,
  )

/** One account fixture; the section renders only for a signed-in product. */
function account(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'uid-a:ent', uid: 'uid-a', name: '主账号', origin: 'desktop', domain: 'copilot.tencent.com',
    renewable: true, enabled: true, available: true, credits: 1000,
    expiresAtMs: Date.now() + 3_600_000, lastUsedAtMs: 0, addedAtMs: 0,
    ...overrides,
  }
}

/** A signed-in document, optionally carrying a check-in section. */
function signedIn(checkIn?: Record<string, unknown>): WorkBuddyWebStatus {
  return {
    status: 'signed-in',
    accounts: { accounts: [account()] },
    probeKey: 'key',
    ...checkIn === undefined ? {} : { checkIn },
  } as unknown as WorkBuddyWebStatus
}

describe('check-in section', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined
  let byRoute: Record<string, WorkBuddyWebStatus | undefined>
  const request = vi.fn()

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    byRoute = {
      [CN_CARD_VARIANT.statusPath]: signedIn(),
      [AI_CARD_VARIANT.statusPath]: signedIn(),
    }
    request.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { ok: true, json: async () => ({ state: 'ok' }) }
      const body = byRoute[url]
      if (body === undefined) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, json: async () => body }
    })
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string): string | null => storage.get(key) ?? null,
      setItem: (key: string, value: string): void => { storage.set(key, value) },
      removeItem: (key: string): void => { storage.delete(key) },
      clear: (): void => { storage.clear() },
    })
    vi.stubGlobal('fetch', request)
    vi.stubGlobal('open', vi.fn())
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '#000',
      fillRect: () => {},
    } as unknown as CanvasRenderingContext2D)
  })

  afterEach(() => {
    act(() => { root?.unmount() })
    container?.remove()
    root = undefined
    container = undefined
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function mount(): Promise<void> {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(WorkBuddySettingsPage, { t }))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  const text = (): string => document.body.textContent ?? ''
  const buttons = (): { label: string, node: HTMLButtonElement }[] =>
    [...document.querySelectorAll('button')].map(node => ({ label: (node.textContent ?? '').trim(), node }))
  const posted = (): { url: string, body: Record<string, unknown> }[] =>
    request.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
      .map(([url, init]) => ({
        url: String(url),
        body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>,
      }))

  it('renders nothing when no product states a check-in section', async () => {
    await mount()
    // An older host omits the field; the section must not appear at all rather
    // than offering a switch that could not be saved.
    expect(text()).not.toContain(t('checkInHeading'))
  })

  it('draws the switches from what the host states', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = signedIn({ auto: true, minuteOfDay: 615 })
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn({ auto: false, minuteOfDay: 600 })
    await mount()

    expect(text()).toContain(t('checkInHeading'))
    const toggle = document.querySelector<HTMLInputElement>('#wbp-checkin-auto-workbuddy')
    expect(toggle?.checked).toBe(true)
    expect(document.querySelector<HTMLInputElement>('#wbp-checkin-auto-workbuddy-ai')?.checked).toBe(false)
    // The moment field is shown only for the product that has the switch on.
    expect(document.querySelector('#wbp-checkin-minute-workbuddy')).not.toBeNull()
    expect(document.querySelector('#wbp-checkin-minute-workbuddy-ai')).toBeNull()
    // 615 minutes is 10:15.
    expect(document.querySelector<HTMLInputElement>('#wbp-checkin-minute-workbuddy')?.value).toBe('10:15')
  })

  it('posts the switch to its own product\'s route', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = signedIn({ auto: false, minuteOfDay: 600 })
    byRoute[AI_CARD_VARIANT.statusPath] = signedIn({ auto: false, minuteOfDay: 600 })
    await mount()

    await act(async () => {
      document.querySelector<HTMLInputElement>('#wbp-checkin-auto-workbuddy-ai')?.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const calls = posted().filter(call => call.body['action'] === 'set-auto-check-in')
    expect(calls).toHaveLength(1)
    // The international switch must not write the CN product's field: that is
    // the mistake this assertion exists for.
    expect(calls[0]!.url).toBe(AI_CARD_VARIANT.probePath)
    expect(calls[0]!.body['autoCheckIn']).toBe(true)
  })

  it('posts the moment as a minute of the day', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = signedIn({ auto: true, minuteOfDay: 600 })
    await mount()

    const field = document.querySelector<HTMLInputElement>('#wbp-checkin-minute-workbuddy')!
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(field, '07:30')
      field.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    const call = posted().find(entry => entry.body['action'] === 'set-check-in-minute')
    // 07:30 is 450 minutes past midnight — the field's value has to reach the
    // host as a minute, not as the string the input holds.
    expect(call?.body['minuteOfDay']).toBe(450)
  })

  it('claims on request, and clears the log', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = signedIn({
      auto: true,
      minuteOfDay: 600,
      logs: [{ id: 'a', date: '2026-10-08', timestamp: Date.now(), status: 'claimed', amount: 25, message: 'ok' }],
    })
    await mount()

    // The log is drawn with the host's own figures.
    expect(text()).toContain(t('checkInLogsHeading'))
    expect(text()).toContain('25')

    const claim = buttons().find(button => button.label === t('checkInNow'))
    expect(claim).toBeDefined()
    await act(async () => { claim!.node.click(); await Promise.resolve(); await Promise.resolve() })
    expect(posted().some(call => call.body['action'] === 'check-in')).toBe(true)

    const clear = buttons().find(button => button.label === t('checkInClearLogs'))
    expect(clear).toBeDefined()
    await act(async () => { clear!.node.click(); await Promise.resolve(); await Promise.resolve() })
    expect(posted().some(call => call.body['action'] === 'clear-check-in-logs')).toBe(true)
  })

  it('names each status the log can hold', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = signedIn({
      auto: true,
      minuteOfDay: 600,
      lastDate: '2026-10-08',
      nextRunAt: Date.now() + 3_600_000,
      logs: [
        { id: '1', date: '2026-10-08', timestamp: Date.now(), status: 'claimed', amount: 25 },
        { id: '2', date: '2026-10-07', timestamp: Date.now(), status: 'already-claimed' },
        { id: '3', date: '2026-10-06', timestamp: Date.now(), status: 'no-campaign' },
        { id: '4', date: '2026-10-05', timestamp: Date.now(), status: 'error', message: 'offline' },
      ],
    })
    await mount()
    // Each of the four outcomes has its own words: a log that collapsed them
    // would say "claimed" for a day that failed.
    expect(text()).toContain(t('checkInStatusClaimed', { amount: '25' }))
    expect(text()).toContain(t('checkInStatusAlready'))
    expect(text()).toContain(t('checkInStatusNoCampaign'))
    expect(text()).toContain(t('checkInStatusError'))
    expect(text()).toContain(t('checkInLastSettled', { date: '2026-10-08' }))
    expect(text()).toContain('offline')
  })

  it('reports a refused claim instead of appearing to do nothing', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = signedIn({ auto: true, minuteOfDay: 600 })
    request.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return { ok: true, json: async () => ({ state: 'failed', reason: 'no credential to check in with' }) }
      }
      return { ok: true, json: async () => byRoute[url] }
    })
    await mount()
    await act(async () => {
      buttons().find(button => button.label === t('checkInNow'))?.node.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(text()).toContain(t('hostCheckInNoCredential'))
  })

  it('carries no invented English when the upstream states nothing', async () => {
    byRoute[CN_CARD_VARIANT.statusPath] = signedIn({
      auto: true,
      minuteOfDay: 600,
      logs: [
        { id: '1', date: '2026-10-08', timestamp: Date.now(), status: 'claimed', amount: 25 },
        { id: '2', date: '2026-10-07', timestamp: Date.now(), status: 'already-claimed' },
        { id: '3', date: '2026-10-06', timestamp: Date.now(), status: 'no-campaign' },
      ],
    })
    await mount()
    // A settled state says what happened through the STATUS column, and the
    // host must not pad it with a sentence of its own: such a sentence is
    // indistinguishable from the upstream's words, so the page cannot tell it
    // apart and translate it — it would simply read as English.
    expect(text()).not.toContain('checked in')
    expect(text()).not.toContain('already claimed today')
    expect(text()).not.toContain('no check-in campaign is active')
    // The status column still states each outcome.
    expect(text()).toContain(t('checkInStatusClaimed', { amount: '25' }))
    expect(text()).toContain(t('checkInStatusAlready'))
    expect(text()).toContain(t('checkInStatusNoCampaign'))
  })
})
