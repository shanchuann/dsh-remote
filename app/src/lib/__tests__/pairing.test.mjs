import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPairingUri,
  displayBaseUrl,
  isValidPairingCode,
  normalizeBaseUrl,
  parsePairingUri,
  parseQueryString,
  tryNormalizeBaseUrl,
} from '../pairing.ts';

test('parses the protocol pairing QR payload with percent-encoded fields', () => {
  const raw =
    'dshremote://pair?u=http%3A%2F%2F192.168.1.23%3A8790&c=123456&h=host-uuid&n=' +
    encodeURIComponent('DESKTOP-XXX');
  const info = parsePairingUri(raw);
  assert.ok(info);
  assert.equal(info.baseUrl, 'http://192.168.1.23:8790');
  assert.equal(info.code, '123456');
  assert.equal(info.hostId, 'host-uuid');
  assert.equal(info.hostName, 'DESKTOP-XXX');
});

test('parses a pairing URI whose u parameter is not percent-encoded', () => {
  const info = parsePairingUri('dshremote://pair?u=http://10.0.0.5:8790&c=654321');
  assert.ok(info);
  assert.equal(info.baseUrl, 'http://10.0.0.5:8790');
  assert.equal(info.code, '654321');
  assert.equal(info.hostId, undefined);
});

test('parses JSON pairing payloads', () => {
  const info = parsePairingUri(
    JSON.stringify({ u: 'http://192.168.0.2:8790', c: '000111', h: 'h1', n: 'PC' }),
  );
  assert.ok(info);
  assert.equal(info.baseUrl, 'http://192.168.0.2:8790');
  assert.equal(info.code, '000111');
  assert.equal(info.hostId, 'h1');
  assert.equal(info.hostName, 'PC');
});

test('accepts a bare host URL as pairing input', () => {
  const info = parsePairingUri('http://192.168.1.9:8790/');
  assert.deepEqual(info, { baseUrl: 'http://192.168.1.9:8790' });
});

test('rejects unusable pairing input', () => {
  assert.equal(parsePairingUri(''), null);
  assert.equal(parsePairingUri('   '), null);
  assert.equal(parsePairingUri('ftp://192.168.1.2:8790'), null);
  assert.equal(parsePairingUri('http://'), null);
  assert.equal(parsePairingUri('http://user:pass@192.168.1.2:8790'), null);
  assert.equal(parsePairingUri('dshremote://pair?c=123456'), null);
});

test('normalises manual host input', () => {
  assert.equal(tryNormalizeBaseUrl('192.168.1.23:8790'), 'http://192.168.1.23:8790');
  assert.equal(tryNormalizeBaseUrl('  http://192.168.1.23:8790/  '), 'http://192.168.1.23:8790');
  assert.equal(tryNormalizeBaseUrl('https://dsh.example.com'), 'https://dsh.example.com');
  assert.equal(tryNormalizeBaseUrl('http://192.168.1.23:8790/v1'), 'http://192.168.1.23:8790');
  assert.equal(tryNormalizeBaseUrl('http://192.168.1.23:8790/pair'), 'http://192.168.1.23:8790');
  assert.equal(tryNormalizeBaseUrl(''), null);
  assert.equal(tryNormalizeBaseUrl('http://192.168.1.23:99999'), null);
});

test('normalizeBaseUrl throws a user-facing message on bad input', () => {
  assert.throws(() => normalizeBaseUrl('http://192.168.1.2:70000'), /Host 地址格式不正确/);
  assert.throws(() => normalizeBaseUrl(''), /Host 地址格式不正确/);
});

test('validates six digit pairing codes', () => {
  assert.equal(isValidPairingCode('123456'), true);
  assert.equal(isValidPairingCode(' 123456 '), true);
  assert.equal(isValidPairingCode('12345'), false);
  assert.equal(isValidPairingCode('1234567'), false);
  assert.equal(isValidPairingCode('12345a'), false);
  assert.equal(isValidPairingCode(undefined), false);
  assert.equal(isValidPairingCode(null), false);
});

test('buildPairingUri round-trips through parsePairingUri', () => {
  const info = { baseUrl: 'http://192.168.1.23:8790', code: '123456', hostId: 'h1', hostName: 'DESKTOP' };
  const parsed = parsePairingUri(buildPairingUri(info));
  assert.deepEqual(parsed, info);
});

test('parseQueryString decodes order-independently', () => {
  assert.deepEqual(parseQueryString('a=1&b=hello+world&c=%E4%BD%A0%E5%A5%BD'), {
    a: '1',
    b: 'hello world',
    c: '你好',
  });
  assert.deepEqual(parseQueryString(''), {});
});

test('displayBaseUrl hides the scheme', () => {
  assert.equal(displayBaseUrl('http://192.168.1.23:8790'), '192.168.1.23:8790');
  assert.equal(displayBaseUrl(undefined), '—');
});
