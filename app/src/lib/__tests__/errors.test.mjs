import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiError, describeError, isApiError } from '../errors.ts';

test('maps known protocol codes to Chinese copy', () => {
  assert.equal(describeError(new ApiError(401, 'unauthorized')), '认证已失效，请重新配对');
  assert.equal(describeError(new ApiError(401, 'pairing-invalid')), '配对码错误或已过期');
});

test('keeps the server detail next to the mapped message', () => {
  const error = new ApiError(500, 'internal', 'send prompt failed: boom');
  const text = describeError(error);
  assert.match(text, /Host 内部错误/);
  assert.match(text, /send prompt failed: boom/);
});

test('uses the server message for unknown codes', () => {
  const error = new ApiError(400, 'weird-code', '具体的服务端说明');
  assert.equal(describeError(error), '具体的服务端说明');
});

test('normalises network failures and plain errors', () => {
  assert.match(describeError(new Error('Network request failed')), /无法连接 Host/);
  assert.equal(describeError('中文错误'), '中文错误');
  assert.equal(describeError(undefined), '未知错误');
});

test('isApiError detects client errors structurally', () => {
  assert.equal(isApiError(new ApiError(410, 'approval-gone')), true);
  assert.equal(isApiError(new Error('x')), false);
  assert.equal(isApiError(null), false);
});
