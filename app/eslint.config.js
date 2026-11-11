/* global __dirname -- this config runs in Node (CJS), not in the app bundle. */
// https://docs.expo.dev/guides/using-eslint/
//
// The beUI Native component library (src/components/<slug>, src/primitives,
// src/hooks) is vendored third-party code that we must not edit. It trips
// React Compiler lint rules (refs/immutability) inside the library itself, so
// those directories are lint-ignored; app-owned code stays fully linted.
const fs = require('node:fs');
const path = require('node:path');
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const APP_OWNED_COMPONENT_DIRS = new Set(['common', 'chat']);
const beuiDirs = fs
  .readdirSync(path.join(__dirname, 'src/components'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !APP_OWNED_COMPONENT_DIRS.has(entry.name))
  .map((entry) => 'src/components/' + entry.name + '/**');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'src/primitives/**', 'src/hooks/**', ...beuiDirs],
  },
]);
