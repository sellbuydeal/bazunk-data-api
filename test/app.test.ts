import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.BAZUNK_API_KEYS = "test-key";

test("health endpoint is public", async () => {
  const { buildApp } = await import("../src/app.js");
  const app = await buildApp();
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "ok");
  await app.close();
});

test("v1 endpoints require an API key", async () => {
  const { buildApp } = await import("../src/app.js");
  const app = await buildApp();
  const response = await app.inject({ method: "GET", url: "/v1/providers" });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("authorized client can inspect provider status", async () => {
  const { buildApp } = await import("../src/app.js");
  const app = await buildApp();
  const response = await app.inject({
    method: "GET",
    url: "/v1/providers",
    headers: { "x-api-key": "test-key" }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().providers.length, 4);
  await app.close();
});

test("authenticated client identity and usage are exposed", async () => {
  const { buildApp } = await import("../src/app.js");
  const app = await buildApp();

  const me = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { "x-api-key": "test-key" }
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().client.id, "bazunk-marketplace");

  await app.inject({
    method: "GET",
    url: "/v1/providers",
    headers: { "x-api-key": "test-key" }
  });

  const usage = await app.inject({
    method: "GET",
    url: "/v1/usage",
    headers: { "x-api-key": "test-key" }
  });
  assert.equal(usage.statusCode, 200);
  assert.ok(usage.json().requests >= 1);
  await app.close();
});
