import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { normalizeProject } from "../shared/project.js";
const projectPath = new URL("../demo/example-project.json", import.meta.url);
const rawProject = await fs.readFile(projectPath, "utf8");
const project = normalizeProject(JSON.parse(rawProject), { imported: true });
const selected = project.trials.find((t) => t.id === project.selectedTrialId);
assert.equal(selected.evidence.metrics.onTime, 24);
assert.equal(project.world.rules.couriers, 6);
const report = await fs.readFile(
  new URL("../demo/example-report.html", import.meta.url),
  "utf8",
);
const style = report.match(/<style>([\s\S]*?)<\/style>/);
assert.ok(
  style,
  "The actual exported report must include its standalone styles.",
);
// Bundle the exact exported measurements for the local review page. Externalizing
// CSS keeps the studio's restrictive CSP intact; downloaded reports stay standalone.
const publicRoot = new URL("../public/examples/", import.meta.url);
await fs.writeFile(new URL("studio-project.json", publicRoot), rawProject);
await fs.writeFile(new URL("studio-report.css", publicRoot), style[1]);
await fs.writeFile(
  new URL("studio-report.html", publicRoot),
  report.replace(
    style[0],
    '<link rel="stylesheet" href="/examples/studio-report.css">',
  ),
);
console.log(
  JSON.stringify({
    project: "public/examples/studio-project.json",
    report: "public/examples/studio-report.html",
    trials: project.trials.length,
    onTime: selected.evidence.metrics.onTime,
    metaRequests: 0,
  }),
);
