/**
 * Leaf material: MeshStandardMaterial (no `transmission` — that forces an
 * extra opaque-scene pass) plus an onBeforeCompile patch that adds
 *   • fake back-light translucency (light from behind passing through the
 *     leaf towards the viewer) + soft wrap/rim term,
 *   • GPU idle sway driven by a shared `uTime` uniform (no CPU work).
 */
import * as THREE from "three";

export interface SharedUniforms {
  uTime: { value: number };
  uSway: { value: number };
  /** world-space direction *towards* the back light */
  uBackDir: { value: THREE.Vector3 };
  uTransl: { value: number };
}

export function makeSharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uSway: { value: 1 },
    uBackDir: { value: new THREE.Vector3(0.15, 0.55, -1).normalize() },
    uTransl: { value: 0.9 },
  };
}

const SWAY_VERTEX = /* glsl */ `
#include <project_vertex>
{
  vec4 swWorld = modelMatrix * vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    swWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #endif
  float hgt = clamp(swWorld.y / 30.0, 0.0, 1.4);
  float tip = 0.6 + 0.4 * clamp(position.z, 0.0, 1.0);
  float ph = swWorld.x * 0.13 + swWorld.z * 0.07;
  vec3 sw = vec3(
    sin(uTime * 0.85 + ph) + 0.35 * sin(uTime * 1.9 + ph * 2.3),
    0.0,
    0.4 * cos(uTime * 0.7 + ph * 1.3)
  ) * (0.32 * hgt * hgt * tip * uSway);
  mvPosition.xyz += (viewMatrix * vec4(sw, 0.0)).xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const TRANSLUCENCY_FRAGMENT = /* glsl */ `
#include <lights_fragment_end>
{
  vec3 Lb = normalize((viewMatrix * vec4(uBackDir, 0.0)).xyz);
  vec3 Nn = normalize(normal);
  // Soft back-light translucency (cheap, no transmission pass): light from
  // the back light that enters the far face and scatters out towards the
  // eye. Thin parts (vertex colour is brighter at the tips / edges) glow more.
  float back = clamp(dot(-Nn, Lb), 0.0, 1.0);
  float through = pow(clamp(dot(geometryViewDir, -Lb), 0.0, 1.0), 1.5);
  float wrap = clamp((dot(-Nn, Lb) + 0.75) / 1.75, 0.0, 1.0);
  float rim = pow(1.0 - clamp(abs(dot(Nn, geometryViewDir)), 0.0, 1.0), 2.2);
  // saturated, lighter, slightly yellow-shifted glow — the "lit from behind" leaf look
  vec3 glow = diffuseColor.rgb * vec3(1.08, 1.22, 0.62) + vec3(0.025, 0.04, 0.0);
  float k = 0.5 * back + 0.45 * through * wrap + 0.28 * rim;
  reflectedLight.indirectDiffuse += glow * uTransl * k;
}
`;

export function patchFoliage(material: THREE.Material, u: SharedUniforms, translucent: boolean): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = u.uTime;
    shader.uniforms.uSway = u.uSway;
    shader.uniforms.uBackDir = u.uBackDir;
    shader.uniforms.uTransl = u.uTransl;
    shader.vertexShader =
      "uniform float uTime;\nuniform float uSway;\n" +
      shader.vertexShader.replace("#include <project_vertex>", SWAY_VERTEX);
    if (translucent) {
      shader.fragmentShader =
        "uniform vec3 uBackDir;\nuniform float uTransl;\n" +
        shader.fragmentShader.replace("#include <lights_fragment_end>", TRANSLUCENCY_FRAGMENT);
    }
  };
  material.customProgramCacheKey = () => (translucent ? "aq-foliage-t" : "aq-foliage");
}

export function makeFoliageMaterial(u: SharedUniforms, kind: "leaf" | "moss" | "stem"): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: kind === "moss" ? 0.85 : 0.5,
    metalness: 0,
    envMapIntensity: kind === "moss" ? 0.6 : 0.9,
  });
  patchFoliage(m, u, kind !== "stem");
  return m;
}

const GRAIN_VERTEX = /* glsl */ `
#include <begin_vertex>
vSandWp = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const GRAIN_FRAGMENT = /* glsl */ `
#include <color_fragment>
{
  // fine sand grain: hashed world-space cells (~0.5 mm) — reads as fine,
  // even sand, not a photo texture
  vec3 cell = floor(vSandWp * 20.0);
  float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float h2 = fract(sin(dot(floor(vSandWp * 7.0), vec3(4.898, 7.23, 23.42))) * 24634.6345);
  diffuseColor.rgb *= 0.93 + 0.1 * h + 0.04 * h2;
}
`;

/** Substrate: soft warm sand with vertex-colour strata + fine procedural grain. */
export function makeSubstrateMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: "#bdb0a0",
    vertexColors: true,
    roughness: 0.95,
    metalness: 0,
    envMapIntensity: 0.75,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = "varying vec3 vSandWp;\n" + shader.vertexShader.replace("#include <begin_vertex>", GRAIN_VERTEX);
    shader.fragmentShader = "varying vec3 vSandWp;\n" + shader.fragmentShader.replace("#include <color_fragment>", GRAIN_FRAGMENT);
  };
  m.customProgramCacheKey = () => "aq-sand";
  return m;
}
