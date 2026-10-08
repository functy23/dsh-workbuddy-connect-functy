/**
 * WorkBuddy's daily benefit check-in.
 *
 * The endpoint sits in the same billing family the plugin already reads credit
 * from (`/v2/billing/meter/*`), so the request reuses that family's base and
 * headers rather than inventing a second identity for the same account. The
 * path itself is the one the reference implementation measured; the shape of
 * the answer is handled defensively below because the upstream documents it
 * nowhere.
 *
 * The whole feature is additive: this file and the scheduler beside it, plus
 * two `export` keywords on helpers that already existed. Nothing in the request
 * or credential path changes, which is what keeps the merge surface small.
 *
 * @module dsh-workbuddy-connect/checkin
 */

import { billingBase, billingHeaders } from './upstream.ts'
import type { WorkBuddyCredential } from './auth.ts'

/** The one path this module posts to, under the region's billing base. */
const CHECK_IN_PATH = '/v2/billing/meter/daily-checkin'

/** How long the request may take before it is abandoned. */
const DEFAULT_TIMEOUT_MS = 15_000

/** Longest upstream message kept for the log row. */
const MESSAGE_LIMIT = 200

/**
 * The offset the check-in day is measured in.
 *
 * Fixed at UTC+8 rather than taken from the machine: the reset is the
 * upstream's, it happens on Beijing time for both products, and a user in
 * another zone must not check in "tomorrow" because their laptop says so.
 */
const CHECK_IN_OFFSET_MS = 8 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

/** What one attempt produced. */
export interface WorkBuddyCheckInResult {
  variantId: string
  /** The UTC+8 day the attempt belongs to, `YYYY-MM-DD`. */
  date: string
  /** When the attempt ran, epoch ms. */
  timestamp: number
  /**
   * `claimed` a benefit was granted; `already-claimed` the upstream says today
   * is spent; `no-campaign` there is no campaign to claim; `error` the answer
   * was unreadable or the request failed.
   *
   * `already-claimed` is deliberately distinct from `claimed`: both mean "today
   * is settled", but only the first is worth telling the user that the plugin
   * did not just earn them anything.
   */
  status: 'claimed' | 'already-claimed' | 'no-campaign' | 'error'
  /** Credits granted, when the answer stated a figure. */
  amount?: number
  /** The upstream's own message, or a short description of the failure. */
  message?: string
}

/** Constructor dependencies; `fetch` is injectable so tests never reach the network. */
export interface WorkBuddyCheckInOptions {
  fetch?: typeof fetch
  timeoutMs?: number
  /** Clock, injectable so the day boundary is testable. */
  now?: () => number
}

/** The UTC+8 calendar day a moment belongs to, as `YYYY-MM-DD`. */
export function utc8DateString(nowMs: number): string {
  return new Date(nowMs + CHECK_IN_OFFSET_MS).toISOString().slice(0, 10)
}

/** Seconds elapsed since the start of the current UTC+8 day. */
function secondsIntoUtc8Day(nowMs: number): number {
  return Math.floor(((nowMs + CHECK_IN_OFFSET_MS) % DAY_MS) / 1000)
}

/**
 * Milliseconds until the next occurrence of a minute-of-day in UTC+8.
 *
 * Five seconds past the configured minute, so the request lands after the
 * upstream has flipped the day over rather than on the boundary itself — a
 * check-in fired at exactly 10:00:00 can still be answered as yesterday's.
 */
export function msUntilCheckIn(minuteOfDay: number, nowMs: number): number {
  const target = normalizeCheckInMinute(minuteOfDay) * 60 + 5
  let delta = target - secondsIntoUtc8Day(nowMs)
  if (delta <= 0) delta += DAY_MS / 1000
  return delta * 1000
}

/**
 * Whether today's configured moment has passed in UTC+8.
 *
 * The catch-up sweep's gate: a host started at 09:00 must not claim a check-in
 * the user scheduled for 10:00, because the plugin would then have checked in
 * at a time the user explicitly did not choose.
 */
export function isPastCheckInTime(minuteOfDay: number, nowMs: number): boolean {
  return secondsIntoUtc8Day(nowMs) >= normalizeCheckInMinute(minuteOfDay) * 60
}

/** The default moment: 600 = 10:00 UTC+8. */
export const DEFAULT_CHECK_IN_MINUTE = 600

/** Clamp any stored or typed value onto a real minute of the day. */
export function normalizeCheckInMinute(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CHECK_IN_MINUTE
  const whole = Math.trunc(value)
  return whole < 0 || whole > 1439 ? DEFAULT_CHECK_IN_MINUTE : whole
}

/** One field of an answer, read as a finite number when it is one. */
function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** The credits an answer granted, across the spellings the upstream may use. */
function amountOf(data: Record<string, unknown>): number | undefined {
  const nested = typeof data['data'] === 'object' && data['data'] !== null && !Array.isArray(data['data'])
    ? data['data'] as Record<string, unknown>
    : undefined
  for (const source of [nested, data]) {
    if (source === undefined) continue
    for (const key of ['credit', 'credits', 'amount', 'points', 'reward']) {
      const found = numberOf(source[key])
      if (found !== undefined) return found
    }
  }
  return undefined
}

/** The upstream's own message, across the two spellings it uses. */
function messageOf(data: Record<string, unknown>): string {
  for (const key of ['msg', 'message']) {
    const value = data[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim().slice(0, MESSAGE_LIMIT)
  }
  return ''
}

/**
 * Whether an answer says today's benefit was already taken.
 *
 * Code and text are both read, because the upstream reports this case both
 * ways: `10001` (usually on a 400) and messages naming 签到 in Chinese. Either
 * alone would miss answers the other catches.
 */
function isAlreadyClaimed(code: number | undefined, message: string): boolean {
  if (code === 10001) return true
  const lowered = message.toLowerCase()
  return message.includes('已签到') || message.includes('今天已签到') || lowered.includes('already')
}

/** Whether an answer says there is no campaign to claim. */
function isNoCampaign(data: Record<string, unknown>, message: string): boolean {
  const nested = typeof data['data'] === 'object' && data['data'] !== null && !Array.isArray(data['data'])
    ? data['data'] as Record<string, unknown>
    : undefined
  if (nested?.['active'] === false) return true
  const lowered = message.toLowerCase()
  return message.includes('活动未开启') || message.includes('活动已结束') || lowered.includes('not active')
}

/**
 * The daily check-in.
 *
 * One instance serves both variants: the credential carries the region, so the
 * request needs nothing else that varies per product.
 */
export class WorkBuddyCheckIn {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly now: () => number

  constructor(options: WorkBuddyCheckInOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.now = options.now ?? Date.now
  }

  /**
   * Claim one product's daily benefit.
   *
   * Never throws: every failure becomes an `error` result carrying the reason,
   * because the caller is a timer with nowhere to report an exception, and a
   * dropped check-in must be visible in the log rather than silent.
   */
  async checkIn(
    variantId: string,
    credential: WorkBuddyCredential | undefined,
    signal?: AbortSignal,
  ): Promise<WorkBuddyCheckInResult> {
    const nowMs = this.now()
    const date = utc8DateString(nowMs)
    const base = { variantId, date, timestamp: nowMs } as const

    if (credential === undefined || credential.accessToken.trim() === '') {
      return { ...base, status: 'error', message: 'no credential to check in with' }
    }

    let response: Response
    try {
      response = await this.fetchImpl(`${billingBase(credential)}${CHECK_IN_PATH}`, {
        method: 'POST',
        headers: billingHeaders(credential),
        body: JSON.stringify({}),
        signal: signal ?? AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error: unknown) {
      return { ...base, status: 'error', message: (error instanceof Error ? error.message : String(error)).slice(0, MESSAGE_LIMIT) }
    }

    const text = await response.text().catch(() => '')
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = undefined
    }
    // A body that does not parse is NOT a claim, whatever the status says. The
    // upstream answers in JSON on this route, so an unreadable body means the
    // request went somewhere else (a captive portal, a proxy error page) — and
    // reporting it as a claim would tell the user they earned something the
    // plugin cannot name, then refuse to retry for the rest of the day.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...base, status: 'error', message: `http ${String(response.status)}: ${text.slice(0, 120)}` }
    }
    const data = parsed as Record<string, unknown>
    const code = numberOf(data['code'])
    const message = messageOf(data)

    // The settled states carry NO invented sentence when the upstream gave
    // none. `status` already says what happened, and the card renders it from
    // its own dictionary — so an English fallback here would be the one string
    // on a Chinese page that nothing can translate, because it is indistinguishable
    // from the upstream's own words. The message is for what only the upstream
    // can say; absent means "nothing to add".
    if (isAlreadyClaimed(code, message)) {
      return { ...base, status: 'already-claimed', ...message === '' ? {} : { message } }
    }
    if (isNoCampaign(data, message)) {
      return { ...base, status: 'no-campaign', ...message === '' ? {} : { message } }
    }

    // A 2xx with no stated business code is how the upstream answers a
    // successful claim; a non-zero code is a refusal even under a 2xx.
    if (response.ok && (code === undefined || code === 0 || code === 200)) {
      const amount = amountOf(data)
      return {
        ...base,
        status: 'claimed',
        ...amount === undefined ? {} : { amount },
        ...message === '' ? {} : { message },
      }
    }

    // A failure has nothing else to say what went wrong, so a bare diagnostic
    // is the detail — and it is a fact (a status, a transport error), not prose
    // this plugin composed.
    return {
      ...base,
      status: 'error',
      message: message === '' ? `http ${response.status}: ${text.slice(0, 120)}` : message,
    }
  }
}
