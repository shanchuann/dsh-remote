/**
 * The loopback pairing page: QR code, one-time code, expiry countdown, LAN
 * addresses, and the paired-device list. It is a single self-contained page
 * (inline CSS/JS, inline SVG QR) so it works with no network and no assets.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTime(timestamp) {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "-";
  try {
    return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return new Date(timestamp).toISOString();
  }
}

/**
 * Render the pairing page.
 * @param {{hostName: string, hostId: string, port: number, protocol: number,
 *   pluginVersion: string, pairing: {code: string, expiresAt: number,
 *   failedAttempts: number, lockedUntil: number|null}, qrSvg: string,
 *   addresses: {url: string, name: string}[], devices: object[], now: number}} input
 * @returns {string}
 */
export function renderPairingPage(input) {
  const now = input.now;
  const expiresInSeconds = Math.max(0, Math.round((input.pairing.expiresAt - now) / 1000));
  const locked = typeof input.pairing.lockedUntil === "number" && input.pairing.lockedUntil > now;
  const lockedSeconds = locked ? Math.max(0, Math.round((input.pairing.lockedUntil - now) / 1000)) : 0;
  const addresses = Array.isArray(input.addresses) && input.addresses.length > 0
    ? input.addresses
    : [{ url: "http://127.0.0.1:" + input.port, name: "loopback" }];
  const devices = Array.isArray(input.devices) ? input.devices : [];

  const deviceRows = devices.length === 0
    ? '<li class="empty">暂无已配对设备 / No paired devices yet</li>'
    : devices.map((device) => {
      const label = escapeHtml(device.name ?? "device");
      const platform = escapeHtml(device.platform ?? "unknown");
      const created = formatTime(device.createdAt);
      const seen = formatTime(device.lastSeenAt);
      return '<li><span class="device-name">' + label + '</span>' +
        '<span class="device-meta">' + platform + '</span>' +
        '<span class="device-meta">配对 / paired: ' + escapeHtml(created) + '</span>' +
        '<span class="device-meta">最近 / last seen: ' + escapeHtml(seen) + '</span></li>';
    }).join("");
  const addressRows = addresses.map((entry) => {
    const url = escapeHtml(entry.url);
    return '<li><code>' + url + '</code><span class="device-meta">' + escapeHtml(entry.name ?? "") + '</span></li>';
  }).join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH Remote · 配对 / Pairing</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 20px 48px; font-family: "Segoe UI", system-ui, -apple-system, "Microsoft YaHei", sans-serif;
         background: #f6f7f9; color: #1a1c1f; }
  main { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -0.02em; }
  h2 { font-size: 16px; margin: 28px 0 8px; }
  .sub { margin: 0 0 24px; color: #5b626b; }
  .card { background: #fff; border: 1px solid #e3e6ea; border-radius: 16px; padding: 24px; box-shadow: 0 1px 2px rgba(16,24,40,.04); }
  .qr { display: flex; justify-content: center; }
  .qr svg { width: 260px; height: 260px; }
  .public .sub { color: #5b626b; }
  .public code { word-break: break-all; }
  .code { margin-top: 12px; text-align: center; }
  .code .label { display: block; font-size: 13px; color: #5b626b; letter-spacing: .08em; text-transform: uppercase; }
  .code strong { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 44px; letter-spacing: .18em; }
  .expiry { text-align: center; color: #5b626b; font-size: 14px; margin: 6px 0 0; }
  .lock { margin: 16px 0 0; padding: 12px 14px; border-radius: 10px; background: #fff4e5; color: #8a4b00; font-size: 14px; }
  .muted { color: #5b626b; }
  ul { list-style: none; margin: 0; padding: 0; }
  .card ul li { padding: 10px 0; border-bottom: 1px solid #eef0f3; display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: baseline; }
  .card ul li:last-child { border-bottom: none; }
  .empty { color: #8b929b; }
  code { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 14px; }
  .steps { margin: 0; padding-left: 20px; }
  .steps li { display: list-item; padding: 6px 0; border-bottom: none; }
  .tip { margin: 12px 0 0; color: #5b626b; font-size: 13px; }
  .device-name { font-weight: 600; }
  .device-meta { color: #5b626b; font-size: 13px; }
  footer { margin-top: 32px; color: #8b929b; font-size: 12px; text-align: center; }
  @media (prefers-color-scheme: dark) {
    body { background: #14161a; color: #e9ecef; }
    .card { background: #1c1f24; border-color: #2b3038; }
    h2, .sub, .expiry, .device-meta { color: #a7afb8; }
    li { border-bottom-color: #2b3038; }
    .lock { background: #3a2a12; color: #ffcf8f; }
    .qr { background: #fff; border-radius: 12px; padding: 8px; }
  }
</style>
</head>
<body>
<main>
  <h1>DSH Remote</h1>
  <p class="sub">用手机 App 扫描二维码完成配对（局域网 / 公网自动选择）/ Scan once — the app tries the LAN address, then the public one.</p>
  <section class="card">
    <div class="qr">${input.qrSvg}</div>
    <div class="code">
      <span class="label">配对码 / Pair code</span>
      <strong id="pair-code">${escapeHtml(input.pairing.code)}</strong>
    </div>
    <p class="expiry">
      有效期 / expires at <span id="expires-at" data-ts="${escapeHtml(input.pairing.expiresAt)}">${escapeHtml(formatTime(input.pairing.expiresAt))}</span>
      (<span id="countdown">${escapeHtml(String(expiresInSeconds))}</span>s)
    </p>
    ${locked ? '<p class="lock">尝试次数过多，已临时锁定 / Too many failed attempts. Locked for <span id="lock-countdown">' + escapeHtml(String(lockedSeconds)) + "</span>s.</p>" : ""}
  </section>

  ${input.publicUrl ? '<h2>公网访问 / Public access</h2>' +
  '<section class="card public">' +
  '<p class="sub" style="margin:0 0 12px">Cloudflare 隧道 / Tunnel: <code>' + escapeHtml(input.publicUrl) + '</code></p>' +
  '<p class="tip">mode: ' + escapeHtml(String(input.tunnel?.mode ?? 'static')) +
  ' · status: ' + escapeHtml(input.tunnel?.running === true ? 'running' : (input.tunnel?.error ? 'error: ' + input.tunnel.error : 'configured')) + '</p>' +
  '<p class="tip">二维码同时包含局域网与公网地址，手机扫码后会自动选择可达的那个；也可以手动输入二维码下方的地址。</p>' +
  '</section>' : ''}

  <h2>配对步骤 / How to pair</h2>
  <section class="card">
    <ol class="steps">
      <li>手机与电脑连接同一个 Wi-Fi，处于同一局域网。</li>
      <li>用手机 App 扫描上方二维码；也可以手动输入下面的 Host 地址 + 6 位配对码。</li>
      <li>配对成功后，手机即可继续电脑上的 DSH 会话。关闭本页不影响连接。</li>
    </ol>
    <p class="tip">首次使用若手机连不上，请在电脑防火墙放行 TCP ${escapeHtml(String(input.port))} 端口。</p>
  </section>

  <h2>Host 地址 / Addresses</h2>
  <section class="card"><ul>${addressRows}</ul></section>

  <h2>已配对设备 / Paired devices</h2>
  <section class="card"><ul>${deviceRows}</ul></section>

  <footer>protocol ${escapeHtml(String(input.protocol))} · plugin ${escapeHtml(input.pluginVersion)} · host ${escapeHtml(input.hostName)} · ${escapeHtml(input.hostId)}</footer>
</main>
<script>
  (function () {
    var expiresAt = Number(document.getElementById("expires-at").dataset.ts);
    var countdown = document.getElementById("countdown");
    var lock = document.getElementById("lock-countdown");
    function tick() {
      var left = Math.round((expiresAt - Date.now()) / 1000);
      if (countdown) countdown.textContent = String(Math.max(0, left));
      if (lock) lock.textContent = String(Math.max(0, Number(lock.textContent) - 1));
      if (left <= 0) { window.location.reload(); return; }
      window.setTimeout(tick, 1000);
    }
    window.setTimeout(tick, 1000);
  })();
</script>
</body>
</html>
`;
}