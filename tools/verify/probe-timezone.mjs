import { readFileSync } from 'node:fs';
import { DshRemoteClient } from './protocol-client.mjs';
const pairing = JSON.parse(readFileSync('D:/Code/dsh-remote/.testhome/plugins/dsh-remote/pairing.json', 'utf8'));
const c = new DshRemoteClient({ baseUrl: 'http://127.0.0.1:8790' });
await c.pair({ code: pairing.pairingCode, deviceName: 'verifier-tz-probe', platform: 'android' });
const session = await c.createSession({ agentPreset: 'standard' });
const id = session.body.sessionId;
const variants = [
  ['Asia/Shanghai', 'Asia/Shanghai'],
  ['GMT', 'GMT'],
  ['UTC', 'UTC'],
  ['Etc/GMT-8', 'Etc/GMT-8'],
  ['omitted', undefined],
];
const out = [];
for (const [label, tz] of variants) {
  const body = { requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'tz-probe ' + label }] };
  if (tz !== undefined) body.clientTimeZone = tz;
  const r = await c.request('POST', '/v1/sessions/' + encodeURIComponent(id) + '/prompt', { body });
  out.push({ label, status: r.status, body: r.body });
  await c.request('POST', '/v1/sessions/' + encodeURIComponent(id) + '/cancel', { body: {} }).catch(() => {});
}
await c.removeDevice(c.deviceId).catch(() => {});
console.log(JSON.stringify(out, null, 2));
