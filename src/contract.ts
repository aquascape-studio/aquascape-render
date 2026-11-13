/**
 * @aquascape-studio/render — FrontalTank contract.
 *
 * OWNER: orchestrator only. Sub-agents MUST NOT edit this file; report
 * disagreements instead. Consumer: aquascape-web (/studio/sim, behind the
 * `stylizedTank` feature flag).
 *
 * Coordinates match @aquascape/sim-core: origin at the centre of the tank
 * floor (substrate surface y = 0); x left → right, z back → front (the viewer
 * looks from +z towards −z), y up. Units: cm.
 *
 * Visual direction (ROADMAP "视觉风格"): stylized, not photoreal. Front view
 * only. Pure-white studio background, soft studio light, rounded thick leaves
 * with soft back-light translucency tilted ~35° upward, dense layered foliage,
 * fresh green gradients with coral (#E8735A-ish) accents for red plants,
 * smooth sculptural stones.
 */

export const RENDER_CONTRACT_VERSION = "1.1.0" as const;

/*
 * 1.1.0 (2026-11-13, additive — style templates + composition guides):
 *  - HardscapeVisual.role (optional): Iwagumi stone role. Shapes by role:
 *    oyaishi = tallest, upright, slight forward lean, strong sculptural facets
 *    softened; fukuishi / soeishi = progressively lower and wider; suteishi =
 *    small, low, mostly buried. kind "wood" ignores role.
 *  - HardscapeVisual.buriedFrac (optional, 0..0.6, default 0.15): fraction of
 *    the stone's height sunk below the local bed surface (stones must look
 *    planted in the substrate, never floating or perched).
 *  - FrontalTankProps.guides: composition guide overlay drawn over the front
 *    glass in screen space — "thirds" (rule-of-thirds 2+2 lines), "golden"
 *    (phi lines at 0.382 / 0.618 of width and height), default "none".
 *    Thin (1 css px), #1D1D1F at 35% opacity, plus a small focal ring at
 *    `focalPoint` when given. Must not affect the 3D scene or lighting.
 *  - FrontalTankProps.focalPoint (optional): {x, y} in tank cm (front view).
 *  - FrontalTankProps.bed (optional): visual substrate slope; frontCm/backCm
 *    are bed heights at the front and back glass. Default stays as 1.0.1.
 *    Iwagumi templates use a steep slope (e.g. 2 → 9 cm).
 *  - exactOptionalPropertyTypes: every optional prop also accepts `undefined`.
 *  - Package dist must be valid Node ESM (relative imports end in ".js").
 */

/*
 * 1.0.1 (2026-11-12, doc-only, from render-agent objections):
 *  - Visual substrate: the rendered bed slopes up towards the back. PlantVisual.y
 *    and hardscape are relative to the LOCAL bed surface; the renderer adds
 *    substrateHeight(x, z) itself. Callers keep passing sim coordinates as-is.
 *  - growthForm "floating" plants sit at the water surface; their y is ignored.
 *  - Red tips come from botany visual.tipColorHex only when `visual` is present;
 *    the colorRange heuristic is a fallback for records without `visual`.
 *  - FrontalTank's return type is React's JSX.Element (import type { JSX } from "react").
 */

/** Botany growthForm values (aquascape-botany plants.json). */
export type GrowthForm =
  | "stem" | "rosette" | "carpeting" | "epiphyte" | "moss" | "floating" | "rhizome";

/** Mirrors the optional botany `visual.leafShape` field (botany schema ≥ 0.3). */
export type LeafShape =
  | "needle" | "linear" | "lanceolate" | "ovate" | "round" | "strap" | "cordate" | "moss";

/** Mirrors the optional botany `visual.arrangement` field. */
export type LeafArrangement =
  | "opposite" | "whorled" | "alternate" | "rosette" | "creeping" | "mat";

/** Per-species look. Derive from a botany record with `speciesLook()`. */
export interface SpeciesLook {
  speciesId: string;
  growthForm: GrowthForm;
  leafShape: LeafShape;
  arrangement: LeafArrangement;
  leafLengthCm: number;
  leafWidthCm: number;
  /** 0..1 relative fullness; 1 = densest (HC, moss) */
  leafDensity: number;
  /** base leaf colour under good conditions, "#rrggbb" */
  colorHex: string;
  /** optional tip / young-leaf colour, e.g. coral for red stems */
  tipColorHex?: string | undefined;
}

/**
 * One plant instance at one moment. heightCm / spreadCm / health come
 * straight from a sim-core Frame (PlantFrame); x/z/y from the PlantPlacement.
 */
export interface PlantVisual {
  id: string;
  speciesId: string;
  x: number;
  z: number;
  /** base height above substrate (epiphytes on hardscape > 0) */
  y: number;
  heightCm: number;
  /** footprint diameter */
  spreadCm: number;
  /** 0..1; low health desaturates / yellows leaves and thins them */
  health: number;
}

export interface HardscapeVisual {
  id: string;
  kind: "stone" | "wood";
  x: number;
  z: number;
  /** rotation about y, radians */
  rotationY: number;
  /** bounding size [width x, height y, depth z] in cm */
  sizeCm: [number, number, number];
  /** deterministic shape seed */
  seed: number;
  /** Iwagumi role; shapes the stone (see 1.1.0 notes). Ignored for wood. */
  role?: StoneRole | undefined;
  /** 0..0.6, default 0.15 — fraction of height buried in the bed */
  buriedFrac?: number | undefined;
}

/** Iwagumi stone roles: main, secondary, tertiary/support, scattered fill. */
export type StoneRole = "oyaishi" | "fukuishi" | "soeishi" | "suteishi";

/** Composition guide overlay. */
export type CompositionGuide = "none" | "thirds" | "golden";

export interface FrontalTankProps {
  tank: { widthCm: number; depthCm: number; heightCm: number };
  /** keyed by speciesId; every plants[i].speciesId must be present */
  species: Record<string, SpeciesLook>;
  plants: PlantVisual[];
  hardscape?: HardscapeVisual[] | undefined;
  /** composition guide overlay, default "none" (1.1.0) */
  guides?: CompositionGuide | undefined;
  /** focal point marker for the guide overlay, tank cm, front view (1.1.0) */
  focalPoint?: { x: number; y: number } | undefined;
  /** visual bed slope (1.1.0); heights in cm at the front / back glass */
  bed?: { frontCm: number; backCm: number } | undefined;
  /**
   * "high": desktop (shadows, AO/soft contact shadow, more leaves).
   * "low": phones / low-end GPUs. "auto" (default) picks by device.
   */
  quality?: "auto" | "high" | "low" | undefined;
  /** when true, no idle sway / camera easing (prefers-reduced-motion) */
  reducedMotion?: boolean | undefined;
  className?: string | undefined;
  "data-testid"?: string | undefined;
  /** fired once after the first frame is rendered */
  onReady?: (() => void) | undefined;
}

/**
 * Structural subset of a botany plants.json record (no hard dependency on
 * @aquascape-studio/botany). `visual` is optional until every species has it.
 */
export interface BotanyRecordLike {
  id: string;
  growthForm: string;
  colorHex?: string;
  colorRange?: string[];
  growth?: { maxHeightCm?: number; maxSpreadCm?: number };
  visual?: Partial<{
    leafShape: LeafShape;
    arrangement: LeafArrangement;
    leafLengthCm: number;
    leafWidthCm: number;
    leafDensity: number;
    tipColorHex: string;
  }>;
}

/**
 * Required exports of the package (implemented in src/frontal/):
 *   export function FrontalTank(props: FrontalTankProps): JSX.Element
 *   export function speciesLook(record: BotanyRecordLike): SpeciesLook
 *     — uses record.visual when present, otherwise growthForm defaults.
 */
