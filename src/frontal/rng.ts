/**
 * Deterministic, allocation-free hashing for instance layout.
 *
 * Every leaf draws its random parameters from `rand(seed, index, channel)`
 * rather than from a sequential PRNG, so leaf #i keeps the same placement as
 * the plant grows (more leaves are appended, existing ones never reshuffle).
 * That keeps timeline scrubbing visually stable.
 */

/** 32-bit FNV-1a hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Integer avalanche mix (lowbias32). */
function mix(x: number): number {
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Uniform float in [0, 1) from (seed, index, channel). */
export function rand(seed: number, index: number, channel: number): number {
  const h = mix(seed ^ mix(index + 0x9e3779b9) ^ mix(channel * 0x85ebca6b + 0x165667b1));
  return h / 4294967296;
}

/** Uniform float in [-1, 1). */
export function srand(seed: number, index: number, channel: number): number {
  return rand(seed, index, channel) * 2 - 1;
}
