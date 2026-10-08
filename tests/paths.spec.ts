/**
 * The plugin's data directory: where it lives, and how it is discovered.
 *
 * Two properties are worth pinning, and they fail differently:
 *
 * 1. **The override wins.** `DSH_WORKBUDDY_DATA_DIR` is what the tests use, and
 *    a host running from a checkout outside any profile depends on it.
 * 2. **A profile is found rather than assumed.** DSH installs a plugin into a
 *    profile by link, so the manifest names a path outside `$DSH_HOME` while
 *    Node resolves the module to that real path. Discovery therefore reads the
 *    profile's OWN manifest; inferring it from this module's location would
 *    miss exactly the developer install shape.
 *
 * The fallback to the harness home is asserted too: a checkout running its own
 * tests has no profile, and the plugin still has to have somewhere to write.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WORKBUDDY_CONFIG_DIR_NAME,
  WORKBUDDY_DATA_DIR_ENV,
  WORKBUDDY_DATA_DIR_NAME,
  WORKBUDDY_STATE_DIR_NAME,
  workbuddyConfigDir,
  workbuddyPluginDataDir,
  workbuddyStateDir,
} from '../src/paths.ts'

const CLEANUP: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of CLEANUP.splice(0)) await dispose()
  vi.unstubAllEnvs()
})

async function tempDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wb-paths-'))
  CLEANUP.push(() => rm(root, { recursive: true, force: true }))
  return root
}

describe('plugin data directory', () => {
  it('is the profile directory when a profile declares this plugin', async () => {
    const root = await tempDir()
    const profile = join(root, 'profiles', 'web')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      dependencies: { 'dsh-workbuddy-connect-functy': 'link:/somewhere/checkout' },
    }))
    vi.stubEnv('DSH_HOME', root)

    expect(workbuddyPluginDataDir()).toBe(join(profile, WORKBUDDY_DATA_DIR_NAME))
    // The two layers are inside it, not beside it.
    expect(workbuddyConfigDir()).toBe(join(profile, WORKBUDDY_DATA_DIR_NAME, WORKBUDDY_CONFIG_DIR_NAME))
    expect(workbuddyStateDir()).toBe(join(profile, WORKBUDDY_DATA_DIR_NAME, WORKBUDDY_STATE_DIR_NAME))
  })

  it('falls back to the harness home when no profile declares it', async () => {
    const root = await tempDir()
    vi.stubEnv('DSH_HOME', root)
    // A checkout running its own tests: no `profiles/` at all. The plugin still
    // needs somewhere to write, and one flat plugin directory is that somewhere.
    expect(workbuddyPluginDataDir()).toBe(join(root, WORKBUDDY_DATA_DIR_NAME))
  })

  it('ignores a profile that does not declare this plugin', async () => {
    const root = await tempDir()
    const other = join(root, 'profiles', 'desktop')
    await mkdir(other, { recursive: true })
    await writeFile(join(other, 'package.json'), JSON.stringify({
      dependencies: { 'some-other-plugin': '^1.0.0' },
    }))
    vi.stubEnv('DSH_HOME', root)
    expect(workbuddyPluginDataDir()).toBe(join(root, WORKBUDDY_DATA_DIR_NAME))
  })

  it('takes the whole directory from the env override', async () => {
    const root = await tempDir()
    const override = join(root, 'anywhere')
    vi.stubEnv(WORKBUDDY_DATA_DIR_ENV, override)
    // The override outranks discovery entirely: this is what a test or a
    // checkout harness pins, so it must not be combined with a profile path.
    expect(workbuddyPluginDataDir()).toBe(override)
    expect(workbuddyConfigDir()).toBe(join(override, WORKBUDDY_CONFIG_DIR_NAME))
    expect(workbuddyStateDir()).toBe(join(override, WORKBUDDY_STATE_DIR_NAME))
  })

  it('treats a blank override as unset', async () => {
    const root = await tempDir()
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv(WORKBUDDY_DATA_DIR_ENV, '   ')
    // A blank value must not resolve the data directory to the working
    // directory, which is what a naive `!== undefined` would do.
    expect(workbuddyPluginDataDir()).toBe(join(root, WORKBUDDY_DATA_DIR_NAME))
  })

  it('keeps the config and state layers apart, under one plugin directory', () => {
    // The split is the point: `state/` is safe to delete and `config/` is not.
    expect(workbuddyConfigDir()).not.toBe(workbuddyStateDir())
    expect(workbuddyConfigDir().startsWith(workbuddyPluginDataDir())).toBe(true)
    expect(workbuddyStateDir().startsWith(workbuddyPluginDataDir())).toBe(true)
  })
})
