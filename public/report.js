import { normalizeProject, describeWorldChanges } from "../shared/project.js";
import { simulate } from "../shared/engine.js";
import { describeEvent } from "../shared/mechanics.js";

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
  ${trial ? `<h2>What changed</h2><ul>${(changes.length ? changes : ["No layout or rule differences."]).map((text) => `<li>${escape(text)}</li>`).join("")}</ul><p>Trial source: ${escape(trial.source)}. ${["agent", "local"].includes(trial.kind) ? "The playtest patch is constrained to one bridge move or one dispatch change." : "This is a creator design comparison. Resources, demand or deadlines may differ; inspect the listed changes."}</p>${embeddedPhoto(trial.photo, trial.world)}` : ""}
  <h2>Household results${b ? " · B" : ""}</h2><table><tr><th>Home</th><th>On time / demand</th><th>Delivered</th><th>Deadline</th></tr>${(b ?? a).houses.map((h) => `<tr><td>${escape(h.label)}</td><td>${h.onTime} / ${h.demand}</td><td>${h.delivered}</td><td>${h.deadline}</td></tr>`).join("")}</table>
  <p>Seed A: ${project.world.seed}${trial ? ` · Seed B: ${trial.world.seed}` : ""}. Horizon A: ${project.world.rules.horizon}${trial ? ` · Horizon B: ${trial.world.rules.horizon}` : ""}. This result describes these inputs only. It is not a benchmark of camera reliability or game-design productivity.</p>
  <p>Download the matching LiveWorld project file to open, inspect and replay the inputs in the app. An imported file does not authenticate provider activity; imported results are always recomputed.</p>
  <details><summary>World inputs</summary><pre>${escape(JSON.stringify({ a: project.world, b: trial?.world ?? null }, null, 2))}</pre></details></html>`;
}
