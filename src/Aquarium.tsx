import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { SCENE_BACKGROUND } from "./palette.js";
import type { AquariumProps, CameraPreset, TankSizeCm } from "./types.js";
import { Tank } from "./scene/Tank.js";
import { Lighting } from "./scene/Lighting.js";
import { WaterVolume } from "./scene/WaterVolume.js";
import { Rock } from "./scene/Rock.js";
import { Plant } from "./scene/Plant.js";

type CameraRig = {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
};

/**
 * Resolve a camera preset into a concrete rig based on the tank's centimetre
 * dimensions. Positions are chosen so the tank fills ~70% of a 16:9 frame.
 */
function resolveCamera(preset: CameraPreset, size: TankSizeCm): CameraRig {
  const [w, d, h] = size;
  const targetY = h * 0.45;
  const center: [number, number, number] = [0, targetY, 0];
  const span = Math.max(w, h, d);
  switch (preset) {
    case "front":
      return {
        position: [0, targetY, d / 2 + span * 1.1],
        target: center,
        fov: 35,
      };
    case "top-down":
      return {
        position: [0, h + span * 1.3, 0.001],
        target: [0, 0, 0],
        fov: 40,
      };
    case "three-quarter":
      return {
        position: [w * 0.9, h * 1.1, d / 2 + span * 1.0],
        target: center,
        fov: 32,
      };
    case "orbit":
    default:
      return {
        position: [w * 0.85, h * 1.05, d / 2 + span * 1.05],
        target: center,
        fov: 35,
      };
  }
}

/**
 * Top-level scene composition. A `<Canvas>` hosts the tank, lighting, water
 * surface, and the user's hardscape + plants. The `camera` prop picks from a
 * small preset library; `"orbit"` additionally mounts `<OrbitControls>` so the
 * viewer can frame the scene themselves.
 */
export function Aquarium(props: AquariumProps) {
  const {
    tankSizeCm,
    hardscape = [],
    plants = [],
    camera = "three-quarter",
  } = props;
  const testId = props["data-testid"];

  const rig = useMemo(() => resolveCamera(camera, tankSizeCm), [camera, tankSizeCm]);
  const bg = useMemo(() => new THREE.Color(SCENE_BACKGROUND), []);

  return (
    <div
      data-testid={testId}
      style={{ width: "100%", height: "100%", minHeight: 360 }}
    >
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        onCreated={({ scene }) => {
          scene.background = bg;
        }}
      >
        <PerspectiveCamera
          makeDefault
          fov={rig.fov}
          near={1}
          far={Math.max(tankSizeCm[0], tankSizeCm[1], tankSizeCm[2]) * 10}
          position={rig.position}
        />
        {camera === "orbit" ? (
          <OrbitControls
            makeDefault
            enableDamping
            target={rig.target}
            minDistance={Math.max(tankSizeCm[0], tankSizeCm[2]) * 0.3}
            maxDistance={Math.max(tankSizeCm[0], tankSizeCm[2]) * 5}
          />
        ) : null}

        <Lighting sizeCm={tankSizeCm} />
        <Tank sizeCm={tankSizeCm} />
        <WaterVolume sizeCm={tankSizeCm} />

        {hardscape.map((rock) => (
          <Rock key={rock.id} spec={rock} />
        ))}
        {plants.map((plant) => (
          <Plant key={plant.id} spec={plant} />
        ))}
      </Canvas>
    </div>
  );
}
