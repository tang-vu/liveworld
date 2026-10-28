// A versioned, executable creator brief. No model text can change its verdict.
export function validateContract(input, world) {
  if (input == null) return null;
  const keys = [
    "version",
    "minimumOnTime",
    "minimumPerHouse",
    "maximumWait",
    "allowDispatch",
    "bridgeIds",
  ];
  if (
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !keys.includes(k)) ||
    keys.some((k) => !Object.hasOwn(input, k))
  )
    throw new Error(
      "A test brief must contain exactly the supported contract fields.",
    );
  if (input.version !== 1) throw new Error("Unsupported test brief version.");
  const bound = (value, max, name) => {
    if (
      value !== null &&
      (!Number.isInteger(value) || value < 0 || value > max)
    )
      throw new Error(`${name} must be null or an integer from 0 to ${max}.`);
  };
  bound(
    input.minimumOnTime,
    world.houses.reduce((n, h) => n + h.demand, 0),
    "On-time target",
  );
  bound(
    input.minimumPerHouse,
    Math.min(...world.houses.map((h) => h.demand)),
    "Target for every home",
  );
  bound(
    input.maximumWait,
    world.rules.horizon * world.rules.couriers,
    "Waiting limit",
  );
  if (typeof input.allowDispatch !== "boolean")
    throw new Error("Choose whether dispatch may change.");
  if (
    input.bridgeIds !== null &&
    (!Array.isArray(input.bridgeIds) ||
      input.bridgeIds.length > world.bridges.length ||
      new Set(input.bridgeIds).size !== input.bridgeIds.length ||
      input.bridgeIds.some((id) => !world.bridges.some((b) => b.id === id)))
  )
    throw new Error(
      "Editable bridges must be distinct existing bridge IDs, or null for all bridges.",
    );
  return structuredClone(input);
}

export function defaultContract() {
  return {
    version: 1,
    minimumOnTime: null,
    minimumPerHouse: null,
    maximumWait: null,
    allowDispatch: true,
    bridgeIds: null,
  };
}

export function evaluateContract(run, input = run.world.contract) {
  const contract = validateContract(input, run.world) ?? defaultContract();
  const total = contract.minimumOnTime ?? run.metrics.demand;
  const checks = [
    {
      id: "on-time",
      label: `At least ${total}/${run.metrics.demand} units on time`,
      actual: run.metrics.onTime,
      target: total,
      shortfall: Math.max(0, total - run.metrics.onTime),
    },
  ];
  if (contract.minimumPerHouse !== null)
    for (const house of run.houses)
      checks.push({
        id: `home:${house.id}`,
        houseId: house.id,
        label: `${house.label ?? house.id}: at least ${contract.minimumPerHouse} on time`,
        actual: house.onTime,
        target: contract.minimumPerHouse,
        shortfall: Math.max(0, contract.minimumPerHouse - house.onTime),
      });
  if (contract.maximumWait !== null)
    checks.push({
      id: "waiting",
      label: `At most ${contract.maximumWait} courier waiting turns`,
      actual: run.metrics.waitTicks,
      target: contract.maximumWait,
      shortfall: Math.max(0, run.metrics.waitTicks - contract.maximumWait),
    });
  checks.forEach((c) => {
    c.passed = c.shortfall === 0;
  });
  return {
    contract,
    passed: checks.every((c) => c.passed),
    checks,
    verifiedBy: "deterministic-engine-v1",
  };
}

export function assertPermittedPatch(world, patch) {
  const contract = validateContract(world.contract, world);
  if (!contract) return;
  if (
    patch.dispatch != null &&
    patch.dispatch !== world.rules.dispatch &&
    !contract.allowDispatch
  )
    throw new Error("The confirmed test brief locks the dispatch policy.");
  for (const move of patch.bridgeMoves ?? [])
    if (
      world.bridges.find((b) => b.id === move.id)?.y !== move.y &&
      contract.bridgeIds !== null &&
      !contract.bridgeIds.includes(move.id)
    )
      throw new Error("The confirmed test brief locks that bridge.");
}

export function rankRuns(a, b, contract = a.world.contract) {
  if (!contract)
    return (
      a.metrics.lateUnits - b.metrics.lateUnits ||
      a.metrics.unmetUnits - b.metrics.unmetUnits ||
      a.metrics.waitTicks - b.metrics.waitTicks
    );
  const vector = (run) => {
    const v = evaluateContract(run, contract);
    return [
      v.passed ? 0 : 1,
      v.checks[0].shortfall,
      v.checks.filter((c) => c.houseId).reduce((n, c) => n + c.shortfall, 0),
      v.checks.find((c) => c.id === "waiting")?.shortfall ?? 0,
      -run.metrics.onTime,
      run.metrics.waitTicks,
    ];
  };
  const av = vector(a),
    bv = vector(b);
  for (let i = 0; i < av.length; i++) if (av[i] !== bv[i]) return av[i] - bv[i];
  return 0;
}
