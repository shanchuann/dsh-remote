import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginDataPathsIn } from "../src/state/paths.mjs";
import { removeDir } from "./helpers/harness.mjs";
import { encodeMonochromePng } from "../src/pairing/png.mjs";
import { qrMatrix, qrSvg } from "../src/pairing/qr.mjs";
import { lanAddresses, pairingEndpoints, pairingUri, writePairingArtifacts } from "../src/pairing/files.mjs";

const URI_INPUT = { baseUrl: "http://192.168.1.23:8790", code: "123456", hostId: "host-uuid", hostName: "DESKTOP-XXX" };

test("QR SVG is a scalable vector with real modules", () => {
  const svg = qrSvg("dshremote://pair?u=x&c=123456&h=h&n=n");
  assert.ok(svg.startsWith("<svg"));
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.ok(svg.includes("<path"));
  assert.ok(svg.length > 500);
});

test("QR matrix exposes a square, odd-sized module grid with a finder pattern", () => {
  const matrix = qrMatrix(JSON.stringify(URI_INPUT));
  assert.ok(matrix.size >= 21 && matrix.size <= 177);
  assert.equal(matrix.size % 4, 1);
  for (let row = 0; row < 7; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      const expected = row === 0 || row === 6 || column === 0 || column === 6 || (row >= 2 && row <= 4 && column >= 2 && column <= 4);
      assert.equal(matrix.isDark(row, column), expected, row + "," + column);
    }
  }
});

test("monochrome PNG encoder writes a valid 1-bit PNG", () => {
  const matrix = qrMatrix(JSON.stringify(URI_INPUT));
  const png = encodeMonochromePng(matrix, { scale: 8, margin: 4 });
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const expected = (matrix.size + 8) * 8;
  assert.equal(width, expected);
  assert.equal(height, expected);
  assert.equal(png[24], 1, "bit depth");
  assert.equal(png[25], 0, "color type grayscale");
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString("ascii"), "IEND");
});

test("pairing URI encodes base URL, code, host, and name", () => {
  const uri = pairingUri(URI_INPUT);
  assert.ok(uri.startsWith("dshremote://pair?"));
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, "dshremote:");
  assert.equal(parsed.searchParams.get("u"), "http://192.168.1.23:8790");
  assert.equal(parsed.searchParams.get("c"), "123456");
  assert.equal(parsed.searchParams.get("h"), "host-uuid");
  assert.equal(parsed.searchParams.get("n"), "DESKTOP-XXX");
  assert.ok(uri.includes("u=http%3A%2F%2F192.168.1.23%3A8790"));
  const withoutName = pairingUri({ baseUrl: URI_INPUT.baseUrl, code: "000000", hostId: "h" });
  assert.equal(withoutName.includes("n="), false);
});

test("LAN address discovery skips internal interfaces and prefers private ranges", () => {
  const interfaces = {
    loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    wifi: [{ address: "192.168.1.23", family: "IPv4", internal: false }],
    tailscale: [{ address: "100.64.0.5", family: "IPv4", internal: false }],
    ethernet: [{ address: "10.0.0.7", family: "IPv4", internal: false }],
    ipv6: [{ address: "fe80::1", family: "IPv6", internal: false }]
  };
  const addresses = lanAddresses(8790, interfaces);
  assert.deepEqual(addresses.map((entry) => entry.address), ["192.168.1.23", "10.0.0.7", "100.64.0.5"]);
  assert.equal(addresses[0].url, "http://192.168.1.23:8790");
  assert.equal(pairingEndpoints(8790, {}).baseUrl, "http://127.0.0.1:8790");
});

test("writePairingArtifacts writes json/txt/svg/png without credentials", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "dsh-remote-pairing-"));
  t.after(() => removeDir(dir));
  const paths = pluginDataPathsIn(dir);
  const now = 1763000000000;
  const result = await writePairingArtifacts({
    paths,
    hostId: "host-uuid",
    hostName: "DESKTOP-XXX",
    protocol: 1,
    port: 8790,
    pairing: { code: "123456", expiresAt: now + 600000 },
    now,
    interfaces: {},
    deviceCount: 2
  });
  assert.equal(result.baseUrl, "http://127.0.0.1:8790");
  assert.ok(result.uri.startsWith("dshremote://pair?"));

  const descriptor = JSON.parse(await readFile(paths.pairingJson, "utf8"));
  assert.deepEqual(descriptor, {
    hostId: "host-uuid",
    hostName: "DESKTOP-XXX",
    protocol: 1,
    port: 8790,
    addresses: ["http://127.0.0.1:8790"],
    pairingCode: "123456",
    pairingExpiresAt: now + 600000,
    publicUrl: null,
    updatedAt: now
  });
  const text = await readFile(paths.pairingTxt, "utf8");
  assert.ok(text.includes("123456"));
  assert.ok(text.includes("Paired devices: 2"));
  assert.ok(text.includes(result.uri));
  const svg = await readFile(paths.pairingSvg, "utf8");
  assert.ok(svg.startsWith("<?xml"));
  const png = await readFile(paths.pairingPng);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.includes(Buffer.from("123456")), false);
});