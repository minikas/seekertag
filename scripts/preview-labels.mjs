import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderLabelPdf, labelFormats, qrPlacement } from '../apps/api/label-pdf.js';

const output = resolve('artifacts/label-design');
mkdirSync(output, { recursive: true });
const tag = { name: 'Laptop', code: 'tw7XjRwb1k0xQyiW' };
const url = `https://api-seeker.viralizai.co/found/${tag.code}`;
for (const language of ['pt', 'en', 'es']) {
  writeFileSync(resolve(output, `seekertag-labels-${language}.pdf`), await renderLabelPdf({ tag, url, language }));
}
writeFileSync(resolve(output, 'layout.json'), JSON.stringify({ url, formats: labelFormats.map(format => ({ ...format, qrBounds: qrPlacement(format) })) }, null, 2));
console.log(output);
