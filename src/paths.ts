/**
 * The plugin's data directory — the ONE place every file this plugin owns
 * lives.
 *
 * Layout: `<profile>/.dsh-workbuddy-connect-functy/`, split in two:
 *
 *   config/  what the user decided — credentials, the account pool, the
 *            context-length and model-visibility preferences.
 *   state/   what the plugin can rebuild — the saved catalogs, probe records,
 *            request tallies, the host heartbeat, the App-version caches.
 *
 * Per profile rather than per harness home, because the plugin is installed into
 * each profile separately and two profiles may be signed in as different
 * accounts: a `web` profile and a `desktop` profile writing one account pool
 * would silently rotate each other's accounts. (The stores have no cross-process
 * lock — see `store-file.ts` — so sharing a file between two hosts was never
 * safe regardless.)
 *
 * The directory is discovered from the profile's OWN manifest, not from this
 * module's location: DSH installs a plugin into a profile by *link*, so the
 * manifest carries `"dsh-workbuddy-connect-functy": "link:/path/to/checkout"`
 * while Node resolves the module to that real path, which lies outside
 * `$DSH_HOME` entirely. Walking up from the module would therefore miss the
 * profile for exactly the install shape a developer uses.
 *
 * Fallbacks, in order: `DSH_WORKBUDDY_DATA_DIR` → the discovered profile → the
 * Harness home (a checkout running its own tests, or a host loading the plugin
 * from outside any profile). `DSH_WORKBUDDY_DATA_DIR` is an explicit override of
 * the whole directory, which is what the tests use.
 *
 * Split out of `auth.ts` so the catalog/probe/heartbeat stores can import the
 * directory without pulling in the credential code and its upstream client.
 *
 * @module dsh-workbuddy-connect/paths
 */

import { readFileSync, readdirSync, realpathSync, type Dirent } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** This plugin's own directory under a profile. */
export const WORKBUDDY_DATA_DIR_NAME = '.dsh-workbuddy-connect-functy'

/** What the user decided: credentials, the pool, the preferences. */
export const WORKBUDDY_CONFIG_DIR_NAME = 'config'

/** What the plugin can rebuild: caches, records, tallies, the heartbeat. */
export const WORKBUDDY_STATE_DIR_NAME = 'state'

/** Environment override for the whole data directory. */
export const WORKBUDDY_DATA_DIR_ENV = 'DSH_WORKBUDDY_DATA_DIR'

const PROFILES_DIR_NAME = 'profiles'

/** The npm name of this package, as a profile's manifest declares it. */
const PLUGIN_PACKAGE_NAME = 'dsh-workbuddy-connect-functy'

/** This package's root directory, or `undefined` when it is not on disk. */
function pluginPackageRoot(): string | undefined {
  try {
    // `<root>/lib/paths.js` in a build, `<root>/src/paths.ts` from source.
    return dirname(dirname(fileURLToPath(import.meta.url)))
  } catch {
    // Not loaded from a file URL (a bundled or synthetic module).
    return undefined
  }
}

/** Whether a profile directory declares this plugin. */
function profileDeclaresPlugin(profileDir: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
    }
    return typeof manifest.dependencies?.[PLUGIN_PACKAGE_NAME] === 'string'
      || typeof manifest.devDependencies?.[PLUGIN_PACKAGE_NAME] === 'string'
  } catch {
    // Not a profile, or unreadable: it simply is not a candidate.
    return false
  }
}

/**
 * Whether a profile's installed copy of this plugin resolves to this package.
 *
 * This is what separates two profiles that both declare the plugin — a `web` and
 * a `desktop` profile can each list it — so the data directory follows the
 * profile whose copy is actually running rather than the first one found.
 */
function profileLinksToThisPackage(profileDir: string): boolean {
  const own = pluginPackageRoot()
  if (own === undefined) return false
  try {
    return realpathSync(join(profileDir, 'node_modules', PLUGIN_PACKAGE_NAME)) === realpathSync(own)
  } catch {
    // No installed copy, or an unreadable link.
    return false
  }
}

/**
 * The profile directory this plugin belongs to, or `undefined` when none can be
 * determined.
 *
 * A single declaring profile is accepted without the link test, so a normal
 * (non-linked) install still resolves.
 */
function discoverProfileDir(): string | undefined {
  const profilesRoot = join(resolveDshHome(), PROFILES_DIR_NAME)
  let entries: Dirent[]
  try {
    entries = readdirSync(profilesRoot, { withFileTypes: true })
  } catch {
    // No profiles directory at all: nothing to discover.
    return undefined
  }
  const candidates: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const dir = join(profilesRoot, entry.name)
    if (profileDeclaresPlugin(dir)) candidates.push(dir)
  }
  if (candidates.length === 0) return undefined
  const only = candidates[0]
  if (candidates.length === 1 && only !== undefined) return only
  return candidates.find(candidate => profileLinksToThisPackage(candidate))
}

/**
 * The plugin's data directory: `<profile>/.dsh-workbuddy-connect-functy`.
 *
 * Falls back to the Harness home when no profile can be discovered, so the
 * plugin always has somewhere to write, and `DSH_WORKBUDDY_DATA_DIR` overrides
 * either way.
 */
export function workbuddyPluginDataDir(): string {
  const override = process.env[WORKBUDDY_DATA_DIR_ENV]
  if (override !== undefined && override.trim() !== '') return override
  const base = discoverProfileDir() ?? resolveDshHome()
  return join(base, WORKBUDDY_DATA_DIR_NAME)
}

/** The decision layer: `<data dir>/config/`. */
export function workbuddyConfigDir(): string {
  return join(workbuddyPluginDataDir(), WORKBUDDY_CONFIG_DIR_NAME)
}

/**
 * The rebuildable layer: `<data dir>/state/`.
 *
 * Nothing here is load-bearing for a session: every file in it can be deleted
 * and regenerated (a catalog re-fetched, a tally restarted, a heartbeat
 * rewritten), which is the property that makes it safe to clear.
 */
export function workbuddyStateDir(): string {
  return join(workbuddyPluginDataDir(), WORKBUDDY_STATE_DIR_NAME)
}
