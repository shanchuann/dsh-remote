import test from "node:test";
import assert from "node:assert/strict";
import { pairDevice, request, startHarness } from "./helpers/harness.mjs";

async function withHarness(body) {
  const harness = await startHarness();
  try {
    const paired = await pairDevice(harness);
    return await body({ harness, paired });
  } finally {
    await harness.close();
  }
}

test("prompt forwards the protocol payload and echoes requestId", async () => {
  await withHarness(async ({ harness, paired }) => {
    const payload = {
      requestId: "0d6f5f5e-1111-4c6b-9f2a-000000000001",
      mode: "queue",
      content: [{ type: "text", text: "帮我看看这个报错" }],
      clientTimeZone: "Asia/Shanghai"
    };
    const response = await request(harness.baseUrl, "/v1/sessions/session-1/prompt", { method: "POST", token: paired.token, body: payload });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { accepted: true, requestId: payload.requestId });
    assert.equal(harness.bridge.promptCalls.length, 1);
    assert.deepEqual(harness.bridge.promptCalls[0], { sessionId: "session-1", payload });
  });
});

test("an invalid clientTimeZone is 400 invalid-argument, not 500", async () => {
  await withHarness(async ({ harness, paired }) => {
    const invalid = await request(harness.baseUrl, "/v1/sessions/session-1/prompt", {
      method: "POST",
      token: paired.token,
      body: { requestId: "tz-invalid", content: [{ type: "text", text: "hi" }], clientTimeZone: "GMT" }
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, "invalid-argument");
    assert.match(invalid.body.error.message, /clientTimeZone must be UTC or a valid IANA/);
    assert.equal(harness.bridge.promptCalls.length, 0, "rejected prompts must not reach the bridge");

    // A rejected attempt is not cached: fixing the zone with the same requestId works.
    const valid = await request(harness.baseUrl, "/v1/sessions/session-1/prompt", {
      method: "POST",
      token: paired.token,
      body: { requestId: "tz-invalid", content: [{ type: "text", text: "hi" }], clientTimeZone: "Asia/Shanghai" }
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(valid.body, { accepted: true, requestId: "tz-invalid" });
    assert.equal(harness.bridge.promptCalls.length, 1);
    assert.equal(harness.bridge.promptCalls[0].payload.clientTimeZone, "Asia/Shanghai");
  });
});

test("a repeated requestId returns the same accepted response without enqueueing twice", async () => {
  await withHarness(async ({ harness, paired }) => {
    const requestId = "0d6f5f5e-2222-4c6b-9f2a-000000000002";
    const body = { requestId, mode: "queue", content: [{ type: "text", text: "once" }] };
    const first = await request(harness.baseUrl, "/v1/sessions/session-1/prompt", { method: "POST", token: paired.token, body });
    const second = await request(harness.baseUrl, "/v1/sessions/session-1/prompt", { method: "POST", token: paired.token, body });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual({ ...first.body }, { ...second.body });
    assert.equal(harness.bridge.promptCalls.length, 1, "the retry must not reach the bridge again");
    assert.equal(harness.bridge.promptCalls[0].payload.requestId, requestId);
  });
});

test("prompt without requestId still works and steers the current turn", async () => {
  await withHarness(async ({ harness, paired }) => {
    const response = await request(harness.baseUrl, "/v1/sessions/session-1/prompt", {
      method: "POST",
      token: paired.token,
      body: { mode: "steer", content: [{ type: "text", text: "插一句" }] }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { accepted: true });
    assert.equal(harness.bridge.promptCalls[0].payload.mode, "steer");
  });
});

test("image blocks are validated and forwarded", async () => {
  await withHarness(async ({ harness, paired }) => {
    const image = { type: "image", mediaType: "image/jpeg", data: Buffer.from("fake-jpeg").toString("base64"), name: "photo.jpg" };
    const response = await request(harness.baseUrl, "/v1/sessions/session-1/prompt", {
      method: "POST",
      token: paired.token,
      body: { requestId: "req-image", content: [image, { type: "text", text: "看看这张图" }] }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(harness.bridge.promptCalls[0].payload.content, [image, { type: "text", text: "看看这张图" }]);

    const tooMany = await request(harness.baseUrl, "/v1/sessions/session-1/prompt", {
      method: "POST",
      token: paired.token,
      body: { content: Array.from({ length: 5 }, () => image) }
    });
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.error.code, "invalid-argument");
    assert.match(tooMany.body.error.message, /at most 4 images/);

    const notImage = await request(harness.baseUrl, "/v1/sessions/session-1/prompt", {
      method: "POST",
      token: paired.token,
      body: { content: [{ type: "image", mediaType: "text/plain", data: "aGVsbG8=" }] }
    });
    assert.equal(notImage.status, 400);

    const tooLarge = await request(harness.baseUrl, "/v1/sessions/session-1/prompt", {
      method: "POST",
      token: paired.token,
      body: { content: [{ type: "image", mediaType: "image/png", data: Buffer.alloc(5 * 1024 * 1024 + 100).toString("base64") }] }
    });
    assert.equal(tooLarge.status, 400);
    assert.match(tooLarge.body.error.message, /5 MB/);
  });
});

test("invalid prompt bodies are rejected", async () => {
  await withHarness(async ({ harness, paired }) => {
    const cases = [
      { body: {}, match: /content must be a non-empty array/ },
      { body: { content: [] }, match: /content must be a non-empty array/ },
      { body: { content: [{ type: "text", text: "x" }], mode: "later" }, match: /mode must be/ },
      { body: { content: [{ type: "audio", data: "x" }] }, match: /not supported/ },
      { body: { content: [{ type: "text", text: 42 }] }, match: /\.text must be a string/ }
    ];
    for (const entry of cases) {
      const response = await request(harness.baseUrl, "/v1/sessions/session-1/prompt", { method: "POST", token: paired.token, body: entry.body });
      assert.equal(response.status, 400, JSON.stringify(entry.body));
      assert.equal(response.body.error.code, "invalid-argument");
      assert.match(response.body.error.message, entry.match);
    }
    assert.equal(harness.bridge.promptCalls.length, 0);
  });
});

test("approvals list, answer, and expiry follow the protocol", async () => {
  const { makeApproval } = await import("./helpers/fake-bridge.mjs");
  const { openSse } = await import("./helpers/harness.mjs");
  await withHarness(async ({ harness, paired }) => {
    const sse = await openSse(harness.baseUrl, paired.token);
    try {
      await sse.waitFor("hello");
      const approval = makeApproval({ id: "apr_1", sessionId: "session-1" });
      harness.bridge.pushApproval(approval);
      const requestFrame = await sse.waitFor("approval.request");
      assert.equal(requestFrame.data.id, "apr_1");
      assert.equal(requestFrame.data.displayReason, "执行命令：npm install");

      const listed = await request(harness.baseUrl, "/v1/approvals", { token: paired.token });
      assert.equal(listed.status, 200);
      assert.deepEqual(listed.body.items, [approval]);

      const answered = await request(harness.baseUrl, "/v1/approvals/apr_1", { method: "POST", token: paired.token, body: { decision: "allow" } });
      assert.equal(answered.status, 200);
      assert.equal(answered.body.resolved, true);
      assert.equal(answered.body.outcome, "allowed");
      const resolved = await sse.waitFor("approval.resolved");
      assert.deepEqual(resolved.data, { id: "apr_1", outcome: "allowed" });

      const gone = await request(harness.baseUrl, "/v1/approvals/apr_1", { method: "POST", token: paired.token, body: { decision: "allow" } });
      assert.equal(gone.status, 410);
      assert.equal(gone.body.error.code, "approval-gone");

      const invalidDecision = await request(harness.baseUrl, "/v1/approvals/apr_1", { method: "POST", token: paired.token, body: { decision: "maybe" } });
      assert.equal(invalidDecision.status, 400);
      assert.equal(invalidDecision.body.error.code, "invalid-argument");
    } finally {
      await sse.close();
    }
  });
});
