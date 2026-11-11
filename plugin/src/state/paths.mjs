/**
 * Filesystem layout for the dsh-remote plugin data.
 *
 * The harness home resolves exactly like @deepseek-ai/dsh-home-paths: an
 * explicit value wins, then $DSH_HOME, then ~/.dsh. This module deliberately
 * duplicates that tiny rule instead of importing the package: the plugin is
 * loaded by absolute file URL, where a bare specifier does not resolve.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Directory name of the default harness home under the OS home. */
export const DSH_HOME_DIR_NAME = ".dsh";

/** Plugins live under this child of the harness home. */
const PLUGINS_DIR_NAME = "plugins";

/** Directory name owned by this plugin inside the plugins directory. */
export const PLUGIN_DIR_NAME = "dsh-remote";

/** Absolute path of the shipped plugin directory (…/plugin). */
export const PLUGIN_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Expand only the bare and current-user tilde forms; anything else passes
 * through untouched (named-user forms are shell syntax, not ours to guess).
 * @param {string} value
 * @returns {string}
 */
export function expandHomePath(value) {
  if (typeof value !== "string" || value.length === 0 || value[0] !== "~") return value;
  if (value === "~") return homedir();
  const rest = value.slice(1);
  if (!rest.startsWith("/") && !rest.startsWith(String.fromCharCode(92))) return value;
  return join(homedir(), rest);
}

/**
 * Resolve the harness home: explicit override, $DSH_HOME, then ~/.dsh.
 * Blank values never count as configured.
 * @param {string|undefined} explicit
 * @param {Record<string,string|undefined>} [env]
 * @returns {string} absolute path
 */
export function resolveDshHome(explicit, env) {
  const environment = env ?? process.env;
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return resolve(expandHomePath(explicit.trim()));
  }
  const fromEnv = environment?.DSH_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return resolve(expandHomePath(fromEnv.trim()));
  }
  return resolve(homedir(), DSH_HOME_DIR_NAME);
}

/**
 * Every path this plugin writes, derived from the harness home.
 * @param {string} dshHome absolute harness home
 */
export function pluginDataPaths(dshHome) {
  return pluginDataPathsIn(join(dshHome, PLUGINS_DIR_NAME, PLUGIN_DIR_NAME));
}

/**
 * The same set of paths for an explicit data directory (tests and --data-dir).
 * @param {string} dir absolute data directory
 */
export function pluginDataPathsIn(dir) {
  return {
    dir,
    devices: join(dir, "devices.json"),
    host: join(dir, "host.json"),
    pairingJson: join(dir, "pairing.json"),
    pairingTxt: join(dir, "pairing.txt"),
    pairingSvg: join(dir, "pairing.svg"),
    pairingPng: join(dir, "pairing.png")
  };
}
