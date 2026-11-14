import { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import { LEAF_BASE, LEAF_TIP, STEM_COLOR } from "../palette.js";
import type { PlantSpec } from "../types.js";

interface PlantProps {
  spec: PlantSpec;
}

/**
 * Phase-1 stem plant rendered as a single `THREE.InstancedMesh`: each instance
 * is a small box which we scale/rotate into either a stem segment or a leaf.
 * One mesh per plant. Leaf color lerps LEAF_BASE -> LEAF_TIP up the stem; stem
 * segments use STEM_COLOR.
 *
 * Non-stem morphologies silently render nothing in Phase 1.
 */
export function Plant({ spec }: PlantProps) {
  const {
    position,
    rotationY = 0,
    heightCm,
    nodeCount = 5,
    morphology = "stem",
  } = spec;

  const meshRef = useRef<THREE.InstancedMesh | null>(null);

  const { geometry, material, instanceCount, transforms, colors } =
    useMemo(() => {
      // 1 stem segment per internode + 2 leaves per internode.
      const segments = Math.max(1, nodeCount);
      const count = segments * 3;

      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshStandardMaterial({
        roughness: 0.6,
        metalness: 0.0,
        vertexColors: false,
      });

      const ts = new Array<THREE.Matrix4>(count);
      const cs = new Array<THREE.Color>(count);

      const stemColor = new THREE.Color(STEM_COLOR);
      const leafBase = new THREE.Color(LEAF_BASE);
      const leafTip = new THREE.Color(LEAF_TIP);

      const internodeHeight = heightCm / segments;
      const stemThickness = Math.max(0.15, heightCm * 0.012);

      const tmp = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const p = new THREE.Vector3();
      const eul = new THREE.Euler();

      for (let i = 0; i < segments; i++) {
        const yBase = i * internodeHeight;
        const yMid = yBase + internodeHeight / 2;
        const tNorm = segments > 1 ? i / (segments - 1) : 0;

        // Stem segment: thin vertical box.
        p.set(0, yMid, 0);
        eul.set(0, 0, 0);
        q.setFromEuler(eul);
        s.set(stemThickness, internodeHeight * 0.98, stemThickness);
        tmp.compose(p, q, s);
        ts[i * 3 + 0] = tmp.clone();
        cs[i * 3 + 0] = stemColor.clone();

        // Two opposing leaves per node, angled up ~25 degrees, rotated around
        // the stem by the node index so each pair spirals.
        const leafLength = internodeHeight * 1.9;
        const leafWidth = Math.max(0.25, heightCm * 0.022);
        const leafThickness = 0.08;
        const phi = i * 0.9; // radians per node — gentle spiral
        const tilt = -Math.PI / 2 + 0.35; // ~20 degrees above horizontal

        const leafColor = leafBase.clone().lerp(leafTip, tNorm);

        for (let side = 0; side < 2; side++) {
          const yaw = phi + (side === 0 ? 0 : Math.PI);
          // Build rotation: first tilt in local X (point outward), then yaw Y.
          eul.set(0, yaw, tilt, "YXZ");
          q.setFromEuler(eul);
          // Offset outward by half-leaf-length along the rotated +X.
          const outX = Math.cos(yaw) * leafLength * 0.5;
          const outZ = -Math.sin(yaw) * leafLength * 0.5;
          p.set(outX, yBase + internodeHeight * 0.85, outZ);
          s.set(leafLength, leafWidth, leafThickness);
          tmp.compose(p, q, s);
          ts[i * 3 + 1 + side] = tmp.clone();
          cs[i * 3 + 1 + side] = leafColor.clone();
        }
      }

      return {
        geometry: geo,
        material: mat,
        instanceCount: count,
        transforms: ts,
        colors: cs,
      };
    }, [heightCm, nodeCount]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < instanceCount; i++) {
      const m = transforms[i];
      const c = colors[i];
      if (m) mesh.setMatrixAt(i, m);
      if (c) mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    const instanceColor = mesh.instanceColor;
    if (instanceColor) instanceColor.needsUpdate = true;
  }, [instanceCount, transforms, colors]);

  if (morphology !== "stem") {
    return null;
  }

  const substrateTopY = 3; // matches Tank.tsx substrate thickness
  const [x, z] = position;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, instanceCount]}
      position={[x, substrateTopY, z]}
      rotation={[0, rotationY, 0]}
    />
  );
}
