/**
 * The version the package under test reports, read from plugin/package.json so
 * version bumps do not require touching every assertion.
 */
import { readFileSync } from 'node:fs';

export const PLUGIN_VERSION = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).version;
