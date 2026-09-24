import jsQR from 'jsqr';

export function addressFromQr(text, validate) {
  if (typeof text !== 'string' || text.length > 2048) return null;
  const value = text.trim();
  // Only extract a receiving address. Never open URLs or execute payment requests.
  const address = /^solana:/i.test(value) ? value.slice(7).split('?')[0] : value;
  return validate(address);
}

export function decodeQr(source, width, height) {
  if (!width || !height) return null;
  const scale = Math.min(1, 1600 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(pixels.data, pixels.width, pixels.height)?.data || null;
}

export async function decodeImage(file) {
  if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) throw new Error('INVALID_IMAGE');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return decodeQr(image, image.naturalWidth, image.naturalHeight);
  } finally { URL.revokeObjectURL(url); }
}
