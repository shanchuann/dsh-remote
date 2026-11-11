/**
 * Pairing artifacts on disk plus the dshremote:// URI. The JSON descriptor is
 * the CLI-visible contract from protocol section 1.1; pairing.png and
 * pairing.svg carry the same QR content, and pairing.txt is for humans.
 */
import { networkInterfaces } from "node:os";
import { writeFileAtomic, writeJsonAtomic } from "../state/atomic.mjs";
import { qrMatrix, qrSvg } from "./qr.mjs";
import { encodeMonochromePng } from "./png.mjs";

/** QR scale (pixels per module) used for the PNG artifact. */
const PNG_SCALE = 8;
const PNG_MARGIN = 4;

/**
 * IPv4 LAN addresses the phone can reach, most-private first.
 * @param {number} port
 * @param {ReturnType<typeof networkInterfaces>} [interfaces]
 * @returns {{name: string, address: string, url: string}[]}
 */
export function lanAddresses(port, interfaces) {
  const maps = interfaces ?? networkInterfaces();
  const found = [];
  for (const [name, entries] of Object.entries(maps ?? {})) {
    for (const entry of entries ?? []) {
      if (entry === null || typeof entry !== "object" || entry.internal === true) continue;
      const family = entry.family;
      if (family !== "IPv4" && family !== 4) continue;
      if (typeof entry.address !== "string" || entry.address.length === 0) continue;
      found.push({ name, address: entry.address, url: "http://" + entry.address + ":" + port });
    }
  }
  // Phones reach Wi-Fi/Ethernet, not hypervisor or container bridges. Ranking:
  // real adapter name first, then private range, then address text.
  const virtualAdapter = /(vmware|virtualbox|vethernet|hyper-?v|docker|wsl|loopback|bluetooth|tailscale|zerotier|wi-?fi\s*direct|direct|本地连接\s*\*|tap-|tun\d)/i;
  const realAdapter = /(wi-?fi|wlan|wireless|ethernet|以太网|无线)/i;
  const adapterRank = (name) => (realAdapter.test(name) ? 0 : virtualAdapter.test(name) ? 2 : 1);
  const rank = (address) => {
    if (address.startsWith("192.168.")) return 0;
    if (address.startsWith("10.")) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
    return 3;
  };
  return found.sort((left, right) =>
    adapterRank(left.name) - adapterRank(right.name) ||
    rank(left.address) - rank(right.address) ||
    left.address.localeCompare(right.address));
}

/**
 * Best base URL for the QR payload: first LAN address, else loopback.
 * @param {number} port
 * @param {ReturnType<typeof networkInterfaces>} [interfaces]
 * @returns {{baseUrl: string, addresses: {name: string, address: string, url: string}[]}}
 */
export function pairingEndpoints(port, interfaces) {
  const addresses = lanAddresses(port, interfaces);
  if (addresses.length === 0) {
    addresses.push({ name: "loopback", address: "127.0.0.1", url: "http://127.0.0.1:" + port });
  }
  return { baseUrl: addresses[0].url, addresses };
}

/**
 * Build the dshremote:// pairing URI (protocol section 1.2).
 * @param {{baseUrl: string, code: string, hostId: string, hostName?: string|null}} input
 * @returns {string}
 */
export function pairingUri(input) {
  const params = new URLSearchParams();
  params.set("u", input.baseUrl);
  params.set("c", input.code);
  params.set("h", input.hostId);
  if (typeof input.hostName === "string" && input.hostName.length > 0) params.set("n", input.hostName);
  return "dshremote://pair?" + params.toString();
}

/**
 * pairing.json content (never contains a device token).
 * @param {{hostId: string, hostName: string, protocol: number, port: number,
 *   addresses: {url: string}[], pairing: {code: string, expiresAt: number},
 *   now: number}} input
 */
export function pairingDescriptor(input) {
  return {
    hostId: input.hostId,
    hostName: input.hostName,
    protocol: input.protocol,
    port: input.port,
    addresses: input.addresses.map((entry) => entry.url),
    pairingCode: input.pairing.code,
    pairingExpiresAt: input.pairing.expiresAt,
    updatedAt: input.now
  };
}

/**
 * Human-readable pairing.txt body.
 * @param {{hostId: string, hostName: string, protocol: number, port: number,
 *   addresses: {url: string}[], pairing: {code: string, expiresAt: number}, uri: string,
 *   deviceCount: number, now: number}} input
 */
export function pairingText(input) {
  const lines = [
    "DSH Remote pairing / 配对信息",
    "================================",
    "Host:      " + input.hostName + " (" + input.hostId + ")",
    "Address:   " + (input.addresses[0]?.url ?? "http://127.0.0.1:" + input.port),
    "Code:      " + input.pairing.code + "   / 配对码",
    "Expires:   " + new Date(input.pairing.expiresAt).toISOString() + " (in " + Math.max(0, Math.round((input.pairing.expiresAt - input.now) / 1000)) + "s)",
    "URI:       " + input.uri,
    "Protocol:  " + input.protocol,
    "Paired devices: " + input.deviceCount,
    "",
    "Pairing page (host only): http://127.0.0.1:" + input.port + "/pair",
    "Files: pairing.json, pairing.png, pairing.svg",
    ""
  ];
  return lines.join("\n");
}

/**
 * Write pairing.json, pairing.txt, pairing.svg, and pairing.png atomically.
 * @param {{paths: Record<string, string>, hostId: string, hostName: string,
 *   protocol: number, port: number, pairing: {code: string, expiresAt: number},
 *   now?: number, interfaces?: ReturnType<typeof networkInterfaces>,
 *   deviceCount?: number}} input
 */
export async function writePairingArtifacts(input) {
  const now = input.now ?? Date.now();
  const endpoints = pairingEndpoints(input.port, input.interfaces);
  const uri = pairingUri({
    baseUrl: endpoints.baseUrl,
    code: input.pairing.code,
    hostId: input.hostId,
    hostName: input.hostName
  });
  const descriptor = pairingDescriptor({
    hostId: input.hostId,
    hostName: input.hostName,
    protocol: input.protocol,
    port: input.port,
    addresses: endpoints.addresses,
    pairing: input.pairing,
    now
  });
  const svg = qrSvg(uri, { cellSize: 6, margin: 4, scalable: true });
  const png = encodeMonochromePng(qrMatrix(uri), { scale: PNG_SCALE, margin: PNG_MARGIN });
  await Promise.all([
    writeJsonAtomic(input.paths.pairingJson, descriptor),
    writeFileAtomic(
      input.paths.pairingTxt,
      pairingText({
        hostId: input.hostId,
        hostName: input.hostName,
        protocol: input.protocol,
        port: input.port,
        addresses: endpoints.addresses,
        pairing: input.pairing,
        uri,
        deviceCount: input.deviceCount ?? 0,
        now
      })
    ),
    writeFileAtomic(input.paths.pairingSvg, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + svg),
    writeFileAtomic(input.paths.pairingPng, png)
  ]);
  return { ...endpoints, uri, descriptor };
}
