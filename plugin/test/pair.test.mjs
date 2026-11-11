import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hashToken } from "../src/auth/tokens.mjs";
import { pairDevice, request, startHarness } from "./helpers/harness.mjs";
import { PLUGIN_VERSION } from "./helpers/plugin-version.mjs";

async function withHarness(body) {
  const harness = await startHarness();
  try {
    return await body(harness);
  } finally {
    await harness.close();
  }
}

test("POST /v1/pair returns a 64-hex token and a host block", async () => {
  await withHarness(async (harness) => {
    const response = await request(harness.baseUrl, "/v1/pair", {
      method: "POST",
      body: { code: harness.runtime.pairing.snapshot().code, deviceName: "Pixel 9", platform: "android", appVersion: "0.1.0" }
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.protocol, 1);
    assert.match(response.body.token, /^[0-9a-f]{64}$/);
    assert.match(response.body.deviceId, /^[0-9a-f-]{36}$/);
    assert.equal(response.body.host.id, harness.runtime.hostState.hostId);
    assert.equal(response.body.host.platform, "win32");
    assert.equal(response.body.host.dshVersion, "0.2.2-rc.1");
    assert.equal(response.body.host.pluginVersion, PLUGIN_VERSION);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("pairing requires the code and rejects a wrong one", async () => {
  await withHarness(async (harness) => {
    const missing = await request(harness.baseUrl, "/v1/pair", { method: "POST", body: {} });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, "invalid-argument");

    const wrongCode = harness.runtime.pairing.snapshot().code === "000000" ? "111111" : "000000";
    const wrong = await request(harness.baseUrl, "/v1/pair", { method: "POST", body: { code: wrongCode } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, "pairing-invalid");
  });
});

test("five failed attempts lock pairing with 429 pairing-locked", async () => {
  await withHarness(async (harness) => {
    const code = harness.runtime.pairing.snapshot().code;
    const wrongCode = code === "000000" ? "111111" : "000000";
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const failure = await request(harness.baseUrl, "/v1/pair", { method: "POST", body: { code: wrongCode } });
      assert.equal(failure.status, 401);
      assert.equal(failure.body.error.code, "pairing-invalid");
    }
    const locked = await request(harness.baseUrl, "/v1/pair", { method: "POST", body: { code: wrongCode } });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, "pairing-locked");
    assert.ok(Number(locked.headers.get("retry-after")) > 0);
    const correctWhileLocked = await request(harness.baseUrl, "/v1/pair", { method: "POST", body: { code } });
    assert.equal(correctWhileLocked.status, 429);
    assert.equal(correctWhileLocked.body.error.code, "pairing-locked");
  });
});

test("a successful pairing rotates the code", async () => {
  await withHarness(async (harness) => {
    const previousCode = harness.runtime.pairing.snapshot().code;
    await pairDevice(harness);
    const rotated = harness.runtime.pairing.snapshot().code;
    assert.notEqual(rotated, previousCode);
    const reused = await request(harness.baseUrl, "/v1/pair", { method: "POST", body: { code: previousCode } });
    assert.equal(reused.status, 401);
    assert.equal(reused.body.error.code, "pairing-invalid");
    const fresh = await request(harness.baseUrl, "/v1/pair", { method: "POST", body: { code: rotated } });
    assert.equal(fresh.status, 200);
  });
});

test("devices.json stores the digest, never the token", async () => {
  await withHarness(async (harness) => {
    const paired = await pairDevice(harness);
    const raw = await readFile(join(harness.dataDir, "devices.json"), "utf8");
    assert.equal(raw.includes(paired.token), false);
    assert.ok(raw.includes(hashToken(paired.token)));
    assert.ok(raw.includes(paired.deviceId));
    const file = JSON.parse(raw);
    assert.equal(file.devices.length, 1);
    assert.equal(file.devices[0].name, "Pixel 9");
    assert.ok(raw.length > 0 && raw.endsWith("\n"));
  });
});

test("pairing writes pairing.json/txt/svg/png without a token", async () => {
  await withHarness(async ({ dataDir, runtime }) => {
    const descriptor = JSON.parse(await readFile(join(dataDir, "pairing.json"), "utf8"));
    assert.equal(descriptor.hostId, runtime.hostState.hostId);
    assert.equal(descriptor.protocol, 1);
    assert.equal(descriptor.port, runtime.port);
    assert.match(descriptor.pairingCode, /^[0-9]{6}$/);
    assert.ok(descriptor.pairingExpiresAt > Date.now());
    assert.ok(Array.isArray(descriptor.addresses) && descriptor.addresses.length > 0);
    assert.equal("token" in descriptor, false);
    assert.equal("devices" in descriptor, false);
    const text = await readFile(join(dataDir, "pairing.txt"), "utf8");
    assert.ok(text.includes(descriptor.pairingCode));
    assert.ok(text.includes("dshremote://pair?"));
    const png = await readFile(join(dataDir, "pairing.png"));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const svg = await readFile(join(dataDir, "pairing.svg"), "utf8");
    assert.ok(svg.includes("<svg"));
  });
});