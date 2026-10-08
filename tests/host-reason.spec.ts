/**
 * Reading the host's own refusal sentences in the interface's language.
 *
 * The host half composes every refusal in English and the browser half used to
 * render it verbatim, so a Chinese interface showed English. These cases pin
 * both halves of that contract: the refusals this build knows are restated, and
 * everything else is passed through untouched — the second half matters more,
 * because a raw `error.message` (a filesystem or fetch failure) is a diagnosis
 * and must not be swallowed by a generic "request failed".
 */
import { describe, expect, it } from 'vitest'
import { translateHostReason } from '../src/client/host-reason.ts'
import { en, zh } from '../src/client/locales.ts'
import { PANEL_COPY_EN, PANEL_COPY_ZH } from '../src/client/panel-copy.ts'

/** Fill `{name}` placeholders the way the harness's locale seat does. */
const fill = (template: string, params: Record<string, unknown> = {}): string =>
  Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template)

/** The settings page's `t`, resolved against one dictionary. */
const t = (key: keyof typeof en, params?: Record<string, unknown>): string => fill(en[key], params)
const tZh = (key: keyof typeof en, params?: Record<string, unknown>): string => fill(zh[key], params)

describe('host reason translation', () => {
  it('restates a fixed refusal instead of showing the host\'s English', () => {
    expect(translateHostReason(tZh, 'no such account')).toBe(tZh('hostNoSuchAccount'))
    expect(translateHostReason(tZh, 'settings are unavailable')).toBe(tZh('hostSettingsUnavailable'))
    expect(translateHostReason(tZh, 'the signed-in account changed')).toBe(tZh('hostAccountChanged'))
    expect(translateHostReason(tZh, 'no WorkBuddy credential')).toBe(tZh('hostNoCredential'))
  })

  it('keeps the value the host substituted into a shaped refusal', () => {
    // The model id is the whole point of the sentence, so it has to survive.
    expect(translateHostReason(tZh, 'unknown model: hy3')).toBe(tZh('hostUnknownModel', { model: 'hy3' }))
    expect(translateHostReason(tZh, 'that is a WorkBuddy (CN) token; paste it into the matching product\'s dialog'))
      .toBe(tZh('hostWrongRegionToken', { product: 'WorkBuddy (CN)' }))
  })

  it('keeps the paths a sign-in diagnosis names, under the translated sentence', () => {
    const reason = 'workbuddy: no signed-in WorkBuddy account found; sign in once in the WorkBuddy desktop app'
      + ' (expected /Users/x/Library/auth/workbuddy-desktop.info or WORKBUDDY_AUTH_FILE), or refresh an existing session'
    const out = translateHostReason(tZh, reason)
    expect(out).toContain(tZh('hostNoSignedInApp', { app: 'WorkBuddy' }))
    // The file the host looked in is the actionable half; dropping it would
    // leave the user with a sentence and nothing to do.
    expect(out).toContain('/Users/x/Library/auth/workbuddy-desktop.info')
  })

  it('passes through a sentence it does not know, rather than genericising it', () => {
    // A raw thrown message from the filesystem or fetch: the host's own words
    // are the diagnosis, and nothing here may replace them.
    expect(translateHostReason(tZh, 'ENOENT: no such file or directory, open \'/tmp/x\''))
      .toBe('ENOENT: no such file or directory, open \'/tmp/x\'')
    // A generic-looking sentence that is NOT one of the table's rows must not
    // match by accident.
    expect(translateHostReason(tZh, 'no such accounts')).toBe('no such accounts')
    // The empty and absent cases stay absent, so callers keep their `?? fallback`.
    expect(translateHostReason(tZh, undefined)).toBeUndefined()
    expect(translateHostReason(tZh, '')).toBe('')
  })

  it('answers English for an English interface', () => {
    // The restatement is a lookup, not a translation-only path: an English
    // interface gets the same sentence, from the same table.
    expect(translateHostReason(t, 'no such account')).toBe(t('hostNoSuchAccount'))
  })

  it('carries every host reason into both dictionary languages', () => {
    // The panel namespace draws these too, and typing cannot see a key that was
    // added to one dictionary and left English in the other.
    const keys = Object.keys(en).filter(key => key.startsWith('host')) as (keyof typeof en)[]
    expect(keys.length).toBeGreaterThan(20)
    for (const key of keys) {
      expect(zh[key]).not.toBe(en[key])
      // The panel namespace carries the same keys, from the same table.
      expect(PANEL_COPY_EN[key as keyof typeof PANEL_COPY_EN]).toBe(en[key])
      expect(PANEL_COPY_ZH[key as keyof typeof PANEL_COPY_ZH]).toBe(zh[key])
    }
  })
})
