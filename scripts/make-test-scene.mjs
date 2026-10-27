import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Original, deterministic synthetic test image. This is not a real camera capture.
export function makeTestScene() {
  const width = 640;
  const height = 480;
  const pixels = Buffer.alloc(width * height * 3);
  const set = (x, y, color) => {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      const p = (y * width + x) * 3;
      pixels[p] = color[0];
      pixels[p + 1] = color[1];
      pixels[p + 2] = color[2];
    }
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const n = (x * 17 + y * 23) % 5;
      set(x, y, [225 + n, 218 + n, 199 + n]);
    }
  const rect = (x, y, w, h, color) => {
    for (let py = y; py < y + h; py++)
      for (let px = x; px < x + w; px++) set(px, py, color);
  };
  const circle = (cx, cy, r, color) => {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, color);
  };
  rect(36, 35, 568, 410, [245, 241, 225]);
  for (const [x, y] of [
    [195, 105],
    [188, 337],
    [430, 100],
    [520, 210],
    [425, 330],
    [530, 355],
  ]) {
    rect(x + 5, y + 7, 36, 37, [201, 201, 180]);
    rect(x, y, 36, 37, [121, 149, 97]);
    rect(x + 2, y + 2, 32, 9, [158, 181, 131]);
    rect(x + 29, y + 10, 7, 26, [102, 128, 80]);
  }
  for (const [x, y] of [
    [285, 120],
    [290, 345],
  ]) {
    rect(x + 3, y + 6, 98, 19, [201, 193, 168]);
    rect(x, y, 98, 19, [174, 126, 71]);
    rect(x + 2, y + 2, 93, 4, [199, 156, 99]);
  }
  circle(133, 240, 33, [204, 203, 181]);
  circle(127, 232, 31, [117, 159, 170]);
  circle(127, 232, 24, [210, 226, 222]);
  circle(127, 232, 18, [85, 134, 147]);
  circle(162, 232, 11, [117, 159, 170]);
  circle(162, 232, 6, [245, 241, 225]);
  circle(224, 238, 16, [148, 153, 136]);
  circle(220, 234, 12, [172, 175, 156]);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    pixels.copy(
      raw,
      y * (width * 3 + 1) + 1,
      y * width * 3,
      (y + 1) * width * 3,
    );
  function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const name = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return {
    width,
    height,
    bytes: Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const scene = makeTestScene();
  const directory = fileURLToPath(new URL("../captures/", import.meta.url));
  await mkdir(directory, { recursive: true });
  await writeFile(
    new URL("../captures/synthetic-tabletop.png", import.meta.url),
    scene.bytes,
  );
  console.log(
    "Created captures/synthetic-tabletop.png (synthetic diagnostic fixture, not a camera photo).",
  );
}
