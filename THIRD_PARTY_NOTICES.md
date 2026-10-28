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
