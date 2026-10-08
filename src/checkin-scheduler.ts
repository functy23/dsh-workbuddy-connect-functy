/**
 * The daily check-in's record of what happened, and the timer that makes it
 * happen.
 *
 * Two pieces, deliberately in one module because neither is useful without the
 * other: the store answers "did the plugin already claim today, and what did
 * the last few attempts say", and the scheduler is the only writer that
 * matters. The card reads the store; the timer drives it.
 *
 * The day boundary is UTC+8 for both products — see `checkin.ts` for why the
 * machine's own zone is not consulted.
 *
 * @module dsh-workbuddy-connect/checkin-scheduler
 */

import { readStoreDocument, writeStoreDocument } from './store-file.ts'
import { workbuddyStateDir } from './paths.ts'
import { join } from 'node:path'
import {
  DEFAULT_CHECK_IN_MINUTE,
  isPastCheckInTime,
  msUntilCheckIn,
  normalizeCheckInMinute,
  utc8DateString,
} from './checkin.ts'
import type { WorkBuddyCheckInResult } from './checkin.ts'

/** Basename of the check-in log inside the plugin's state directory. */
export const WORKBUDDY_CHECKIN_FILENAME = '.workbuddy-checkin.json'

/** Current on-disk format; readers reject others. */
const CHECKIN_FORMAT_VERSION = 1

/** How many log rows are kept per variant. */
const LOG_LIMIT = 30

/** State-file path for one variant's log, inside the plugin's state directory. */
export function workbuddyCheckInPath(filename: string = WORKBUDDY_CHECKIN_FILENAME): string {
  return join(workbuddyStateDir(), filename)
}

/** One logged attempt, as the card renders it. */
export interface WorkBuddyCheckInLogRow {
  /** Stable id, so a re-render does not duplicate a row. */
  id: string
  date: string
  timestamp: number
  status: WorkBuddyCheckInResult['status']
  amount?: number
  message?: string
}

/** What the store remembers for one variant. */
export interface WorkBuddyCheckInState {
  /** The last UTC+8 day an attempt settled, `YYYY-MM-DD`. */
  lastDate: string
  /** When that attempt ran, epoch ms. */
  lastAt: number
  status: WorkBuddyCheckInResult['status']
  amount?: number
  message?: string
  /** Most recent first. */
  logs: readonly WorkBuddyCheckInLogRow[]
}

/** Whether a parsed value is a log row this reader can trust. */
function isLogRow(value: unknown): value is WorkBuddyCheckInLogRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (typeof row['id'] !== 'string' || row['id'] === '') return false
  if (typeof row['date'] !== 'string') return false
  if (typeof row['timestamp'] !== 'number' || !Number.isFinite(row['timestamp'])) return false
  return row['status'] === 'claimed' || row['status'] === 'already-claimed'
    || row['status'] === 'no-campaign' || row['status'] === 'error'
}

/**
 * The check-in log: one JSON document holding every variant's record.
 *
 * One file rather than one per product, because the two products' check-ins are
 * driven by the same timer and read by the same card; two files would only add
 * a second failure mode (one readable, one not) for no separation the user
 * asked for. The document is per-variant *inside*, so the two products'
 * histories never mix.
 */
export class WorkBuddyCheckInStore {
  private readonly path: string

  constructor(path: string = workbuddyCheckInPath()) {
    this.path = path
  }

  /** Resolved path, for the CLI and tests. */
  filePath(): string {
    return this.path
  }

  /** Every variant's record, or an empty map when nothing is readable. */
  private load(): Record<string, WorkBuddyCheckInState> {
    const picked = readStoreDocument(this.path, CHECKIN_FORMAT_VERSION, document => {
      const variants = document['variants']
      return typeof variants === 'object' && variants !== null && !Array.isArray(variants)
        ? variants as Record<string, WorkBuddyCheckInState>
        : undefined
    })
    return picked ?? {}
  }

  /** One variant's record, when it has one. */
  read(variantId: string): WorkBuddyCheckInState | undefined {
    const state = this.load()[variantId]
    if (state === undefined) return undefined
    return {
      lastDate: typeof state.lastDate === 'string' ? state.lastDate : '',
      lastAt: typeof state.lastAt === 'number' ? state.lastAt : 0,
      status: state.status,
      ...typeof state.amount === 'number' ? { amount: state.amount } : {},
      ...typeof state.message === 'string' ? { message: state.message } : {},
      logs: Array.isArray(state.logs) ? state.logs.filter(isLogRow).slice(0, LOG_LIMIT) : [],
    }
  }

  /**
   * Record one attempt.
   *
   * @param session - the day this run belongs to, which is NOT the attempt's own
   *   date when a catch-up sweep settles a run scheduled for a moment that has
   *   since passed. Storing the attempt's date would make the next sweep read
   *   "not settled yet" for the day it just settled.
   */
  write(variantId: string, result: WorkBuddyCheckInResult, session: string): void {
    const all = this.load()
    const previous = all[variantId]
    const row: WorkBuddyCheckInLogRow = {
      id: `${session}-${String(result.timestamp)}`,
      date: result.date,
      timestamp: result.timestamp,
      status: result.status,
      ...result.amount === undefined ? {} : { amount: result.amount },
      ...result.message === undefined ? {} : { message: result.message },
    }
    const logs = [row, ...(previous?.logs ?? []).filter(existing => existing.id !== row.id)].slice(0, LOG_LIMIT)
    all[variantId] = {
      lastDate: session,
      lastAt: result.timestamp,
      status: result.status,
      ...result.amount === undefined ? {} : { amount: result.amount },
      ...result.message === undefined ? {} : { message: result.message },
      logs,
    }
    writeStoreDocument(this.path, { version: CHECKIN_FORMAT_VERSION, variants: all })
  }

  /** Drop one variant's history, keeping the rest of the document. */
  clearLogs(variantId: string): void {
    const all = this.load()
    const previous = all[variantId]
    if (previous === undefined) return
    all[variantId] = { ...previous, logs: [] }
    writeStoreDocument(this.path, { version: CHECKIN_FORMAT_VERSION, variants: all })
  }
}

/** One variant's check-in, as the scheduler needs it. */
export interface WorkBuddyCheckInTarget {
  variantId: string
  /** Claim today's benefit for this variant. */
  checkIn: (session: string, signal?: AbortSignal) => Promise<WorkBuddyCheckInResult>
  /** Whether the user has switched automatic check-in on for this variant. */
  enabled: () => boolean
  /** The moment to check in, as minutes past midnight UTC+8. */
  minuteOfDay: () => number
  /** Called after a claim landed, so the caller can re-read credit. */
  onClaimed?: () => void
}

/** Constructor dependencies. */
export interface WorkBuddyCheckInSchedulerOptions {
  targets: readonly WorkBuddyCheckInTarget[]
  store?: WorkBuddyCheckInStore
  /** Clock, injectable so the schedule is testable without waiting. */
  now?: () => number
  /** Where a settle is reported; defaults to nothing. */
  onResult?: (result: WorkBuddyCheckInResult) => void
}

/**
 * Runs each variant's check-in once a day, and catches up a day the host was
 * not running for.
 *
 * The catch-up rule is the reason this is not a bare `setTimeout`: a host that
 * is only started at 20:00 would otherwise never check in at all, because the
 * scheduled moment passed while it was down. A sweep therefore runs once at
 * startup, and it runs a variant only when the configured moment has ALREADY
 * passed and today is not settled — a host started before 10:00 waits for its
 * timer, exactly as the user asked it to.
 */
export class WorkBuddyCheckInScheduler {
  private readonly targets: readonly WorkBuddyCheckInTarget[]
  private readonly store: WorkBuddyCheckInStore
  private readonly now: () => number
  private readonly onResult: ((result: WorkBuddyCheckInResult) => void) | undefined
  private readonly timers = new Map<string, NodeJS.Timeout>()
  /** Variants with a run in flight, so a timer and a sweep cannot both spend. */
  private readonly inFlight = new Set<string>()
  private nextRuns = new Map<string, number>()
  private stopped = false

  constructor(options: WorkBuddyCheckInSchedulerOptions) {
    this.targets = options.targets
    this.store = options.store ?? new WorkBuddyCheckInStore()
    this.now = options.now ?? (() => Date.now())
    this.onResult = options.onResult
  }

  /** Start the timers, after one catch-up sweep. */
  start(): void {
    if (this.stopped) return
    void this.sweep(true)
    this.rearm()
  }

  /** Stop every timer; a run already in flight is left to finish. */
  dispose(): void {
    this.stopped = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  /**
   * Re-arm every timer from the current configuration.
   *
   * Called after a settings write, so a moment the user has just changed takes
   * effect now rather than at the next firing of the old one.
   */
  rearm(): void {
    if (this.stopped) return
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.nextRuns = new Map()
    const nowMs = this.now()
    for (const target of this.targets) {
      const delay = msUntilCheckIn(target.minuteOfDay(), nowMs)
      this.nextRuns.set(target.variantId, nowMs + delay)
      const timer = setTimeout(() => {
        this.timers.delete(target.variantId)
        void this.sweep(false, target.variantId).finally(() => { this.rearm() })
      }, delay)
      // Never hold the host open: a pending check-in is not a reason to keep
      // DSH running, and the next start catches up anyway.
      timer.unref?.()
      this.timers.set(target.variantId, timer)
    }
  }

  /** When this variant's next run is due, epoch ms, when one is armed. */
  nextRunAt(variantId: string): number | undefined {
    return this.nextRuns.get(variantId)
  }

  /**
   * Sweep every variant (or one).
   *
   * @param catchUp - true for the startup sweep, which also runs a variant whose
   *   scheduled moment has passed; false for a timer firing, which runs whatever
   *   it is told to.
   * @param only - restrict the sweep to one variant.
   */
  async sweep(catchUp: boolean, only?: string): Promise<void> {
    if (this.stopped) return
    const nowMs = this.now()
    const session = utc8DateString(nowMs)
    for (const target of this.targets) {
      if (only !== undefined && target.variantId !== only) continue
      if (!target.enabled()) continue
      if (this.inFlight.has(target.variantId)) continue
      if (catchUp && !isPastCheckInTime(target.minuteOfDay(), nowMs)) continue
      // Already settled today, and settled SUCCESSFULLY: a failed attempt is
      // retried by the next sweep rather than being written off for the day.
      const state = this.store.read(target.variantId)
      if (state?.lastDate === session
        && (state.status === 'claimed' || state.status === 'already-claimed' || state.status === 'no-campaign')) {
        continue
      }
      this.inFlight.add(target.variantId)
      try {
        const result = await target.checkIn(session)
        if (this.stopped) return
        this.store.write(target.variantId, result, session)
        if (result.status === 'claimed') target.onClaimed?.()
        this.onResult?.(result)
      } catch (error: unknown) {
        // A throwing target must not stop the other variant, and the failure is
        // worth a log row: "nothing happened" is otherwise indistinguishable
        // from "it never ran".
        const failed: WorkBuddyCheckInResult = {
          variantId: target.variantId,
          date: utc8DateString(nowMs),
          timestamp: nowMs,
          status: 'error',
          message: (error instanceof Error ? error.message : String(error)).slice(0, 200),
        }
        this.store.write(target.variantId, failed, session)
        this.onResult?.(failed)
      } finally {
        this.inFlight.delete(target.variantId)
      }
    }
  }
}

export { DEFAULT_CHECK_IN_MINUTE, normalizeCheckInMinute }
