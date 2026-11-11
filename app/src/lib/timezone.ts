/**
 * Normalise the IANA timezone reported by the device before it goes into the
 * prompt payload (protocol 3.8 clientTimeZone).
 *
 * DSH rejects anything that is not "UTC" or an Area/Location IANA name with a
 * 500 internal error ("clientTimeZone must be UTC or a valid IANA Area/Location
 * name"). Some Android builds/emulators report the bare abbreviation "GMT",
 * which used to make every send fail on the host. Unknown values are omitted
 * instead (the field is optional and DSH accepts a missing value).
 *
 * Pure: no React Native imports, unit tested with node --test.
 */

const BARE_UTC =
  /^(?:UTC|GMT|Etc\/UTC|Etc\/GMT|Etc\/GMT\+0|Etc\/GMT-0|Greenwich|Coordinated Universal Time|Universal Time)$/i;
// IANA "Area/Location" (one or more "/" segments). Rejects abbreviations such
// as "CST", fixed offsets such as "+08:00" and the lone "GMT".
const AREA_LOCATION = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+.-]+)+$/;

/** Returns a host-acceptable timezone, or undefined when it cannot be trusted. */
export function normalizeClientTimeZone(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  if (BARE_UTC.test(value)) return 'UTC';
  if (AREA_LOCATION.test(value)) return value;
  return undefined;
}
