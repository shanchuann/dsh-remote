import test from "node:test";
import assert from "node:assert/strict";
import { FakeBridge, makeSessionRow } from "./helpers/fake-bridge.mjs";
import { pairDevice, request, startHarness } from "./helpers/harness.mjs";

/** Boot a harness, run a body, always close both the listener and the temp home. */
async function withHarness(options, body) {
  const harness = await startHarness(options);
  try {
    return await body(harness);
  } finally {
    await harness.close();
  }
}

test("GET /v1/health is public and reports host identity", async () => {
  await withHarness({}, async ({ baseUrl, runtime }) => {
    const response = await request(baseUrl, "/v1/health");
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.name, "dsh-remote");
    assert.equal(response.body.protocol, 1);
    assert.equal(response.body.hostId, runtime.hostState.hostId);
    assert.equal(response.body.pairingRequired, true);
    assert.equal(typeof response.body.time, "number");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-type"), /application\/json; charset=utf-8/);
  });
});

test("protected routes require a bearer token", async () => {
  await withHarness({}, async ({ baseUrl }) => {
    for (const path of ["/v1/host", "/v1/sessions", "/v1/devices", "/v1/approvals", "/v1/models"]) {
      const anonymous = await request(baseUrl, path);
      assert.equal(anonymous.status, 401, path);
      assert.equal(anonymous.body.error.code, "unauthorized", path);
      const bogus = await request(baseUrl, path, { token: "f".repeat(64) });
      assert.equal(bogus.status, 401, path);
    }
  });
});

test("query-string tokens are only accepted on the SSE endpoint", async () => {
  await withHarness({}, async (harness) => {
    const paired = await pairDevice(harness);
    const response = await request(harness.baseUrl, "/v1/host?token=" + paired.token);
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "unauthorized");
    // The same token works in the query for EventSource, which cannot set headers.
    const sseResponse = await fetch(harness.baseUrl + "/v1/events?token=" + paired.token);
    assert.equal(sseResponse.status, 200);
    assert.match(sseResponse.headers.get("content-type"), /text\/event-stream/);
    await sseResponse.body.cancel();
  });
});

test("GET /v1/host exposes capabilities and the current device flag", async () => {
  await withHarness({}, async (harness) => {
    const paired = await pairDevice(harness);
    const response = await request(harness.baseUrl, "/v1/host", { token: paired.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.hostId, harness.runtime.hostState.hostId);
    assert.equal(response.body.protocol, 1);
    assert.equal(response.body.pluginVersion, "0.1.0");
    assert.equal(response.body.capabilities.assistantStream, true);
    assert.equal(response.body.capabilities.approvals, true);
    assert.equal(response.body.capabilities.images, true);
    assert.equal(response.body.defaultCwd, "D:\\Code\\demo");
    assert.equal(response.body.devices.length, 1);
    assert.equal(response.body.devices[0].current, true);
    assert.equal(response.body.devices[0].name, "Pixel 9");
  });
});

test("GET /v1/sessions forwards limit and returns rows", async () => {
  await withHarness({}, async (harness) => {
    const paired = await pairDevice(harness);
    const response = await request(harness.baseUrl, "/v1/sessions?limit=5", { token: paired.token });
    assert.equal(response.status, 200);
    assert.equal(response.body.items.length, 1);
    assert.equal(response.body.nextCursor, null);
    assert.deepEqual(harness.bridge.listRequests.at(-1), { limit: 5, cursor: null });
    assert.equal(response.body.items[0].sessionId, "session-1");
    assert.equal(response.body.items[0].agentPreset, "standard");
  });
});

test("GET /v1/sessions/:id returns the snapshot and maps bridge errors", async () => {
  await withHarness({}, async (harness) => {
    const paired = await pairDevice(harness);
    const found = await request(harness.baseUrl, "/v1/sessions/session-1", { token: paired.token });
    assert.equal(found.status, 200);
    assert.equal(found.body.sessionId, "session-1");
    assert.equal(found.body.header.id, "session-1");
    const missing = await request(harness.baseUrl, "/v1/sessions/session-nope", { token: paired.token });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, "session-not-found");
  });
});

test("POST /v1/sessions creates a session and validates cwd", async () => {
  await withHarness({}, async (harness) => {
    const paired = await pairDevice(harness);
    const created = await request(harness.baseUrl, "/v1/sessions", {
      method: "POST",
      token: paired.token,
      body: { cwd: "D:\\Code\\demo", agentPreset: "standard" }
    });
    assert.equal(created.status, 200);
    assert.match(created.body.sessionId, /^session-/);
    assert.equal(created.body.agentPreset, "standard");
    assert.deepEqual(harness.bridge.createCalls.at(-1), { cwd: "D:\\Code\\demo", agentPreset: "standard" });
    const invalid = await request(harness.baseUrl, "/v1/sessions", { method: "POST", token: paired.token, body: { cwd: 42 } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "invalid-argument");
  });
});

test("history is sorted by seq and forwards paging options", async () => {
  const records = [
    { type: "event", event: { type: "user/message", seq: 5 } },
    { type: "event", event: { type: "assistant/message", seq: 2 } }
  ];
  const fake = new FakeBridge({ historyRecords: { "session-1": records } });
  await withHarness({ fake }, async (harness) => {
    const paired = await pairDevice(harness);
    const response = await request(harness.baseUrl, "/v1/sessions/session-1/history?beforeSeq=9&maxMessages=10", { token: paired.token });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.records.map((record) => record.event.seq), [2, 5]);
    assert.equal(response.body.cursor, 2);
    assert.equal(response.body.hasMore, false);
    assert.deepEqual(harness.bridge.historyRequests.at(-1), { sessionId: "session-1", options: { maxMessages: 10, beforeSeq: 9 } });
  });
});

test("cancel, rename, and model selection forward validated payloads", async () => {
  await withHarness({}, async (harness) => {
    const paired = await pairDevice(harness);
    const cancelled = await request(harness.baseUrl, "/v1/sessions/session-1/cancel", { method: "POST", token: paired.token });
    assert.equal(cancelled.status, 200);
    assert.deepEqual(cancelled.body, { accepted: true });
    assert.deepEqual(harness.bridge.cancelCalls, ["session-1"]);

    const renamed = await request(harness.baseUrl, "/v1/sessions/session-1/rename", { method: "POST", token: paired.token, body: { title: "全新标题" } });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.title, "全新标题");
    assert.equal(renamed.body.seq, 42);
    assert.deepEqual(harness.bridge.renameCalls.at(-1), { sessionId: "session-1", title: "全新标题" });

    const blankTitle = await request(harness.baseUrl, "/v1/sessions/session-1/rename", { method: "POST", token: paired.token, body: { title: "   " } });
    assert.equal(blankTitle.status, 400);

    const selected = await request(harness.baseUrl, "/v1/sessions/session-1/model", {
      method: "POST",
      token: paired.token,
      body: { provider: "opencode-go", model: "deepseek-v4.1-flash", reasoningEffort: "high" }
    });
    assert.equal(selected.status, 200);
    assert.deepEqual(selected.body.selected, { provider: "opencode-go", model: "deepseek-v4.1-flash", reasoningEffort: "high" });
    assert.deepEqual(harness.bridge.modelCalls.at(-1).selection, { provider: "opencode-go", model: "deepseek-v4.1-flash", reasoningEffort: "high" });

    const catalog = await request(harness.baseUrl, "/v1/models", { token: paired.token });
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.default.model, "deepseek-v4.1-flash");
  });
});

test("out-of-catalog model selection is 400 invalid-argument, not 500", async () => {
  await withHarness({}, async (harness) => {
    const paired = await pairDevice(harness);
    const invalidSelections = [
      { provider: "no-such-provider", model: "x" },
      { provider: "opencode-go", model: "no-such-model" }
    ];
    for (const selection of invalidSelections) {
      const rejected = await request(harness.baseUrl, "/v1/sessions/session-1/model", { method: "POST", token: paired.token, body: selection });
      assert.equal(rejected.status, 400, JSON.stringify(selection));
      assert.equal(rejected.body.error.code, "invalid-argument");
      assert.match(rejected.body.error.message, /Select an available model/);
    }
    const accepted = await request(harness.baseUrl, "/v1/sessions/session-1/model", {
      method: "POST",
      token: paired.token,
      body: { provider: "opencode-go", model: "deepseek-v4.1-flash", reasoningEffort: "high" }
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.selected.model, "deepseek-v4.1-flash");
  });
});

test("unknown sessions map to 404 session-not-found, never 500 or 200", async () => {
  await withHarness({}, async (harness) => {
    const paired = await pairDevice(harness);
    const unknown = "/v1/sessions/session-verifier-missing";
    const cases = [
      { method: "POST", path: unknown + "/prompt", body: { requestId: "req-missing", content: [{ type: "text", text: "hi" }] } },
      { method: "POST", path: unknown + "/cancel", body: {} },
      { method: "POST", path: unknown + "/rename", body: { title: "x" } },
      { method: "POST", path: unknown + "/model", body: { provider: "p", model: "m" } },
      { method: "GET", path: unknown + "/history" },
      { method: "POST", path: unknown + "/open", body: { maxMessages: 5 } }
    ];
    for (const testCase of cases) {
      const response = await request(harness.baseUrl, testCase.path, { method: testCase.method, token: paired.token, body: testCase.body });
      assert.equal(response.status, 404, testCase.method + " " + testCase.path + " -> " + response.status + " " + response.text);
      assert.equal(response.body.error.code, "session-not-found", testCase.method + " " + testCase.path);
    }
    // open() must reject before creating a subscription or a follow handle.
    assert.equal(harness.bridge.follows.size, 0);
  });
});

test("device listing and deletion are consistent", async () => {
  await withHarness({}, async (harness) => {
    const paired = await pairDevice(harness);
    const listed = await request(harness.baseUrl, "/v1/devices", { token: paired.token });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.items.length, 1);
    assert.equal(listed.body.items[0].current, true);
    const removed = await request(harness.baseUrl, "/v1/devices/" + paired.deviceId, { method: "DELETE", token: paired.token });
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body, { removed: true });
    const afterwards = await request(harness.baseUrl, "/v1/host", { token: paired.token });
    assert.equal(afterwards.status, 401);
  });
});

test("unknown endpoints, wrong methods, and oversized bodies fail cleanly", async () => {
  await withHarness({}, async (harness) => {
    const paired = await pairDevice(harness);
    const unknown = await request(harness.baseUrl, "/v1/nope", { token: paired.token });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, "invalid-argument");
    const wrongMethod = await request(harness.baseUrl, "/v1/health", { method: "DELETE" });
    assert.equal(wrongMethod.status, 405);
    const options = await fetch(harness.baseUrl + "/v1/host", { method: "OPTIONS" });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get("access-control-allow-origin"), "*");
    const oversized = await request(harness.baseUrl, "/v1/pair", {
      method: "POST",
      rawBody: JSON.stringify({ code: "123456", padding: "x".repeat(70 * 1024) })
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.error.code, "invalid-argument");
  });
});

test("session.added and session.status broadcasts reach the device stream", async () => {
  await withHarness({}, async (harness) => {
    const paired = await pairDevice(harness);
    const { openSse } = await import("./helpers/harness.mjs");
    const sse = await openSse(harness.baseUrl, paired.token);
    try {
      const row = makeSessionRow({ sessionId: "session-new", title: "新会话" });
      harness.bridge.emitSessionAdded(row);
      const added = await sse.waitFor("session.added");
      assert.equal(added.data.row.sessionId, "session-new");
      harness.bridge.emitSessionStatus({ sessionId: "session-new", running: true, active: true });
      const status = await sse.waitFor("session.status");
      assert.deepEqual(status.data, { sessionId: "session-new", running: true, active: true });
      // DSH's status event may omit active; keep the last known availability instead of false.
      harness.bridge.emitSessionStatus({ sessionId: "session-new", running: false });
      const idle = await sse.waitFor("session.status");
      assert.deepEqual(idle.data, { sessionId: "session-new", running: false, active: true });
      harness.bridge.emitSessionRemoved("session-new");
      const removed = await sse.waitFor("session.removed");
      assert.deepEqual(removed.data, { sessionId: "session-new" });
    } finally {
      await sse.close();
    }
  });
});
