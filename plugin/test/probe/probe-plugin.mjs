import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const name = 'dsh-remote-probe';
export const inject = ['sessionController'];

const LOG = process.env.PROBE_LOG ?? 'D:\\Code\\dsh-remote\\.testhome\\probe.log';
function log(kind, data) {
  try { appendFileSync(LOG, JSON.stringify({ t: Date.now(), kind, data }) + '\n'); } catch (error) { console.error(error); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function apply(ctx) {
  log('apply', {});
  for (const key of ['sessions', 'agents', 'userApproval', 'userQuestions', 'approval', 'llm', 'settings', 'webServer', 'typertGateway', 'permission', 'sessionPersistence']) {
    let value; try { value = ctx.get(key); } catch (error) { value = 'throw:' + error.message; }
    log('service', { key, type: value === undefined ? 'undefined' : typeof value, keys: value && typeof value === 'object' ? Object.getOwnPropertyNames(Object.getPrototypeOf(value)).slice(0, 30) : undefined });
  }
  ctx.on('api-session/added', (summary) => log('api-session/added', summary));
  ctx.on('api-session/status', (sessionId, running) => log('api-session/status', { sessionId, running }));
  ctx.on('api-session/removed', (sessionId) => log('api-session/removed', sessionId));
  ctx.on('agent/created', (payload) => log('agent/created', { keys: Object.keys(payload ?? {}) }));

  setTimeout(async () => {
    const controller = ctx.get('sessionController');
    const signal = () => new AbortController().signal;
    try {
      let list = await controller.list({}, signal());
      log('list-initial', list);
      if (list.items.length === 0) {
        const created = await controller.create({ cwd: 'D:\\Code\\dsh-remote\.testhome\\ws' });
        log('create', created);
        await sleep(500);
        list = await controller.list({}, signal());
        log('list-after-create', list);
      }
      const session = list.items[0];
      log('state', await controller.state({ sessionId: session.sessionId }, signal()));
      const ac = new AbortController();
      const frames = [];
      const follow = controller.follow({ address: { kind: 'session', sessionId: session.sessionId }, activate: true, assistantStream: true, maxMessages: 20 }, ac.signal);
      const reader = (async () => {
        let n = 0;
        try {
          for await (const frame of follow) {
            n += 1;
            if (n <= 40) log('frame', frame);
            if (frame?.type === 'event' && frame.event?.type === 'turn/end') { log('saw-turn-end', { n }); break; }
          }
        } catch (error) { log('follow-error', String(error?.stack ?? error)); }
        log('follow-done', { n });
        ac.abort();
      })();
      await sleep(1200);
      const prompt = await controller.prompt({ requestId: randomUUID(), sessionId: session.sessionId, mode: 'queue', content: [{ type: 'text', text: 'Reply with exactly the word PONG and nothing else.' }], clientTimeZone: 'Asia/Shanghai' }, signal());
      log('prompt', prompt);
      await Promise.race([reader, sleep(90000)]);
      log('final-list', await controller.list({}, signal()));
    } catch (error) {
      log('probe-error', String(error?.stack ?? error));
    }
  }, 3000);
}
