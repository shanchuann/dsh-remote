import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pairingEndpoints } from "../src/pairing/files.mjs";
import { startHarness, pairDevice, request } from "./helpers/harness.mjs";

const ipv4 = (address) => [{ address, family: "IPv4", internal: false }];
const interfaces = {
  "vEthernet (WSL)": ipv4("10.0.0.1"),
  "Wi-Fi Direct": ipv4("192.168.0.1"),
  WLAN: ipv4("192.168.1.23"),
  "VMware Network Adapter": ipv4("192.168.80.1"),
  Tailscale: ipv4("100.80.1.2")
};

test("Tailscale is the QR target with a physical LAN fallback", () => {
  const endpoints = pairingEndpoints(8790, interfaces);
  assert.equal(endpoints.baseUrl, "http://100.80.1.2:8790");
  assert.equal(endpoints.altUrl, "http://192.168.1.23:8790");
  assert.equal(endpoints.tailscaleUrl, endpoints.baseUrl);
  assert.equal(pairingEndpoints(8790, { Tailscale: interfaces.Tailscale }).altUrl, undefined);
  assert.equal(pairingEndpoints(8790, { Tailscale: interfaces.Tailscale, "vEthernet (WSL)": interfaces["vEthernet (WSL)"] }).altUrl, undefined);
  assert.equal(pairingEndpoints(8790, { utun4: interfaces.Tailscale }).tailscaleUrl, endpoints.baseUrl);
});

test("ordinary CGNAT, internal, IPv6, and invalid Tailscale ranges are not advertised as Tailscale", () => {
  for (const other of [
    { WAN: ipv4("100.80.1.2") },
    { Tailscale: ipv4("100.128.1.2") },
    { Tailscale: [{ address: "100.80.1.2", family: "IPv4", internal: true }] },
    { Tailscale: [{ address: "fd7a:115c:a1e0::1", family: "IPv6", internal: false }] }
  ]) {
    const endpoints = pairingEndpoints(8790, { WLAN: interfaces.WLAN, ...other });
    assert.equal(endpoints.tailscaleUrl, null);
    assert.equal(endpoints.baseUrl, "http://192.168.1.23:8790");
  }
  assert.equal(pairingEndpoints(8790, {}).baseUrl, "http://127.0.0.1:8790");
});

test("runtime, settings, page and disk artifacts agree; legacy tunnel config cannot publish an endpoint", async (t) => {
  const harness = await startHarness({
    interfaces,
    config: { cloudflare: { enabled: true, mode: "named" }, publicUrl: "https://old.example.com" }
  });
  t.after(() => harness.close());
  const expected = "http://100.80.1.2:" + harness.port;
  const checkUri = (uri) => {
    const params = new URL(uri).searchParams;
    assert.equal(params.get("u"), expected);
    assert.equal(params.get("alt"), "http://192.168.1.23:" + harness.port);
    assert.equal(uri.includes("old.example.com"), false);
  };
  checkUri(harness.runtime.pairingUri());
  checkUri(harness.runtime.pairingArtifacts.uri);
  const state = harness.runtime.pairingState();
  assert.equal(state.tailscaleUrl, expected);
  assert.equal(state.addresses[0].url, expected);
  assert.equal(state.qrSvg.includes("<svg"), true);
  const descriptor = JSON.parse(await readFile(harness.runtime.paths.pairingJson, "utf8"));
  assert.equal(descriptor.tailscaleUrl, expected);
  assert.equal(descriptor.addresses[0], expected);
  assert.ok((await readFile(harness.runtime.paths.pairingTxt, "utf8")).includes("Tailscale: " + expected));
  const health = (await request(harness.baseUrl, "/v1/health")).body;
  assert.equal(health.tailscaleUrl, expected);
  assert.equal("publicUrl" in health, false);
  assert.equal("tunnel" in health, false);
  const device = await pairDevice(harness);
  const host = await request(harness.baseUrl, "/v1/host", { token: device.token });
  assert.equal(host.status, 200);
  assert.equal(host.body.tailscaleUrl, expected);
  const page = await request(harness.baseUrl, "/pair");
  assert.ok(page.text.includes(expected));
  assert.ok(page.text.includes("Tailscale 远程连接"));
  assert.equal(/Cloudflare|old\.example\.com/.test(page.text), false);
});

test("LAN-only hosts retain pairing and show setup guidance", async (t) => {
  const harness = await startHarness({ interfaces: { WLAN: interfaces.WLAN } });
  t.after(() => harness.close());
  assert.equal(harness.runtime.tailscaleUrl, null);
  const uri = new URL(harness.runtime.pairingUri());
  assert.equal(uri.searchParams.get("u"), "http://192.168.1.23:" + harness.port);
  assert.equal(uri.searchParams.has("alt"), false);
  await pairDevice(harness);
  const page = await request(harness.baseUrl, "/pair");
  assert.ok(page.text.includes("未检测到 Tailscale IPv4 地址"));
});
