/**
 * equip/furniture.js — the workshop furniture that fills the left half of
 * img01.jpg: workbenches, office desks with monitors, binder cabinets, the
 * mint pigeon-hole parts racks, the dense dark-bin racks, bright green wire
 * roll cages (かご車), task chairs, stools, whiteboard stands, mint two-shelf
 * hand trolleys and the white vinyl partition screens.
 *
 * Conventions (see CONTRACT.md §4)
 * ────────────────────────────────
 *   • Every builder returns a THREE.Group whose origin is the CENTRE OF ITS
 *     FOOTPRINT ON THE FLOOR (y = 0 is the floor it stands on).
 *   • Every builder FACES −Z: the open front of a rack, the user side of a
 *     desk/bench, the whiteboard face and the screen of a monitor all look
 *     toward −Z. layout.js rotates them into place (LAYOUT.md mostly wants
 *     `ry = -Math.PI/2` so the racks face +X across the aisle).
 *   • Everything is welded per-material with `mergeGroup()` so a fully dressed
 *     rack costs ~6-8 draw calls instead of ~300, and the dense bin grids use
 *     `instance()`.
 *   • All the "mess" (which pigeon-holes are full, how the binders lean, what
 *     is stacked on a trolley) comes from `makeRng(seed)` with fixed seeds, so
 *     the scene is byte-identical on every reload. Pass `o.seed` to reshuffle.
 *
 * Photo notes that drive the modelling (crops D, F and the bin-rack close-up):
 *   • The parts racks are a pale sage/mint (PAL.shelfGreen) with a BRIGHT
 *     YELLOW label strip along the front lip of every shelf — that yellow line
 *     is the single most recognisable cue of these racks.
 *   • The bin racks are the same mint frame carrying a very dense grid of tiny
 *     near-black bins, each with a pale label window, plus one red tote on the
 *     shelf underneath.
 *   • The roll cages are a saturated green tube frame with ladder-mesh sides,
 *     stuffed with kraft cardboard that overflows above the top rail.
 *   • Desks, cabinets and partitions are all warm off-white / ivory; the only
 *     saturated things in that half of the frame are the binders, the red totes
 *     and the yellow shelf strips.
 */
import * as THREE from 'three';
import {
  box,
  boxOn,
  cyl,
  cylX,
  cylBetween,
  billboard,
  boxGeo,
  instance,
  mergeGroup,
  makeRng,
  rf,
  ri,
  pick,
  V3,
} from '../core/utils.js';
import { M, tinted, variant } from '../core/materials.js';

// ────────────────────────────────────────────────────────────────────────────
// Module-local materials.
//
// materials.js is frozen, so any colour it does not carry is built here as a
// cached `variant()` / `tinted()` of the nearest registry key. All of these are
// lazy (they must not run at import time — textures.js needs a DOM).
// ────────────────────────────────────────────────────────────────────────────

const LM = {
  /** Stretched white vinyl of the partition screens — opaque, faintly warm. */
  vinyl: () =>
    variant('plasticWhite', { color: 0xf1efe6, roughness: 0.66, side: THREE.DoubleSide }, 'furnVinyl'),
  /** Pale mint laminate bench top (the right-wall bench in the photo). */
  benchTop: () => tinted('plasticWhite', 0xc9dccf),
  /** Whiteboard carcass behind the printed face. */
  boardCore: () => tinted('plasticWhite', 0xf6f5f0),
  /** Dead LCD panel — near-black, slightly glossy. */
  screen: () => variant('plasticDark', { color: 0x14161a, roughness: 0.22, metalness: 0.15 }, 'furnScreen'),
  /** Cream label window on a parts bin / pale paperwork bundle. */
  label: () => tinted('plasticWhite', 0xe9e3cf),
  binderCream: () => tinted('plasticWhite', 0xe7e1d0),
  binderBlue: () => tinted('plasticWhite', 0x3a6fb0),
  binderOrange: () => tinted('plasticWhite', 0xd08a2e),
};

/** Cells per texture tile in `T.meshAlpha(10, 2)` (128 px canvas, 10 px pitch). */
const MESH_CELLS_PER_TILE = 12.8;

// ────────────────────────────────────────────────────────────────────────────
// Welding helpers — keep the draw-call count sane.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Bake an array of same-material meshes into a single Mesh.
 * Only INDEXED geometry may be mixed (Box/Cylinder/Plane/Torus/Tube all are —
 * ExtrudeGeometry is not, so `roundedBox()` is deliberately unused here).
 * @returns {THREE.Object3D|null}
 */
function weld(meshes, material, name) {
  if (!meshes || meshes.length === 0) return null;
  const tmp = new THREE.Group();
  for (const m of meshes) tmp.add(m);
  const merged = mergeGroup(tmp, material);
  if (!merged || !merged.geometry) {
    tmp.name = name; // graceful fallback: keep the un-merged children
    return tmp;
  }
  merged.name = name;
  merged.castShadow = true;
  merged.receiveShadow = true;
  return merged;
}

/** Small accumulator: `bk.add(material, meshA, meshB, …)` then `bk.weldInto(g)`. */
function bucketSet() {
  const map = new Map();
  const api = {
    add(material, ...meshes) {
      let arr = map.get(material);
      if (!arr) {
        arr = [];
        map.set(material, arr);
      }
      for (const m of meshes) {
        if (Array.isArray(m)) {
          for (const n of m) if (n) arr.push(n);
        } else if (m) arr.push(m);
      }
      return api;
    },
    weldInto(g, prefix) {
      let i = 0;
      map.forEach((arr, material) => {
        const merged = weld(arr, material, `${prefix}_${material.name || i}`);
        i += 1;
        if (merged) g.add(merged);
      });
      return g;
    },
  };
  return api;
}

/** Fresh named Group (never the cached-geometry trap of `group()` reuse). */
function root(name) {
  const g = new THREE.Group();
  g.name = name;
  return g;
}

/**
 * A wire-mesh quad whose UVs are rescaled so the printed mesh cell stays a
 * constant physical size no matter the panel dimensions.
 */
function meshPanelGeo(w, h, cell = 0.075) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  const su = w / cell / MESH_CELLS_PER_TILE;
  const sv = h / cell / MESH_CELLS_PER_TILE;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return g;
}

/** Four castors (dark bracket + rubber wheel) at the corners of a w×d frame. */
function addCastors(bk, w, d, r = 0.05, bracketMat = M.steelDark) {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - 0.07);
      const z = sz * (d / 2 - 0.08);
      bk.add(bracketMat, boxOn(0.06, 0.075, 0.055, bracketMat, x, r * 0.9, z));
      const wheel = cylX(r, 0.03, M.rubberBlack, x, r, z, 10);
      bk.add(M.rubberBlack, wheel);
    }
  }
}

/** A loose sheet of A4 lying flat, slightly skewed. */
function sheet(rng, x, y, z, scale = 1) {
  const s = box(0.212 * scale, 0.0016, 0.298 * scale, M.paper, x, y, z);
  s.rotation.y = rf(rng, -0.5, 0.5);
  return s;
}

/** A squat kraft box — the generic filler used all over the racks. */
function kraft(rng, x, y, z, w, h, d) {
  const b = boxOn(w, h, d, M.cardboard, x, y, z);
  b.rotation.y = rf(rng, -0.10, 0.10);
  return b;
}

// ────────────────────────────────────────────────────────────────────────────
// Benches, desks, cabinets
// ────────────────────────────────────────────────────────────────────────────

/**
 * Steel-frame workbench: four painted box legs on rubber pads, an apron, a
 * lower shelf and a laminate or steel top. This is the bench under the laptop
 * on the right wall and the long one bottom-left of the photograph.
 * Origin: centre of the footprint on the floor; the working side faces −Z.
 *
 * @param {number} w  overall width (X)
 * @param {number} d  overall depth (Z)
 * @param {number} h  top surface height
 * @param {object} [o]
 * @param {'mint'|'steel'|'wood'|'ivory'} [o.top='mint']  top surface finish
 * @param {string} [o.frameKey='machineMintDark']  materials.js key for the frame
 * @param {boolean} [o.shelf=true]      lower shelf between the legs
 * @param {boolean} [o.backboard=false] raised sheet-metal backboard
 * @param {boolean} [o.clutter=true]    a couple of papers and a small carton
 * @param {number}  [o.seed=4101]
 * @returns {THREE.Group} 'workbench'
 */
export function buildWorkbench(w = 1.8, d = 0.75, h = 0.82, o = {}) {
  const {
    top = 'mint',
    frameKey = 'machineMintDark',
    shelf = true,
    backboard = false,
    clutter = true,
    seed = 4101,
  } = o;
  const rng = makeRng(seed);
  const bk = bucketSet();
  const g = root('workbench');

  const frame = M[frameKey];
  const topMat =
    top === 'steel' ? M.steelBrushed : top === 'wood' ? M.wood : top === 'ivory' ? M.machineIvory : LM.benchTop();

  const legS = 0.05;
  const tT = 0.042;
  const inset = 0.075;
  const lx = w / 2 - inset;
  const lz = d / 2 - inset;
  const legTop = h - tT;

  // legs + rubber pads
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      bk.add(frame, boxOn(legS, legTop - 0.014, legS, frame, sx * lx, 0.014, sz * lz));
      bk.add(M.rubberBlack, boxOn(legS + 0.016, 0.014, legS + 0.016, M.rubberBlack, sx * lx, 0, sz * lz));
    }
  }
  // apron rails immediately under the top
  const ay = legTop - 0.05;
  bk.add(
    frame,
    box(w - inset * 2 + legS, 0.055, 0.03, frame, 0, ay, -lz),
    box(w - inset * 2 + legS, 0.055, 0.03, frame, 0, ay, lz),
    box(0.03, 0.055, d - inset * 2 + legS, frame, -lx, ay, 0),
    box(0.03, 0.055, d - inset * 2 + legS, frame, lx, ay, 0),
  );
  // lower rails + shelf
  if (shelf) {
    bk.add(
      frame,
      boxOn(w - inset * 2 + legS, 0.024, d - inset * 2 + legS, frame, 0, 0.165, 0),
      box(0.028, 0.05, d - inset * 2, frame, -lx, 0.30, 0),
      box(0.028, 0.05, d - inset * 2, frame, lx, 0.30, 0),
    );
  }
  // top slab with a slight overhang and a darker edge band
  bk.add(topMat, box(w, tT, d, topMat, 0, h - tT / 2, 0));
  bk.add(
    frame,
    box(w + 0.008, 0.012, 0.008, frame, 0, h - tT - 0.004, -d / 2 - 0.002),
  );

  if (backboard) {
    bk.add(
      M.machineIvoryDark,
      box(w, 0.34, 0.016, M.machineIvoryDark, 0, h + 0.17, d / 2 - 0.01),
    );
  }

  if (clutter) {
    bk.add(M.paper, sheet(rng, rf(rng, -w * 0.3, 0), h + 0.002, rf(rng, -0.1, 0.12)));
    bk.add(M.paper, sheet(rng, rf(rng, -w * 0.34, -w * 0.1), h + 0.004, rf(rng, -0.05, 0.15), 0.9));
    bk.add(
      M.cardboard,
      kraft(rng, rf(rng, w * 0.12, w * 0.34), h, rf(rng, -0.05, 0.1), rf(rng, 0.22, 0.32), rf(rng, 0.13, 0.2), rf(rng, 0.2, 0.28)),
    );
  }

  return bk.weldInto(g, 'workbench');
}

/**
 * Office desk: ivory melamine top on a steel frame, a drawer pedestal at one
 * end, a modesty panel, and (by default) the black flat monitor, keyboard,
 * mouse and loose paperwork seen on the two desks mid-left of the photo.
 * Origin: centre of the footprint on the floor; the user sits at −Z and the
 * monitor screen therefore faces −Z.
 *
 * @param {number} w overall width (X)
 * @param {number} d overall depth (Z)
 * @param {object} [o]
 * @param {number}  [o.h=0.72]           top height
 * @param {boolean} [o.monitor=true]     monitor + keyboard + mouse
 * @param {'left'|'right'|'none'} [o.pedestal='right']
 * @param {number}  [o.papers=2]
 * @param {number}  [o.seed=4203]
 * @returns {THREE.Group} 'desk'
 */
export function buildDesk(w = 1.4, d = 0.7, o = {}) {
  const { h = 0.72, monitor = true, pedestal = 'right', papers = 2, seed = 4203 } = o;
  const rng = makeRng(seed);
  const bk = bucketSet();
  const g = root('desk');

  const tT = 0.034;
  const sgn = pedestal === 'left' ? -1 : 1;

  // top + front edge band
  bk.add(M.machineIvory, box(w, tT, d, M.machineIvory, 0, h - tT / 2, 0));
  bk.add(M.machineIvoryDark, box(w, 0.012, 0.01, M.machineIvoryDark, 0, h - tT - 0.005, -d / 2 - 0.003));

  // end panel opposite the pedestal
  bk.add(
    M.machineIvory,
    boxOn(0.026, h - tT - 0.06, d - 0.07, M.machineIvory, -sgn * (w / 2 - 0.013), 0.06, 0.01),
  );
  // modesty panel
  bk.add(M.machineIvory, box(w - 0.42, 0.30, 0.018, M.machineIvory, 0, h - 0.30, d / 2 - 0.05));
  // kick plinth under the end panel
  bk.add(M.machineIvoryDark, boxOn(0.05, 0.06, d - 0.1, M.machineIvoryDark, -sgn * (w / 2 - 0.03), 0, 0.01));

  // steel underframe
  bk.add(
    M.steelWhiteDark,
    box(w - 0.1, 0.03, 0.03, M.steelWhiteDark, 0, h - tT - 0.02, -d / 2 + 0.06),
    box(w - 0.1, 0.03, 0.03, M.steelWhiteDark, 0, h - tT - 0.02, d / 2 - 0.06),
  );

  // three-drawer pedestal
  if (pedestal !== 'none') {
    const pw = 0.40;
    const px = sgn * (w / 2 - pw / 2 - 0.02);
    const ph = h - tT - 0.07;
    bk.add(M.machineIvory, boxOn(pw, ph, d - 0.08, M.machineIvory, px, 0.07, 0.01));
    bk.add(M.machineIvoryDark, boxOn(pw - 0.04, 0.07, d - 0.12, M.machineIvoryDark, px, 0, 0.01));
    for (let i = 0; i < 3; i++) {
      const dy = 0.09 + ph * (0.16 + i * 0.27);
      bk.add(
        M.machineIvory,
        box(pw - 0.03, ph * 0.24, 0.012, M.machineIvory, px, dy, -d / 2 + 0.045),
      );
      bk.add(
        M.plasticDark,
        box(pw * 0.45, 0.016, 0.016, M.plasticDark, px, dy + ph * 0.09, -d / 2 + 0.036),
      );
    }
  }

  if (monitor) {
    const mz = d / 2 - 0.16;
    bk.add(
      M.plasticDark,
      box(0.24, 0.018, 0.17, M.plasticDark, -0.02, h + 0.009, mz),
      box(0.055, 0.17, 0.045, M.plasticDark, -0.02, h + 0.10, mz + 0.005),
    );
    const panel = box(0.545, 0.335, 0.024, M.plasticDark, -0.02, h + 0.355, mz + 0.01);
    panel.rotation.x = 0.06; // screen tilted slightly back, as in the photo
    bk.add(M.plasticDark, panel);
    const face = billboard(0.505, 0.295, LM.screen(), -0.02, h + 0.353, mz - 0.005, Math.PI);
    face.rotation.x = 0.06; // Euler XYZ ⇒ the yaw flip happens first, so the
    bk.add(LM.screen(), face); // same pitch keeps the glass parallel to the bezel

    const kb = box(0.42, 0.022, 0.145, M.plasticDark, -0.03, h + 0.011, -d / 2 + 0.20);
    kb.rotation.y = rf(rng, -0.09, 0.09);
    bk.add(M.plasticDark, kb);
    bk.add(M.plasticDark, box(0.062, 0.028, 0.10, M.plasticDark, sgn * 0.30, h + 0.014, -d / 2 + 0.22));
  }

  for (let i = 0; i < papers; i++) {
    bk.add(M.paper, sheet(rng, rf(rng, -w * 0.34, w * 0.12), h + 0.002 + i * 0.002, rf(rng, -d * 0.28, 0.02)));
  }

  return bk.weldInto(g, 'desk');
}

/**
 * Tall ivory steel storage cabinet: solid double doors below, a glazed upper
 * section packed with ring binders above — the unit on the far left of the
 * photograph, its shelves striped white / orange / blue.
 * Origin: centre of the footprint on the floor, doors facing −Z.
 *
 * @param {number} w  width (X)
 * @param {number} h  overall height
 * @param {number} d  depth (Z)
 * @param {object} [o]
 * @param {boolean} [o.glass=true]    glazed sliding doors on the upper section
 * @param {boolean} [o.binders=true]  fill the upper shelves
 * @param {number}  [o.notes=2]       A4 notices taped to the lower doors
 * @param {number}  [o.seed=4307]
 * @returns {THREE.Group} 'storageCabinet'
 */
export function buildStorageCabinet(w = 0.9, h = 1.85, d = 0.45, o = {}) {
  const { glass = true, binders = true, notes = 2, seed = 4307 } = o;
  const rng = makeRng(seed);
  const bk = bucketSet();
  const g = root('storageCabinet');

  const kick = 0.075;
  const wall = 0.022;
  const midY = h * 0.52;
  const inner = w - wall * 2;

  // plinth + carcass
  bk.add(M.machineIvoryDark, boxOn(w - 0.05, kick, d - 0.04, M.machineIvoryDark, 0, 0, 0));
  bk.add(
    M.machineIvory,
    boxOn(wall, h - kick, d, M.machineIvory, -(w / 2 - wall / 2), kick, 0),
    boxOn(wall, h - kick, d, M.machineIvory, w / 2 - wall / 2, kick, 0),
    box(w, 0.026, d, M.machineIvory, 0, h - 0.013, 0),
    box(w, 0.02, d, M.machineIvory, 0, kick + 0.01, 0),
    box(inner, 0.018, d - 0.02, M.machineIvory, 0, midY, 0),
    box(inner, h - kick, 0.016, M.machineIvory, 0, kick + (h - kick) / 2, d / 2 - 0.008),
  );

  // ── lower doors ──────────────────────────────────────────────────────────
  const doorH = midY - kick - 0.03;
  for (const sx of [-1, 1]) {
    bk.add(
      M.machineIvory,
      box(inner / 2 - 0.006, doorH, 0.016, M.machineIvory, sx * (inner / 4 + 0.004), kick + 0.015 + doorH / 2, -d / 2 + 0.008),
    );
    bk.add(
      M.plasticDark,
      box(0.014, 0.13, 0.02, M.plasticDark, sx * 0.035, kick + 0.02 + doorH * 0.62, -d / 2 - 0.004),
    );
  }
  for (let i = 0; i < notes; i++) {
    const n = billboard(0.155, 0.215, M.paper, rf(rng, -0.2, 0.2), midY - 0.30 - i * 0.24, -d / 2 - 0.002, Math.PI);
    n.rotation.z = rf(rng, -0.05, 0.05);
    bk.add(M.paper, n);
  }

  // ── upper glazed section with binder shelves ─────────────────────────────
  const upperH = h - midY - 0.03;
  const tiers = 3;
  const tierH = upperH / tiers;
  for (let t = 1; t < tiers; t++) {
    bk.add(M.machineIvory, box(inner, 0.014, d - 0.05, M.machineIvory, 0, midY + t * tierH, 0.012));
  }
  if (binders) {
    const palette = [
      LM.binderCream(), LM.binderCream(), LM.binderCream(),
      LM.binderBlue(), LM.binderOrange(), M.plasticDark,
    ];
    for (let t = 0; t < tiers; t++) {
      const shelfY = midY + t * tierH + 0.01;
      let x = -inner / 2 + 0.018;
      const limit = inner / 2 - 0.03;
      while (x < limit) {
        if (rng() < 0.14) {
          x += rf(rng, 0.03, 0.10); // a gap where files have been pulled out
          continue;
        }
        const th = rf(rng, 0.026, 0.072);
        if (x + th > limit) break;
        const bh = Math.min(tierH - 0.035, rf(rng, 0.22, 0.30));
        const mat = pick(rng, palette);
        const b = boxOn(th, bh, d - 0.12, mat, x + th / 2, shelfY + 0.004, 0.02);
        if (rng() < 0.10) b.rotation.z = rf(rng, -0.16, 0.16);
        bk.add(mat, b);
        x += th + 0.004;
      }
      // an occasional stack of files laid flat on top of the uprights
      if (rng() < 0.45) {
        bk.add(
          LM.binderCream(),
          boxOn(rf(rng, 0.16, 0.28), rf(rng, 0.03, 0.07), d - 0.16, LM.binderCream(), rf(rng, -0.15, 0.2), shelfY + 0.26, 0.02),
        );
      }
    }
  }
  if (glass) {
    for (const sx of [-1, 1]) {
      bk.add(
        M.glass,
        box(inner / 2 + 0.01, upperH - 0.02, 0.005, M.glass, sx * (inner / 4), midY + upperH / 2, -d / 2 + (sx < 0 ? 0.014 : 0.026)),
      );
    }
  }

  return bk.weldInto(g, 'storageCabinet');
}

// ────────────────────────────────────────────────────────────────────────────
// Racks
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mint pigeon-hole parts rack — the big sage-green shelves that dominate the
 * left of the photograph. A closed base, `rows` shelves each carrying a bright
 * YELLOW label strip along its front lip, and `bays × cols` open pigeon-holes
 * irregularly stuffed with bar stock, kraft, paperwork and small parts.
 * Origin: centre of the footprint on the floor, open faces looking −Z.
 *
 * @param {number} bays number of side-by-side frame modules (0.55 m each)
 * @param {number} cols pigeon-hole columns per bay
 * @param {number} rows shelf rows
 * @param {object} [o]
 * @param {number}  [o.bayW=0.55]   width of one bay
 * @param {number}  [o.depth=0.34]
 * @param {number}  [o.cellH=0.19]  clear height of one pigeon-hole
 * @param {number}  [o.plinthH=0.42] height of the closed base
 * @param {number}  [o.fill=0.68]   probability a pigeon-hole has something in it
 * @param {boolean} [o.topClutter=true]
 * @param {number}  [o.seed=4409]
 * @returns {THREE.Group} 'shelfRack'
 */
export function buildShelfRack(bays = 4, cols = 6, rows = 4, o = {}) {
  const {
    bayW = 0.55,
    depth = 0.34,
    cellH = 0.19,
    plinthH = 0.42,
    fill = 0.68,
    topClutter = true,
    seed = 4409,
  } = o;
  const rng = makeRng(seed);
  const bk = bucketSet();
  const g = root('shelfRack');

  const W = bays * bayW;
  const gridH = rows * cellH;
  const capY = plinthH + gridH;
  const H = capY + 0.04; // top of the cap board — where the top clutter sits
  const shelfT = 0.018;
  const frontZ = -depth / 2;

  // ── base ─────────────────────────────────────────────────────────────────
  bk.add(M.shelfGreenDark, boxOn(W - 0.05, 0.07, depth - 0.05, M.shelfGreenDark, 0, 0, 0));
  bk.add(M.shelfGreen, boxOn(W, plinthH - 0.07, depth, M.shelfGreen, 0, 0.07, 0));

  // ── frame ────────────────────────────────────────────────────────────────
  for (let i = 0; i <= bays; i++) {
    const x = -W / 2 + i * bayW;
    bk.add(M.shelfGreen, box(0.045, gridH, depth, M.shelfGreen, x, plinthH + gridH / 2, 0));
  }
  for (let r = 0; r <= rows; r++) {
    bk.add(M.shelfGreen, box(W, shelfT, depth, M.shelfGreen, 0, plinthH + r * cellH, 0));
  }
  bk.add(M.shelfGreen, box(W + 0.04, 0.04, depth + 0.03, M.shelfGreen, 0, capY + 0.02, 0));
  bk.add(M.shelfGreenDark, box(W, gridH, 0.014, M.shelfGreenDark, 0, plinthH + gridH / 2, depth / 2 - 0.007));

  // ── pigeon-hole dividers + the yellow label strips ───────────────────────
  const cw = bayW / cols;
  for (let r = 0; r < rows; r++) {
    const cellY = plinthH + r * cellH + shelfT / 2 + (cellH - shelfT) / 2;
    for (let b = 0; b < bays; b++) {
      for (let c = 1; c < cols; c++) {
        const x = -W / 2 + b * bayW + c * cw;
        bk.add(M.shelfGreen, box(0.010, cellH - shelfT, depth - 0.03, M.shelfGreen, x, cellY, 0));
      }
    }
    bk.add(
      M.floorYellow,
      box(W, 0.024, 0.008, M.floorYellow, 0, plinthH + r * cellH + shelfT + 0.012, frontZ + 0.004),
    );
  }

  // ── irregular contents ───────────────────────────────────────────────────
  for (let r = 0; r < rows; r++) {
    const floorY = plinthH + r * cellH + shelfT;
    const clear = cellH - shelfT;
    for (let b = 0; b < bays; b++) {
      for (let c = 0; c < cols; c++) {
        if (rng() > fill) continue;
        const cx = -W / 2 + b * bayW + (c + 0.5) * cw;
        const roll = rng();
        if (roll < 0.42) {
          // bundles of bar stock / tooling poking out of the front
          const n = ri(rng, 2, 4);
          for (let i = 0; i < n; i++) {
            const t = cw * rf(rng, 0.14, 0.26);
            const bh = rf(rng, 0.012, 0.030);
            const len = depth * rf(rng, 0.62, 0.98);
            bk.add(
              M.steelBrushed,
              boxOn(t, bh, len, M.steelBrushed, cx + (i - (n - 1) / 2) * (cw / n), floorY + 0.002, rf(rng, -0.03, 0.03)),
            );
          }
        } else if (roll < 0.62) {
          bk.add(
            M.cardboard,
            kraft(rng, cx, floorY + 0.001, rf(rng, -0.01, 0.03), cw - rf(rng, 0.015, 0.035), rf(rng, 0.05, clear - 0.02), depth - rf(rng, 0.07, 0.13)),
          );
        } else if (roll < 0.79) {
          bk.add(
            LM.label(),
            boxOn(cw - 0.02, rf(rng, 0.03, 0.08), depth - 0.09, LM.label(), cx, floorY + 0.001, rf(rng, -0.02, 0.04)),
          );
        } else if (roll < 0.95) {
          bk.add(
            M.binBlack,
            boxOn(cw - rf(rng, 0.02, 0.04), rf(rng, 0.035, 0.07), depth * rf(rng, 0.5, 0.75), M.binBlack, cx, floorY + 0.001, rf(rng, -0.02, 0.05)),
          );
        } else {
          bk.add(
            M.binRed,
            boxOn(cw - 0.022, 0.055, depth * 0.6, M.binRed, cx, floorY + 0.001, 0.01),
          );
        }
      }
    }
  }

  // ── stuff dumped on top ──────────────────────────────────────────────────
  if (topClutter) {
    const n = ri(rng, 2, 3);
    for (let i = 0; i < n; i++) {
      bk.add(
        M.cardboard,
        kraft(rng, rf(rng, -W * 0.4, W * 0.4), H, rf(rng, -0.05, 0.05), rf(rng, 0.22, 0.4), rf(rng, 0.14, 0.26), rf(rng, 0.2, 0.3)),
      );
    }
    bk.add(
      LM.label(),
      boxOn(0.24, 0.045, 0.32, LM.label(), rf(rng, -W * 0.3, W * 0.3), H, rf(rng, -0.03, 0.03)),
    );
  }

  return bk.weldInto(g, 'shelfRack');
}

/**
 * Small-parts bin rack — a mint frame carrying a dense grid of tiny near-black
 * bins, each with a pale label window, plus a lower shelf with a red tote.
 * The dark grid is one InstancedMesh (CONTRACT rule 7).
 * Origin: centre of the footprint on the floor, bins facing −Z.
 *
 * @param {number} cols bins across
 * @param {number} rows bins high
 * @param {object} [o]
 * @param {number}  [o.binW=0.108] @param {number} [o.binH=0.09] @param {number} [o.binD=0.15]
 * @param {number}  [o.standH=0.40] height of the frame below the bin grid
 * @param {boolean} [o.lowerShelf=true]
 * @param {boolean} [o.topClutter=true]
 * @param {number}  [o.seed=4511]
 * @returns {THREE.Group} 'binRack'
 */
export function buildBinRack(cols = 8, rows = 6, o = {}) {
  const {
    binW = 0.108,
    binH = 0.09,
    binD = 0.15,
    standH = 0.40,
    lowerShelf = true,
    topClutter = true,
    seed = 4511,
  } = o;
  const rng = makeRng(seed);
  const bk = bucketSet();
  const g = root('binRack');

  const gridW = cols * binW;
  const gridH = rows * binH;
  const W = gridW + 0.056;
  const D = binD + 0.055;
  const H = standH + gridH + 0.055;
  const frontZ = -D / 2;

  // ── frame ────────────────────────────────────────────────────────────────
  for (const sx of [-1, 1]) {
    bk.add(M.shelfGreen, boxOn(0.028, H - 0.03, D, M.shelfGreen, sx * (W / 2 - 0.014), 0.03, 0));
  }
  bk.add(M.shelfGreen, box(W + 0.03, 0.03, D + 0.02, M.shelfGreen, 0, H - 0.015, 0));
  bk.add(M.shelfGreenDark, boxOn(W - 0.05, 0.03, D - 0.03, M.shelfGreenDark, 0, 0, 0));
  bk.add(M.shelfGreenDark, box(gridW, gridH, 0.012, M.shelfGreenDark, 0, standH + gridH / 2, D / 2 - 0.006));
  for (let r = 0; r <= rows; r++) {
    bk.add(M.shelfGreenDark, box(gridW, 0.007, D - 0.02, M.shelfGreenDark, 0, standH + r * binH, 0));
  }
  if (cols >= 8) {
    bk.add(M.shelfGreenDark, box(0.012, gridH, D - 0.02, M.shelfGreenDark, 0, standH + gridH / 2, 0));
  }
  if (lowerShelf) {
    bk.add(M.shelfGreen, box(W - 0.05, 0.022, D - 0.03, M.shelfGreen, 0, standH * 0.46, 0));
  }

  // ── the bin grid ─────────────────────────────────────────────────────────
  const binGeo = boxGeo(binW - 0.008, binH - 0.012, binD);
  const labGeo = boxGeo(binW - 0.030, 0.016, 0.004);
  const dark = [];
  const labels = [];
  const reds = [];
  const blues = [];
  const binZ = frontZ + binD / 2 + 0.008;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -gridW / 2 + (c + 0.5) * binW;
      const y = standH + (r + 0.5) * binH;
      const roll = rng();
      if (roll < 0.045) reds.push(box(binW - 0.008, binH - 0.012, binD, M.binRed, x, y, binZ));
      else if (roll < 0.075) blues.push(box(binW - 0.008, binH - 0.012, binD, M.binBlue, x, y, binZ));
      else dark.push({ pos: [x, y, binZ] });
      labels.push({ pos: [x, y + binH * 0.26, binZ - binD / 2 - 0.003] });
    }
  }
  if (dark.length) {
    const im = instance(binGeo, M.binBlack, dark);
    im.name = 'binRack_bins';
    g.add(im);
  }
  if (labels.length) {
    const il = instance(labGeo, LM.label(), labels);
    il.name = 'binRack_labels';
    il.castShadow = false;
    g.add(il);
  }
  bk.add(M.binRed, reds);
  bk.add(M.binBlue, blues);

  // ── the red tote and kraft under the grid, clutter on top ────────────────
  if (lowerShelf) {
    bk.add(M.binRed, boxOn(Math.min(0.42, W - 0.16), 0.135, D - 0.09, M.binRed, rf(rng, -0.05, 0.06), standH * 0.46 + 0.011, 0.01));
    bk.add(M.cardboard, kraft(rng, -W * 0.28, 0.03, 0.02, 0.24, rf(rng, 0.1, 0.16), D - 0.09));
  }
  if (topClutter) {
    bk.add(M.cardboard, kraft(rng, rf(rng, -W * 0.25, W * 0.25), H, 0, rf(rng, 0.26, 0.36), rf(rng, 0.12, 0.2), D - 0.05));
    bk.add(LM.label(), boxOn(0.2, 0.04, D - 0.09, LM.label(), rf(rng, -W * 0.3, W * 0.3), H, 0.01));
  }

  return bk.weldInto(g, 'binRack');
}

/**
 * Green wire roll cage (かご車) — tube frame, ladder-mesh on three sides, a
 * steel deck, four castors and (by default) overflowing cardboard. Five of
 * these cluster in the mid-left of the photograph.
 * Origin: centre of the footprint on the floor, the OPEN side faces −Z.
 *
 * @param {number} w  width (X)
 * @param {number} d  depth (Z)
 * @param {number} h  height of the top rail
 * @param {object} [o]
 * @param {boolean} [o.cargo=true]  cardboard stacked on the deck
 * @param {boolean} [o.gate=true]   a low mesh gate across the open front
 * @param {number}  [o.seed=4613]
 * @returns {THREE.Group} 'rollCage'
 */
export function buildRollCage(w = 0.8, d = 1.1, h = 1.7, o = {}) {
  const { cargo = true, gate = true, seed = 4613 } = o;
  const rng = makeRng(seed);
  const bk = bucketSet();
  const g = root('rollCage');

  const tr = 0.016;
  const deckY = 0.175;
  const px = w / 2 - 0.022;
  const pz = d / 2 - 0.022;

  // corner posts
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      bk.add(M.cageGreen, cyl(tr, h - deckY + 0.05, M.cageGreen, sx * px, deckY + (h - deckY) / 2, sz * pz, 8));
    }
  }
  // base, top and mid rails. The back (+Z) gets a rail at every level; the
  // open front (−Z) only closes at the base and the top.
  const rails = [deckY - 0.035, h, deckY + (h - deckY) * 0.52];
  rails.forEach((y, i) => {
    bk.add(M.cageGreen, cylX(tr, w - 0.02, M.cageGreen, 0, y, pz, 8));
    if (i < 2) bk.add(M.cageGreen, cylX(tr, w - 0.02, M.cageGreen, 0, y, -pz, 8));
    for (const sx of [-1, 1]) {
      const side = cyl(tr, d - 0.02, M.cageGreen, sx * px, y, 0, 8);
      side.rotation.x = Math.PI / 2;
      bk.add(M.cageGreen, side);
    }
  });
  // deck
  bk.add(M.galv, box(w - 0.035, 0.022, d - 0.035, M.galv, 0, deckY, 0));

  // ── mesh panels: back (+Z) and the two sides; front left open ────────────
  const panelH = h - deckY - 0.04;
  const panelY = deckY + 0.02 + panelH / 2;
  const back = new THREE.Mesh(meshPanelGeo(w - 0.05, panelH), M.cageMesh);
  back.position.set(0, panelY, pz - 0.004);
  bk.add(M.cageMesh, back);
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(meshPanelGeo(d - 0.05, panelH), M.cageMesh);
    side.position.set(sx * (px - 0.004), panelY, 0);
    side.rotation.y = Math.PI / 2;
    bk.add(M.cageMesh, side);
  }
  if (gate) {
    const gh = panelH * 0.42;
    const gm = new THREE.Mesh(meshPanelGeo(w - 0.05, gh), M.cageMesh);
    gm.position.set(0, deckY + 0.02 + gh / 2, -pz + 0.004);
    bk.add(M.cageMesh, gm);
    bk.add(M.cageGreen, cylX(tr * 0.85, w - 0.02, M.cageGreen, 0, deckY + 0.02 + gh, -pz, 8));
  }

  // castors (painted brackets, like the photo)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (w / 2 - 0.075);
      const z = sz * (d / 2 - 0.085);
      bk.add(M.cageGreen, boxOn(0.055, 0.075, 0.05, M.cageGreen, x, 0.055, z));
      bk.add(M.rubberBlack, cylX(0.052, 0.028, M.rubberBlack, x, 0.052, z, 10));
    }
  }

  // ── cargo ────────────────────────────────────────────────────────────────
  if (cargo) {
    let y = deckY + 0.011;
    const layers = ri(rng, 2, 4);
    for (let i = 0; i < layers; i++) {
      const bw = (w - 0.09) * rf(rng, 0.55, 0.98);
      const bd = (d - 0.09) * rf(rng, 0.5, 0.95);
      const bh = rf(rng, 0.18, 0.34);
      const b = kraft(rng, rf(rng, -0.06, 0.06), y, rf(rng, -0.08, 0.08), bw, bh, bd);
      b.rotation.y = rf(rng, -0.16, 0.16);
      bk.add(M.cardboard, b);
      y += bh - 0.004;
    }
  }

  return bk.weldInto(g, 'rollCage');
}

// ────────────────────────────────────────────────────────────────────────────
// Seating
// ────────────────────────────────────────────────────────────────────────────

/**
 * Charcoal task chair: padded seat and low back, gas lift, five-star base on
 * castors — the chair pulled up to the bench on the right wall.
 * Origin: centre of the base on the floor; the seat back is at +Z so the chair
 * faces −Z.
 *
 * @param {object} [o]
 * @param {string} [o.seatKey='plasticDark'] materials.js key for the upholstery
 * @returns {THREE.Group} 'officeChair'
 */
export function buildOfficeChair(o = {}) {
  const { seatKey = 'plasticDark' } = o;
  const bk = bucketSet();
  const g = root('officeChair');
  const seatMat = M[seatKey];

  // five-star base
  bk.add(M.plasticDark, cyl(0.05, 0.07, M.plasticDark, 0, 0.085, 0, 10));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.31;
    const arm = box(0.26, 0.028, 0.05, M.plasticDark);
    arm.position.set(Math.cos(a) * 0.14, 0.072, Math.sin(a) * 0.14);
    arm.rotation.y = -a;
    bk.add(M.plasticDark, arm);
    const wheel = cylX(0.027, 0.022, M.rubberBlack, Math.cos(a) * 0.255, 0.029, Math.sin(a) * 0.255, 10);
    wheel.rotation.y = -a;
    bk.add(M.rubberBlack, wheel);
  }
  // column
  bk.add(M.steelDark, cyl(0.031, 0.30, M.steelDark, 0, 0.25, 0, 10));
  bk.add(M.plasticDark, cyl(0.048, 0.15, M.plasticDark, 0, 0.185, 0, 10));

  // seat
  bk.add(M.steelDark, box(0.40, 0.045, 0.38, M.steelDark, 0, 0.418, 0));
  bk.add(seatMat, box(0.45, 0.075, 0.43, seatMat, 0, 0.472, -0.005));

  // back
  const stem = box(0.07, 0.26, 0.05, M.steelDark, 0, 0.60, 0.185);
  stem.rotation.x = -0.13;
  bk.add(M.steelDark, stem);
  const backRest = box(0.42, 0.34, 0.065, seatMat, 0, 0.79, 0.205);
  backRest.rotation.x = -0.15;
  bk.add(seatMat, backRest);

  return bk.weldInto(g, 'officeChair');
}

/**
 * Round shop stool: vinyl seat, four splayed steel tube legs, a foot ring and
 * rubber feet. Origin at the centre of its footprint on the floor.
 *
 * @param {object} [o]
 * @param {number} [o.h=0.60] seat height
 * @param {number} [o.r=0.16] seat radius
 * @param {string} [o.seatKey='plasticDark'] 'machineMint' reads as the pale
 *        mint stools by the benches; 'binBlue' as the blue one by the desks
 * @returns {THREE.Group} 'stool'
 */
export function buildStool(o = {}) {
  const { h = 0.60, r = 0.16, seatKey = 'plasticDark' } = o;
  const bk = bucketSet();
  const g = root('stool');
  const seatMat = M[seatKey];

  bk.add(seatMat, cyl(r, 0.05, seatMat, 0, h - 0.025, 0, 16));
  bk.add(M.steelDark, cyl(r * 0.86, 0.018, M.steelDark, 0, h - 0.058, 0, 14));

  const spread = r * 1.25;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const top = V3(sx * r * 0.55, h - 0.062, sz * r * 0.55);
      const foot = V3(sx * spread, 0.022, sz * spread);
      bk.add(M.steelDark, cylBetween(0.0135, M.steelDark, top, foot, 8));
      bk.add(M.rubberBlack, cyl(0.017, 0.022, M.rubberBlack, sx * spread, 0.011, sz * spread, 8));
    }
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.92, 0.0085, 5, 16), M.steelDark);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.235;
  bk.add(M.steelDark, ring);

  return bk.weldInto(g, 'stool');
}

// ────────────────────────────────────────────────────────────────────────────
// Boards, trolleys, screens
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mobile whiteboard on a rolling A-frame stand, with the little black camera
 * clipped to its top rail that appears in the photo. Origin at the centre of
 * the footprint on the floor; the writing face looks −Z.
 *
 * @param {number} w  board width
 * @param {number} h  board height
 * @param {object} [o]
 * @param {number}  [o.boardBottom=0.82] height of the bottom of the board
 * @param {boolean} [o.camera=true]
 * @param {boolean} [o.castors=true]
 * @returns {THREE.Group} 'whiteboardStand'
 */
export function buildWhiteboardStand(w = 1.2, h = 0.9, o = {}) {
  const { boardBottom = 0.82, camera = true, castors = true } = o;
  const bk = bucketSet();
  const g = root('whiteboardStand');

  const cy = boardBottom + h / 2;
  // carcass + aluminium surround
  bk.add(LM.boardCore(), box(w - 0.05, h - 0.05, 0.022, LM.boardCore(), 0, cy, 0));
  bk.add(
    M.aluPlain,
    box(w, 0.045, 0.032, M.aluPlain, 0, boardBottom + h - 0.022, 0),
    box(w, 0.045, 0.032, M.aluPlain, 0, boardBottom + 0.022, 0),
    box(0.045, h, 0.032, M.aluPlain, -(w / 2 - 0.022), cy, 0),
    box(0.045, h, 0.032, M.aluPlain, w / 2 - 0.022, cy, 0),
  );
  // the printed face
  bk.add(M.whiteboard, billboard(w - 0.09, h - 0.09, M.whiteboard, 0, cy, -0.013, Math.PI));
  // pen tray
  const tray = box(w * 0.55, 0.026, 0.07, M.aluPlain, 0, boardBottom - 0.03, -0.045);
  tray.rotation.x = 0.22;
  bk.add(M.aluPlain, tray);

  // stand
  const wheelR = castors ? 0.038 : 0;
  const railY = wheelR + 0.016;
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.13);
    bk.add(M.steelWhiteDark, boxOn(0.045, boardBottom + 0.08 - railY, 0.045, M.steelWhiteDark, x, railY, 0.032));
    bk.add(M.steelWhiteDark, box(0.06, 0.032, 0.46, M.steelWhiteDark, x, railY, 0.01));
  }
  bk.add(M.steelWhiteDark, box(w - 0.26, 0.03, 0.03, M.steelWhiteDark, 0, boardBottom * 0.5, 0.032));
  if (castors) addCastors(bk, w - 0.14, 0.5, wheelR, M.steelWhiteDark);

  if (camera) {
    bk.add(
      M.plasticDark,
      box(0.10, 0.045, 0.05, M.plasticDark, w * 0.13, boardBottom + h + 0.03, 0),
      box(0.03, 0.05, 0.03, M.plasticDark, w * 0.13, boardBottom + h - 0.005, 0),
    );
    const lens = cyl(0.014, 0.02, M.plasticDark, w * 0.13, boardBottom + h + 0.03, -0.032, 10);
    lens.rotation.x = Math.PI / 2;
    bk.add(M.plasticDark, lens);
  }

  return bk.weldInto(g, 'whiteboardStand');
}

/**
 * Mint two-shelf hand trolley (台車): lipped mint shelves on painted posts, a
 * push handle at the back, four castors and a small red duty plate.
 * Origin: centre of the footprint on the floor; the push handle is at +Z so
 * the trolley "faces" −Z.
 *
 * @param {number} w  width (X)
 * @param {number} d  depth (Z)
 * @param {object} [o]
 * @param {number}  [o.topY=0.80] @param {number} [o.midY=0.24]
 * @param {number}  [o.handleY=1.00]
 * @param {boolean} [o.cargo=true] seeded cardboard / a blue tote on the shelves
 * @param {number}  [o.seed=4821]
 * @returns {THREE.Group} 'trolley'
 */
export function buildTrolley(w = 0.6, d = 0.9, o = {}) {
  const { topY = 0.80, midY = 0.24, handleY = 1.00, cargo = true, seed = 4821 } = o;
  const rng = makeRng(seed);
  const bk = bucketSet();
  const g = root('trolley');

  // shelves + lips
  for (const y of [midY, topY]) {
    bk.add(M.machineMint, box(w, 0.026, d, M.machineMint, 0, y, 0));
    bk.add(
      M.machineMintDark,
      box(w, 0.022, 0.016, M.machineMintDark, 0, y + 0.023, -d / 2 + 0.008),
      box(w, 0.022, 0.016, M.machineMintDark, 0, y + 0.023, d / 2 - 0.008),
      box(0.016, 0.022, d, M.machineMintDark, -w / 2 + 0.008, y + 0.023, 0),
      box(0.016, 0.022, d, M.machineMintDark, w / 2 - 0.008, y + 0.023, 0),
    );
  }
  // posts
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      bk.add(
        M.machineMintDark,
        boxOn(0.032, topY - 0.13, 0.032, M.machineMintDark, sx * (w / 2 - 0.032), 0.13, sz * (d / 2 - 0.038)),
      );
    }
  }
  // push handle
  for (const sx of [-1, 1]) {
    bk.add(
      M.machineMintDark,
      boxOn(0.03, handleY - topY, 0.03, M.machineMintDark, sx * (w / 2 - 0.04), topY, d / 2 - 0.04),
    );
  }
  bk.add(M.machineMintDark, cylX(0.016, w - 0.05, M.machineMintDark, 0, handleY, d / 2 - 0.04, 10));

  addCastors(bk, w, d, 0.052, M.steelDark);
  bk.add(M.binRed, box(0.15, 0.05, 0.006, M.binRed, 0, midY + 0.05, -d / 2 - 0.004));

  if (cargo) {
    const n = ri(rng, 1, 3);
    let y = topY + 0.013;
    for (let i = 0; i < n; i++) {
      const bh = rf(rng, 0.13, 0.24);
      bk.add(M.cardboard, kraft(rng, rf(rng, -0.08, 0.08), y, rf(rng, -0.14, 0.14), rf(rng, 0.26, w - 0.06), bh, rf(rng, 0.24, d * 0.55)));
      y += bh - 0.005;
    }
    bk.add(M.binBlue, boxOn(rf(rng, 0.24, 0.32), 0.16, 0.26, M.binBlue, rf(rng, -0.08, 0.08), midY + 0.013, rf(rng, -0.2, 0.2)));
    bk.add(LM.label(), boxOn(0.22, 0.06, 0.3, LM.label(), rf(rng, -0.1, 0.1), midY + 0.013, rf(rng, 0.1, 0.28)));
  }

  return bk.weldInto(g, 'trolley');
}

/**
 * Free-standing white vinyl partition screen — the tall pale panels that hide
 * the desk area from the aisle. A light aluminium frame, two flat feet and a
 * slack, softly wrinkled vinyl sheet stretched across it.
 * Origin: centre of the footprint on the floor; the panel lies in the XY plane
 * and its front looks −Z.
 *
 * @param {number} w  overall width
 * @param {number} h  overall height
 * @param {object} [o]
 * @param {number} [o.footD=0.36] depth of the outrigger feet
 * @param {number} [o.wrinkle=1]  multiplier on the sheet's slack
 * @param {number} [o.seed=4923]
 * @returns {THREE.Group} 'partitionScreen'
 */
export function buildPartitionScreen(w = 1.6, h = 1.7, o = {}) {
  const { footD = 0.36, wrinkle = 1, seed = 4923 } = o;
  const rng = makeRng(seed);
  const bk = bucketSet();
  const g = root('partitionScreen');

  const post = 0.032;
  const sillY = 0.13;

  // frame
  for (const sx of [-1, 1]) {
    bk.add(M.aluPlain, boxOn(post, h, post, M.aluPlain, sx * (w / 2 - post / 2), 0, 0));
  }
  bk.add(
    M.aluPlain,
    box(w, post, post, M.aluPlain, 0, h - post / 2, 0),
    box(w, post * 0.8, post * 0.8, M.aluPlain, 0, sillY, 0),
    box(post * 0.7, h - sillY - post, post * 0.7, M.aluPlain, 0, sillY + (h - sillY - post) / 2, 0.006),
  );

  // flat outrigger feet under each frame post
  for (const sx of [-1, 1]) {
    bk.add(
      M.steelWhiteDark,
      boxOn(0.055, 0.026, footD, M.steelWhiteDark, sx * (w / 2 - post / 2), 0, 0),
    );
  }

  // the slack vinyl sheet
  const sw = w - post * 2;
  const sh = h - sillY - post;
  const geo = new THREE.PlaneGeometry(sw, sh, 12, 8);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const edge =
      Math.min(1, (sw / 2 - Math.abs(x)) / 0.14) * Math.min(1, (sh / 2 - Math.abs(y)) / 0.14);
    const z =
      (Math.sin(x * 7.3 + 1.1) * 0.0075 +
        Math.sin(x * 16.5 + y * 2.4) * 0.0035 +
        (rng() - 0.5) * 0.0035) *
      Math.max(0, edge) *
      wrinkle;
    pos.setZ(i, z - 0.008);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const sheetMesh = new THREE.Mesh(geo, LM.vinyl());
  sheetMesh.position.set(0, sillY + sh / 2, 0);
  bk.add(LM.vinyl(), sheetMesh);

  return bk.weldInto(g, 'partitionScreen');
}
