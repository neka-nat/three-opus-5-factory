/**
 * equip/machines.js — the machine tools standing along the line.
 *
 * Everything here was measured off `img01.jpg` (crops C, H and F):
 *
 *   • the charcoal machining centre behind the hero robot — a stepped slate-grey
 *     mass with a black drive cap on top, a brushed-steel chip-discharge riser,
 *     a big door with a dark window, a black control station, a red/amber/green
 *     andon on a stalk and a low chip conveyor crawling out of its left flank;
 *   • the run of ivory Japanese machine-tool cabinets to its right — soft-topped
 *     cream boxes with a recessed door, a bright yellow label, a dark louvre
 *     panel and a red mushroom button;
 *   • free-standing ivory electrical control cabinets;
 *   • the operator pendant on its black swing arm;
 *   • the old mint-green bench machine (bottom-left of the frame) with the tall
 *     mint control box carrying two columns of green buttons over a red E-stop;
 *   • machines mothballed under translucent vinyl film.
 *
 * ORIGIN / ORIENTATION CONVENTION FOR THIS MODULE
 * -----------------------------------------------
 * Every builder's origin is the centre of its footprint on the floor (y = 0 is
 * the ground it stands on) and its **operator front faces +Z**, i.e. toward the
 * camera — that is how all of these machines present themselves in the
 * photograph. Rotate in `layout.js` if a machine should face elsewhere.
 * (`buildAndon` and `buildOperatorPanel` document their own origins.)
 */
import * as THREE from 'three';
import { M, variant } from '../core/materials.js';
import {
  box, boxOn, cyl, cylX, cylZ, cylBetween, roundedBox, corrugatedTube,
  catenary, cable, group, billboard, makeRng, rf, V3,
} from '../core/utils.js';

// ────────────────────────────────────────────────────────────────────────────
// Module-local material variants.
//
// These are all cloned from *un-mapped* registry keys, so `color` is literal
// rather than a multiplier on a texture. Lazy getters keep `variant()` (and
// therefore the texture canvases) out of module-evaluation time.
// ────────────────────────────────────────────────────────────────────────────
const LM = {
  /** Mid slate grey — the lighter stepped mass of the machining centre. */
  get slate() {
    return variant('cncBlack', { color: 0x5d656c, roughness: 0.44, metalness: 0.28 }, 'cncSlate');
  },
  /** Pale grey inspection panel banding on the CNC covers. */
  get pale() {
    return variant('cncBlack', { color: 0x969da3, roughness: 0.52, metalness: 0.22 }, 'cncPale');
  },
  /** Dim blue-grey LCD of a CNC control / pendant. */
  get lcd() {
    return variant(
      'plasticDark',
      { color: 0x1a2630, emissive: 0x24384a, emissiveIntensity: 0.55, roughness: 0.14 },
      'machineLcd',
    );
  },
  get key() {
    return variant('plasticDark', { color: 0xbcbbb2, roughness: 0.55 }, 'machineKey');
  },
  get btnRed() {
    return variant('plasticDark', { color: 0xc0281c, roughness: 0.3 }, 'btnRed');
  },
  get btnGreen() {
    return variant('plasticDark', { color: 0x2f9d59, roughness: 0.3 }, 'btnGreen');
  },
  get btnGreenDark() {
    return variant('plasticDark', { color: 0x1b6a3d, roughness: 0.32 }, 'btnGreenDk');
  },
  get btnWhite() {
    return variant('plasticDark', { color: 0xd9d6cc, roughness: 0.42 }, 'btnWhite');
  },
  get btnBlack() {
    return variant('plasticDark', { color: 0x18191b, roughness: 0.45 }, 'btnBlack');
  },
  /** The bright yellow adhesive labels stuck on every Japanese machine cabinet. */
  get labelYellow() {
    return variant('binYellow', { color: 0xe7d24c, roughness: 0.45 }, 'labelYellow');
  },
  /** Amber caution banding low on the CNC front. */
  get amber() {
    return variant('coneBand', { color: 0xd8952c, roughness: 0.5 }, 'cautionAmber');
  },
  /** The orange power cable draped over the machining centre. */
  get cableOrange() {
    return variant('cableBlack', { color: 0xa85120, roughness: 0.55 }, 'cableOrange');
  },
  /** Fat grey coolant / swarf hose. */
  get coolantHose() {
    return variant('dressHose', { color: 0x9ba0a2, roughness: 0.72 }, 'coolantHose');
  },
  /** Green printing on the vinyl dust film. */
  get vinylGreen() {
    return variant('vinyl', { color: 0x86cf92, opacity: 0.8 }, 'vinylGreen');
  },
  /** Slightly cooler mint for control-box doors. */
  get mintDoor() {
    return variant('machineMintDark', { color: 0x86b0a0, roughness: 0.6 }, 'mintDoor');
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Private helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * A horizontal stack of louvre slats sunk into a dark recess — every cabinet
 * in the photo has one. Returns a Group whose origin is the recess centre and
 * whose face looks toward +Z.
 */
function louvrePanel(w, h, n, material = M.machineIvoryDark) {
  const g = new THREE.Group();
  g.add(box(w, h, 0.012, M.cncBlack, 0, 0, 0));
  const pitch = h / (n + 0.6);
  for (let i = 0; i < n; i++) {
    g.add(box(w - 0.03, pitch * 0.42, 0.016, material, 0, h / 2 - pitch * (i + 0.7), 0.008));
  }
  return g;
}

/** Small round push-button standing proud of a +Z-facing panel. */
function pushButton(r, material, x, y, z, ringMaterial = null) {
  const g = new THREE.Group();
  if (ringMaterial) g.add(cylZ(r * 1.45, 0.010, ringMaterial, 0, 0, -0.006, 10));
  g.add(cylZ(r, 0.020, material, 0, 0, 0.004, 10));
  g.position.set(x, y, z);
  return g;
}

/** Four levelling feet under a machine footprint. */
function levellingFeet(w, d, material = M.steelDark, h = 0.05) {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(cyl(0.045, h, material, sx * (w / 2 - 0.11), h / 2, sz * (d / 2 - 0.11), 8));
    }
  }
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// 1 · Machining centre
// ────────────────────────────────────────────────────────────────────────────

/**
 * The charcoal CNC machining centre that sits behind the hero robot.
 *
 * Models a stepped sheet-metal enclosure: a black plinth, a deep lower mass, a
 * lighter slate mid mass, a tall column capped by a black drive housing, a
 * brushed-steel chip-discharge riser at the back right, a sliding door with a
 * dark window, a black control station, caution labels, a fat coolant hose,
 * an orange power cable, an andon stack light and a low chip conveyor.
 *
 * Origin: centre of the footprint on the floor. The operator front (door,
 * control station, pendant) faces **+Z**, toward the camera.
 *
 * @param {object} [o]
 * @param {number} [o.w=3.2]            overall width (X)
 * @param {number} [o.h=2.6]            overall height to the column top (Y)
 * @param {number} [o.d=2.4]            overall depth (Z)
 * @param {boolean} [o.andon=true]      put a stack light on the column top
 * @param {boolean} [o.pendant=true]    hang an operator panel off the front
 * @param {boolean} [o.chipConveyor=true] chip conveyor out of the left flank
 * @param {boolean} [o.hose=true]       fat coolant hose + orange power cable
 * @param {number} [o.seed=4101]        rng seed for the scattered labels
 * @returns {THREE.Group} named 'machiningCentre'
 */
export function buildMachiningCentre(o = {}) {
  const {
    w = 3.2, h = 2.6, d = 2.4,
    andon = true, pendant = true, chipConveyor = true, hose = true,
    seed = 4101,
  } = o;
  const rng = makeRng(seed);
  const g = group('machiningCentre');

  const fz = d / 2;                 // the front (+Z) face plane
  const baseH = h * 0.070;          // black plinth
  const lowH = h * 0.596;           // main lower mass
  const lowTop = baseH + lowH;      // ≈ 0.666 h
  const midH = h * 0.238;
  const midTop = lowTop + midH;
  const colH = h - lowTop;

  // ── primary masses ───────────────────────────────────────────────────────
  g.add(boxOn(w - 0.10, baseH, d - 0.08, M.cncBlack, 0, 0));
  g.add(boxOn(w, lowH, d, M.cncCharcoal, 0, baseH));

  const midW = w * 0.56, midD = d * 0.90, midX = -w * 0.21;
  g.add(boxOn(midW, midH, midD, LM.slate, midX, lowTop));
  // pale inspection band across the mid mass front
  g.add(box(midW * 0.86, midH * 0.5, 0.02, LM.pale, midX, lowTop + midH * 0.52, midD / 2 + 0.011));
  g.add(box(midW * 0.30, 0.05, 0.014, M.cncBlack, midX - midW * 0.24, lowTop + midH * 0.22, midD / 2 + 0.01));

  const colW = w * 0.42, colD = d * 0.84, colX = w * 0.27;
  g.add(boxOn(colW, colH, colD, M.cncCharcoal, colX, lowTop));
  // black drive / tool-changer cap on the column top
  g.add(boxOn(colW * 0.32, 0.14, colD * 0.16, M.cncBlack, colX + 0.07, h));
  g.add(cyl(0.125, 0.13, M.cncBlack, colX + 0.07, h + 0.20, 0, 12));
  g.add(cyl(0.145, 0.03, M.cncBlack, colX + 0.07, h + 0.28, 0, 12));

  // brushed-steel chip-discharge riser, back-right, poking above the machine
  const riserX = w * 0.46, riserZ = -d * 0.30, riserH = h * 0.44;
  g.add(boxOn(0.44, riserH, 0.40, M.steelBrushed, riserX, lowTop - 0.18, riserZ));
  g.add(cylZ(0.22, 0.40, M.steelBrushed, riserX, lowTop - 0.18 + riserH, riserZ, 12));

  // ── back side: control gear + coolant tank ───────────────────────────────
  g.add(boxOn(w * 0.52, lowH * 0.78, 0.20, LM.slate, -w * 0.10, baseH + 0.10, -d / 2 - 0.10));
  g.add(boxOn(0.78, 0.52, 0.46, M.machineIvoryDark, w * 0.16, 0, -d / 2 - 0.24));
  g.add(box(0.30, 0.10, 0.02, LM.labelYellow, w * 0.16, 0.40, -d / 2 - 0.47));

  // ── front: sliding door with a dark window ───────────────────────────────
  const doorX = -w * 0.16, doorY = lowTop * 0.60, doorW = w * 0.475, doorH = lowH * 0.80;
  g.add(box(doorW + 0.10, doorH + 0.10, 0.02, M.cncBlack, doorX, doorY, fz - 0.018));
  g.add(box(doorW, doorH, 0.06, M.cncCharcoal, doorX, doorY, fz + 0.018));
  // window
  const winW = doorW * 0.64, winH = doorH * 0.44, winY = doorY + doorH * 0.22;
  g.add(box(winW, winH, 0.02, M.cncBlack, doorX, winY, fz + 0.050));
  const glassQuad = billboard(winW - 0.03, winH - 0.03, M.glass, doorX, winY, fz + 0.066);
  glassQuad.castShadow = false;
  g.add(glassQuad);
  for (const [ox, oy, bw, bh] of [
    [0, winH / 2 + 0.018, winW + 0.05, 0.036],
    [0, -winH / 2 - 0.018, winW + 0.05, 0.036],
    [-winW / 2 - 0.018, 0, 0.036, winH + 0.05],
    [winW / 2 + 0.018, 0, 0.036, winH + 0.05],
  ]) {
    g.add(box(bw, bh, 0.028, M.steelDark, doorX + ox, winY + oy, fz + 0.056));
  }
  // pull handle down the leading edge of the leaf
  g.add(box(0.055, doorH * 0.36, 0.075, M.steelBrushed, doorX + doorW / 2 - 0.09, doorY, fz + 0.062));
  g.add(box(doorW, 0.05, 0.075, M.cncBlack, doorX, doorY - doorH / 2 - 0.02, fz + 0.03));

  // caution graphics on the door / front skirt
  const warn = billboard(0.16, 0.16, M.warningDecal, doorX - doorW * 0.36, doorY - doorH * 0.30, fz + 0.055);
  g.add(warn);
  g.add(billboard(0.15, 0.21, M.paper, doorX + doorW * 0.30, doorY - doorH * 0.26, fz + 0.055));
  g.add(box(0.34, 0.095, 0.012, LM.labelYellow, doorX - doorW * 0.10, baseH + 0.16, fz + 0.012));
  g.add(box(0.44, 0.075, 0.014, LM.amber, colX - 0.14, lowTop + colH * 0.14, colD / 2 + 0.012));

  // ── front: control station on the right of the lower mass ────────────────
  const cx = w * 0.32;
  g.add(box(w * 0.225, lowH * 0.58, 0.07, M.cncBlack, cx, lowTop * 0.66, fz + 0.025));
  g.add(box(w * 0.205, lowH * 0.53, 0.02, LM.slate, cx, lowTop * 0.66, fz + 0.066));
  g.add(box(0.36, 0.26, 0.012, LM.lcd, cx, lowTop * 0.66 + 0.24, fz + 0.080));
  g.add(box(0.40, 0.02, 0.016, M.steelDark, cx, lowTop * 0.66 + 0.095, fz + 0.078));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      g.add(box(0.048, 0.036, 0.010, LM.key,
        cx - 0.17 + c * 0.085, lowTop * 0.66 + 0.03 - r * 0.055, fz + 0.078));
    }
  }
  g.add(pushButton(0.030, LM.btnRed, cx - 0.17, lowTop * 0.66 - 0.22, fz + 0.082, LM.labelYellow));
  g.add(pushButton(0.020, LM.btnGreen, cx - 0.03, lowTop * 0.66 - 0.22, fz + 0.082));
  g.add(pushButton(0.020, LM.btnBlack, cx + 0.05, lowTop * 0.66 - 0.22, fz + 0.082));
  g.add(cylZ(0.034, 0.028, M.plasticDark, cx + 0.16, lowTop * 0.66 - 0.22, fz + 0.086, 10));

  // pale label strips across the column front (they read as bright bars)
  g.add(box(colW * 0.46, 0.10, 0.02, M.steelWhiteDark, colX - 0.06, lowTop + colH * 0.62, colD / 2 + 0.012));
  g.add(box(colW * 0.30, 0.075, 0.02, M.steelWhiteDark, colX - 0.14, lowTop + colH * 0.40, colD / 2 + 0.012));
  g.add(box(colW * 0.55, 0.20, 0.018, M.cncBlack, colX + 0.10, lowTop + colH * 0.30, colD / 2 + 0.010));

  // ── chip conveyor crawling out of the left flank ─────────────────────────
  if (chipConveyor) {
    const cz = d * 0.16;
    g.add(box(0.72, 0.32, 0.44, M.galv, -w / 2 - 0.30, 0.30, cz));
    g.add(box(0.60, 0.02, 0.34, M.cncBlack, -w / 2 - 0.30, 0.465, cz));
    const inc = box(0.95, 0.26, 0.44, M.galv, 0, 0, 0);
    inc.position.set(-w / 2 - 1.06, 0.56, cz);
    inc.rotation.z = -0.52;
    g.add(inc);
    g.add(box(0.20, 0.11, 0.42, M.cncBlack, -w / 2 - 1.50, 0.74, cz - 0.02));
    g.add(cylX(0.085, 0.22, M.cncBlack, -w / 2 - 1.55, 0.88, cz - 0.02, 10));
    g.add(boxOn(0.50, 0.48, 0.50, M.steelWhiteDark, -w / 2 - 1.56, 0, cz - 0.02));
    g.add(box(0.44, 0.03, 0.44, M.cncBlack, -w / 2 - 1.56, 0.47, cz - 0.02));
  }

  // ── coolant hose + orange power cable ────────────────────────────────────
  if (hose) {
    // routed outside the right flank, over the top and down onto the column front
    const hoseCurve = new THREE.CatmullRomCurve3([
      V3(w / 2 + 0.03, 0.42, -d * 0.14),
      V3(w / 2 + 0.12, 1.32, 0.10),
      V3(w / 2 + 0.10, lowTop + 0.37, 0.62),
      V3(w / 2 + 0.02, midTop + 0.07, colD / 2 + 0.02),
      V3(colX + 0.34, midTop + 0.01, colD / 2 + 0.10),
    ]);
    g.add(corrugatedTube(hoseCurve, LM.coolantHose, {
      radius: 0.05, segments: 52, radial: 8, corrugatePeriod: 0.055, corrugateDepth: 0.18,
    }));
    // the orange power cable slung across the front of the covers
    const pwr = catenary(
      V3(colX + 0.30, h - 0.06, colD / 2 + 0.09),
      V3(midX + 0.34, midTop - 0.02, midD / 2 + 0.06),
      0.26, 18,
    );
    g.add(cable(pwr, LM.cableOrange, 0.016, 22, 5));
    g.add(cylBetween(0.012, M.cableBlack,
      V3(cx, lowTop * 0.66 - lowH * 0.30, fz + 0.02), V3(cx + 0.10, 0.12, fz - 0.10), 6));
  }

  // ── andon stack light on the column top ──────────────────────────────────
  if (andon) {
    const a = buildAndon(0.5);
    a.position.set(colX - colW * 0.34, h, colD * 0.22);
    g.add(a);
  }

  // ── operator pendant swung out across the front, facing the aisle ────────
  // (the arm projects +X, so a small negative yaw walks it out toward +Z)
  if (pendant) {
    const p = buildOperatorPanel();
    p.position.set(-w * 0.12, lowTop * 0.86, fz + 0.03);
    p.rotation.y = -0.12;
    g.add(p);
  }

  // a couple of scuffed-on paper job sheets, seeded so they never move
  for (let i = 0; i < 2; i++) {
    g.add(billboard(0.12, 0.17, M.paper,
      rf(rng, -w * 0.42, -w * 0.08), rf(rng, 0.55, 1.05), fz + 0.052));
  }

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// 2 · Generic ivory machine-tool cabinet
// ────────────────────────────────────────────────────────────────────────────

/**
 * The generic Japanese machine-tool box: an ivory sheet-metal cabinet with a
 * softly rounded top cap, a recessed door with a latch, a louvred vent, a kick
 * plinth, a yellow adhesive label and a red mushroom button.
 *
 * Origin: centre of the footprint on the floor; the door faces **+Z**.
 *
 * @param {number} [w=1.4] width (X)
 * @param {number} [h=1.9] height (Y)
 * @param {number} [d=1.1] depth (Z)
 * @param {object} [o]
 * @param {number}  [o.seed=707]     rng seed for the label placement
 * @param {boolean} [o.label=true]   yellow label + taped paper sheet
 * @param {boolean} [o.vents=true]   dark louvre panel low on the door
 * @param {boolean} [o.topBox=false] raised sheet-metal box on the roof
 * @param {boolean} [o.andon=false]  small stack light on the roof
 * @param {string}  [o.bodyKey='machineIvory'] material key for the shell
 * @returns {THREE.Group} named 'machineCabinet'
 */
export function buildMachineCabinet(w = 1.4, h = 1.9, d = 1.1, o = {}) {
  const {
    seed = 707, label = true, vents = true, topBox = false,
    andon = false, bodyKey = 'machineIvory',
  } = o;
  const rng = makeRng(seed);
  const g = group('machineCabinet');
  const body = bodyKey in M ? M[bodyKey] : M.machineIvory;

  const plinthH = Math.min(0.11, h * 0.08);
  const capH = Math.min(0.14, h * 0.09);
  const fz = d / 2;

  g.add(boxOn(w - 0.08, plinthH, d - 0.08, M.machineIvoryDark, 0, 0));
  g.add(boxOn(w, Math.max(0.05, h - plinthH - capH * 0.72), d, body, 0, plinthH));

  // softly rounded top cap — every one of these cabinets has a rolled edge
  const capR = Math.max(0.008, Math.min(0.05, capH / 2 - 0.012, w / 2 - 0.02));
  const cap = roundedBox(w, capH, d, capR, body, 2);
  cap.position.set(0, h - capH / 2, 0);
  g.add(cap);

  // ── recessed door ────────────────────────────────────────────────────────
  const dw = Math.max(0.12, w - 0.11);
  const dh = Math.max(0.14, h - plinthH - capH - 0.13);
  const dy = plinthH + 0.06 + dh / 2;
  g.add(box(dw, dh, 0.012, M.machineIvoryDark, 0, dy, fz - 0.004));
  g.add(box(dw - 0.038, dh - 0.038, 0.024, body, 0, dy, fz + 0.010));

  // latch: a recessed black pocket with a brushed quarter-turn lever
  const hx = dw / 2 - 0.11;
  g.add(box(0.075, 0.20, 0.020, M.cncBlack, hx, dy + 0.04, fz + 0.024));
  g.add(box(0.028, 0.135, 0.030, M.steelBrushed, hx, dy + 0.04, fz + 0.038));
  g.add(cylZ(0.016, 0.024, M.steelDark, hx, dy - 0.14, fz + 0.032, 8));

  // ── louvre vent ──────────────────────────────────────────────────────────
  if (vents) {
    const vw = Math.min(0.34, dw * 0.44);
    const lp = louvrePanel(vw, Math.min(0.32, dh * 0.24), 5);
    lp.position.set(-dw * 0.22, dy - dh * 0.32, fz + 0.026);
    g.add(lp);
  }

  // ── labels, buttons, lamps ───────────────────────────────────────────────
  if (label) {
    g.add(box(Math.min(0.24, dw * 0.28), 0.145, 0.008, LM.labelYellow,
      dw * 0.14, dy + dh * 0.10, fz + 0.026));
    g.add(billboard(0.125, 0.175, M.paper, -dw * 0.30, dy + dh * 0.30, fz + 0.026));
    g.add(box(0.16, 0.03, 0.006, M.plasticWhite, dw * 0.14, dy - dh * 0.02, fz + 0.026));
  }
  g.add(pushButton(0.028, LM.btnRed, dw * 0.30, dy + dh * 0.38, fz + 0.028, LM.labelYellow));
  g.add(pushButton(0.014, M.andonGreen, dw * 0.30 - 0.10, dy + dh * 0.38, fz + 0.028));
  g.add(pushButton(0.014, LM.btnBlack, dw * 0.30 - 0.16, dy + dh * 0.38, fz + 0.028));

  // faint horizontal panel seams on the flanks
  for (const s of [-1, 1]) {
    g.add(box(0.008, 0.012, d - 0.14, M.machineIvoryDark, s * (w / 2 + 0.003), plinthH + dh * 0.62, 0));
  }
  // rear cable entry
  g.add(box(w * 0.42, 0.16, 0.03, M.steelDark, 0, plinthH + 0.10, -d / 2 - 0.014));
  for (let i = 0; i < 3; i++) {
    g.add(cyl(0.018, 0.10, M.steelDark, -w * 0.12 + i * 0.11, plinthH + 0.05, -d / 2 - 0.02, 8));
  }

  if (topBox) {
    g.add(boxOn(w * 0.62, 0.26, d * 0.72, body, -w * 0.10, h));
    g.add(box(w * 0.30, 0.05, 0.012, M.machineIvoryDark, -w * 0.10, h + 0.19, d * 0.36 + 0.006));
  }
  if (andon) {
    const a = buildAndon(0.42);
    a.position.set(w * 0.30, h, d * 0.10);
    g.add(a);
  }

  // a seeded scrap of tape on the flank so no two cabinets read identically
  g.add(box(0.006, 0.05, 0.09, M.plasticWhite,
    (rng() > 0.5 ? 1 : -1) * (w / 2 + 0.004), rf(rng, dy - 0.3, dy + 0.3), rf(rng, -d * 0.2, d * 0.2)));

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// 3 · Free-standing electrical control cabinet
// ────────────────────────────────────────────────────────────────────────────

/**
 * Free-standing electrical control cabinet (the tall thin cream boxes standing
 * between the machines): rain-hood top, kick plinth, single recessed door with
 * a 3-point latch handle, a filter-fan grille, a louvre stack, indicator lamps
 * and lifting eyes.
 *
 * Origin: centre of the footprint on the floor; the door faces **+Z**.
 *
 * @param {number} [w=0.8] width (X)
 * @param {number} [h=1.9] height (Y)
 * @param {number} [d=0.5] depth (Z)
 * @returns {THREE.Group} named 'controlCabinet'
 */
export function buildControlCabinet(w = 0.8, h = 1.9, d = 0.5) {
  const g = group('controlCabinet');
  const plinthH = 0.09;
  const hoodH = 0.035;
  const fz = d / 2;

  g.add(boxOn(w - 0.06, plinthH, d - 0.06, M.machineIvoryDark, 0, 0));
  g.add(boxOn(w, h - plinthH - hoodH, d, M.machineIvory, 0, plinthH));
  g.add(box(w + 0.05, hoodH, d + 0.05, M.machineIvoryDark, 0, h - hoodH / 2, 0));

  // lifting eyes
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(cyl(0.018, 0.05, M.steelDark, sx * (w / 2 - 0.07), h + 0.02, sz * (d / 2 - 0.07), 8));
    }
  }

  // ── door ─────────────────────────────────────────────────────────────────
  const dw = w - 0.07, dh = h - plinthH - hoodH - 0.10;
  const dy = plinthH + 0.05 + dh / 2;
  g.add(box(dw, dh, 0.012, M.machineIvoryDark, 0, dy, fz - 0.004));
  g.add(box(dw - 0.030, dh - 0.030, 0.022, M.machineIvory, 0, dy, fz + 0.009));
  // hinge knuckles on the left edge
  for (let i = 0; i < 3; i++) {
    g.add(cyl(0.014, 0.07, M.steelDark, -dw / 2 + 0.012, dy - dh * 0.35 + i * dh * 0.35, fz + 0.012, 8));
  }
  // 3-point latch: escutcheon plus a swing lever
  const lx = dw / 2 - 0.075;
  g.add(box(0.062, 0.20, 0.020, M.cncBlack, lx, dy + 0.10, fz + 0.022));
  g.add(box(0.026, 0.145, 0.030, M.steelBrushed, lx, dy + 0.10, fz + 0.036));
  g.add(cylZ(0.016, 0.030, M.steelDark, lx, dy - 0.02, fz + 0.032, 8));

  // filter fan grille high on the door, louvre exhaust low down
  const grille = louvrePanel(Math.min(0.20, dw * 0.42), 0.20, 4);
  grille.position.set(-dw * 0.18, dy + dh * 0.30, fz + 0.024);
  g.add(grille);
  const exhaust = louvrePanel(Math.min(0.24, dw * 0.52), 0.22, 5);
  exhaust.position.set(0, dy - dh * 0.34, fz + 0.024);
  g.add(exhaust);

  // indicator lamps + notice plate
  g.add(pushButton(0.013, M.andonGreen, -dw * 0.30, dy + dh * 0.44, fz + 0.026));
  g.add(pushButton(0.013, LM.btnRed, -dw * 0.30 + 0.055, dy + dh * 0.44, fz + 0.026));
  g.add(pushButton(0.013, LM.labelYellow, -dw * 0.30 + 0.110, dy + dh * 0.44, fz + 0.026));
  g.add(billboard(0.11, 0.15, M.paper, dw * 0.16, dy + dh * 0.16, fz + 0.024));
  g.add(box(0.15, 0.055, 0.006, LM.labelYellow, dw * 0.14, dy - dh * 0.06, fz + 0.024));

  // gland plate and conduits at the back
  g.add(box(w - 0.16, 0.12, 0.012, M.steelDark, 0, plinthH + 0.10, -d / 2 - 0.006));
  for (let i = 0; i < 3; i++) {
    g.add(cyl(0.020, 0.12, M.steelDark, -w * 0.16 + i * 0.16, plinthH + 0.05, -d / 2 - 0.02, 8));
  }

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// 4 · Andon stack light
// ────────────────────────────────────────────────────────────────────────────

/**
 * Andon / stack light: red over amber over green on a slim black stalk, exactly
 * as it appears above the machining centre in the photograph.
 *
 * Origin: the **bottom of the pole** (i.e. the mounting face), pole rising +Y.
 *
 * @param {number} [h=0.55] overall height from the mount to the top of the cap
 * @returns {THREE.Group} named 'andon'
 */
export function buildAndon(h = 0.55) {
  const g = group('andon');
  const baseH = Math.min(0.05, h * 0.09);
  // shrink the lens stack if the caller asked for a very short tower, so the
  // finished light is always exactly `h` tall
  const k = Math.min(1, (h - baseH) / 0.36);
  const lensH = 0.082 * k;
  const ringH = 0.008 * k;
  const capH = 0.028 * k;
  const stack = lensH * 3 + ringH * 2 + capH;
  const poleH = Math.max(0.01, h - baseH - stack);

  const rk = Math.max(0.6, k);          // keep short towers from looking spindly
  g.add(cyl(0.048 * rk, baseH, M.cncBlack, 0, baseH / 2, 0, 12));
  g.add(cyl(0.015 * rk, poleH, M.steelDark, 0, baseH + poleH / 2, 0, 10));

  let y = baseH + poleH;
  const lenses = ['andonGreen', 'andonYellow', 'andonRed'];   // green low, red on top
  lenses.forEach((key, i) => {
    const lens = cyl(0.043 * rk, lensH, M[key], 0, y + lensH / 2, 0, 12);
    lens.castShadow = false;
    g.add(lens);
    y += lensH;
    if (i < lenses.length - 1) {
      g.add(cyl(0.047 * rk, ringH, M.cncBlack, 0, y + ringH / 2, 0, 12));
      y += ringH;
    }
  });
  g.add(cyl(0.045 * rk, capH, M.cncBlack, 0, y + capH / 2, 0, 12));

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// 5 · Operator pendant on a swing arm
// ────────────────────────────────────────────────────────────────────────────

/**
 * Pendant HMI on a black articulated swing arm — the light-grey operator panel
 * that hangs off the front of the machining centre.
 *
 * Origin: the **mount point** on the machine (a wall/enclosure face). The arm
 * projects toward **+X** and the pendant head hangs slightly below the mount,
 * its screen looking roughly toward **+Z**.
 *
 * @returns {THREE.Group} named 'operatorPanel'
 */
export function buildOperatorPanel() {
  const g = group('operatorPanel');

  // mounting bracket + first pivot
  g.add(box(0.05, 0.19, 0.15, M.cncBlack, 0.024, 0, 0));
  g.add(cyl(0.045, 0.17, M.cncBlack, 0.062, 0, 0, 10));
  // upper arm
  g.add(cylX(0.030, 0.40, M.cncBlack, 0.062 + 0.20, 0.015, 0, 10));
  // elbow
  g.add(cyl(0.046, 0.13, M.cncBlack, 0.462, 0.0, 0, 10));
  // forearm, dropping and swinging toward +Z
  g.add(cylBetween(0.027, M.cncBlack, V3(0.462, 0.0, 0.0), V3(0.700, -0.055, 0.165), 8));
  g.add(box(0.055, 0.09, 0.075, M.cncBlack, 0.715, -0.070, 0.180));

  // ── pendant head ─────────────────────────────────────────────────────────
  const head = new THREE.Group();
  head.name = 'pendantHead';
  head.position.set(0.760, -0.105, 0.215);
  head.rotation.set(0.16, -0.45, 0);

  head.add(box(0.30, 0.40, 0.075, M.machineIvory, 0, 0, 0));
  head.add(box(0.28, 0.38, 0.014, M.machineIvoryDark, 0, 0, 0.043));
  head.add(box(0.225, 0.150, 0.010, LM.lcd, 0, 0.098, 0.053));
  head.add(box(0.245, 0.012, 0.014, M.steelDark, 0, 0.010, 0.052));
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      head.add(box(0.038, 0.028, 0.008, LM.key, -0.075 + c * 0.050, -0.035 - r * 0.038, 0.052));
    }
  }
  head.add(pushButton(0.024, LM.btnRed, 0.095, -0.155, 0.052, LM.labelYellow));
  head.add(cylZ(0.026, 0.020, M.plasticDark, -0.100, -0.155, 0.054, 10));
  head.add(pushButton(0.011, M.andonGreen, -0.040, -0.158, 0.052));
  head.add(pushButton(0.011, LM.btnBlack, -0.010, -0.158, 0.052));
  head.add(billboard(0.09, 0.03, M.paper, 0, 0.183, 0.045));
  g.add(head);

  // curly cable dropping from the head back to the mount
  const cord = catenary(V3(0.760, -0.300, 0.200), V3(0.090, -0.230, 0.020), 0.26, 18);
  g.add(cable(cord, M.cableBlack, 0.011, 22, 5));

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// 6 · Old mint-green bench machine
// ────────────────────────────────────────────────────────────────────────────

/**
 * The old mint-green bench machine in the bottom-left of the frame: a ribbed
 * mint base with an open, dark mid-section, a cream work table on top, a small
 * mint head, and the tall mint control box on its right end carrying two
 * columns of green buttons over a white label strip and a red E-stop.
 *
 * Origin: centre of the machine footprint on the floor; the ribbed front and
 * the control-box door face **+Z**. The control box sits at the **+X** end.
 *
 * @param {number} [w=1.1]  body width (X), excluding the control box
 * @param {number} [h=1.35] overall height (Y)
 * @param {number} [d=0.8]  body depth (Z)
 * @returns {THREE.Group} named 'mintMachine'
 */
export function buildMintMachine(w = 1.1, h = 1.35, d = 0.8) {
  const g = group('mintMachine');
  const fz = d / 2;

  const plinthH = 0.14;
  const lowH = h * 0.42;
  const lowTop = plinthH + lowH;          // ≈ 0.71
  const openH = h * 0.20;
  const tableY = lowTop + openH;          // ≈ 0.98
  const tableT = 0.055;

  g.add(levellingFeet(w, d, M.machineMintDark, 0.05));
  g.add(boxOn(w, plinthH, d, M.machineMintDark, 0, 0.03));

  // ribbed lower body
  g.add(boxOn(w * 0.94, lowH, d * 0.94, M.machineMint, 0, plinthH));
  for (let i = 0; i < 3; i++) {
    g.add(box(0.05, lowH * 0.78, 0.02, M.machineMintDark,
      -w * 0.28 + i * w * 0.28, plinthH + lowH * 0.5, d * 0.47 + 0.011));
  }
  const sideVent = louvrePanel(d * 0.34, lowH * 0.40, 4, M.machineMint);
  sideVent.position.set(-w * 0.47 - 0.012, plinthH + lowH * 0.52, 0);
  sideVent.rotation.y = -Math.PI / 2;
  g.add(sideVent);

  // open mid section — four mint posts around a dark interior with red guts
  g.add(boxOn(w * 0.86, openH, d * 0.70, M.cncBlack, 0, lowTop));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(boxOn(0.085, openH, 0.085, M.machineMint,
        sx * (w * 0.44), lowTop, sz * (d * 0.42)));
    }
  }
  g.add(boxOn(w * 0.52, openH * 0.5, 0.14, M.extinguisher, -w * 0.06, lowTop + openH * 0.18, d * 0.10));
  g.add(cylX(0.05, w * 0.7, M.steelDark, 0, lowTop + openH * 0.62, -d * 0.14, 10));

  // cream work table
  g.add(box(w + 0.11, tableT, d + 0.09, M.machineIvory, 0, tableY + tableT / 2, 0));
  g.add(box(w + 0.11, 0.018, d + 0.09, M.machineIvoryDark, 0, tableY - 0.006, 0));
  // shallow steel pan sitting on the table (the photo has one full of cables)
  g.add(boxOn(w * 0.46, 0.05, d * 0.42, M.steelWhiteDark, -w * 0.18, tableY + tableT));

  // small mint head above the table on the left, topped by a drive boss
  const headH = h - (tableY + tableT) - 0.10;
  if (headH > 0.06) {
    g.add(boxOn(w * 0.42, headH, d * 0.52, M.machineMint, -w * 0.24, tableY + tableT));
    g.add(cyl(0.075, 0.12, M.machineMintDark, -w * 0.24, h - 0.06, 0, 10));
  }

  // ── the mint control box on the right end ────────────────────────────────
  const cb = new THREE.Group();
  cb.name = 'mintControlBox';
  cb.position.set(w * 0.42, 0, d * 0.26);
  const bw = 0.36, bh = 0.62, bd = 0.20, by = 0.40;
  const bfz = bd / 2;
  cb.add(boxOn(bw, bh, bd, M.machineMint, 0, by));
  cb.add(box(bw - 0.03, bh - 0.05, 0.014, LM.mintDoor, 0, by + bh / 2, bfz + 0.008));
  cb.add(box(0.030, bh - 0.02, 0.050, M.machineMintDark, -bw / 2 + 0.012, by + bh / 2, bfz + 0.010));
  cb.add(box(bw + 0.05, 0.030, bd + 0.05, M.machineMintDark, 0, by + bh + 0.012, 0));
  // support leg down to the machine plinth
  cb.add(boxOn(0.07, by, 0.07, M.machineMintDark, 0, 0, -bd * 0.28));

  // two columns of buttons, four rows — exactly the arrangement in the photo
  const topY = by + bh - 0.10;
  for (let r = 0; r < 4; r++) {
    const y = topY - r * 0.062;
    cb.add(pushButton(0.0135, r === 0 ? LM.btnWhite : LM.btnGreen, -0.062, y, bfz + 0.019));
    cb.add(pushButton(0.0135, LM.btnGreenDark, 0.048, y, bfz + 0.019));
  }
  cb.add(box(0.21, 0.034, 0.006, M.plasticWhite, -0.010, topY - 4 * 0.062 - 0.010, bfz + 0.017));
  cb.add(pushButton(0.024, LM.btnRed, -0.050, by + 0.11, bfz + 0.020, LM.labelYellow));
  cb.add(pushButton(0.012, M.andonGreen, 0.055, by + 0.11, bfz + 0.019));
  cb.add(box(0.11, 0.042, 0.006, LM.labelYellow, 0.052, by + 0.185, bfz + 0.017));
  // conduit disappearing into the machine base
  cb.add(cylBetween(0.018, M.cableBlack, V3(-0.05, by + 0.02, -0.02), V3(-0.30, 0.24, -0.14), 6));
  g.add(cb);

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// 7 · Machine under a vinyl dust sheet
// ────────────────────────────────────────────────────────────────────────────

/**
 * Smooth, continuous pseudo-noise field. Because the displacement is a pure
 * function of *position* (never of vertex index) the shared edge vertices of a
 * BoxGeometry move together, so the wrinkled drape stays watertight.
 */
function noiseField(rng, octaves = 3) {
  const waves = [];
  for (let i = 0; i < octaves; i++) {
    waves.push({
      fx: rf(rng, 1.8, 6.5), fy: rf(rng, 1.2, 5.0), fz: rf(rng, 1.8, 6.5),
      px: rf(rng, 0, Math.PI * 2), py: rf(rng, 0, Math.PI * 2), pz: rf(rng, 0, Math.PI * 2),
      amp: rf(rng, 0.45, 1.0),
    });
  }
  const total = waves.reduce((s, o) => s + o.amp, 0);
  return (x, y, z) => {
    let v = 0;
    for (const o of waves) {
      v += o.amp
        * Math.sin(x * o.fx + o.px)
        * Math.cos(z * o.fz + o.pz)
        * (0.6 + 0.4 * Math.cos(y * o.fy + o.py));
    }
    return v / total;
  };
}

/**
 * A machine mothballed under a loose, translucent vinyl dust sheet — the clear
 * green-printed film bagging the machine to the right of the hero robot.
 *
 * A coarse ivory under-form gives the film something to read against; the film
 * itself is a segmented box whose vertices are displaced by seeded, spatially
 * continuous noise, flared outward at the hem and sagging over the top.
 *
 * Origin: centre of the footprint on the floor; the printed side faces **+Z**.
 *
 * @param {number} [w=2.2] drape width (X)
 * @param {number} [h=1.8] drape height (Y)
 * @param {number} [d=1.6] drape depth (Z)
 * @param {number} [seed=1] deterministic wrinkle seed
 * @returns {THREE.Group} named 'drapedMachine'
 */
export function buildDraped(w = 2.2, h = 1.8, d = 1.6, seed = 1) {
  const g = group('drapedMachine');
  const rng = makeRng(2600 + seed * 17);

  // ── the lump underneath ──────────────────────────────────────────────────
  const uw = w * 0.82, ud = d * 0.80;
  g.add(boxOn(uw, h * 0.55, ud, M.machineIvoryDark, 0, 0));
  g.add(boxOn(uw * 0.6, h * 0.86, ud * 0.7, M.machineIvoryDark, -uw * 0.16, 0));
  g.add(boxOn(uw * 0.3, h * 0.94, ud * 0.4, M.machineIvory, uw * 0.24, 0));

  // ── the film ─────────────────────────────────────────────────────────────
  const geo = new THREE.BoxGeometry(w, h, d, 6, 6, 6);
  geo.translate(0, h / 2, 0);
  const n1 = noiseField(rng, 3);
  const n2 = noiseField(rng, 3);
  const n3 = noiseField(rng, 2);
  const amp = Math.min(w, d) * 0.035;
  const pos = geo.attributes.position;
  const hw = w / 2, hd = d / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = 1 - Math.min(1, Math.max(0, y / h));      // 0 at the top, 1 at the hem
    const flare = 1 + 0.11 * t * t;
    const rx = Math.min(1, Math.abs(x) / hw);
    const rz = Math.min(1, Math.abs(z) / hd);
    let nx = x * flare + n1(x, y, z) * amp * (0.55 + 0.75 * t);
    let nz = z * flare + n2(x, y, z) * amp * (0.55 + 0.75 * t);
    let ny = y
      + n3(x, y, z) * amp * 0.5
      - 0.055 * (y / h) * (1 - rx * rx) * (1 - rz * rz);  // the top sags in the middle
    if (ny < 0.002) ny = 0.002;
    pos.setXYZ(i, nx, ny, nz);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const film = new THREE.Mesh(geo, M.vinyl);
  film.name = 'vinylFilm';
  film.castShadow = false;      // transmissive film should not stamp a hard shadow
  film.receiveShadow = true;
  film.renderOrder = 2;
  g.add(film);

  // green print blocks on the front of the bag (sit just in the film surface)
  const pz = hd * 1.04;
  g.add(box(w * 0.26, 0.085, 0.006, LM.vinylGreen, -w * 0.10, h * 0.68, pz));
  g.add(box(w * 0.16, 0.070, 0.006, LM.vinylGreen, w * 0.14, h * 0.60, pz));
  g.add(box(w * 0.09, 0.055, 0.006, LM.vinylGreen, -w * 0.24, h * 0.52, pz));

  // a strap tied round the hem, and the gathered corner knots
  const sy = h * 0.16;
  for (const [bw2, bh2, bd2, bx, bz] of [
    [w * 1.09, 0.035, 0.014, 0, hd * 1.10],
    [w * 1.09, 0.035, 0.014, 0, -hd * 1.10],
    [0.014, 0.035, d * 1.09, hw * 1.10, 0],
    [0.014, 0.035, d * 1.09, -hw * 1.10, 0],
  ]) {
    g.add(box(bw2, bh2, bd2, M.cableBlack, bx, sy, bz));
  }
  g.add(cyl(0.045, 0.09, M.vinyl, hw * 1.06, 0.05, hd * 1.02, 8));

  return g;
}
