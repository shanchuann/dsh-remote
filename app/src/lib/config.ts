/**
 * Persistence for the pairing state.
 *
 * Protocol section 6.1: the device token lives in expo-secure-store, while the
 * non-secret connection metadata (baseUrl, device name/id, host identity) lives
 * in AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { randomUuid } from './ids';
import { normalizeClientTimeZone } from './timezone';
import type { StoredConnectionMeta } from './types';

const TOKEN_KEY = 'dshremote_token';
const META_KEY = 'dshremote_connection_v1';
const WEB_TOKEN_KEY = 'dshremote_token_web';

function isWeb(): boolean {
  return Platform.OS === 'web';
}

/** Read the persisted device token (protocol 1.3). */
export async function loadToken(): Promise<string | null> {
  try {
    if (isWeb()) return await AsyncStorage.getItem(WEB_TOKEN_KEY);
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Persist the device token after a successful pairing. */
export async function saveToken(token: string): Promise<void> {
  try {
    if (isWeb()) {
      await AsyncStorage.setItem(WEB_TOKEN_KEY, token);
      return;
    }
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    // A failed secure write must not crash pairing; the next restore just asks
    // the user to pair again.
  }
}

/** Forget the device token (disconnect / re-pair). */
export async function clearToken(): Promise<void> {
  try {
    if (isWeb()) await AsyncStorage.removeItem(WEB_TOKEN_KEY);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Ignore: nothing to delete.
  }
}

/** Read persisted connection metadata. */
export async function loadConnectionMeta(): Promise<StoredConnectionMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredConnectionMeta> | null;
    if (!parsed || typeof parsed.baseUrl !== 'string' || parsed.baseUrl === '') return null;
    return {
      baseUrl: parsed.baseUrl,
      deviceId: typeof parsed.deviceId === 'string' && parsed.deviceId ? parsed.deviceId : randomUuid(),
      deviceName:
        typeof parsed.deviceName === 'string' && parsed.deviceName ? parsed.deviceName : defaultDeviceName(),
      hostId: typeof parsed.hostId === 'string' ? parsed.hostId : undefined,
      hostName: typeof parsed.hostName === 'string' ? parsed.hostName : undefined,
    };
  } catch {
    return null;
  }
}

/** Persist connection metadata. */
export async function saveConnectionMeta(meta: StoredConnectionMeta): Promise<void> {
  try {
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // Non-fatal: pairing still works for this launch.
  }
}

/** Forget connection metadata. */
export async function clearConnectionMeta(): Promise<void> {
  try {
    await AsyncStorage.removeItem(META_KEY);
  } catch {
    // Ignore.
  }
}

/** Friendly default device name shown to the host. */
export function defaultDeviceName(): string {
  if (Platform.OS === 'ios') return 'iPhone';
  if (Platform.OS === 'android') return 'Android 手机';
  return 'DSH Remote 应用';
}

/**
 * Stable per-install device id, created lazily. The host may replace it with
 * the id it returns from /v1/pair; config keeps whichever the host accepted.
 */
export async function loadOrCreateDeviceId(): Promise<string> {
  const meta = await loadConnectionMeta();
  return meta?.deviceId ?? randomUuid();
}

/** Platform string reported to the host during pairing ("android" | "ios" | "web"). */
export function platformName(): string {
  return Platform.OS;
}

/** app version reported to the host during pairing. */
export function appVersion(): string {
  const version = Constants.expoConfig?.version;
  return typeof version === 'string' && version ? version : '0.1.0';
}

/**
 * Best-effort IANA timezone sent with prompts (protocol 3.8).
 *
 * DSH only accepts "UTC" or Area/Location names; devices that report "GMT" (or
 * anything else unusual) would otherwise make every prompt fail with a host
 * internal error, so the value is normalised and dropped when untrusted.
 */
export function getClientTimeZone(): string | undefined {
  try {
    return normalizeClientTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return undefined;
  }
}
