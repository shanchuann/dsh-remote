import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { escapeHtml, renderPairingPage } from "../src/pairing/page.mjs";
import { isLoopbackAddress } from "../src/net/http-util.mjs";
import { pairDevice, request, startHarness } from "./helpers/harness.mjs";

function pageFixture(overrides) {
  const now = Date.now();
  return {
    hostName: "DESKTOP-XXX",
    hostId: "11111111-2222-3333-4444-555555555555",
    port: 8790,
    protocol: 1,
    pluginVersion: "0.1.0",
    pairing: { code: "123456", expiresAt: now + 300000, failedAttempts: 0, lockedUntil: null },
    qrSvg: '<svg data-test="qr"></svg>',
    addresses: [{ url: "http://192.168.1.23:8790", name: "Wi-Fi" }],
    devices: [{ deviceId: "d1", name: "Pixel 9", platform: "android", createdAt: now - 1000, lastSeenAt: now }],
    now,
    ...overrides
  };
}

test("escapeHtml neutralizes markup", () => {
  assert.equal(escapeHtml("<b a=\"1\">&'</b>"), "&lt;b a=&quot;1&quot;&gt;&amp;&#39;&lt;/b&gt;");
});

test("pairing page renders bilingual copy, QR, code, expiry, and devices", () => {
  const html = renderPairingPage(pageFixture());
  assert.ok(html.startsWith("<!doctype html>"));
  assert.match(html, /配对码 \/ Pair code/);
  assert.match(html, /已配对设备 \/ Paired devices/);
  assert.match(html, /123456/);
  assert.ok(html.includes('<svg data-test="qr"></svg>'));
  assert.ok(html.includes("192.168.1.23:8790"));
  assert.ok(html.includes("Pixel 9"));
  assert.match(html, /protocol 1 · plugin 0\.1\.0/);
  assert.equal(html.includes("临时锁定"), false);
});

test("pairing page states empty devices and shows a lock banner", () => {
  const now = Date.now();
  const html = renderPairingPage(pageFixture({ devices: [], pairing: { code: "654321", expiresAt: now + 1000, failedAttempts: 5, lockedUntil: now + 60000 }, now }));
  assert.ok(html.includes("暂无已配对设备"));
  assert.ok(html.includes("临时锁定"));
});

test("pairing page escapes a hostile device name", () => {
  const html = renderPairingPage(pageFixture({ devices: [{ deviceId: "x", name: '<img src=x onerror="alert(1)">', platform: "android", createdAt: 1, lastSeenAt: 2 }] }));
  assert.equal(html.includes("<img src=x"), false);
  assert.ok(html.includes("&lt;img src=x"));
});

test("GET /pair serves HTML to loopback only, with hardened headers", async () => {
  const harness = await startHarness();
  try {
    const response = await request(harness.baseUrl, "/pair");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html; charset=utf-8/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.ok(response.text.includes(harness.runtime.pairing.snapshot().code));
    assert.ok(response.text.includes("dshremote://pair?") === false, "the page shows the QR, not the raw URI");
  } finally {
    await harness.close();
  }
});

function firstLanAddress() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      const family = entry.family;
      if (family === "IPv4" || family === 4) return entry.address;
    }
  }
  return null;
}

test("GET /pair is refused for non-loopback clients", async (t) => {
  const harness = await startHarness();
  try {
    const lan = firstLanAddress();
    if (lan === null) {
      t.skip("no non-internal IPv4 address to probe");
      return;
    }
    let response;
    try {
      response = await fetch("http://" + lan + ":" + harness.port + "/pair");
    } catch {
      t.skip("the host firewall blocked the LAN probe");
      return;
    }
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error.code, "unauthorized");
  } finally {
    await harness.close();
  }
});

test("isLoopbackAddress recognizes every loopback spelling and nothing else", () => {
  for (const address of ["127.0.0.1", "127.1.2.3", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1"]) {
    assert.equal(isLoopbackAddress(address), true, address);
  }
  for (const address of ["192.168.1.5", "::ffff:192.168.1.5", "10.0.0.1", "", undefined]) {
    assert.equal(isLoopbackAddress(address), false, String(address));
  }
});

test("the pairing page reflects a rotated code after pairing", async () => {
  const harness = await startHarness();
  try {
    const first = await request(harness.baseUrl, "/pair");
    const firstCode = harness.runtime.pairing.snapshot().code;
    assert.ok(first.text.includes(firstCode));
    await pairDevice(harness);
    const second = await request(harness.baseUrl, "/pair");
    const rotatedCode = harness.runtime.pairing.snapshot().code;
    assert.notEqual(rotatedCode, firstCode);
    assert.ok(second.text.includes(rotatedCode));
    const persisted = JSON.parse(await readFile(join(harness.dataDir, "pairing.json"), "utf8"));
    assert.equal(persisted.pairingCode, rotatedCode);
  } finally {
    await harness.close();
  }
});
