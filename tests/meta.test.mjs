import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BudgetLedger } from "../src/budget.mjs";
import { MetaClient, readSse } from "../src/meta.mjs";

async function setup(t, transport) {
  const directory = await mkdtemp(join(tmpdir(), "liveworld-meta-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const policy = { total: 150, phase: 10, reserve: 50 };
  const ledger = new BudgetLedger(directory, policy);
  const client = new MetaClient(
    {
      key: "unit-test-secret",
      model: "muse-spark-1.3",
      baseURL: "https://api.meta.ai/v1",
    },
    ledger,
    transport,
  );
  return { client, ledger };
}
test("API request is reserved first, output capped, and settled from usage", async (t) => {
  let captured;
  let observedHold = false;
  const { client, ledger } = await setup(t, async (url, options) => {
    captured = JSON.parse(options.body);
    observedHold = (await ledger.summary()).heldUsd > 1;
    assert.equal(url, "https://api.meta.ai/v1/chat/completions");
    return Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: "READY" },
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
  });
  await client.chat([{ role: "user", content: "Ping" }], { maxOutput: 128 });
  assert.equal(observedHold, true);
  assert.equal(captured.max_completion_tokens, 128);
  assert.equal(captured.store, false);
  assert.equal((await ledger.summary()).heldUsd, 0);
  assert.ok((await ledger.summary()).spentUsd < 0.001);
});
test("missing usage pauses subsequent requests and is never silently treated as free", async (t) => {
  let calls = 0;
  const { client, ledger } = await setup(t, async () => {
    calls++;
    return Response.json({ choices: [{ message: { content: "READY" } }] });
  });
  await assert.rejects(client.chat([{ role: "user", content: "Ping" }]));
  await assert.rejects(client.chat([{ role: "user", content: "Ping again" }]));
  assert.equal(calls, 1);
  assert.ok((await ledger.summary()).spentUsd > 1);
  assert.ok((await ledger.summary()).blocked);
});
test("network failures are not retried and never expose the bearer key", async (t) => {
  let calls = 0;
  const { client } = await setup(t, async () => {
    calls++;
    throw new Error("unit-test-secret");
  });
  await assert.rejects(
    client.chat([{ role: "user", content: "Ping" }]),
    (error) => !error.message.includes("unit-test-secret"),
  );
  assert.equal(calls, 1);
});
test("an image edit reserves one image, sends the server prompt, and settles ten cents of a cent", async (t) => {
  let captured;
  const { client, ledger } = await setup(t, async (url, options) => {
    captured = {
      url,
      body: JSON.parse(options.body),
      authorization: options.headers.Authorization,
    };
    return Response.json({ data: [{ b64_json: "aGVsbG8=" }] });
  });
  const result = await client.editImage(
    "data:image/png;base64,AAAA",
    "Keep the pay button.",
  );
  assert.equal(captured.url, "https://api.meta.ai/v1/images/edits");
  assert.equal(captured.body.model, "muse-image-1.0");
  assert.equal(captured.body.prompt, "Keep the pay button.");
  assert.equal(captured.body.n, 1);
  assert.equal(captured.authorization.includes("unit-test-secret"), true);
  assert.equal(result.imageDataUrl, "data:image/png;base64,aGVsbG8=");
  assert.equal(result.costUsd, 0.01);
  assert.equal((await ledger.summary()).heldUsd, 0);
  assert.equal((await ledger.summary()).spentUsd, 0.01);
});
test("SSE transport handles event chunks without dropping Unicode", async () => {
  const payload = new TextEncoder().encode(
    'data: {"type":"message","text":"cầu"}\n\ndata: {"type":"response.completed"}\n\n',
  );
  async function* chunks() {
    for (let i = 0; i < payload.length; i += 3) yield payload.slice(i, i + 3);
  }
  const result = [];
  for await (const event of readSse(chunks())) result.push(event);
  assert.equal(result[0].text, "cầu");
  assert.equal(result[1].type, "response.completed");
});
