import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceStore } from "../src/auth/devices.mjs";
import { PairingManager } from "../src/auth/pairing.mjs";
import { createDeviceToken, createPairingCode, hashToken, safeEqualString } from "../src/auth/tokens.mjs";
import { removeDir } from "./helpers/harness.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

function codeSequence(codes) {
  let index = 0;
  return () => {
    const code = codes[Math.min(index, codes.length - 1)];
    index += 1;
    return code;
  };
}

test("pairing code is six digits and rotates on success", () => {
  let clock = 1000;
  const manager = new PairingManager({
    ttlMs: 600000,
    now: () => clock,
    codeFactory: codeSequence(["111111", "222222"])
  });
  assert.equal(manager.snapshot().code, "");
  manager.rotate();
  assert.equal(manager.snapshot().code, "111111");
  assert.equal(manager.verify("111111").ok, true);
  assert.equal(manager.snapshot().code, "222222");
  assert.equal(manager.snapshot().failedAttempts, 0);
});

test("five consecutive failures lock pairing for the cooldown", () => {
  let clock = 0;
  const manager = new PairingManager({
    ttlMs: 600000,
    now: () => clock,
    codeFactory: codeSequence(["123456"])
  });
  manager.rotate();
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const verdict = manager.verify("000000");
    assert.equal(verdict.ok, false);
    assert.equal(verdict.code, "pairing-invalid");
    assert.equal(verdict.remainingAttempts, 5 - attempt);
  }
  const locked = manager.verify("000000");
  assert.equal(locked.ok, false);
  assert.equal(locked.code, "pairing-locked");
  assert.equal(locked.status, 429);
  assert.ok(locked.retryAfterMs > 0);
  // Even the right code is refused while locked.
  const whileLocked = manager.verify("123456");
  assert.equal(whileLocked.ok, false);
  assert.equal(whileLocked.code, "pairing-locked");
  // The cooldown expires after five minutes and the right code works again.
  clock += 5 * 60 * 1000 + 1;
  assert.equal(manager.verify("123456").ok, true);
});

test("expired pairing codes are rejected and ensureFresh rotates them", () => {
  let clock = 0;
  const manager = new PairingManager({
    ttlMs: 1000,
    now: () => clock,
    codeFactory: codeSequence(["444444", "555555"])
  });
  manager.rotate();
  clock = 1001;
  const verdict = manager.verify("444444");
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "pairing-invalid");
  assert.match(verdict.message, /expired/);
  assert.equal(manager.ensureFresh(), true);
  assert.equal(manager.snapshot().code, "555555");
  assert.equal(manager.ensureFresh(), false);
});

test("pairing code generation is 6 numeric characters", () => {
  for (let index = 0; index < 200; index += 1) {
    assert.match(createPairingCode(), /^[0-9]{6}$/);
  }
});

test("token helpers: 64 hex chars, stable SHA-256, constant-time compare", () => {
  const token = createDeviceToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.match(hashToken(token), /^[0-9a-f]{64}$/);
  assert.equal(hashToken(token), hashToken(token));
  assert.notEqual(hashToken(token), hashToken(createDeviceToken()));
  assert.equal(safeEqualString(token, token), true);
  // Deterministically differ in the last character (appending "0" would be a
  // no-op whenever the token already ends in "0", which made this test flaky).
  const differing = token.slice(0, -1) + (token.endsWith("0") ? "1" : "0");
  assert.notEqual(differing, token);
  assert.equal(safeEqualString(token, differing), false);
  assert.equal(safeEqualString(token, "short"), false);
});

test("device registry persists only token digests and supports revoke", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-remote-devices-"));
  t.after(() => removeDir(dir));
  const file = join(dir, "devices.json");
  const store = new DeviceStore({ filePath: file, now: () => 5000, persistThrottleMs: 0 });
  await store.load();
  assert.equal(store.pairingRequired, true);

  const paired = await store.pair({ name: "Pixel 9", platform: "android", appVersion: "0.1.0" });
  assert.equal(store.pairingRequired, false);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].name, "Pixel 9");
  const raw = await readFile(file, "utf8");
  assert.equal(raw.includes(paired.token), false, "plaintext token must never be stored");
  assert.ok(raw.includes(hashToken(paired.token)));

  assert.equal(store.authenticate(paired.token)?.deviceId, paired.device.deviceId);
  assert.equal(store.authenticate(createDeviceToken()), null);
  assert.equal(store.authenticate("not-a-token"), null);

  assert.equal(await store.revoke(paired.device.deviceId), true);
  assert.equal(store.authenticate(paired.token), null);
  assert.equal(await store.revoke(paired.device.deviceId), false);
  await store.flush();
});

test("expired devices stop authenticating after deviceTtlDays", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-remote-devices-"));
  t.after(() => removeDir(dir));
  let clock = 1000;
  const store = new DeviceStore({ filePath: join(dir, "devices.json"), deviceTtlDays: 1, now: () => clock, persistThrottleMs: 0 });
  await store.load();
  const paired = await store.pair({ name: "old phone", platform: "android" });
  assert.equal(store.authenticate(paired.token)?.deviceId, paired.device.deviceId);
  clock += 2 * DAY_MS;
  assert.equal(store.authenticate(paired.token), null);
  assert.equal(store.size, 0);
  await store.flush();
});

test("pairing a known deviceId keeps its createdAt and rotates the token", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-remote-devices-"));
  t.after(() => removeDir(dir));
  const store = new DeviceStore({ filePath: join(dir, "devices.json"), now: () => 1000, persistThrottleMs: 0 });
  await store.load();
  const first = await store.pair({ deviceId: "device-1", name: "Pixel", platform: "android" });
  const second = await store.pair({ deviceId: "device-1", name: "Pixel 2", platform: "android" });
  assert.equal(store.size, 1);
  assert.equal(second.device.createdAt, first.device.createdAt);
  assert.equal(store.authenticate(first.token), null);
  assert.equal(store.authenticate(second.token)?.name, "Pixel 2");
  await store.flush();
});
