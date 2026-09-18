// Decode actual rasterized PDF pixels, not a separately generated QR fixture.
// node scripts/verify-label-qr.mjs sheet.png [dpi]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const bitmap = PNG.sync.read(readFileSync(process.argv[2]));
const dpi = Number(process.argv[3] || 300);
const layout = JSON.parse(readFileSync(new URL('../artifacts/label-design/layout.json', import.meta.url)));
const px = mm => Math.round(mm / 25.4 * dpi);
for (const format of layout.formats) {
  const { x, y, size } = format.qrBounds;
  const left = px(x); const top = px(y); const width = px(size);
  const pixels = new Uint8ClampedArray(width * width * 4);
  for (let row = 0; row < width; row++) {
    const offset = ((top + row) * bitmap.width + left) * 4;
    pixels.set(bitmap.data.subarray(offset, offset + width * 4), row * width * 4);
  }
  const decoded = jsQR(pixels, width, width, { inversionAttempts: 'dontInvert' });
  assert.equal(decoded?.data, layout.url, `${format.id} QR must decode from the printed PDF at ${dpi} dpi`);
  console.log(`${format.id}: ${format.width} × ${format.height} mm, QR ${size} mm, decoded at ${dpi} dpi`);
}
