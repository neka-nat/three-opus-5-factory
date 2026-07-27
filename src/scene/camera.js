/**
 * scene/camera.js — the viewing rig.
 *
 * Two modes share one PerspectiveCamera:
 *
 *   • PHOTO-MATCH (default) — reproduces the viewpoint of `img01.jpg` exactly.
 *     Position, yaw, pitch and vertical FOV all come from `CFG.camera`, and the
 *     rendered image is *letterboxed* to `CFG.camera.photoAspect` (960×800) so
 *     the framing can be compared 1:1 with the photograph. `resize()` returns
 *     the letterbox rectangle in CSS pixels; `main.js` uses it to drive
 *     `renderer.setViewport/setScissor` and the four `#matte` DOM bars.
 *     Orbit controls are disabled — the viewpoint is locked.
 *
 *   • FREE — full viewport, a wider `CFG.camera.freeVFov`, and OrbitControls
 *     with damping, a polar limit just short of horizontal, and an orbit target
 *     (and eye) clamped inside the building shell so you cannot end up outside
 *     the walls looking at their backs.
 *
 * `setView(name)` tweens position + target (+ FOV) over ~0.9 s with an
 * ease-in-out curve for the five entries of `#sel-view` in index.html.
 * It deliberately does **not** change the mode: the `📷 Photo match` /
 * `Free orbit` buttons stay the single authority for that, so the `#matte`
 * bars can never get out of sync with the renderer viewport.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CFG } from '../core/config.js';
import { V3 } from '../core/utils.js';

const { clamp, lerp } = THREE.MathUtils;

/** Duration of a `setView()` / mode-change tween, seconds. */
const TWEEN_SECONDS = 0.9;
/** How far in front of the photo eye the derived orbit pivot sits, metres. */
const PIVOT_DISTANCE = 12.0;

// The photograph's pose, straight out of CFG. Euler order 'YXZ': yaw about +Y
// (positive = turned left), then pitch about the camera's own X (negative =
// looking down), no roll.
const PHOTO_EYE = V3(...CFG.camera.position);
const PHOTO_EULER = new THREE.Euler(CFG.camera.pitch, CFG.camera.yaw, 0, 'YXZ');
const PHOTO_DIR = V3(0, 0, -1).applyEuler(PHOTO_EULER);
const PHOTO_TARGET = PHOTO_EYE.clone().addScaledVector(PHOTO_DIR, PIVOT_DISTANCE);

/** Orbit pivot must stay inside the hall (a little inboard of every surface). */
const TARGET_BOUNDS = {
  minX: -(CFG.hall.halfWidth - 0.4), maxX: CFG.hall.halfWidth - 0.4,
  minY: 0.25, maxY: CFG.hall.ceilingY - 0.7,
  minZ: CFG.hall.zBack + 1.3, maxZ: CFG.hall.zFront - 0.6,
};
/** The eye may come closer to the shell than the pivot, but not through it. */
const EYE_BOUNDS = {
  minX: -(CFG.hall.halfWidth - 0.25), maxX: CFG.hall.halfWidth - 0.25,
  minY: 0.35, maxY: CFG.hall.ceilingY - 0.4,
  minZ: CFG.hall.zBack + 0.5, maxZ: CFG.hall.zFront - 0.3,
};

/**
 * The five framings offered by `#sel-view`.
 *   photo — the photograph itself (exact pose, no lookAt round-trip)
 *   aisle — eye level walking down the white-lined aisle at x ≈ −2.35
 *   cell  — three-quarter view of the foreground robot cell + conveyor
 *   crane — looking up at the orange bridge girder and its festoon loops
 *   top   — high under the roof deck, the whole hall receding
 */
const VIEWS = {
  photo: { pos: PHOTO_EYE, target: PHOTO_TARGET, exact: true },
  aisle: { pos: V3(-2.35, 1.78, 3.40), target: V3(-2.55, 1.35, -15.0) },
  cell: { pos: V3(-0.55, 2.44, 4.05), target: V3(2.85, 1.02, -3.60) },
  crane: { pos: V3(4.35, 3.05, -0.60), target: V3(-1.60, 5.62, -9.40) },
  top: { pos: V3(0.85, 7.30, 4.90), target: V3(-0.60, 0.85, -14.0) },
};

/** Cubic ease-in-out on [0,1]. */
function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Clamp a Vector3 into an axis-aligned box (mutates and returns it). */
function clampInto(v, b) {
  v.x = clamp(v.x, b.minX, b.maxX);
  v.y = clamp(v.y, b.minY, b.maxY);
  v.z = clamp(v.z, b.minZ, b.maxZ);
  return v;
}

/**
 * Build the camera rig: a PerspectiveCamera, OrbitControls, the photo-match
 * letterbox and the view tweener.
 *
 * The returned `resize(w, h)` rectangle is in **CSS pixels with a top-left
 * origin** (DOM convention), which is what the `#matte` bars want. Because the
 * letterbox is always centred, the same rect works unflipped for
 * `renderer.setViewport(x, y, w, h)` / `setScissor(...)`; if you prefer to be
 * explicit, WebGL's bottom-left y is `canvasH - rect.y - rect.h`, which is the
 * same number. A mode change also invalidates the rect — `setPhotoMatch()` and
 * `setView()` therefore return the fresh one, and `rect` is readable at any time.
 *
 * @param {THREE.WebGLRenderer} renderer   used only for its canvas / size
 * @param {HTMLElement} [domElement]       element OrbitControls listens on
 * @returns {{camera: THREE.PerspectiveCamera, controls: OrbitControls,
 *            setView(name: string, immediate?: boolean): {x:number,y:number,w:number,h:number},
 *            setPhotoMatch(on: boolean, immediate?: boolean): {x:number,y:number,w:number,h:number},
 *            isPhoto: boolean,
 *            rect: {x:number,y:number,w:number,h:number},
 *            resize(w?: number, h?: number): {x:number,y:number,w:number,h:number},
 *            update(dt: number): void,
 *            dispose(): void}}
 */
export function setupCamera(renderer, domElement) {
  const canvas = domElement || renderer?.domElement || document.body;

  // ── state ────────────────────────────────────────────────────────────────
  /** @type {'photo'|'free'} */
  let mode = 'photo';
  let viewW = Math.max(1, canvas.clientWidth || window.innerWidth || 960);
  let viewH = Math.max(1, canvas.clientHeight || window.innerHeight || 800);
  let fov = CFG.camera.photoVFov;
  let rect = { x: 0, y: 0, w: viewW, h: viewH };

  const target = PHOTO_TARGET.clone();

  const camera = new THREE.PerspectiveCamera(
    fov, CFG.camera.photoAspect, CFG.camera.near, CFG.camera.far,
  );
  camera.name = 'mainCamera';
  camera.rotation.order = 'YXZ';
  camera.up.set(0, 1, 0);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.85;
  controls.panSpeed = 0.7;
  controls.screenSpacePanning = true;
  controls.maxPolarAngle = 1.55; // stop just shy of looking up under the floor
  controls.minPolarAngle = 0.10;
  controls.minDistance = 0.8;
  controls.maxDistance = 40;
  controls.target.copy(target);
  controls.enabled = false; // photo mode is locked

  // Tween scratch — one allocation, reused for every transition.
  const tw = {
    active: false, t: 0, dur: TWEEN_SECONDS, exact: false,
    fromPos: V3(), toPos: V3(), fromTgt: V3(), toTgt: V3(), fromFov: fov, toFov: fov,
  };

  // ── projection / letterbox ───────────────────────────────────────────────

  /** The vertical FOV the current mode wants. */
  const modeFov = () => (mode === 'photo' ? CFG.camera.photoVFov : CFG.camera.freeVFov);

  /** Recompute the letterbox rect for the current mode + viewport size. */
  function computeRect() {
    if (mode !== 'photo') {
      rect = { x: 0, y: 0, w: viewW, h: viewH };
      return rect;
    }
    const a = CFG.camera.photoAspect;
    let w = viewW;
    let h = w / a;
    if (h > viewH) {
      h = viewH;
      w = h * a;
    }
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    rect = { x: Math.round((viewW - w) / 2), y: Math.round((viewH - h) / 2), w, h };
    return rect;
  }

  /** Push `fov` + the rect's aspect into the projection matrix. */
  function applyProjection() {
    camera.fov = fov;
    camera.aspect = rect.h > 0 ? rect.w / rect.h : 1;
    camera.updateProjectionMatrix();
  }

  // ── pose helpers ─────────────────────────────────────────────────────────

  /** Point the camera at `target` with no roll. */
  function orient() {
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
  }

  /**
   * Snap to the photograph's pose from the raw yaw/pitch rather than via
   * lookAt(), so photo-match mode is bit-for-bit the framing CFG describes.
   */
  function applyPhotoPose() {
    camera.position.copy(PHOTO_EYE);
    camera.up.set(0, 1, 0);
    camera.rotation.set(CFG.camera.pitch, CFG.camera.yaw, 0, 'YXZ');
    target.copy(PHOTO_TARGET);
  }

  /** End-of-tween housekeeping: hand the pose back to OrbitControls. */
  function settle() {
    tw.active = false;
    if (tw.exact) applyPhotoPose();
    else orient();
    controls.target.copy(target);
    controls.enabled = mode === 'free';
    if (controls.enabled) controls.update();
  }

  /**
   * Start a position/target/FOV tween. `dur <= 0` applies it immediately.
   * @param {THREE.Vector3} pos @param {THREE.Vector3} tgt
   * @param {number} toFov @param {number} dur @param {boolean} exact
   */
  function startTween(pos, tgt, toFov, dur, exact = false) {
    tw.fromPos.copy(camera.position);
    tw.toPos.copy(pos);
    tw.fromTgt.copy(target);
    tw.toTgt.copy(tgt);
    tw.fromFov = fov;
    tw.toFov = toFov;
    tw.exact = exact;
    tw.t = 0;
    tw.dur = dur;
    tw.active = dur > 0;
    controls.enabled = false; // no fighting the tween
    if (!tw.active) {
      camera.position.copy(tw.toPos);
      target.copy(tw.toTgt);
      fov = tw.toFov;
      applyProjection();
      settle();
    }
  }

  // ── public API ───────────────────────────────────────────────────────────

  /**
   * Resize the viewport. Returns the letterbox rect in CSS pixels.
   * @param {number} [w] @param {number} [h]
   */
  function resize(w, h) {
    viewW = Math.max(1, Math.floor(w || canvas.clientWidth || window.innerWidth || 1));
    viewH = Math.max(1, Math.floor(h || canvas.clientHeight || window.innerHeight || 1));
    computeRect();
    applyProjection();
    return rect;
  }

  /**
   * Enter / leave photo-match mode. Entering flies back to the photograph's
   * exact pose; leaving keeps the current pose and just widens the FOV.
   * @param {boolean} on @param {boolean} [immediate] skip the tween
   */
  function setPhotoMatch(on, immediate = false) {
    const next = on ? 'photo' : 'free';
    if (next === mode) {
      computeRect();
      applyProjection();
      return rect;
    }
    mode = next;
    computeRect();
    applyProjection();
    const dur = immediate ? 0 : TWEEN_SECONDS * 0.7;
    if (mode === 'photo') {
      startTween(VIEWS.photo.pos, VIEWS.photo.target, modeFov(), dur, true);
    } else {
      // stay put, just relax the framing and hand over to OrbitControls
      startTween(camera.position, target, modeFov(), dur, false);
    }
    return rect;
  }

  /**
   * Fly to one of the five named framings over ~0.9 s.
   * Does not change photo-match mode — the HUD buttons own that.
   * @param {'photo'|'aisle'|'cell'|'crane'|'top'} name
   * @param {boolean} [immediate] snap instead of tweening
   */
  function setView(name, immediate = false) {
    const v = VIEWS[name];
    if (!v) {
      console.warn(`[camera] unknown view "${name}" — expected one of ${Object.keys(VIEWS).join(', ')}`);
      return rect;
    }
    startTween(
      v.pos, v.target, modeFov(), immediate ? 0 : TWEEN_SECONDS,
      Boolean(v.exact) && mode === 'photo',
    );
    return rect;
  }

  /**
   * Advance the tween and the orbit damping. Call once per frame.
   * @param {number} dt seconds since the last frame
   */
  function update(dt) {
    const d = clamp(Number.isFinite(dt) ? dt : 1 / 60, 0, 0.1);

    if (tw.active) {
      tw.t += d;
      const k = tw.dur > 0 ? Math.min(1, tw.t / tw.dur) : 1;
      const e = ease(k);
      camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      target.lerpVectors(tw.fromTgt, tw.toTgt, e);
      fov = lerp(tw.fromFov, tw.toFov, e);
      applyProjection();
      orient();
      if (k >= 1) settle();
      return;
    }

    if (mode === 'free' && controls.enabled) {
      controls.update(d);
      clampInto(controls.target, TARGET_BOUNDS);
      clampInto(camera.position, EYE_BOUNDS);
      target.copy(controls.target);
    }
  }

  /** Detach the OrbitControls listeners. */
  function dispose() {
    controls.dispose();
  }

  // Initial state: locked on the photograph.
  applyPhotoPose();
  computeRect();
  applyProjection();

  return {
    camera,
    controls,
    setView,
    setPhotoMatch,
    get isPhoto() {
      return mode === 'photo';
    },
    get rect() {
      return rect;
    },
    resize,
    update,
    dispose,
  };
}
