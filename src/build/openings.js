/**
 * openings.js — the holes in the building shell: roll-up shutter doors, steel
 * personnel doors, and the green header band / guide channels that frame a
 * shutter opening.
 *
 * Reference (img01.jpg, crops G / H / J):
 *  · G — the background-left opening: a deep **green header band** with a bright
 *        lit top edge, and below it a pale grey horizontal-slat roller curtain
 *        recessed behind the band, flanked by barely-visible guide channels.
 *  · H — the cream shutter behind the hero robot: very fine horizontal slats,
 *        distinct pale vertical guide channels each side, and a small **orange
 *        push-button station** on the adjacent column with conduit running up.
 *  · J — the cream steel personnel door on the right wall: pressed-steel frame,
 *        a recessed centre panel, a dark lever handle low on the leaf, two small
 *        white notice plaques (one with a red prohibition roundel), a vertical
 *        grime streak down the panel and a heavily **scuffed, grubby base**.
 *
 * Every builder returns a THREE.Group whose origin is on the floor at the centre
 * of the opening, sitting **on the wall face**, facing **+Z**. layout.js rotates
 * them onto the correct wall (ry = +π/2 → faces +X, ry = −π/2 → faces −X).
 */
import * as THREE from 'three';
import { SEED } from '../core/config.js';
import { M, variant } from '../core/materials.js';
import {
  box, boxOn, cyl, cylX, cylZ, billboard, group, mergeGroup, makeRng, rf,
} from '../core/utils.js';

// ────────────────────────────────────────────────────────────────────────────
// Shared constants — the shutter hood and the surround band stack cleanly:
// the hood occupies y ∈ [h, h + HOOD_H] and projects further forward than the
// wider painted band behind it, exactly as in crop G.
// ────────────────────────────────────────────────────────────────────────────
const HOOD_H = 0.40; // green roller hood depth (Y) above the opening head
const HOOD_D = 0.32; // how far the hood projects out of the wall (Z)
const HOOD_Z = 0.06; // hood centre-line in Z (front face at HOOD_Z + HOOD_D/2)
const BAND_H = 0.74; // painted header band on the wall behind/around the hood
const BAND_D = 0.22;
const CURTAIN_T = 0.045; // slat curtain thickness
const GUIDE_W = 0.11; // guide-channel width
const SLAT_TILE = 0.95; // metres of curtain per shutterSlats() texture tile

/** Module-local material variants (never mutate the shared registry). */
const MAT = {
  /** Shadowed return / end plates of the green header. */
  get headerShade() {
    return variant('shutterHeader', { color: 0x3c7050 }, 'openingHeaderShade');
  },
  /** Sun-bleached top face of the green header. */
  get headerLight() {
    return variant('shutterHeader', { color: 0x64a780 }, 'openingHeaderLight');
  },
  /** The dark nothing seen through / around an opening. */
  get voidDark() {
    return variant('cncBlack', { color: 0x2c2d2b, roughness: 0.98, metalness: 0.0 }, 'openingVoid');
  },
  /** Grubby cream — the scuffed bottom rail of the personnel doors (crop J). */
  get doorScuff() {
    return variant('doorCream', { color: 0xa9a195, roughness: 0.93, metalness: 0.06 }, 'openingDoorScuff');
  },
  /** Darker grime streaks and hand-marks. */
  get doorGrime() {
    return variant('doorCream', { color: 0x8d867b, roughness: 0.96, metalness: 0.04 }, 'openingDoorGrime');
  },
  /** Shaded slats — scuffs and the shadowed strip under the hood. */
  get slatShade() {
    return variant('shutter', { color: 0xb6b0a4 }, 'openingSlatShade');
  },
  /** Bright zinc-plated fixings. */
  get boltSteel() {
    return variant('steelDark', { color: 0x8d9094 }, 'openingBolt');
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Private helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Collects meshes into per-material buckets and merges each bucket into a single
 * mesh on flush. These builders are made of dozens of little boxes; merging keeps
 * them at a handful of draw calls each.
 */
function makeFuser() {
  /** @type {Map<THREE.Material, THREE.Mesh[]>} */
  const buckets = new Map();
  return {
    /** Queue a mesh for merging; returns it so it can still be inspected. */
    add(mesh) {
      const mat = mesh.material;
      let arr = buckets.get(mat);
      if (!arr) {
        arr = [];
        buckets.set(mat, arr);
      }
      arr.push(mesh);
      return mesh;
    },
    /** Queue several meshes at once. */
    addAll(...meshes) {
      meshes.forEach((m) => this.add(m));
    },
    /** Merge every bucket and parent the results under `parent`. */
    flush(parent, prefix) {
      buckets.forEach((meshes, mat) => {
        if (meshes.length === 1) {
          parent.add(meshes[0]);
          return;
        }
        const tmp = new THREE.Group();
        meshes.forEach((m) => tmp.add(m));
        const merged = mergeGroup(tmp, mat);
        merged.name = `${prefix}_${mat.name || 'part'}`;
        parent.add(merged);
      });
      buckets.clear();
    },
  };
}

/**
 * BoxGeometry for a shutter curtain with its V coordinate scaled so the shared
 * `shutterSlats()` texture gives ~18 slats per metre regardless of curtain
 * height. A fresh (uncached) geometry — the UV edit must not touch the cache.
 */
function curtainGeo(w, h, t) {
  const g = new THREE.BoxGeometry(w, h, t);
  const uv = g.attributes.uv;
  const vRep = Math.max(1, Math.round(h / SLAT_TILE));
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * vRep);
  uv.needsUpdate = true;
  return g;
}

/** One vertical guide channel: pale C-section with a brighter front cover. */
function guideChannel(x, h, fuser) {
  fuser.addAll(
    boxOn(GUIDE_W, h, 0.16, M.steelWhiteDark, x, 0, -0.010), // channel body
    boxOn(GUIDE_W, h, 0.026, M.steelWhite, x, 0, 0.079), // front cover strip
    boxOn(0.17, 0.055, 0.24, M.steelWhiteDark, x, 0, 0.010), // foot / floor plate
  );
  // fixing bolts up the cover — three is enough to read the line of fixings
  for (let i = 0; i < 3; i++) {
    const y = 0.55 + (i * (h - 1.1)) / 2;
    fuser.add(cylZ(0.014, 0.014, MAT.boltSteel, x, y, 0.096, 6));
  }
}

/**
 * The orange three-button shutter control station seen on the column beside the
 * shutter in crop H, with its conduit running up to the hood.
 */
function pushButtonStation(x, headY, fuser) {
  const y = 1.28;
  fuser.addAll(
    box(0.13, 0.24, 0.07, M.jibOrange, x, y, 0.050), // enclosure
    box(0.095, 0.185, 0.014, M.plasticWhite, x, y, 0.092), // button plate
    box(0.145, 0.016, 0.075, MAT.boltSteel, x, y - 0.128, 0.050), // gland plate
  );
  fuser.add(cylZ(0.016, 0.014, M.plasticDark, x, y + 0.058, 0.104, 8)); // ▲ open
  fuser.add(cylZ(0.016, 0.014, M.extinguisher, x, y, 0.104, 8)); // ■ stop
  fuser.add(cylZ(0.016, 0.014, M.plasticDark, x, y - 0.058, 0.104, 8)); // ▼ close
  // conduit from the box up to the underside of the hood
  const top = headY + 0.02;
  const bot = y + 0.12;
  if (top > bot + 0.1) {
    fuser.add(cyl(0.015, top - bot, M.galv, x, (top + bot) / 2, 0.048, 8));
    fuser.add(box(0.05, 0.03, 0.06, MAT.boltSteel, x, bot + (top - bot) * 0.55, 0.040));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Exports
// ────────────────────────────────────────────────────────────────────────────

/**
 * Roll-up shutter door — the pale horizontal-slat curtains of crops G and H.
 *
 * Models: the slatted curtain (`M.shutter`, UV-scaled so the slat pitch is
 * constant), a steel bottom rail with a rubber seal, a guide channel each side,
 * the green roller hood (`M.shutterHeader`) with its bright top edge, drive
 * motor and end plates, the coiled curtain on its barrel inside the hood, a bare
 * concrete threshold, and the orange push-button station on the right jamb.
 *
 * Origin: on the floor at the centre of the opening, on the wall face. The
 * curtain lies in the XY plane at z ≈ 0 and the door **faces +Z** — rotate it in
 * layout.js (ry = +π/2 to face +X, −π/2 to face −X).
 *
 * @param {number} width    clear width of the opening (m)
 * @param {number} height   clear height of the opening (m)
 * @param {number} openFrac 0 = fully closed, 1 = fully rolled up
 * @returns {THREE.Group} named 'rollShutter'; `.userData.openFrac` is echoed back
 */
export function buildRollShutter(width = 4.0, height = 4.2, openFrac = 0) {
  const g = group('rollShutter');
  const f = makeFuser();
  const rng = makeRng((SEED ^ 0x5a17) >>> 0);

  const open = Math.min(0.98, Math.max(0, openFrac));
  const curtainH = Math.max(0.14, height * (1 - open));
  const yBot = height - curtainH; // bottom edge of the curtain
  const gx = width / 2 + GUIDE_W / 2; // guide-channel centre-line

  // ── the dark nothing behind the opening ─────────────────────────────────
  f.add(box(width + 0.10, height + 0.06, 0.03, MAT.voidDark, 0, (height + 0.06) / 2, -0.150));

  // ── slat curtain (its own mesh: unique UV-scaled geometry) ──────────────
  const curtain = new THREE.Mesh(curtainGeo(width, curtainH, CURTAIN_T), M.shutter);
  curtain.position.set(0, yBot + curtainH / 2, 0);
  curtain.castShadow = true;
  curtain.receiveShadow = true;
  curtain.name = 'shutterCurtain';
  g.add(curtain);

  // A band of shadow where the curtain disappears under the hood, plus a few
  // seeded scuff marks low down — the shutters in the photo are well used.
  f.add(box(width, 0.16, 0.004, MAT.slatShade, 0, height - 0.08, CURTAIN_T / 2 + 0.002));
  for (let i = 0; i < 5; i++) {
    const w = rf(rng, 0.10, 0.34);
    f.add(box(
      w, rf(rng, 0.02, 0.05), 0.003, MAT.slatShade,
      rf(rng, -width / 2 + w, width / 2 - w),
      yBot + rf(rng, 0.10, 0.85),
      CURTAIN_T / 2 + 0.003,
    ));
  }

  // ── bottom rail + weather seal ──────────────────────────────────────────
  f.addAll(
    box(width + 0.02, 0.085, 0.064, M.steelWhiteDark, 0, yBot + 0.062, 0),
    box(width + 0.02, 0.022, 0.052, M.rubberBlack, 0, yBot + 0.011, 0),
    box(0.09, 0.10, 0.075, M.steelWhite, 0, yBot + 0.062, 0.006), // centre lifting handle boss
  );

  // ── guide channels ──────────────────────────────────────────────────────
  guideChannel(+gx, height + 0.06, f);
  guideChannel(-gx, height + 0.06, f);

  // ── green roller hood ───────────────────────────────────────────────────
  const hoodW = width + 0.30;
  const hoodFront = HOOD_Z + HOOD_D / 2;
  f.addAll(
    box(hoodW, HOOD_H, HOOD_D, M.shutterHeader, 0, height + HOOD_H / 2, HOOD_Z),
    // bright lit top edge and the dark line under the front lip (crop G)
    box(hoodW + 0.02, 0.032, HOOD_D + 0.02, MAT.headerLight, 0, height + HOOD_H - 0.014, HOOD_Z),
    box(hoodW + 0.004, 0.055, 0.006, MAT.headerShade, 0, height + 0.028, hoodFront + 0.001),
    // end plates
    box(0.022, HOOD_H, HOOD_D + 0.012, MAT.headerShade, +(hoodW / 2 + 0.011), height + HOOD_H / 2, HOOD_Z),
    box(0.022, HOOD_H, HOOD_D + 0.012, MAT.headerShade, -(hoodW / 2 + 0.011), height + HOOD_H / 2, HOOD_Z),
    // support brackets under each end of the hood
    box(0.06, 0.14, 0.20, M.steelWhiteDark, +(hoodW / 2 - 0.06), height - 0.055, HOOD_Z - 0.02),
    box(0.06, 0.14, 0.20, M.steelWhiteDark, -(hoodW / 2 - 0.06), height - 0.055, HOOD_Z - 0.02),
  );

  // ── barrel + coiled curtain inside the hood, and the drive gearbox ──────
  const coilR = 0.098 + 0.088 * open;
  f.add(cylX(coilR, width - 0.05, M.steelWhiteDark, 0, height + 0.19, HOOD_Z - 0.02, 12));
  f.add(cylX(0.028, width + 0.20, MAT.boltSteel, 0, height + 0.19, HOOD_Z - 0.02, 8)); // shaft
  f.addAll(
    box(0.20, 0.24, 0.24, M.plasticDark, hoodW / 2 + 0.14, height + 0.19, HOOD_Z - 0.02),
    box(0.10, 0.14, 0.14, M.steelDark, hoodW / 2 + 0.02, height + 0.19, HOOD_Z - 0.02),
    box(0.09, 0.13, 0.13, M.steelDark, -(hoodW / 2 + 0.02), height + 0.19, HOOD_Z - 0.02),
  );

  // ── bare concrete threshold under the door ──────────────────────────────
  f.add(box(width + 0.36, 0.022, 0.36, M.concrete, 0, 0.011, 0.06));

  // ── operator push-button station on the right-hand jamb ─────────────────
  pushButtonStation(width / 2 + GUIDE_W + 0.17, height, f);

  f.flush(g, 'shutter');
  g.userData.openFrac = open;
  return g;
}

/**
 * Steel personnel door — the cream flush door on the right wall in crop J.
 *
 * Models: a pressed-steel frame with architrave lips and three hinges, a leaf
 * with a **recessed centre panel** (raised stiles and rails around a set-back
 * field), a dark lever handle with rose and cylinder escutcheon, a brushed kick
 * plate, the grubby scuffed bottom rail and grime streaks, and two small notice
 * plaques (one carrying a red prohibition roundel).
 *
 * Origin: on the floor at the centre of the opening, on the wall face; the door
 * **faces +Z** and is **hinged on the left** (−X). The leaf hangs from a pivot
 * group returned as `.userData.leaf`, so it can be swung open later by setting
 * `leaf.rotation.y` (negative opens into the room).
 *
 * @param {number} width  clear width of the opening (m)
 * @param {number} height clear height of the opening (m)
 * @returns {THREE.Group} named 'steelDoor'
 */
export function buildSteelDoor(width = 0.95, height = 2.1) {
  const g = group('steelDoor');
  const f = makeFuser();
  const rng = makeRng((SEED ^ 0x2d0b) >>> 0);

  const jambW = 0.058;
  const frameD = 0.14;
  const jx = width / 2 + jambW / 2;

  // ── frame + dark reveal ─────────────────────────────────────────────────
  f.addAll(
    boxOn(jambW, height + jambW, frameD, M.doorCream, +jx, 0, 0),
    boxOn(jambW, height + jambW, frameD, M.doorCream, -jx, 0, 0),
    box(width + jambW * 2, jambW, frameD, M.doorCream, 0, height + jambW / 2, 0),
    // architrave lips standing proud of the wall
    boxOn(jambW + 0.026, height + jambW, 0.020, M.doorCream, +jx, 0, frameD / 2 + 0.010),
    boxOn(jambW + 0.026, height + jambW, 0.020, M.doorCream, -jx, 0, frameD / 2 + 0.010),
    box(width + jambW * 2 + 0.026, jambW + 0.026, 0.020, M.doorCream, 0, height + jambW / 2, frameD / 2 + 0.010),
    // the dark gap all round the closed leaf
    box(width + 0.02, height + 0.02, 0.022, MAT.voidDark, 0, (height + 0.02) / 2, -0.050),
    // aluminium threshold strip
    box(width + 0.10, 0.014, frameD, M.galv, 0, 0.007, 0),
  );
  // hinges on the left jamb
  [0.34, 1.05, 1.76].forEach((y) => {
    if (y < height - 0.1) {
      f.add(box(0.030, 0.100, 0.046, M.steelDark, -(width / 2) - 0.004, y, 0.052));
      f.add(cylZ(0.014, 0.052, M.steelDark, -(width / 2) - 0.004, y, 0.058, 8));
    }
  });

  // ── the leaf, on a hinge pivot at the left edge ─────────────────────────
  const wLeaf = width - 0.012;
  const hLeaf = height - 0.010;
  const leaf = new THREE.Group();
  leaf.name = 'leaf';
  leaf.position.set(-width / 2 + 0.006, 0, 0.012);
  const lf = makeFuser();
  const cx = wLeaf / 2;
  const yOff = 0.005;

  // core slab, then raised stiles/rails leaving the centre panel recessed
  lf.add(box(wLeaf, hLeaf, 0.030, M.doorCream, cx, hLeaf / 2 + yOff, 0));
  const railZ = 0.023;
  const railT = 0.016;
  lf.addAll(
    box(0.10, hLeaf, railT, M.doorCream, 0.05, hLeaf / 2 + yOff, railZ), // hinge stile
    box(0.10, hLeaf, railT, M.doorCream, wLeaf - 0.05, hLeaf / 2 + yOff, railZ), // lock stile
    box(wLeaf, 0.13, railT, M.doorCream, cx, hLeaf - 0.065 + yOff, railZ), // top rail
    box(wLeaf, 0.26, railT, MAT.doorScuff, cx, 0.13 + yOff, railZ), // grubby bottom rail
  );
  // kick plate + the dark scuffing round the base that crop J shows so clearly
  lf.addAll(
    box(wLeaf - 0.08, 0.19, 0.005, M.steelBrushed, cx, 0.115, railZ + railT / 2 + 0.003),
    box(wLeaf - 0.04, 0.055, 0.003, MAT.doorGrime, cx, 0.030, railZ + railT / 2 + 0.003),
  );
  // vertical grime streak down the recessed panel + a few seeded scuffs
  lf.add(box(0.038, 0.62, 0.0016, MAT.doorGrime, cx + 0.055, 1.00, 0.0295));
  for (let i = 0; i < 6; i++) {
    lf.add(box(
      rf(rng, 0.03, 0.09), rf(rng, 0.010, 0.026), 0.0015, MAT.doorGrime,
      rf(rng, 0.16, wLeaf - 0.16), rf(rng, 0.30, 0.95), 0.0292,
    ));
  }

  // lever handle set, low on the lock stile (photo: ≈ 1.0 m)
  const hx = wLeaf - 0.085;
  const hy = 1.02;
  lf.addAll(
    box(0.115, 0.026, 0.026, M.steelDark, hx - 0.052, hy, 0.082), // lever
    box(0.030, 0.026, 0.030, M.steelDark, hx - 0.104, hy - 0.004, 0.078), // lever tip
  );
  lf.add(cylZ(0.034, 0.016, M.steelDark, hx, hy, 0.039, 12)); // rose
  lf.add(cylZ(0.015, 0.058, M.steelDark, hx, hy, 0.062, 10)); // spindle boss
  lf.add(cylZ(0.018, 0.010, M.steelDark, hx, hy - 0.135, 0.036, 10)); // cylinder escutcheon

  // small white notices — one plain, one with the red prohibition roundel
  lf.add(billboard(0.10, 0.135, M.paper, hx - 0.20, 1.30, 0.0300));
  lf.add(cylZ(0.026, 0.002, M.extinguisher, hx - 0.20, 1.278, 0.0316, 12));
  lf.add(cylZ(0.018, 0.002, M.plasticWhite, hx - 0.20, 1.278, 0.0328, 12));
  lf.add(billboard(0.072, 0.052, M.paper, hx - 0.13, 1.63, 0.0300));
  lf.add(billboard(0.050, 0.050, M.paper, 0.075, hLeaf - 0.20, 0.0320));

  lf.flush(leaf, 'doorLeaf');
  g.add(leaf);

  f.flush(g, 'doorFrame');
  g.userData.leaf = leaf;
  return g;
}

/**
 * The architectural surround that frames a shutter opening: the wide painted
 * **green header band** across the wall above the head (with its bright lit top
 * capping), the boxed-out guide-channel casings flanking the opening, plaster
 * jamb reveals, and the concrete apron across the threshold.
 *
 * Designed to be dropped at the *same* origin as `buildRollShutter()` — the
 * band sits behind and around the shutter's projecting hood so the two read as
 * one deep green header, exactly as in crop G. It also stands alone as a blank
 * opening surround.
 *
 * Origin: on the floor at the centre of the opening, on the wall face, facing
 * **+Z**.
 *
 * @param {number} width  clear width of the opening (m)
 * @param {number} height clear height of the opening (m)
 * @returns {THREE.Group} named 'shutterSurround'
 */
export function buildShutterSurround(width = 4.0, height = 4.2) {
  const g = group('shutterSurround');
  const f = makeFuser();
  const rng = makeRng((SEED ^ 0x71c4) >>> 0);

  const bandW = width + 0.62;
  const bandY0 = height + 0.02;
  const bandZ = -0.02; // sits behind the shutter hood, which projects further
  const casX = width / 2 + 0.20; // guide-casing centre-line

  // ── green header band + bright capping ──────────────────────────────────
  f.addAll(
    box(bandW, BAND_H, BAND_D, M.shutterHeader, 0, bandY0 + BAND_H / 2, bandZ),
    box(bandW + 0.08, 0.042, BAND_D + 0.05, MAT.headerLight, 0, bandY0 + BAND_H + 0.021, bandZ),
    box(bandW + 0.02, 0.050, 0.008, MAT.headerShade, 0, bandY0 + 0.025, bandZ + BAND_D / 2 + 0.002),
    // boxed end plates closing the band off at each end
    box(0.020, BAND_H, BAND_D + 0.012, MAT.headerShade, +(bandW / 2 + 0.010), bandY0 + BAND_H / 2, bandZ),
    box(0.020, BAND_H, BAND_D + 0.012, MAT.headerShade, -(bandW / 2 + 0.010), bandY0 + BAND_H / 2, bandZ),
  );
  // fixing bolts along the bottom of the band
  const nBolts = Math.max(3, Math.round(bandW / 0.75));
  for (let i = 0; i < nBolts; i++) {
    const x = -bandW / 2 + 0.30 + (i * (bandW - 0.60)) / (nBolts - 1);
    f.add(cylZ(0.013, 0.012, MAT.boltSteel, x, bandY0 + 0.09, bandZ + BAND_D / 2 + 0.006, 6));
  }
  // a couple of seeded weathering streaks running down the green face
  for (let i = 0; i < 4; i++) {
    f.add(box(
      rf(rng, 0.02, 0.05), rf(rng, 0.18, 0.46), 0.004, MAT.headerShade,
      rf(rng, -bandW / 2 + 0.2, bandW / 2 - 0.2),
      bandY0 + BAND_H - rf(rng, 0.12, 0.34),
      bandZ + BAND_D / 2 + 0.003,
    ));
  }

  // ── boxed-out guide-channel casings each side of the opening ────────────
  const casH = bandY0 + 0.10;
  [+casX, -casX].forEach((x) => {
    f.addAll(
      boxOn(0.16, casH, 0.18, M.steelWhite, x, 0, -0.010),
      boxOn(0.060, casH, 0.045, M.steelWhiteDark, x - Math.sign(x) * 0.050, 0, 0.098),
      boxOn(0.22, 0.070, 0.26, M.steelWhiteDark, x, 0, 0.008), // floor plate
    );
  });

  // ── plaster jamb reveals so the wall reads as thick ─────────────────────
  [+1, -1].forEach((s) => {
    f.add(boxOn(0.12, bandY0 + BAND_H, 0.13, M.wallPlain, s * (bandW / 2 + 0.06), 0, -0.055));
  });
  // soffit of the opening head, tucked behind the curtain plane
  f.add(box(width + 0.24, 0.10, 0.12, M.wallPlain, 0, height - 0.05, -0.100));

  // ── bare concrete apron across the threshold ────────────────────────────
  f.add(box(bandW + 0.20, 0.020, 0.46, M.concrete, 0, 0.010, 0.10));

  f.flush(g, 'surround');
  return g;
}
