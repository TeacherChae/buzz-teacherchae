export const APP_BADGE_ICON_SIZE = 16;

/** Creates a red dot on a transparent background. */
export function createAppBadgeIconPixels(): Uint8Array {
  const size = APP_BADGE_ICON_SIZE;
  const pixels = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  const radius = 6;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - center, y - center);
      const opacity = Math.max(0, Math.min(1, radius + 0.5 - distance));

      if (opacity === 0) {
        continue;
      }

      const offset = (y * size + x) * 4;
      pixels[offset] = 239;
      pixels[offset + 1] = 68;
      pixels[offset + 2] = 68;
      pixels[offset + 3] = Math.round(opacity * 255);
    }
  }

  return pixels;
}
