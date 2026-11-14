import { useMemo } from "react";
import * as THREE from "three";
import { GLASS_TINT, SUBSTRATE_DRY, SUBSTRATE_WET } from "../palette.js";
import type { TankSizeCm } from "../types.js";

/**
 * Props using SI metres — preferred for new call sites.
 * 1 world unit = 1 metre in this API.
 */
export interface TankMetresProps {
  /** Tank interior width  (X axis) in metres. */
  width: number;
  /** Tank interior height (Y axis) in metres. */
  height: number;
  /** Tank interior depth  (Z axis) in metres. */
  depth: number;
}

/** Legacy centimetre props — kept for backward-compat with <Aquarium>. */
interface TankCmProps {
  sizeCm: TankSizeCm;
}

type TankProps = TankMetresProps | TankCmProps;

function isCmProps(p: TankProps): p is TankCmProps {
  return "sizeCm" in p;
}

/** Borosilicate-quality glass parameters for the front (most visible) pane. */
const FRONT_GLASS: Partial<THREE.MeshPhysicalMaterialParameters> = {
  transmission: 0.95,
  roughness: 0.02,
  ior: 1.5,
  thickness: 0.012,
};

/** Secondary panes — readable as glass but subtly less dominant. */
const SIDE_GLASS: Partial<THREE.MeshPhysicalMaterialParameters> = {
  transmission: 0.85,
  roughness: 0.02,
  ior: 1.5,
  thickness: 0.012,
};

/** Shared physical-material parameters common to all panes. */
const SHARED_GLASS: Partial<THREE.MeshPhysicalMaterialParameters> = {
  color: GLASS_TINT,
  transparent: true,
  side: THREE.DoubleSide,
  depthWrite: false,
  metalness: 0,
};

/**
 * Tank — 5-pane aquarium (front, back, left, right, bottom; no top lid).
 *
 * The front pane uses `MeshPhysicalMaterial` with full borosilicate-glass
 * parameters (`transmission: 0.95, roughness: 0.02, ior: 1.5,
 * thickness: 0.012`).  The other four panes share the same material with
 * `transmission: 0.85` so they read clearly as glass without dominating the
 * scene.
 *
 * Accepts either metres-based props (`width / height / depth`) or the legacy
 * centimetre tuple (`sizeCm`) so existing `<Aquarium>` call-sites keep working.
 *
 * Draw-call budget: 6 meshes (5 glass + 1 substrate).
 */
export function Tank(props: TankProps) {
  // Resolve to metres regardless of which prop shape was passed.
  const [w, h, d] = useMemo<[number, number, number]>(() => {
    if (isCmProps(props)) {
      const [wCm, dCm, hCm] = props.sizeCm;
      // Legacy sizeCm is [width, depth, height] in cm → convert to metres.
      return [wCm / 100, hCm / 100, dCm / 100];
    }
    return [props.width, props.height, props.depth];
  }, [props]);

  const frontMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        ...SHARED_GLASS,
        ...FRONT_GLASS,
      }),
    [],
  );

  const sideMat = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        ...SHARED_GLASS,
        ...SIDE_GLASS,
      }),
    [],
  );

  const substrateMat = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: SUBSTRATE_DRY,
      roughness: 0.95,
      metalness: 0.0,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms["uWet"] = { value: new THREE.Color(SUBSTRATE_WET) };
      shader.uniforms["uHalfExtent"] = {
        value: new THREE.Vector2(w / 2, d / 2),
      };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>\nvarying vec3 vLocalPos;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>\nvLocalPos = position;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>\nvarying vec3 vLocalPos;\nuniform vec3 uWet;\nuniform vec2 uHalfExtent;`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
           // Wetness: 1 at centre, fades within 0.02 m of the glass.
           vec2 dToEdge = uHalfExtent - abs(vLocalPos.xz);
           float wet = smoothstep(0.0, 0.03, min(dToEdge.x, dToEdge.y));
           diffuseColor.rgb = mix(uWet, diffuseColor.rgb, wet);`,
        );
    };
    return mat;
  }, [w, d]);

  const glassT = 0.004; // 4 mm glass thickness in metres
  const subH = 0.03;    // 3 cm substrate slab in metres

  return (
    <group>
      {/* Substrate slab — sits at Y=0, top surface at Y=subH */}
      <mesh
        position={[0, subH / 2, 0]}
        receiveShadow
        material={substrateMat}
      >
        <boxGeometry
          args={[w - glassT * 2, subH, d - glassT * 2]}
        />
      </mesh>

      {/* Front pane (+Z) — borosilicate quality, viewer-facing */}
      <mesh position={[0, h / 2, d / 2]} material={frontMat}>
        <planeGeometry args={[w, h]} />
      </mesh>

      {/* Back pane (-Z) */}
      <mesh
        position={[0, h / 2, -d / 2]}
        rotation={[0, Math.PI, 0]}
        material={sideMat}
      >
        <planeGeometry args={[w, h]} />
      </mesh>

      {/* Left pane (-X) */}
      <mesh
        position={[-w / 2, h / 2, 0]}
        rotation={[0, Math.PI / 2, 0]}
        material={sideMat}
      >
        <planeGeometry args={[d, h]} />
      </mesh>

      {/* Right pane (+X) */}
      <mesh
        position={[w / 2, h / 2, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        material={sideMat}
      >
        <planeGeometry args={[d, h]} />
      </mesh>

      {/* Bottom pane */}
      <mesh
        position={[0, 0, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={sideMat}
      >
        <planeGeometry args={[w, d]} />
      </mesh>
    </group>
  );
}
