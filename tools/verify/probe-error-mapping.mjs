import { readFileSync } from 'node:fs';
import { DshRemoteClient } from './protocol-client.mjs';
const pairing = JSON.parse(readFileSync('D:/Code/dsh-remote/.testhome/plugins/dsh-remote/pairing.json', 'utf8'));
const c = new DshRemoteClient({ baseUrl: 'http://127.0.0.1:8790' });
const pair = await c.pair({ code: pairing.pairingCode, deviceName: 'verifier-model-probe', platform: 'android' });
const session = await c.createSession({ agentPreset: 'standard' });
const out = { pairStatus: pair.status, sessionId: session.body.sessionId };
for (const [label, body] of [
  ['unknown-provider', { provider: 'no-such-provider-xyz', model: 'x' }],
  ['unknown-model-known-provider', { provider: 'opencode-go', model: 'no-such-model-xyz' }],
]) {
  const r = await c.request('POST', '/v1/sessions/' + encodeURIComponent(session.body.sessionId) + '/model', { body });
  out[label] = { status: r.status, code: r.body && r.body.error ? r.body.error.code : null, message: r.body && r.body.error ? r.body.error.message : null };
}
// unknown rename / history for completeness
const rename = await c.request('POST', '/v1/sessions/session-does-not-exist-xyz/rename', { body: { title: 'x' } });
out['unknown-rename'] = { status: rename.status, code: rename.body && rename.body.error ? rename.body.error.code : null };
const history = await c.request('GET', '/v1/sessions/session-does-not-exist-xyz/history?maxMessages=5');
out['unknown-history'] = { status: history.status, code: history.body && history.body.error ? history.body.error.code : null };
await c.removeDevice(c.deviceId).catch(() => {});
console.log(JSON.stringify(out, null, 2));
