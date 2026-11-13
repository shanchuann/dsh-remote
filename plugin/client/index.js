/* DSH Remote — Settings → 远程控制 client section.
 *
 * Hand-written bundle in the DSH client module format. It renders the pairing
 * QR/code, LAN + Tailscale addresses, and paired devices from the Host route
 * GET /dsh-remote/state (same origin as the DSH Web UI). Polls every 4s so a
 * rotated pairing code and detected addresses show up without manual refresh.
 */
window.__ModuleLoader__.load({
  id: "dsh-remote-harness",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useRef = React.useRef;

    var STYLES = `
      .dsh-remote-settings { --remote-primary: #4d6bfe; --remote-border: rgba(128,128,128,.25); --remote-soft: rgba(128,128,128,.1); --remote-muted: #62666e; width: 100%; max-width: 860px; box-sizing: border-box; padding: 24px; color: inherit; font: 14px/1.6 system-ui, -apple-system, 'Segoe UI', sans-serif; container-type: inline-size; }
      .dsh-remote-settings *, .dsh-remote-settings *::before, .dsh-remote-settings *::after { box-sizing: border-box; }
      .dsh-remote-settings ::selection { background: #dce3ff; color: #172551; }
      .dsh-remote-settings h2, .dsh-remote-settings h3, .dsh-remote-settings p { margin: 0; }
      .dsh-remote-settings .remote-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
      .dsh-remote-settings h2 { font-size: 20px; font-weight: 600; line-height: 1.4; }
      .dsh-remote-settings h3 { font-size: 15px; font-weight: 600; line-height: 1.5; }
      .dsh-remote-settings .remote-muted { color: var(--remote-muted); font-size: 13px; line-height: 1.7; }
      .dsh-remote-settings .remote-card { border: 1px solid var(--remote-border); border-radius: 12px; padding: 20px; margin-top: 16px; }
      .dsh-remote-settings .remote-card:first-of-type { margin-top: 0; }
      .dsh-remote-settings .remote-button { appearance: none; display: inline-flex; align-items: center; justify-content: center; flex: none; gap: 8px; min-height: 36px; padding: 0 16px; border: 1px solid var(--remote-border); border-radius: 8px; background: transparent; color: inherit; font: 500 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; white-space: nowrap; cursor: pointer; }
      .dsh-remote-settings .remote-button:hover:not(:disabled) { background: var(--remote-soft); }
      .dsh-remote-settings .remote-button:active:not(:disabled) { background: rgba(128,128,128,.18); }
      .dsh-remote-settings .remote-button:focus-visible { outline: 2px solid var(--remote-primary); outline-offset: 3px; }
      .dsh-remote-settings .remote-button:disabled { cursor: default; opacity: .55; }
      .dsh-remote-settings .remote-button-primary { color: #fff; border-color: #405bdf; background: #405bdf; }
      .dsh-remote-settings .remote-button-primary:hover:not(:disabled) { background: #344dc9; }
      .dsh-remote-settings .remote-button-primary:active:not(:disabled) { background: #293fae; }
      .dsh-remote-settings .remote-pairing { display: flex; align-items: center; gap: 28px; }
      .dsh-remote-settings .remote-qr { width: 176px; height: 176px; flex: none; padding: 8px; border-radius: 8px; background: #fff; }
      .dsh-remote-settings .remote-pairing-info { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
      .dsh-remote-settings .remote-code { font: 600 36px/1.2 ui-monospace, Consolas, monospace; letter-spacing: .16em; font-variant-numeric: tabular-nums; }
      .dsh-remote-settings .remote-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 2px; }
      .dsh-remote-settings .remote-section-heading { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 4px 16px; margin-bottom: 12px; }
      .dsh-remote-settings .remote-address-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px 20px; padding: 9px 0; }
      .dsh-remote-settings .remote-address-row + .remote-address-row { border-top: 1px solid var(--remote-soft); }
      .dsh-remote-settings .remote-address { min-width: 0; overflow-wrap: anywhere; font: 13px/1.6 ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; user-select: text; }
      .dsh-remote-settings .remote-adapter { max-width: 48%; text-align: right; overflow-wrap: anywhere; }
      .dsh-remote-settings .remote-copy-row { display: flex; align-items: center; justify-content: space-between; gap: 12px 20px; padding: 12px 0; }
      .dsh-remote-settings .remote-tips { display: flex; flex-direction: column; gap: 8px; }
      .dsh-remote-settings .remote-devices { list-style: none; padding: 0; margin: 0; }
      .dsh-remote-settings .remote-device { display: flex; align-items: center; justify-content: space-between; gap: 8px 20px; padding: 12px 0; }
      .dsh-remote-settings .remote-device + .remote-device { border-top: 1px solid var(--remote-soft); }
      .dsh-remote-settings .remote-device:last-child { padding-bottom: 0; }
      .dsh-remote-settings .remote-device-info { min-width: 0; overflow-wrap: anywhere; }
      .dsh-remote-settings .remote-device-name { font-weight: 500; }
      .dsh-remote-settings .remote-time { flex: none; text-align: right; font-variant-numeric: tabular-nums; }
      .dsh-remote-settings .remote-footer { display: flex; flex-wrap: wrap; gap: 4px 20px; margin-top: 20px; padding: 0 2px; }
      .dsh-remote-settings .remote-feedback { min-height: 22px; margin-top: 8px; }
      .dsh-remote-settings .remote-error { color: #bc3030; margin-bottom: 12px; }
      @media (prefers-color-scheme: dark) { .dsh-remote-settings { --remote-muted: #a9adb7; } .dsh-remote-settings .remote-error { color: #ff9696; } }
      :is(.dark, [data-theme="dark"]) .dsh-remote-settings { --remote-muted: #a9adb7; }
      :is(.light, [data-theme="light"]) .dsh-remote-settings { --remote-muted: #62666e; }
      @container (max-width: 540px) {
        .dsh-remote-settings .remote-pairing { flex-direction: column; align-items: flex-start; gap: 20px; }
        .dsh-remote-settings .remote-qr { align-self: center; }
        .dsh-remote-settings .remote-pairing-info { width: 100%; }
        .dsh-remote-settings .remote-actions { width: 100%; }
        .dsh-remote-settings .remote-actions .remote-button { flex: 1; }
        .dsh-remote-settings .remote-button { min-height: 40px; }
        .dsh-remote-settings .remote-address-row, .dsh-remote-settings .remote-device { flex-direction: column; align-items: flex-start; gap: 4px; }
        .dsh-remote-settings .remote-adapter { max-width: 100%; text-align: left; }
        .dsh-remote-settings .remote-copy-row { flex-wrap: wrap; }
        .dsh-remote-settings .remote-time { text-align: left; }
      }
    `;

    function qrDataUri(svg) {
      if (typeof svg !== "string" || svg.length === 0) return null;
      try {
        return "data:image/svg+xml;base64," + window.btoa(svg);
      } catch {
        return null;
      }
    }

    function formatTime(ts) {
      if (typeof ts !== "number" || !isFinite(ts)) return "-";
      try {
        return new Date(ts).toLocaleString("zh-CN", { hour12: false });
      } catch {
        return String(ts);
      }
    }

    function Card(props) {
      return h("section", { className: "remote-card" }, props.children);
    }

    function Muted(props) {
      return h("div", { className: "remote-muted" }, props.children);
    }

    function Button(props) {
      var primary = props.primary === true;
      return h(
        "button",
        {
          type: "button",
          onClick: props.onClick,
          disabled: props.disabled,
          className: "remote-button" + (primary ? " remote-button-primary" : ""),
        },
        props.children,
      );
    }

    function SectionHeading(props) {
      return h(
        "div",
        { className: "remote-header" },
        h("h2", null, "远程控制"),
        props.children,
      );
    }

    function RemoteSettingsSection() {
      var stateBox = useState(null);
      var data = stateBox[0];
      var setData = stateBox[1];
      var errorBox = useState(null);
      var error = errorBox[0];
      var setError = errorBox[1];
      var loadedAtRef = useRef(0);
      var tickBox = useState(0);
      var tick = tickBox[0];
      var setTick = tickBox[1];
      var busyBox = useState(false);
      var busy = busyBox[0];
      var setBusy = busyBox[1];
      var copiedBox = useState(null);
      var copied = copiedBox[0];
      var setCopied = copiedBox[1];
      var copyErrorBox = useState(null);
      var copyError = copyErrorBox[0];
      var setCopyError = copyErrorBox[1];
      var copyTimer = useRef(null);

      async function copyText(text, label) {
        window.clearTimeout(copyTimer.current);
        setCopied(null);
        setCopyError(null);
        try {
          await navigator.clipboard.writeText(text);
          setCopied(label);
          copyTimer.current = window.setTimeout(function () { setCopied(null); }, 2400);
        } catch {
          setCopyError("复制失败，请选中文字后手动复制。");
        }
      }

      async function load(initial) {
        if (initial) setBusy(true);
        try {
          var response = await fetch("/dsh-remote/state", { credentials: "same-origin", cache: "no-store" });
          if (!response.ok) throw new Error("HTTP " + response.status);
          var next = await response.json();
          loadedAtRef.current = Date.now();
          setData(next);
          setError(null);
        } catch (cause) {
          setError(cause && cause.message ? cause.message : String(cause));
        } finally {
          if (initial) setBusy(false);
        }
      }

      useEffect(function () {
        void load(true);
        var timer = window.setInterval(function () { void load(false); }, 4000);
        return function () { window.clearInterval(timer); window.clearTimeout(copyTimer.current); };
      }, []);

      useEffect(function () {
        var timer = window.setInterval(function () { setTick(function (value) { return value + 1; }); }, 1000);
        return function () { window.clearInterval(timer); };
      }, []);

      if (data === null) {
        return h(
          "div",
          { className: "dsh-remote-settings" },
          h("style", null, STYLES),
          h(SectionHeading, null),
          h(Muted, null, error === null ? (busy ? "正在加载…" : "等待 DSH Remote 插件…") : "暂时无法读取配对信息：" + error),
          h("div", { className: "remote-actions" }, h(Button, { disabled: busy, onClick: function () { void load(true); } }, "重试")),
        );
      }

      var now = data.serverTime + (Date.now() - loadedAtRef.current);
      var remaining = Math.max(0, Math.round((data.pairing.expiresAt - now) / 1000));
      var lanQr = qrDataUri(data.qrSvg);
      var primaryAddress = data.tailscaleUrl || (data.addresses[0] && data.addresses[0].url) || "";
      var latestDevices = data.devices.slice().sort(function (left, right) {
        return (right.lastSeenAt || right.createdAt || 0) - (left.lastSeenAt || left.createdAt || 0);
      }).slice(0, 5);

      return h(
        "div",
        { className: "dsh-remote-settings" },
        h("style", null, STYLES),
        h(SectionHeading, null,
          h(Button, { disabled: busy, onClick: function () { void load(true); } }, busy ? "刷新中…" : "刷新"),
        ),
        error !== null ? h("div", { className: "remote-error", role: "alert" }, "刷新失败：" + error) : null,

        h(Card, null,
          h("div", { className: "remote-pairing" },
            lanQr !== null ? h("img", {
              src: lanQr,
              alt: "配对二维码",
              width: 176,
              height: 176,
              className: "remote-qr",
            }) : null,
            h("div", { className: "remote-pairing-info" },
              h("h3", null, "扫码连接手机"),
              h("div", { className: "remote-code", "aria-label": "配对码 " + data.pairing.code }, data.pairing.code),
              h(Muted, null, "有效期剩余 " + remaining + " 秒 · 过期自动轮换"),
              h("div", { className: "remote-actions" },
                h(Button, { primary: true, onClick: function () { void copyText(data.pairing.code, "配对码"); } }, copied === "配对码" ? "已复制配对码" : "复制配对码"),
                h(Button, { disabled: !primaryAddress, onClick: function () { void copyText(primaryAddress, "Host 地址"); } }, copied === "Host 地址" ? "已复制地址" : "复制 Host 地址"),
              ),
              h(Muted, null, "远程访问请先连接 Tailscale。二维码优先使用 Tailscale 地址，局域网作为备用。"),
            ),
          ),
        ),

        h(Card, null,
          h("div", { className: "remote-section-heading" }, h("h3", null, "Host 地址"), h(Muted, null, "Tailscale / 局域网")),
          data.addresses.length === 0
            ? h(Muted, null, "暂无可用网卡地址")
            : data.addresses.map(function (entry) {
                return h(
                  "div",
                  { key: entry.url, className: "remote-address-row" },
                  h("code", { className: "remote-address" }, entry.url),
                  h("span", { className: "remote-muted remote-adapter" }, entry.name || ""),
                );
              }),
        ),

        h(Card, null,
          h("h3", null, "Tailscale 远程连接"),
          data.tailscaleUrl
            ? h("div", null,
                h("div", { className: "remote-copy-row" },
                  h("code", { className: "remote-address" }, data.tailscaleUrl),
                  h(Button, { onClick: function () { void copyText(data.tailscaleUrl, "Tailscale 地址"); } }, copied === "Tailscale 地址" ? "已复制地址" : "复制 Tailscale 地址"),
                ),
                h("div", { className: "remote-tips" },
                h(Muted, null, "已写入上方二维码。手机与电脑需加入同一 Tailscale 网络，且允许访问此端口。"),
                h(Muted, null, "使用 IP 地址不需要开启 Tailscale DNS。若浏览器能访问而 App 超时，请检查 App 分流是否允许 DSH Remote 使用 Tailscale。"),
                ),
              )
            : h(Muted, null, "未检测到 Tailscale IPv4 地址。请在电脑和手机安装并连接 Tailscale，然后刷新；也可手动输入电脑的 Tailscale 地址。"),
        ),

        h(Card, null,
          h("div", { className: "remote-section-heading" },
            h("h3", null, "已配对设备（" + data.devices.length + "）"),
            data.devices.length > 5 ? h(Muted, null, "最近活跃的 5 台") : null,
          ),
          data.devices.length === 0
            ? h(Muted, null, "还没有手机完成配对。")
            : h("ul", { className: "remote-devices" }, latestDevices.map(function (device) {
                return h(
                  "li",
                  { key: device.deviceId, className: "remote-device" },
                  h("div", { className: "remote-device-info" },
                    h("span", { className: "remote-device-name" }, device.name || "device"),
                    h("span", { className: "remote-muted" }, " · " + (device.platform || "unknown")),
                  ),
                  h("span", { className: "remote-muted remote-time" }, "最近 " + formatTime(device.lastSeenAt)),
                );
              })),
        ),

        h("div", { className: "remote-muted remote-feedback", role: "status", "aria-live": "polite", hidden: !copyError && !copied }, copyError || (copied ? "已复制" + copied : "")),
        h("footer", { className: "remote-muted remote-footer" },
          h("span", null, "插件 ", data.pluginVersion),
          " ",
          h("span", null, "Host ", data.hostName),
        ),
      );
    }

    function RemoteSettingsIcon(props) {
      var size = props && props.size ? props.size : 20;
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" },
        h("rect", { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }),
        h("rect", { x: 14, y: 3, width: 7, height: 7, rx: 1.5 }),
        h("rect", { x: 3, y: 14, width: 7, height: 7, rx: 1.5 }),
        h("path", { d: "M14 14h3v3h-3zM19 19h2M19 22v-1M16 22h1" }),
      );
    }

    function apply(ctx) {
      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "remote",
          order: 60,
          label: function () { return "远程控制"; },
        }, RemoteSettingsSection);
      });
      ctx.slots.inject("settings.section.icon", function () {
        return ctx.slots.register({ name: "settings.section.icon", id: "remote" }, RemoteSettingsIcon);
      });
    }

    var inject = ["slots"];

    exports.apply = apply;
    exports.inject = inject;
    exports.RemoteSettingsSection = RemoteSettingsSection;
    return module.exports;
  },
});
