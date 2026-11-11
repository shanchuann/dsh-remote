import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatch, install, planInstall, removeFromPatch } from "../scripts/install.mjs";
import { uninstall } from "../scripts/uninstall.mjs";

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const FIXTURE_PATCH = [
  "# Your patch layer for this dsh profile, applied after every bundle layer:",
  "# a top-level YAML array of loader patch entries.",
  "- id: ui-chat",
  "  name: \"@deepseek-ai/dsh-client-ui-chat\"",
  "  config:",
  "    transcriptView: standard",
  "# keep this comment exactly as it is",
  "- insert:",
  "    - id: web-search-tavily",
  "      name: \"file:///C:/Users/x/.dsh/plugins/web-search-tavily.mjs\"",
  "      config:",
  "        apiKeyEnv: TAVILY_API_KEY",
  ""
].join("\n");

const INDEX_URL = "file:///C:/Users/x/.dsh/plugins/dsh-remote/src/index.mjs";

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function makeHome(t) {
  const home = await mkdtemp(join(tmpdir(), "dsh-remote-home-"));
  t.after(async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await rm(home, { recursive: true, force: true });
        return;
      } catch {
        if (attempt === 5) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  });
  return home;
}

test("applyPatch inserts one managed block and preserves every other line", () => {
  const result = applyPatch(FIXTURE_PATCH, { indexUrl: INDEX_URL, port: 8790 });
  assert.equal(result.action, "insert");
  assert.ok(result.text.startsWith(FIXTURE_PATCH.trimEnd()));
  assert.ok(result.text.includes("# dsh-remote: managed by plugin/scripts/install.mjs"));
  assert.ok(result.text.includes("    - id: dsh-remote"));
  assert.ok(result.text.includes("      name: \"file:///C:/Users/x/.dsh/plugins/dsh-remote/src/index.mjs\""));
  assert.ok(result.text.includes("        port: 8790"));
  assert.equal(result.text.match(/id: dsh-remote/g).length, 1);
  assert.ok(result.text.includes("- id: ui-chat"));
  assert.ok(result.text.includes("# keep this comment exactly as it is"));
  const lines = result.text.split("\n");
  assert.deepEqual(lines.slice(0, FIXTURE_PATCH.trimEnd().split("\n").length), FIXTURE_PATCH.trimEnd().split("\n"));
});

test("applyPatch is idempotent", () => {
  const first = applyPatch(FIXTURE_PATCH, { indexUrl: INDEX_URL, port: 8790 });
  const second = applyPatch(first.text, { indexUrl: INDEX_URL, port: 8790 });
  assert.equal(second.action, "unchanged");
  assert.equal(second.text, first.text);
});

test("applyPatch updates only the managed block when the port changes", () => {
  const first = applyPatch(FIXTURE_PATCH, { indexUrl: INDEX_URL, port: 8790 });
  const updated = applyPatch(first.text, { indexUrl: INDEX_URL, port: 8791 });
  assert.equal(updated.action, "update");
  assert.equal(updated.text.includes("port: 8790"), false);
  assert.ok(updated.text.includes("port: 8791"));
  assert.equal(updated.text.match(/id: dsh-remote/g).length, 1);
  assert.ok(updated.text.includes("- id: ui-chat"));
  assert.ok(updated.text.includes("apiKeyEnv: TAVILY_API_KEY"));
});

test("removeFromPatch restores the original patch", () => {
  const installed = applyPatch(FIXTURE_PATCH, { indexUrl: INDEX_URL, port: 8790 });
  const removed = removeFromPatch(installed.text);
  assert.equal(removed.removed, true);
  assert.equal(removed.text, FIXTURE_PATCH);
  assert.equal(removed.text.includes("dsh-remote"), false);
  const again = removeFromPatch(removed.text);
  assert.equal(again.removed, false);
  assert.equal(again.text, FIXTURE_PATCH);
});

test("removeFromPatch also handles a hand-added entry without the managed marker", () => {
  const handAdded = FIXTURE_PATCH.replace("- insert:", [
    "- insert:",
    "    - id: dsh-remote",
    "      name: \"file:///C:/plugins/dsh-remote/src/index.mjs\"",
    "      config:",
    "        port: 8790"
  ].join("\n"));
  const removed = removeFromPatch(handAdded);
  assert.equal(removed.removed, true);
  assert.equal(removed.text.includes("dsh-remote"), false);
  assert.ok(removed.text.includes("- id: ui-chat"));
  assert.ok(removed.text.includes("apiKeyEnv: TAVILY_API_KEY"));
});

test("install dry run writes nothing", async (t) => {
  const home = await makeHome(t);
  const result = await install({ home, sourceDir: PLUGIN_DIR, dryRun: true, quiet: true });
  assert.equal(result.applied, false);
  assert.equal(await exists(join(home, "plugins", "dsh-remote")), false);
  assert.equal(await exists(join(home, "profiles", "desktop", "cordis.patch.yml")), false);
  const plan = await planInstall({ home, sourceDir: PLUGIN_DIR });
  assert.ok(plan.files.some((file) => file === join("src", "index.mjs")));
  assert.equal(plan.files.some((file) => file.startsWith("test")), false);
  assert.equal(plan.files.some((file) => file.startsWith("node_modules")), false);
});

test("install copies the plugin, patches the profile, and is idempotent", async (t) => {
  const home = await makeHome(t);
  const profileDir = join(home, "profiles", "desktop");
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "cordis.patch.yml"), FIXTURE_PATCH, "utf8");

  const first = await install({ home, sourceDir: PLUGIN_DIR, dryRun: false, quiet: true });
  assert.equal(first.applied, true);
  assert.equal(first.patchAction, "insert");
  const target = join(home, "plugins", "dsh-remote");
  assert.equal(await exists(join(target, "src", "index.mjs")), true);
  assert.equal(await exists(join(target, "vendor", "qrcode", "qrcode.cjs")), true);
  assert.equal(await exists(join(target, "scripts", "install.mjs")), true);
  assert.equal(await exists(join(target, "test")), false);
  assert.equal(await exists(join(target, "node_modules")), false);

  const patched = await readFile(join(profileDir, "cordis.patch.yml"), "utf8");
  assert.ok(patched.includes("id: dsh-remote"));
  assert.ok(patched.includes("port: 8790"));
  assert.ok(patched.includes("plugins/dsh-remote/src/index.mjs"));
  assert.ok(patched.includes("# keep this comment exactly as it is"));
  const backup = await readFile(join(profileDir, "cordis.patch.yml.bak"), "utf8");
  assert.equal(backup, FIXTURE_PATCH);

  const second = await install({ home, sourceDir: PLUGIN_DIR, dryRun: false, quiet: true });
  assert.equal(second.patchAction, "unchanged");
  assert.equal(await readFile(join(profileDir, "cordis.patch.yml"), "utf8"), patched);
  assert.ok(second.changes.every((change) => change.action === "same"));
});

test("install creates a profile patch file when none exists", async (t) => {
  const home = await makeHome(t);
  await install({ home, sourceDir: PLUGIN_DIR, dryRun: false, quiet: true });
  const patchFile = join(home, "profiles", "desktop", "cordis.patch.yml");
  const text = await readFile(patchFile, "utf8");
  assert.ok(text.includes("id: dsh-remote"));
  assert.equal(await exists(patchFile + ".bak"), false);
});

test("install honors --port and --profile", async (t) => {
  const home = await makeHome(t);
  await install({ home, profile: "remote-dev", port: 8899, sourceDir: PLUGIN_DIR, dryRun: false, quiet: true });
  const text = await readFile(join(home, "profiles", "remote-dev", "cordis.patch.yml"), "utf8");
  assert.ok(text.includes("port: 8899"));
});

test("uninstall removes the patch entry and the plugin directory", async (t) => {
  const home = await makeHome(t);
  const profileDir = join(home, "profiles", "desktop");
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "cordis.patch.yml"), FIXTURE_PATCH, "utf8");
  await install({ home, sourceDir: PLUGIN_DIR, dryRun: false, quiet: true });

  const result = await uninstall({ home, dryRun: false, quiet: true });
  assert.equal(result.applied, true);
  assert.equal(await exists(join(home, "plugins", "dsh-remote")), false);
  assert.equal(await readFile(join(profileDir, "cordis.patch.yml"), "utf8"), FIXTURE_PATCH);
  assert.equal(await readFile(join(profileDir, "cordis.patch.yml.bak"), "utf8").then((text) => text.includes("dsh-remote")), true);

  const second = await uninstall({ home, dryRun: false, quiet: true });
  assert.equal(second.patchChanged, false);
});

test("uninstall dry run writes nothing and --keep-files preserves device data", async (t) => {
  const home = await makeHome(t);
  await install({ home, sourceDir: PLUGIN_DIR, dryRun: false, quiet: true });
  const target = join(home, "plugins", "dsh-remote");
  await writeFile(join(target, "devices.json"), "{}\n");

  const dry = await uninstall({ home, dryRun: true, quiet: true });
  assert.equal(dry.applied, false);
  assert.equal(await exists(join(target, "src", "index.mjs")), true);

  await uninstall({ home, dryRun: false, quiet: true, keepFiles: true });
  assert.equal(await exists(join(target, "devices.json")), true);
  const patch = await readFile(join(home, "profiles", "desktop", "cordis.patch.yml"), "utf8");
  assert.equal(patch.includes("id: dsh-remote"), false);
});
