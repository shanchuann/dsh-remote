import { appendFileSync } from 'node:fs';
import { DshBridge } from '../../src/dsh/bridge.mjs';

export const name = 'dsh-remote-bridge-probe';
export const inject = ['sessionController'];

const LOG = 'D:\\Code\\dsh-remote\\.testhome\\bridge-probe.log';
function log(kind, data) {
  try { appendFileSync(LOG, JSON.stringify({ t: Date.now(), kind, data }) + '\n'); } catch (error) { console.error(error); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function apply(ctx) {
  const bridge = new DshBridge(ctx, {
    handlers: {
      onSessionAdded: (row) => log('cb-added', row),
      onSessionRemoved: (id) => log('cb-removed', id),
      onSessionStatus: (info) => log('cb-status', info),
      onApprovalRequest: (req) => log('cb-approval', req),
      onApprovalResolved: (info) => log('cb-approval-resolved', info)
    },
    hasMobileClients: () => false
  });
  setTimeout(async () => {
    try {
      await bridge.init();
      log('hostInfo', bridge.hostInfo());
      const list = await bridge.listSessions({ limit: 10 });
      log('list', list);
      const first = list.items[0];
      if (first) {
        log('getSession', await bridge.getSession(first.sessionId));
        log('history', await bridge.history(first.sessionId, { maxMessages: 8 }));
        const ac = new AbortController();
        const handle = await bridge.openFollow(first.sessionId, { maxMessages: 10, assistantStream: true }, (kind, payload) => {
          if (kind === 'snapshot') log('follow-snapshot', { keys: Object.keys(payload), records: payload.records.length, cursor: payload.cursor, hasMore: payload.hasMore, header: payload.header });
          else if (kind === 'event') log('follow-event', payload.type);
          else if (kind === 'assistant') log('follow-assistant', payload.type);
          else log('follow-' + kind, payload);
        });
        await sleep(1500);
        log('prompt', await bridge.prompt(first.sessionId, { requestId: 'probe-req-' + Date.now(), content: [{ type: 'text', text: 'Say OK only.' }], mode: 'queue', clientTimeZone: 'Asia/Shanghai' }));
        await sleep(25000);
        handle.subscription.close();
        await sleep(300);
        log('final-list', await bridge.listSessions({}));
        await bridge.dispose();
        log('done', {});
      } else {
        log('no-session', list);
      }
    } catch (error) {
      log('probe-error', String((error && error.stack) || error));
    }
  }, 3000);
}
