import { mkdir, readFile, copyFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const vendor = new URL("../public/vendor/", import.meta.url);
const pkg = new URL("../node_modules/mediabunny/", import.meta.url);
const metadata = JSON.parse(
  await readFile(new URL("package.json", pkg), "utf8"),
);
if (metadata.version !== "1.62.1")
  throw new Error("Use the pinned Mediabunny version.");
await mkdir(vendor, { recursive: true });
await copyFile(
  new URL("dist/bundles/mediabunny.min.mjs", pkg),
  new URL("mediabunny.js", vendor),
);
await copyFile(
  new URL("LICENSE", pkg),
  new URL("MEDIABUNNY-LICENSE.txt", vendor),
);
const sha256 = createHash("sha256")
  .update(await readFile(new URL("mediabunny.js", vendor)))
  .digest("hex");
await writeFile(
  new URL("media-origin.json", vendor),
  JSON.stringify(
    {
      package: "mediabunny",
      version: metadata.version,
      source: "https://github.com/Vanilagy/mediabunny/tree/v1.62.1",
      npm: "https://www.npmjs.com/package/mediabunny/v/1.62.1",
      license: metadata.license,
      distribution:
        "Unmodified dist/bundles/mediabunny.min.mjs from the pinned npm package",
      sha256,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({ package: metadata.name, version: metadata.version, sha256 }),
);
