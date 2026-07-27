/**
 * postfx.js — the post-processing chain.
 *
 *   EffectComposer
 *     → RenderPass          the scene, into an HDR (half-float) buffer
 *     → GTAOPass            ground-truth ambient occlusion  (SSAOPass fallback)
 *     → UnrealBloomPass     a *very* subtle bloom — just the window blow-out
 *     → OutputPass          tone mapping + sRGB encode      (gamma fallback)
 *     → SMAAPass            anti-aliasing on the LDR image  (FXAAPass fallback)
 *
 * Why these settings: img01.jpg is a high-key, almost shadowless interior.
 * Contact shadows exist but are soft and shallow, so the AO runs at a low blend
 * intensity with a small radius; and the only thing that actually blooms is the
 * blown-out glazing on the right wall (plus the fluorescent battens), hence the
 * high threshold / low strength taken from `CFG.quality.bloom*`.
 *
 * Every pass is constructed inside its own guard: if any of them is missing or
 * throws on this build of three, a warning is logged and the chain simply
 * continues without it. If even the composer cannot be created, `render()`
 * falls back to `renderer.render(scene, camera)` so something is always drawn.
 *
 * Photo-match letterboxing: `setSize()` accepts the pixel rect returned by
 * `camera.resize()`. The composer's internal buffers are sized to *that rect*
 * (not the canvas), and `render()` scissors the final pass into it, so the
 * matte bars stay clean and the post-processing costs nothing outside the
 * visible frame.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader.js';
import { CFG } from '../core/config.js';

// ────────────────────────────────────────────────────────────────────────────
// Tuning
// ────────────────────────────────────────────────────────────────────────────

/** GTAO shader parameters — metres, because the AO radius is a view-space one. */
const AO_PARAMS = {
  radius: 0.32, // tight: creases under machine plinths, not room-scale darkening
  distanceExponent: 1.15,
  thickness: 0.55,
  distanceFallOff: 1.0,
  scale: 1.0,
  samples: 12, // 16 is the default; 12 keeps integrated GPUs happy
  screenSpaceRadius: false,
};

/** Poisson-denoise parameters for the GTAO buffer. */
const AO_DENOISE = { lumaPhi: 12, depthPhi: 2.5, normalPhi: 3.5, radius: 4, radiusExponent: 1.6, rings: 2, samples: 8 };

/** How strongly the AO is multiplied into the beauty pass (the photo is flat). */
const AO_INTENSITY = 0.55;

/** SSAO fallback parameters (world units, same intent as above). */
const SSAO_PARAMS = { kernelSize: 16, kernelRadius: 0.55, minDistance: 0.0015, maxDistance: 0.06 };

/** `setToneMapping()` name → three constant. */
const TONE = {
  neutral: THREE.NeutralToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  acesfilmic: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  none: THREE.NoToneMapping,
  off: THREE.NoToneMapping,
};

// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the post-processing chain for the factory scene.
 *
 * The returned object owns the composer and the renderer's viewport/scissor
 * state; `main.js` should call `setSize()` on every resize (passing the
 * photo-match rect when it is active) and `render(dt)` once per frame instead
 * of calling `renderer.render()` itself.
 *
 * @param {THREE.WebGLRenderer} renderer  the renderer (already sized).
 * @param {THREE.Scene} scene             the scene to draw.
 * @param {THREE.Camera} camera           the active camera.
 * @returns {{
 *   composer: (import('three/examples/jsm/postprocessing/EffectComposer.js').EffectComposer|null),
 *   passes: {render: ?object, ao: ?object, bloom: ?object, output: ?object, aa: ?object},
 *   aoKind: 'gtao'|'ssao'|'none',
 *   aaKind: 'smaa'|'fxaa'|'none',
 *   active: string[],
 *   render(dt?: number): void,
 *   setSize(w: number, h: number, rect?: ?{x:number,y:number,w:number,h:number}):
 *     ?{x:number,y:number,w:number,h:number},
 *   setSSAO(on: boolean): boolean,
 *   setBloom(on: boolean): boolean,
 *   setToneMapping(name: 'neutral'|'aces'|'agx'|'linear'|string): number,
 *   dispose(): void
 * }}
 */
export function makeComposer(renderer, scene, camera) {
  const q = CFG.quality;

  // ── current framing ───────────────────────────────────────────────────────
  const size = renderer.getSize(new THREE.Vector2());
  let cssW = Math.max(1, Math.round(size.x || 1));
  let cssH = Math.max(1, Math.round(size.y || 1));
  /** Letterbox rect in CSS pixels, y measured from the TOP; null = full canvas. */
  let rect = null;
  let pixelRatio = renderer.getPixelRatio() || 1;

  const passes = { render: null, ao: null, bloom: null, output: null, aa: null };
  const active = [];
  let aoKind = 'none';
  let aaKind = 'none';
  let composer = null;

  try {
    composer = new EffectComposer(renderer);
    composer.renderToScreen = true;
  } catch (err) {
    console.warn('[postfx] EffectComposer unavailable — falling back to direct rendering.', err);
    composer = null;
  }

  /** Construct + append one pass, swallowing any failure. Returns the pass or null. */
  function add(label, make) {
    if (!composer) return null;
    let pass = null;
    try {
      pass = make();
    } catch (err) {
      console.warn(`[postfx] ${label} could not be constructed — continuing without it.`, err);
      return null;
    }
    if (!pass) return null;
    try {
      composer.addPass(pass);
    } catch (err) {
      console.warn(`[postfx] ${label} could not be added to the chain.`, err);
      try {
        if (typeof pass.dispose === 'function') pass.dispose();
      } catch (e) { /* nothing sensible to do */ }
      return null;
    }
    active.push(label);
    return pass;
  }

  /**
   * The AO passes re-render the whole scene (normals + depth). `renderer.render()`
   * would refresh every shadow map a second time per frame, which on a 4096²
   * cascade is brutal — suppress that for the duration of the AO pass only.
   */
  function guardShadowMaps(pass) {
    const inner = pass.render.bind(pass);
    pass.render = function guardedRender(r, writeBuffer, readBuffer, dt, maskActive) {
      const autoUpdate = r.shadowMap.autoUpdate;
      const needsUpdate = r.shadowMap.needsUpdate;
      r.shadowMap.autoUpdate = false;
      r.shadowMap.needsUpdate = false;
      try {
        inner(r, writeBuffer, readBuffer, dt, maskActive);
      } finally {
        r.shadowMap.autoUpdate = autoUpdate;
        r.shadowMap.needsUpdate = needsUpdate;
      }
    };
  }

  // ── the chain ─────────────────────────────────────────────────────────────
  const dw = Math.max(1, Math.round(cssW * pixelRatio));
  const dh = Math.max(1, Math.round(cssH * pixelRatio));

  passes.render = add('RenderPass', () => new RenderPass(scene, camera));

  // 1 · ambient occlusion — GTAO preferred, SSAO as the fallback.
  passes.ao = add('GTAOPass', () => {
    if (typeof GTAOPass !== 'function') return null;
    const p = new GTAOPass(scene, camera, dw, dh, undefined, AO_PARAMS, AO_DENOISE);
    p.output = GTAOPass.OUTPUT.Default;
    p.blendIntensity = AO_INTENSITY;
    p.enabled = q.ssao !== false;
    return p;
  });
  if (passes.ao) {
    aoKind = 'gtao';
  } else {
    passes.ao = add('SSAOPass', () => {
      if (typeof SSAOPass !== 'function') return null;
      const p = new SSAOPass(scene, camera, dw, dh, SSAO_PARAMS.kernelSize);
      p.output = SSAOPass.OUTPUT.Default;
      p.kernelRadius = SSAO_PARAMS.kernelRadius;
      p.minDistance = SSAO_PARAMS.minDistance;
      p.maxDistance = SSAO_PARAMS.maxDistance;
      p.enabled = q.ssao !== false;
      return p;
    });
    if (passes.ao) aoKind = 'ssao';
  }
  if (passes.ao) guardShadowMaps(passes.ao);

  // 2 · bloom — only the blown-out windows and the lamp lenses should catch it.
  passes.bloom = add('UnrealBloomPass', () => {
    const p = new UnrealBloomPass(
      new THREE.Vector2(dw, dh),
      q.bloomStrength ?? 0.22,
      q.bloomRadius ?? 0.6,
      q.bloomThreshold ?? 0.92,
    );
    p.enabled = q.bloom !== false;
    return p;
  });

  // 3 · tone mapping + sRGB. Without this the HDR buffer never gets mapped.
  passes.output = add('OutputPass', () => new OutputPass());
  if (!passes.output) {
    passes.output = add('ShaderPass(GammaCorrection)', () => new ShaderPass(GammaCorrectionShader));
  }

  // 4 · anti-aliasing, last, on LDR data (the renderer runs with antialias:false).
  passes.aa = add('SMAAPass', () => new SMAAPass());
  if (passes.aa) {
    aaKind = 'smaa';
  } else {
    passes.aa = add('FXAAPass', () => new FXAAPass());
    if (passes.aa) aaKind = 'fxaa';
  }

  if (!passes.render) {
    console.warn('[postfx] no RenderPass — the composer is inert, drawing the scene directly.');
  }

  // ── viewport plumbing ─────────────────────────────────────────────────────

  /** Clamp/normalise an incoming rect; returns null when it covers the canvas. */
  function normaliseRect(r) {
    if (!r) return null;
    const w = Math.max(1, Math.round(r.w ?? r.width ?? cssW));
    const h = Math.max(1, Math.round(r.h ?? r.height ?? cssH));
    const x = Math.max(0, Math.round(r.x ?? 0));
    const y = Math.max(0, Math.round(r.y ?? 0));
    if (x === 0 && y === 0 && w >= cssW && h >= cssH) return null; // full frame
    return { x, y, w, h };
  }

  /** Point the renderer at the letterbox rect (GL's origin is bottom-left). */
  function applyViewport() {
    if (rect) {
      const glY = Math.max(0, cssH - (rect.y + rect.h));
      renderer.setViewport(rect.x, glY, rect.w, rect.h);
      renderer.setScissor(rect.x, glY, rect.w, rect.h);
      renderer.setScissorTest(true);
    } else {
      renderer.setViewport(0, 0, cssW, cssH);
      renderer.setScissor(0, 0, cssW, cssH);
      renderer.setScissorTest(false);
    }
  }

  /**
   * Resize the chain.
   * @param {number} width   canvas width in CSS pixels.
   * @param {number} height  canvas height in CSS pixels.
   * @param {?{x:number,y:number,w:number,h:number}} [viewportRect]
   *   the photo-match rect from `camera.resize()` (CSS pixels, y from the top).
   *   Pass null/omit for the full-canvas free-orbit view.
   * @returns {?{x:number,y:number,w:number,h:number}} the rect actually in use.
   */
  function setSize(width, height, viewportRect = null) {
    cssW = Math.max(1, Math.round(width || 1));
    cssH = Math.max(1, Math.round(height || 1));
    rect = normaliseRect(viewportRect);

    const vw = rect ? rect.w : cssW;
    const vh = rect ? rect.h : cssH;
    const pr = renderer.getPixelRatio() || 1;

    if (composer) {
      try {
        if (pr !== pixelRatio) composer.setPixelRatio(pr);
        // EffectComposer.setSize() takes CSS pixels and applies the ratio itself.
        composer.setSize(vw, vh);
      } catch (err) {
        console.warn('[postfx] composer resize failed.', err);
      }
    }
    pixelRatio = pr;
    applyViewport();
    return rect;
  }

  /**
   * Draw one frame.
   * @param {number} [dt] seconds since the previous frame.
   */
  function render(dt = 0) {
    const delta = Number.isFinite(dt) && dt > 0 ? dt : undefined;

    if (rect) {
      // Wipe the whole canvas first so the letterbox bars never hold stale pixels,
      // then clip everything that follows to the photo rect.
      renderer.setRenderTarget(null);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, cssW, cssH);
      renderer.setScissor(0, 0, cssW, cssH);
      renderer.clear(true, true, false);
    }
    applyViewport();

    if (composer && passes.render) {
      composer.render(delta);
    } else {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
  }

  /**
   * Toggle ambient occlusion.
   * @param {boolean} on
   * @returns {boolean} whether AO is now running (false if no AO pass exists).
   */
  function setSSAO(on) {
    if (!passes.ao) return false;
    passes.ao.enabled = !!on;
    return passes.ao.enabled;
  }

  /**
   * Toggle bloom.
   * @param {boolean} on
   * @returns {boolean} whether bloom is now running.
   */
  function setBloom(on) {
    if (!passes.bloom) return false;
    passes.bloom.enabled = !!on;
    return passes.bloom.enabled;
  }

  /**
   * Switch the renderer's tone-mapping operator. `OutputPass` picks the change
   * up on its next frame, so nothing else needs invalidating.
   * @param {'neutral'|'aces'|'agx'|'linear'|string} name
   * @returns {number} the THREE.*ToneMapping constant now in force.
   */
  function setToneMapping(name = 'neutral') {
    const mode = TONE[String(name).toLowerCase()];
    if (mode === undefined) {
      console.warn(`[postfx] unknown tone mapping "${name}" — keeping the current one.`);
      return renderer.toneMapping;
    }
    renderer.toneMapping = mode;
    return mode;
  }

  /** Release every render target, texture and material the chain owns. */
  function dispose() {
    if (composer) {
      for (const p of composer.passes.slice()) {
        try {
          if (typeof p.dispose === 'function') p.dispose();
        } catch (err) {
          console.warn('[postfx] pass dispose failed.', err);
        }
      }
      composer.passes.length = 0;
      try {
        composer.dispose();
      } catch (err) {
        console.warn('[postfx] composer dispose failed.', err);
      }
    }
    composer = null;
    passes.render = null;
    passes.ao = null;
    passes.bloom = null;
    passes.output = null;
    passes.aa = null;
    active.length = 0;
    try {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, cssW, cssH);
      renderer.setScissor(0, 0, cssW, cssH);
    } catch (err) { /* renderer already gone — fine */ }
  }

  // Make sure every pass agrees with the current canvas before the first frame.
  setSize(cssW, cssH, null);

  return {
    get composer() {
      return composer;
    },
    passes,
    aoKind,
    aaKind,
    active,
    render,
    setSize,
    setSSAO,
    setBloom,
    setToneMapping,
    dispose,
  };
}
