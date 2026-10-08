/**
 * The check-in half of the probe route, and the section the card reads.
 *
 * Two contracts, and they fail in different ways:
 *
 * - the route must REFUSE an action the host was assembled without (404), so a
 *   card can tell "this build does not have it" from "it ran and failed";
 * - the status section must state the switch the host will actually honour, so
 *   the card cannot claim automatic check-in is on while the scheduler skips it.
 */
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createProbeKey, workBuddyProbeHandler } from '../src/probe-route.ts'
import type { WorkBuddyProbeRouteOptions } from '../src/probe-route.ts'

let server: Server | undefined
afterEach(async () => {
  const current = server
  server = undefined
  if (current !== undefined) await new Promise<void>(resolve => { current.close(() => { resolve() }) })
})

/** Mount one handler on a loopback port and answer its origin. */
async function mount(overrides: Partial<WorkBuddyProbeRouteOptions> = {}): Promise<{ origin: string, key: string }> {
  const key = createProbeKey()
  const handler = workBuddyProbeHandler({
    probe: async () => ({ state: 'ok' }),
    clear: () => {},
    ...overrides,
  }, key)
  server = createServer((req, res) => { void handler(req, res) })
  await new Promise<void>(resolve => { server!.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { origin: `http://127.0.0.1:${String(port)}`, key }
}

/** Post one action body and read the answer. */
async function post(origin: string, key: string, body: unknown): Promise<{ status: number, body: Record<string, unknown> }> {
  const response = await fetch(`${origin}/plugins/x/probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Probe-Key': key },
    body: JSON.stringify(body),
  })
  const parsed: unknown = await response.json().catch(() => undefined)
  return {
    status: response.status,
    body: typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {},
  }
}

describe('check-in route actions', () => {
  it('claims on request and reports the outcome', async () => {
    let ran = 0
    const { origin, key } = await mount({
      checkIn: async () => { ran += 1; return { state: 'ok', reason: 'claimed 25' } },
    })
    const answer = await post(origin, key, { action: 'check-in' })
    expect(answer.status).toBe(200)
    expect(answer.body['state']).toBe('ok')
    expect(ran).toBe(1)
  })

  it('reports a failed claim with the host\'s reason', async () => {
    const { origin, key } = await mount({
      checkIn: async () => ({ state: 'failed', reason: 'no credential to check in with' }),
    })
    const answer = await post(origin, key, { action: 'check-in' })
    expect(answer.status).toBe(200)
    expect(answer.body['state']).toBe('failed')
    expect(answer.body['reason']).toBe('no credential to check in with')
  })

  it('refuses check-in on a host assembled without it', async () => {
    const { origin, key } = await mount()
    // 404 rather than a silent success: the card tells "this build lacks it"
    // from "it ran and failed" only by the status.
    expect((await post(origin, key, { action: 'check-in' })).status).toBe(404)
    expect((await post(origin, key, { action: 'clear-check-in-logs' })).status).toBe(404)
  })

  it('accepts the two settings writes and rejects a malformed one', async () => {
    const seen: unknown[] = []
    const { origin, key } = await mount({
      setAutoCheckIn: async enabled => { seen.push(['auto', enabled]); return { state: 'updated' } },
      setCheckInMinute: async minute => { seen.push(['minute', minute]); return { state: 'updated' } },
    })
    expect((await post(origin, key, { action: 'set-auto-check-in', autoCheckIn: true })).body['state']).toBe('updated')
    expect((await post(origin, key, { action: 'set-check-in-minute', minuteOfDay: 615 })).body['state']).toBe('updated')
    expect(seen).toEqual([['auto', true], ['minute', 615]])

    // A strict boolean and a real number: the string "false" is truthy, and a
    // NaN minute would reach the scheduler as a moment that never comes.
    expect((await post(origin, key, { action: 'set-auto-check-in', autoCheckIn: 'false' })).status).toBe(400)
    expect((await post(origin, key, { action: 'set-check-in-minute', minuteOfDay: '600' })).status).toBe(400)
    expect((await post(origin, key, { action: 'set-check-in-minute', minuteOfDay: Number.NaN })).status).toBe(400)
  })

  it('clears the log on request', async () => {
    let cleared = 0
    const { origin, key } = await mount({ clearCheckInLogs: () => { cleared += 1 } })
    const answer = await post(origin, key, { action: 'clear-check-in-logs' })
    expect(answer.body['state']).toBe('cleared')
    expect(cleared).toBe(1)
  })

  it('still requires the control key for every check-in action', async () => {
    const { origin } = await mount({ checkIn: async () => ({ state: 'ok' }) })
    const response = await fetch(`${origin}/plugins/x/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Probe-Key': 'wrong' },
      body: JSON.stringify({ action: 'check-in' }),
    })
    // A spend of a real upstream request: the key is what authorizes it, and
    // the check-in actions must not be an exception to that.
    expect(response.status).toBe(403)
  })
})
