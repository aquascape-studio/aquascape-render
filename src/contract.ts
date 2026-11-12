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

export const RENDER_CONTRACT_VERSION = "1.0.0" as const;

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
  tipColorHex?: string;
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
}

export interface FrontalTankProps {
  tank: { widthCm: number; depthCm: number; heightCm: number };
  /** keyed by speciesId; every plants[i].speciesId must be present */
  species: Record<string, SpeciesLook>;
  plants: PlantVisual[];
  hardscape?: HardscapeVisual[];
  /**
   * "high": desktop (shadows, AO/soft contact shadow, more leaves).
   * "low": phones / low-end GPUs. "auto" (default) picks by device.
   */
  quality?: "auto" | "high" | "low";
  /** when true, no idle sway / camera easing (prefers-reduced-motion) */
  reducedMotion?: boolean;
  className?: string;
  "data-testid"?: string;
  /** fired once after the first frame is rendered */
  onReady?: () => void;
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
