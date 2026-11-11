/**
 * Stable host identity. The protocol's hostId must survive restarts (it is how
 * the App recognizes the same computer), so it is minted once and persisted at
 * <DSH_HOME>/plugins/dsh-remote/host.json.
 */
import { randomUUID } from "node:crypto";
import { readJson, writeJsonAtomic } from "./atomic.mjs";

/**
 * @typedef {{hostId: string, name: string, createdAt: number}} HostState
 */

/**
 * Load the persisted host identity, minting and saving one on first run.
 * @param {string} file
 * @param {{now?: () => number, hostName?: string, logger?: {warn?: Function}}} [options]
 * @returns {Promise<HostState>}
 */
export async function loadHostState(file, options) {
  const settings = options ?? {};
  const now = settings.now ?? Date.now;
  const defaultName = settings.hostName ?? "dsh-host";
  const loaded = await readJson(file, null, {
    now: now(),
    onCorrupt: (error, movedTo) => settings.logger?.warn?.(
      "dsh-remote: host.json unreadable (" + error.message + "); starting fresh" +
      (movedTo ? " (moved to " + movedTo + ")" : "")
    )
  });
  const value = loaded.value;
  if (value !== null && typeof value === "object" && typeof value.hostId === "string" && value.hostId.length > 0) {
    return {
      hostId: value.hostId,
      name: typeof value.name === "string" && value.name.length > 0 ? value.name : defaultName,
      createdAt: typeof value.createdAt === "number" ? value.createdAt : now()
    };
  }
  const state = { hostId: randomUUID(), name: defaultName, createdAt: now() };
  await writeJsonAtomic(file, state).catch((error) => {
    settings.logger?.warn?.("dsh-remote: could not persist host.json: " + error.message);
  });
  return state;
}
