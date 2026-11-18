/**
 * <FrontalTank> — stylized, front-view-only aquarium scene.
 *
 * Contract: src/contract.ts (orchestrator-owned). Visual direction: clean,
 * soft studio look on pure white; dense layered foliage built from a handful
 * of InstancedMeshes (one per leaf shape) whose matrices/colours are
 * rewritten in place when props change (timeline scrubbing); geometry and
 * materials are created once.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { JSX, RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { CompositionGuide, EditTarget, FrontalTankProps, HardscapeVisual, PlantVisual, SpeciesLook } from "../contract.js";
import { EditController, SelectionHalo, haloSpec, type EditPropsSnapshot } from "./edit.js";
import {
  LAYER_KEYS,
  substrateHeight,
  type LayerKey,
  type RenderQuality,
} from "./layout.js";
import { makeLayerGeometry, makeSubstrateGeometry } from "./geometry.js";
import { HardscapeGeometryCache } from "./hardscapeCache.js";
import { makeFoliageMaterial, makeSharedUniforms, makeSubstrateMaterial, type SharedUniforms } from "./materials.js";
import { resolveQuality } from "./quality.js";
import { FieldSync } from "./fieldSync.js";
import { stonePlacement } from "./stones.js";
import { attachedBedRef, makeSurfaceField, pieceSurface, surfaceKey, type PlacedSurface, type SurfaceField } from "./surface.js";
import { fitCamera, focalToScreen, frontGlassRect, guideLines, tankGeom, type TankGeom } from "./tank.js";

const BG = "#ffffff";

// ---------------------------------------------------------------------------

function SceneSetup({ g, quality }: { g: TankGeom; quality: RenderQuality }) {
  const { gl, scene, camera, size, invalidate } = useThree();

  useLayoutEffect(() => {
    gl.toneMapping = THREE.NeutralToneMapping;
    gl.toneMappingExposure = 1.0;
    gl.setClearColor(BG, 1);
    scene.background = new THREE.Color(BG);
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    room.dispose();
    pmrem.dispose();
    invalidate();
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, scene, invalidate]);

  // Front-on camera that fits the tank front face (plus margin) to the canvas.
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const fit = fitCamera(g, size.width / Math.max(1, size.height));
    cam.fov = fit.fov;
    cam.aspect = fit.aspect;
    cam.near = 1;
    cam.far = fit.z + g.d * 4 + 200;
    cam.position.set(fit.x, fit.y, fit.z);
    cam.lookAt(fit.x, fit.y, -1e4);
    cam.updateProjectionMatrix();
    invalidate();
  }, [camera, size.width, size.height, g, invalidate]);

  useEffect(() => {
    gl.shadowMap.enabled = quality === "high";
    gl.shadowMap.type = THREE.PCFShadowMap;
  }, [gl, quality]);

  return null;
}

function Lights({ g, quality, uniforms }: { g: TankGeom; quality: RenderQuality; uniforms: SharedUniforms }) {
  const key = useRef<THREE.DirectionalLight>(null);
  const back = useRef<THREE.DirectionalLight>(null);
  const yc = -g.floor + g.h / 2;
  const keyPos = useMemo(() => new THREE.Vector3(-g.w * 0.35, g.h * 2.4, g.d * 1.6), [g]);
  const backPos = useMemo(() => new THREE.Vector3(g.w * 0.2, g.h * 1.6, -g.d * 2.2), [g]);

  useLayoutEffect(() => {
    const k = key.current;
    if (k) {
      k.target.position.set(0, 0, 0);
      k.target.updateMatrixWorld();
      const s = Math.max(g.w, g.d, g.h) * 0.75;
      const cam = k.shadow.camera;
      cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
      cam.near = 1; cam.far = keyPos.length() * 2 + g.h;
      cam.updateProjectionMatrix();
      k.shadow.mapSize.set(2048, 2048);
      k.shadow.bias = -0.0004;
      k.shadow.normalBias = 0.04;
      k.shadow.radius = 4;
    }
    const b = back.current;
    if (b) {
      b.target.position.set(0, yc, 0);
      b.target.updateMatrixWorld();
    }
    uniforms.uBackDir.value.copy(backPos).sub(new THREE.Vector3(0, yc, 0)).normalize();
  }, [g, keyPos, backPos, yc, uniforms]);

  return (
    <>
      <hemisphereLight args={["#ffffff", "#e3eadc", 0.55]} />
      <directionalLight ref={key} position={keyPos} intensity={2.3} color="#fffaf2" castShadow={quality === "high"} />
      <directionalLight ref={back} position={backPos} intensity={1.0} color="#f4fff0" />
      <directionalLight position={[g.w * 0.8, g.h * 0.6, g.d * 2]} intensity={0.35} color="#ffffff" />
    </>
  );
}

// ---------------------------------------------------------------------------

function TankShell({ g }: { g: TankGeom }) {
  const t = 0.35;
  const y0 = -g.floor;
  const y1 = g.topY;
  const hw = g.w / 2;
  const hd = g.d / 2;
  const glassMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#cfe2df",
        roughness: 0.12,
        metalness: 0,
        transparent: true,
        opacity: 0.6,
        envMapIntensity: 1.3,
        clearcoat: 1,
      }),
    [],
  );
  const volumeMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#eef6f4",
        side: THREE.FrontSide,
        toneMapped: false,
      }),
    [],
  );
  const waterLineMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#d4e8e5", transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false }),
    [],
  );
  const waterSurfMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#e4f1ef", transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false }),
    [],
  );
  const reflectMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {},
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `varying vec2 vUv; void main(){
          float k = vUv.x * 0.55 + vUv.y;
          float a = 0.07 * smoothstep(0.62, 0.72, k) * (1.0 - smoothstep(0.78, 0.9, k));
          a += 0.035 * smoothstep(0.95, 1.0, k) * (1.0 - smoothstep(1.02, 1.1, k));
          a += 0.025 * (1.0 - vUv.y);
          gl_FragColor = vec4(1.0, 1.0, 1.0, a);
        }`,
      }),
    [],
  );
  const shadowTex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const grd = ctx.createRadialGradient(128, 32, 4, 128, 32, 128);
    grd.addColorStop(0, "rgba(40,50,45,0.22)");
    grd.addColorStop(1, "rgba(40,50,45,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 256, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  useEffect(
    () => () => {
      glassMat.dispose();
      volumeMat.dispose();
      waterLineMat.dispose();
      waterSurfMat.dispose();
      reflectMat.dispose();
      shadowTex?.dispose();
    },
    [glassMat, volumeMat, waterLineMat, waterSurfMat, reflectMat, shadowTex],
  );

  const H = y1 - y0;
  const edges: { p: [number, number, number]; s: [number, number, number] }[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) edges.push({ p: [sx * hw, y0 + H / 2, sz * hd], s: [t, H, t] });
  for (const y of [y0, y1]) {
    for (const sz of [-1, 1]) edges.push({ p: [0, y, sz * hd], s: [g.w, t, t] });
    for (const sx of [-1, 1]) edges.push({ p: [sx * hw, y, 0], s: [t, t, g.d] });
  }

  return (
    <group>
      {/* faint water volume tint (inner back/side faces only) */}
      <mesh position={[0, (y0 + g.waterY) / 2, -hd + t]} material={volumeMat} renderOrder={-1}>
        <planeGeometry args={[g.w - t, g.waterY - y0]} />
      </mesh>
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * (hw - t / 2), (y0 + g.waterY) / 2, 0]} rotation={[0, -sx * Math.PI / 2, 0]} material={volumeMat} renderOrder={-1}>
          <planeGeometry args={[g.d - t, g.waterY - y0]} />
        </mesh>
      ))}
      {edges.map((e, i) => (
        <mesh key={i} position={e.p} material={glassMat} renderOrder={5}>
          <boxGeometry args={e.s} />
        </mesh>
      ))}
      {/* water surface line */}
      <mesh position={[0, g.waterY, hd - 0.4]} material={waterLineMat} renderOrder={6}>
        <boxGeometry args={[g.w - t, 0.25, 0.4]} />
      </mesh>
      <mesh position={[0, g.waterY, 0]} rotation={[Math.PI / 2, 0, 0]} material={waterSurfMat} renderOrder={6}>
        <planeGeometry args={[g.w - t, g.d - t]} />
      </mesh>
      {/* faint front-glass reflection */}
      <mesh position={[0, y0 + H / 2, hd + 0.2]} material={reflectMat} renderOrder={10}>
        <planeGeometry args={[g.w, H]} />
      </mesh>
      {shadowTex && (
        <mesh position={[0, y0 - 0.05, hd + 1]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-2}>
          <planeGeometry args={[g.w * 1.25, g.d * 0.7]} />
          <meshBasicMaterial map={shadowTex} transparent depthWrite={false} toneMapped={false} />
        </mesh>
      )}
    </group>
  );
}

function Substrate({ g, quality }: { g: TankGeom; quality: RenderQuality }) {
  const geo = useMemo(() => makeSubstrateGeometry(g.profile, g.floor), [g]);
  const mat = useMemo(() => makeSubstrateMaterial(), []);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  return <mesh geometry={geo} material={mat} receiveShadow={quality === "high"} />;
}

const STONE_TONES = ["#a7a39c", "#9d9992", "#aeaaa3", "#99958f"];

/** Max lift of the dragged item (contract 1.2.0: ≤ 0.5 cm). */
const DRAG_LIFT_CM = 0.4;

type StoneMats = { stones: THREE.MeshStandardMaterial[]; wood: THREE.MeshStandardMaterial };

/**
 * One hardscape piece. Geometry comes from the per-piece cache (1.3.0), keyed
 * by shape inputs only (id, seed, kind, woodStyle, role, sizeCm @ 0.1 cm), so
 * dragging (x/z) or rotating never rebuilds it and resizing one piece rebuilds
 * only that piece — the placement group just moves / rotates.
 */
function HardscapeItem({
  h,
  g,
  mats,
  shadows,
  lifted,
  reducedMotion,
  roots,
  cache,
  quality,
}: {
  h: HardscapeVisual;
  g: TankGeom;
  mats: StoneMats;
  shadows: boolean;
  lifted: boolean;
  reducedMotion: boolean;
  roots: Map<string, THREE.Object3D> | null;
  cache: HardscapeGeometryCache;
  quality: RenderQuality;
}) {
  // cache hit unless this piece's shape key changed (disposal handled by the cache)
  const geo = cache.get(h, quality);
  const place = useMemo(() => stonePlacement(h, g.profile), [h, g]);
  const outer = useRef<THREE.Group>(null);
  const lift = useRef(0);
  const invalidate = useThree((st) => st.invalidate);
  const target = lifted && !reducedMotion ? DRAG_LIFT_CM : 0;

  useLayoutEffect(() => {
    const o = outer.current;
    if (!o) return;
    o.userData.hardscapeId = h.id;
    if (roots) roots.set(h.id, o);
    return () => {
      if (roots && roots.get(h.id) === o) roots.delete(h.id);
    };
  }, [h.id, roots]);

  useLayoutEffect(() => {
    // reduced motion / not lifted: snap (no animation)
    if (reducedMotion || target === 0) {
      lift.current = target;
      if (outer.current) outer.current.position.y = place.bottomY + target;
      invalidate();
    }
  }, [target, reducedMotion, place.bottomY, invalidate]);

  useFrame((_, dt) => {
    const o = outer.current;
    if (!o || lift.current === target) return;
    const k = 1 - Math.exp(-Math.min(0.1, dt) * 18);
    lift.current += (target - lift.current) * k;
    if (Math.abs(target - lift.current) < 0.005) lift.current = target;
    o.position.y = place.bottomY + lift.current;
  });

  return (
    // outer group: bed placement + lean (in tank space); inner: rotation about y
    <group ref={outer} position={[h.x, place.bottomY + lift.current, h.z]} rotation={[place.leanX, 0, place.leanZ]}>
      <group rotation={[0, h.rotationY, 0]}>
        <mesh
          geometry={geo}
          material={h.kind === "wood" ? mats.wood : mats.stones[Math.abs(h.seed) % mats.stones.length]}
          castShadow={shadows}
          receiveShadow={shadows}
        />
      </group>
    </group>
  );
}

function Hardscape({
  items,
  g,
  quality,
  liftedId,
  reducedMotion,
  roots,
}: {
  items: HardscapeVisual[];
  g: TankGeom;
  quality: RenderQuality;
  liftedId: string | null;
  reducedMotion: boolean;
  roots: Map<string, THREE.Object3D> | null;
}) {
  const mats = useMemo<StoneMats>(
    () => ({
      stones: STONE_TONES.map(
        (c) => new THREE.MeshStandardMaterial({ color: c, vertexColors: true, roughness: 0.62, metalness: 0, envMapIntensity: 0.9 }),
      ),
      // warm stylized brown from vertex colours (#7A5A43 → #A88466), low gloss
      wood: new THREE.MeshStandardMaterial({ color: "#ffffff", vertexColors: true, roughness: 0.68, metalness: 0, envMapIntensity: 0.85 }),
    }),
    [],
  );
  useEffect(() => () => [...mats.stones, mats.wood].forEach((m) => m.dispose()), [mats]);
  const cache = useMemo(() => new HardscapeGeometryCache(), []);
  useEffect(() => () => cache.dispose(), [cache]);
  // drop geometry of removed pieces (after commit, so unmounted meshes are gone)
  useEffect(() => cache.retain(items.map((h) => h.id)), [cache, items]);
  const shadows = quality === "high";
  return (
    <group>
      {items.map((h) => (
        <HardscapeItem
          key={h.id}
          h={h}
          g={g}
          mats={mats}
          shadows={shadows}
          lifted={liftedId === h.id}
          reducedMotion={reducedMotion}
          roots={roots}
          cache={cache}
          quality={quality}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------------

const LUT_N = 4096;
const SRGB_LUT = (() => {
  const t = new Float32Array(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) {
    const c = (i / LUT_N) * 1.25; // colours may exceed 1 slightly (ao/variation)
    t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return t;
})();

function srgbToLinear(c: number): number {
  const i = Math.round((c < 0 ? 0 : c > 1.25 ? 1.25 : c) * (LUT_N / 1.25));
  return SRGB_LUT[i]!;
}

function nextPow2(n: number): number {
  let p = 64;
  while (p < n) p *= 2;
  return p;
}

interface FieldProps {
  plants: PlantVisual[];
  species: Record<string, SpeciesLook>;
  quality: RenderQuality;
  g: TankGeom;
  uniforms: SharedUniforms;
  /** id of the plant being dragged (lifted DRAG_LIFT_CM), 1.2.0 */
  liftedId?: string | null | undefined;
  /** hardscape, for epiphytes / moss attached to it (1.4.0) */
  hardscape: HardscapeVisual[];
}

/** Epiphyte / moss drawn on hardscape (1.4.0): y > 0. */
function isAttached(p: PlantVisual, look: SpeciesLook | undefined): boolean {
  return !!look && (p.y || 0) > 0 && (look.growthForm === "epiphyte" || look.growthForm === "moss");
}

interface HardscapeSurfaces {
  field: SurfaceField;
  pieces: (PlacedSurface & { h: HardscapeVisual })[];
  key: string;
}

/** Leaf instances stay this far inside the glass (also covers GPU sway). */
const GLASS_LEAF_MARGIN = 0.7;

function PlantField({ plants, species, quality, g, uniforms, liftedId = null, hardscape }: FieldProps) {
  const group = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);

  const res = useMemo(() => {
    const leafMat = makeFoliageMaterial(uniforms, "leaf");
    const mossMat = makeFoliageMaterial(uniforms, "moss");
    const stemMat = makeFoliageMaterial(uniforms, "stem");
    const geos = {} as Record<LayerKey, THREE.BufferGeometry>;
    for (const k of LAYER_KEYS) geos[k] = makeLayerGeometry(k);
    const matFor = (k: LayerKey) => (k === "stem" ? stemMat : k === "moss" ? mossMat : leafMat);
    return {
      sync: new FieldSync(),
      geos,
      matFor,
      mats: [leafMat, mossMat, stemMat],
      meshes: {} as Partial<Record<LayerKey, THREE.InstancedMesh>>,
    };
  }, [uniforms]);

  useEffect(
    () => () => {
      for (const k of LAYER_KEYS) {
        res.meshes[k]?.dispose();
        res.geos[k].dispose();
      }
      res.mats.forEach((m) => m.dispose());
    },
    [res],
  );

  const warned = useRef(new Set<string>());

  // hardscape surface index, built lazily (only when an attached plant exists)
  const surfaces = useMemo(() => {
    let built: HardscapeSurfaces | null = null;
    return (): HardscapeSurfaces => {
      if (built) return built;
      const pieces = hardscape.map((h) => ({ h, surf: pieceSurface(h, quality), bedRef: stonePlacement(h, g.profile).bedRef }));
      built = {
        pieces,
        field: makeSurfaceField(pieces),
        key: pieces.map((pc) => `${surfaceKey(pc.h, quality)}@${pc.bedRef}`).join(";"),
      };
      return built;
    };
  }, [hardscape, quality, g]);

  useLayoutEffect(() => {
    const grp = group.current;
    if (!grp) return;
    const { sync } = res;
    const bounds = { halfW: g.w / 2 - GLASS_LEAF_MARGIN, halfD: g.d / 2 - GLASS_LEAF_MARGIN };
    const lift = (p: PlantVisual) => (p.id === liftedId ? DRAG_LIFT_CM : 0);
    sync.update(plants, species, (p, look) => {
      if (hardscape.length > 0 && isAttached(p, look)) {
        const s = surfaces();
        // 1.4.1: one bed height per piece (bedRef), never the bed under the plant
        const ref = attachedBedRef(s.pieces, p.x, p.z, p.y, quality);
        if (ref !== null) {
          return { quality, baseY: ref + lift(p), waterY: g.waterY, bounds, surface: s.field, surfaceKey: s.key };
        }
      }
      return { quality, baseY: substrateHeight(g.profile, p.x, p.z) + lift(p), waterY: g.waterY, bounds };
    });
    for (const p of plants) {
      if (!species[p.speciesId] && !warned.current.has(p.speciesId)) {
        warned.current.add(p.speciesId);
        console.warn(`[FrontalTank] no SpeciesLook for speciesId "${p.speciesId}"`);
      }
    }
    const shadows = quality === "high";
    LAYER_KEYS.forEach((k, li) => {
      const layer = sync.buf.layers[k];
      const n = layer.count;
      let mesh = res.meshes[k];
      if (n === 0) {
        if (mesh) mesh.count = 0;
        return;
      }
      if (!mesh || mesh.instanceMatrix.count < n) {
        const cap = nextPow2(Math.ceil(n * 1.3));
        const m = new THREE.InstancedMesh(res.geos[k], res.matFor(k), cap);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        m.instanceColor.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;
        if (mesh) {
          grp.remove(mesh);
          mesh.dispose();
        }
        grp.add(m);
        res.meshes[k] = m;
        mesh = m;
        sync.markLayerDirty(li);
      }
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      mesh.count = n;
      // upload only the instances that changed (dragging one plant ⇒ its slot)
      const { lo, hi } = sync.dirty[li]!;
      if (hi <= lo) return;
      (mesh.instanceMatrix.array as Float32Array).set(layer.matrices.subarray(lo * 16, hi * 16), lo * 16);
      const dst = mesh.instanceColor!.array as Float32Array;
      const src = layer.colors;
      for (let i = lo * 3; i < hi * 3; i++) dst[i] = srgbToLinear(src[i]!);
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(lo * 16, (hi - lo) * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(lo * 3, (hi - lo) * 3);
      mesh.instanceColor!.needsUpdate = true;
    });
    invalidate();
  }, [plants, species, quality, g, res, invalidate, liftedId, hardscape, surfaces]);

  return <group ref={group} />;
}

// ---------------------------------------------------------------------------

function Animator({
  uniforms,
  reducedMotion,
  onReady,
}: {
  uniforms: SharedUniforms;
  reducedMotion: boolean;
  onReady?: (() => void) | undefined;
}) {
  const fired = useRef(false);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => {
    uniforms.uSway.value = reducedMotion ? 0 : 1;
  }, [reducedMotion, uniforms]);
  useFrame((state) => {
    if (!reducedMotion) uniforms.uTime.value = state.clock.elapsedTime;
    if (!fired.current) {
      fired.current = true;
      // useFrame runs just before the render of this frame; notify after it.
      requestAnimationFrame(() => readyRef.current?.());
    }
  });
  return null;
}

// ---------------------------------------------------------------------------
// Composition guides (1.1.0): screen-space SVG over the projected front glass.
// Pure DOM — never touches the WebGL scene or its lighting.

const GUIDE_COLOR = "#1D1D1F";
const GUIDE_OPACITY = 0.35;

function GuideOverlay({
  g,
  kind,
  focal,
  width,
  height,
}: {
  g: TankGeom;
  kind: CompositionGuide;
  focal: { x: number; y: number } | undefined;
  width: number;
  height: number;
}) {
  if (width <= 0 || height <= 0) return null;
  const rect = frontGlassRect(g, width, height);
  const lines = guideLines(kind, rect);
  const fp = focal && Number.isFinite(focal.x) && Number.isFinite(focal.y) ? focalToScreen(g, width, height, focal.x, focal.y) : null;
  // crisp 1 css px lines: snap to half pixels
  const snap = (v: number) => Math.round(v) + 0.5;
  return (
    <svg
      data-testid="frontal-guides"
      data-guides={kind}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}
    >
      <g stroke={GUIDE_COLOR} strokeOpacity={GUIDE_OPACITY} strokeWidth={1} fill="none" shapeRendering="crispEdges">
        {lines.xs.map((x, i) => (
          <line key={`x${i}`} data-guide="v" x1={snap(x)} x2={snap(x)} y1={rect.top} y2={rect.top + rect.height} />
        ))}
        {lines.ys.map((y, i) => (
          <line key={`y${i}`} data-guide="h" x1={rect.left} x2={rect.left + rect.width} y1={snap(y)} y2={snap(y)} />
        ))}
      </g>
      {fp && (
        <g data-testid="frontal-focal" stroke={GUIDE_COLOR} strokeOpacity={GUIDE_OPACITY + 0.2} fill="none">
          <circle cx={fp[0]} cy={fp[1]} r={9} strokeWidth={1} />
          <circle cx={fp[0]} cy={fp[1]} r={1.5} fill={GUIDE_COLOR} fillOpacity={GUIDE_OPACITY + 0.2} stroke="none" />
        </g>
      )}
    </svg>
  );
}

function useElementSize(ref: RefObject<HTMLDivElement | null>): [number, number] {
  const [size, setSize] = useState<[number, number]>([0, 0]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (s[0] === r.width && s[1] === r.height ? s : [r.width, r.height]));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export function FrontalTank(props: FrontalTankProps): JSX.Element {
  const { tank, species, plants, hardscape, reducedMotion = false, className, onReady } = props;
  const editable = props.editable === true;
  const guides: CompositionGuide = props.guides ?? "none";
  const bedFront = props.bed?.frontCm;
  const bedBack = props.bed?.backCm;
  const quality = useMemo(() => resolveQuality(props.quality), [props.quality]);
  const g = useMemo(
    () => tankGeom(tank, bedFront !== undefined && bedBack !== undefined ? { frontCm: bedFront, backCm: bedBack } : undefined),
    [tank.widthCm, tank.depthCm, tank.heightCm, bedFront, bedBack], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const uniforms = useMemo(() => makeSharedUniforms(), []);
  const hs = useMemo(() => hardscape ?? [], [hardscape]);
  const wrap = useRef<HTMLDivElement>(null);
  const [cw, ch] = useElementSize(wrap);

  // --- 1.2.0 editing -------------------------------------------------------
  const [dragging, setDragging] = useState<EditTarget | null>(null);
  const editRef = useRef<EditPropsSnapshot>({ plants, hardscape: hs, species, onSelect: props.onSelect, onMove: props.onMove });
  editRef.current = { plants, hardscape: hs, species, onSelect: props.onSelect, onMove: props.onMove };
  const roots = useMemo(() => new Map<string, THREE.Object3D>(), []);
  useEffect(() => {
    if (!editable) setDragging(null);
  }, [editable]);
  const drag = editable ? dragging : null;
  const halo = editable ? haloSpec(props.selected, plants, hs) : null;

  return (
    <div
      ref={wrap}
      className={className}
      data-testid={props["data-testid"]}
      data-editable={editable ? "true" : undefined}
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 200, background: BG }}
    >
      <Canvas
        dpr={quality === "high" ? [1, 2] : [1, 1.5]}
        shadows={quality === "high"}
        frameloop={reducedMotion ? "demand" : "always"}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        camera={{ fov: 24, near: 1, far: 2000, position: [0, 20, 200] }}
        style={{ position: "absolute", inset: 0 }}
      >
        <SceneSetup g={g} quality={quality} />
        <Lights g={g} quality={quality} uniforms={uniforms} />
        <TankShell g={g} />
        <Substrate g={g} quality={quality} />
        <Hardscape
          items={hs}
          g={g}
          quality={quality}
          liftedId={drag?.kind === "hardscape" ? drag.id : null}
          reducedMotion={reducedMotion}
          roots={editable ? roots : null}
        />
        <PlantField
          plants={plants}
          species={species}
          quality={quality}
          g={g}
          uniforms={uniforms}
          liftedId={drag?.kind === "plant" && !reducedMotion ? drag.id : null}
          hardscape={hs}
        />
        {editable && <SelectionHalo g={g} spec={halo} />}
        {editable && <EditController g={g} props={editRef} roots={roots} onDragChange={setDragging} />}
        <Animator uniforms={uniforms} reducedMotion={reducedMotion} onReady={onReady} />
      </Canvas>
      {guides !== "none" && <GuideOverlay g={g} kind={guides} focal={props.focalPoint} width={cw} height={ch} />}
    </div>
  );
}
