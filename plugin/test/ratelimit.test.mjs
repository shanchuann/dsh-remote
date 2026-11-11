import test from "node:test";
import assert from "node:assert/strict";
import { RateLimiter, TokenBucket } from "../src/net/ratelimit.mjs";
import { pairDevice, request, startHarness } from "./helpers/harness.mjs";

test("token bucket allows a burst, refills over time, then refuses", () => {
  let clock = 0;
  const bucket = new TokenBucket({ rate: 10, burst: 3, now: () => clock });
  assert.equal(bucket.take().allowed, true);
  assert.equal(bucket.take().allowed, true);
  assert.equal(bucket.take().allowed, true);
  const denied = bucket.take();
  assert.equal(denied.allowed, false);
  assert.ok(denied.retryAfterMs >= 100);
  clock += 100;
  assert.equal(bucket.take().allowed, true);
  clock += 10000;
  assert.equal(bucket.take().allowed, true);
});

test("rate limiter isolates keys", () => {
  let clock = 0;
  const limiter = new RateLimiter({ rate: 1, burst: 1, now: () => clock });
  assert.equal(limiter.check("a").allowed, true);
  assert.equal(limiter.check("a").allowed, false);
  assert.equal(limiter.check("b").allowed, true);
  assert.equal(limiter.size, 2);
  limiter.reset("a");
  assert.equal(limiter.check("a").allowed, true);
});

test("authenticated requests are limited per device with 429 rate-limited", async () => {
  const harness = await startHarness({ rateLimit: { rate: 0.0001, burst: 2 } });
  try {
    const paired = await pairDevice(harness);
    const first = await request(harness.baseUrl, "/v1/host", { token: paired.token });
    const second = await request(harness.baseUrl, "/v1/host", { token: paired.token });
    const third = await request(harness.baseUrl, "/v1/host", { token: paired.token });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    assert.equal(third.body.error.code, "rate-limited");
    assert.ok(Number(third.headers.get("retry-after")) >= 1);
  } finally {
    await harness.close();
  }
});

test("pairing attempts are limited per client address", async () => {
  const harness = await startHarness({ pairRateLimit: { rate: 0.0001, burst: 2 } });
  try {
    const code = harness.runtime.pairing.snapshot().code;
    const wrong = code === "000000" ? "111111" : "000000";
    const first = await request(harness.baseUrl, "/v1/pair", { method: "POST", body: { code: wrong } });
    const second = await request(harness.baseUrl, "/v1/pair", { method: "POST", body: { code: wrong } });
    const third = await request(harness.baseUrl, "/v1/pair", { method: "POST", body: { code: wrong } });
    assert.equal(first.status, 401);
    assert.equal(second.status, 401);
    assert.equal(third.status, 429);
    assert.equal(third.body.error.code, "rate-limited");
  } finally {
    await harness.close();
  }
});
