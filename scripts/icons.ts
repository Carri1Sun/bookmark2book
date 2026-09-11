import { deflateSync } from 'node:zlib';
import fs from 'node:fs/promises';
function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name: string, data: Buffer) {
  const type = Buffer.from(name),
    length = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}
export async function buildIcons(directory: string) {
  for (const size of [16, 32, 48, 128]) {
    const raw = Buffer.alloc((size * 4 + 1) * size);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        let red = 0,
          green = 0,
          blue = 0;
        for (let sy = 0; sy < 4; sy++)
          for (let sx = 0; sx < 4; sx++) {
            const px = ((x + (sx + 0.5) / 4) / size) * 128,
              py = ((y + (sy + 0.5) / 4) / size) * 128;
            let color = [245, 243, 236];
            const bottom = 96 + Math.abs(px - 64) * 0.55;
            if (px >= 36 && px <= 92 && py >= 22 && py <= bottom) color = [35, 83, 71];
            if (px >= 48 && px <= 80 && ((py >= 39 && py <= 42) || (py >= 52 && py <= 55)))
              color = [245, 243, 236];
            red += color[0]!;
            green += color[1]!;
            blue += color[2]!;
          }
        const at = y * (size * 4 + 1) + 1 + x * 4;
        raw[at] = Math.round(red / 16);
        raw[at + 1] = Math.round(green / 16);
        raw[at + 2] = Math.round(blue / 16);
        raw[at + 3] = 255;
      }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 6;
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    await fs.writeFile(`${directory}/icon-${size}.png`, png);
  }
}
