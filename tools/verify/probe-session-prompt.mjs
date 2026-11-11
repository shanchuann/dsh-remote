import { readFileSync } from 'node:fs';
import { DshRemoteClient } from './protocol-client.mjs';
const pairing = JSON.parse(readFileSync('D:/Code/dsh-remote/.testhome/plugins/dsh-remote/pairing.json', 'utf8'));
const c = new DshRemoteClient({ baseUrl: 'http://127.0.0.1:8790' });
await c.pair({ code: pairing.pairingCode, deviceName: 'verifier-session-probe', platform: 'android' });
const list = await c.sessions({ limit: 30 });
const targets = list.body.items.filter((r) => /verifier-e2e-ed5e78|Verifier idempotency probe/.test(String(r.title || ''))).slice(0, 3);
const out = [];
for (const row of targets) {
  const opened = await c.request('POST', '/v1/sessions/' + encodeURIComponent(row.sessionId) + '/open', { body: { maxMessages: 5, assistantStream: false } });
  const prompt = await c.request('POST', '/v1/sessions/' + encodeURIComponent(row.sessionId) + '/prompt', {
    body: { requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'client-probe ' + Date.now() }], clientTimeZone: 'Asia/Shanghai' },
  });
  out.push({ title: row.title, sessionId: row.sessionId, running: row.running, openStatus: opened.status, promptStatus: prompt.status, promptBody: prompt.body });
  await c.request('POST', '/v1/sessions/' + encodeURIComponent(row.sessionId) + '/cancel', { body: {} }).catch(() => {});
  await c.request('POST', '/v1/sessions/' + encodeURIComponent(row.sessionId) + '/close', { body: {} }).catch(() => {});
}
await c.removeDevice(c.deviceId).catch(() => {});
console.log(JSON.stringify(out, null, 2));
