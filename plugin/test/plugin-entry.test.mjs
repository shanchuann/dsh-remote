import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as plugin from "../src/index.mjs";
import { createRemoteRuntime } from "../src/net/app.mjs";
import { createLogger, normalizeConfig, PROTOCOL_VERSION } from "../src/state/config.mjs";
import { resolveDshHome } from "../src/state/paths.mjs";
import { pairDevice, removeDir, startHarness } from "./helpers/harness.mjs";

test("plugin entry exports the Cordis contract", () => {
  assert.equal(plugin.name, "dsh-remote");
  assert.ok(Array.isArray(plugin.inject));
  assert.equal(typeof plugin.apply, "function");
  assert.equal(PROTOCOL_VERSION, 1);
});

test("config normalization applies defaults and rejects nonsense", () => {
  assert.deepEqual(normalizeConfig(undefined), {
    port: 8790,
    host: "0.0.0.0",
    pairingTtlMs: 600000,
    deviceTtlDays: 30,
    logLevel: "info",
    dshHome: undefined,
    dataDir: undefined
  });
  const configured = normalizeConfig({ port: "8791", host: "127.0.0.1", pairingTtlMs: 1000, deviceTtlDays: 1, logLevel: "warn", dshHome: "D:\\tmp\\home" });
  assert.equal(configured.port, 8791);
  assert.equal(configured.host, "127.0.0.1");
  assert.equal(configured.pairingTtlMs, 1000);
  assert.equal(configured.deviceTtlDays, 1);
  assert.equal(configured.logLevel, "warn");
  assert.equal(configured.dshHome, "D:\\tmp\\home");
  assert.equal(normalizeConfig({ logLevel: "loud" }).logLevel, "info");
  assert.throws(() => normalizeConfig({ port: 70000 }), /invalid config\.port/);
  assert.throws(() => normalizeConfig({ port: "abc" }), /invalid config\.port/);
  assert.throws(() => normalizeConfig({ deviceTtlDays: -1 }), /invalid config\.deviceTtlDays/);
  assert.equal(normalizeConfig({ port: 0 }).port, 0);
});

test("logger levels filter, and a missing logger is harmless", () => {
  const seen = [];
  const logger = createLogger({ info: (...args) => seen.push(["info", ...args]), warn: (...args) => seen.push(["warn", ...args]) }, "warn");
  logger.debug("ignored");
  logger.info("ignored too");
  logger.warn("kept");
  logger.error("mapped to warn");
  assert.deepEqual(seen, [["warn", "kept"], ["warn", "mapped to warn"]]);
  const silent = createLogger(undefined, "silent");
  silent.error("nothing happens");
});

test("DSH home resolution prefers explicit, then env, then ~/.dsh", () => {
  assert.equal(resolveDshHome("D:\\custom\\home", {}), resolve("D:\\custom\\home"));
  assert.equal(resolveDshHome(undefined, { DSH_HOME: "D:\\env\\home" }), resolve("D:\\env\\home"));
  assert.equal(resolveDshHome("  ", { DSH_HOME: "   " }).endsWith(".dsh"), true);
});

test("EADDRINUSE is reported clearly instead of crashing", async (t) => {
  const harness = await startHarness();
  const dataDir = await mkdtemp(join(tmpdir(), "dsh-remote-port-"));
  const messages = [];
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message) => messages.push(String(message))
  };
  const runtime = await createRemoteRuntime({
    rawConfig: { port: harness.port, dataDir, logLevel: "silent" },
    logger,
    interfaces: {}
  });
  try {
    await assert.rejects(runtime.start(), (error) => error?.code === "EADDRINUSE");
    assert.equal(runtime.listening, false);
    assert.ok(messages.some((message) => message.includes("already in use")), messages.join(" | "));
    assert.ok(messages.some((message) => message.includes("config.port")), messages.join(" | "));
  } finally {
    await harness.close();
    await runtime.stop();
    await removeDir(dataDir);
  }
});

test("mobileClientCount follows live SSE connections (drives hasMobileClients)", async () => {
  const harness = await startHarness();
  const { openSse, delay } = await import("./helpers/harness.mjs");
  try {
    const paired = await pairDevice(harness);
    assert.equal(harness.runtime.mobileClientCount(), 0);
    const sse = await openSse(harness.baseUrl, paired.token);
    try {
      await sse.waitFor("hello");
      assert.equal(harness.runtime.mobileClientCount(), 1);
    } finally {
      await sse.close();
    }
    for (let attempt = 0; attempt < 40 && harness.runtime.mobileClientCount() !== 0; attempt += 1) await delay(10);
    assert.equal(harness.runtime.mobileClientCount(), 0);
  } finally {
    await harness.close();
  }
});

test("stop is idempotent and releases subscriptions", async () => {
  const harness = await startHarness();
  const paired = await pairDevice(harness);
  const { request } = await import("./helpers/harness.mjs");
  const opened = await request(harness.baseUrl, "/v1/sessions/session-1/open", { method: "POST", token: paired.token, body: {} });
  assert.equal(opened.status, 200);
  assert.equal(harness.bridge.follows.size, 1);
  await harness.runtime.stop();
  assert.equal(harness.bridge.follows.size, 0);
  await harness.runtime.stop();
  await removeDir(harness.dataDir);
});