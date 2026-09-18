import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { labelFormats, qrPlacement, renderLabelPdf } from '../label-pdf.js';

test('six distinct physical formats keep each QR inside the cut area', () => {
  assert.equal(labelFormats.length, 6);
  assert.equal(new Set(labelFormats.map(f => `${f.width}x${f.height}`)).size, 6);
  assert.ok(labelFormats.some(f => f.width <= 25 && f.height <= 30));
  for (const f of labelFormats) {
    const qr = qrPlacement(f);
    assert.ok(qr.size >= 18.5);
    assert.ok(qr.x > f.x && qr.y > f.y);
    assert.ok(qr.x + qr.size < f.x + f.width);
    assert.ok(qr.y + qr.size < f.y + f.height);
    assert.ok(f.x > 10 && f.y > 10 && f.x + f.width < 200 && f.y + f.height < 287);
  }
});

test('long names and localized instructions fit a single unencrypted A4 sheet', async () => {
  for (const language of ['pt', 'en', 'es']) {
    const bytes = await renderLabelPdf({
      tag: { name: 'Mochila de viagem com acessórios '.repeat(3).slice(0, 80), code: 'abcdefghijklmnop' },
      url: 'https://api-seeker.viralizai.co/found/abcdefghijklmnop', language,
    });
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1);
    assert.ok(Math.abs(pdf.getPage(0).getSize().width - 595.28) < 0.1);
    assert.ok(Math.abs(pdf.getPage(0).getSize().height - 841.89) < 0.1);
    assert.equal(pdf.isEncrypted, false);
  }
});
