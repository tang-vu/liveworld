import { normalizeProject, describeWorldChanges } from "../shared/project.js";
import { simulate } from "../shared/engine.js";
import { describeEvent } from "../shared/mechanics.js";
import { evaluateContract } from "../shared/contract.js";
import { deliveryReceipts, householdComparison } from "../shared/receipts.js";
import { sensitivitySweep } from "../shared/sensitivity.js";

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export function experimentReport(input) {
  const project = normalizeProject(input);
  const trial = project.trials.find((t) => t.id === project.selectedTrialId);
  const a = simulate(project.world);
  const b = trial ? simulate(trial.world) : null;
  const ac = evaluateContract(a),
    bc = b ? evaluateContract(b, a.world.contract) : null;
  const contractRows = ac.checks
    .map((c) => {
      const other = bc?.checks.find((x) => x.id === c.id);
      return `<tr><td>${escape(c.label)}</td><td>${c.actual} · ${c.passed ? "PASS" : "FAIL"}</td>${b ? `<td>${other?.actual ?? "—"} · ${other?.passed ? "PASS" : "FAIL"}</td>` : ""}</tr>`;
    })
    .join("");
  const receiptTable = (run) =>
    `<table><tr><th>Receipt / home</th><th>Courier</th><th>Dispatch → arrival</th><th>Deadline / slack</th><th>Outbound wait</th><th>Engine event references</th></tr>${deliveryReceipts(
      run,
    )
      .map(
        (r) =>
          `<tr><td>${escape(r.id)}<br>${escape(r.houseLabel)}</td><td>${escape(r.agentId)}</td><td>${r.dispatchedAt} → ${r.deliveredAt}</td><td>${r.deadline} / ${r.slack}</td><td>${r.outboundWaitingTurns}</td><td>${r.evidenceRefs.join(" → ")}</td></tr>`,
      )
      .join("")}</table>`;
  const stress = b ? sensitivitySweep(a.world, b.world) : null;
  const rows = [
    ["On-time water", a.metrics.onTime, b?.metrics.onTime],
    ["Total demand", a.metrics.demand, b?.metrics.demand],
    ["Late water units", a.metrics.lateUnits, b?.metrics.lateUnits],
    ["Undelivered units", a.metrics.unmetUnits, b?.metrics.unmetUnits],
    ["Bridge waiting turns", a.metrics.waitTicks, b?.metrics.waitTicks],
    [
      "Completion turn",
      a.metrics.completedAt ?? "Not completed",
      b ? (b.metrics.completedAt ?? "Not completed") : undefined,
    ],
  ];
  const changes = trial ? describeWorldChanges(project.world, trial.world) : [];
  if (a.metrics.pendingUnits || b?.metrics.pendingUnits)
    rows.push([
      "Awaiting a future deadline",
      a.metrics.pendingUnits ?? 0,
      b?.metrics.pendingUnits ?? 0,
    ]);
  if (a.world.events?.length || b?.world.events?.length) {
    rows.push([
      "Waiting for closed bridges",
      a.metrics.closureWaitTicks ?? 0,
      b?.metrics.closureWaitTicks ?? 0,
    ]);
    rows.push([
      "Production paused turns",
      a.metrics.productionPausedTurns ?? 0,
      b?.metrics.productionPausedTurns ?? 0,
    ]);
  }
  const schedule = (world) =>
    (world.events ?? [])
      .map((e) => `<li>${escape(describeEvent(e, world))}</li>`)
      .join("") || "<li>No scheduled mechanics.</li>";
  const inputDescription = (world) =>
    world.provenance?.type === "synthetic"
      ? "AI-generated synthetic tabletop; not a real camera capture"
      : world.provenance?.type === "photo"
        ? "User-confirmed photo layout"
        : "Authored example world";
  const embeddedPhoto = (photo, world) =>
    photo?.startsWith("data:image/")
      ? `<img src="${escape(photo)}" alt="${world.provenance?.type === "synthetic" ? "AI-generated test input" : "Confirmed tabletop input"}" />`
      : "";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(project.name)} — LiveWorld experiment</title>
  <style>body{font:16px/1.6 system-ui,sans-serif;color:#2e3c2e;max-width:940px;padding:36px;margin:auto;background:#fffef8}h1,h2{font-family:Georgia,serif}h1{font-size:42px;line-height:1.2}small{color:#66725e}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid #dfe4d8}th{background:#f1f4eb}img{max-width:100%;max-height:380px;object-fit:contain}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;padding:15px;background:#f1f4eb}li{margin:7px 0}@media print{body{padding:0;background:white}details{display:none}}</style>
  <small>LIVEWORLD · REPLAYABLE EXPERIMENT · ${escape(new Date().toISOString())}</small><h1>${escape(project.name)}</h1>
  <p>${escape(project.world.name)}${trial ? ` · B: ${escape(trial.label)}` : ""}</p>
  <p>Input A: <strong>${inputDescription(project.world)}</strong>${trial ? `. Input B: <strong>${inputDescription(trial.world)}</strong>` : ""}. Outcomes below were recomputed by the deterministic simulator when this report was exported.</p>
  ${embeddedPhoto(project.photo, project.world)}
  ${project.world.events?.length || trial?.world.events?.length ? `<h2>Playable schedule</h2><h3>A · Original</h3><ul>${schedule(project.world)}</ul>${trial ? `<h3>B · Candidate</h3><ul>${schedule(trial.world)}</ul>` : ""}<p>Intervals include both endpoint turns. Existing bridge occupants finish crossing; new routes avoid closed bridges where possible. Production pauses retain stock and preserve the production clock.</p>` : ""}
  <h2>Measured outcome</h2><table><thead><tr><th>Measurement</th><th>A · Original</th>${b ? "<th>B · Candidate</th>" : ""}</tr></thead><tbody>${rows.map(([label, av, bv]) => `<tr><td>${label}</td><td>${escape(av)}</td>${b ? `<td>${escape(bv)}</td>` : ""}</tr>`).join("")}</tbody></table>
  <h2>Confirmed test brief</h2><p>A: ${ac.passed ? "PASS" : "FAIL"}${bc ? ` · B: ${bc.passed ? "PASS" : "FAIL"}` : ""}. Criteria are evaluated by code, independently of model prose. Null total means all demand; null waiting means no waiting limit.</p><table><tr><th>Condition</th><th>A</th>${b ? "<th>B</th>" : ""}</tr>${contractRows}</table><pre>${escape(JSON.stringify(ac.contract, null, 2))}</pre>
  ${trial ? `<h2>What changed</h2><ul>${(changes.length ? changes : ["No layout or rule differences."]).map((text) => `<li>${escape(text)}</li>`).join("")}</ul><p>Trial source: ${escape(trial.source)}. ${["agent", "local"].includes(trial.kind) ? "The playtest patch is constrained to one bridge move or one dispatch change." : "This is a creator design comparison. Resources, demand or deadlines may differ; inspect the listed changes."}</p>${embeddedPhoto(trial.photo, trial.world)}` : ""}
  <h2>Who gains? Who loses?</h2><table><tr><th>Home</th><th>A on time</th><th>B on time</th><th>Change</th><th>Completion A → B</th></tr>${householdComparison(
    a,
    b,
  )
    .map(
      (h) =>
        `<tr><td>${escape(h.label)}</td><td>${h.before ?? "—"}</td><td>${h.after ?? "—"}</td><td>${h.delta ?? "—"}</td><td>${h.completedBefore ?? "pending"} → ${h.completedAfter ?? "—"}</td></tr>`,
    )
    .join("")}</table>
  ${stress ? `<h2>Design sensitivity · all deadlines −3…+3 turns</h2><p>A passes ${stress.passedA}/${stress.validCases}; B passes ${stress.passedB}/${stress.validCases} selected valid conditions. ${escape(stress.scope)}</p><table><tr><th>Deadline offset</th><th>A on time / brief</th><th>B on time / brief</th><th>B completion slack</th></tr>${stress.cases.map((c) => (c.valid ? `<tr><td>${c.offset}</td><td>${c.a.metrics.onTime}/${c.a.metrics.demand} · ${c.a.contract.passed ? "PASS" : "FAIL"}</td><td>${c.b.metrics.onTime}/${c.b.metrics.demand} · ${c.b.contract.passed ? "PASS" : "FAIL"}</td><td>${c.b.completionSlack ?? "incomplete"}</td></tr>` : `<tr><td>${c.offset}</td><td colspan="3">Invalid condition: ${escape(c.reason)}</td></tr>`)).join("")}</table><p>Completion slack is minimum deadline minus final household arrival, not a statistical confidence estimate or the margin for every contract.</p>` : ""}
  <details><summary>Verified delivery receipts · A${b ? " and B" : ""}</summary><p>Receipts pair dispatch and delivery engine events by courier. References use 1-based event order in the deterministic replay. Across A/B, compare home and arrival order; do not assume the same parcel or courier. Outbound wait excludes return trips. Undelivered units have no completed receipt.</p><h3>A</h3>${receiptTable(a)}${b ? `<h3>B</h3>${receiptTable(b)}` : ""}</details>
  <p>Seed A: ${project.world.seed}${trial ? ` · Seed B: ${trial.world.seed}` : ""}. Horizon A: ${project.world.rules.horizon}${trial ? ` · Horizon B: ${trial.world.rules.horizon}` : ""}. This result describes these inputs only. It is not a benchmark of camera reliability or game-design productivity.</p>
  <p>Download the matching LiveWorld project file to open, inspect and replay the inputs in the app. An imported file does not authenticate provider activity; imported results are always recomputed.</p>
  <details><summary>World inputs</summary><pre>${escape(JSON.stringify({ a: project.world, b: trial?.world ?? null }, null, 2))}</pre></details></html>`;
}
