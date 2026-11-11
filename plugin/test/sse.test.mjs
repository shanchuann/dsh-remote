import test from "node:test";
import assert from "node:assert/strict";
import { EventHub, encodeFrame } from "../src/net/sse.mjs";
import { pairDevice, openSse, request, startHarness } from "./helpers/harness.mjs";

async function withSse(body) {
  const harness = await startHarness();
  const paired = await pairDevice(harness);
  const sse = await openSse(harness.baseUrl, paired.token);
  try {
    return await body({ harness, paired, sse });
  } finally {
    await sse.close();
    await harness.close();
  }
}

test("encodeFrame writes id/event/data and a blank line", () => {
  const frame = encodeFrame({ id: 42, event: "session.event", data: { a: 1 } });
  assert.equal(frame, "id: 42\nevent: session.event\ndata: {\"a\":1}\n\n");
  const ping = encodeFrame({ event: "ping", data: { t: 1 } });
  assert.equal(ping, "event: ping\ndata: {\"t\":1}\n\n");
});

test("hello arrives first and reports protocol plus subscriptions", async () => {
  await withSse(async ({ sse }) => {
    const hello = await sse.waitFor("hello");
    assert.equal(hello.data.protocol, 1);
    assert.equal(typeof hello.data.serverTime, "number");
    assert.match(hello.data.hostId, /^[0-9a-f-]{36}$/);
    assert.deepEqual(hello.data.subscriptions, []);
    assert.equal(sse.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(sse.headers.get("cache-control"), "no-cache, no-store");
  });
});

test("open pushes a snapshot, then events, assistant frames, and state", async () => {
  await withSse(async ({ harness, paired, sse }) => {
    await sse.waitFor("hello");
    const opened = await request(harness.baseUrl, "/v1/sessions/session-1/open", { method: "POST", token: paired.token, body: { maxMessages: 60 } });
    assert.equal(opened.status, 200);
    assert.match(opened.body.subscriptionId, /^sub_/);
    assert.equal(opened.body.sessionId, "session-1");

    const snapshot = await sse.waitFor("session.snapshot");
    assert.equal(snapshot.data.subscriptionId, opened.body.subscriptionId);
    assert.equal(snapshot.data.sessionId, "session-1");
    assert.equal(snapshot.data.header.id, "session-1");
    assert.deepEqual(snapshot.data.records, []);
    assert.equal(snapshot.data.hasMore, false);
    assert.equal(typeof snapshot.data.cursor, "number");
    assert.ok(snapshot.data.projections);

    const userEvent = { type: "user/message", seq: 8, time: 1, data: { role: "user", content: [{ type: "text", text: "hi" }] } };
    harness.bridge.emit("session-1", "event", userEvent);
    const event = await sse.waitFor("session.event");
    assert.equal(event.data.subscriptionId, opened.body.subscriptionId);
    assert.equal(event.data.sessionId, "session-1");
    assert.deepEqual(event.data.event, userEvent);

    const assistantFrame = { type: "chunk", attemptId: "a1", revision: 3, index: 1, chunk: { type: "text-delta", index: 0, text: "PONG" } };
    harness.bridge.emit("session-1", "assistant", assistantFrame);
    const assistant = await sse.waitFor("session.assistant");
    assert.equal(assistant.data.subscriptionId, opened.body.subscriptionId);
    assert.deepEqual(assistant.data.frame, assistantFrame);

    const state = { active: true, running: true, queue: [], pendingInput: [] };
    harness.bridge.emit("session-1", "state", state);
    const stateEvent = await sse.waitFor("session.state");
    assert.deepEqual(stateEvent.data.state, state);

    harness.bridge.emit("session-1", "mystery-kind", { foo: 1 });
    const other = await sse.waitFor("session.other");
    assert.deepEqual(other.data.frame, { foo: 1 });
  });
});

test("opening the same session twice replaces the previous subscription", async () => {
  await withSse(async ({ harness, paired, sse }) => {
    await sse.waitFor("hello");
    const first = await request(harness.baseUrl, "/v1/sessions/session-1/open", { method: "POST", token: paired.token, body: {} });
    assert.equal(first.status, 200);
    await sse.waitFor("session.snapshot");
    const second = await request(harness.baseUrl, "/v1/sessions/session-1/open", { method: "POST", token: paired.token, body: {} });
    assert.equal(second.status, 200);
    assert.notEqual(first.body.subscriptionId, second.body.subscriptionId);
    const snapshot = await sse.waitForMatching("session.snapshot", (frame) => frame.data.subscriptionId === second.body.subscriptionId);
    assert.equal(snapshot.data.sessionId, "session-1");
    const closed = await sse.waitForMatching("subscription.closed", (frame) => frame.data.subscriptionId === first.body.subscriptionId);
    assert.equal(closed.data.reason, "replaced");
    assert.equal(harness.bridge.follows.size, 1);
  });
});

test("close ends the subscription and is idempotent", async () => {
  await withSse(async ({ harness, paired, sse }) => {
    await sse.waitFor("hello");
    const opened = await request(harness.baseUrl, "/v1/sessions/session-1/open", { method: "POST", token: paired.token, body: {} });
    await sse.waitFor("session.snapshot");
    const closed = await request(harness.baseUrl, "/v1/sessions/session-1/close", { method: "POST", token: paired.token });
    assert.deepEqual(closed.body, { closed: true });
    const frame = await sse.waitForMatching("subscription.closed", (item) => item.data.subscriptionId === opened.body.subscriptionId);
    assert.equal(frame.data.reason, "closed");
    const again = await request(harness.baseUrl, "/v1/sessions/session-1/close", { method: "POST", token: paired.token });
    assert.equal(again.status, 200);
    assert.equal(harness.bridge.follows.size, 0);
  });
});

test("bridge stream errors close the subscription instead of leaving it dangling", async () => {
  await withSse(async ({ harness, paired, sse }) => {
    await sse.waitFor("hello");
    const opened = await request(harness.baseUrl, "/v1/sessions/session-1/open", { method: "POST", token: paired.token, body: {} });
    await sse.waitFor("session.snapshot");
    harness.bridge.emit("session-1", "error", { code: "stream-unavailable", message: "controller aborted" });
    const errorFrame = await sse.waitFor("error");
    assert.equal(errorFrame.data.code, "stream-unavailable");
    const closed = await sse.waitForMatching("subscription.closed", (frame) => frame.data.subscriptionId === opened.body.subscriptionId);
    assert.equal(closed.data.reason, "stream-error");
    assert.equal(harness.bridge.follows.size, 0);
  });
});

test("a second SSE connection replaces the first one", async () => {
  const harness = await startHarness();
  try {
    const paired = await pairDevice(harness);
    const first = await openSse(harness.baseUrl, paired.token);
    await first.waitFor("hello");
    const second = await openSse(harness.baseUrl, paired.token);
    try {
      const replaced = await first.waitFor("connection.replaced");
      assert.deepEqual(replaced.data, { reason: "replaced" });
      await second.waitFor("hello");
      await first.close();
    } finally {
      await second.close();
    }
  } finally {
    await harness.close();
  }
});

test("EventHub pings each connection on its interval", async () => {
  const chunks = [];
  const res = {
    writableEnded: false,
    destroyed: false,
    writeHead: () => {},
    flushHeaders: () => {},
    write: (chunk) => chunks.push(chunk),
    end: () => { res.writableEnded = true; },
    on: () => {}
  };
  const hub = new EventHub({ pingIntervalMs: 10, now: () => 7 });
  hub.start();
  hub.add({ deviceId: "dev-1", res });
  await new Promise((resolve) => setTimeout(resolve, 35));
  hub.stop();
  const pings = chunks.filter((chunk) => chunk.includes("event: ping"));
  assert.ok(pings.length >= 1, "expected at least one ping, saw " + chunks.join("|"));
  assert.ok(pings[0].includes("data: {\"t\":7}"));
  assert.equal(hub.deviceCount(), 0);
  assert.equal(hub.hasDevices(), false);
});

test("a revoked device gets an unauthorized error frame", async () => {
  const harness = await startHarness();
  try {
    const paired = await pairDevice(harness);
    const sse = await openSse(harness.baseUrl, paired.token);
    try {
      await sse.waitFor("hello");
      const removed = await request(harness.baseUrl, "/v1/devices/" + paired.deviceId, { method: "DELETE", token: paired.token });
      assert.equal(removed.status, 200);
      const errorFrame = await sse.waitFor("error");
      assert.equal(errorFrame.data.code, "unauthorized");
    } finally {
      await sse.close();
    }
  } finally {
    await harness.close();
  }
});
