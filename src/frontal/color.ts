/** Small pure colour helpers (sRGB 0..1 triples). No three.js dependency. */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return [0.29, 0.6, 0.31];
  const n = parseInt(m[1]!, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function mixRgb(a: RGB, b: RGB, t: number, out: RGB = [0, 0, 0]): RGB {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

export function luminance(c: RGB): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Fresh young-growth green that tips are lifted towards. */
export const YOUNG_GREEN: RGB = hexToRgb("#b9e27a");
/** Yellow-brown that unhealthy foliage fades to. */
export const SICK_BROWN: RGB = hexToRgb("#b8a25a");

/**
 * Health tint: 1 → unchanged; 0 → desaturated, yellow-brown.
 * Monotonic in health so scrubbing reads smoothly.
 */
export function healthTint(c: RGB, health: number, out: RGB = [0, 0, 0]): RGB {
  const h = Math.min(1, Math.max(0, health));
  const sick = 1 - h;
  const l = luminance(c);
  // desaturate
  const ds = sick * 0.65;
  out[0] = c[0] + (l - c[0]) * ds;
  out[1] = c[1] + (l - c[1]) * ds;
  out[2] = c[2] + (l - c[2]) * ds;
  // shift towards yellow-brown
  const yb = Math.pow(sick, 1.3) * 0.75;
  return mixRgb(out, SICK_BROWN, yb, out);
}

/** Saturation proxy: max - min channel. */
export function chroma(c: RGB): number {
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}
