/**
 * Cloudflare Tunnel sidecar for public access.
 *
 * Two modes:
 *  - quick: `cloudflared tunnel --url http://127.0.0.1:<port>` prints a random
 *    https://<name>.trycloudflare.com URL (no Cloudflare account needed).
 *  - named: `cloudflared tunnel run` with TUNNEL_TOKEN; the public hostname is
 *    configured on the Cloudflare side and repeated in config.cloudflare.hostname.
 *
 * Nothing here is required for LAN use: when cloudflared is missing or the
 * tunnel fails, the plugin keeps serving the LAN listener and reports the error
 * in the pairing page and /v1/health.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?/i;

/** Extract the first quick-tunnel URL from cloudflared output. */
export function parseQuickTunnelUrl(text) {
  const match = typeof text === "string" ? text.match(QUICK_URL) : null;
  return match === null ? undefined : match[0].replace(/\/$/, "");
}

export class CloudflareTunnel {
  /**
   * @param {{config: {enabled:boolean, mode:"quick"|"named", token?:string,
   *   hostname?:string, binPath?:string}|null, port: number,
   *   logger?: object, spawnImpl?: Function, onUrlChange?: Function, timeoutMs?: number}} options
   */
  constructor(options) {
    this.config = options.config;
    this.port = options.port;
    this.logger = options.logger;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.onUrlChange = options.onUrlChange ?? (() => {});
    this.timeoutMs = options.timeoutMs ?? 60000;
    this.child = null;
    this.timer = null;
    this.status = {
      enabled: this.config !== null,
      mode: this.config === null ? null : this.config.mode,
      running: false,
      publicUrl: this.config !== null && this.config.mode === "named" && this.config.hostname !== undefined
        ? "https://" + this.config.hostname
        : null,
      error: null
    };
    this.stopped = false;
  }

  /** Current tunnel facts for /v1/health, /v1/host, and the pairing page. */
  snapshot() {
    return { ...this.status };
  }

  setUrl(url) {
    if (typeof url !== "string" || url.length === 0 || this.status.publicUrl === url) return;
    this.status.publicUrl = url;
    this.clearTimer();
    try { this.onUrlChange(url); } catch { /* refresh failures never break the tunnel */ }
  }

  clearTimer() {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }

  fail(message) {
    this.status.error = message;
    this.status.running = false;
    this.logger?.warn?.("dsh remote: cloudflare tunnel: " + message);
  }

  async start() {
    if (this.config === null || this.config.enabled === false) return this.snapshot();
    if (this.status.running) return this.snapshot();
    const bin = this.config.binPath ?? "cloudflared";
    if (this.config.binPath !== undefined && !existsSync(this.config.binPath)) {
      this.fail("cloudflared not found at config.cloudflare.binPath: " + this.config.binPath);
      return this.snapshot();
    }
    const args = this.config.mode === "named"
      ? ["tunnel", "run", "--no-autoupdate"]
      : ["tunnel", "--url", "http://127.0.0.1:" + this.port, "--no-autoupdate"];
    const env = { ...process.env };
    if (this.config.mode === "named") env.TUNNEL_TOKEN = this.config.token;

    let child;
    try {
      child = this.spawnImpl(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env });
    } catch (error) {
      this.fail("cannot start cloudflared: " + (error?.message ?? error));
      return this.snapshot();
    }
    this.child = child;
    this.status.running = true;
    this.status.error = null;
    if (this.config.mode === "quick") {
      this.timer = setTimeout(() => {
        if (this.status.publicUrl === null) this.fail("cloudflared did not print a trycloudflare.com URL within " + Math.round(this.timeoutMs / 1000) + "s");
      }, this.timeoutMs);
      this.timer.unref?.();
    }
    const onData = (chunk) => {
      if (this.stopped) return;
      const text = String(chunk);
      if (this.config.mode === "quick") {
        const url = parseQuickTunnelUrl(text);
        if (url !== undefined) this.setUrl(url);
      } else if (/Registered tunnel connection|Connection .*registered/i.test(text)) {
        this.setUrl("https://" + this.config.hostname);
      }
    };
    child.stdout?.on?.("data", onData);
    child.stderr?.on?.("data", onData);
    child.once?.("error", (error) => {
      this.fail("cloudflared failed: " + (error?.code === "ENOENT"
        ? "cloudflared is not installed or not on PATH (install it or set config.cloudflare.binPath)"
        : (error?.message ?? error)));
    });
    child.once?.("exit", (code, signal) => {
      if (this.stopped) return;
      this.clearTimer();
      this.status.running = false;
      if (code !== 0) this.status.error = "cloudflared exited with code " + code + (signal === null ? "" : " (" + signal + ")");
    });
    this.logger?.info?.("dsh remote: cloudflare tunnel starting (" + this.config.mode + ")");
    return this.snapshot();
  }

  async stop() {
    this.stopped = true;
    this.clearTimer();
    const child = this.child;
    this.child = null;
    if (child === null) return;
    try { child.kill(); } catch { /* best effort */ }
    this.status.running = false;
  }
}
