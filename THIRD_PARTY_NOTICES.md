# Third-party components

LiveWorld's replay clip exporter uses the unmodified browser distribution of
[Mediabunny 1.62.1](https://github.com/Vanilagy/mediabunny/tree/v1.62.1), by Vanilagy,
under the Mozilla Public License 2.0. Its license is included in
[`public/vendor/MEDIABUNNY-LICENSE.txt`](public/vendor/MEDIABUNNY-LICENSE.txt).
The corresponding source is available from the linked release tag and the pinned
npm package. `node scripts/vendor-media.mjs` reproduces the copied distribution;
[`media-origin.json`](public/vendor/media-origin.json) records its SHA-256.

Mediabunny provides media encoding/container support. The simulation, world and
rule formats, renderer, agent tools, comparison logic and exporter composition
were developed for LiveWorld. Meta provides the models and `@meta-sam/parser`.

The studio's optional 3D renderer uses the unmodified browser modules of
[Three.js 0.186.1](https://www.npmjs.com/package/three/v/0.186.1), under the MIT
license included in `public/vendor/THREE-LICENSE.txt`. `scripts/vendor-three.mjs`
copies the pinned distribution and records its hashes in `three-origin.json`.
Three.js supplies graphics primitives and rendering. LiveWorld's scene models,
lighting, framing, state mapping and interaction remain project code. A canvas
renderer remains available when WebGL cannot be used.

The offline film workflow uses FFmpeg to compose and encode media, and locally
installed Microsoft Zira speech synthesis for generic English narration. The
labelled evidence diagrams are project code rendered with Pillow 12.3.0
(installed package metadata: MIT-CMU). These recording tools are not bundled
with the runtime app. Segoe UI is read from the recording machine for rasterized
text; the font file is not distributed in this repository. Diagram data comes
from the project's independently recomputed simulator outcomes, not from
generated application screenshots.
