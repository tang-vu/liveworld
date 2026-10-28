import { validateWorld } from "./world.js";
import { activeMechanics, describeEvent } from "./mechanics.js";
import { evaluateContract, rankRuns } from "./contract.js";

const key = (p) => `${p.x},${p.y}`;
export function bridgeAt(world, point) {
  if (point.x < world.river.x || point.x >= world.river.x + world.river.width)
    return null;
  return world.bridges.find((b) => b.y === point.y) ?? null;
}

export function findPath(world, start, end, { closedBridgeIds = [] } = {}) {
  const blocked = new Set(world.obstacles.map(key));
  const queue = [{ x: start.x, y: start.y }];
  const visited = new Map([[key(start), null]]);
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (current.x === end.x && current.y === end.y) {
      const path = [];
      let cursor = current;
      while (cursor) {
        path.push(cursor);
        cursor = visited.get(key(cursor));
      }
      return path.reverse();
    }
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]) {
      const next = { x: current.x + dx, y: current.y + dy };
      const nk = key(next);
      if (
        next.x < 0 ||
        next.y < 0 ||
        next.x >= world.width ||
        next.y >= world.height ||
        visited.has(nk) ||
        blocked.has(nk)
      )
        continue;
      const water =
        next.x >= world.river.x && next.x < world.river.x + world.river.width;
      const bridge = water ? bridgeAt(world, next) : null;
      if (water && (!bridge || closedBridgeIds.includes(bridge.id))) continue;
      visited.set(nk, current);
      queue.push(next);
    }
  }
  return null;
}

export function simulate(input) {
  const world = validateWorld(input);
  const houses = world.houses.map((h) => ({
    ...h,
    delivered: 0,
    onTime: 0,
    firstDelivery: null,
    completedAt: null,
    inTransit: 0,
  }));
  const paths = new Map(
    houses.map((h) => [h.id, findPath(world, world.source, h)]),
  );
  const agents = Array.from({ length: world.rules.couriers }, (_, i) => ({
    id: `courier-${i + 1}`,
    x: world.source.x,
    y: world.source.y,
    state: "idle",
    houseId: null,
    path: [],
    step: 0,
    waiting: false,
  }));
  const events = [];
  const frames = [];
  let stock = 0;
  let produced = 0;
  let waitTicks = 0;
  let completedAt = null;
  const scheduled = Boolean(world.events?.length);
  let mechanics = activeMechanics(world, 0);
  let closureWaitTicks = 0;
  let productionPausedTurns = 0;
  const routeCache = new Map([["", paths]]);
  const routeChanges = [{ tick: 0, routes: Object.fromEntries(paths) }];
  let previousClosureKey = "";
  const routesFor = (closedBridgeIds) => {
    const signature = closedBridgeIds.join(",");
    if (!routeCache.has(signature))
      routeCache.set(
        signature,
        new Map(
          houses.map((h) => [
            h.id,
            findPath(world, world.source, h, { closedBridgeIds }),
          ]),
        ),
      );
    return routeCache.get(signature);
  };
  const event = (tick, type, data) => events.push({ tick, type, ...data });
  for (const house of houses)
    if (!paths.get(house.id))
      event(0, "unreachable", {
        houseId: house.id,
        message: `${house.label} has no route from the well.`,
      });

  function snapshot(tick) {
    frames.push({
      tick,
      stock,
      produced,
      delivered: houses.reduce((sum, h) => sum + h.delivered, 0),
      waitTicks,
      ...(scheduled
        ? {
            closedBridgeIds: [...mechanics.closedBridgeIds],
            productionPaused: mechanics.productionPaused,
            closureWaitTicks,
          }
        : {}),
      houses: houses.map((h) => ({
        id: h.id,
        delivered: h.delivered,
        onTime: h.onTime,
        firstDelivery: h.firstDelivery,
        completedAt: h.completedAt,
      })),
      agents: agents.map((a) => ({
        id: a.id,
        x: a.x,
        y: a.y,
        state: a.state,
        waiting: a.waiting,
        houseId: a.houseId,
      })),
    });
  }
  snapshot(0);
  for (let tick = 1; tick <= world.rules.horizon; tick++) {
    mechanics = activeMechanics(world, tick);
    const currentPaths = routesFor(mechanics.closedBridgeIds);
    const closureKey = mechanics.closedBridgeIds.join(",");
    if (closureKey !== previousClosureKey) {
      routeChanges.push({ tick, routes: Object.fromEntries(currentPaths) });
      previousClosureKey = closureKey;
    }
    for (const rule of world.events ?? []) {
      if (tick === rule.from)
        event(tick, rule.kind, {
          eventId: rule.id,
          targetId: rule.targetId,
          message: describeEvent(rule, world),
        });
      if (tick === rule.to + 1)
        event(
          tick,
          rule.kind === "bridge_closed"
            ? "bridge_opened"
            : "production_resumed",
          {
            eventId: rule.id,
            targetId: rule.targetId,
            message:
              rule.kind === "bridge_closed"
                ? `${world.bridges.find((b) => b.id === rule.targetId)?.label ?? rule.targetId} reopened.`
                : "The well resumed its production schedule.",
          },
        );
    }
    if (mechanics.productionPaused) productionPausedTurns++;
    if (
      !mechanics.productionPaused &&
      (tick - 1) % world.rules.productionInterval === 0
    ) {
      stock++;
      produced++;
    }
    for (const a of agents) {
      a.waiting = false;
      if (a.state === "idle" && stock > 0) {
        const choices = houses.filter(
          (h) => h.delivered + h.inTransit < h.demand && currentPaths.get(h.id),
        );
        choices.sort((a, b) => {
          const ad = currentPaths.get(a.id).length - 1;
          const bd = currentPaths.get(b.id).length - 1;
          if (world.rules.dispatch === "balanced") {
            const balance =
              (a.delivered + a.inTransit) / a.demand -
              (b.delivered + b.inTransit) / b.demand;
            if (balance) return balance;
          } else if (world.rules.dispatch === "deadline") {
            const slack = a.deadline - tick - ad - (b.deadline - tick - bd);
            if (slack) return slack;
          }
          return ad - bd || a.id.localeCompare(b.id);
        });
        const chosen = choices[0];
        if (chosen) {
          stock--;
          chosen.inTransit++;
          a.state = "outbound";
          a.houseId = chosen.id;
          a.path = currentPaths.get(chosen.id);
          a.step = 0;
          event(tick, "dispatch", { agentId: a.id, houseId: chosen.id });
        }
      }
      if (a.state === "idle") continue;
      let next = a.path[a.step + 1];
      if (next) {
        let bridge = bridgeAt(world, next);
        const currentBridge = bridgeAt(world, a);
        if (
          bridge &&
          mechanics.closedBridgeIds.includes(bridge.id) &&
          currentBridge?.id !== bridge.id
        ) {
          const destination =
            a.state === "outbound"
              ? houses.find((h) => h.id === a.houseId)
              : world.source;
          const route = findPath(world, a, destination, mechanics);
          if (!route || route.length < 2) {
            a.waiting = true;
            waitTicks++;
            closureWaitTicks++;
            if (
              !frames[tick - 1]?.agents.find((other) => other.id === a.id)
                ?.waiting
            )
              event(tick, "bridge_closed_wait", {
                agentId: a.id,
                bridgeId: bridge.id,
                message: `A courier is waiting for ${bridge.label ?? bridge.id} to reopen.`,
              });
            continue;
          }
          a.path = route;
          a.step = 0;
          next = route[1];
          bridge = bridgeAt(world, next);
          event(tick, "reroute", {
            agentId: a.id,
            houseId: a.houseId,
            message: `A courier rerouted around a closed bridge.`,
          });
        }
        const occupants = bridge
          ? agents.filter(
              (other) =>
                other.id !== a.id && bridgeAt(world, other)?.id === bridge.id,
            ).length
          : 0;
        if (
          bridge &&
          bridge.id !== currentBridge?.id &&
          occupants >= world.rules.bridgeCapacity
        ) {
          a.waiting = true;
          waitTicks++;
          if (
            tick === 1 ||
            !frames[tick - 1]?.agents.find((other) => other.id === a.id)
              ?.waiting
          )
            event(tick, "bridge_queue", {
              agentId: a.id,
              bridgeId: bridge.id,
              message: `A courier is waiting at ${bridge.label ?? bridge.id.replace("bridge-", "the ") + " bridge"}.`,
            });
          continue;
        }
        a.x = next.x;
        a.y = next.y;
        a.step++;
      }
      if (a.step === a.path.length - 1) {
        if (a.state === "outbound") {
          const h = houses.find((h) => h.id === a.houseId);
          h.inTransit--;
          h.delivered++;
          if (tick <= h.deadline) h.onTime++;
          h.firstDelivery ??= tick;
          if (h.delivered === h.demand) h.completedAt = tick;
          event(tick, "delivery", {
            agentId: a.id,
            houseId: h.id,
            onTime: tick <= h.deadline,
            message: `${h.label} received water${tick > h.deadline ? " after its deadline" : ""}.`,
          });
          a.state = "returning";
          a.path = [
            ...(scheduled
              ? (currentPaths.get(h.id) ?? paths.get(h.id))
              : a.path),
          ].reverse();
          a.step = 0;
        } else {
          a.state = "idle";
          a.houseId = null;
          a.path = [];
          a.step = 0;
        }
      }
    }
    for (const h of houses)
      if (tick === h.deadline && h.delivered < h.demand)
        event(tick, "deadline_missed", {
          houseId: h.id,
          missing: h.demand - h.delivered,
          message: `${h.label} missed its deadline by ${h.demand - h.delivered} water unit(s).`,
        });
    if (completedAt === null && houses.every((h) => h.delivered === h.demand)) {
      completedAt = tick;
      event(tick, "all_delivered", {
        message: "Every household has received its requested water.",
      });
    }
    snapshot(tick);
  }
  const demand = houses.reduce((sum, h) => sum + h.demand, 0);
  const delivered = houses.reduce((sum, h) => sum + h.delivered, 0);
  const onTime = houses.reduce((sum, h) => sum + h.onTime, 0);
  const pendingUnits = houses
    .filter((h) => h.deadline > world.rules.horizon)
    .reduce((sum, h) => sum + h.demand - h.delivered, 0);
  const metrics = {
    demand,
    delivered,
    onTime,
    lateUnits: demand - onTime - pendingUnits,
    unmetUnits: demand - delivered,
    coverage: delivered / demand,
    worstCoverage: Math.min(...houses.map((h) => h.delivered / h.demand)),
    waitTicks,
    completedAt,
    unreachable: houses.filter((h) => !paths.get(h.id)).map((h) => h.id),
    allOnTime: onTime === demand,
    allDelivered: delivered === demand,
    ...(pendingUnits ? { pendingUnits } : {}),
    ...(scheduled ? { closureWaitTicks, productionPausedTurns } : {}),
  };
  return {
    world,
    metrics,
    houses,
    frames,
    events,
    routes: Object.fromEntries(paths),
    ...(scheduled ? { routeChanges } : {}),
  };
}

export function compareRuns(baseline, candidate) {
  const a = baseline.metrics;
  const b = candidate.metrics;
  const improved = baseline.world.contract
    ? rankRuns(candidate, baseline, baseline.world.contract) < 0
    : b.lateUnits < a.lateUnits ||
      (b.lateUnits === a.lateUnits &&
        (b.unmetUnits < a.unmetUnits ||
          (b.unmetUnits === a.unmetUnits && b.waitTicks < a.waitTicks)));
  return {
    improved,
    goalMet: baseline.world.contract
      ? evaluateContract(candidate, baseline.world.contract).passed
      : b.allOnTime,
    lateUnitsReduced: a.lateUnits - b.lateUnits,
    unmetUnitsReduced: a.unmetUnits - b.unmetUnits,
    waitTicksReduced: a.waitTicks - b.waitTicks,
    sameSeed: baseline.world.seed === candidate.world.seed,
    verifiedBy: "deterministic-engine-v1",
    ...(baseline.world.contract
      ? { contract: evaluateContract(candidate, baseline.world.contract) }
      : {}),
  };
}

export function evidence(run) {
  return {
    metrics: run.metrics,
    ...(run.world.contract ? { contract: evaluateContract(run) } : {}),
    households: run.houses.map((h) => ({
      id: h.id,
      label: h.label,
      demand: h.demand,
      delivered: h.delivered,
      onTime: h.onTime,
      deadline: h.deadline,
      firstDelivery: h.firstDelivery,
    })),
    significantEvents: run.events.filter((e) =>
      [
        "deadline_missed",
        "unreachable",
        "all_delivered",
        "bridge_closed",
        "bridge_opened",
        "production_paused",
        "production_resumed",
        "reroute",
      ].includes(e.type),
    ),
    bridgeQueues: Object.entries(
      run.events
        .filter(
          (e) => e.type === "bridge_queue" || e.type === "bridge_closed_wait",
        )
        .reduce((all, e) => {
          all[e.bridgeId] = (all[e.bridgeId] ?? 0) + 1;
          return all;
        }, {}),
    ),
    ...(run.world.events?.length
      ? {
          scheduledMechanics: run.world.events,
          routePhases: run.routeChanges.map((phase) => ({
            tick: phase.tick,
            reachableHomes: Object.values(phase.routes).filter(Boolean).length,
          })),
        }
      : {}),
  };
}
