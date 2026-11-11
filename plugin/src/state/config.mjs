/**
 * Plugin configuration: a plain object passed straight through the Cordis
 * patch layer. No Config schema is declared, so cordis hands us the patch
 * config untouched; unknown keys are ignored rather than fatal.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Wire protocol version implemented by this plugin (docs/protocol.md v1). */
export const PROTOCOL_VERSION = 1;

/** Default TCP port for the LAN listener. */
export const DEFAULT_PORT = 8790;

const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"];

/** Runtime configuration defaults. */
export const DEFAULT_CONFIG = Object.freeze({
  port: DEFAULT_PORT,
  host: "0.0.0.0",
  pairingTtlMs: 10 * 60 * 1000,
  deviceTtlDays: 30,
  logLevel: "info"
});

function parsePort(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_PORT;
  const port = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(
      "dsh-remote: invalid config.port " + JSON.stringify(value) +
      " (expected an integer 0-65535; 0 picks a random free port)"
    );
  }
  return port;
}

function parsePositive(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("dsh-remote: invalid config." + name + " " + JSON.stringify(value) + " (expected a positive number)");
  }
  return number;
}

function optionalString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Normalize the raw patch config into the runtime shape. Invalid values throw
 * a descriptive error; the caller logs it and disables the plugin instead of
 * crashing the host process.
 * @param {Record<string, unknown>|undefined} raw
 * @returns {{port:number, host:string, pairingTtlMs:number, deviceTtlDays:number,
 *   logLevel:"debug"|"info"|"warn"|"error"|"silent", dshHome:string|undefined,
 *   dataDir:string|undefined}}
 */
/**
 * Normalize `config.cloudflare`: `true` means a quick tunnel; an object may
 * select `quick` (random trycloudflare.com URL) or `named` (token + hostname).
 * @param {unknown} raw
 * @returns {{enabled:boolean, mode:"quick"|"named", token?:string, hostname?:string, binPath?:string}|null}
 */
export function normalizeCloudflare(raw) {
  if (raw === undefined || raw === null || raw === false) return null;
  if (raw === true) return { enabled: true, mode: "quick" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("dsh-remote: invalid config.cloudflare (expected true or an object)");
  }
  const mode = optionalString(raw.mode) ?? "quick";
  if (mode !== "quick" && mode !== "named") {
    throw new Error("dsh-remote: config.cloudflare.mode must be \"quick\" or \"named\"");
  }
  const token = optionalString(raw.token);
  const hostname = optionalString(raw.hostname);
  if (mode === "named") {
    if (token === undefined) throw new Error("dsh-remote: config.cloudflare.token is required for named mode");
    if (hostname === undefined) throw new Error("dsh-remote: config.cloudflare.hostname is required for named mode");
  }
  return {
    enabled: raw.enabled !== false,
    mode,
    ...(token === undefined ? {} : { token }),
    ...(hostname === undefined ? {} : { hostname }),
    ...(optionalString(raw.binPath) === undefined ? {} : { binPath: optionalString(raw.binPath) })
  };
}

/** A static external root (Caddy/Cloudflare named tunnel/Nginx), if configured. */
function parsePublicUrl(value) {
  const text = optionalString(value);
  if (text === undefined) return undefined;
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error("dsh-remote: invalid config.publicUrl " + JSON.stringify(text)); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("dsh-remote: config.publicUrl must be http(s)");
  }
  return text.replace(/\/+$/, "");
}

export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === "object" ? raw : {};
  const host = optionalString(source.host) ?? DEFAULT_CONFIG.host;
  const requestedLevel = optionalString(source.logLevel);
  const logLevel = LOG_LEVELS.includes(requestedLevel) ? requestedLevel : DEFAULT_CONFIG.logLevel;
  return {
    port: parsePort(source.port),
    host,
    pairingTtlMs: parsePositive(source.pairingTtlMs, DEFAULT_CONFIG.pairingTtlMs, "pairingTtlMs"),
    deviceTtlDays: parsePositive(source.deviceTtlDays, DEFAULT_CONFIG.deviceTtlDays, "deviceTtlDays"),
    logLevel,
    dshHome: optionalString(source.dshHome),
    dataDir: optionalString(source.dataDir),
    publicUrl: parsePublicUrl(source.publicUrl),
    cloudflare: normalizeCloudflare(source.cloudflare),
    uiEntry: source.uiEntry !== false
  };
}

/**
 * Build a leveled logger on top of the Cordis logger. Never throws: a missing
 * or partial logger degrades to a no-op.
 * @param {{debug?: Function, info?: Function, warn?: Function, error?: Function}|undefined} base
 * @param {"debug"|"info"|"warn"|"error"|"silent"} level
 */
export function createLogger(base, level) {
  const names = /** @type {const} */ (["debug", "info", "warn", "error"]);
  const threshold = level === "silent" ? names.length : names.indexOf(level);
  const sink = {
    debug: base?.debug ?? base?.info,
    info: base?.info,
    warn: base?.warn ?? base?.info,
    error: base?.error ?? base?.warn ?? base?.info
  };
  const make = (wanted) => (...args) => {
    const rank = names.indexOf(wanted);
    if (rank < threshold) return;
    try {
      const fn = sink[wanted];
      if (typeof fn === "function") fn.apply(base, args);
    } catch {
      // Logging must never break a request or the listener.
    }
  };
  return {
    level,
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error")
  };
}

/**
 * Read the version out of the plugin package.json next to the source tree.
 * @param {string} pluginRoot absolute plugin directory
 * @returns {Promise<string>}
 */
export async function readPluginVersion(pluginRoot) {
  try {
    const text = await readFile(join(pluginRoot, "package.json"), "utf8");
    const parsed = JSON.parse(text);
    if (typeof parsed?.version === "string" && parsed.version.length > 0) return parsed.version;
  } catch {
    // Fall through to the compile-time default.
  }
  return "0.1.0";
}