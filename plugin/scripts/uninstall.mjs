#!/usr/bin/env node
/**
 * Uninstall dsh-remote from a DSH profile.
 *
 *   node plugin/scripts/uninstall.mjs              # dry run (the default)
 *   node plugin/scripts/uninstall.mjs --yes        # remove the files and the patch entry
 *   node plugin/scripts/uninstall.mjs --yes --keep-files   # only unregister the plugin
 *
 * Removes the managed insert entry from
 * <DSH_HOME>/profiles/<profile>/cordis.patch.yml (backed up to .bak first) and
 * deletes <DSH_HOME>/plugins/dsh-remote. Device tokens and pairing data live in
 * that directory, so removing it also un-pairs every phone.
 */
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { removeFromPatch, resolveHome } from "./install.mjs";

const FALLBACK_MARKER = "# dsh-remote: managed by plugin/scripts/install.mjs (LAN mobile access)";

/**
 * Plan the uninstall without touching disk.
 * @param {{home?: string, profile?: string, keepFiles?: boolean}} options
 */
export async function planUninstall(options) {
  const home = resolveHome(options?.home);
  const profile = options?.profile ?? "desktop";
  const targetDir = join(home, "plugins", "dsh-remote");
  const patchFile = join(home, "profiles", profile, "cordis.patch.yml");
  const backupFile = patchFile + ".bak";
  let patchBefore = "";
  let exists = true;
  try {
    patchBefore = await readFile(patchFile, "utf8");
  } catch {
    exists = false;
  }
  const removed = exists ? removeFromPatch(patchBefore) : { text: "", removed: false };
  return {
    home,
    profile,
    targetDir,
    patchFile,
    backupFile,
    patchExists: exists,
    patchBefore,
    patchAfter: removed.text,
    patchChanged: removed.removed,
    keepFiles: options?.keepFiles === true
  };
}

/**
 * Execute the uninstall plan.
 * @param {{home?: string, profile?: string, keepFiles?: boolean, dryRun?: boolean,
 *   quiet?: boolean}} options
 */
export async function uninstall(options) {
  const plan = await planUninstall(options);
  const dryRun = options?.dryRun ?? true;
  const log = options?.quiet === true ? () => {} : (line) => process.stdout.write(line + "\n");
  log("dsh-remote uninstall plan");
  log("  home:    " + plan.home);
  log("  profile: " + plan.profile);
  log("  patch:   " + (plan.patchExists ? (plan.patchChanged ? "remove the dsh-remote insert entry" : "no dsh-remote entry") : "not found"));
  log("  files:   " + (plan.keepFiles ? "kept (--keep-files)" : "delete " + plan.targetDir));
  if (dryRun) {
    log("");
    log("dry run: nothing written. Re-run with --yes to apply.");
    return { ...plan, applied: false };
  }
  if (plan.patchChanged) {
    await copyFile(plan.patchFile, plan.backupFile);
    await writeFile(plan.patchFile, plan.patchAfter, "utf8");
    log("  backup:  " + plan.backupFile);
  }
  if (!plan.keepFiles) {
    await rm(plan.targetDir, { recursive: true, force: true });
  }
  log("");
  log("uninstalled. restart DeepSeek Harness to drop the plugin.");
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
    } else if (argument === "--keep-files") {
      options.keepFiles = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error("unknown argument: " + argument);
    }
  }
  return options;
}

function printHelp() {
  process.stdout.write([
    "usage: node plugin/scripts/uninstall.mjs [options]",
    "",
    "  --yes, -y        apply changes (default is a dry run)",
    "  --dry-run        print the plan only (default)",
    "  --home <dir>     DSH home (default $DSH_HOME or ~/.dsh)",
    "  --profile <name> profile to patch (default desktop)",
    "  --keep-files     only remove the patch entry, keep devices.json and pairing data",
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
      await uninstall(options);
      process.exitCode = 0;
    }
  } catch (error) {
    process.stderr.write("dsh-remote uninstall failed: " + (error?.message ?? error) + "\n");
    process.exitCode = 1;
  }
}
