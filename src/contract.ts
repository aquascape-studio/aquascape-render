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

export const RENDER_CONTRACT_VERSION = "1.3.0" as const;

/*
 * 1.3.0 (2026-11-16, additive — driftwood + resizable hardscape, P2 编辑器):
 *  - HardscapeVisual.woodStyle (optional, kind "wood" only, default "branchy"):
 *    · "branchy" — spider-wood: a short buried base splitting into 4–7 slender
 *      tapered branches that fan UP and outward (canopy silhouette), a few
 *      secondary twigs. Overall bounding box = sizeCm.
 *    · "root"    — one thick trunk leaning ~30–45° (lean direction from seed),
 *      roots flaring at the base into the bed, 2–4 branches reaching towards
 *      the far side; the classic Nature-style "tree" focal piece.
 *    · "log"     — a low, mostly horizontal bog-wood chunk with 1–2 short
 *      stubs; reads as a ledge for epiphytes.
 *    Look (ROADMAP 视觉风格): smooth, sculptural, softly rounded tubes with
 *    continuous taper and soft joints — NO bark texture, no hard creases.
 *    Warm stylized brown, slightly lighter at the tips (≈ #7A5A43 → #A88466),
 *    low gloss. Wood default buriedFrac is 0.05 (only the base touches the bed).
 *    Wood is pickable/draggable like stones (1.2.0 rules).
 *  - Resizing: callers resize by changing sizeCm (uniformly or not). Changing
 *    sizeCm / rotationY / woodStyle / role of ONE piece must only rebuild that
 *    piece's geometry (cache keyed by id + seed + kind + woodStyle + role +
 *    sizeCm rounded to 0.1 cm); ≤ 8 ms CPU on the main thread per rebuild at
 *    quality "high" (vitest benchmark, node). Plants are not re-laid out unless
 *    the plant layout inputs changed.
 *  - New pure helper export: clampHardscapeXZ(h, tank, x, z) → {x, z}: clamps
 *    so that the piece's rotated footprint ellipse (see 1.2.0) stays ≥ 1 cm
 *    inside the glass on x and z. If the footprint is wider than the tank
 *    interior on an axis, that axis is centred (0). FrontalTank uses it for
 *    hardscape drags; web uses the same function in the editor reducer.
 *  - 1.2.1 behaviour fixes (from 11-15 objections), now normative:
 *    · Selection halo is a FRONT half-arc only (the back half would be hidden
 *      behind foliage), drawn without depth test so it is never occluded.
 *    · Drag threshold: a drag starts only after the pointer moved > 4 css px
 *      from pointer-down. Below that it is a click: onSelect fires, NO onMove
 *      events at all.
 *    · phase "cancel" reports the ORIGINAL x/z exactly as given in props when
 *      the drag started (not re-clamped).
 *    · Plant drags clamp the plant centre 1 cm inside the glass; hardscape
 *      drags use clampHardscapeXZ.
 */

/*
 * 1.2.0 (2026-11-15, additive — drag editing, P2 编辑器):
 *  - FrontalTankProps.editable (default false). When false the component
 *    behaves exactly like 1.1.x (no picking, no cursor change, no handlers).
 *  - Picking: pointer-down on a hardscape piece or a plant instance selects
 *    it (onSelect). Pointer-down on empty water / bed → onSelect(null).
 *    Plants are picked per PlantVisual (one id = one clump), not per leaf.
 *  - Dragging (front view only, camera never moves): horizontal pointer
 *    motion → x; vertical pointer motion → z (screen up = towards the back
 *    glass, −z). Map so that dragging across the visible tank width moves
 *    the full tank width, and dragging over 40% of the visible tank height
 *    moves the full depth. Emit onMove with phase "start" | "move" | "end";
 *    Escape or pointercancel during a drag emits phase "cancel" with the
 *    ORIGINAL x/z. Positions are clamped 1 cm inside the glass.
 *    The renderer does NOT move anything itself: the caller updates the
 *    `plants` / `hardscape` props (controlled component). Throttle "move"
 *    to ≤ 1 per animation frame.
 *  - Selection visual: selected item gets a soft halo ring on the bed under
 *    its footprint (2 px-ish, primary #0A6F78 at ~60%), plus a subtle
 *    lift (≤ 0.5 cm) while dragging. No outlines on leaves, no gizmos.
 *    Hover: cursor "grab"; dragging: "grabbing". Respect reducedMotion
 *    (no lift animation).
 *  - Touch: one-finger drag works the same (touch-action: none on the canvas
 *    only while editable). Hit targets: a plant/stone whose projected size
 *    is < 44 css px is picked within a 22 px radius of its centre.
 *  - Doc fixes from 1.1.0 objections:
 *    · suteishi default buriedFrac is 0.35 (other roles 0.15).
 *    · bed.frontCm / backCm and focalPoint.y are measured from the tank
 *      floor glass's nominal substrate plane y = 0 (sim origin), NOT from
 *      the local sloped bed surface.
 *    · Hardscape footprint = ellipse centred at (x, z), half-axes
 *      sizeCm[0]/2 (along local x) and sizeCm[2]/2 (along local z),
 *      rotated by rotationY. See footprintContains().
 */

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
  /** 0..0.6, default 0.15 (wood: 0.05) — fraction of height buried in the bed */
  buriedFrac?: number | undefined;
  /** driftwood silhouette (1.3.0), kind "wood" only; default "branchy" */
  woodStyle?: WoodStyle | undefined;
}

/** Driftwood silhouettes (1.3.0). */
export type WoodStyle = "branchy" | "root" | "log";

/** Iwagumi stone roles: main, secondary, tertiary/support, scattered fill. */
export type StoneRole = "oyaishi" | "fukuishi" | "soeishi" | "suteishi";

/** Composition guide overlay. */
export type CompositionGuide = "none" | "thirds" | "golden";

/** What can be picked / dragged in an editable FrontalTank (1.2.0). */
export interface EditTarget {
  kind: "hardscape" | "plant";
  /** HardscapeVisual.id or PlantVisual.id */
  id: string;
}

export interface EditMoveEvent {
  target: EditTarget;
  phase: "start" | "move" | "end" | "cancel";
  /** proposed position, tank cm, clamped 1 cm inside the glass */
  x: number;
  z: number;
}

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
  /** enable picking + drag editing (1.2.0), default false */
  editable?: boolean | undefined;
  /** controlled selection (1.2.0); draws the halo */
  selected?: EditTarget | null | undefined;
  /** pointer-down pick result; null = clicked empty space (1.2.0) */
  onSelect?: ((target: EditTarget | null) => void) | undefined;
  /** drag lifecycle (1.2.0); caller updates props to actually move things */
  onMove?: ((e: EditMoveEvent) => void) | undefined;
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
 *   export function footprintContains(h: HardscapeVisual, x: number, z: number, marginCm?: number): boolean
 *     — (1.2.0) true when (x, z) lies inside h's footprint ellipse grown by
 *       marginCm (default 0). Pure; used by web to reject plant drops on stones.
 *   export function clampHardscapeXZ(h: HardscapeVisual, tank: { widthCm: number; depthCm: number }, x: number, z: number): { x: number; z: number }
 *     — (1.3.0) see notes above. Pure.
 */
