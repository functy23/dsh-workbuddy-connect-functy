/**
 * Reads the host's own refusal sentences in the interface's language.
 *
 * The host half has no language of its own: it composes a short English
 * sentence for every refusal it can report ("no such account", "settings are
 * unavailable") and the browser half renders it verbatim. That is fine until
 * the interface is Chinese, which is the one case this module exists for.
 *
 * WHY THE TRANSLATION LIVES HERE RATHER THAN HOST-SIDE
 *
 * Two properties, and the second is the one that matters for merging:
 *
 * 1. The host keeps ONE string per refusal. Emitting a code instead would put
 *    the same vocabulary on the wire and in a table, and the two could drift.
 * 2. **The wire is unchanged.** A host that predates this module still sends
 *    English, and a browser bundle that predates it still renders what it is
 *    given; either combination keeps working. It also means this whole feature
 *    is additive — one new file and one locale table — so it does not sit on
 *    any line an upstream edit is likely to touch.
 *
 * The host's sentence is still the fallback. A refusal this table does not
 * know — a new one added upstream, or a raw `error.message` from a filesystem
 * or fetch failure — is returned unchanged rather than replaced by a generic
 * "request failed", because the host's own words are the diagnosis.
 *
 * @module dsh-workbuddy-connect/client/host-reason
 */

import type { HostReasonKey } from './host-reason-copy.ts'

/** The bit of a locale seat this module needs: it names host-reason keys. */
export type HostReasonTranslate = (key: HostReasonKey, params?: Record<string, unknown>) => string

/** One exact sentence the host can send, and the key that restates it. */
interface ExactReason {
  reason: string
  key: HostReasonKey
}

/**
 * The refusals the host composes from a fixed literal.
 *
 * Exhaustive on purpose: every fixed-sentence refusal the host can report into
 * a `reason` field has a row here, so a Chinese interface never shows one of
 * them in English. Adding a `reason:` literal host-side without a row here is
 * the one way this list goes stale, which is why it is kept in one place and
 * named after the host's own files.
 */
const EXACT_REASONS: readonly ExactReason[] = [
  // src/index.ts — the settings writes.
  { reason: 'settings are unavailable', key: 'hostSettingsUnavailable' },
  { reason: 'this host does not accept settings writes', key: 'hostSettingsWritesUnsupported' },
  { reason: 'unknown sidebar credit style', key: 'hostUnknownCreditStyle' },
  { reason: 'plugin is stopping', key: 'hostStopping' },
  // src/index.ts — the account and model writes.
  { reason: 'model visibility needs a signed-in account with a stable user id', key: 'hostVisibilityNeedsAccount' },
  { reason: 'the signed-in account changed', key: 'hostAccountChanged' },
  { reason: 'no such account', key: 'hostNoSuchAccount' },
  { reason: 'no such model', key: 'hostNoSuchModel' },
  { reason: 'that model does not offer that context length', key: 'hostContextLengthUnsupported' },
  { reason: 'the desktop app holds no sign-in to read', key: 'hostDesktopSignedOut' },
  { reason: 'the token was refused', key: 'hostTokenRefused' },
  { reason: 'already in the pool; its token was replaced', key: 'hostTokenReplaced' },
  { reason: 'already in the pool; its sign-in tokens were refreshed', key: 'hostTokensRefreshed' },
  // src/probe-service.ts — the reasoning-effort detection.
  { reason: 'probing is not authorized', key: 'hostProbeUnauthorized' },
  { reason: 'no WorkBuddy credential', key: 'hostNoCredential' },
  { reason: 'model does not need detection', key: 'hostProbeNotNeeded' },
  { reason: 'account changed before detection', key: 'hostAccountChangedBeforeProbe' },
  { reason: 'account changed during detection', key: 'hostAccountChangedDuringProbe' },
  // src/rotation.ts, src/account-service.ts and src/open-link.ts.
  { reason: 'the account was removed while refreshing', key: 'hostAccountRemovedWhileRefreshing' },
  { reason: 'only absolute http and https links can be opened', key: 'hostLinkUnsupported' },
  { reason: 'that does not look like a sign-in token (no readable payload)', key: 'hostTokenUnreadable' },
  { reason: 'the token names an issuer this plugin does not recognise', key: 'hostTokenIssuerUnknown' },
  // src/web-status.ts — the empty-pool hint the card shows as its reason line.
  { reason: 'no account yet: sign in to the desktop app, or add one by QR from this card', key: 'hostNoAccountYet' },
  // src/index.ts — the manual check-in action's fallback, when the upstream
  // gave no message of its own.
  { reason: 'check-in failed', key: 'hostCheckInFailed' },
  // src/checkin.ts — the check-in found no credential to send with.
  { reason: 'no credential to check in with', key: 'hostCheckInNoCredential' },
]

/**
 * A refusal the host composes around a value it substitutes in.
 *
 * Matched by prefix and suffix rather than by one regex per row: the host's
 * literals sit in template strings whose interpolated part is the whole point
 * (which model, which product), so the shape — not the sentence — is what the
 * two sides agree on.
 */
interface ShapedReason {
  prefix: string
  suffix: string
  key: HostReasonKey
  /** Reads the substituted value out of the middle of the host's sentence. */
  capture: (middle: string) => Record<string, unknown> | undefined
}

const SHAPED_REASONS: readonly ShapedReason[] = [
  {
    // `unknown model: ${modelId}` — src/probe-service.ts.
    prefix: 'unknown model: ',
    suffix: '',
    key: 'hostUnknownModel',
    capture: middle => middle === '' ? undefined : { model: middle },
  },
  {
    // `that is a ${actual} token; paste it into the matching product's dialog`
    // — src/account-service.ts. The middle is the product's display name, which
    // is a proper noun and stays as it is in both languages. The literal
    // ` token` belongs to the SUFFIX: leaving it out would fold the word into
    // the captured name ("WorkBuddy (CN) token"), which then reads as a doubled
    // noun once the restatement puts its own word after it.
    prefix: 'that is a ',
    suffix: " token; paste it into the matching product's dialog",
    key: 'hostWrongRegionToken',
    capture: middle => middle === '' ? undefined : { product: middle },
  },
]

/**
 * The `workbuddy: no signed-in {app} account found; sign in once in the {app}
 * desktop app (expected …), or refresh an existing session` sentence from
 * `src/auth.ts`.
 *
 * Matched on its stable head and tail because the middle names machine-specific
 * paths: the sentence is the one place the host tells the user which file it
 * looked in, and rewriting it must not drop that fact — the fallback below
 * keeps the host's original whenever the shape does not match exactly.
 */
function translateNoSignedInApp(
  t: HostReasonTranslate,
  reason: string,
): string | undefined {
  const head = 'workbuddy: no signed-in '
  const tail = ' account found; sign in once in the '
  if (!reason.startsWith(head) || !reason.includes(tail)) return undefined
  const app = reason.slice(head.length, reason.indexOf(tail))
  if (app === '') return undefined
  return `${t('hostNoSignedInApp', { app })}\n${reason.slice(reason.indexOf('(')).trim()}`
}

/**
 * The `workbuddy: access token expired and no refresh token is stored; sign in
 * again in the WorkBuddy desktop app` sentence from `src/auth.ts`.
 */
function translateSignInExpired(
  t: HostReasonTranslate,
  reason: string,
): string | undefined {
  const marker = 'access token expired and no refresh token is stored; sign in again in the '
  const at = reason.indexOf(marker)
  if (at < 0) return undefined
  return t('hostSignInExpired', { app: reason.slice(at + marker.length) })
}

/**
 * The region-mismatch diagnosis from `src/auth.ts`.
 *
 * Its stable parts are the head (`{app} received a {product} credential in its
 * {label} (domain "…")`) and the tail naming the env var to fix; the domain is
 * a value the interface should keep verbatim.
 */
function translateCredentialRegionMismatch(
  t: HostReasonTranslate,
  reason: string,
): string | undefined {
  const head = ' received a '
  const marker = ' credential in its '
  const headAt = reason.indexOf(head)
  if (headAt <= 0 || !reason.includes(marker)) return undefined
  const app = reason.slice(0, headAt)
  const afterMarker = reason.slice(reason.indexOf(marker) + marker.length)
  const other = reason.slice(headAt + head.length, reason.indexOf(marker))
  // `point ${env} at the …` — the env var is the actionable part.
  const envAt = afterMarker.indexOf('point ')
  if (other === '' || envAt < 0) return undefined
  const env = afterMarker.slice(envAt + 'point '.length).split(' ')[0] ?? ''
  if (env === '') return undefined
  return t('hostCredentialRegionMismatch', { app, other, env })
}

/**
 * Restate one host refusal in the interface's language.
 *
 * Returns the host's own sentence whenever the shape is not one this table
 * knows, so an unrecognised refusal reads as the host wrote it rather than as a
 * generic failure. `undefined` passes through so callers can keep their own
 * `?? fallback` idiom.
 */
export function translateHostReason(
  t: HostReasonTranslate,
  reason: string | undefined,
): string | undefined {
  if (reason === undefined || reason === '') return reason
  for (const row of EXACT_REASONS) {
    if (reason === row.reason) return t(row.key)
  }
  for (const row of SHAPED_REASONS) {
    if (!reason.startsWith(row.prefix) || !reason.endsWith(row.suffix)) continue
    const end = row.suffix === '' ? reason.length : reason.length - row.suffix.length
    const params = row.capture(reason.slice(row.prefix.length, end))
    if (params !== undefined) return t(row.key, params)
  }
  return translateNoSignedInApp(t, reason)
    ?? translateSignInExpired(t, reason)
    ?? translateCredentialRegionMismatch(t, reason)
    ?? reason
}
