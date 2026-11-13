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

    var COLORS = {
      primary: "#4D6BFE",
      border: "rgba(128,128,128,0.28)",
      soft: "rgba(128,128,128,0.12)",
    };

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

    function copyText(text) {
      try {
        void navigator.clipboard.writeText(text);
      } catch {
        /* clipboard may be unavailable */
      }
    }

    function Card(props) {
      return h(
        "div",
        {
          style: {
            border: "1px solid " + COLORS.border,
            borderRadius: 12,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          },
        },
        props.children,
      );
    }

    function Muted(props) {
      return h("div", { style: { fontSize: 12, opacity: 0.65, lineHeight: 1.5 } }, props.children);
    }

    function Button(props) {
      var primary = props.primary === true;
      return h(
        "button",
        {
          type: "button",
          onClick: props.onClick,
          style: {
            height: 32,
            padding: "0 14px",
            borderRadius: 8,
            border: primary ? "none" : "1px solid " + COLORS.border,
            background: primary ? COLORS.primary : "transparent",
            color: primary ? "#fff" : "inherit",
            font: "500 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif",
            cursor: "pointer",
          },
        },
        props.children,
      );
    }

    function SectionHeading(props) {
      return h(
        "div",
        { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } },
        h("div", { style: { fontSize: 18, fontWeight: 600 } }, "远程控制"),
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
        return function () { window.clearInterval(timer); };
      }, []);

      useEffect(function () {
        var timer = window.setInterval(function () { setTick(function (value) { return value + 1; }); }, 1000);
        return function () { window.clearInterval(timer); };
      }, []);

      if (data === null) {
        return h(
          "div",
          { style: { padding: 20, display: "flex", flexDirection: "column", gap: 12 } },
          h(SectionHeading, null),
          h(Muted, null, error === null ? (busy ? "正在加载…" : "等待 DSH Remote 插件…") : "暂时无法读取配对信息：" + error),
          h("div", null, h(Button, { onClick: function () { void load(true); } }, "重试")),
        );
      }

      var now = data.serverTime + (Date.now() - loadedAtRef.current);
      var remaining = Math.max(0, Math.round((data.pairing.expiresAt - now) / 1000));
      var lanQr = qrDataUri(data.qrSvg);

      return h(
        "div",
        { style: { padding: 20, display: "flex", flexDirection: "column", gap: 16, maxWidth: 860 } },
        h(SectionHeading, null,
          h(Button, { onClick: function () { void load(true); } }, busy ? "刷新中…" : "刷新"),
        ),
        error !== null ? h("div", { style: { color: "#dc2626", fontSize: 13 } }, "刷新失败：" + error) : null,

        h(Card, null,
          h("div", { style: { display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" } },
            lanQr !== null ? h("img", {
              src: lanQr,
              alt: "配对二维码",
              width: 180,
              height: 180,
              style: { width: 180, height: 180, background: "#fff", padding: 8, borderRadius: 10, flex: "none" },
            }) : null,
            h("div", { style: { display: "flex", flexDirection: "column", gap: 8, minWidth: 240, flex: 1 } },
              h("div", { style: { fontSize: 12, opacity: 0.65, letterSpacing: 2 } }, "配对码 / PAIR CODE"),
              h("div", { style: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 40, letterSpacing: 8, fontWeight: 700 } }, data.pairing.code),
              h(Muted, null, "有效期剩余 " + remaining + " 秒 · 过期自动轮换"),
              h("div", { style: { display: "flex", gap: 8, marginTop: 4 } },
                h(Button, { primary: true, onClick: function () { copyText(data.pairing.code); } }, "复制配对码"),
                h(Button, { onClick: function () { copyText(data.addresses.length > 0 ? data.addresses[0].url : ""); } }, "复制地址"),
              ),
              h(Muted, null, "远程访问请先连接 Tailscale。二维码优先使用 Tailscale 地址，局域网作为备用。"),
            ),
          ),
        ),

        h(Card, null,
          h("div", { style: { fontSize: 14, fontWeight: 600 } }, "Host 地址（Tailscale / 局域网）"),
          data.addresses.length === 0
            ? h(Muted, null, "暂无可用网卡地址")
            : data.addresses.map(function (entry) {
                return h(
                  "div",
                  { key: entry.url, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } },
                  h("a", {
                    href: entry.url + "/pair",
                    target: "_blank",
                    rel: "noreferrer",
                    style: { fontFamily: "ui-monospace, Consolas, monospace", fontSize: 13, color: COLORS.primary, textDecoration: "none", wordBreak: "break-all" },
                  }, entry.url),
                  h(Muted, null, entry.name || ""),
                );
              }),
        ),

        h(Card, null,
          h("div", { style: { fontSize: 14, fontWeight: 600 } }, "Tailscale 远程连接"),
          data.tailscaleUrl
            ? h("div", null,
                h("code", null, data.tailscaleUrl),
                h("div", null, h(Button, { onClick: function () { copyText(data.tailscaleUrl); } }, "复制 Tailscale 地址")),
                h(Muted, null, "已写入上方二维码。手机与电脑需加入同一 Tailscale 网络，且允许访问此端口。"),
              )
            : h(Muted, null, "未检测到 Tailscale IPv4 地址。请在电脑和手机安装并连接 Tailscale，然后刷新；也可手动输入电脑的 Tailscale 地址。"),
          h(Muted, null, "使用 IP 地址不需要开启 Tailscale DNS。若浏览器能访问而 App 超时，请检查 App 分流是否允许 DSH Remote 使用 Tailscale。"),
        ),

        h(Card, null,
          h("div", { style: { fontSize: 14, fontWeight: 600 } }, "已配对设备（" + data.devices.length + "）"),
          data.devices.length === 0
            ? h(Muted, null, "还没有手机完成配对。")
            : data.devices.map(function (device) {
                return h(
                  "div",
                  { key: device.deviceId, style: { display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, padding: "4px 0", borderBottom: "1px solid " + COLORS.soft } },
                  h("span", null, (device.name || "device") + " · " + (device.platform || "unknown")),
                  h(Muted, null, "最近 " + formatTime(device.lastSeenAt)),
                );
              }),
        ),

        h(Muted, null, "协议 v" + data.protocol + " · 插件 " + data.pluginVersion + " · Host " + data.hostName),
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