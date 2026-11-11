/**
 * Id helpers. requestId values must be unique per client; deviceId should stay
 * stable across launches (it is persisted in config.ts).
 */

/** RFC 4122 version 4 UUID using the platform CSPRNG when available. */
export function randomUuid(): string {
  const cryptoObject = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (array: Uint8Array) => Uint8Array } })
    .crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
    try {
      return cryptoObject.randomUUID();
    } catch {
      // Fall through to the manual path.
    }
  }
  const bytes = new Uint8Array(16);
  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    cryptoObject.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i += 1) hex.push(bytes[i]!.toString(16).padStart(2, '0'));
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}

/** Monotonic-ish id for locally created items (not a UUID). */
export function createLocalId(prefix = 'local'): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
