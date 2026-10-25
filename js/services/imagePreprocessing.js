// Geometry is shared by inference, evaluation and pixel-level regression tests.
export function fullFrameGeometry(width, height, size = 256) {
  if (![width, height, size].every(n => Number.isFinite(n) && n > 0)) throw new Error('Invalid image dimensions.');
  const scale = Math.min(1, size / Math.max(width, height));
  const scaledWidth = Math.max(1, Math.round(width * scale)), scaledHeight = Math.max(1, Math.round(height * scale));
  return { width: scaledWidth, height: scaledHeight, left: Math.floor((size - scaledWidth) / 2), top: Math.floor((size - scaledHeight) / 2), size };
}
export async function fullFrameImage(image, RawImage, size = 256) {
  const geometry = fullFrameGeometry(image.width, image.height, size);
  const resized = await image.resize(geometry.width, geometry.height);
  const data = new Uint8Array(size * size * 3); data.fill(128);
  for (let y = 0; y < resized.height; y++) for (let x = 0; x < resized.width; x++) {
    const src = (y * resized.width + x) * resized.channels, dst = ((y + geometry.top) * size + x + geometry.left) * 3;
    for (let c = 0; c < 3; c++) {
      const value = resized.data[src + (resized.channels <= 2 ? 0 : c)];
      const alpha = resized.channels === 4 ? resized.data[src + 3] / 255 : resized.channels === 2 ? resized.data[src + 1] / 255 : 1;
      data[dst + c] = Math.round(value * alpha + 128 * (1 - alpha));
    }
  }
  return new RawImage(data, size, size, 3);
}
