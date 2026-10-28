import test from "node:test";
import assert from "node:assert/strict";
import { DemoAccess, readRuntimeConfig } from "../src/access.mjs";

const config = () =>
  readRuntimeConfig({
    HOST: "127.0.0.1",
    PORT: "4173",
    LIVEWORLD_PUBLIC_ORIGIN: "https://liveworld.test",
    LIVEWORLD_DEMO_ACCESS_CODE: "test-only-long-demo-access-code",
  });
const req = (headers = {}, method = "POST", url = "/api/scan") => ({
  method,
  url,
  headers: {
    host: "liveworld.test",
    origin: "https://liveworld.test",
    ...headers,
  },
});

test("public listeners require one HTTPS origin and a separate strong access code", () => {
  assert.throws(() => readRuntimeConfig({ HOST: "0.0.0.0" }));
  for (const origin of [
    "http://liveworld.test",
    "https://liveworld.test/path",
    "https://liveworld.test/?key=x",
    "https://user:pass@liveworld.test",
  ])
    assert.throws(() =>
      readRuntimeConfig({
        LIVEWORLD_PUBLIC_ORIGIN: origin,
        LIVEWORLD_DEMO_ACCESS_CODE: "long-enough-test-only-access-code",
      }),
    );
  assert.throws(() =>
    readRuntimeConfig({
      LIVEWORLD_PUBLIC_ORIGIN: "https://liveworld.test",
      LIVEWORLD_DEMO_ACCESS_CODE: "weak",
    }),
  );
  assert.throws(() => readRuntimeConfig({ PORT: "0" }));
  assert.equal(config().publicOrigin, "https://liveworld.test");
});

test("origin, host and cross-site checks precede protected operations", () => {
  const access = new DemoAccess(config());
  assert.equal(access.trusted(req()), true);
  assert.equal(access.trusted(req({ host: "attacker.test" })), false);
  assert.equal(access.trusted(req({ origin: "https://attacker.test" })), false);
  assert.equal(access.trusted(req({ "sec-fetch-site": "cross-site" })), false);
  assert.equal(
    access.trusted(req({ host: "127.0.0.1:4173" }, "GET", "/healthz")),
    true,
  );
  assert.equal(
    access.trusted(req({ host: "127.0.0.1:4173" }, "POST", "/api/scan")),
    false,
  );
});

test("reviewer access uses expiring revocable HttpOnly cookies without the API key", () => {
  let now = 1000;
  const access = new DemoAccess(config(), () => now);
  assert.equal(access.authorized(req()), false);
  assert.equal(access.unlock("incorrect").status, 401);
  const result = access.unlock(config().code);
  assert.equal(result.status, 200);
  assert.match(
    result.cookie,
    /__Host-liveworld=.*; Path=\/; HttpOnly; SameSite=Strict; Max-Age=7200; Secure/,
  );
  assert.equal(result.cookie.includes(config().code), false);
  const authorized = req({ cookie: result.cookie.split(";")[0] });
  assert.equal(access.authorized(authorized), true);
  access.logout(authorized);
  assert.equal(access.authorized(authorized), false);
  const next = access.unlock(config().code);
  const expiry = req({ cookie: next.cookie.split(";")[0] });
  now += 7_200_000;
  assert.equal(access.authorized(expiry), false);
});

test("incorrect-code attempts are bounded and local development needs no session", () => {
  const access = new DemoAccess(config());
  for (let i = 0; i < 25; i++) access.unlock("wrong");
  assert.equal(access.failed.length, 20);
  assert.equal(access.unlock("wrong").status, 429);
  assert.equal(access.unlock(config().code).status, 200);
  const local = new DemoAccess(readRuntimeConfig({}));
  assert.equal(local.required(), false);
  assert.equal(local.authorized({ headers: {} }), true);
  assert.equal(
    local.trusted({
      method: "GET",
      url: "/",
      headers: { host: "127.0.0.1:4173" },
    }),
    true,
  );
});
