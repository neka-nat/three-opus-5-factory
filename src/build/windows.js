/**
 * windows.js — the two-band glazing of the side walls.
 *
 * What the photograph shows (crops B, E and J):
 *   • Two horizontal ribbons of glass separated by a wide plastered spandrel that
 *     the crane runway girder runs across.
 *   • The LOWER band is the taller one (2.3 → 4.3 m): two tall fixed lights side
 *     by side under a short top-hung awning light.
 *   • The UPPER clerestory band (5.3 → 6.9 m) is a simple two-pane sliding sash.
 *   • The openings are cut in a 0.25 m wall, so every jamb, head and sill shows a
 *     genuinely deep white plaster reveal with a fat projecting sill shelf.
 *   • The glazing itself is COMPLETELY blown out — the windows are the brightest
 *     thing in the frame. They read as flat pure-white rectangles; the only thing
 *     you can see of the joinery is a thin grey aluminium sash silhouetted
 *     against the white, plus the white casing/reveal around it.
 *   • One right-hand lower window has a dark insect screen across its lower half
 *     (crop J, left edge) — it reads as a solid charcoal panel.
 *
 * Everything is emitted directly in WORLD coordinates (like `buildFloor`) and
 * merged down to one mesh per material, so a whole wall of 24 windows costs
 * about seven draw calls.
 */
import * as THREE from 'three';
import { CFG, SEED } from '../core/config.js';
import { M, variant } from '../core/materials.js';
import * as T from '../core/textures.js';
import { box, billboard, cylBetween, group, mergeGroup, makeRng, rf } from '../core/utils.js';

// ────────────────────────────────────────────────────────────────────────────
// Fixed proportions (metres). Anything the config owns is read from CFG.
// ────────────────────────────────────────────────────────────────────────────

/** Plaster return that laps over the edge of the structural opening. */
const REV_T = 0.05;
/** Depth of the reveal sleeve through the 0.25 m wall (protrudes 8 mm inboard). */
const REV_D = 0.268;
/** How far the sill shelf projects into the hall. */
const SILL_PROJ = 0.095;
const SILL_T = 0.055;
/** Grey aluminium glazing bead: in-plane width × depth. */
const SASH_W = 0.030;
const SASH_D = 0.050;
/** Mullion / transom section. */
const MULL_W = 0.044;
const MULL_D = 0.056;
/** Clear height of the short top-hung awning light in the lower band. */
const AWNING_H = 0.42;

/** Bay index (into CFG.bay) whose lower light carries the insect screen. */
const SCREEN_BAY = 4;
/** Bay indices whose awning lights are propped open on a restrictor arm. */
const RESTRICTOR_BAYS = [2, 7];

// Depth offsets measured OUTBOARD from the inner wall face, before `reveal`.
const D_SASH = 0.062;
const D_GLASS = 0.078;
const D_SCREEN = 0.092;
const D_GLOW = 0.106;

// ────────────────────────────────────────────────────────────────────────────
// Module-local materials (materials.js is frozen — build variants here)
// ────────────────────────────────────────────────────────────────────────────

let _sashMat = null;
/**
 * The thin aluminium sash / mullion. Deliberately a mid grey: a white frame
 * would be invisible against the blown-out glass, whereas the photo shows a
 * crisp thin dark line around and across every light.
 */
function sashMaterial() {
  if (!_sashMat) {
    _sashMat = variant(
      'windowFrame',
      { color: 0x9fa5ad, roughness: 0.38, metalness: 0.5 },
      'windowSashGrey',
    );
  }
  return _sashMat;
}

let _screenMat = null;
/** Dark insect screen — fine enough that it mips down to a flat charcoal panel. */
function screenMaterial() {
  if (!_screenMat) {
    const tex = T.screenMesh().clone();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(22, 7);
    tex.needsUpdate = true;
    _screenMat = variant(
      'screenMesh',
      { map: tex, transparent: false, alphaTest: 0.28, color: 0x35383c },
      'windowInsectScreen',
    );
    _screenMat.needsUpdate = true;
  }
  return _screenMat;
}

// ────────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────────

/** Merge a scratch group into one mesh and park it under `parent`. */
function pushMerged(parent, scratch, material, name, cast, receive) {
  if (!scratch.children.length) return;
  const mesh = mergeGroup(scratch, material);
  mesh.name = name;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
}

/**
 * One opening: plaster sleeve + projecting sill + white casing + grey sash +
 * mullions + the blown-out glow quad and its faint glass.
 *
 * @param {object} ctx   accumulator groups and wall constants
 * @param {object} band  CFG.windows.lower | CFG.windows.upper
 * @param {number} zc    centre of the opening along the wall
 * @param {object} o     {panes, screen, restrictor, handle}
 */
function emitWindow(ctx, band, zc, o) {
  const { s, xIn, rev, fw, fd, rng } = ctx;
  const sillY = band.sillY;
  const headY = band.headY;
  const ow = band.width;

  // ── plaster reveal sleeve ────────────────────────────────────────────────
  const xRev = xIn + s * (REV_D / 2 - 0.008);
  const revH = headY - sillY + 0.10;
  const revYc = (sillY + headY) / 2;
  ctx.plaster.add(box(REV_D, revH, REV_T, M.wallPlain, xRev, revYc, zc - ow / 2));
  ctx.plaster.add(box(REV_D, revH, REV_T, M.wallPlain, xRev, revYc, zc + ow / 2));
  ctx.plaster.add(box(REV_D, REV_T, ow + REV_T, M.wallPlain, xRev, headY, zc));

  // Projecting sill shelf — one of the strongest lines on the wall in the photo.
  const sillW = 0.26 + SILL_PROJ;
  ctx.plaster.add(
    box(sillW, SILL_T, ow + 0.16, M.wallPlain,
      xIn + s * ((0.26 - SILL_PROJ) / 2), sillY + 0.012 - SILL_T / 2, zc),
  );
  // thin drip nose under the sill
  ctx.plaster.add(
    box(0.05, 0.028, ow + 0.16, M.wallPlain,
      xIn - s * (SILL_PROJ - 0.025), sillY - 0.055, zc),
  );

  // ── clear opening left once the plaster is in ────────────────────────────
  const cz0 = zc - ow / 2 + REV_T / 2;
  const cz1 = zc + ow / 2 - REV_T / 2;
  const cy0 = sillY + 0.012;
  const cy1 = headY - REV_T / 2;
  const cw = cz1 - cz0;
  const ch = cy1 - cy0;

  // ── white casing (CFG.windows.frameW square section) ─────────────────────
  const xFrame = xIn + s * (rev + fd / 2);
  ctx.frame.add(box(fd, ch, fw, M.windowFrame, xFrame, (cy0 + cy1) / 2, cz0 + fw / 2));
  ctx.frame.add(box(fd, ch, fw, M.windowFrame, xFrame, (cy0 + cy1) / 2, cz1 - fw / 2));
  ctx.frame.add(box(fd, fw, cw - fw * 2, M.windowFrame, xFrame, cy1 - fw / 2, (cz0 + cz1) / 2));
  ctx.frame.add(box(fd, fw, cw - fw * 2, M.windowFrame, xFrame, cy0 + fw / 2, (cz0 + cz1) / 2));

  // ── glazed aperture ──────────────────────────────────────────────────────
  const gz0 = cz0 + fw;
  const gz1 = cz1 - fw;
  const gy0 = cy0 + fw;
  const gy1 = cy1 - fw;
  const gw = gz1 - gz0;
  const gh = gy1 - gy0;
  const gzc = (gz0 + gz1) / 2;
  const gyc = (gy0 + gy1) / 2;

  const xSash = xIn + s * (rev + D_SASH);
  const xGlass = xIn + s * (rev + D_GLASS);
  const xGlow = xIn + s * (rev + D_GLOW);
  const ry = (-s * Math.PI) / 2; // quad normal points into the hall

  // Blown-out daylight (unlit, pure white) then the faint glass just inboard.
  ctx.glow.add(billboard(gw + 0.014, gh + 0.014, M.windowGlow, xGlow, gyc, gzc, ry));
  ctx.glass.add(billboard(gw, gh, M.glass, xGlass, gyc, gzc, ry));

  // ── grey sash bead all round the aperture ────────────────────────────────
  ctx.sash.add(box(SASH_D, gh, SASH_W, sashMaterial(), xSash, gyc, gz0 + SASH_W / 2));
  ctx.sash.add(box(SASH_D, gh, SASH_W, sashMaterial(), xSash, gyc, gz1 - SASH_W / 2));
  ctx.sash.add(box(SASH_D, SASH_W, gw, sashMaterial(), xSash, gy1 - SASH_W / 2, gzc));
  ctx.sash.add(box(SASH_D, SASH_W, gw, sashMaterial(), xSash, gy0 + SASH_W / 2, gzc));

  // ── mullions / transom ───────────────────────────────────────────────────
  let yTransom = gy1;
  if (o.panes >= 3) {
    // short top-hung awning light over two tall fixed lights
    yTransom = gy1 - AWNING_H;
    ctx.sash.add(box(MULL_D, MULL_W, gw, sashMaterial(), xSash, yTransom, gzc));
    ctx.sash.add(
      box(MULL_D, yTransom - gy0, MULL_W, sashMaterial(), xSash, (gy0 + yTransom) / 2, gzc),
    );
  } else {
    ctx.sash.add(box(MULL_D, gh, MULL_W, sashMaterial(), xSash, gyc, gzc));
  }

  // ── hardware ─────────────────────────────────────────────────────────────
  if (o.handle) {
    const hz = gzc + (0.055 + rf(rng, -0.01, 0.01)) * (rng() > 0.5 ? 1 : -1);
    ctx.hard.add(
      box(0.05, 0.078, 0.026, M.steelWhiteDark, xIn + s * (rev + 0.026), gy0 + gh * 0.46, hz),
    );
  }
  if (o.restrictor) {
    // slim stay arm holding the awning light ajar
    const a = new THREE.Vector3(xIn + s * (rev + 0.05), yTransom + 0.03, gzc - gw * 0.28);
    const b = new THREE.Vector3(xIn + s * (rev + 0.135), yTransom + 0.30, gzc - gw * 0.06);
    ctx.hard.add(cylBetween(0.009, M.steelWhiteDark, a, b, 6));
    ctx.hard.add(
      box(0.035, 0.03, 0.05, M.steelWhiteDark, xIn + s * (rev + 0.05), yTransom + 0.02, gzc - gw * 0.28),
    );
  }
  if (o.screen) {
    // dark insect screen over the lower part of the opening (crop J)
    const sh = (yTransom - gy0) * 0.62;
    ctx.screen.add(
      billboard(gw, sh, screenMaterial(), xIn + s * (rev + D_SCREEN), gy0 + sh / 2, gzc, ry),
    );
    // its own thin frame
    const sy1 = gy0 + sh;
    ctx.sash.add(box(0.04, SASH_W, gw, sashMaterial(), xSash, sy1, gzc));
    ctx.sash.add(box(0.04, sh, SASH_W, sashMaterial(), xSash, gy0 + sh / 2, gz0 + SASH_W / 2));
    ctx.sash.add(box(0.04, sh, SASH_W, sashMaterial(), xSash, gy0 + sh / 2, gz1 - SASH_W / 2));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Export
// ────────────────────────────────────────────────────────────────────────────

/**
 * One side wall's glazing: both horizontal bands, one window per bay.
 *
 * The group is emitted **already in world coordinates** (like `buildFloor`), so
 * `layout.js` just adds it at the origin. One opening per bay line, centred on
 * `CFG.bay.z(k)` and `CFG.windows.lower.width` wide — this matches the holes
 * `shell.js` leaves in its glazing bands exactly (it parks its solid piers and
 * pilasters mid-bay instead). The first and last bay lines are skipped, giving
 * 12 openings per band.
 *
 * Fills the holes left by `shell.js` between the sill band (y ≤ 2.3), the
 * spandrel band (4.3 → 5.3) and the head band (y ≥ 6.9), using
 * `CFG.windows.lower` (3 panes) and `CFG.windows.upper` (2 panes).
 *
 * @param {1|-1} side  +1 = right wall (inner face at x = +CFG.hall.halfWidth),
 *                     −1 = left wall. Only the right wall gets the insect
 *                     screen and the awning restrictor arms.
 * @returns {THREE.Group} named 'windows', with `.userData.side` set.
 */
export function buildWindowWall(side = 1) {
  const s = side >= 0 ? 1 : -1;
  const W = CFG.windows;

  const ctx = {
    s,
    xIn: s * CFG.hall.halfWidth,
    rev: W.reveal,
    fw: W.frameW,
    fd: W.frameD,
    rng: makeRng(SEED + (s > 0 ? 1701 : 4104)),
    plaster: new THREE.Group(),
    frame: new THREE.Group(),
    sash: new THREE.Group(),
    hard: new THREE.Group(),
    screen: new THREE.Group(),
    glass: new THREE.Group(),
    glow: new THREE.Group(),
  };

  const kFirst = 1;
  const kLast = Math.max(kFirst, CFG.bay.count - 2);
  for (let k = kFirst; k <= kLast; k++) {
    const zc = CFG.bay.z(k);
    emitWindow(ctx, W.lower, zc, {
      panes: W.lower.panes ?? 3,
      handle: true,
      screen: s > 0 && k === SCREEN_BAY,
      restrictor: s > 0 && RESTRICTOR_BAYS.indexOf(k) >= 0,
    });
    emitWindow(ctx, W.upper, zc, {
      panes: W.upper.panes ?? 2,
      handle: false,
      screen: false,
      restrictor: false,
    });
  }

  const out = group('windows');
  out.userData.side = s;
  pushMerged(out, ctx.plaster, M.wallPlain, 'windowReveals', true, true);
  pushMerged(out, ctx.frame, M.windowFrame, 'windowCasings', true, true);
  pushMerged(out, ctx.sash, sashMaterial(), 'windowSashes', true, true);
  pushMerged(out, ctx.hard, M.steelWhiteDark, 'windowHardware', true, true);
  pushMerged(out, ctx.screen, screenMaterial(), 'windowScreens', false, true);
  pushMerged(out, ctx.glass, M.glass, 'windowGlass', false, false);
  // The glow quads ARE the daylight — they must never cast or receive anything.
  pushMerged(out, ctx.glow, M.windowGlow, 'windowGlow', false, false);
  return out;
}
