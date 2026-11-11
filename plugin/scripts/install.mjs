#!/usr/bin/env node
/**
 * Install dsh-remote into a DSH profile.
 *
 *   node plugin/scripts/install.mjs                 # dry run (the default)
 *   node plugin/scripts/install.mjs --yes           # copy files + patch the profile
 *   node plugin/scripts/install.mjs --yes --port 8791 --profile desktop
 *
 * Copies the plugin to <DSH_HOME>/plugins/dsh-remote (excluding tests and
 * node_modules) and idempotently adds one insert entry to
 * <DSH_HOME>/profiles/<profile>/cordis.patch.yml. The patch file is backed up
 * to cordis.patch.yml.bak before it is written, and no other line is touched.
 */
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXCLUDED_DIRECTORIES = new Set(["test", "node_modules", ".git", ".tmp-pack", "coverage"]);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PLUGIN_DIR = resolve(dirname(SCRIPT_PATH), "..");
const MANAGED_MARKER = "# dsh-remote: managed by plugin/scripts/install.mjs (LAN mobile access)";

/**
 * Resolve the harness home the same way the plugin does: explicit --home,
 * then $DSH_HOME, then ~/.dsh.
 * @param {string|undefined} explicit
 * @returns {string}
 */
export function resolveHome(explicit) {
  if (typeof explicit === "string" && explicit.trim().length > 0) return resolve(explicit.trim());
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return resolve(fromEnv.trim());
  return resolve(homedir(), ".dsh");
}

/** @param {string} line */
function indentOf(line) {
  const match = /^( *)/.exec(line);
  return match === null ? 0 : match[1].length;
}

/**
 * YAML block inserted for the plugin. A NEW row must live in an insert list:
 * top-level rows are id-targeted patches, not additions.
 * @param {string} indexUrl file:// URL of src/index.mjs
 * @param {number} port
 * @returns {string[]}
 */
export function buildInsertBlock(indexUrl, port) {
  return [
    MANAGED_MARKER,
    "- insert:",
    "    - id: dsh-remote",
    "      name: " + JSON.stringify(indexUrl),
    "      config:",
    "        port: " + String(port)
  ];
}

/**
 * Locate the managed block (or a hand-added dsh-remote row) in patch lines.
 * @param {string[]} lines
 * @returns {{start: number, end: number}|null}
 */
export function findManagedRange(lines) {
  const markerIndex = lines.findIndex((line) => line.trim() === MANAGED_MARKER);
  if (markerIndex !== -1) {
    let end = markerIndex + 1;
    // The managed block is: marker comment, one "- insert:" header (column 0),
    // then deeper-indented children. It ends at the next top-level line.
    if (end < lines.length && /^-\s+insert:\s*$/.test(lines[end].trim()) && indentOf(lines[end]) === 0) end += 1;
    while (end < lines.length) {
      const line = lines[end];
      if (line.trim().length > 0 && indentOf(line) === 0) break;
      end += 1;
    }
    while (end > markerIndex && lines[end - 1].trim().length === 0) end -= 1;
    return { start: markerIndex, end };
  }
  const itemIndex = lines.findIndex((line) => /^\s*-\s+id:\s*dsh-remote\s*$/.test(line));
  if (itemIndex === -1) return null;
  const itemIndent = indentOf(lines[itemIndex]);
  let end = itemIndex + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim().length > 0 && indentOf(line) <= itemIndent) break;
    end += 1;
  }
  while (end > itemIndex + 1 && lines[end - 1].trim().length === 0) end -= 1;
  return { start: itemIndex, end };
}

/**
 * Insert or replace the dsh-remote entry in the patch text.
 * @param {string} text
 * @param {{indexUrl: string, port: number}} options
 * @returns {{text: string, action: "insert"|"update"|"unchanged"}}
 */
export function applyPatch(text, options) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.length === 0 ? [] : normalized.replace(/\n$/, "").split("\n");
  const block = buildInsertBlock(options.indexUrl, options.port);
  const range = findManagedRange(lines);
  if (range !== null) {
    const existing = lines.slice(range.start, range.end).join("\n");
    if (existing === block.join("\n")) return { text: normalized, action: "unchanged" };
    const next = removeEmptyInsertHeaders([...lines.slice(0, range.start), ...lines.slice(range.end)]);
    while (next.length > 0 && next[next.length - 1].trim().length === 0) next.pop();
    if (next.length > 0) next.push("");
    next.push(...block);
    return { text: next.join("\n") + "\n", action: "update" };
  }
  const next = [...lines];
  if (next.length > 0) {
    while (next.length > 0 && next[next.length - 1].trim().length === 0) next.pop();
    next.push("");
  }
  next.push(...block);
  return { text: next.join("\n") + "\n", action: "insert" };
}

/**
 * Drop insert-list headers that no longer own any child, plus the managed
 * comment lines immediately above them.
 * @param {string[]} lines
 * @returns {string[]}
 */
export function removeEmptyInsertHeaders(lines) {
  const next = [...lines];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (!/^\s*-\s+insert:\s*$/.test(next[index])) continue;
    const headerIndent = indentOf(next[index]);
    let scan = index + 1;
    while (scan < next.length && next[scan].trim().length === 0) scan += 1;
    const hasChild = scan < next.length && indentOf(next[scan]) > headerIndent;
    if (hasChild) continue;
    let start = index;
    while (start > 0 && next[start - 1].trim().startsWith("#") && next[start - 1].includes("dsh-remote")) start -= 1;
    next.splice(start, index - start + 1);
    index = start;
  }
  return next;
}

/**
 * Remove the managed block from patch text (uninstall).
 * @param {string} text
 * @returns {{text: string, removed: boolean}}
 */
export function removeFromPatch(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.length === 0 ? [] : normalized.replace(/\n$/, "").split("\n");
  const range = findManagedRange(lines);
  if (range === null) return { text: normalized, removed: false };
  const next = removeEmptyInsertHeaders([...lines.slice(0, range.start), ...lines.slice(range.end)]);
  while (next.length > 1 && next[0].trim().length === 0) next.shift();
  while (next.length > 0 && next[next.length - 1].trim().length === 0) next.pop();
  return { text: next.join("\n") + "\n", removed: true };
}

/**
 * Recursively list files to copy, relative to the plugin directory.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function collectFiles(root) {
  /** @type {string[]} */
  const files = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
        await walk(absolute);
      } else if (entry.isFile()) {
        files.push(relative(root, absolute));
      }
    }
  }
  await walk(root);
  return files.sort();
}

/**
 * Compute the install plan without touching disk.
 * @param {{home?: string, profile?: string, port?: number, sourceDir?: string}} options
 */
export async function planInstall(options) {
  const home = resolveHome(options?.home);
  const profile = options?.profile ?? "desktop";
  const port = options?.port ?? 8790;
  const sourceDir = resolve(options?.sourceDir ?? PLUGIN_DIR);
  const targetDir = join(home, "plugins", "dsh-remote");
  const patchFile = join(home, "profiles", profile, "cordis.patch.yml");
  const files = await collectFiles(sourceDir);
  const sameDirectory = resolve(sourceDir) === resolve(targetDir);
  const changes = [];
  for (const rel of files) {
    const destination = join(targetDir, rel);
    let action = "add";
    try {
      const [sourceStat, destinationStat] = await Promise.all([stat(join(sourceDir, rel)), stat(destination)]);
      if (sourceStat.size === destinationStat.size) {
        const [sourceBytes, destinationBytes] = await Promise.all([readFile(join(sourceDir, rel)), readFile(destination)]);
        action = sourceBytes.equals(destinationBytes) ? "same" : "update";
      } else {
        action = "update";
      }
    } catch {
      action = "add";
    }
    changes.push({ path: rel, action, absolute: destination });
  }
  let patchBefore = "";
  try {
    patchBefore = await readFile(patchFile, "utf8");
  } catch {
    patchBefore = "";
  }
  const indexUrl = pathToFileURL(join(targetDir, "src", "index.mjs")).href;
  const patched = applyPatch(patchBefore, { indexUrl, port });
  return {
    home,
    profile,
    port,
    sourceDir,
    targetDir,
    patchFile,
    backupFile: patchFile + ".bak",
    files,
    changes,
    sameDirectory,
    patchAction: patched.action,
    patchBefore,
    patchAfter: patched.text,
    indexUrl
  };
}

/**
 * Execute the plan.
 * @param {{home?: string, profile?: string, port?: number, sourceDir?: string,
 *   dryRun?: boolean, quiet?: boolean}} options
 */
export async function install(options) {
  const plan = await planInstall(options);
  const dryRun = options?.dryRun ?? true;
  const log = options?.quiet === true ? () => {} : (line) => process.stdout.write(line + "\n");
  log("dsh-remote install plan");
  log("  home:    " + plan.home);
  log("  profile: " + plan.profile + "  (patch: " + plan.patchFile + ")");
  log("  target:  " + plan.targetDir + (plan.sameDirectory ? "  [source == target; files skipped]" : ""));
  if (!plan.sameDirectory) {
    const added = plan.changes.filter((change) => change.action === "add").length;
    const updated = plan.changes.filter((change) => change.action === "update").length;
    const same = plan.changes.filter((change) => change.action === "same").length;
    log("  files:   " + plan.files.length + " (" + added + " new, " + updated + " changed, " + same + " unchanged)");
    for (const change of plan.changes) {
      if (change.action !== "same") log("    " + change.action + "  " + change.path);
    }
  }
  log("  patch:   " + plan.patchAction + (plan.patchAction === "unchanged" ? " (already installed)" : ""));
  if (dryRun) {
    log("");
    log("dry run: nothing written. Re-run with --yes to apply.");
    return { ...plan, applied: false };
  }
  if (!plan.sameDirectory) {
    for (const change of plan.changes) {
      if (change.action === "same") continue;
      await mkdir(dirname(change.absolute), { recursive: true });
      await copyFile(join(plan.sourceDir, change.path), change.absolute);
    }
  }
  if (plan.patchAction !== "unchanged") {
    await mkdir(dirname(plan.patchFile), { recursive: true });
    if (plan.patchBefore.length > 0) await copyFile(plan.patchFile, plan.backupFile);
    await writeFile(plan.patchFile, plan.patchAfter, "utf8");
    log("  backup:  " + plan.backupFile);
  }
  log("");
  log("installed. restart DeepSeek Harness (or reload the plugin), then open:");
  log("  http://127.0.0.1:" + plan.port + "/pair");
  log("or run: node " + join(plan.targetDir, "scripts", "pair-cli.mjs"));
  return { ...plan, applied: true };
}

function parseArgs(argv) {
  const options = { dryRun: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--yes" || argument === "-y") {
      options.dryRun = false;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--home") {
      options.home = argv[++index];
    } else if (argument === "--profile") {
      options.profile = argv[++index];
    } else if (argument === "--port") {
      options.port = Number(argv[++index]);
    } else if (argument === "--source") {
      options.sourceDir = argv[++index];
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error("unknown argument: " + argument);
    }
  }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) {
    throw new Error("--port must be an integer between 0 and 65535");
  }
  return options;
}

function printHelp() {
  process.stdout.write([
    "usage: node plugin/scripts/install.mjs [options]",
    "",
    "  --yes, -y        apply changes (default is a dry run)",
    "  --dry-run        print the plan only (default)",
    "  --home <dir>     DSH home (default $DSH_HOME or ~/.dsh)",
    "  --profile <name> profile to patch (default desktop)",
    "  --port <n>       listen port written into the patch (default 8790)",
    "  --source <dir>   plugin directory to copy (default this plugin)",
    ""
  ].join("\n"));
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help === true) {
      printHelp();
      process.exitCode = 0;
    } else {
      await install(options);
      process.exitCode = 0;
    }
  } catch (error) {
    process.stderr.write("dsh-remote install failed: " + (error?.message ?? error) + "\n");
    process.exitCode = 1;
  }
}
