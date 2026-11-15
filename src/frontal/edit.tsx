/**
 * Drag editing for <FrontalTank> (contract 1.2.0): picking + drag controller
 * and the selection halo. Mounted inside the R3F <Canvas> only when
 * `editable` is true, so a non-editable tank has no handlers at all.
 *
 * The camera never moves. All screen ↔ tank maths lives in editMath.ts.
 */
import { useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { EditMoveEvent, EditTarget, HardscapeVisual, PlantVisual, SpeciesLook } from "../contract.js";
import {
  DragSession,
  dragScale,
  hardscapePickShape,
  pickTarget,
  plantPickShape,
  visibleGlass,
  type PickHit,
  type PickShape,
} from "./editMath.js";
import { substrateHeight } from "./layout.js";
import { stonePlacement } from "./stones.js";
import type { TankGeom } from "./tank.js";

export interface EditPropsSnapshot {
  plants: PlantVisual[];
  hardscape: HardscapeVisual[];
  species: Record<string, SpeciesLook>;
  onSelect?: ((t: EditTarget | null) => void) | undefined;
  onMove?: ((e: EditMoveEvent) => void) | undefined;
}

function positionOf(s: EditPropsSnapshot, t: EditTarget): { x: number; z: number } | null {
  const item = t.kind === "plant" ? s.plants.find((p) => p.id === t.id) : s.hardscape.find((h) => h.id === t.id);
  return item ? { x: item.x, z: item.z } : null;
}

/**
 * Pointer controller. Listens on the canvas element (DOM events, not R3F
 * mesh events) so picking is per PlantVisual clump / per hardscape piece.
 */
export function EditController({
  g,
  props,
  roots,
  onDragChange,
}: {
  g: TankGeom;
  props: MutableRefObject<EditPropsSnapshot>;
  roots: Map<string, THREE.Object3D>;
  onDragChange: (t: EditTarget | null) => void;
}): null {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const dragCb = useRef(onDragChange);
  dragCb.current = onDragChange;

  useEffect(() => {
    const el = gl.domElement;
    const prevTouch = el.style.touchAction;
    const prevCursor = el.style.cursor;
    el.style.touchAction = "none";

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let session: DragSession | null = null;
    let pointerId = -1;
    let pending: EditMoveEvent | null = null;
    let moveRaf = 0;
    let hoverRaf = 0;
    let hoverPt: [number, number] | null = null;

    const local = (e: PointerEvent): [number, number, number, number] => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top, r.width, r.height];
    };

    const pick = (px: number, py: number, w: number, h: number): EditTarget | null => {
      const s = props.current;
      const shapes: PickShape[] = [];
      for (const p of s.plants) shapes.push(plantPickShape(g, w, h, p, s.species[p.speciesId]));
      const extra: PickHit[] = [];
      // stones / wood: precise raycast for direct hits …
      const objs = [...roots.values()];
      if (objs.length && w > 0 && h > 0) {
        ndc.set((px / w) * 2 - 1, -(py / h) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObjects(objs, true)[0];
        if (hit) {
          let o: THREE.Object3D | null = hit.object;
          while (o && o.userData.hardscapeId === undefined) o = o.parent;
          if (o) extra.push({ target: { kind: "hardscape", id: o.userData.hardscapeId as string }, z: hit.point.z, dist: 0 });
        }
      }
      // … plus the screen-space shape for the 44 px small-target rule
      for (const hs of s.hardscape) {
        const pl = stonePlacement(hs, g.profile);
        const sh = hardscapePickShape(g, w, h, hs, pl.bottomY + pl.height);
        shapes.push({ ...sh, radiusOnly: true });
      }
      return pickTarget(shapes, px, py, extra);
    };

    const emit = (ev: EditMoveEvent | null | undefined) => {
      if (ev) props.current.onMove?.(ev);
    };

    const flushMove = () => {
      moveRaf = 0;
      const ev = pending;
      pending = null;
      emit(ev);
    };

    const finish = () => {
      if (moveRaf) cancelAnimationFrame(moveRaf);
      moveRaf = 0;
      pending = null;
      if (pointerId >= 0 && el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId);
      session = null;
      pointerId = -1;
    };

    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      if (session) return;
      const [px, py, w, h] = local(e);
      const target = pick(px, py, w, h);
      props.current.onSelect?.(target);
      if (!target) return;
      const origin = positionOf(props.current, target);
      if (!origin) return;
      session = new DragSession(target, origin, { x: px, y: py }, { w: g.w, d: g.d }, dragScale(g, visibleGlass(g, w, h)));
      pointerId = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events */
      }
      el.style.cursor = "grabbing";
      e.preventDefault();
    };

    const onMove = (e: PointerEvent) => {
      if (session) {
        if (e.pointerId !== pointerId) return;
        const [px, py] = local(e);
        for (const ev of session.move(px, py)) {
          if (ev.phase === "start") {
            emit(ev);
            dragCb.current(ev.target);
          } else {
            pending = ev; // only the latest move per animation frame
            if (!moveRaf) moveRaf = requestAnimationFrame(flushMove);
          }
        }
        return;
      }
      const [px, py, w, h] = local(e);
      hoverPt = [px, py];
      if (!hoverRaf) {
        hoverRaf = requestAnimationFrame(() => {
          hoverRaf = 0;
          if (session || !hoverPt) return;
          const r = el.getBoundingClientRect();
          el.style.cursor = pick(hoverPt[0], hoverPt[1], r.width || w, r.height || h) ? "grab" : "";
        });
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!session || e.pointerId !== pointerId) return;
      const [px, py] = local(e);
      const s = session;
      finish(); // drops a pending throttled move: "end" carries the final position
      const ev = s.end(px, py);
      emit(ev);
      if (ev) dragCb.current(null);
      el.style.cursor = "grab";
    };

    const cancel = () => {
      if (!session) return;
      const s = session;
      finish();
      const ev = s.cancel();
      emit(ev);
      if (ev) dragCb.current(null);
      el.style.cursor = "";
    };

    const onCancel = (e: PointerEvent) => {
      if (session && e.pointerId === pointerId) cancel();
    };
    const onLost = (e: PointerEvent) => {
      if (session && e.pointerId === pointerId && session.active) cancel();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && session) cancel();
    };
    const onLeave = () => {
      hoverPt = null;
      if (!session) el.style.cursor = "";
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("lostpointercapture", onLost);
    el.addEventListener("pointerleave", onLeave);
    window.addEventListener("keydown", onKey);
    return () => {
      if (session) cancel();
      if (hoverRaf) cancelAnimationFrame(hoverRaf);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("lostpointercapture", onLost);
      el.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onKey);
      el.style.touchAction = prevTouch;
      el.style.cursor = prevCursor;
    };
  }, [gl, camera, g, props, roots]);

  return null;
}

// ---------------------------------------------------------------------------
// Selection halo

/** Primary #0A6F78 at ~60%. */
const HALO_COLOR = "#0A6F78";
const HALO_ALPHA = 0.6;
/** halo sits this far outside the footprint so it isn't buried under the item */
const HALO_PAD_CM = 0.6;
const HALO_SEG = 48;
const HALO_EXTENT = 1.35;

export interface HaloSpec {
  x: number;
  z: number;
  /** half-axes along local x / z, cm */
  a: number;
  b: number;
  rotationY: number;
}

/** Footprint ellipse (padded) for the selected item, or null. */
export function haloSpec(
  sel: EditTarget | null | undefined,
  plants: readonly PlantVisual[],
  hardscape: readonly HardscapeVisual[],
): HaloSpec | null {
  if (!sel) return null;
  if (sel.kind === "hardscape") {
    const h = hardscape.find((v) => v.id === sel.id);
    if (!h) return null;
    return { x: h.x, z: h.z, a: Math.abs(h.sizeCm[0]) / 2 + HALO_PAD_CM, b: Math.abs(h.sizeCm[2]) / 2 + HALO_PAD_CM, rotationY: h.rotationY || 0 };
  }
  const p = plants.find((v) => v.id === sel.id);
  if (!p) return null;
  const r = Math.max(0.5, p.spreadCm || 0) / 2 * 0.8 + HALO_PAD_CM;
  return { x: p.x, z: p.z, a: r, b: r, rotationY: 0 };
}

const HALO_VERT = /* glsl */ `
attribute vec2 aEll;
attribute float aFront;
varying vec2 vEll;
varying float vFront;
void main() {
  vEll = aEll;
  vFront = aFront;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Ring drawn as a distance field in *screen* pixels (fwidth), so it stays a
// thin ~2 px line plus a soft glow even though the bed is seen almost edge-on
// from the front camera. The half behind the item fades out (the item itself
// would hide it), leaving a soft arc on the bed in front of / under it.
const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uPxScale;
varying vec2 vEll;
varying float vFront;
void main() {
  float f = length(vEll) - 1.0;
  // distance in css px (fwidth is in device px)
  float px = abs(f) / max(fwidth(f), 1e-5) * uPxScale;
  float core = 1.0 - smoothstep(0.5, 1.5, px);
  float glow = 0.35 * exp(-px * px / 14.0);
  float a = uAlpha * max(core, glow) * smoothstep(-0.35, 0.3, vFront);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

export function SelectionHalo({ g, spec }: { g: TankGeom; spec: HaloSpec | null }) {
  const invalidate = useThree((s) => s.invalidate);
  const dpr = useThree((s) => s.viewport.dpr);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: HALO_VERT,
        fragmentShader: HALO_FRAG,
        uniforms: {
          uColor: { value: new THREE.Color(HALO_COLOR) },
          uAlpha: { value: HALO_ALPHA },
          uPxScale: { value: 1 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => {
    mat.uniforms.uPxScale!.value = 1 / Math.max(0.5, dpr || 1);
    invalidate();
  }, [mat, dpr, invalidate]);

  const key = spec ? `${spec.x}|${spec.z}|${spec.a}|${spec.b}|${spec.rotationY}` : "";
  const geo = useMemo(() => (spec ? makeHaloGeometry(g, spec) : null), [g, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => geo?.dispose(), [geo]);
  useEffect(() => invalidate(), [geo, invalidate]);

  if (!geo) return null;
  return <mesh geometry={geo} material={mat} renderOrder={8} frustumCulled={false} />;
}

/** Grid patch over the padded footprint, draped on the sloped bed. */
export function makeHaloGeometry(g: TankGeom, s: HaloSpec): THREE.BufferGeometry {
  const n = HALO_SEG;
  const cos = Math.cos(s.rotationY);
  const sin = Math.sin(s.rotationY);
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  const ell = new Float32Array((n + 1) * (n + 1) * 2);
  const front = new Float32Array((n + 1) * (n + 1));
  const ez = Math.hypot(s.a * sin, s.b * cos) || 1;
  let k = 0;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const u = (i / n) * 2 - 1;
      const v = (j / n) * 2 - 1;
      const lx = u * HALO_EXTENT * s.a;
      const lz = v * HALO_EXTENT * s.b;
      const wx = s.x + lx * cos + lz * sin;
      const wz = s.z - lx * sin + lz * cos;
      pos[k * 3] = wx;
      pos[k * 3 + 1] = substrateHeight(g.profile, wx, wz) + 0.05;
      pos[k * 3 + 2] = wz;
      ell[k * 2] = u * HALO_EXTENT;
      ell[k * 2 + 1] = v * HALO_EXTENT;
      front[k] = (wz - s.z) / ez;
      k++;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      idx.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aEll", new THREE.BufferAttribute(ell, 2));
  geo.setAttribute("aFront", new THREE.BufferAttribute(front, 1));
  geo.setIndex(idx);
  return geo;
}
