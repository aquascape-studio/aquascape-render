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
import type { CompositionGuide, FrontalTankProps, HardscapeVisual, PlantVisual, SpeciesLook } from "../contract.js";
import {
  InstanceBuffer,
  LAYER_KEYS,
  LayoutCache,
  substrateHeight,
  type LayerKey,
  type RenderQuality,
} from "./layout.js";
import {
  makeBranchGeometry,
  makeLayerGeometry,
  makeStoneGeometry,
  makeSubstrateGeometry,
} from "./geometry.js";
import { makeFoliageMaterial, makeSharedUniforms, makeSubstrateMaterial, type SharedUniforms } from "./materials.js";
import { resolveQuality } from "./quality.js";
import { stonePlacement } from "./stones.js";
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

function Hardscape({ items, g, quality }: { items: HardscapeVisual[]; g: TankGeom; quality: RenderQuality }) {
  const built = useMemo(
    () =>
      items.map((h) => {
        const place = stonePlacement(h, g.profile);
        if (h.kind === "wood") {
          const parts = makeBranchGeometry(h.sizeCm, h.seed);
          return { h, place, parts, stone: null as THREE.BufferGeometry | null };
        }
        return { h, place, parts: [] as THREE.BufferGeometry[], stone: makeStoneGeometry(h.sizeCm, h.seed, h.role) };
      }),
    [items, g],
  );
  const stoneMats = useMemo(
    () =>
      STONE_TONES.map(
        (c) =>
          new THREE.MeshStandardMaterial({ color: c, vertexColors: true, roughness: 0.62, metalness: 0, envMapIntensity: 0.9 }),
      ),
    [],
  );
  const woodMat = useMemo(
    () => new THREE.MeshPhysicalMaterial({ color: "#86644a", roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.5 }),
    [],
  );
  useEffect(
    () => () => {
      for (const b of built) {
        b.stone?.dispose();
        b.parts.forEach((p) => p.dispose());
      }
    },
    [built],
  );
  useEffect(() => () => [...stoneMats, woodMat].forEach((m) => m.dispose()), [stoneMats, woodMat]);
  const shadows = quality === "high";
  return (
    <group>
      {built.map(({ h, place, parts, stone }) => (
        // outer group: bed placement + lean (in tank space); inner: rotation about y
        <group key={h.id} position={[h.x, place.bottomY, h.z]} rotation={[place.leanX, 0, place.leanZ]}>
          <group rotation={[0, h.rotationY, 0]}>
            {stone && (
              <mesh
                geometry={stone}
                material={stoneMats[Math.abs(h.seed) % stoneMats.length]}
                castShadow={shadows}
                receiveShadow={shadows}
              />
            )}
            {parts.map((p, i) => (
              <mesh key={i} geometry={p} material={woodMat} castShadow={shadows} receiveShadow={shadows} />
            ))}
          </group>
        </group>
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
}

function PlantField({ plants, species, quality, g, uniforms }: FieldProps) {
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
      buf: new InstanceBuffer(),
      cache: new LayoutCache(),
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

  useLayoutEffect(() => {
    const grp = group.current;
    if (!grp) return;
    const { buf, cache } = res;
    buf.reset();
    cache.beginFrame();
    for (const p of plants) {
      const look = species[p.speciesId];
      if (!look) {
        if (!warned.current.has(p.speciesId)) {
          warned.current.add(p.speciesId);
          console.warn(`[FrontalTank] no SpeciesLook for speciesId "${p.speciesId}"`);
        }
        continue;
      }
      cache.layout(buf, look, p, {
        quality,
        baseY: substrateHeight(g.profile, p.x, p.z),
        waterY: g.waterY,
        bounds: { halfW: g.w / 2 - 0.6, halfD: g.d / 2 - 0.6 },
      });
    }
    cache.endFrame();
    const shadows = quality === "high";
    for (const k of LAYER_KEYS) {
      const layer = buf.layers[k];
      const n = layer.count;
      let mesh = res.meshes[k];
      if (n === 0) {
        if (mesh) mesh.count = 0;
        continue;
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
      }
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      (mesh.instanceMatrix.array as Float32Array).set(layer.matrices.subarray(0, n * 16));
      const dst = mesh.instanceColor!.array as Float32Array;
      const src = layer.colors;
      for (let i = 0; i < n * 3; i++) dst[i] = srgbToLinear(src[i]!);
      mesh.count = n;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, n * 3);
      mesh.instanceColor!.needsUpdate = true;
    }
    invalidate();
  }, [plants, species, quality, g, res, invalidate]);

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

  return (
    <div
      ref={wrap}
      className={className}
      data-testid={props["data-testid"]}
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
        <Hardscape items={hs} g={g} quality={quality} />
        <PlantField plants={plants} species={species} quality={quality} g={g} uniforms={uniforms} />
        <Animator uniforms={uniforms} reducedMotion={reducedMotion} onReady={onReady} />
      </Canvas>
      {guides !== "none" && <GuideOverlay g={g} kind={guides} focal={props.focalPoint} width={cw} height={ch} />}
    </div>
  );
}
