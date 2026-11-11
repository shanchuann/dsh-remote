/**
 * Small atomic file helpers. Every persisted file is written to a sibling
 * temporary file and renamed into place, so a crash or a concurrent reader
 * never observes a half-written device registry or pairing descriptor.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

/** @param {string} dir */
export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

/**
 * Write a file atomically.
 * @param {string} file
 * @param {string|Buffer} content
 * @param {{mode?: number, fsync?: boolean}} [options]
 */
export async function writeFileAtomic(file, content, options) {
  const settings = options ?? {};
  const dir = dirname(file);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, ".tmp-" + process.pid + "-" + randomBytes(6).toString("hex"));
  const handle = await open(temp, "w", settings.mode ?? 0o600);
  try {
    await handle.writeFile(content);
    if (settings.fsync !== false) await handle.sync().catch(() => {});
  } finally {
    await handle.close();
  }
  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Atomically write pretty JSON plus a trailing newline.
 * @param {string} file
 * @param {unknown} value
 */
export async function writeJsonAtomic(file, value) {
  await writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n");
}

/**
 * Read JSON; a missing or unreadable file yields the fallback. A corrupt file
 * is moved aside as ".corrupt-<timestamp>" so the next write starts clean
 * instead of silently discarding evidence.
 * @template T
 * @param {string} file
 * @param {T} fallback
 * @param {{onCorrupt?: (error: Error, movedTo: string|null) => void, now?: number}} [options]
 * @returns {Promise<{value: T, existed: boolean}>}
 */
export async function readJson(file, fallback, options) {
  const settings = options ?? {};
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { value: fallback, existed: false };
  }
  try {
    const parsed = JSON.parse(text);
    return { value: parsed ?? fallback, existed: true };
  } catch (error) {
    const movedTo = file + ".corrupt-" + String(settings.now ?? Date.now());
    await rename(file, movedTo).catch(() => {});
    if (settings.onCorrupt) settings.onCorrupt(error, movedTo);
    return { value: fallback, existed: true };
  }
}
