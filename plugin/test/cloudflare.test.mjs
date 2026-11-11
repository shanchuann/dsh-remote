import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { CloudflareTunnel, parseQuickTunnelUrl } from "../src/net/cloudflare.mjs";
import { normalizeCloudflare, normalizeConfig } from "../src/state/config.mjs";
import { renderPairingPage } from "../src/pairing/page.mjs";

test("parseQuickTunnelUrl finds a trycloudflare URL in cloudflared output", () => {
  const banner = "2026-11-12T00:00:00Z INF |  https://dsh-remote.trycloudflare.com  |";
  assert.equal(parseQuickTunnelUrl(banner), "https://dsh-remote.trycloudflare.com");
  assert.equal(parseQuickTunnelUrl("https://dsh-remote.trycloudflare.com/"), "https://dsh-remote.trycloudflare.com");
  assert.equal(parseQuickTunnelUrl("no url here"), undefined);
  assert.equal(parseQuickTunnelUrl(undefined), undefined);
});

test("normalizeCloudflare accepts true/quick/named and rejects invalid named", () => {
  assert.deepEqual(normalizeCloudflare(undefined), null);
  assert.deepEqual(normalizeCloudflare(false), null);
  assert.deepEqual(normalizeCloudflare(true), { enabled: true, mode: "quick" });
  assert.deepEqual(normalizeCloudflare({ mode: "quick", binPath: "C:\\bin\\cloudflared.exe", enabled: false }), {
    enabled: false,
    mode: "quick",
    binPath: "C:\\bin\\cloudflared.exe"
  });
  assert.throws(() => normalizeCloudflare({ mode: "named" }), /token is required/);
  assert.throws(() => normalizeCloudflare({ mode: "tunnel" }), /must be/);
  const named = normalizeCloudflare({ mode: "named", token: "t", hostname: "dsh.example.com" });
  assert.deepEqual(named, { enabled: true, mode: "named", token: "t", hostname: "dsh.example.com" });
});

test("normalizeConfig parses publicUrl and cloudflare", () => {
  const config = normalizeConfig({ publicUrl: "https://dsh.example.com/", cloudflare: true });
  assert.equal(config.publicUrl, "https://dsh.example.com");
  assert.deepEqual(config.cloudflare, { enabled: true, mode: "quick" });
  assert.equal(config.uiEntry, true);
  assert.throws(() => normalizeConfig({ publicUrl: "ftp://x" }), /publicUrl/);
  assert.equal(normalizeConfig({ uiEntry: false }).uiEntry, false);
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

test("quick tunnel starts cloudflared, parses the URL, and stops the child", async () => {
  const child = fakeChild();
  let spawned = null;
  const tunnel = new CloudflareTunnel({
    config: { enabled: true, mode: "quick" },
    port: 8790,
    spawnImpl: (bin, args) => { spawned = { bin, args }; return child; },
    timeoutMs: 50
  });
  const started = await tunnel.start();
  assert.equal(started.running, true);
  assert.deepEqual(spawned.args, ["tunnel", "--url", "http://127.0.0.1:8790", "--no-autoupdate"]);
  child.stderr.emit("data", "INF |  https://unit-123.trycloudflare.com  |");
  assert.equal(tunnel.snapshot().publicUrl, "https://unit-123.trycloudflare.com");
  await tunnel.stop();
  assert.equal(child.killed, true);
  assert.equal(tunnel.snapshot().running, false);
});

test("named tunnel uses the configured hostname and token", async () => {
  const child = fakeChild();
  let env = null;
  const tunnel = new CloudflareTunnel({
    config: { enabled: true, mode: "named", token: "secret", hostname: "dsh.example.com" },
    port: 8790,
    spawnImpl: (bin, args, options) => { env = options.env; return child; }
  });
  await tunnel.start();
  assert.equal(env.TUNNEL_TOKEN, "secret");
  assert.equal(tunnel.snapshot().publicUrl, "https://dsh.example.com");
  await tunnel.stop();
});

test("missing cloudflared surfaces an error without throwing", async () => {
  const child = fakeChild();
  const tunnel = new CloudflareTunnel({
    config: { enabled: true, mode: "quick" },
    port: 8790,
    spawnImpl: () => child
  });
  await tunnel.start();
  child.emit("error", Object.assign(new Error("spawn cloudflared ENOENT"), { code: "ENOENT" }));
  assert.match(tunnel.snapshot().error, /not installed|not on PATH/);
  await tunnel.stop();
});

test("pairing page renders a public-access card only when a public URL exists", () => {
  const base = {
    hostName: "DESKTOP", hostId: "host-1", port: 8790, protocol: 1, pluginVersion: "0.1.3",
    pairing: { code: "123456", expiresAt: Date.now() + 600000, failedAttempts: 0, lockedUntil: null },
    qrSvg: "<svg></svg>", addresses: [{ url: "http://127.0.0.1:8790", name: "loopback" }], devices: [], now: Date.now()
  };
  const lanOnly = renderPairingPage(base);
  assert.equal(lanOnly.includes("公网访问"), false);
  const withPublic = renderPairingPage({
    ...base,
    publicUrl: "https://dsh.example.com",
    publicQrSvg: "<svg id=\"public\"></svg>",
    tunnel: { enabled: true, mode: "named", running: true, publicUrl: "https://dsh.example.com", error: null }
  });
  assert.equal(withPublic.includes("公网访问"), true);
  assert.equal(withPublic.includes("https://dsh.example.com"), true);
  assert.equal(withPublic.includes("status: running"), true);
});
