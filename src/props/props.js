/**
 * props.js — every small loose object on the factory floor.
 *
 * These are the things that make the photograph read as a *working* shop rather
 * than a CAD model: the orange cones roped off with a striped bar down the left
 * aisle, the timber pallet under the big pale packing case, the taped kraft
 * cartons, the red extinguisher standing in its red pan, the pale-teal spiral
 * hose reel bolted to the right wall, the plywood board of orange helmets with
 * coiled cables heaped in the tray beneath it, and the silver ring blower
 * beside the conveyor with its fat white corrugated hose looping over the top.
 *
 * Conventions (CONTRACT.md §4):
 *   • every builder returns a THREE.Object3D with `.name` set and never adds
 *     itself to the scene — layout.js does the placing;
 *   • the local origin is the **centre of the footprint on the floor** (y = 0 is
 *     the surface the prop stands on) and the prop faces **−Z**, *except* for
 *     `buildHoseReel()` and `buildHelmetRack()`, which are wall-mounted: their
 *     origin sits on the wall face and they project along −X (right wall) and
 *     +X (left wall) respectively;
 *   • all variation comes from `makeRng(seed)` so the scene is byte-identical
 *     on every reload.
 */
import * as THREE from 'three';
import { M, variant, tinted } from '../core/materials.js';
import * as T from '../core/textures.js';
import {
  box,
  boxOn,
  cyl,
  cylX,
  cylZ,
  cylBetween,
  corrugatedTube,
  catenary,
  cable,
  group,
  billboard,
  cylGeo,
  mergeGroup,
  makeRng,
  rf,
  ri,
} from '../core/utils.js';

// ────────────────────────────────────────────────────────────────────────────
// Private helpers
// ────────────────────────────────────────────────────────────────────────────

const HALF = Math.PI / 2;
const V2 = (x, y) => new THREE.Vector2(x, y);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Mesh with the project's default shadow flags. */
function mesh(geo, material) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Surface of revolution about +Y from a Vector2 profile (x = radius, y = height). */
function lathe(profile, material, seg = 18) {
  return mesh(new THREE.LatheGeometry(profile, seg), material);
}

/**
 * Torus ring, optionally a partial arc. `axis` picks the ring's normal:
 * 'z' (default — lies in XY), 'x' (lies in YZ: reel discs seen side-on),
 * 'y' (lies in XZ: a ring lying flat on the floor).
 */
function ring(R, tube, material, axis = 'z', radial = 6, tubular = 20, arc = Math.PI * 2) {
  const m = mesh(new THREE.TorusGeometry(R, tube, radial, tubular, arc), material);
  if (axis === 'x') m.rotation.y = HALF;
  else if (axis === 'y') m.rotation.x = HALF;
  return m;
}

/** Open-ended tube about +Y — collars, label sleeves, rolled drum hoops. */
function sleeve(r, h, material, x = 0, y = 0, z = 0, seg = 16) {
  const m = mesh(cylGeo(r, r, h, seg, true), material);
  m.position.set(x, y, z);
  return m;
}

/** Add `child` to `parent` after positioning it, and return the child. */
function put(parent, child, x = 0, y = 0, z = 0) {
  child.position.set(x, y, z);
  parent.add(child);
  return child;
}

/** Accept a THREE.Vector3 or a plain [x, y, z] triple. */
function v3(p) {
  if (p && p.isVector3) return p.clone();
  if (Array.isArray(p)) return V(p[0] || 0, p[1] || 0, p[2] || 0);
  return V(0, 0, 0);
}

/** Merge a scratch group of same-material meshes into one mesh (draw-call diet). */
function fuse(children, material, name) {
  const tmp = new THREE.Group();
  children.forEach((c) => tmp.add(c));
  const m = mergeGroup(tmp, material);
  m.name = name;
  return m;
}

// ── module-local texture / material derivations ─────────────────────────────
// materials.js is frozen, so anything it does not already provide is derived
// here with `variant()` / `tinted()`. Both register the result in the shared
// material cache, so these still pick up the PMREM environment map.

const _tex = new Map();

/** A repeat-tiled clone of a shared texture (the shared one must never be mutated). */
function tiled(base, ru, rv, key) {
  let t = _tex.get(key);
  if (!t) {
    t = base.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(ru, rv);
    t.needsUpdate = true;
    _tex.set(key, t);
  }
  return t;
}

/** Yellow/black hazard striping tiled `ru × rv` — cone bars and bollards. */
function stripeMat(ru, rv, angle = 45) {
  const key = `hz${angle}_${ru}x${rv}`;
  return variant('hazardTape', { map: tiled(T.hazardStripe(angle), ru, rv, key), needsUpdate: true }, key);
}

/** Punched-steel sheet with the hole pattern tiled `ru × rv`. */
function perfMat(ru, rv) {
  const key = `perf${ru}x${rv}`;
  return variant('perforated', { alphaMap: tiled(T.perforatedAlpha(), ru, rv, key), needsUpdate: true }, key);
}

/** A printed sheet with different body copy than the shared `M.paper`. */
function paperMat(seed) {
  return variant('paper', { map: T.paperSheet(seed), needsUpdate: true }, `sheet${seed}`);
}

const MAT = {
  /** Pale packing tape over the kraft flaps. */
  get tape() {
    return variant('plasticWhite', { color: 0xd8cdb2, roughness: 0.58, metalness: 0 }, 'boxTape');
  },
  /** Four shades of used cardboard so a stack is never uniform. */
  cardShade(i) {
    return tinted('cardboard', [0xffffff, 0xe6ddd0, 0xd2c7b6, 0xf2ece2][((i % 4) + 4) % 4]);
  },
  /** Greyed pallet/batten timber next to the fresher deck boards. */
  get woodDark() {
    return tinted('wood', 0xd0c4b0);
  },
  /** Rubbery grey of the hose wound on the reel. */
  get reelHose() {
    return variant('rubberBlack', { color: 0x585f5c, roughness: 0.86 }, 'reelHose');
  },
  /** Slightly deeper teal for the reel rim, spokes and guide arm. */
  get reelDark() {
    return tinted('hoseReel', 0xd2d8d5);
  },
  get brass() {
    return variant('steelDark', { color: 0xa98b46, roughness: 0.36, metalness: 0.85 }, 'brass');
  },
  /** Light machined aluminium of the ring blower's volute and motor. */
  get blowerAlu() {
    return variant('aluPlain', { color: 0xdadcd8, roughness: 0.52, metalness: 0.6 }, 'blowerAlu');
  },
  /** Backlit laptop panel. */
  get screen() {
    return variant(
      'plasticDark',
      { color: 0x1b2027, emissive: 0x3d566f, emissiveIntensity: 0.55, roughness: 0.16 },
      'laptopScreen',
    );
  },
  /** Cut edges of a paper ream — off-white, no printing. */
  get paperEdge() {
    return variant('plasticWhite', { color: 0xf7f4ec, roughness: 0.94, metalness: 0 }, 'paperEdge');
  },
  /** A lighter fold catching the light on the navy tarpaulin. */
  get tarpLight() {
    return tinted('tarpBlue', 0xa8b6d8);
  },
  /** The extinguisher's pan and shoulder band, a shade deeper than the bottle. */
  get extDark() {
    return tinted('extinguisher', 0xd8d4d4);
  },
};

/**
 * Radially displace a geometry with a cheap deterministic noise field so it
 * reads as crumpled fabric. The displacement is a pure function of position, so
 * duplicated seam vertices stay welded.
 */
function crumple(geo, rng, amp, freq = 5.2) {
  const pos = geo.attributes.position;
  const p0 = rng() * 10;
  const p1 = rng() * 10;
  const p2 = rng() * 10;
  const v = V(0, 0, 0);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n =
      Math.sin(v.x * freq + p0) * Math.cos(v.z * freq * 1.31 + p1) +
      0.55 * Math.sin(v.y * freq * 1.7 + p2) * Math.sin(v.x * freq * 0.83 + p0);
    v.multiplyScalar(1 + n * amp);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  return geo;
}

// ────────────────────────────────────────────────────────────────────────────
// Cones, bars, bollards
// ────────────────────────────────────────────────────────────────────────────

/**
 * JIS traffic cone: safety-orange body, two yellow reflective bands and a heavy
 * black square rubber base — the cones roping off the left aisle in the photo.
 * Origin at the centre of the base on the floor, faces −Z. Merged down to three
 * meshes because half a dozen of them are in frame.
 *
 * @param {number} h Overall height including the base (default 0.7 m).
 * @returns {THREE.Group} `userData.tipY` = height of the tip, for `buildConeBar()`.
 */
export function buildTrafficCone(h = 0.7) {
  const g = group('trafficCone');
  const baseH = 0.03;
  const bw = h * 0.5; // ≈ 0.35 m square base for a 0.7 m cone
  const rBot = h * 0.185;
  const rTop = h * 0.022;
  const coneH = h - baseH;
  const rAt = (t) => rBot + (rTop - rBot) * t;

  // heavy black base: a thin plate with a slightly proud kerb on top
  g.add(fuse(
    [boxOn(bw, baseH * 0.55, bw, M.rubberBlack), boxOn(bw * 0.86, baseH, bw * 0.86, M.rubberBlack)],
    M.rubberBlack,
    'coneBase',
  ));

  // orange body + flared skirt + moulded tip
  const body = mesh(cylGeo(rTop, rBot, coneH, 14), M.coneOrange);
  body.position.y = baseH + coneH / 2;
  const skirt = mesh(cylGeo(rBot, rBot * 1.16, coneH * 0.06, 14), M.coneOrange);
  skirt.position.y = baseH + coneH * 0.03;
  const tip = cyl(rTop * 1.5, coneH * 0.035, M.coneOrange, 0, baseH + coneH * 0.985, 0, 10);
  g.add(fuse([body, skirt, tip], M.coneOrange, 'coneBody'));

  // two yellow bands, radii interpolated so they hug the taper
  const bands = [];
  for (const [t0, t1] of [[0.44, 0.56], [0.70, 0.79]]) {
    const b = mesh(cylGeo(rAt(t1) + 0.004, rAt(t0) + 0.004, coneH * (t1 - t0), 14), M.coneBand);
    b.position.y = baseH + coneH * (t0 + t1) * 0.5;
    bands.push(b);
  }
  g.add(fuse(bands, M.coneBand, 'coneBands'));

  g.userData.tipY = h;
  return g;
}

/**
 * The yellow/black striped bar slung between two cones. Origin on the floor at
 * the centre of the run; the bar lies along **X** at `userData.barY` with a
 * little sag, and each end drops a moulded orange cap over a cone tip. The end
 * caps are sized for the default 0.7 m `buildTrafficCone()`.
 *
 * @param {number} len Centre-to-centre span between the two cones (m).
 * @returns {THREE.Group}
 */
export function buildConeBar(len = 1.6) {
  const g = group('coneBar');
  const y = 0.62;
  const half = len / 2;

  const curve = catenary(V(-half, y, 0), V(half, y, 0), 0.035, 10);
  const pole = cable(curve, stripeMat(Math.max(4, Math.round(len * 5)), 1), 0.019, 26, 8);
  pole.receiveShadow = true;
  g.add(pole);

  for (const s of [-1, 1]) {
    const hook = group('coneBarHook');
    hook.add(box(0.05, 0.046, 0.042, M.coneOrange));
    // open cap slipped over the cone tip: the 0.7 m cone tapers 0.036 → 0.018
    // across the y 0.60–0.69 band this sleeve covers.
    put(hook, mesh(cylGeo(0.022, 0.036, 0.085, 10, true), M.coneOrange), 0, 0.0285, 0);
    hook.position.set(s * half, y - 0.006, 0);
    g.add(hook);
  }

  g.userData.barY = y;
  return g;
}

/**
 * Yellow/black striped bollard post on a weighted rubber foot, with a white
 * reflective collar near the top. Origin on the floor at the post centre.
 *
 * @param {number} h Overall height (default 0.9 m).
 * @returns {THREE.Group}
 */
export function buildBollard(h = 0.9) {
  const g = group('bollard');

  // weighted rubber foot
  put(g, mesh(cylGeo(0.155, 0.185, 0.04, 16), M.rubberBlack), 0, 0.02, 0);
  g.add(cyl(0.135, 0.022, M.rubberBlack, 0, 0.05, 0, 16));

  // striped post
  const postH = h - 0.075;
  const post = mesh(cylGeo(0.042, 0.048, postH, 12), stripeMat(2, Math.max(3, Math.round(h * 5.5))));
  post.position.y = 0.06 + postH / 2;
  g.add(post);

  // reflective collar, yellow cap ring and dome
  g.add(sleeve(0.0458, 0.065, M.plasticWhite, 0, h - 0.19, 0, 12));
  g.add(cyl(0.044, 0.02, M.coneBand, 0, h - 0.045, 0, 12));
  put(g, mesh(new THREE.SphereGeometry(0.043, 12, 6, 0, Math.PI * 2, 0, HALF), M.coneBand), 0, h - 0.036, 0);

  // chain eye
  put(g, ring(0.018, 0.005, M.steelDark, 'z', 5, 10), 0, h - 0.13, 0.05);
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Timber, cardboard and crates
// ────────────────────────────────────────────────────────────────────────────

/**
 * Nine-block JIS timber pallet (1100 × 1100 by default): bottom deck and
 * bearers running along X, top deck boards running along Z. Origin at the
 * centre of the footprint on the floor. Merged to one mesh.
 *
 * @param {number} w Width along X.
 * @param {number} d Depth along Z.
 * @returns {THREE.Group} `userData.deckY` = top surface of the deck boards.
 */
export function buildPallet(w = 1.1, d = 1.1) {
  const parts = [];
  const bt = 0.019; // board thickness
  const blockH = 0.088;
  const inset = 0.05;
  const zs = [-(d / 2 - inset), 0, d / 2 - inset];
  const xs = [-(w / 2 - inset), 0, w / 2 - inset];

  for (const z of zs) parts.push(boxOn(w, bt, 0.1, M.wood, 0, 0, z)); // bottom deck
  for (const x of xs) for (const z of zs) parts.push(boxOn(0.1, blockH, 0.1, M.wood, x, bt, z)); // blocks

  const bearerY = bt + blockH;
  for (const z of zs) parts.push(boxOn(w, bt, 0.1, M.wood, 0, bearerY, z)); // bearers

  const deckY = bearerY + bt;
  const n = 6;
  const bw = 0.115;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + bw / 2 + (i * (w - bw)) / (n - 1);
    parts.push(boxOn(bw, bt, d, M.wood, x, deckY, 0)); // top deck
  }

  const g = group('pallet');
  g.add(fuse(parts, M.wood, 'palletTimber'));
  g.userData.deckY = deckY + bt;
  return g;
}

/**
 * A taped kraft carton with a shipping label and a stencilled handling mark.
 * Origin at the centre of the footprint on the floor.
 *
 * @param {number} w Width (X).
 * @param {number} h Height (Y).
 * @param {number} d Depth (Z).
 * @param {number} seed Seeded variation: tint, tape run, label placement.
 * @returns {THREE.Group}
 */
export function buildCardboardBox(w = 0.5, h = 0.36, d = 0.4, seed = 1) {
  const rng = makeRng(seed * 7919 + 13);
  const g = group('cardboardBox');

  const body = boxOn(w, h, d, MAT.cardShade(ri(rng, 0, 3)));
  body.rotation.y = rf(rng, -0.02, 0.02);
  g.add(body);

  // top-flap seam plus the packing tape running over it and down both ends
  g.add(box(w * 1.002, 0.004, 0.006, MAT.cardShade(2), 0, h - 0.002, 0));
  const tapeW = rf(rng, 0.055, 0.075);
  g.add(box(tapeW, 0.0035, d * 1.004, MAT.tape, rf(rng, -0.03, 0.03), h + 0.001, 0));
  for (const s of [-1, 1]) g.add(box(tapeW, 0.09, 0.0035, MAT.tape, 0, h - 0.045, s * (d / 2 + 0.002)));

  if (rng() > 0.15) {
    const lw = Math.min(0.19, w * 0.42);
    g.add(billboard(lw, lw * 0.72, paperMat(ri(rng, 1, 4)),
      rf(rng, -w * 0.16, w * 0.16), h * rf(rng, 0.45, 0.62), d / 2 + 0.003));
  }
  if (rng() > 0.55) {
    g.add(box(0.09, 0.016, 0.002, M.robotRed, w * 0.22, h * 0.72, d / 2 + 0.003));
  }
  return g;
}

/**
 * An irregular stack of cartons — different sizes, each rotated and offset a
 * little, sometimes with a loose flat of cardboard leaning against it. Origin
 * at the centre of the footprint on the floor.
 *
 * @param {number} seed Seeded arrangement.
 * @param {number} n Number of boxes in the stack.
 * @returns {THREE.Group}
 */
export function buildBoxStack(seed = 1, n = 4) {
  const rng = makeRng(seed * 104729 + 7);
  const g = group('boxStack');
  let y = 0;
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    const w = rf(rng, 0.34, 0.62) * (1 - t * 0.18);
    const d = rf(rng, 0.3, 0.54) * (1 - t * 0.18);
    const h = rf(rng, 0.2, 0.38);
    const b = buildCardboardBox(w, h, d, seed * 31 + i);
    b.position.set(rf(rng, -0.07, 0.07), y, rf(rng, -0.06, 0.06));
    b.rotation.y = rf(rng, -0.24, 0.24);
    g.add(b);
    y += h - 0.004;
  }
  if (rng() > 0.5) {
    const lean = box(0.5, 0.62, 0.006, MAT.cardShade(1));
    lean.position.set(rf(rng, -0.3, 0.3), 0.315, rf(rng, 0.28, 0.38));
    lean.rotation.set(0.22, rf(rng, -0.4, 0.4), 0);
    g.add(lean);
  }
  return g;
}

/**
 * Plywood packing case: ply panels on a timber batten frame, sitting on
 * integral skids and stencilled with a docket. This is the big pale block
 * mid-left of the photograph. Origin at the centre of the footprint, faces −Z.
 *
 * @param {number} w Width (X).
 * @param {number} h Height (Y).
 * @param {number} d Depth (Z).
 * @returns {THREE.Group}
 */
export function buildWoodCrate(w = 1.2, h = 0.9, d = 0.9) {
  const g = group('woodCrate');
  const t = 0.018; // ply thickness
  const b = 0.052; // batten section
  const skid = 0.085;
  const bodyH = h - skid;
  const wallH = bodyH - t;

  for (const z of [-(d / 2 - 0.07), 0, d / 2 - 0.07]) g.add(boxOn(w, skid, 0.11, M.wood, 0, 0, z));
  g.add(boxOn(w, t, d, M.plywood, 0, skid, 0));

  const y0 = skid + t;
  const yMid = y0 + wallH / 2;
  g.add(box(w, wallH, t, M.plywood, 0, yMid, -(d / 2 - t / 2)));
  g.add(box(w, wallH, t, M.plywood, 0, yMid, d / 2 - t / 2));
  g.add(box(t, wallH, d - t * 2, M.plywood, -(w / 2 - t / 2), yMid, 0));
  g.add(box(t, wallH, d - t * 2, M.plywood, w / 2 - t / 2, yMid, 0));
  g.add(boxOn(w, t, d, M.plywood, 0, h - t, 0));

  // corner battens, top rails and a mid rail on each long face
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.add(boxOn(b, wallH, b, MAT.woodDark, sx * (w / 2 - b / 2), y0, sz * (d / 2 - b / 2)));
    }
    g.add(box(b * 0.7, b * 0.7, d - b, MAT.woodDark, sx * (w / 2 - b * 0.35), h - t - b * 0.4, 0));
  }
  for (const sz of [-1, 1]) {
    g.add(box(w - b, b * 0.7, b * 0.7, MAT.woodDark, 0, h - t - b * 0.4, sz * (d / 2 - b * 0.3)));
    g.add(box(w - b, b * 0.7, b * 0.7, MAT.woodDark, 0, y0 + wallH * 0.45, sz * (d / 2 - b * 0.3)));
  }

  // stencils
  g.add(billboard(0.2, 0.145, paperMat(2), -w * 0.2, y0 + wallH * 0.62, d / 2 + 0.004));
  g.add(box(0.1, 0.018, 0.002, M.robotRed, w * 0.16, y0 + wallH * 0.72, d / 2 + 0.004));
  g.add(box(0.07, 0.018, 0.002, M.robotRed, w * 0.16, y0 + wallH * 0.64, d / 2 + 0.004));
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Plastic bins
// ────────────────────────────────────────────────────────────────────────────

/**
 * Open-top plastic tote with outward-leaning walls, a rim lip and grip pockets:
 * the yellow one bottom-right of frame, the blue one on the right-hand
 * workbench, the red ones on the parts shelves. Origin at the centre of the
 * footprint; `w`/`d` are measured at mid height.
 *
 * @param {number} w Width (X) at mid height.
 * @param {number} d Depth (Z) at mid height.
 * @param {number} h Height.
 * @param {string} colorKey Material key: 'binRed' | 'binYellow' | 'binBlue' | 'binBlack' | …
 * @returns {THREE.Group}
 */
export function buildPlasticBin(w = 0.5, d = 0.35, h = 0.22, colorKey = 'binRed') {
  const g = group('plasticBin');
  const mat = M[colorKey];
  const taper = 0.13; // radians the walls lean outward
  const t = 0.011;
  const lean = Math.tan(taper) * h;

  g.add(boxOn(w - lean, t, d - lean, mat)); // floor pan

  for (const s of [-1, 1]) {
    const wz = box(w + lean * 0.5, h, t, mat, 0, h / 2, s * (d / 2));
    wz.rotation.x = s * taper; // top edge leans outward in ±Z
    g.add(wz);
    const wx = box(t, h, d + lean * 0.5, mat, s * (w / 2), h / 2, 0);
    wx.rotation.z = -s * taper; // top edge leans outward in ±X
    g.add(wx);
  }

  // rim lip
  const rw = w + lean + 0.02;
  const rd = d + lean + 0.02;
  g.add(box(rw, 0.016, 0.024, mat, 0, h - 0.006, rd / 2));
  g.add(box(rw, 0.016, 0.024, mat, 0, h - 0.006, -rd / 2));
  g.add(box(0.024, 0.016, rd, mat, rw / 2, h - 0.006, 0));
  g.add(box(0.024, 0.016, rd, mat, -rw / 2, h - 0.006, 0));

  // moulded grip pockets on the short ends
  for (const s of [-1, 1]) {
    g.add(box(0.012, 0.05, 0.11, tinted(colorKey, 0xcfcfcf), s * (w / 2 + lean * 0.4), h * 0.68, 0));
  }
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Fire protection
// ────────────────────────────────────────────────────────────────────────────

/**
 * 10 kg powder extinguisher standing in its red circular floor pan, with the
 * slim red location post rising behind it. Origin at the centre of the pan on
 * the floor; the valve lever and discharge horn face −Z.
 *
 * @returns {THREE.Group}
 */
export function buildFireExtinguisher() {
  const g = group('fireExtinguisher');

  // ── red circular stand ──
  g.add(cyl(0.175, 0.018, MAT.extDark, 0, 0.009, 0, 24));
  put(g, ring(0.172, 0.017, M.extinguisher, 'y', 6, 24), 0, 0.018, 0);

  // ── bottle ──
  g.add(lathe([
    V2(0.0, 0.036),
    V2(0.062, 0.036),
    V2(0.072, 0.052),
    V2(0.072, 0.4),
    V2(0.069, 0.424),
    V2(0.056, 0.462),
    V2(0.036, 0.496),
    V2(0.024, 0.512),
    V2(0.024, 0.542),
  ], M.extinguisher, 18));
  g.add(sleeve(0.0742, 0.145, M.paper, 0, 0.235, 0, 18)); // printed label band
  g.add(sleeve(0.0744, 0.014, MAT.extDark, 0, 0.318, 0, 18));

  // ── valve head ──
  g.add(cyl(0.026, 0.03, M.galv, 0, 0.556, 0, 12));
  g.add(box(0.055, 0.03, 0.05, M.galv, 0, 0.578, 0));
  const lever = box(0.024, 0.011, 0.1, M.steelDark, 0, 0.6, -0.03);
  lever.rotation.x = -0.13;
  g.add(lever);
  g.add(box(0.024, 0.009, 0.085, M.steelDark, 0, 0.566, -0.028));
  const gauge = cyl(0.017, 0.012, M.galv, 0.034, 0.583, -0.014, 12);
  gauge.rotation.z = HALF;
  g.add(gauge);
  const dial = cyl(0.013, 0.002, M.plasticWhite, 0.042, 0.583, -0.014, 12);
  dial.rotation.z = HALF;
  g.add(dial);
  put(g, ring(0.014, 0.0035, M.coneBand, 'z', 5, 10), -0.04, 0.586, 0); // safety pin ring

  // ── discharge hose + horn ──
  g.add(cable(new THREE.CatmullRomCurve3([
    V(0.0, 0.572, -0.045),
    V(0.03, 0.53, -0.105),
    V(0.055, 0.4, -0.115),
    V(0.05, 0.27, -0.095),
    V(0.028, 0.19, -0.088),
  ]), M.rubberBlack, 0.011, 26, 6));
  const horn = mesh(cylGeo(0.03, 0.016, 0.075, 12), M.plasticDark);
  horn.position.set(0.026, 0.155, -0.086);
  horn.rotation.x = 0.25;
  g.add(horn);

  // ── red location post behind the bottle ──
  const postH = 1.34;
  g.add(cyl(0.011, postH, M.extinguisher, 0, postH / 2 + 0.018, 0.13, 8));
  g.add(cyl(0.03, 0.012, MAT.extDark, 0, 0.026, 0.13, 12));
  g.add(box(0.075, 0.115, 0.006, M.extinguisher, 0, postH - 0.03, 0.13));
  g.add(box(0.05, 0.012, 0.002, M.plasticWhite, 0, postH + 0.006, 0.126));
  g.add(box(0.03, 0.045, 0.002, M.plasticWhite, 0, postH - 0.055, 0.126));

  return g;
}

/**
 * Wall-mounted spiral air-hose reel — the pale-teal one above the right-hand
 * workbench. **Origin is on the wall face** at the reel's axis centre; the reel
 * projects toward **−X** (right wall). Mirror in layout for the left wall.
 *
 * @param {number} r Outer radius of the reel discs.
 * @returns {THREE.Group}
 */
export function buildHoseReel(r = 0.42) {
  const g = group('hoseReel');
  const xBack = -0.13;
  const xFront = -0.31;
  const xMid = (xBack + xFront) / 2;

  // wall plate + bracket
  g.add(box(0.035, 0.3, 0.3, M.steelWhiteDark, -0.017, 0, 0));
  for (const s of [-1, 1]) g.add(box(0.115, 0.05, 0.014, MAT.reelDark, -0.09, s * 0.085, 0));
  g.add(cylX(0.05, 0.26, MAT.reelDark, -0.16, 0, 0, 12));

  // back disc, front rim + spokes, hub barrel
  g.add(cylX(r * 0.97, 0.014, M.hoseReel, xBack, 0, 0, 28));
  put(g, ring(r * 0.97, 0.019, MAT.reelDark, 'x', 6, 28), xFront, 0, 0);
  for (let i = 0; i < 4; i++) {
    const spoke = box(0.012, r * 0.94, 0.022, MAT.reelDark, xFront, 0, 0);
    spoke.rotation.x = (i / 4) * Math.PI * 2 + 0.4;
    g.add(spoke);
  }
  g.add(cylX(r * 0.3, 0.19, MAT.reelDark, xMid, 0, 0, 16));

  // the wound spiral: an Archimedean spiral in the YZ plane that also drifts
  // across the drum width, so it reads as several wound layers.
  const turns = 6.5;
  const steps = 190;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const rad = r * (0.34 + 0.58 * t);
    pts.push(V(xMid + Math.sin(t * Math.PI * 3) * 0.055, Math.cos(a) * rad, Math.sin(a) * rad));
  }
  g.add(cable(new THREE.CatmullRomCurve3(pts), MAT.reelHose, 0.019, 190, 6));

  // curved guide arm sweeping around the front — very prominent in the photo
  const arm = ring(r * 1.02, 0.016, M.hoseReel, 'x', 6, 22, Math.PI * 1.05);
  arm.position.set(xFront - 0.04, 0, 0);
  arm.rotation.x = -0.9;
  g.add(arm);
  g.add(cylBetween(0.014, M.hoseReel, V(xFront - 0.04, 0, 0), V(xFront - 0.04, r * 1.02, 0), 8));

  // feed pipe from the wall into the hub
  g.add(cylX(0.02, 0.1, M.steelDark, -0.055, 0, 0, 10));
  g.add(cyl(0.018, 0.09, M.steelDark, -0.09, -0.05, 0, 10));

  // hose tail hanging out of the bottom with a nozzle
  g.add(cable(new THREE.CatmullRomCurve3([
    V(xMid, -r * 0.92, 0.02),
    V(xFront - 0.06, -r * 1.08, 0.09),
    V(xFront - 0.02, -r * 1.24, 0.03),
    V(xFront + 0.02, -r * 1.34, -0.03),
  ]), MAT.reelHose, 0.017, 26, 6));
  const nozzle = mesh(cylGeo(0.014, 0.022, 0.085, 10), M.steelDark);
  nozzle.position.set(xFront + 0.03, -r * 1.42, -0.05);
  nozzle.rotation.x = -0.35;
  g.add(nozzle);

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Helmets, coils, hoses
// ────────────────────────────────────────────────────────────────────────────

/** One orange bump-cap, dome pointing +X. Private. */
function helmet(rng) {
  const h = group('helmet');
  const R = 0.132;
  const dome = mesh(new THREE.SphereGeometry(R, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), M.helmetOrange);
  dome.scale.set(1, 0.84, 1); // flatten along the local axis, before rotation
  dome.rotation.z = -HALF; // local +Y pole → world +X
  h.add(dome);
  put(h, ring(R * 0.96, 0.011, M.helmetOrange, 'x', 5, 16), -0.026, 0, 0); // brim
  h.add(box(R * 0.78, 0.014, 0.012, tinted('helmetOrange', 0xdcdcdc), R * 0.4, 0, 0)); // crest rib
  put(h, ring(R * 0.7, 0.006, M.plasticDark, 'x', 4, 14), -0.05, 0, 0); // chin strap
  h.rotation.z = rf(rng, -0.1, 0.1);
  h.rotation.y = rf(rng, -0.14, 0.14);
  return h;
}

/**
 * The plywood wall board carrying the row of orange helmets, with the tangle of
 * coiled black cables heaped in the tray beneath it. **Origin is on the wall
 * face at the centre of the board**; everything projects toward **+X** (left
 * wall). Mirror in layout for the right wall.
 *
 * @param {number} n How many helmets hang on it (the hook rails are always full).
 * @returns {THREE.Group}
 */
export function buildHelmetRack(n = 6) {
  const rng = makeRng(4471);
  const g = group('helmetRack');
  const bw = 1.45; // board width, along Z
  const bh = 1.12; // board height, along Y
  const bt = 0.028; // board thickness, along X

  // board sits on the wall face, so it occupies x ∈ [0, bt]
  g.add(box(bt, bh, bw, M.plywood, bt / 2, 0, 0));
  g.add(box(bt * 0.6, 0.03, bw, MAT.woodDark, bt + 0.008, bh / 2 - 0.015, 0));
  g.add(box(bt * 0.6, 0.03, bw, MAT.woodDark, bt + 0.008, -bh / 2 + 0.015, 0));

  // two black hook rails, eight hooks each — merged to one mesh per rail
  const hooks = 8;
  const rows = [0.2, -0.19];
  const railX = bt + 0.015;
  const hookZ = [];
  rows.forEach((ry, rowIdx) => {
    const parts = [box(0.03, 0.042, bw * 0.94, M.plasticDark, railX, ry, 0)];
    const zs = [];
    for (let i = 0; i < hooks; i++) {
      const z = -bw * 0.42 + (i * bw * 0.84) / (hooks - 1);
      zs.push(z);
      parts.push(box(0.055, 0.014, 0.02, M.plasticDark, railX + 0.043, ry - 0.012, z));
      parts.push(box(0.014, 0.036, 0.02, M.plasticDark, railX + 0.064, ry + 0.004, z));
    }
    hookZ[rowIdx] = zs;
    g.add(fuse(parts, M.plasticDark, `hookRail${rowIdx}`));
  });

  // three on the top rail, two on the second, bunched with gaps — as photographed
  const order = [[0, 1], [0, 2], [0, 3], [1, 1], [1, 4], [0, 5], [1, 2], [0, 6], [1, 6], [0, 0]];
  for (let i = 0; i < Math.min(n, order.length); i++) {
    const [row, idx] = order[i];
    const hm = helmet(rng);
    hm.position.set(railX + 0.088, rows[row] + 0.098, hookZ[row][idx]);
    g.add(hm);
  }

  // tray of coiled cables under the bottom rail
  const trayY = -bh / 2 + 0.1;
  const trayX = 0.18;
  g.add(box(0.32, 0.022, bw * 0.66, M.plasticWhite, trayX, trayY, 0));
  for (const s of [-1, 1]) {
    g.add(box(0.32, 0.05, 0.016, M.plasticWhite, trayX, trayY + 0.03, s * bw * 0.33));
    g.add(cylBetween(0.012, M.steelWhiteDark,
      V(bt, trayY - 0.02, s * bw * 0.26), V(trayX + 0.15, trayY + 0.01, s * bw * 0.26), 6));
  }
  g.add(box(0.016, 0.05, bw * 0.66, M.plasticWhite, trayX + 0.16, trayY + 0.03, 0));
  for (let i = 0; i < 3; i++) {
    const coil = buildCableCoil(rf(rng, 0.1, 0.14));
    coil.rotation.y = rf(rng, -0.5, 0.5);
    coil.position.set(trayX - 0.01, trayY + 0.014, -0.31 + i * 0.31);
    g.add(coil);
  }
  // a few loose ends spilling over the tray lip
  g.add(cable(new THREE.CatmullRomCurve3([
    V(trayX + 0.12, trayY + 0.03, -0.12),
    V(trayX + 0.2, trayY - 0.01, 0.02),
    V(trayX + 0.13, trayY - 0.12, 0.12),
    V(trayX + 0.05, trayY - 0.2, 0.06),
  ]), M.cableBlack, 0.011, 22, 5));

  return g;
}

/**
 * A loosely coiled electrical cable — used both loose on the floor and heaped
 * in the helmet-rack tray. Origin at the centre of the coil on the floor; the
 * coil lies flat in the XZ plane.
 *
 * @param {number} r Nominal coil radius.
 * @returns {THREE.Group}
 */
export function buildCableCoil(r = 0.28) {
  const rng = makeRng(Math.round(r * 1000) + 617);
  const g = group('cableCoil');

  // tube resolution scales with the coil's size so the small ones stay cheap
  const strand = (turns, rad, thick, mat, yBase, phase) => {
    const steps = Math.max(28, Math.round(turns * 10 + rad * 180));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = t * turns * Math.PI * 2 + phase;
      const rr = rad * (0.86 + 0.16 * Math.sin(a * 0.7 + phase) + 0.06 * Math.sin(a * 3.1));
      const y = yBase + thick + Math.abs(Math.sin(a * 0.5 + phase)) * thick * 2.4;
      pts.push(V(Math.cos(a) * rr, y, Math.sin(a) * rr));
    }
    return cable(new THREE.CatmullRomCurve3(pts), mat, thick, Math.min(120, steps * 2), 5);
  };

  const t0 = Math.min(0.0135, r * 0.06);
  g.add(strand(4.2, r, t0, M.cableBlack, 0.002, rf(rng, 0, 3)));
  if (r > 0.13) g.add(strand(3.1, r * 0.74, t0 * 0.82, M.cableBlack, 0.02, rf(rng, 0, 3)));
  if (r > 0.2 && rng() > 0.35) {
    g.add(strand(2.4, r * 0.9, t0 * 0.68, tinted('cableBlack', 0xd8908c), 0.034, rf(rng, 0, 3)));
  }

  const tie = box(0.014, 0.05, 0.055, M.plasticDark, r * 0.86, 0.03, 0);
  tie.rotation.y = rf(rng, -0.5, 0.5);
  g.add(tie);
  return g;
}

/**
 * Corrugated flexible hose sagging between two arbitrary points, with a moulded
 * cuff at each end. The returned group sits at its parent's origin; the hose
 * already runs between `from` and `to` in that parent's space.
 *
 * @param {THREE.Vector3|number[]} from Start point.
 * @param {THREE.Vector3|number[]} to End point.
 * @param {number} r Hose radius.
 * @param {number} sag Vertical drop of the mid-point below the chord.
 * @returns {THREE.Group}
 */
export function buildFlexHose(from, to, r = 0.06, sag = 0.35) {
  const g = group('flexHose');
  const a = v3(from);
  const b = v3(to);
  const span = Math.max(0.05, a.distanceTo(b));
  const curve = catenary(a, b, sag, Math.max(10, Math.min(40, Math.round(span * 8))));
  const segments = Math.max(28, Math.min(150, Math.round((span + sag) * 46)));

  g.add(corrugatedTube(curve, M.dressHose, {
    radius: r,
    segments,
    radial: 10,
    corrugate: true,
    corrugatePeriod: Math.max(0.022, r * 0.62),
    corrugateDepth: 0.24,
  }));

  const t0 = curve.getTangent(0).multiplyScalar(0.055);
  const t1 = curve.getTangent(1).multiplyScalar(0.055);
  g.add(cylBetween(r * 1.16, M.plasticWhite, a.clone().addScaledVector(t0, -0.2), a.clone().add(t0), 10));
  g.add(cylBetween(r * 1.16, M.plasticWhite, b.clone().addScaledVector(t1, 0.2), b.clone().sub(t1), 10));
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Ring blower
// ────────────────────────────────────────────────────────────────────────────

/**
 * Side-channel ("ring") blower: the silver snail-shell volute, the finned motor
 * behind it, the silencer cartridges slung underneath and the fat white
 * corrugated hose arcing over the top — it sits beside the conveyor at
 * x ≈ 4.65 in the photograph.
 *
 * Origin at the centre of the mounting foot (y = 0 is whatever it stands on).
 * The motor axis runs along Z: volute toward −Z, fan cowl toward +Z.
 *
 * @returns {THREE.Group} `userData.hosePort` is an Object3D at the free end of
 *          the arcing hose, so layout can run `buildFlexHose()` on to a robot.
 */
export function buildRingBlower() {
  const g = group('ringBlower');
  const yAx = 0.25; // shaft height above the foot
  const zVol = -0.14; // volute centre
  const portX = 0.108;

  // ── base frame + anti-vibration feet ──
  g.add(boxOn(0.31, 0.022, 0.4, M.steelDark, 0, 0, 0.02));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(cyl(0.024, 0.016, M.rubberBlack, sx * 0.12, 0.008, 0.02 + sz * 0.16, 8));
  }
  g.add(boxOn(0.16, 0.09, 0.13, MAT.blowerAlu, 0, 0.022, zVol + 0.06));
  g.add(boxOn(0.14, 0.06, 0.12, MAT.blowerAlu, 0, 0.022, 0.16));

  // ── volute: flat spiral housing with a scroll bulge and through-bolts ──
  g.add(cylZ(0.185, 0.115, M.plasticWhite, 0, yAx, zVol, 26));
  put(g, ring(0.185, 0.035, MAT.blowerAlu, 'z', 8, 26), 0, yAx, zVol);
  const scroll = ring(0.2, 0.036, MAT.blowerAlu, 'z', 8, 20, Math.PI * 0.75);
  scroll.position.set(0, yAx, zVol);
  scroll.rotation.z = 0.5;
  g.add(scroll);
  g.add(cylZ(0.062, 0.14, MAT.blowerAlu, 0, yAx, zVol - 0.02, 14));
  const bolts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    bolts.push(cylZ(0.011, 0.15, M.steelDark, Math.cos(a) * 0.152, yAx + Math.sin(a) * 0.152, zVol, 6));
  }
  g.add(fuse(bolts, M.steelDark, 'voluteBolts'));

  // ── motor: finned body, terminal box, fan cowl with its star grille ──
  const motor = [cylZ(0.113, 0.3, MAT.blowerAlu, 0, yAx, 0.075, 20)];
  for (let i = 0; i < 7; i++) motor.push(cylZ(0.121, 0.008, MAT.blowerAlu, 0, yAx, -0.055 + i * 0.042, 20));
  g.add(fuse(motor, MAT.blowerAlu, 'blowerMotor'));
  g.add(box(0.105, 0.055, 0.115, M.plasticWhite, 0, yAx + 0.135, 0.06));
  const plate = billboard(0.075, 0.032, paperMat(3), 0, yAx + 0.164, 0.06);
  plate.rotation.x = -HALF;
  g.add(plate);
  const cowl = [cylZ(0.104, 0.06, M.plasticDark, 0, yAx, 0.252, 18)];
  for (let i = 0; i < 6; i++) {
    const vane = box(0.19, 0.014, 0.006, M.plasticDark, 0, yAx, 0.284);
    vane.rotation.z = (i / 6) * Math.PI;
    cowl.push(vane);
  }
  g.add(fuse(cowl, M.plasticDark, 'fanCowl'));
  g.add(cylZ(0.03, 0.07, M.steelBrushed, 0, yAx, 0.288, 10));

  // ── inlet / outlet ports and silencers ──
  for (const s of [-1, 1]) {
    g.add(cyl(0.046, 0.11, MAT.blowerAlu, s * portX, yAx + 0.19, zVol, 12));
    g.add(cyl(0.052, 0.016, MAT.blowerAlu, s * portX, yAx + 0.24, zVol, 12));
    g.add(cylZ(0.05, 0.15, MAT.blowerAlu, s * 0.075, 0.105, zVol + 0.03, 12));
  }
  g.add(cyl(0.05, 0.03, M.plasticDark, portX, yAx + 0.262, zVol, 12)); // blanked spare port

  // supply cable dropping off the terminal box
  g.add(cable(new THREE.CatmullRomCurve3([
    V(0.05, yAx + 0.13, 0.06),
    V(0.16, yAx + 0.02, 0.02),
    V(0.19, 0.12, -0.06),
    V(0.17, 0.02, -0.2),
  ]), M.cableBlack, 0.012, 24, 6));

  // ── the white corrugated hose arcing up over the volute and away ──
  const end = V(0.34, yAx + 0.31, zVol - 0.02);
  g.add(corrugatedTube(new THREE.CatmullRomCurve3([
    V(-portX, yAx + 0.248, zVol),
    V(-0.2, yAx + 0.42, zVol - 0.02),
    V(-0.04, yAx + 0.53, zVol - 0.05),
    V(0.18, yAx + 0.47, zVol - 0.04),
    end,
  ]), M.dressHose, { radius: 0.055, segments: 90, radial: 10, corrugatePeriod: 0.034, corrugateDepth: 0.26 }));
  g.add(sleeve(0.058, 0.018, M.steelBrushed, -portX, yAx + 0.252, zVol, 12));

  const port = new THREE.Object3D();
  port.name = 'hosePort';
  port.position.copy(end);
  g.add(port);
  g.userData.hosePort = port;
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Cylinders, drums, tarpaulins
// ────────────────────────────────────────────────────────────────────────────

/**
 * Industrial gas cylinder: domed shoulder, brass valve with a handwheel and a
 * steel neck collar — the green ones chained together beside the machine line.
 * Origin at the centre of the base on the floor.
 *
 * @param {number} h Overall height to the top of the handwheel.
 * @param {string} colorKey Body material key ('cageGreen', 'binRed', 'binBlue' …).
 * @returns {THREE.Group}
 */
export function buildGasCylinder(h = 1.35, colorKey = 'cageGreen') {
  const g = group('gasCylinder');
  const R = 0.115;
  const mat = M[colorKey];
  const neckY = h * 0.9;

  g.add(lathe([
    V2(0.0, 0.012),
    V2(R * 0.88, 0.012),
    V2(R, 0.05),
    V2(R, h * 0.7),
    V2(R * 0.975, h * 0.75),
    V2(R * 0.82, h * 0.82),
    V2(R * 0.5, h * 0.865),
    V2(R * 0.24, h * 0.888),
    V2(R * 0.2, neckY),
  ], mat, 18));
  g.add(sleeve(R * 1.012, 0.075, tinted(colorKey, 0xcccccc), 0, 0.038, 0, 18)); // foot ring
  g.add(sleeve(R * 0.56, 0.12, M.steelDark, 0, h * 0.855, 0, 16)); // neck collar

  // valve block, side outlet and handwheel
  g.add(cyl(0.032, 0.05, MAT.brass, 0, neckY + 0.024, 0, 12));
  g.add(box(0.058, 0.05, 0.045, MAT.brass, 0, neckY + 0.058, 0));
  const outlet = cyl(0.021, 0.045, MAT.brass, 0.05, neckY + 0.052, 0, 10);
  outlet.rotation.z = HALF;
  g.add(outlet);
  put(g, ring(0.036, 0.008, M.steelDark, 'y', 5, 14), 0, neckY + 0.092, 0);
  g.add(cyl(0.011, 0.03, MAT.brass, 0, neckY + 0.088, 0, 8));

  g.add(billboard(0.13, 0.17, paperMat(4), 0, h * 0.42, R + 0.003));
  g.add(billboard(0.075, 0.075, M.warningDecal, 0, h * 0.6, R + 0.004));
  return g;
}

/**
 * 200-litre steel drum with rolled hoops, top and bottom chimes, two bungs and
 * a painted band. Origin at the centre of the base on the floor.
 *
 * @param {number} h Overall height (default 0.88 m).
 * @returns {THREE.Group}
 */
export function buildDrum(h = 0.88) {
  const g = group('drum');
  const R = 0.285;

  g.add(cyl(R, h - 0.02, M.galv, 0, (h - 0.02) / 2 + 0.01, 0, 20));
  for (const t of [0.33, 0.63]) g.add(sleeve(R * 1.035, 0.055, M.steelWhiteDark, 0, h * t, 0, 20));
  for (const y of [0.022, h - 0.022]) put(g, ring(R * 0.99, 0.024, M.steelDark, 'y', 6, 22), 0, y, 0);

  g.add(cyl(R * 0.985, 0.012, tinted('galv', 0xe0e0e0), 0, h - 0.006, 0, 20));
  g.add(cyl(0.036, 0.014, M.steelDark, R * 0.6, h + 0.002, 0, 10));
  g.add(cyl(0.02, 0.012, M.steelDark, -R * 0.6, h + 0.001, 0, 8));

  g.add(sleeve(R * 1.004, 0.16, tinted('galv', 0xb7c6d8), 0, h * 0.48, 0, 20));
  g.add(billboard(0.17, 0.13, paperMat(1), 0, h * 0.48, R + 0.006));
  return g;
}

/**
 * A blue tarpaulin dumped in a heap on the floor: a crumpled shell with a
 * couple of stiff folds flopping out and a lighter knotted corner catching the
 * light. Origin at the centre of the heap on the floor.
 *
 * @param {number} seed Seeded crumple.
 * @returns {THREE.Group}
 */
export function buildTarpBundle(seed = 1) {
  const rng = makeRng(seed * 2654435 + 91);
  const g = group('tarpBundle');

  const geo = new THREE.SphereGeometry(0.42, 15, 9);
  crumple(geo, rng, 0.2, rf(rng, 4.2, 6.4));
  geo.scale(rf(rng, 0.95, 1.2), rf(rng, 0.48, 0.62), rf(rng, 0.78, 0.98));
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0) pos.setY(i, y * -0.06); // fold the underside flat
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();

  const heap = mesh(geo, M.tarpBlue);
  heap.position.y = -geo.boundingBox.min.y;
  heap.rotation.y = rf(rng, 0, Math.PI);
  g.add(heap);

  for (let i = 0; i < 2; i++) {
    const fold = box(rf(rng, 0.24, 0.4), 0.006, rf(rng, 0.2, 0.34), i ? MAT.tarpLight : M.tarpBlue);
    fold.position.set(rf(rng, -0.3, 0.3), rf(rng, 0.09, 0.18), rf(rng, -0.28, 0.28));
    fold.rotation.set(rf(rng, -0.26, 0.26), rf(rng, 0, Math.PI), rf(rng, -0.26, 0.26));
    g.add(fold);
  }
  const knot = mesh(new THREE.SphereGeometry(0.075, 10, 7), MAT.tarpLight);
  knot.scale.set(1, 0.7, 1.25);
  knot.position.set(rf(rng, -0.2, 0.2), rf(rng, 0.16, 0.26), rf(rng, -0.2, 0.2));
  g.add(knot);
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Steel odds and ends
// ────────────────────────────────────────────────────────────────────────────

/**
 * Perforated-steel step platform: a punched tread plate with turned-down edges
 * on four slim legs with rubber feet — the little step in front of the mint
 * bench machine. Origin at the centre of the footprint on the floor.
 *
 * @param {number} w Width (X).
 * @param {number} d Depth (Z).
 * @param {number} h Height of the tread surface.
 * @returns {THREE.Group}
 */
export function buildStepPlatform(w = 0.6, d = 0.4, h = 0.2) {
  const g = group('stepPlatform');

  const tread = mesh(
    new THREE.PlaneGeometry(w, d),
    perfMat(Math.max(2, Math.round(w * 10)), Math.max(2, Math.round(d * 10))),
  );
  tread.rotation.x = -HALF;
  tread.position.y = h;
  g.add(tread);

  // turned-down edges + under-frame rails
  const t = 0.006;
  g.add(fuse([
    box(w, 0.03, t, M.galv, 0, h - 0.014, d / 2 - t / 2),
    box(w, 0.03, t, M.galv, 0, h - 0.014, -(d / 2 - t / 2)),
    box(t, 0.03, d, M.galv, w / 2 - t / 2, h - 0.014, 0),
    box(t, 0.03, d, M.galv, -(w / 2 - t / 2), h - 0.014, 0),
  ], M.galv, 'treadEdges'));
  for (const sz of [-1, 1]) {
    g.add(box(w - 0.06, 0.018, 0.02, M.steelWhiteDark, 0, h - 0.036, sz * (d / 2 - 0.055)));
    g.add(box(w - 0.1, 0.012, 0.012, M.steelDark, 0, h * 0.32, sz * (d / 2 - 0.05)));
  }

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - 0.05);
      const z = sz * (d / 2 - 0.05);
      g.add(cyl(0.016, h - 0.04, M.steelDark, x, (h - 0.04) / 2 + 0.012, z, 8));
      g.add(cyl(0.021, 0.014, M.rubberBlack, x, 0.007, z, 8));
    }
  }
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Desk-top items
// ────────────────────────────────────────────────────────────────────────────

/**
 * Open laptop. Origin at the centre of its base on the desk surface; the lid
 * hinges at the −Z edge so the **screen faces +Z**, toward the operator.
 *
 * @returns {THREE.Group}
 */
export function buildLaptop() {
  const g = group('laptop');
  const w = 0.325;
  const d = 0.235;

  g.add(boxOn(w, 0.017, d, M.plasticDark));
  g.add(box(w * 0.99, 0.004, d * 0.99, tinted('plasticDark', 0xb4b8bd), 0, 0.0185, 0));
  g.add(box(w * 0.86, 0.003, d * 0.5, M.plasticDark, 0, 0.021, -d * 0.16));
  g.add(box(w * 0.83, 0.002, d * 0.46, tinted('plasticDark', 0x8c9096), 0, 0.0225, -d * 0.16));
  g.add(box(w * 0.24, 0.002, d * 0.17, tinted('plasticDark', 0xc8ccd0), 0, 0.0215, d * 0.22));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(cyl(0.008, 0.004, M.rubberBlack, sx * w * 0.4, 0.002, sz * d * 0.4, 6));
  }

  const hingeZ = -d / 2 + 0.008;
  g.add(cylX(0.008, w * 0.86, M.plasticDark, 0, 0.017, hingeZ, 8));

  const lid = new THREE.Group();
  lid.name = 'laptopLid';
  lid.position.set(0, 0.019, hingeZ);
  lid.rotation.x = -0.3; // ≈ 107° open
  const lh = 0.215;
  lid.add(box(w, lh, 0.009, M.plasticDark, 0, lh / 2, 0));
  lid.add(box(w * 0.92, lh * 0.88, 0.002, MAT.screen, 0, lh / 2, 0.0056));
  lid.add(box(w * 0.2, 0.01, 0.001, tinted('plasticDark', 0x9aa0a6), 0, lh * 0.965, 0.0062));
  g.add(lid);
  return g;
}

/**
 * A stack of A4 paper piles — job sheets and drawings on the benches and desks.
 * Origin at the centre of the footprint on the surface it rests on.
 *
 * @param {number} n Number of piles.
 * @returns {THREE.Group}
 */
export function buildPaperStack(n = 3) {
  const rng = makeRng(1301 + n * 17);
  const g = group('paperStack');
  const W = 0.21;
  const D = 0.297;
  let y = 0;

  for (let i = 0; i < n; i++) {
    const th = rf(rng, 0.004, 0.014);
    const pile = new THREE.Group();
    pile.add(boxOn(W, th, D, MAT.paperEdge));
    const face = billboard(W * 0.99, D * 0.99, paperMat(ri(rng, 1, 4)), 0, th + 0.0006, 0);
    face.rotation.x = -HALF;
    pile.add(face);
    pile.position.set(rf(rng, -0.016, 0.016), y, rf(rng, -0.014, 0.014));
    pile.rotation.y = rf(rng, -0.16, 0.16);
    g.add(pile);
    y += th + 0.0008;
  }

  if (n > 1) {
    const clip = box(0.05, 0.012, 0.02, M.plasticDark, rf(rng, -0.05, 0.05), y + 0.006, -D * 0.36);
    clip.rotation.y = rf(rng, -0.2, 0.2);
    g.add(clip);
  }
  return g;
}
