#!/usr/bin/env node
/**
 * Print the current pairing information from the plugin data directory.
 *
 *   node plugin/scripts/pair-cli.mjs
 *   node plugin/scripts/pair-cli.mjs --json
 *   node plugin/scripts/pair-cli.mjs --home D:\\tmp\\dsh-home
 *
 * Reads <DSH_HOME>/plugins/dsh-remote/pairing.json, which the running plugin
 * rewrites whenever the code rotates. When the plugin has never started, the
 * file is missing and the CLI says so.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveHome } from "./install.mjs";

function formatRemaining(expiresAt, now) {
  const seconds = Math.max(0, Math.round((expiresAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes + "m" + String(rest).padStart(2, "0") + "s";
}

/**
 * @param {{home?: string, json?: boolean}} options
 * @returns {Promise<number>} process exit code
 */
export async function pairInfo(options) {
  const home = resolveHome(options?.home);
  const file = join(home, "plugins", "dsh-remote", "pairing.json");
  let raw;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    process.stderr.write(
      "dsh-remote: no pairing data at " + file + "\n" +
      "start DeepSeek Harness with the plugin installed, or check --home / $DSH_HOME.\n"
    );
    return 1;
  }
  let descriptor;
  try {
    descriptor = JSON.parse(raw);
  } catch (error) {
    process.stderr.write("dsh-remote: pairing.json is not valid JSON: " + error.message + "\n");
    return 1;
  }
  if (options?.json === true) {
    process.stdout.write(JSON.stringify(descriptor, null, 2) + "\n");
    return 0;
  }
  const now = Date.now();
  const addresses = Array.isArray(descriptor.addresses) && descriptor.addresses.length > 0
    ? descriptor.addresses
    : ["http://127.0.0.1:" + descriptor.port];
  const uri = "dshremote://pair?u=" + encodeURIComponent(addresses[0]) +
    "&c=" + encodeURIComponent(descriptor.pairingCode ?? "") +
    "&h=" + encodeURIComponent(descriptor.hostId ?? "") +
    "&n=" + encodeURIComponent(descriptor.hostName ?? "");
  process.stdout.write([
    "DSH Remote pairing / 配对信息",
    "  host:      " + (descriptor.hostName ?? "?") + " (" + (descriptor.hostId ?? "?") + ")",
    "  protocol:  " + (descriptor.protocol ?? "?"),
    "  address:   " + addresses[0],
    "  code:      " + (descriptor.pairingCode ?? "?"),
    "  expires:   " + (descriptor.pairingExpiresAt
      ? new Date(descriptor.pairingExpiresAt).toISOString() + " (in " + formatRemaining(descriptor.pairingExpiresAt, now) + ")"
      : "?"),
    "  uri:       " + uri,
    "  page:      http://127.0.0.1:" + (descriptor.port ?? "?") + "/pair  (host only)",
    ""
  ].join("\n"));
  return 0;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--home") {
      options.home = argv[++index];
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error("unknown argument: " + argument);
    }
  }
  return options;
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  {
    try {
      const options = parseArgs(process.argv.slice(2));
      if (options.help === true) {
        process.stdout.write("usage: node plugin/scripts/pair-cli.mjs [--json] [--home <dir>]\n");
        process.exitCode = 0;
      } else {
        process.exitCode = await pairInfo(options);
      }
    } catch (error) {
      process.stderr.write("dsh-remote pair-cli failed: " + (error?.message ?? error) + "\n");
      process.exitCode = 1;
    }
  }
}
