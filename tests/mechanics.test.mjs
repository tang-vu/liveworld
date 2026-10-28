import test from "node:test";
import assert from "node:assert/strict";
import { exampleWorld, validateWorld, applyPatch } from "../shared/world.js";
import { simulate, bridgeAt, evidence } from "../shared/engine.js";
import { applyRuleChange } from "../shared/rules.js";
import { compileRuleChange } from "../src/rules.mjs";
import {
  normalizeProject,
  PROJECT_FORMAT,
  describeWorldChanges,
} from "../shared/project.js";

function crossing() {
  const w = exampleWorld();
  w.houses = [
    { id: "home", label: "East home", x: 12, y: 5, demand: 4, deadline: 80 },
  ];
  w.bridges = [{ id: "bridge-north", x: 8, y: 5 }];
  w.obstacles = [];
  w.rules = { ...w.rules, couriers: 2, productionInterval: 1, horizon: 100 };
  return w;
}
function conservation(run) {
  for (let t = 0; t < run.frames.length; t++) {
    const f = run.frames[t];
    assert.equal(
      f.produced,
      f.stock +
        f.delivered +
        f.agents.filter((a) => a.state === "outbound").length,
      "every produced unit is accounted for at turn " + t,
    );
    for (const a of f.agents) {
      if (t) {
        const before = run.frames[t - 1].agents.find((b) => b.id === a.id);
        assert.ok(
          Math.abs(a.x - before.x) + Math.abs(a.y - before.y) <= 1,
          "courier movement cannot teleport",
        );
      }
      if (a.state === "idle")
        assert.deepEqual(
          [a.x, a.y],
          [run.world.source.x, run.world.source.y],
          "idle couriers must actually be at the well",
        );
    }
  }
}
test("a short replay distinguishes future deadlines from verified late deliveries", () => {
  const w = crossing();
  w.rules.horizon = 10;
  const run = simulate(w);
  assert.equal(run.metrics.lateUnits, 0);
  assert.ok(run.metrics.pendingUnits > 0);
  assert.equal(
    run.metrics.pendingUnits + run.metrics.onTime,
    run.metrics.demand,
  );
  assert.equal(run.metrics.allOnTime, false);
  assert.equal(
    run.events.some((e) => e.type === "deadline_missed"),
    false,
  );
});
test("inclusive bridge closures prevent new entries, permit occupants to exit, and reopen exactly", () => {
  const w = crossing();
  w.events = [
    {
      id: "flood",
      kind: "bridge_closed",
      targetId: "bridge-north",
      from: 6,
      to: 14,
    },
  ];
  const run = simulate(w);
  assert.deepEqual(run.frames[5].closedBridgeIds, []);
  assert.deepEqual(run.frames[6].closedBridgeIds, ["bridge-north"]);
  assert.deepEqual(run.frames[14].closedBridgeIds, ["bridge-north"]);
  assert.deepEqual(run.frames[15].closedBridgeIds, []);
  assert.ok(
    run.frames[5].agents.some((a) => bridgeAt(w, a)),
    "fixture has an occupant before closure",
  );
  for (let t = 6; t <= 14; t++)
    for (const a of run.frames[t].agents) {
      if (bridgeAt(w, a))
        assert.equal(
          bridgeAt(
            w,
            run.frames[t - 1].agents.find((b) => b.id === a.id),
          )?.id,
          "bridge-north",
          "a closed crossing must not accept new entries",
        );
    }
  assert.equal(run.metrics.allOnTime, true);
  assert.ok(run.metrics.closureWaitTicks > 0);
  assert.deepEqual(
    run.metrics.unreachable,
    [],
    "a temporary closure is not permanent disconnection",
  );
  conservation(run);
});
test("an approaching courier can reroute around a closure and return to the actual well", () => {
  const w = exampleWorld();
  w.houses = [
    { id: "east", label: "East", x: 12, y: 2, demand: 2, deadline: 110 },
  ];
  w.rules = { ...w.rules, couriers: 1, productionInterval: 1 };
  w.events = [
    {
      id: "repair",
      kind: "bridge_closed",
      targetId: "bridge-north",
      from: 5,
      to: 40,
    },
  ];
  const run = simulate(w);
  assert.ok(run.events.some((e) => e.type === "reroute"));
  assert.deepEqual(
    run.routeChanges.map((p) => p.tick),
    [0, 5, 41],
  );
  assert.equal(run.metrics.delivered, 2);
  for (let t = 5; t <= 40; t++)
    for (const a of run.frames[t].agents) {
      if (bridgeAt(w, a)?.id === "bridge-north")
        assert.equal(
          bridgeAt(
            w,
            run.frames[t - 1].agents.find((b) => b.id === a.id),
          )?.id,
          "bridge-north",
        );
    }
  conservation(run);
  assert.deepEqual(
    simulate(w),
    run,
    "scheduled worlds remain exactly replayable",
  );
});
test("production pauses retain stock and skip scheduled production without resetting its clock", () => {
  const w = crossing();
  w.rules.productionInterval = 2;
  w.events = [
    {
      id: "drought",
      kind: "production_paused",
      targetId: "well",
      from: 6,
      to: 14,
    },
  ];
  const run = simulate(w);
  for (let t = 1; t < run.frames.length; t++) {
    const increment = run.frames[t].produced - run.frames[t - 1].produced;
    assert.equal(increment, t % 2 === 1 && !(t >= 6 && t <= 14) ? 1 : 0);
  }
  assert.equal(run.metrics.productionPausedTurns, 9);
  assert.ok(
    run.events.some((e) => e.tick === 15 && e.type === "production_resumed"),
  );
  conservation(run);
});
test("schedule validation rejects ambiguous targets, overlap, invalid horizons and executable fields", () => {
  const w = crossing();
  const good = {
    id: "flood",
    kind: "bridge_closed",
    targetId: "bridge-north",
    from: 6,
    to: 14,
  };
  for (const invalid of [
    { ...good, targetId: "home" },
    { ...good, kind: "eval" },
    { ...good, from: 0 },
    { ...good, to: 101 },
    { ...good, from: 15 },
    { ...good, from: 6.5 },
    { ...good, script: "anything" },
  ])
    assert.throws(() => validateWorld({ ...w, events: [invalid] }));
  assert.throws(() =>
    validateWorld({
      ...w,
      events: [good, { ...good, id: "overlap", from: 14, to: 20 }],
    }),
  );
  assert.doesNotThrow(() =>
    validateWorld({
      ...w,
      events: [good, { ...good, id: "later", from: 15, to: 20 }],
    }),
  );
  const applied = applyRuleChange(w, { events: [good] });
  assert.equal(w.events, undefined);
  assert.throws(() =>
    applyRuleChange(applied.world, { rules: { horizon: 10 } }),
  );
  assert.equal(
    applyRuleChange(applied.world, { rules: { horizon: 10 }, events: [] }).world
      .events.length,
    0,
  );
  assert.deepEqual(
    applyPatch(applied.world, { dispatch: "balanced" }).world.events,
    [good],
  );
  assert.throws(
    () => applyPatch(applied.world, { events: [] }),
    "the repair agent cannot remove a designer's hazard",
  );
});
test("Meta compiles a typed schedule and the engine, export and import independently verify it", async () => {
  const w = crossing();
  const event = {
    id: "flood",
    kind: "bridge_closed",
    targetId: "bridge-north",
    from: 6,
    to: 14,
  };
  const client = {
    config: { model: "test-meta" },
    async chat(messages, options) {
      assert.ok(messages[0].content.includes("INCLUSIVE"));
      assert.ok(
        options.format.response_format.json_schema.schema.properties.events,
      );
      return {
        message: {
          content: JSON.stringify({
            explanation: "Every deadline is guaranteed.",
            unsupported: [],
            rules: {},
            allHouseholds: {},
            households: [],
            events: [event],
          }),
        },
      };
    },
  };
  const result = await compileRuleChange(client, {
    world: w,
    instruction: "Close the north bridge from turn 6 through turn 14.",
  });
  assert.deepEqual(result.world.events, [event]);
  assert.deepEqual(result.evidence, evidence(simulate(result.world)));
  assert.ok(
    describeWorldChanges(w, result.world).some((s) => s.includes("6–14")),
  );
  const project = normalizeProject({
    format: PROJECT_FORMAT,
    name: "Flood",
    world: result.world,
  });
  assert.deepEqual(simulate(project.world).metrics, result.evidence.metrics);
});
