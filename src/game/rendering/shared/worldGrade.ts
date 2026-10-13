import * as THREE from 'three';

/** Lamps, windows and ki packed into one texel each. 20 path lamps, 4 windows and a few ki lights fit. */
export const LIGHT_SLOTS = 32;

export const GRADE_UNIFORMS = {
  uAmbient: { value: new THREE.Vector3(1, 1, 1) },
  uSepia: { value: 0 },
  uFocusDesat: { value: 0 },
  uFocusDark: { value: 0 },
  uLightMap: { value: null as THREE.Texture | null },
  uLightCount: { value: 0 },
};

const lightData = new Uint8Array(LIGHT_SLOTS * 4);
const lightScratch = new Uint8Array(LIGHT_SLOTS * 4);
let packedCount = -1;
const lightTexture = new THREE.DataTexture(lightData, LIGHT_SLOTS, 1, THREE.RGBAFormat);
lightTexture.magFilter = THREE.NearestFilter;
lightTexture.minFilter = THREE.NearestFilter;
lightTexture.generateMipmaps = false;
lightTexture.colorSpace = THREE.NoColorSpace;
lightTexture.wrapS = THREE.ClampToEdgeWrapping;
lightTexture.wrapT = THREE.ClampToEdgeWrapping;
lightTexture.flipY = false;
lightTexture.needsUpdate = true;
GRADE_UNIFORMS.uLightMap.value = lightTexture;

export interface WorldLight {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** Uploads light volumes. x/z in 0.5 m steps, height in 0.05 m, radius in 0.125 m. Skips the upload when nothing moved, so the grade does not flicker. */
export function uploadWorldLights(lights: readonly WorldLight[]): void {
  lightScratch.fill(0);
  const n = Math.min(LIGHT_SLOTS, lights.length);
  for (let i = 0; i < n; i++) {
    const L = lights[i]!;
    const o = i * 4;
    lightScratch[o] = Math.min(255, Math.max(0, Math.round(L.x * 2)));
    lightScratch[o + 1] = Math.min(255, Math.max(0, Math.round(L.y * 20)));
    lightScratch[o + 2] = Math.min(255, Math.max(0, Math.round(L.z * 2)));
    lightScratch[o + 3] = Math.min(255, Math.max(0, Math.round(L.radius * 8)));
  }
  if (n === packedCount) {
    let same = true;
    for (let i = 0; i < n * 4; i++) {
      if (lightScratch[i] !== lightData[i]) {
        same = false;
        break;
      }
    }
    if (same) return;
  }
  lightData.set(lightScratch);
  packedCount = n;
  GRADE_UNIFORMS.uLightCount.value = n;
  lightTexture.needsUpdate = true;
}

/**
 * Day/night grade plus local light volumes. The fragment is the albedo times
 * (ambient + warm light that falls off inside each lamp, window or ki radius).
 */
export function patchWorld<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (s) => {
    s.uniforms.uFocusDesat = GRADE_UNIFORMS.uFocusDesat;
    s.uniforms.uFocusDark = GRADE_UNIFORMS.uFocusDark;
    s.uniforms.uAmbient = GRADE_UNIFORMS.uAmbient;
    s.uniforms.uSepia = GRADE_UNIFORMS.uSepia;
    s.uniforms.uLightMap = GRADE_UNIFORMS.uLightMap;
    s.uniforms.uLightCount = GRADE_UNIFORMS.uLightCount;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying highp vec3 vWorldPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec4 worldPos4 = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  worldPos4 = instanceMatrix * worldPos4;
#endif
vWorldPos = (modelMatrix * worldPos4).xyz;`,
      );
    s.fragmentShader =
      `uniform float uFocusDesat;
uniform float uFocusDark;
uniform vec3 uAmbient;
uniform float uSepia;
uniform sampler2D uLightMap;
uniform float uLightCount;
varying highp vec3 vWorldPos;
` +
      s.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
{
  vec3 albedo = gl_FragColor.rgb;
  float l = dot(albedo, vec3(0.299, 0.587, 0.114));
  vec3 sepia = vec3(l * 1.08, l * 0.8, l * 0.46);
  vec3 graded = mix(albedo, sepia, uSepia);
  float lamp = 0.0;
  for (int i = 0; i < ${LIGHT_SLOTS}; i++) {
    float live = step(float(i) + 0.5, uLightCount);
    vec4 raw = texture2D(uLightMap, vec2((float(i) + 0.5) / ${LIGHT_SLOTS}.0, 0.5));
    vec3 lp = vec3(raw.r * (255.0 / 2.0), raw.g * (255.0 / 20.0), raw.b * (255.0 / 2.0));
    float radius = raw.a * (255.0 / 8.0);
    highp vec3 d = vWorldPos - lp;
    d.y *= 0.38;
    highp float dist = length(d);
    float t = clamp(1.0 - smoothstep(radius * 0.05, radius, dist), 0.0, 1.0);
    lamp += t * t * live * step(0.2, radius);
  }
  vec3 light = min(uAmbient + vec3(1.05, 0.72, 0.38) * lamp, vec3(1.55));
  gl_FragColor.rgb = graded * light;
  float l2 = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(l2), uFocusDesat) * (1.0 - uFocusDark);
}`,
      );
  };
  m.customProgramCacheKey = () => 'world-grade-lights-hp';
  return m;
}
