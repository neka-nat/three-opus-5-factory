/**
 * scene/lighting.js — every THREE.Light in the scene, plus the PMREM environment.
 *
 * What the photograph actually looks like (img01.jpg, crops A/B/E/G):
 *
 *   • It is a HIGH-KEY, almost shadowless daylight interior. The two-band window
 *     wall on the right (+X) is completely blown out — pure paper white — and
 *     that light floods the whole hall.
 *   • The ceiling, the roof beams, the walls and all the structural steel are the
 *     same warm cream, and they act as an enormous bounce card: the undersides of
 *     the crane girder, the machines and the robots are only a stop or two darker
 *     than their tops.
 *   • There is **no readable cast shadow anywhere in the frame** — not under the
 *     crane, not under the conveyor legs, not behind the robots. Only a soft
 *     contact darkening where objects meet the floor (postfx's AO does that job).
 *   • The green epoxy floor kicks a distinctly green bounce back up.
 *   • The fluorescent battens are on but contribute almost nothing; they read as
 *     faint white bars, not as light sources.
 *
 * The rig therefore is: a big soft hemisphere + ambient base, one *weak-shadowed*
 * directional "sun" raking in from beyond the right wall, four RectAreaLights
 * sitting in the near lower window openings, a left-hand bounce fill, a handful of
 * cheap unshadowed point lights under the battens, and — carrying most of the
 * character — a procedural PMREM room (blown-out +X wall, bright cream ceiling,
 * green floor) on `scene.environment`.
 *
 * @module scene/lighting
 */
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { CFG, PAL } from '../core/config.js';
import { applyEnvironment } from '../core/materials.js';
import { group } from '../core/utils.js';

// ────────────────────────────────────────────────────────────────────────────
// Tunables (kept local — they are lighting art-direction, not world geometry)
// ────────────────────────────────────────────────────────────────────────────

/** Where the sun's shadow frustum has to cover — the foreground robot cell. */
const SHADOW_MIN = new THREE.Vector3(-8, -0.2, -26);
const SHADOW_MAX = new THREE.Vector3(8, 11, 7);

/** How far out beyond the right wall the directional light is parked. */
const SUN_DISTANCE = 26;
/** Point the sun is aimed at — the middle of the near half of the cell. */
const SUN_TARGET = new THREE.Vector3(0.4, 1.2, -6.5);

/**
 * Shadows in the photo are barely there. `LightShadow.intensity` (three ≥ r167)
 * scales how dark the shadow term gets without touching the light itself, which
 * is exactly the knob this scene wants.
 */
const SHADOW_STRENGTH = 0.42;

/** Bay lines whose lower window gets a RectAreaLight (the four nearest ones). */
const WINDOW_LIGHT_BAYS = [1, 2, 3, 4]; // CFG.bay.z(k) → 0, −3.6, −7.2, −10.8
/** Blown-out white of the glazing as the room sees it. */
const WINDOW_COLOR = 0xf7f4ec;
/** How far inboard of the wall face (x = 6.5) the emitters sit. */
const WINDOW_LIGHT_X = 6.4;

/** Ceiling fixtures that get a cheap point light under them. */
const FIXTURE_Z = [-1.8, -9.0];

/**
 * Top-level group names whose meshes must NOT write into the sun's shadow map.
 *
 * The building shell is a closed box: if the roof deck and the window wall cast
 * shadows, a single directional light standing in for a whole glazed façade puts
 * the entire interior in shade and the image collapses to flat ambient. Real
 * daylight here arrives from a 40 m² area source, so the shell is excluded and
 * the directional light is treated as the *unoccluded* part of that source.
 * These objects still RECEIVE shadow, so the floor and walls stay grounded.
 */
const SHELL_NON_CASTERS = new Set([
  'floor',
  'walls',
  'ceiling',
  'windows',
  'ceilingServices',
  'lightFixtures',
  'craneRunways',
  'wallServices',
  'monorail',
]);

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** A linear-space colour that may exceed 1.0 — the env room needs HDR values. */
function envColor(r, g, b) {
  return new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
}

/** Unlit material for the environment room (PMREM renders with no lights). */
function envMat(r, g, b) {
  return new THREE.MeshBasicMaterial({ color: envColor(r, g, b), side: THREE.BackSide });
}

/** Unlit single-sided panel material for the env room's bright bands. */
function envPanel(r, g, b) {
  return new THREE.MeshBasicMaterial({ color: envColor(r, g, b), side: THREE.DoubleSide });
}

/**
 * Size a DirectionalLight's orthographic shadow camera so it exactly wraps a
 * world-space AABB, whatever direction the light points from.
 * @param {THREE.DirectionalLight} light
 * @param {THREE.Vector3} min world-space AABB minimum
 * @param {THREE.Vector3} max world-space AABB maximum
 * @param {number} pad extra slack in metres
 */
function fitDirectionalShadow(light, min, max, pad = 0.6) {
  const up = new THREE.Vector3(0, 1, 0);
  const toLight = new THREE.Matrix4()
    .lookAt(light.position, light.target.position, up)
    .setPosition(light.position)
    .invert();

  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const v = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
    v.applyMatrix4(toLight);
    lo.min(v);
    hi.max(v);
  }

  const cam = light.shadow.camera;
  cam.left = lo.x - pad;
  cam.right = hi.x + pad;
  cam.bottom = lo.y - pad;
  cam.top = hi.y + pad;
  // In light space the camera looks down −Z, so depths are negated.
  cam.near = Math.max(0.05, -hi.z - pad);
  cam.far = -lo.z + pad;
  cam.updateProjectionMatrix();
}

/**
 * Strip `castShadow` from the building shell (see SHELL_NON_CASTERS).
 * Safe to call repeatedly; returns how many meshes it touched.
 * @param {THREE.Object3D|null} root
 * @returns {number}
 */
function relaxShellShadows(root) {
  if (!root) return 0;
  let n = 0;
  root.traverse((o) => {
    if (!SHELL_NON_CASTERS.has(o.name)) return;
    o.traverse((c) => {
      if ((c.isMesh || c.isInstancedMesh) && c.castShadow) {
        c.castShadow = false;
        n++;
      }
    });
  });
  return n;
}

/**
 * The procedural room the PMREM is baked from. Proportioned like the hall as
 * seen from the camera's eye height, so reflections land at plausible angles:
 * the window wall is close on +X, the far end recedes on −Z, the green deck is
 * 4.3 m below. Everything is unlit MeshBasicMaterial with HDR (>1) colours.
 * @returns {THREE.Scene}
 */
function makeEnvRoom() {
  const room = new THREE.Scene();

  // Hall shell relative to the camera eye (2.78, 4.32, 3.60).
  const x0 = -9.3; // left wall
  const x1 = 3.7; // right (window) wall
  const y0 = -4.32; // floor
  const y1 = 4.68; // roof deck
  const z0 = -18.0; // hall receding away
  const z1 = 2.4; // wall behind the camera

  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;

  // BoxGeometry material order: +X, −X, +Y, −Y, +Z, −Z.
  const shell = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [
    envMat(1.12, 1.10, 1.02), // +X  window wall piers / spandrels — hot cream
    envMat(0.60, 0.60, 0.56), // −X  far left wall, in the room's own shade
    envMat(1.42, 1.39, 1.28), // +Y  the big cream ceiling bounce card
    envMat(0.17, 0.27, 0.20), // −Y  green epoxy deck
    envMat(0.52, 0.51, 0.47), // +Z  wall behind the camera
    envMat(0.78, 0.77, 0.72), // −Z  far gable, washed out by distance haze
  ]);
  shell.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  room.add(shell);

  // The two glazing bands, blown out. These are what the polished conveyor
  // rollers and the robot castings actually reflect in the photograph.
  const bandX = x1 - 0.02;
  const bands = [
    // world sill 2.30 → head 4.30
    { yc: (2.3 + 4.3) / 2 - 4.32, hh: 4.3 - 2.3, c: [3.4, 3.5, 3.7] },
    // world clerestory 5.30 → 6.90 — nearer the sky, brighter and cooler
    { yc: (5.3 + 6.9) / 2 - 4.32, hh: 6.9 - 5.3, c: [4.1, 4.25, 4.6] },
  ];
  for (const b of bands) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(d * 0.94, b.hh), envPanel(b.c[0], b.c[1], b.c[2]));
    q.rotation.y = -Math.PI / 2; // face −X, into the room
    q.position.set(bandX, b.yc, (z0 + z1) / 2);
    room.add(q);
  }

  // The two rows of fluorescent battens — faint, but they put the long specular
  // streaks on the aluminium rollers and the robot shoulders.
  for (const bx of CFG.fixtures.battenX) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.34, d * 0.9), envPanel(2.4, 2.36, 2.2));
    strip.rotation.x = Math.PI / 2; // face −Y, downwards
    strip.position.set(
      bx - CFG.camera.position[0],
      CFG.fixtures.battenY - CFG.camera.position[1],
      (z0 + z1) / 2,
    );
    room.add(strip);
  }

  return room;
}

/** Free the throw-away geometry/materials of the env room. */
function disposeEnvRoom(room) {
  room.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
    else o.material.dispose();
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the complete lighting rig and bake + install the PMREM environment.
 *
 * The returned `group` is **not** added to the scene — hand it to the caller's
 * scene graph like any other builder. The environment map, by contrast, is
 * applied immediately (it has to be, so `applyEnvironment()` can reach the
 * materials that already exist).
 *
 * @param {THREE.WebGLRenderer} renderer used to bake the PMREM and to flag
 *        shadow-map refreshes.
 * @param {THREE.Scene} scene receives `scene.environment`; also scanned so the
 *        building shell can be excluded from the sun's shadow map.
 * @returns {{group: THREE.Group, sun: THREE.DirectionalLight,
 *            fill: THREE.DirectionalLight, hemi: THREE.HemisphereLight,
 *            ambient: THREE.AmbientLight, rectLights: THREE.RectAreaLight[],
 *            pointLights: THREE.PointLight[], envMap: (THREE.Texture|null),
 *            update(dt: number): void, setShadows(on: boolean): void,
 *            dispose(): void}}
 */
export function buildLighting(renderer, scene) {
  // RectAreaLight needs its LTC lookup textures uploaded before first use.
  try {
    RectAreaLightUniformsLib.init();
  } catch (e) {
    console.warn('[lighting] RectAreaLightUniformsLib.init() failed:', e);
  }

  const L = CFG.light;

  // ── 1 · Base wash ────────────────────────────────────────────────────────
  // Cool-white sky over a green-floor bounce: this alone already gets the
  // "nothing reads as black" value structure most of the way there.
  const hemi = new THREE.HemisphereLight(L.skyColor, L.groundColor, L.hemiIntensity);
  hemi.name = 'hemiSky';
  hemi.position.set(0, 1, 0);

  const ambient = new THREE.AmbientLight(0xf4f6f8, L.ambientIntensity);
  ambient.name = 'ambientWarm';

  // ── 2 · The sun, raking in through the right-hand glazing ────────────────
  const dir = new THREE.Vector3().fromArray(L.sunDir).normalize();
  const sun = new THREE.DirectionalLight(L.sunColor, L.sunIntensity);
  sun.name = 'sun';
  sun.position.copy(SUN_TARGET).addScaledVector(dir, -SUN_DISTANCE); // ≈ (18.9, 16.7, 3.1)
  sun.target.position.copy(SUN_TARGET);
  sun.castShadow = true;

  const q = CFG.quality.shadowMapSize;
  sun.shadow.mapSize.set(q, q);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  sun.shadow.intensity = SHADOW_STRENGTH; // barely-there shadows, as photographed
  sun.shadow.camera.updateProjectionMatrix();
  fitDirectionalShadow(sun, SHADOW_MIN, SHADOW_MAX);

  // ── 3 · Left-hand bounce fill (no shadow) ────────────────────────────────
  // Stands in for the light coming back off the far wall and the pale clutter
  // on the left; picks up a touch of green from the floor.
  const fill = new THREE.DirectionalLight(0xeaf0ea, 0.25);
  fill.name = 'fillLeft';
  fill.position.set(-15, 9.5, 5.0);
  fill.target.position.set(1.0, 1.8, -11.0);
  fill.castShadow = false;

  // ── 4 · The window openings as real area sources ─────────────────────────
  const lower = CFG.windows.lower;
  const rectW = lower.width - 2 * CFG.windows.frameW; // clear glazed opening
  const rectH = lower.headY - lower.sillY - 2 * CFG.windows.frameW;
  const rectY = (lower.sillY + lower.headY) / 2;

  const rectLights = WINDOW_LIGHT_BAYS.map((k) => {
    const z = CFG.bay.z(k);
    const r = new THREE.RectAreaLight(WINDOW_COLOR, L.windowLightIntensity, rectW, rectH);
    r.name = `windowLight${k}`;
    r.position.set(WINDOW_LIGHT_X, rectY, z);
    // Emit along −X, into the hall. lookAt aims the light's local −Z.
    r.lookAt(WINDOW_LIGHT_X - 1, rectY, z);
    return r;
  });

  // ── 5 · A few fixture pools, cheap and unshadowed ────────────────────────
  const pointLights = [];
  for (const z of FIXTURE_Z) {
    for (const x of CFG.fixtures.battenX) {
      const p = new THREE.PointLight(PAL.emissiveLamp, L.fixtureIntensity * 6, 11, 1.5);
      p.name = `battenPool${pointLights.length}`;
      p.position.set(x, CFG.fixtures.battenY - 0.18, z);
      p.castShadow = false;
      pointLights.push(p);
    }
  }

  const g = group(
    'lighting',
    hemi,
    ambient,
    sun,
    sun.target,
    fill,
    fill.target,
    ...rectLights,
    ...pointLights,
  );

  // ── 6 · PMREM environment ────────────────────────────────────────────────
  let envMap = null;
  if (renderer) {
    const room = makeEnvRoom();
    let pmrem = null;
    try {
      pmrem = new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromScene(room, 0.035, 0.1, 80);
      envMap = rt.texture;
      if (scene) {
        scene.environment = envMap;
        scene.environmentIntensity = 1.0;
      }
      // Push it onto every already-registered material. Call this exactly once:
      // applyEnvironment() *multiplies* envMapIntensity.
      applyEnvironment(envMap, 1);
    } catch (e) {
      console.warn('[lighting] PMREM environment failed; falling back to lights only:', e);
    } finally {
      if (pmrem) pmrem.dispose();
      disposeEnvRoom(room);
    }
  }

  // ── 7 · Shadow hygiene ───────────────────────────────────────────────────
  // buildLighting() may run before or after buildFactory(), so sweep now and
  // again on the first few frames.
  let relaxPasses = 3;
  relaxShellShadows(scene);

  return {
    group: g,
    sun,
    fill,
    hemi,
    ambient,
    rectLights,
    pointLights,
    envMap,

    /**
     * Per-frame hook. Deliberately a no-op for the look (the photo is a still,
     * and flickering daylight would only hurt it); it just finishes the
     * one-time shadow-caster sweep once layout.js has populated the scene.
     * @param {number} _dt seconds since the previous frame
     */
    update(_dt) {
      if (relaxPasses > 0) {
        relaxPasses--;
        relaxShellShadows(scene);
      }
    },

    /**
     * Enable/disable the single shadow-casting light.
     * @param {boolean} on
     */
    setShadows(on) {
      sun.castShadow = !!on;
      if (renderer && renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
    },

    /** Release the baked environment texture. */
    dispose() {
      if (envMap) {
        if (scene && scene.environment === envMap) scene.environment = null;
        envMap.dispose();
        envMap = null;
      }
    },
  };
}
