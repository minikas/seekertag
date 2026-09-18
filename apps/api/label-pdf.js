import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { labelCopy } from './label-copy.js';

export const mm = value => value * 72 / 25.4;
// Cut sizes, not scaled copies of one layout. Coordinates are millimetres on A4.
export const labelFormats = [
  { id: 'large', x: 14, y: 76, width: 90, height: 45, qr: 35, kind: 'light' },
  { id: 'medium', x: 116, y: 76, width: 70, height: 35, qr: 27, kind: 'light' },
  { id: 'small', x: 14, y: 149, width: 55, height: 28, qr: 22, kind: 'light' },
  { id: 'compact', x: 116, y: 149, width: 45, height: 24, qr: 19, kind: 'compact' },
  { id: 'square', x: 14, y: 205, width: 30, height: 35, qr: 23, kind: 'square' },
  { id: 'mini', x: 116, y: 205, width: 25, height: 30, qr: 18.5, kind: 'square' },
];

const ink = '#0D1615';
const teal = '#00BDCD';
const muted = '#596663';

function text(doc, value, x, y, width, size, { bold = false, color = ink, height, ...options } = {}) {
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).fillColor(color)
    .text(value, mm(x), mm(y), { width: mm(width), height: mm(height ?? size * 0.9), ellipsis: true, ...options });
}

// Same vector mark as the landing-page brand: a tag with a locating reticle.
// It stays vector at every print size; no screenshot or icon font is involved.
function mark(doc, x, y, height, color = teal, detail = ink) {
  doc.save().translate(mm(x), mm(y)).scale(mm(height) / 38);
  doc.fillColor(color).roundedRect(2, 1, 28, 36, 9).fill();
  doc.lineWidth(2.5).lineCap('round').strokeColor(detail)
    .path('M13 6h6M16 15v4m0 8v4M8 23h4m8 0h4').stroke();
  doc.circle(16, 23, 6).stroke();
  doc.restore();
}

function brand(doc, x, y, height, size, color = ink, markColor = teal) {
  mark(doc, x, y, height, markColor, markColor === ink ? '#FFFFFF' : ink);
  const left = x + height * 32 / 38 + height * 0.3;
  doc.font('Helvetica-Bold').fontSize(size);
  const seekerWidth = doc.widthOfString('Seeker') / mm(1);
  text(doc, 'Seeker', left, y + (height - size / mm(1)) / 2, 35, size, { bold: true, color, lineBreak: false });
  text(doc, 'Tag', left + seekerWidth, y + (height - size / mm(1)) / 2, 20, size, { color, lineBreak: false });
}

// Four clear modules on all sides are included in the requested square size.
// Draw contiguous dark runs as vector paths so small prints stay sharp.
function qrCode(doc, matrix, x, y, size) {
  const cell = mm(size) / (matrix.size + 8);
  doc.fillColor('#FFFFFF').rect(mm(x), mm(y), mm(size), mm(size)).fill();
  doc.save().translate(mm(x) + 4 * cell, mm(y) + 4 * cell).fillColor('#000000');
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (!matrix.get(row, col)) continue;
      const start = col;
      while (col + 1 < matrix.size && matrix.get(row, col + 1)) col++;
      doc.rect(start * cell, row * cell, (col - start + 1) * cell, cell);
    }
  }
  doc.fill().restore();
}

export function qrPlacement(format) {
  return format.kind === 'square'
    ? { x: format.x + (format.width - format.qr) / 2, y: format.y + 6, size: format.qr }
    : { x: format.x + format.width - format.qr - 2.5, y: format.y + (format.height - format.qr) / 2, size: format.qr };
}

function label(doc, format, matrix, copy) {
  const { x, y, width, height, kind, id } = format;
  const qr = qrPlacement(format);
  const left = x + (id === 'large' ? 4 : 2.5);
  const textWidth = qr.x - left - 1;
  doc.save().roundedRect(mm(x), mm(y), mm(width), mm(height), mm(2)).clip();
  doc.fillColor(kind === 'compact' ? '#E4F9F7' : '#FFFFFF').rect(mm(x), mm(y), mm(width), mm(height)).fill();

  if (kind === 'square') {
    // Extra height reserves two lines for the action without shrinking the QR.
    const mini = id === 'mini';
    brand(doc, x + (mini ? 3 : 4.7), y + 1.3, 3.4, mini ? 6.3 : 7.2, ink, ink);
    text(doc, copy.shortScan, x + 1.5, qr.y + qr.size + 0.2, width - 3, mini ? 5.7 : 6.2,
      { align: 'center', height: 5.3 });
  } else {
    const large = id === 'large';
    const medium = id === 'medium';
    const small = id === 'small';
    brand(doc, left, y + (large ? 4 : 2.5), large ? 5.4 : medium ? 4.2 : 3.4,
      large ? 10.5 : medium ? 8 : 6.3, ink, ink);
    text(doc, large ? copy.found : copy.shortFound, left,
      y + (large ? 14 : medium ? 11 : 8.6), textWidth,
      large ? 17 : medium ? 14 : small ? 10 : 8, { bold: true, height: large ? 15 : medium ? 8 : 5.5 });
    if (large) {
      text(doc, copy.shortScan, left, y + 31, textWidth, 10, { color: muted, height: 10 });
    } else if (medium) {
      text(doc, copy.shortScan, left, y + 20, textWidth, 7.5, { color: muted, height: 8 });
    } else {
      text(doc, copy.shortScan, left, y + 15, textWidth, small ? 6.5 : 6, { color: muted, height: 6 });
    }
  }
  qrCode(doc, matrix, qr.x, qr.y, qr.size);
  doc.restore();
  // The cut guide is the exact advertised size and never enters the QR margin.
  doc.save().lineWidth(0.45).strokeColor('#9BAAA5').dash(1.5, { space: 2 })
    .roundedRect(mm(x), mm(y), mm(width), mm(height), mm(2)).stroke().restore();
}

export async function renderLabelPdf({ tag, url, language }) {
  const copy = labelCopy(language);
  const matrix = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules;
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `SeekerTag — ${tag.name}`, Author: 'SeekerTag' } });
  const chunks = [];
  const pdf = new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  brand(doc, 14, 14, 8, 19);
  text(doc, copy.sheet, 130, 17, 66, 8, { color: muted, align: 'right', characterSpacing: 1.1 });
  text(doc, copy.headline, 14, 33, 182, 25, { bold: true, height: 12 });
  text(doc, `${tag.name}  /  ${copy.sixSizes}`, 14, 47, 182, 9, { color: muted, height: 5 });
  doc.strokeColor('#D9E2DE').lineWidth(0.5).moveTo(mm(14), mm(57)).lineTo(mm(196), mm(57)).stroke();

  labelFormats.forEach((format, index) => {
    const caption = copy.formats[index];
    text(doc, `0${index + 1}  /  ${caption}`, format.x, format.y - 10, 83, 8, { bold: true });
    text(doc, `${format.width} × ${format.height} mm`, format.x, format.y - 5, 83, 7.5, { color: muted });
    label(doc, format, matrix, copy);
  });

  doc.strokeColor('#D9E2DE').moveTo(mm(14), mm(253)).lineTo(mm(196), mm(253)).stroke();
  text(doc, copy.actualSize, 14, 260, 105, 9, { bold: true });
  text(doc, copy.print, 14, 266, 108, 8, { color: muted, height: 8 });
  text(doc, copy.test, 14, 277, 108, 7, { color: muted, height: 8 });
  // A real 50 mm ruler lets users catch "fit to page" printer scaling.
  const rulerX = 146; const rulerY = 268;
  text(doc, copy.scaleCheck, rulerX, 260, 50, 7.5, { color: muted, align: 'right' });
  doc.strokeColor(ink).lineWidth(0.6).moveTo(mm(rulerX), mm(rulerY)).lineTo(mm(rulerX + 50), mm(rulerY)).stroke();
  for (let n = 0; n <= 50; n += 10) {
    doc.moveTo(mm(rulerX + n), mm(rulerY - (n === 0 || n === 50 ? 1.5 : 1))).lineTo(mm(rulerX + n), mm(rulerY + 1.5)).stroke();
  }
  text(doc, '50 mm', rulerX, 272, 50, 8, { align: 'right' });
  text(doc, `ID ${tag.code.slice(-8).toUpperCase()}`, rulerX, 281, 50, 7, { color: muted, align: 'right' });
  doc.end();
  return pdf;
}
