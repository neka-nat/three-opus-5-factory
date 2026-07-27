/**
 * main.js — the bootstrap.
 *
 * Wires the five scene modules together and drives the page:
 *
 *   buildFactory()  → the whole hall, world-placed (scene/layout.js)
 *   buildLighting() → every THREE.Light + the PMREM environment
 *   setupCamera()   → the photo-match / free-orbit rig and its letterbox rect
 *   makeComposer()  → RenderPass → AO → bloom → tone map → AA
 *
 * Build order matters in one place: `buildFactory()` must run **before**
 * `buildLighting()`, because `buildLighting()` calls `applyEnvironment()` and
 * that only reaches materials which have already been instantiated.
 *
 * Photo-match mode letterboxes the render to `CFG.camera.photoAspect`. The
 * single source of truth for that rectangle is `camera.resize()`; it is handed
 * to `postfx.setSize()` (which scissors the composer into it), used to lay out
 * the four `#matte` bars that mask the surround, used to position the `#ref`
 * overlay image so it lines up pixel-for-pixel, and published as
 * `window.__photoRect` for `tools/shot.py`.
 *
 * @module main
 */
import * as THREE from 'three';

import { CFG } from './core/config.js';
import { TexOpts } from './core/textures.js';
import { buildFactory } from './scene/layout.js';
import { buildLighting } from './scene/lighting.js';
import { setupCamera } from './scene/camera.js';
import { makeComposer } from './scene/postfx.js';

// ────────────────────────────────────────────────────────────────────────────
// DOM handles
// ────────────────────────────────────────────────────────────────────────────

/** @param {string} id @returns {HTMLElement|null} */
const $ = (id) => document.getElementById(id);

const dom = {
  app: $('app'),
  loader: $('loader'),
  loaderMsg: $('loader-msg'),
  btnPhoto: $('btn-photo'),
  btnOrbit: $('btn-orbit'),
  selView: $('sel-view'),
  btnRef: $('btn-ref'),
  btnSsao: $('btn-ssao'),
  btnBloom: $('btn-bloom'),
  btnShadow: $('btn-shadow'),
  rngExposure: $('rng-exposure'),
  selTone: $('sel-tone'),
  rngRef: $('rng-ref'),
  slider: $('slider'),
  matte: $('matte'),
  ref: $('ref'),
  sFps: $('s-fps'),
  sTri: $('s-tri'),
  sCalls: $('s-calls'),
  modeNote: $('mode-note'),
  hud: $('hud'),
  stats: $('stats'),
  help: $('help'),
};

/** The five framings, in the order the 1–5 keys and `#sel-view` expect. */
const VIEW_KEYS = ['photo', 'aisle', 'cell', 'crane', 'top'];

/** Set the loader's status line. */
function say(text) {
  if (dom.loaderMsg) dom.loaderMsg.textContent = text;
}

/**
 * Wait for the browser to actually paint the message we just wrote. Falls back
 * to a timer so boot cannot stall in a background tab, where rAF never fires.
 */
function paint() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => requestAnimationFrame(finish));
    setTimeout(finish, 300);
  });
}

/**
 * The letterbox rectangle for `CFG.camera.photoAspect` inside a `w × h`
 * viewport, in CSS pixels with a top-left origin. Identical arithmetic to
 * `scene/camera.js`, so the two always agree; used for the `#ref` overlay even
 * in free-orbit mode, where the renderer itself is not letterboxed.
 *
 * @param {number} w @param {number} h
 * @returns {{x:number,y:number,w:number,h:number}}
 */
function letterbox(w, h) {
  const a = CFG.camera.photoAspect;
  let rw = w;
  let rh = w / a;
  if (rh > h) {
    rh = h;
    rw = h * a;
  }
  rw = Math.max(1, Math.floor(rw));
  rh = Math.max(1, Math.floor(rh));
  return { x: Math.round((w - rw) / 2), y: Math.round((h - rh) / 2), w: rw, h: rh };
}

/** Format an integer with thin thousands separators. */
function fmt(n) {
  return Math.round(n).toLocaleString('en-US');
}

// ────────────────────────────────────────────────────────────────────────────
// Boot
// ────────────────────────────────────────────────────────────────────────────

async function boot() {
  // ── renderer ─────────────────────────────────────────────────────────────
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: false, // SMAA in the composer does the job on LDR data
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
  } catch (err) {
    console.error('[main] WebGL is unavailable.', err);
    say('WebGL を初期化できません — WebGL is unavailable in this browser.');
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, true);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = CFG.light.exposure;
  renderer.shadowMap.enabled = true;
  // CONTRACT asks for PCFSoftShadowMap; three r185 deprecated it and silently
  // rewrites it to PCFShadowMap on the first shadow pass (three.module.js
  // ~L9150). Asking for PCFShadowMap directly is pixel-identical and keeps the
  // console clean.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false; // we reset once per frame, across all passes
  renderer.domElement.setAttribute('aria-label', 'factory reconstruction');
  (dom.app || document.body).appendChild(renderer.domElement);

  // core/textures.js bakes this into every CanvasTexture it makes, so it has to
  // be set before the first material is touched — i.e. before buildFactory().
  TexOpts.anisotropy = Math.max(
    1, Math.min(CFG.quality.anisotropy, renderer.capabilities.getMaxAnisotropy()),
  );

  // ── scene ────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.name = 'factoryScene';
  // Nothing in frame should ever read as black; the hall is closed, so this
  // only shows through the odd sliver behind the glazing.
  scene.background = new THREE.Color(0xd3d3d1);
  // The photograph has a real atmospheric lift: the far end of the hall washes
  // out toward the wall colour rather than staying crisp. Linear fog over the
  // back half reproduces it and keeps the deep background from reading as a
  // hard, over-detailed plane.
  scene.fog = new THREE.Fog(0xdcdcdb, 26, 100);

  say('工場を組み立て中 · building the factory…');
  await paint();
  const factory = buildFactory();
  scene.add(factory);

  say('照明とエンバイロンメント · lighting…');
  await paint();
  const lighting = buildLighting(renderer, scene);
  scene.add(lighting.group);

  say('カメラとポストプロセス · camera + post…');
  await paint();
  const cam = setupCamera(renderer, renderer.domElement);
  const fx = makeComposer(renderer, scene, cam.camera);

  // ── layout / resize ──────────────────────────────────────────────────────

  /** Position the four `#matte` bars and the `#ref` image around `rect`. */
  function layoutOverlays(rect, w, h) {
    const px = (v) => `${Math.max(0, Math.round(v))}px`;

    if (dom.matte) {
      const photo = cam.isPhoto;
      dom.matte.classList.toggle('on', photo);
      const bars = dom.matte.children;
      if (photo && bars.length >= 4) {
        const [top, bottom, left, right] = bars;
        top.style.cssText = `left:0;top:0;width:${px(w)};height:${px(rect.y)}`;
        bottom.style.cssText =
          `left:0;top:${px(rect.y + rect.h)};width:${px(w)};height:${px(h - rect.y - rect.h)}`;
        left.style.cssText =
          `left:0;top:${px(rect.y)};width:${px(rect.x)};height:${px(rect.h)}`;
        right.style.cssText =
          `left:${px(rect.x + rect.w)};top:${px(rect.y)};` +
          `width:${px(w - rect.x - rect.w)};height:${px(rect.h)}`;
      }
    }

    // The overlay always keeps the photograph's own aspect, so it stays
    // undistorted in free-orbit mode too.
    const r = cam.isPhoto ? rect : letterbox(w, h);
    if (dom.ref) {
      dom.ref.style.inset = 'auto';
      dom.ref.style.margin = '0';
      dom.ref.style.left = px(r.x);
      dom.ref.style.top = px(r.y);
      dom.ref.style.width = px(r.w);
      dom.ref.style.height = px(r.h);
    }
    window.__photoRect = { x: r.x, y: r.y, w: r.w, h: r.h };
  }

  /** Re-size the renderer, the camera, the composer and every overlay. */
  function onResize() {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    renderer.setSize(w, h, true);
    const rect = cam.resize(w, h);
    fx.setSize(w, h, cam.isPhoto ? rect : null);
    layoutOverlays(rect, w, h);
  }

  window.addEventListener('resize', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

  // ── HUD ──────────────────────────────────────────────────────────────────

  /** Enter/leave photo-match mode and re-plumb the viewport + matte. */
  function setMode(photo, immediate = false) {
    const rect = cam.setPhotoMatch(photo, immediate);
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    fx.setSize(w, h, photo ? rect : null);
    if (dom.btnPhoto) dom.btnPhoto.classList.toggle('on', photo);
    if (dom.btnOrbit) dom.btnOrbit.classList.toggle('on', !photo);
    if (dom.modeNote) dom.modeNote.classList.toggle('hidden', !photo);
    layoutOverlays(rect, w, h);
  }

  /**
   * Photo-match is a locked framing — OrbitControls is disabled so the pose
   * stays exactly on the photograph. That makes the page look like a still
   * image, so grabbing the canvas drops straight into free orbit.
   *
   * This has to run in the CAPTURE phase on an ANCESTOR of the canvas: at the
   * canvas itself, listeners fire in registration order and OrbitControls
   * registered first, so it would see `enabled === false` and swallow the
   * gesture. Capturing on #app switches the mode before OrbitControls' own
   * handler runs, so the very first drag orbits instead of being eaten.
   */
  function grabToOrbit(e) {
    if (!cam.isPhoto) return;
    if (e.target && e.target.closest && e.target.closest('.panel')) return; // HUD clicks
    setMode(false, true); // immediate: no tween to fight the drag
  }

  let refOn = false;
  /** Show/hide the reference photograph overlay and its blend slider. */
  function setRef(on) {
    refOn = !!on;
    const blend = dom.rngRef ? Number(dom.rngRef.value) : 0.5; // 0 = photo, 1 = 3D
    if (dom.btnRef) dom.btnRef.classList.toggle('on', refOn);
    if (dom.slider) dom.slider.classList.toggle('on', refOn);
    if (dom.ref) dom.ref.style.opacity = refOn ? String(1 - blend) : '0';
  }

  /**
   * Fly to a named framing and keep `#sel-view` in step. Picking the
   * photograph's own framing from free-orbit also re-enters photo-match mode —
   * `camera.setPhotoMatch()` owns the letterbox, and it flies to the same pose.
   */
  function goView(name) {
    if (!VIEW_KEYS.includes(name)) return;
    if (name === 'photo' && !cam.isPhoto) setMode(true);
    else cam.setView(name);
    if (dom.selView && dom.selView.value !== name) dom.selView.value = name;
  }

  if (dom.btnPhoto) dom.btnPhoto.addEventListener('click', () => setMode(true));
  if (dom.btnOrbit) dom.btnOrbit.addEventListener('click', () => setMode(false));
  if (dom.selView) dom.selView.addEventListener('change', (e) => goView(e.target.value));
  const surface = dom.app || document.body;
  surface.addEventListener('pointerdown', grabToOrbit, { capture: true });
  surface.addEventListener('wheel', grabToOrbit, { capture: true, passive: true });

  if (dom.btnRef) dom.btnRef.addEventListener('click', () => setRef(!refOn));
  if (dom.rngRef) {
    dom.rngRef.addEventListener('input', () => {
      if (refOn && dom.ref) dom.ref.style.opacity = String(1 - Number(dom.rngRef.value));
    });
  }

  if (dom.btnSsao) {
    dom.btnSsao.addEventListener('click', () => {
      const want = !dom.btnSsao.classList.contains('on');
      const got = fx.setSSAO(want);
      dom.btnSsao.classList.toggle('on', got);
      if (want && !got) {
        dom.btnSsao.disabled = true;
        dom.btnSsao.title = 'no ambient-occlusion pass in this build';
      }
    });
  }

  if (dom.btnBloom) {
    dom.btnBloom.addEventListener('click', () => {
      const want = !dom.btnBloom.classList.contains('on');
      const got = fx.setBloom(want);
      dom.btnBloom.classList.toggle('on', got);
      if (want && !got) {
        dom.btnBloom.disabled = true;
        dom.btnBloom.title = 'no bloom pass in this build';
      }
    });
  }

  if (dom.btnShadow) {
    dom.btnShadow.addEventListener('click', () => {
      const want = !dom.btnShadow.classList.contains('on');
      lighting.setShadows(want);
      dom.btnShadow.classList.toggle('on', want);
    });
  }

  if (dom.rngExposure) {
    dom.rngExposure.value = String(CFG.light.exposure);
    dom.rngExposure.addEventListener('input', () => {
      const v = Number(dom.rngExposure.value);
      if (Number.isFinite(v)) renderer.toneMappingExposure = v;
    });
  }

  if (dom.selTone) {
    dom.selTone.addEventListener('change', () => fx.setToneMapping(dom.selTone.value));
  }

  // ── keyboard ─────────────────────────────────────────────────────────────
  let uiHidden = false;
  const panels = [dom.hud, dom.stats, dom.help, dom.slider].filter(Boolean);

  /** Toggle every HUD panel (the `H` key). */
  function setUi(hidden) {
    uiHidden = hidden;
    for (const el of panels) el.style.display = hidden ? 'none' : '';
  }

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;

    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= VIEW_KEYS.length) {
      goView(VIEW_KEYS[n - 1]);
      e.preventDefault();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'r') {
      setRef(!refOn);
      e.preventDefault();
    } else if (k === 'h') {
      setUi(!uiHidden);
      e.preventDefault();
    } else if (k === 'o') {
      setMode(false);
      e.preventDefault();
    } else if (k === 'p') {
      setMode(true);
      e.preventDefault();
    }
  });

  // ── first layout, then the loop ──────────────────────────────────────────
  say('レンダリング · first frame…');
  await paint();

  setMode(true, true);
  onResize();
  setRef(false);

  // THREE.Clock is deprecated in r185, so keep our own frame timer.
  let lastT = performance.now();
  let firstFrame = true;
  let frames = 0;
  let statT = lastT;

  /** Push the fps / triangle / draw-call read-outs, twice a second. */
  function reportStats(now) {
    const dtMs = now - statT;
    if (dtMs < 500) return;
    const info = renderer.info.render;
    const fps = (frames * 1000) / dtMs;
    if (dom.sFps) dom.sFps.textContent = fps >= 10 ? String(Math.round(fps)) : fps.toFixed(1);
    if (dom.sTri) dom.sTri.textContent = fmt(info.triangles);
    if (dom.sCalls) dom.sCalls.textContent = fmt(info.calls);
    frames = 0;
    statT = now;
  }

  function tick() {
    requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - lastT) / 1000));
    lastT = now;

    cam.update(dt);
    lighting.update(dt);

    // `info.autoReset` is off, so this accumulates the shadow pass, the AO
    // pass and every composer pass into one honest per-frame total.
    renderer.info.reset();
    fx.render(dt);

    frames += 1;
    reportStats(performance.now());

    if (firstFrame) {
      firstFrame = false;
      hideLoader();
    }
  }

  /** Fade the loading curtain out once there is something behind it. */
  function hideLoader() {
    if (!dom.loader) return;
    dom.loader.classList.add('done');
    window.setTimeout(() => {
      if (dom.loader) dom.loader.style.display = 'none';
    }, 700);
  }

  // Handy for the headless capture harness and for poking at the scene.
  window.__factory = {
    THREE, renderer, scene, factory, lighting, cam, fx,
    setMode, setRef, goView, letterbox,
  };

  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('[main] WebGL context lost.');
  });

  tick();
}

boot().catch((err) => {
  console.error('[main] boot failed:', err);
  say(`起動に失敗しました — ${err && err.message ? err.message : err}`);
});
