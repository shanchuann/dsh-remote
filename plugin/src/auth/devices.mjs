/**
 * Persisted device registry. Only the SHA-256 digest of a device token is
 * stored (never the token itself), so reading devices.json does not hand an
 * attacker usable credentials.
 */
import { randomUUID } from "node:crypto";
import { hashToken, safeEqualHex, createDeviceToken } from "./tokens.mjs";
import { readJson, writeJsonAtomic } from "../state/atomic.mjs";

/** Schema version of devices.json. */
const FILE_VERSION = 1;

const DEVICE_ID_MAX = 200;
const NAME_MAX = 120;
const PLATFORM_MAX = 60;
const APP_VERSION_MAX = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

function cleanText(value, max, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (trimmed.length === 0) return fallback;
  return trimmed.slice(0, max);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @typedef {{deviceId: string, name: string, platform: string, appVersion: string|null,
 *   createdAt: number, lastSeenAt: number}} DeviceInfo
 */

/**
 * Device registry with throttled persistence.
 */
export class DeviceStore {
  /**
   * @param {{filePath: string, deviceTtlDays?: number, now?: () => number,
   *   logger?: {warn?: Function}, persistThrottleMs?: number}} options
   */
  constructor(options) {
    if (!isRecord(options) || typeof options.filePath !== "string") {
      throw new TypeError("dsh-remote: DeviceStore needs a filePath");
    }
    this.filePath = options.filePath;
    this.deviceTtlDays = options.deviceTtlDays ?? 30;
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
    this.persistThrottleMs = options.persistThrottleMs ?? 15000;
    /** @type {Map<string, {deviceId:string, tokenHash:string, name:string, platform:string,
     *   appVersion:string|null, createdAt:number, lastSeenAt:number}>} */
    this.records = new Map();
    this.loaded = false;
    this.dirty = false;
    this.lastPersistAt = 0;
    this.persistPromise = null;
  }

  /** @returns {Promise<void>} */
  async load() {
    const loaded = await readJson(this.filePath, null, {
      now: this.now(),
      onCorrupt: (error, movedTo) => this.logger?.warn?.(
        "dsh-remote: devices.json unreadable (" + error.message + "); starting with no paired devices" +
        (movedTo ? " (moved to " + movedTo + ")" : "")
      )
    });
    const file = loaded.value;
    this.records.clear();
    if (isRecord(file) && Array.isArray(file.devices)) {
      for (const entry of file.devices) {
        if (!isRecord(entry) || typeof entry.deviceId !== "string" || typeof entry.tokenHash !== "string") continue;
        if (this.#isExpired(entry)) continue;
        this.records.set(entry.deviceId, {
          deviceId: entry.deviceId,
          tokenHash: entry.tokenHash.toLowerCase(),
          name: cleanText(entry.name, NAME_MAX, "device"),
          platform: cleanText(entry.platform, PLATFORM_MAX, "unknown"),
          appVersion: typeof entry.appVersion === "string" ? entry.appVersion.slice(0, APP_VERSION_MAX) : null,
          createdAt: typeof entry.createdAt === "number" ? entry.createdAt : this.now(),
          lastSeenAt: typeof entry.lastSeenAt === "number" ? entry.lastSeenAt : this.now()
        });
      }
    }
    this.loaded = true;
    return;
  }

  /** @returns {number} number of paired devices */
  get size() {
    return this.records.size;
  }

  /** @returns {boolean} */
  get pairingRequired() {
    return this.records.size === 0;
  }

  /** @returns {DeviceInfo[]} newest first */
  list() {
    return [...this.records.values()]
      .sort((a, b) => b.createdAt - a.createdAt || a.deviceId.localeCompare(b.deviceId))
      .map((record) => this.#publicInfo(record));
  }

  /** @param {string} deviceId */
  has(deviceId) {
    return this.records.has(deviceId);
  }

  /**
   * Validate a bearer token and refresh its lastSeenAt.
   * @param {string} token
   * @returns {DeviceInfo|null}
   */
  authenticate(token) {
    if (typeof token !== "string" || token.length === 0) return null;
    const digest = hashToken(token);
    for (const record of this.records.values()) {
      if (!safeEqualHex(digest, record.tokenHash)) continue;
      if (this.#isExpired(record)) {
        this.records.delete(record.deviceId);
        this.dirty = true;
        this.#maybePersist();
        return null;
      }
      record.lastSeenAt = this.now();
      this.dirty = true;
      this.#maybePersist();
      return this.#publicInfo(record);
    }
    return null;
  }

  /**
   * Register (or re-key) a device and mint its token. The plaintext token is
   * returned exactly once.
   * @param {{deviceId?: string, name?: string, platform?: string, appVersion?: string}} input
   * @returns {Promise<{device: DeviceInfo, token: string}>}
   */
  async pair(input) {
    const source = isRecord(input) ? input : {};
    const requestedId = cleanText(source.deviceId, DEVICE_ID_MAX, null);
    const deviceId = requestedId ?? randomUUID();
    const token = createDeviceToken();
    const tokenHash = hashToken(token);
    const timestamp = this.now();
    const existing = this.records.get(deviceId);
    const record = {
      deviceId,
      tokenHash,
      name: cleanText(source.name, NAME_MAX, "device"),
      platform: cleanText(source.platform, PLATFORM_MAX, "unknown"),
      appVersion: typeof source.appVersion === "string" ? source.appVersion.slice(0, APP_VERSION_MAX) : null,
      createdAt: existing?.createdAt ?? timestamp,
      lastSeenAt: timestamp
    };
    this.records.set(deviceId, record);
    this.dirty = true;
    await this.flush();
    return { device: this.#publicInfo(record), token };
  }

  /**
   * Remove a device; its token stops working immediately.
   * @param {string} deviceId
   * @returns {Promise<boolean>} whether a device was removed
   */
  async revoke(deviceId) {
    if (typeof deviceId !== "string" || !this.records.has(deviceId)) return false;
    this.records.delete(deviceId);
    this.dirty = true;
    await this.flush();
    return true;
  }

  /** Force any pending change to disk. */
  async flush() {
    if (this.persistPromise !== null) {
      await this.persistPromise.catch(() => {});
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.lastPersistAt = this.now();
    const payload = {
      version: FILE_VERSION,
      updatedAt: this.now(),
      devices: [...this.records.values()].map((record) => ({
        deviceId: record.deviceId,
        tokenHash: record.tokenHash,
        name: record.name,
        platform: record.platform,
        appVersion: record.appVersion,
        createdAt: record.createdAt,
        lastSeenAt: record.lastSeenAt
      }))
    };
    this.persistPromise = writeJsonAtomic(this.filePath, payload)
      .catch((error) => {
        this.logger?.warn?.("dsh-remote: could not persist devices.json: " + error.message);
      })
      .finally(() => {
        this.persistPromise = null;
      });
    await this.persistPromise;
  }

  #maybePersist() {
    if (!this.dirty) return;
    if (this.persistThrottleMs <= 0) {
      void this.flush();
      return;
    }
    if (this.now() - this.lastPersistAt < this.persistThrottleMs) return;
    void this.flush();
  }

  #isExpired(record) {
    if (!(this.deviceTtlDays > 0)) return false;
    const last = typeof record.lastSeenAt === "number" ? record.lastSeenAt : record.createdAt;
    return this.now() - last > this.deviceTtlDays * DAY_MS;
  }

  #publicInfo(record) {
    return {
      deviceId: record.deviceId,
      name: record.name,
      platform: record.platform,
      appVersion: record.appVersion,
      createdAt: record.createdAt,
      lastSeenAt: record.lastSeenAt
    };
  }
}
