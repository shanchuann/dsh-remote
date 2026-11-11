import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeClientTimeZone } from '../timezone.ts';

test('bare UTC abbreviations become UTC', () => {
  for (const value of [
    'GMT',
    'gmt',
    'UTC',
    'utc',
    'Etc/UTC',
    'Etc/GMT',
    'Etc/GMT+0',
    'Etc/GMT-0',
    ' GMT ',
    'Greenwich',
    'Coordinated Universal Time',
    'Universal Time',
  ]) {
    assert.equal(normalizeClientTimeZone(value), 'UTC', String(value));
  }
});

test('Area/Location IANA names pass through', () => {
  assert.equal(normalizeClientTimeZone('Asia/Shanghai'), 'Asia/Shanghai');
  assert.equal(normalizeClientTimeZone('America/Argentina/Buenos_Aires'), 'America/Argentina/Buenos_Aires');
  assert.equal(normalizeClientTimeZone('Etc/GMT-8'), 'Etc/GMT-8');
  assert.equal(normalizeClientTimeZone('Europe/London'), 'Europe/London');
});

test('unsupported values are omitted instead of failing the prompt', () => {
  assert.equal(normalizeClientTimeZone('CST'), undefined);
  assert.equal(normalizeClientTimeZone('GMT+8'), undefined);
  assert.equal(normalizeClientTimeZone('+08:00'), undefined);
  assert.equal(normalizeClientTimeZone('GMT+08:00'), undefined);
  assert.equal(normalizeClientTimeZone(''), undefined);
  assert.equal(normalizeClientTimeZone('   '), undefined);
  assert.equal(normalizeClientTimeZone(undefined), undefined);
  assert.equal(normalizeClientTimeZone(null), undefined);
});

test('never returns a bare non-UTC word', () => {
  for (const value of ['PST', 'EST', 'CET', 'JST', 'GMT0', 'Universal']) {
    assert.equal(normalizeClientTimeZone(value), undefined, value);
  }
});
