import { readFile, copyFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const pkg = new URL("../node_modules/three/", import.meta.url);
const vendor = new URL("../public/vendor/", import.meta.url);
const metadata = JSON.parse(
  await readFile(new URL("package.json", pkg), "utf8"),
);
if (metadata.version !== "0.186.1")
  throw new Error("Use the pinned Three.js version.");
const files = [];
for (const name of ["three.module.js", "three.core.js"]) {
  const bytes = await readFile(new URL("build/" + name, pkg));
  await writeFile(new URL(name, vendor), bytes);
  files.push({
    name,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
await copyFile(new URL("LICENSE", pkg), new URL("THREE-LICENSE.txt", vendor));
await writeFile(
  new URL("three-origin.json", vendor),
  JSON.stringify(
    {
      package: "three",
      version: metadata.version,
      license: metadata.license,
      source: "https://github.com/mrdoob/three.js",
      npm: "https://www.npmjs.com/package/three/v/0.186.1",
      distribution: "Unmodified npm browser modules",
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({ package: "three", version: metadata.version, files }),
);
