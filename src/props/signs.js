/**
 * props/signs.js — every piece of signage in the hall.
 *
 * The texture factories in `core/textures.js` already draw the *graphics*
 * (signExtinguisher, signExit, clockFace, noticePlate, signGirderPanel); this
 * module supplies the *hardware* they are printed on — backing plates, folded
 * returns, standoff screws, hanger straps, suspension rods and wall brackets.
 *
 * Orientation conventions used here (see CONTRACT.md rule 4):
 *   • flat wall signs (消火器, notices, the clock) have their origin ON the wall
 *     face and their plate standing proud of it;
 *   • 消火器 / notices face −X, i.e. they belong on the RIGHT wall — rotate the
 *     group by π in layout.js to hang them on the left wall;
 *   • the clock faces +Z (it reads against the far cross-wall in the photo);
 *   • the 非常口 sign is double-sided across ±Z and hangs off a bracket that
 *     reaches back toward +X (the right wall).
 *
 * Everything here is small, flat and far from the camera, so the whole module
 * costs well under 5 k triangles even with every sign in the scene.
 */
import * as THREE from 'three';
import { PAL } from '../core/config.js';
import * as T from '../core/textures.js';
import { M, variant } from '../core/materials.js';
import {
  billboard,
  box,
  cable,
  catenary,
  cyl,
  cylBetween,
  cylX,
  cylZ,
  group,
  makeRng,
  rf,
  roundedBox,
  shadows,
  V3,
} from '../core/utils.js';

/** Fixed base seed — every wobble in this module is deterministic. */
const SEED = 4711;

/** FNV-1a: turn a label into a stable numeric seed. */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Cached material for a canvas-printed sign plate. Cloned from the frozen
 * `wallPlain` key via `variant()` so nothing in materials.js has to change.
 * @param {string} id      cache id (must be unique per texture)
 * @param {THREE.Texture} map
 * @param {object} [o]     extra material overrides
 */
function plateMat(id, map, o = {}) {
  return variant(
    'wallPlain',
    { map, color: 0xffffff, roughness: 0.62, metalness: 0.04, needsUpdate: true, ...o },
    id,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 消火器 — fire-extinguisher location sign
// ────────────────────────────────────────────────────────────────────────────

/**
 * The red 消火器 fire-point sign: a white header strip over a red field with a
 * big white down-arrow, screwed flat to the wall panel on a folded steel plate.
 * Modelled from crops B / G / J, where the plate stands ~1 cm proud of the wall
 * and is very slightly crooked.
 *
 * Origin is ON the wall face; the plate grows toward −X and the printed face
 * looks down −X (right wall). Rotate by π in layout.js for the left wall.
 *
 * @param {number} w plate width (spans Z when unrotated)
 * @param {number} h plate height (spans Y)
 * @returns {THREE.Group} 'extinguisherSign'
 */
export function buildExtinguisherSign(w = 0.34, h = 0.42) {
  const g = group('extinguisherSign');
  const rng = makeRng(SEED + 1);
  const t = 0.008; // plate thickness
  const bw = w + 0.018; // white margin around the print
  const bh = h + 0.018;

  // folded white backing plate, standing just proud of the wall panel
  g.add(box(t, bh, bw, M.plasticWhite, -t / 2, 0, 0));
  // the plate is folded over its top edge — reads as the white header band
  g.add(box(0.018, 0.005, bw, M.plasticWhite, -0.009, bh / 2 + 0.0025, 0));
  g.add(box(0.012, 0.004, bw, M.plasticWhite, -0.006, -bh / 2 - 0.002, 0));

  // printed face
  g.add(billboard(w, h, M.signExtinguisher, -t - 0.0015, 0, 0, -Math.PI / 2));

  // two pan-head screws through the top corners
  for (const s of [-1, 1]) {
    g.add(cylX(0.005, 0.007, M.steelDark, -t - 0.005, bh * 0.4, s * bw * 0.33, 6));
  }

  g.rotation.x = rf(rng, -0.022, 0.022); // never hung quite straight
  return shadows(g, false, true);
}

// ────────────────────────────────────────────────────────────────────────────
// 非常口 — emergency exit sign
// ────────────────────────────────────────────────────────────────────────────

/**
 * Backlit 非常口 running-man exit sign (誘導灯): a slim white box housing with
 * an emissive graphic on BOTH faces, a wider top cap, two hanger straps and a
 * horizontal bracket arm reaching back to the wall, plus its supply cable.
 * In the photo it hangs just under the runway girder on the right wall and is
 * read from both directions down the aisle — hence the ±Z faces.
 *
 * Origin is the TOP-CENTRE of the sign body: the housing hangs into −Y, the
 * bracket rises above y = 0 and runs toward +X to meet the wall.
 *
 * @param {number} w sign width (X)
 * @param {number} h sign height (Y)
 * @returns {THREE.Group} 'exitSign'
 */
export function buildExitSign(w = 0.4, h = 0.2) {
  const g = group('exitSign');
  const d = 0.05; // housing depth (Z)
  const housing = variant(
    'plasticWhite',
    { emissive: PAL.emissiveLamp, emissiveIntensity: 0.45, roughness: 0.4 },
    'exitHousing',
  );

  // ── housing ──
  const body = roundedBox(w, h, d, 0.016, housing, 2);
  body.position.set(0, -h / 2, 0);
  g.add(body);

  // ── the two printed / emissive faces ──
  const fw = w * 0.9;
  const fh = h * 0.74;
  const fz = d / 2 + 0.01;
  g.add(billboard(fw, fh, M.signExit, 0, -h / 2, fz, 0));
  g.add(billboard(fw, fh, M.signExit, 0, -h / 2, -fz, Math.PI));

  // ── top cap ──
  g.add(box(w * 1.03, 0.016, d + 0.03, M.plasticWhite, 0, 0.008, 0));

  // ── hanger straps up to the bracket arm ──
  for (const s of [-1, 1]) {
    g.add(box(0.026, 0.15, 0.006, M.steelWhiteDark, s * w * 0.3, 0.09, 0));
  }

  // ── bracket arm running back to the wall (+X) ──
  const armX0 = -w * 0.36;
  const armX1 = w * 0.5 + 0.15; // reaches the wall face when hung 0.35 m off it
  g.add(box(armX1 - armX0, 0.03, 0.03, M.steelWhiteDark, (armX0 + armX1) / 2, 0.17, 0));
  g.add(box(0.012, 0.17, 0.11, M.steelWhiteDark, armX1 + 0.006, 0.12, 0));
  g.add(cylBetween(0.007, M.steelWhiteDark, V3(armX1, 0.05, 0), V3(armX0 + 0.06, 0.157, 0), 6));

  // ── supply cable drooping from the wall plate into the housing ──
  g.add(
    cable(
      catenary(V3(armX1 - 0.01, 0.135, 0.03), V3(w * 0.2, 0.005, 0.02), 0.045, 10),
      M.cableBlack,
      0.006,
      12,
      5,
    ),
  );

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Analogue wall clock
// ────────────────────────────────────────────────────────────────────────────

/**
 * The round white analogue wall clock high on the far wall (crop A): a shallow
 * cylindrical case, a printed dial and a slim proud bezel ring.
 *
 * Origin is ON the wall face at the clock centre; the case grows toward +Z and
 * the dial faces +Z. Rotate in layout.js for any other wall.
 *
 * @param {number} r dial radius
 * @returns {THREE.Group} 'wallClock'
 */
export function buildWallClock(r = 0.22) {
  const g = group('wallClock');
  const caseD = 0.052;

  // case
  g.add(cylZ(r * 0.98, caseD, M.plasticWhite, 0, 0, caseD / 2, 24));

  // dial — CircleGeometry UVs map the canvas square straight onto the disc
  const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.955, 28), M.clockFace);
  face.position.z = caseD + 0.0012;
  face.receiveShadow = true;
  g.add(face);

  // bezel ring standing proud of the dial
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(r * 0.975, 0.009, 5, 26), M.steelWhiteDark);
  bezel.position.z = caseD;
  g.add(bezel);

  return shadows(g, false, true);
}

// ────────────────────────────────────────────────────────────────────────────
// Small notice plaques
// ────────────────────────────────────────────────────────────────────────────

/**
 * A small notice / equipment nameplate screwed to a wall or a machine — the
 * little white plaques scattered over the right wall and the steel doors.
 *
 * Origin is ON the wall face; the plate grows toward −X and reads down −X.
 * Rotate by π in layout.js for the left wall.
 *
 * @param {number} w plate width (spans Z when unrotated)
 * @param {number} h plate height (spans Y)
 * @param {string} title heading printed on the plate (also seeds its wobble)
 * @returns {THREE.Group} 'notice'
 */
export function buildNotice(w = 0.3, h = 0.21, title = '注意') {
  const g = group('notice');
  const rng = makeRng(SEED + hashSeed(title));
  const lines = 2 + Math.floor(rng() * 3);
  const t = 0.005;
  const mat = plateMat(`noticePlate-${title}-${lines}`, T.noticePlate(title, lines), {
    side: THREE.DoubleSide,
    roughness: 0.7,
  });

  g.add(box(t, h + 0.01, w + 0.01, M.plasticWhite, -t / 2, 0, 0));
  g.add(billboard(w, h, mat, -t - 0.0015, 0, 0, -Math.PI / 2));

  // four small screws
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(
        cylX(0.0035, 0.006, M.steelDark, -t - 0.004, sy * (h / 2 - 0.016), sz * (w / 2 - 0.016), 6),
      );
    }
  }

  g.rotation.x = rf(rng, -0.03, 0.03);
  return shadows(g, false, true);
}

// ────────────────────────────────────────────────────────────────────────────
// Hanging aisle sign board
// ────────────────────────────────────────────────────────────────────────────

/**
 * A double-sided aisle sign board hung from the roof services on two threaded
 * suspension rods: ivory panel, aluminium edge capping, a green header band and
 * a printed notice panel on each face.
 *
 * Origin is the CENTRE OF THE BOARD; the two rods rise 0.9 m above it and end
 * in small fixing plates, so layout.js positions the board itself.
 *
 * @param {number} w board width (X)
 * @param {number} h board height (Y)
 * @returns {THREE.Group} 'hangingSign'
 */
export function buildHangingSign(w = 0.9, h = 0.3) {
  const g = group('hangingSign');
  const t = 0.024; // board thickness
  const rodLen = 0.9;
  const rodX = w * 0.34;

  // ── board ──
  g.add(box(w, h, t, M.machineIvory));
  g.add(box(w + 0.016, 0.024, t + 0.008, M.aluPlain, 0, h / 2 - 0.012, 0));
  g.add(box(w + 0.016, 0.024, t + 0.008, M.aluPlain, 0, -h / 2 + 0.012, 0));
  for (const s of [-1, 1]) {
    g.add(box(0.02, h, t + 0.006, M.aluPlain, s * (w / 2 - 0.01), 0, 0));
  }

  // ── green header band (the same green as the shutter headers) ──
  const hb = h * 0.26;
  const hbY = h / 2 - 0.026 - hb / 2;
  g.add(box(w - 0.05, hb, t + 0.005, M.shutterHeader, 0, hbY, 0));

  // ── printed panel on each face, kept at the texture's natural aspect ──
  const ph = h - hb - 0.075;
  const pw = ph * 1.42;
  const py = hbY - hb / 2 - 0.018 - ph / 2;
  const mat = plateMat('hangingSignFace', T.noticePlate('通　路', 2), {
    side: THREE.DoubleSide,
    roughness: 0.66,
  });
  g.add(billboard(pw, ph, mat, 0, py, t / 2 + 0.003, 0));
  g.add(billboard(pw, ph, mat, 0, py, -t / 2 - 0.003, Math.PI));

  // ── two suspension rods with their eye brackets and fixing plates ──
  for (const s of [-1, 1]) {
    g.add(box(0.03, 0.05, 0.03, M.steelWhiteDark, s * rodX, h / 2 + 0.018, 0));
    g.add(cyl(0.008, rodLen, M.steelWhiteDark, s * rodX, h / 2 + 0.04 + rodLen / 2, 0, 8));
    g.add(box(0.07, 0.008, 0.07, M.steelWhiteDark, s * rodX, h / 2 + 0.044 + rodLen, 0));
  }

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// 安全第一 crane-girder panels
// ────────────────────────────────────────────────────────────────────────────

/**
 * The row of five white 安 / 全 / [green cross] / 第 / 一 plates bolted to the
 * camera-facing web of the orange crane girder (crops A and G). Each plate is a
 * square sheet standing a few millimetres proud, with a barely-there mounting
 * wobble.
 *
 * Origin is the CENTRE of the row, ON the girder web; the plates grow toward +Z
 * and read down +Z.
 *
 * @param {number} span distance between the first and last plate centres
 * @param {number} size plate edge length
 * @returns {THREE.Group} 'safetyPanels'
 */
export function buildSafetyPanels(span = 4.0, size = 0.28) {
  const g = group('safetyPanels');
  const rng = makeRng(SEED + 5);
  const chars = ['安', '全', 'cross', '第', '一'];
  const t = 0.004;
  const pitch = span / (chars.length - 1);

  chars.forEach((ch, i) => {
    const mat = plateMat(`girderPanel-${ch}`, T.signGirderPanel(ch), { roughness: 0.58 });
    const p = box(size, size, t, mat, (i - (chars.length - 1) / 2) * pitch, 0, t / 2);
    p.rotation.z = rf(rng, -0.012, 0.012);
    p.castShadow = false;
    g.add(p);
  });

  return g;
}
