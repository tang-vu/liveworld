import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { exampleWorld } from "../shared/world.js";
import { applyRuleChange } from "../shared/rules.js";
import { simulate, evidence } from "../shared/engine.js";
import { worldSignature } from "../shared/project.js";

// A predeclared, small integration evaluation, not a general accuracy benchmark.
// Default: replay the saved responses. --live makes six paid requests, without retries.
const rename = () => {
  const w = exampleWorld();
  Object.assign(w.bridges[0], {
    id: "crossing-upper",
    label: "Upper crossing",
  });
  Object.assign(w.bridges[1], { id: "crossing-meadow", label: "Meadowbridge" });
  Object.assign(w.source, { id: "spring", label: "Spring" });
  w.houses.find((h) => h.label === "Pine").label = "Pine Gate";
  return w;
};
const base = rename();
const scheduled = rename();
scheduled.events = [
  {
    id: "existing-closure",
    kind: "bridge_closed",
    targetId: "crossing-meadow",
    from: 28,
    to: 42,
  },
];
const combined = structuredClone(scheduled);
combined.events.push({
  id: "existing-pause",
  kind: "production_paused",
  targetId: "spring",
  from: 7,
  to: 11,
});
const scalar = structuredClone(combined);
const expectedScalar = structuredClone(scalar);
expectedScalar.rules.couriers = 8;
for (const h of expectedScalar.houses)
  h.demand = h.label === "Pine Gate" ? 5 : 3;
const fixtures = [
  {
    id: "named-closure",
    world: base,
    instruction:
      "From turn eighteen through thirty-three, keep Upper crossing closed. Everything else stays the same.",
    expected: {
      ...structuredClone(base),
      events: [
        {
          id: "new",
          kind: "bridge_closed",
          targetId: "crossing-upper",
          from: 18,
          to: 33,
        },
      ],
    },
  },
  {
    id: "retain-existing-schedule",
    world: scheduled,
    instruction:
      "Pause Spring production on turns seven through eleven; preserve current scheduled events and every other setting.",
    expected: combined,
  },
  {
    id: "remove-one-event",
    world: combined,
    instruction:
      "Remove the closure of Meadowbridge; keep the production pause and all numerical settings.",
    expected: {
      ...structuredClone(combined),
      events: [structuredClone(combined.events[1])],
    },
  },
  {
    id: "specific-house-override",
    world: scalar,
    instruction:
      "Use eight couriers; set every home’s demand to three except Pine Gate, which should need five. Keep deadlines and schedules unchanged.",
    expected: expectedScalar,
  },
  {
    id: "unsupported-mixed-request",
    world: base,
    instruction:
      "Use seven couriers and make bridges close automatically whenever the water level rises.",
    unsupported: true,
  },
  {
    id: "ambiguous-event",
    world: base,
    instruction:
      "Close a bridge during the storm, keeping everything else unchanged.",
    unsupported: true,
  },
];
function canonical(world) {
  const copy = structuredClone(world);
  if (copy.events?.length)
    copy.events = copy.events
      .map(({ id, ...e }) => e)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  else delete copy.events;
  // worldSignature validates event IDs, so keep placeholder IDs after sorting.
  if (copy.events)
    copy.events = copy.events.map((e, i) => ({ id: `event-${i}`, ...e }));
  return worldSignature(copy);
}
function verify(fixture, result) {
  if (fixture.unsupported) {
    assert.equal(result.supported, false);
    assert.ok(result.unsupported?.length);
    assert.equal(
      result.world,
      undefined,
      "unsupported requests must not partially apply",
    );
  } else {
    assert.equal(result.supported, true);
    const applied = applyRuleChange(fixture.world, result.proposal).world;
    assert.equal(
      canonical(applied),
      canonical(fixture.expected),
      "compiled semantics must match the predeclared expected world",
    );
    assert.equal(worldSignature(applied), worldSignature(result.world));
    assert.deepEqual(evidence(simulate(applied)), result.evidence);
    // Existing events that remain must retain their stable identity.
    for (const old of fixture.world.events ?? []) {
      if (fixture.expected.events?.some((e) => e.id === old.id))
        assert.deepEqual(
          applied.events.find((e) => e.id === old.id),
          old,
        );
    }
  }
  return true;
}
const destination = new URL(
  "../public/examples/rule-evaluation.json",
  import.meta.url,
);
if (!process.argv.includes("--live")) {
  const record = JSON.parse(await fs.readFile(destination, "utf8"));
  assert.equal(record.cases.length, fixtures.length);
  for (const fixture of fixtures) {
    const c = record.cases.find((c) => c.id === fixture.id);
    assert.equal(c.instruction, fixture.instruction);
    assert.equal(worldSignature(c.world), worldSignature(fixture.world));
    verify(fixture, c.result);
  }
  console.log(
    JSON.stringify({
      mode: "offline-replay",
      cases: fixtures.length,
      passed: fixtures.length,
      metaRequests: 0,
    }),
  );
} else {
  const url = new URL(
    process.argv.find((a) => a.startsWith("http")) ?? "http://127.0.0.1:4173",
  );
  if (url.hostname !== "127.0.0.1" || url.protocol !== "http:")
    throw new Error("Use the already-running loopback backend.");
  const status = async () => {
    const r = await fetch(new URL("/api/status", url));
    if (!r.ok) throw new Error("Status unavailable.");
    return r.json();
  };
  const before = await status();
  if (!before.configured || before.budget.blocked || before.budget.heldUsd)
    throw new Error("The paid gate must be ready and idle.");
  const cases = [];
  for (const fixture of fixtures) {
    const started = performance.now();
    const response = await fetch(new URL("/api/rules", url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        world: fixture.world,
        instruction: fixture.instruction,
      }),
    });
    const result = await response.json();
    let passed = false,
      error = null;
    try {
      assert.ok(response.ok, result.error ?? "Rule request failed.");
      passed = verify(fixture, result);
    } catch (e) {
      error = e.message;
    }
    cases.push({
      ...fixture,
      result,
      passed,
      error,
      elapsedMs: Math.round(performance.now() - started),
    });
    console.log(
      JSON.stringify({
        id: fixture.id,
        passed,
        error,
        elapsedMs: cases.at(-1).elapsedMs,
      }),
    );
  }
  const after = await status();
  const report = {
    format: "liveworld-rule-evaluation-v1",
    recordedAt: new Date().toISOString(),
    scope:
      "Six predeclared English instructions, one attempt each, on renamed authored layouts. No prompt changes or retries within this evaluation. Not a general accuracy, camera, or creator-productivity benchmark.",
    model: before.model,
    cases,
    summary: {
      passed: cases.filter((c) => c.passed).length,
      total: cases.length,
      metaRequests: after.budget.requests - before.budget.requests,
      estimatedUsd: Number(
        (after.budget.spentUsd - before.budget.spentUsd).toFixed(6),
      ),
      heldUsd: after.budget.heldUsd,
    },
  };
  await fs.writeFile(destination, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.summary));
  if (report.summary.passed !== cases.length) process.exitCode = 1;
}
