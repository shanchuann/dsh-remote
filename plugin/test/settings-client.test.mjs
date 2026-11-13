import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../client/index.js", import.meta.url), "utf8");

function render(data) {
  let stateIndex = 0;
  let entry;
  const React = {
    createElement(type, props, ...children) {
      if (typeof type === "function") return type({ ...props, children });
      return { type, props, children: children.flat(Infinity) };
    },
    useState() { return [stateIndex++ === 0 ? data : null, () => {}]; },
    useEffect() {},
    useRef() { return { current: Date.now() }; }
  };
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load(definition) { entry = definition.factory(() => React); } }, btoa: () => "" }
  });
  return entry.RemoteSettingsSection();
}

function matching(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...tree.children.flatMap(child => matching(child, predicate))];
}

function text(tree) {
  if (tree === null || tree === undefined) return "";
  return typeof tree === "object" ? tree.children.map(text).join("") : String(tree);
}

const base = { serverTime: Date.now(), protocol: 1, pluginVersion: "0.1.16", hostName: "山川不念旧", pairing: { code: "123456", expiresAt: Date.now() + 600000 }, addresses: [], devices: [] };

test("settings shows only five most recently active devices without changing the registry order", () => {
  const devices = Array.from({ length: 13 }, (_, i) => ({ deviceId: String(i), name: "Phone " + i, lastSeenAt: i === 12 ? undefined : i * 1000, createdAt: i === 12 ? 20000 : 1 }));
  const original = devices.map(device => device.deviceId).join(",");
  const tree = render({ ...base, devices });
  const rows = matching(tree, node => node.props?.className === "remote-device");
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map(node => matching(node, child => child.props?.className === "remote-device-name").map(text).join("")), ["Phone 12", "Phone 11", "Phone 10", "Phone 9", "Phone 8"]);
  assert.equal(devices.map(device => device.deviceId).join(","), original);
  assert.ok(text(tree).includes("已配对设备（13）"));
  assert.ok(text(tree).includes("最近活跃的 5 台"));
});

test("settings empty state keeps the requested footer and disables copying a missing Host address", () => {
  const tree = render(base);
  assert.ok(text(tree).includes("还没有手机完成配对。"));
  const footer = matching(tree, node => node.type === "footer")[0];
  assert.equal(text(footer), "插件 0.1.16 Host 山川不念旧");
  const copy = matching(tree, node => node.type === "button" && text(node) === "复制 Host 地址")[0];
  assert.equal(copy.props.disabled, true);
});

test("settings footer reads the current plugin version and Host name instead of fixed example values", () => {
  for (const metadata of [
    { pluginVersion: "0.1.17", hostName: "Office Host" },
    { pluginVersion: "0.2.0-beta.1", hostName: "开发主机" }
  ]) {
    const tree = render({ ...base, ...metadata });
    const footer = matching(tree, node => node.type === "footer")[0];
    assert.equal(text(footer), `插件 ${metadata.pluginVersion} Host ${metadata.hostName}`);
    assert.ok(!text(footer).includes(base.hostName));
    assert.ok(!text(footer).includes(base.pluginVersion));
  }
});
