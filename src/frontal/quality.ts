import type { RenderQuality } from "./layout.js";

/**
 * Resolve the `quality` prop. "auto" → "low" on coarse-pointer devices or
 * small screens (phones), otherwise "high". SSR-safe (defaults to "high").
 */
export function resolveQuality(q: "auto" | "high" | "low" | undefined): RenderQuality {
  if (q === "high" || q === "low") return q;
  if (typeof window === "undefined") return "high";
  try {
    const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    const small = Math.min(window.screen?.width ?? 1920, window.screen?.height ?? 1080) < 700;
    return coarse || small ? "low" : "high";
  } catch {
    return "high";
  }
}
