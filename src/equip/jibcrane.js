/**
 * equip/jibcrane.js — the orange wall-mounted slewing jib cranes, the right-wall
 * monorail runway, and the chain hoists that hang from both.
 *
 * Reference (img01.jpg, crops B / C / J):
 *
 *  • The jibs are **slim, chalky orange** cranes bolted to the right-wall
 *    pilasters: a modest square-section post between an upper and a lower wall
 *    bracket, a compact cylindrical slewing housing where the boom meets the
 *    post, a slender tapered plate boom whose *top* flange is bleached almost
 *    cream by the daylight and whose *bottom* flange is the trolley rail, a slim
 *    diagonal tie rod back to the post top, a grey festoon rail clamped to the
 *    boom web, and a bright orange power cord dangling off the boom end.
 *    Nothing about them is heavy: even the nearest one, 5 m from the lens, is a
 *    light fabrication that sits *beside* the composition rather than blocking
 *    it, and its paint is dead matte — faded works enamel with no highlight.
 *  • The monorail is a long white I-beam receding down the wall on angled
 *    knee brackets, with a little white festoon C-channel alongside carrying a
 *    long row of flat-cable saddles (the pale tabs strung out along the wall).
 *  • The hoists are orange: trolley → orange body with a grey gearbox on one
 *    side and a motor drum on the other → chain → hook block, plus the orange
 *    chain container bag and a black pendant handset on its own cable.
 *
 * Everything static is collapsed to one mesh per material before it is
 * returned, so a jib crane costs ~10 draw calls instead of ~60.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { CFG, SEED } from '../core/config.js';
import { M, variant } from '../core/materials.js';
import {
  box, cyl, cylX, cylBetween, iBeam, roundedBox, catenary, cable,
  instance, mergeGroup, group, makeRng, rf, boxGeo, cylGeo, V3,
} from '../core/utils.js';

// ────────────────────────────────────────────────────────────────────────────
// Module-local material variants (materials.js is frozen — see CONTRACT rule 6)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The jibs' paint. `M.jibOrange` is a fairly glossy enamel (roughness 0.68,
 * metalness 0.14) which, on a foreground object 5 m from the camera and lit by a
 * blown-out window wall, turns the near jib into a wet-looking plastic column
 * with a broad specular sweep down it. In `img01.jpg` that post is dead matte:
 * chalky, slightly faded works paint with no highlight at all, only a soft
 * lambertian falloff around its corners. So: kill the metalness, push the
 * roughness right up and damp the environment contribution.
 */
const jibPaint = () =>
  variant(
    'jibOrange',
    { roughness: 0.94, metalness: 0.0, envMapIntensity: 0.45 },
    'jibChalkOrange',
  );

/** Sun-bleached cream top flange of a jib boom — reads almost white in the photo. */
const boomTopMat = () =>
  variant('steelWhite', { color: 0xefdcc2, roughness: 0.9, metalness: 0.02 }, 'jibBoomTop');

/** Soft, chalky orange for the fabric chain container. */
const chainBagMat = () =>
  variant('jibOrange', { roughness: 0.95, metalness: 0.0 }, 'jibChainBag');

// ────────────────────────────────────────────────────────────────────────────
// Local geometry helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Flat polygonal plate: a 2-D outline in the XY plane extruded by `thick`
 * along Z and re-centred on Z = 0. Used for the tapered jib boom web/flanges
 * and the root gusset, where a plain box cannot express the taper.
 * Winding is normalised so the outward normals always come out right.
 *
 * @param {Array<[number,number]>} pts  outline, in metres
 * @param {number} thick                extrusion thickness (Z)
 * @param {THREE.Material} material
 * @returns {THREE.Mesh}
 */
function plate(pts, thick, material) {
  let p = pts;
  let area = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    area += p[i][0] * q[1] - q[0] * p[i][1];
  }
  if (area < 0) p = p.slice().reverse();

  const shape = new THREE.Shape();
  shape.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) shape.lineTo(p[i][0], p[i][1]);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  geo.translate(0, 0, -thick / 2);
  geo.computeVertexNormals();

  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Bake a whole sub-assembly down to one merged mesh per material, preserving
 * every child's world transform. Keeps the draw-call budget sane for objects
 * that are repeated four or five times across the hall.
 *
 * @param {THREE.Object3D} root  scratch hierarchy (consumed, not reused)
 * @param {string} name          name for the returned Group
 * @returns {THREE.Group}
 */
function compact(root, name) {
  root.updateMatrixWorld(true);

  /** @type {Map<THREE.Material, THREE.BufferGeometry[]>} */
  const buckets = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
    if (Array.isArray(o.material)) return;

    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const key of Object.keys(g.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') g.deleteAttribute(key);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      g.setAttribute(
        'uv',
        new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2),
      );
    }
    if (!g.index) {
      const n = g.attributes.position.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }

    let arr = buckets.get(o.material);
    if (!arr) {
      arr = [];
      buckets.set(o.material, arr);
    }
    arr.push(g);
  });

  const out = new THREE.Group();
  out.name = name;
  buckets.forEach((geos, mat) => {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) {
      // Should never happen (everything above is indexed with the same
      // attribute set) but never lose geometry over it.
      console.warn(`[jibcrane] merge failed for material "${mat.name}"`);
      geos.forEach((g) => {
        const m = new THREE.Mesh(g, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        out.add(m);
      });
      return;
    }
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    out.add(m);
  });
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Chain hoist
// ────────────────────────────────────────────────────────────────────────────

/**
 * Electric chain hoist on a push trolley — the little orange units parked along
 * the monorail and hanging from every jib boom.
 *
 * Origin is the **top**: (0, 0, 0) sits on the *underside of the beam's bottom
 * flange* (the beam soffit), so `hoist.position.y = CFG.monorail.soffitY` drops
 * it straight onto the runway. Everything hangs below y = 0. The trolley
 * straddles a beam running along **Z**; rotate the group ±90° about Y to hang
 * it from a beam running along X (that is what `buildJibCrane` does).
 *
 * @param {number} dropTo  how far below the origin the hook block hangs, in
 *                         metres (clamped to ≥ 0.35).
 * @param {object} [o]     {seed:number, bag:boolean, pendant:boolean}
 * @returns {THREE.Group} 'chainHoist'
 */
export function buildChainHoist(dropTo = 1.2, o = {}) {
  const { seed = 9031, bag = true, pendant = true } = o;
  const rng = makeRng(seed);
  const drop = Math.max(0.35, Math.abs(dropTo));

  const H = new THREE.Group();

  // ── push trolley riding the bottom flange ────────────────────────────────
  for (const sx of [-1, 1]) {
    H.add(box(0.014, 0.22, 0.27, M.steelDark, sx * 0.10, -0.06, 0));
    for (const sz of [-1, 1]) {
      H.add(cylX(0.030, 0.026, M.steelDark, sx * 0.082, 0.018, sz * 0.088, 10));
    }
  }
  H.add(cylX(0.010, 0.225, M.steelDark, 0, -0.145, 0.095, 6));
  H.add(cylX(0.010, 0.225, M.steelDark, 0, -0.145, -0.095, 6));
  H.add(box(0.21, 0.028, 0.05, M.steelDark, 0, -0.16, 0));
  H.add(cylX(0.018, 0.235, M.steelDark, 0, -0.155, 0, 8));
  H.add(box(0.06, 0.11, 0.075, M.steelDark, 0, -0.205, 0)); // suspension yoke

  // ── hoist body ───────────────────────────────────────────────────────────
  const paint = jibPaint();
  const bodyY = -0.40;
  const body = roundedBox(0.30, 0.23, 0.24, 0.035, paint, 2);
  body.position.set(0, bodyY, 0);
  H.add(body);
  H.add(box(0.055, 0.10, 0.06, M.steelDark, 0, bodyY + 0.16, 0));           // top lug
  H.add(cylX(0.078, 0.17, paint, -0.22, bodyY, 0, 12));                     // motor drum
  H.add(cylX(0.066, 0.022, M.plasticDark, -0.305, bodyY, 0, 12));           // fan cover
  H.add(box(0.11, 0.19, 0.16, M.galv, 0.205, bodyY - 0.01, 0));             // grey gearbox
  H.add(box(0.045, 0.05, 0.09, M.galv, 0.235, bodyY + 0.11, 0));            // limit switch
  H.add(box(0.010, 0.06, 0.11, M.plasticDark, 0, bodyY + 0.02, 0.126));     // nameplate
  H.add(box(0.34, 0.05, 0.07, paint, 0, bodyY - 0.155, 0));                 // chain guide bar

  // ── load chain + hook block ──────────────────────────────────────────────
  const chainX = 0.075;
  const hookTop = -drop;
  const loadChain = new THREE.CatmullRomCurve3([
    V3(chainX, bodyY - 0.17, 0),
    V3(chainX + 0.008, (bodyY - 0.17 + hookTop) * 0.5, 0.005),
    V3(chainX, hookTop + 0.10, 0),
  ]);
  H.add(cable(loadChain, M.chain, 0.012, 12, 5));
  H.add(box(0.078, 0.11, 0.062, M.hoistYellow, chainX, hookTop + 0.05, 0));
  H.add(cyl(0.014, 0.055, M.steelDark, chainX, hookTop - 0.012, 0, 8));
  const hook = new THREE.Mesh(
    new THREE.TorusGeometry(0.042, 0.011, 6, 14, Math.PI * 1.5),
    M.steelDark,
  );
  hook.position.set(chainX, hookTop - 0.072, 0);
  hook.rotation.z = Math.PI * 0.25;
  hook.castShadow = true;
  hook.receiveShadow = true;
  H.add(hook);

  // slack hand chain — a long narrow loop off the far side of the body
  H.add(
    cable(
      catenary(V3(-0.085, bodyY - 0.15, 0.03), V3(-0.085, bodyY - 0.15, -0.03), drop * 0.62, 14),
      M.chain,
      0.008,
      16,
      4,
    ),
  );

  // ── chain container ──────────────────────────────────────────────────────
  if (bag) {
    const bagH = 0.42;
    const sack = new THREE.Mesh(cylGeo(0.078, 0.055, bagH, 10), chainBagMat());
    sack.position.set(-0.02, bodyY - 0.21 - bagH / 2, 0.13);
    sack.rotation.x = -0.07;
    sack.castShadow = true;
    sack.receiveShadow = true;
    H.add(sack);
    H.add(cyl(0.083, 0.035, M.steelDark, -0.02, bodyY - 0.20, 0.13, 10));
  }

  // ── pendant control on its own cable ─────────────────────────────────────
  if (pendant) {
    const px = -0.155 - rf(rng, 0, 0.05);
    const py = -Math.min(drop * 0.74, drop - 0.18);
    const pz = -0.24 - rf(rng, 0, 0.04);
    H.add(
      cable(
        new THREE.CatmullRomCurve3([
          V3(-0.10, bodyY - 0.10, -0.06),
          V3(-0.145, bodyY - 0.52, -0.19),
          V3(px + 0.02, py + 0.28, pz - 0.02),
          V3(px, py, pz),
        ]),
        M.cableBlack,
        0.008,
        18,
        5,
      ),
    );
    H.add(box(0.055, 0.20, 0.045, M.plasticDark, px, py - 0.10, pz));
    H.add(box(0.028, 0.018, 0.008, M.hoistYellow, px, py - 0.055, pz + 0.024));
    H.add(box(0.028, 0.018, 0.008, M.hoistYellow, px, py - 0.10, pz + 0.024));
  }

  return compact(H, 'chainHoist');
}

// ────────────────────────────────────────────────────────────────────────────
// Wall-mounted slewing jib crane
// ────────────────────────────────────────────────────────────────────────────

/**
 * Wall-mounted slewing jib crane, orange (the big one in the bottom-right of
 * the photograph, plus its smaller siblings down the wall).
 *
 * Origin is on the **floor at the wall face**, directly below the post — i.e.
 * `layout` places it at `(6.42, 0, z)` for the right wall. The post rises +Y
 * (its foot bracket is at `postFootY`, well clear of the floor, exactly as in
 * the photo) and the boom projects toward **−X**, into the hall from the RIGHT
 * wall. For the left wall rotate the returned group by π about Y — do not
 * mirror-scale it, that would invert the face winding.
 *
 * @param {object} [o]
 *   @param {number} [o.postTopY=4.25]  top of the post (m above the floor)
 *   @param {number} [o.boomLen=2.55]   boom reach measured from the post axis
 *   @param {number} [o.boomY=3.55]     height of the slew housing / boom axis
 *   @param {number} [o.swing=-0.5]     boom yaw about the post, radians
 *   @param {number} [o.postFootY=0.92] height of the lower wall bracket
 *   @param {number} [o.postSize=0.135] square post section — a modest works post,
 *                                      NOT a column: in the photograph this member
 *                                      is barely wider than the wall pipes beside it
 *   @param {number} [o.hoistAt=0.66]   trolley position as a fraction of boomLen
 *   @param {number} [o.hoistDrop=1.35] hook drop below the boom
 *   @param {boolean}[o.tie=true]       diagonal tie rod back to the post top
 *   @param {number} [o.seed=5150]      deterministic jitter seed
 * @returns {THREE.Group} 'jibCrane'
 */
export function buildJibCrane(o = {}) {
  const {
    postTopY = 4.25,
    boomLen = 2.55,
    boomY = 3.55,
    swing = -0.5,
    postFootY = 0.92,
    postSize = 0.135,
    hoistAt = 0.66,
    hoistDrop = 1.35,
    tie = true,
    seed = 5150,
  } = o;

  const rng = makeRng(seed + Math.round(boomLen * 100) + Math.round(boomY * 10));
  const S = new THREE.Group();
  const paint = jibPaint();

  // The post stands 0.26 m proud of the wall face so the boom clears the
  // pilasters (which project CFG.column.depth = 0.22 m into the hall).
  const postX = -0.26;
  const armX0 = 0.03;                              // at the wall
  const armX1 = postX - postSize * 0.5 - 0.02;     // just past the post
  const armLen = armX0 - armX1;
  const armCx = (armX0 + armX1) * 0.5;

  // ── upper wall bracket ───────────────────────────────────────────────────
  S.add(box(0.05, 0.50, 0.24, M.steelWhiteDark, 0.022, postTopY - 0.26, 0));
  S.add(box(armLen, 0.09, 0.17, paint, armCx, postTopY - 0.07, 0));
  for (const s of [-1, 1]) {
    S.add(
      cylBetween(
        0.017, M.steelDark,
        V3(0.045, postTopY - 0.46, s * 0.072),
        V3(armX1 + 0.07, postTopY - 0.14, s * 0.072),
        8,
      ),
    );
  }

  // ── lower wall bracket ───────────────────────────────────────────────────
  S.add(box(0.05, 0.38, 0.21, M.steelWhiteDark, 0.022, postFootY + 0.13, 0));
  S.add(box(armLen, 0.08, 0.16, paint, armCx, postFootY + 0.045, 0));
  for (const s of [-1, 1]) {
    S.add(
      cylBetween(
        0.016, M.steelDark,
        V3(0.045, postFootY + 0.35, s * 0.065),
        V3(armX1 + 0.06, postFootY + 0.09, s * 0.065),
        8,
      ),
    );
  }

  // holding-down bolts through both wall plates
  for (const y of [postTopY - 0.45, postTopY - 0.08, postFootY + 0.27, postFootY + 0.02]) {
    for (const s of [-1, 1]) S.add(cylX(0.012, 0.045, M.steelDark, 0.055, y, s * 0.082, 6));
  }

  // ── post ─────────────────────────────────────────────────────────────────
  const postH = postTopY - postFootY;
  S.add(box(postSize, postH, postSize, paint, postX, (postTopY + postFootY) * 0.5, 0));
  S.add(cyl(0.060, 0.10, M.steelDark, postX, postFootY + 0.045, 0, 12));  // lower pivot boss
  S.add(cyl(0.056, 0.085, M.steelDark, postX, postTopY - 0.035, 0, 12));  // upper pivot boss

  // ── cylindrical slewing housing ──────────────────────────────────────────
  // Compact: ⌀0.23 over a 0.34 barrel. Back-projecting the housing of the near
  // jib in `img01.jpg` (≈ 16 px across at ≈ 6.3 m) gives ⌀0.27 including its end
  // collars, so the barrel proper has to sit well under a quarter-metre.
  const housH = 0.34;
  S.add(cyl(0.113, housH, paint, postX, boomY, 0, 14));
  S.add(cyl(0.131, 0.032, paint, postX, boomY + housH * 0.5 - 0.016, 0, 14));
  S.add(cyl(0.131, 0.032, paint, postX, boomY - housH * 0.5 + 0.016, 0, 14));
  S.add(cyl(0.119, 0.016, M.steelDark, postX, boomY + 0.09, 0, 14));      // bearing seam
  S.add(cylX(0.010, 0.055, M.steelDark, postX - 0.128, boomY - 0.075, 0, 6)); // grease nipple
  // the little painted capacity plate stuck on the housing
  S.add(box(0.006, 0.055, 0.10, boomTopMat(), postX - 0.116, boomY + 0.01, 0));

  // ── slewing assembly: boom + tie + festoon + hoist ───────────────────────
  const sw = new THREE.Group();
  sw.name = 'jibSwing';
  sw.position.set(postX, boomY, 0);
  sw.rotation.y = swing;
  S.add(sw);

  // Slender plate boom: 0.28 m deep at the root tapering to 0.15 at the tip on a
  // 40 mm web. The old 0.36 × 0.06 section with a 0.17 flange read as a girder
  // off the overhead crane; in `img01.jpg` this member is a light fabrication
  // barely deeper than the hoist hanging under it.
  const rootX = 0.075;     // boom web reaches back inside the housing
  const topRoot = 0.035;   // deep at the wall …
  const topTip = -0.095;   // … shallow at the tip
  const bot = -0.245;      // bottom flange is level: it is the trolley rail
  const webT = 0.040;
  const flangeW = 0.125;

  // tapered web
  sw.add(
    plate(
      [[rootX, topRoot], [-boomLen, topTip], [-boomLen, bot], [rootX, bot]],
      webT, paint,
    ),
  );
  // sloping, sun-bleached top flange
  sw.add(
    plate(
      [
        [rootX, topRoot], [-boomLen, topTip],
        [-boomLen, topTip - 0.018], [rootX, topRoot - 0.018],
      ],
      flangeW, boomTopMat(),
    ),
  );
  // level bottom flange = the running rail
  sw.add(
    box(boomLen + rootX, 0.020, flangeW, paint, (rootX - boomLen) * 0.5, bot - 0.010, 0),
  );
  // root gusset dropping off the housing
  sw.add(plate([[rootX, bot], [rootX, bot - 0.20], [-0.46, bot]], 0.032, paint));
  // upper slew collar the tie rod hangs off
  sw.add(cyl(0.072, 0.10, paint, 0, postTopY - boomY - 0.10, 0, 12));

  // end stops
  sw.add(box(0.05, 0.145, flangeW + 0.015, paint, -boomLen - 0.022, bot + 0.055, 0));
  sw.add(cylX(0.025, 0.038, M.plasticDark, -boomLen - 0.066, bot + 0.055, 0, 8));
  sw.add(box(0.038, 0.10, flangeW, paint, -0.30, bot + 0.04, 0));

  // diagonal tie rod back to the post top
  if (tie) {
    const tieB = V3(-boomLen * 0.52, topRoot + (topTip - topRoot) * 0.52, 0);
    sw.add(cylBetween(0.019, paint, V3(0.0, postTopY - boomY - 0.16, 0), tieB, 8));
    sw.add(box(0.065, 0.075, 0.065, M.steelDark, tieB.x, tieB.y - 0.015, 0));
  }

  // grey festoon rail clamped to the boom web, with flat-cable loops
  const railZ = webT * 0.5 + 0.045;
  sw.add(box(boomLen * 0.94, 0.013, 0.028, M.steelDark, -boomLen * 0.50, -0.045, railZ));
  for (let i = 0; i < 5; i++) {
    const t = 0.10 + i * 0.20;
    sw.add(box(0.022, 0.08, 0.065, M.steelDark, -boomLen * t, -0.012, railZ * 0.62));
  }
  for (let i = 0; i < 4; i++) {
    const xa = -boomLen * (0.12 + i * 0.20);
    const xb = -boomLen * (0.12 + (i + 1) * 0.20);
    sw.add(
      cable(
        catenary(V3(xa, -0.055, railZ), V3(xb, -0.055, railZ), 0.09 + rng() * 0.05, 8),
        M.cableBlack, 0.008, 10, 5,
      ),
    );
  }

  // the bright orange power cord dangling off the boom end
  const cordX = -boomLen * 0.90;
  const cordEndY = -0.98 - rf(rng, 0, 0.12);
  sw.add(
    cable(
      new THREE.CatmullRomCurve3([
        V3(cordX, -0.06, railZ),
        V3(cordX - 0.07, -0.42, railZ + 0.09),
        V3(cordX + 0.03, -0.76, railZ + 0.02),
        V3(cordX + 0.05, cordEndY, railZ + 0.05),
      ]),
      M.coneOrange, 0.011, 22, 5,
    ),
  );
  sw.add(box(0.05, 0.09, 0.042, M.plasticDark, cordX + 0.05, cordEndY - 0.05, railZ + 0.05));

  // ── chain hoist parked out along the boom ────────────────────────────────
  const hoist = buildChainHoist(hoistDrop, { seed: seed + 117 });
  hoist.position.set(-boomLen * hoistAt, bot - 0.020, 0);
  hoist.rotation.y = Math.PI / 2;   // trolley straddles a beam running along X
  sw.add(hoist);

  return compact(S, 'jibCrane');
}

// ────────────────────────────────────────────────────────────────────────────
// Right-wall monorail runway
// ────────────────────────────────────────────────────────────────────────────

/**
 * The right-wall monorail runway: a white I-section beam on angled knee
 * brackets off every pilaster, with the little white festoon C-channel and its
 * long row of flat-cable saddles alongside.
 *
 * Already **world-placed** — it spans `CFG.monorail.zFrom → zTo` at
 * `x = CFG.monorail.x` with its soffit at `CFG.monorail.soffitY`, so `layout`
 * adds it at the world origin. Hoists go on separately with
 * `buildChainHoist()` at `CFG.monorail.hoistZ`.
 *
 * @returns {THREE.Group} 'monorail'
 */
export function buildMonorail() {
  const g = group('monorail');
  const mr = CFG.monorail;
  const rng = makeRng(SEED + 61);

  const zA = Math.max(mr.zFrom, mr.zTo);
  const zB = Math.min(mr.zFrom, mr.zTo);
  const len = zA - zB;
  const midZ = (zA + zB) * 0.5;
  const beamY = mr.soffitY + mr.depth * 0.5;
  const topY = mr.soffitY + mr.depth;

  // ── the beam ─────────────────────────────────────────────────────────────
  const beam = iBeam(mr.depth, 0.16, 0.024, 0.014, len, M.steelWhite);
  beam.position.set(mr.x, beamY, midZ);
  g.add(beam);

  // web stiffeners every 1.8 m, both faces
  const stiff = [];
  for (let z = zA - 1.2; z > zB + 0.6; z -= 1.8) {
    for (const s of [-1, 1]) stiff.push({ pos: [mr.x + s * 0.038, beamY, z] });
  }
  if (stiff.length) g.add(instance(boxGeo(0.062, mr.depth - 0.05, 0.010), M.steelWhite, stiff));

  // ── angled knee brackets off the pilasters ───────────────────────────────
  // Kept below y = 4.55 so they tuck under the crane runway girder at x = 5.6.
  const wallX = CFG.hall.halfWidth - CFG.column.depth;   // pilaster inner face
  const brackets = new THREE.Group();
  const plates = new THREE.Group();
  const armY = mr.soffitY + 0.18;
  const armInner = mr.x + 0.05;
  const armOuter = wallX - 0.04;

  for (const bz of CFG.bay.all()) {
    if (bz > zA - 0.4 || bz < zB + 0.4) continue;
    plates.add(box(0.055, 0.74, 0.26, M.steelWhiteDark, wallX - 0.025, mr.soffitY - 0.02, bz));
    brackets.add(
      box(armOuter - armInner, 0.10, 0.14, M.steelWhite, (armOuter + armInner) * 0.5, armY, bz),
    );
    brackets.add(box(0.09, mr.depth - 0.06, 0.14, M.steelWhite, armInner, beamY, bz));
    brackets.add(
      cylBetween(
        0.028, M.steelWhite,
        V3(wallX - 0.05, mr.soffitY - 0.30, bz),
        V3(armInner + 0.18, armY - 0.02, bz),
        8,
      ),
    );
  }
  if (brackets.children.length) g.add(mergeGroup(brackets, M.steelWhite));
  if (plates.children.length) g.add(mergeGroup(plates, M.steelWhiteDark));

  // ── festoon C-channel alongside, on the hall side of the beam ────────────
  const ftX = mr.x - 0.28;
  const ftY = mr.soffitY + 0.34;
  const track = new THREE.Group();
  track.add(box(0.05, 0.075, len, M.steelWhite, ftX, ftY, midZ));
  track.add(box(0.085, 0.016, len, M.steelWhite, ftX, ftY + 0.046, midZ));
  for (const bz of CFG.bay.all()) {
    if (bz > zA - 0.4 || bz < zB + 0.4) continue;
    track.add(box(mr.x - ftX + 0.02, 0.05, 0.05, M.steelWhite, (mr.x + ftX) * 0.5, topY + 0.02, bz));
    track.add(box(0.05, topY + 0.02 - ftY, 0.05, M.steelWhite, ftX, (topY + 0.02 + ftY) * 0.5, bz));
  }
  g.add(mergeGroup(track, M.steelWhite));

  // flat-cable saddles: the long row of pale tabs strung out along the wall
  const saddles = [];
  const flats = [];
  for (let z = zA - 0.5; z > zB + 0.5; z -= 0.62) {
    saddles.push({ pos: [ftX, ftY - 0.058, z] });
    flats.push({
      pos: [ftX, ftY - 0.165, z],
      rot: [rf(rng, -0.07, 0.07), 0, rf(rng, -0.11, 0.11)],
    });
  }
  g.add(instance(boxGeo(0.055, 0.062, 0.05), M.steelWhiteDark, saddles));
  g.add(instance(boxGeo(0.014, 0.115, 0.30), M.plasticWhite, flats));

  // ── orange buffer stops at both ends ─────────────────────────────────────
  for (const z of [zA - 0.12, zB + 0.12]) {
    g.add(box(0.11, 0.21, 0.09, jibPaint(), mr.x, mr.soffitY + 0.10, z));
  }

  return g;
}
