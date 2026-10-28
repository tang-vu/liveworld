import { bridgeAt } from "./engine.js";

// Ordered deliveries are matched by household + ordinal across A/B. Couriers
// may differ: these are not claims that the same physical parcel was rerouted.
export function deliveryReceipts(run, houseId) {
  const houses = new Map(run.houses.map((h) => [h.id, h]));
  const pending = new Map(),
    ordinals = new Map(),
    receipts = [];
  run.events.forEach((event, index) => {
    const ref = `event-${index + 1}`;
    if (event.type === "dispatch") pending.set(event.agentId, { event, ref });
    if (event.type !== "delivery") return;
    const start = pending.get(event.agentId);
    if (!start || start.event.houseId !== event.houseId)
      throw new Error("Delivery has no matching dispatch.");
    pending.delete(event.agentId);
    const ordinal = (ordinals.get(event.houseId) ?? 0) + 1;
    ordinals.set(event.houseId, ordinal);
    const house = houses.get(event.houseId);
    const frames = run.frames.slice(start.event.tick, event.tick + 1);
    const waiting = frames
      .filter((f) => f.agents.find((a) => a.id === event.agentId)?.waiting)
      .map((f) => f.tick);
    const crossings = [];
    for (const frame of frames) {
      const agent = frame.agents.find((a) => a.id === event.agentId);
      const bridge = bridgeAt(run.world, agent);
      if (bridge && crossings.at(-1)?.bridgeId !== bridge.id)
        crossings.push({
          bridgeId: bridge.id,
          label: bridge.label ?? bridge.id,
          enteredAt: frame.tick,
        });
    }
    receipts.push({
      id: `${event.houseId}:delivery:${ordinal}`,
      houseId: event.houseId,
      ordinal,
      houseLabel: house.label ?? house.id,
      agentId: event.agentId,
      dispatchedAt: start.event.tick,
      deliveredAt: event.tick,
      deadline: house.deadline,
      slack: house.deadline - event.tick,
      onTime: event.onTime,
      outboundWaitingTurns: waiting.length,
      waitingAt: waiting,
      crossings,
      evidenceRefs: [start.ref, ref],
    });
  });
  return houseId ? receipts.filter((r) => r.houseId === houseId) : receipts;
}

export function householdComparison(a, b = null) {
  return (b ?? a).houses.map((h) => {
    const before = a.houses.find((old) => old.id === h.id);
    const duplicate =
      (b ?? a).houses.filter((other) => other.label === h.label).length > 1;
    return {
      id: h.id,
      label: duplicate
        ? `${h.label} · cell ${h.x + 1}, ${h.y + 1}`
        : (h.label ?? h.id),
      before: before?.onTime ?? null,
      after: b ? h.onTime : null,
      demand: h.demand,
      delta: b && before ? h.onTime - before.onTime : null,
      completedBefore: before?.completedAt ?? null,
      completedAfter: b ? h.completedAt : null,
    };
  });
}
