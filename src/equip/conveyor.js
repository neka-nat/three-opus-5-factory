/**
 * conveyor.js — the gravity roller conveyor that runs down the foreground of
 * img01.jpg, the aluminium-extrusion portals / guard frames that surround the
 * robot cell, and the brushed sheet-metal workpieces the robots handle.
 *
 * What the photograph actually shows (crops I, E, F and the tight centre crop):
 *
 *   • A bed of *very* tightly pitched polished aluminium rollers — the single
 *     brightest, most specular thing in the frame.
 *   • The bed is split down the middle by a narrow **dark longitudinal slot**
 *     carrying a black belt/chain, with a small grey stopper block capped in
 *     bright yellow sitting astride it, and a white nylon guide block nearby.
 *   • The run is assembled from ~4.6 m modules: at each butt joint the rollers
 *     stop for a hand's width and a **cream cross deck plate with mustard
 *     yellow end pads** and small blue/black sensor bodies shows through.
 *   • Side frames = cream painted channels, with a silver T-slot **aluminium
 *     extrusion rail** capping the top edge just outboard of the roller ends.
 *   • 60 × 60 silver extrusion legs on levelling feet, cross-braced low down.
 *   • Black cable festoons and a cable duct hang under the right-hand frame;
 *     photo-eye sensors on little brackets poke over the rail; a yellow
 *     guide-rail strip runs along the outside of the right-hand channel.
 *
 * Everything is bucketed by material and merged (`mergeGroup`) so the whole
 * conveyor costs ~12 draw calls plus two InstancedMeshes.
 */
import * as THREE from 'three';
import { CFG } from '../core/config.js';
import { M, variant } from '../core/materials.js';
import {
  box, boxGeo, cable, catenary, cyl, cylGeo, group, instance, makeRng,
  mergeGroup, rf, V3,
} from '../core/utils.js';

// ────────────────────────────────────────────────────────────────────────────
// Module-local material variants (materials.js is frozen — these are cached
// clones, so touching them repeatedly is free).
// ────────────────────────────────────────────────────────────────────────────
const MAT = {
  /**
   * The rollers themselves — turned, polished aluminium tube, and by a wide
   * margin the most specular thing in the photograph.
   *
   * Three things have to line up for the bed to read the way it does in crops
   * I and E, i.e. a bank of visibly *round* rollers under a long blown-out
   * specular streak:
   *
   *  1. Near-total metalness, so essentially everything you see is the
   *     environment: the PMREM room's clerestory band, its ceiling bounce card
   *     and the two batten strips are what draw the long specular streak down
   *     the run. `rollerAlu` already carries the fine turned-finish roughness
   *     map (`T.alumRough()`, green channel ≈ 0.24 on average) and the material's
   *     `roughness` scalar *multiplies* it, so 0.66 lands the surface at ≈ 0.16
   *     — tight enough for those to stay separate features rather than smear
   *     into one flat wash, loose enough not to alias at 2 px per roller.
   *     The 6 % of non-metal is deliberate: that sliver of diffuse lifts the
   *     down-facing flanks, which otherwise see only the dark green floor of
   *     the PMREM room and go far blacker than any gap in the photograph.
   *  2. Level and tint taken by measurement. The bed in `img01.jpg` samples at
   *     p10 ≈ 147, median ≈ 187, p90 ≈ 205 sRGB with a distinct B > G > R cast
   *     — bright, low-contrast, cool, with the glare band clipping on top.
   *     `envMapIntensity` and the slightly blue F0 below were fitted to that.
   *  3. Real gaps between the rollers, see `buildRollerConveyor`.
   */
  get roller() {
    return variant('rollerAlu', {
      // Faintly cool: the bed in the photograph is B > G > R (the daylight off
      // the window wall wins over the green bounce off the floor).
      color: 0xc1c7d1,
      roughness: 0.66,
      metalness: 0.94,
      envMapIntensity: 1.5,
    }, 'convRollerPolish');
  },
  /** Bright safety yellow — stopper cap, guide strip. */
  get yellow() {
    return variant('hoistYellow', { roughness: 0.58, metalness: 0.06 }, 'convYellow');
  },
  /** Duller mustard yellow of the moulded end pads on each conveyor module. */
  get yellowPad() {
    return variant('hoistYellow', { color: 0xd3a11e, roughness: 0.7, metalness: 0.04 }, 'convPad');
  },
  /** The near-black interior of the centre slot. */
  get slotDark() {
    return variant('cncBlack', { color: 0x25272b, roughness: 0.62, metalness: 0.22 }, 'convSlot');
  },
  /** Bright sheared edge of a sheet-metal blank. */
  get sheetEdge() {
    return variant('steelDark', { color: 0x8d9297, roughness: 0.42, metalness: 0.88 }, 'sheetEdge');
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Draw-call bucketing: collect meshes per material, then merge each bucket.
// ────────────────────────────────────────────────────────────────────────────
function bucket() {
  const bins = new Map();
  return {
    /** Add `mesh` to the bin for `mat` and return the mesh (chainable). */
    add(mat, mesh) {
      let g = bins.get(mat);
      if (!g) {
        g = new THREE.Group();
        bins.set(mat, g);
      }
      g.add(mesh);
      return mesh;
    },
    /** Merge every bin into `target`. */
    flush(target, prefix = 'part') {
      let i = 0;
      bins.forEach((g, mat) => {
        const merged = mergeGroup(g, mat);
        merged.name = `${prefix}_${mat.name || i}`;
        i += 1;
        target.add(merged);
      });
      bins.clear();
    },
  };
}

/** 45 × 45 aluminium extrusion is the default section for guarding. */
const EXTRUSION = 0.045;

// ────────────────────────────────────────────────────────────────────────────
// The roller conveyor
// ────────────────────────────────────────────────────────────────────────────

/**
 * Gravity roller conveyor running along Z — the hero of the photograph's
 * foreground.
 *
 * ORIGIN: on the floor (y = 0) at the **centre of the run**, i.e. place the
 * returned group at `(CFG.conveyor.x, 0, (zFrom + zTo) / 2)`. The bed extends
 * ±length/2 in local Z and ±width/2 in local X; roller crowns sit at `topY`.
 * `userData.zCentre` repeats the world Z the caller should use.
 *
 * @param {object} o
 *   @param {number}  [o.zFrom=CFG.conveyor.zFrom]   world Z of the near end
 *   @param {number}  [o.zTo=CFG.conveyor.zTo]       world Z of the far end
 *   @param {number}  [o.width=CFG.conveyor.width]   roller face width (m)
 *   @param {number}  [o.topY=CFG.conveyor.topY]     height of the roller crowns
 *   @param {boolean} [o.withLegs=true]              emit legs, feet and braces
 *   @param {boolean} [o.centreSlot=true]            split bed + belt + stopper
 *   @param {number}  [o.seed=4407]                  deterministic rng seed
 * @returns {THREE.Group} named 'rollerConveyor'
 */
export function buildRollerConveyor(o = {}) {
  const C = CFG.conveyor;
  const {
    zFrom = C.zFrom,
    zTo = C.zTo,
    width = C.width,
    topY = C.topY,
    withLegs = true,
    centreSlot = true,
    seed = 4407,
  } = o;

  const rng = makeRng(seed);
  const g = group('rollerConveyor');
  const B = bucket();

  const len = Math.abs(zFrom - zTo);
  const halfL = len / 2;
  const halfW = width / 2;
  const pitch = C.rollerPitch;
  // The roller barrel must stay clear of its neighbours. At the configured
  // 24 mm radius the ⌀48 mm rollers overlapped the 45 mm pitch, so every
  // cylinder was buried in the next one and only a flat crown strip survived —
  // no gap line, no flank, nothing to shade. Clamping to 0.42 × pitch restores
  // the ⌀38 mm tube-on-45 mm-pitch bed the photograph shows, with a hairline
  // dark gap and ~80° of visible arc per roller.
  const rollerR = Math.min(C.rollerR, pitch * 0.42);
  const rollerCY = topY - rollerR; // crowns stay exactly on topY

  // The centre slot is a *hairline* in the photograph — roughly 20 mm of dark
  // between the two roller banks, plus the shadowed cheeks either side. At
  // 62 mm it drew a black stripe straight down the brightest object in frame.
  const slotW = centreSlot ? 0.046 : 0;
  const slotHalf = slotW / 2;

  // ── module butt joints: rollers stop, a cream deck plate shows through ────
  // The run is assembled from ~4.6 m modules; each butt joint and each run end
  // carries a cream cross deck, so the rollers are suppressed over its width.
  const nModules = Math.max(1, Math.round(len / 4.6));
  const joints = [];
  for (let i = 1; i < nModules; i++) joints.push(-halfL + (len * i) / nModules);
  /** @type {{z:number, len:number, interior:boolean}[]} */
  const decks = joints.map((z) => ({ z, len: 0.215, interior: true }));
  decks.push({ z: -halfL + 0.075, len: 0.150, interior: false });
  decks.push({ z: halfL - 0.075, len: 0.150, interior: false });

  // ── 1 · the rollers, as two InstancedMeshes (near = fine, far = coarse) ──
  const banks = centreSlot
    ? [
      { c: -(slotHalf + (halfW - slotHalf) / 2), l: halfW - slotHalf - 0.008 },
      { c: +(slotHalf + (halfW - slotHalf) / 2), l: halfW - slotHalf - 0.008 },
    ]
    : [{ c: 0, l: width - 0.016 }];

  // Level of detail: a roller crosses ~5 screen pixels at the near end of the
  // run and well under 2 at the far end, so only the first `NEAR_RUN` metres
  // need enough facets to hold a clean specular sweep. Splitting the bed into
  // two InstancedMeshes costs one extra draw call and saves ~2/3 of the
  // triangles the far half would otherwise eat.
  const NEAR_RUN = 12.0; // metres kept high-poly, measured from the +Z (camera) end
  const SEG_NEAR = 24; // 15° per facet — the highlight band sweeps smoothly
  const SEG_FAR = 10;
  const splitZ = halfL - NEAR_RUN;

  const nAcross = Math.max(2, Math.floor(len / pitch) + 1);
  const rollSpan = (nAcross - 1) * pitch;
  const rollZ0 = -rollSpan / 2;
  const nearTx = [];
  const farTx = [];
  for (let i = 0; i < nAcross; i++) {
    const z = rollZ0 + i * pitch;
    let blocked = false;
    for (let j = 0; j < decks.length; j++) {
      if (Math.abs(z - decks[j].z) < decks[j].len / 2 + rollerR) { blocked = true; break; }
    }
    if (blocked) continue;
    const into = z >= splitZ ? nearTx : farTx;
    for (const bnk of banks) {
      into.push({
        // rot.z tips the cylinder onto the X axis; rot.x then spins it about
        // its own axis so the turned-finish roughness map lands differently on
        // each barrel. instance() composes T·R·S, so the [1, l, 1] scale is
        // applied along the cylinder's own axis before it is laid down — and
        // three's instanced-normal path divides by the column lengths, so the
        // barrel normals stay unit-length and the cylinder shades correctly.
        pos: [bnk.c, rollerCY, z],
        rot: [rf(rng, 0, Math.PI * 2), 0, Math.PI / 2],
        scale: [1, bnk.l, 1],
      });
    }
  }
  const rollerCount = nearTx.length + farTx.length;
  [[nearTx, SEG_NEAR, 'Near'], [farTx, SEG_FAR, 'Far']].forEach(([tx, seg, tag]) => {
    if (!tx.length) return;
    const rollers = instance(cylGeo(rollerR, rollerR, 1, seg), MAT.roller, tx);
    rollers.name = `conveyorRollers${tag}`;
    // A ⌀38 mm barrel is thinner than the sun's shadow normal-bias, so letting
    // the bed self-shadow only buys acne. The frame below it still casts.
    rollers.castShadow = false;
    g.add(rollers);
  });

  // ── 2 · centre slot: dark cheeks, black belt, chain cleats, stopper ──────
  if (centreSlot) {
    B.add(MAT.slotDark, box(0.010, 0.10, len, MAT.slotDark, -(slotHalf + 0.005), topY - 0.058, 0));
    B.add(MAT.slotDark, box(0.010, 0.10, len, MAT.slotDark, +(slotHalf + 0.005), topY - 0.058, 0));
    // floor of the slot so you never see daylight through the bed
    B.add(MAT.slotDark, box(slotW + 0.02, 0.010, len, MAT.slotDark, 0, topY - 0.104, 0));
    // the belt itself
    B.add(M.rubberBlack, box(slotW - 0.014, 0.012, len, M.rubberBlack, 0, topY - 0.050, 0));

    // Cleats riding in the slot. In the photo these are a faint dashed line,
    // not a ladder: keep them small, mid-grey and sunk into the slot so they
    // never out-contrast the rollers either side.
    const cleatTx = [];
    for (let z = -halfL + 0.2; z < halfL - 0.2; z += 0.13) {
      cleatTx.push({ pos: [0, topY - 0.044, z] });
    }
    if (cleatTx.length) {
      const cleats = instance(boxGeo(0.022, 0.007, 0.015), M.steelDark, cleatTx);
      cleats.name = 'conveyorBeltCleats';
      g.add(cleats);
    }

    // the yellow-capped stopper / part-locator block
    const stopZ = THREE.MathUtils.clamp(halfL - len * 0.42, -halfL + 0.6, halfL - 0.6);
    B.add(M.galv, box(0.100, 0.090, 0.200, M.galv, 0, topY + 0.010, stopZ));
    B.add(M.galv, box(0.078, 0.030, 0.070, M.galv, 0, topY + 0.068, stopZ + 0.055));
    B.add(MAT.yellow, box(0.058, 0.024, 0.062, MAT.yellow, 0, topY + 0.070, stopZ - 0.058));
    B.add(M.steelDark, box(0.126, 0.052, 0.012, M.steelDark, 0, topY + 0.026, stopZ + 0.104));
    B.add(M.plasticDark, box(0.030, 0.030, 0.046, M.plasticDark, 0.062, topY + 0.006, stopZ + 0.02));

    // the white nylon side guide block sitting on the bed beside it
    B.add(M.plasticWhite, box(0.076, 0.100, 0.160, M.plasticWhite,
      -(halfW - 0.082), topY + 0.030, stopZ + 0.36));

    // two dark rubber location bars lying flat on the rollers
    for (const s of [-1, 1]) {
      B.add(M.plasticDark, box(0.300, 0.007, 0.048, M.plasticDark,
        s * 0.205, topY + 0.006, -halfL + len * 0.34));
    }
  }

  // ── 3 · side frames: cream channel + silver extrusion top rail ───────────
  const railH = 0.055;
  const railW = 0.046;
  const railTop = topY + 0.010;
  const railX = halfW + 0.008 + railW / 2;
  const chTop = railTop - railH;
  const chH = C.frameH;
  const chY = chTop - chH / 2;
  const chBottom = chTop - chH;

  for (const s of [-1, 1]) {
    // T-slot extrusion capping rail (the bright silver line beside the bed)
    B.add(M.aluExtrusion, box(railW, railH, len, M.aluExtrusion, s * railX, railTop - railH / 2, 0));
    // dark inner web the roller ends run in
    B.add(M.machineIvoryDark, box(0.013, 0.090, len, M.machineIvoryDark,
      s * (halfW + 0.0065), topY - 0.055, 0));
    // cream painted side channel
    B.add(M.machineIvory, box(0.062, chH, len, M.machineIvory, s * (halfW + 0.040), chY, 0));
    // its bottom return flange
    B.add(M.machineIvoryDark, box(0.100, 0.016, len, M.machineIvoryDark,
      s * (halfW + 0.048), chBottom + 0.008, 0));
  }

  // bolt bosses along both extrusion rails — >30 repeats, so instanced
  const bossTx = [];
  for (let z = -halfL + 0.22; z < halfL - 0.2; z += 0.45) {
    for (const s of [-1, 1]) {
      bossTx.push({
        pos: [s * (railX + railW / 2 - 0.004), railTop - railH / 2, z],
        rot: [0, 0, Math.PI / 2],
        scale: [1, 0.009, 1],
      });
    }
  }
  if (bossTx.length) {
    const bosses = instance(cylGeo(0.0105, 0.0105, 1, 8), M.steelDark, bossTx);
    bosses.name = 'conveyorRailBolts';
    g.add(bosses);
  }

  // ── 4 · module joint decks + the two run ends ────────────────────────────
  decks.forEach(({ z: jz, len: dLen, interior }) => {
    B.add(M.machineIvory, box(width + 0.086, 0.055, dLen, M.machineIvory, 0, topY - 0.052, jz));
    B.add(M.machineIvoryDark, box(width + 0.086, 0.030, dLen * 0.7, M.machineIvoryDark,
      0, topY - 0.092, jz));
    for (const s of [-1, 1]) {
      // mustard end pads sitting proud of the cream deck
      B.add(MAT.yellowPad, box(0.165, 0.050, dLen * 0.60, MAT.yellowPad,
        s * (halfW - 0.055), topY - 0.032, jz));
      if (interior) {
        // little blue sensor body + black amplifier outboard of the rail
        B.add(M.robotBlue, box(0.050, 0.052, 0.062, M.robotBlue,
          s * (halfW + 0.084), topY - 0.030, jz - 0.03));
        B.add(M.plasticDark, box(0.046, 0.062, 0.086, M.plasticDark,
          s * (halfW + 0.084), topY - 0.030, jz + 0.07));
      }
    }
  });

  // ── 5 · legs, levelling feet and bracing ─────────────────────────────────
  if (withLegs) {
    const legX = halfW + 0.046;
    const legTop = chBottom;
    const footPad = 0.014;
    const legBottom = footPad + 0.020;
    const legH = legTop - legBottom;

    const nLegs = Math.max(2, Math.round(len / C.legPitch) + 1);
    const legStep = (len - 0.7) / (nLegs - 1);
    for (let i = 0; i < nLegs; i++) {
      const z = -halfL + 0.35 + i * legStep;
      for (const s of [-1, 1]) {
        // 60 × 60 extrusion leg
        B.add(M.aluExtrusion, box(0.060, legH, 0.060, M.aluExtrusion, s * legX, legBottom + legH / 2, z));
        // levelling foot: dark pad, bright stud, hex nut
        B.add(M.steelDark, box(0.098, footPad, 0.098, M.steelDark, s * legX, footPad / 2, z));
        B.add(M.galv, cyl(0.013, 0.024, M.galv, s * legX, footPad + 0.010, z, 8));
        B.add(M.galv, cyl(0.021, 0.011, M.galv, s * legX, footPad + 0.026, z, 6));
        // gusset tying the leg head to the channel
        B.add(M.aluPlain, box(0.014, 0.070, 0.070, M.aluPlain,
          s * (legX - 0.038), legTop - 0.035, z));
      }
      // transverse cross-brace low down
      B.add(M.aluExtrusion, box(legX * 2 - 0.06, 0.042, 0.042, M.aluExtrusion, 0, 0.205, z));
    }
    // longitudinal ties down each side
    for (const s of [-1, 1]) {
      B.add(M.aluExtrusion, box(0.042, 0.042, len - 0.78, M.aluExtrusion, s * legX, 0.335, 0));
    }
  }

  // ── 6 · services: cable duct, festoons, photo-eyes, guide strip ──────────
  // black cable duct clipped under the camera-side (+X) channel
  B.add(M.cableBlack, box(0.048, 0.052, len * 0.82, M.cableBlack, halfW + 0.086, topY - 0.170, 0));
  for (let z = -halfL + 0.6; z < halfL - 0.5; z += 1.35) {
    B.add(M.galv, box(0.070, 0.010, 0.026, M.galv, halfW + 0.076, topY - 0.140, z));
  }

  // slack cable festoons looping under the frame (the black bundle in crop I)
  const festGrp = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const z0 = -halfL + len * 0.30 + i * 0.62;
    const a = V3(halfW + 0.086, topY - 0.196, z0);
    const b = V3(halfW + 0.086, topY - 0.196, z0 + 0.58);
    festGrp.add(cable(catenary(a, b, rf(rng, 0.16, 0.28), 12), M.cableBlack, 0.010, 16, 5));
  }
  festGrp.add(cable(
    catenary(V3(halfW + 0.10, topY - 0.21, -halfL + len * 0.28),
      V3(halfW + 0.10, topY - 0.21, -halfL + len * 0.62), 0.12, 14),
    M.cableBlack, 0.014, 18, 5,
  ));
  const festMerged = mergeGroup(festGrp, M.cableBlack);
  festMerged.name = 'conveyorFestoons';
  festMerged.castShadow = false;
  g.add(festMerged);

  // photo-eye sensors on little brackets, alternating sides
  for (let i = 0; i < 6; i++) {
    const s = i % 2 ? 1 : -1;
    const z = -halfL + 0.9 + (len - 1.8) * (i / 5);
    const bx = s * (railX + 0.052);
    B.add(M.aluPlain, box(0.070, 0.010, 0.030, M.aluPlain, s * (railX + 0.026), topY + 0.030, z));
    B.add(M.aluPlain, box(0.012, 0.060, 0.030, M.aluPlain, bx, topY + 0.055, z));
    B.add(M.plasticDark, box(0.032, 0.042, 0.058, M.plasticDark, bx - s * 0.020, topY + 0.086, z));
    B.add(M.robotRed, box(0.006, 0.014, 0.016, M.robotRed, bx - s * 0.038, topY + 0.086, z));
  }

  // yellow guide-rail strip along the outside of the +X channel
  B.add(MAT.yellow, box(0.014, 0.052, len * 0.9, MAT.yellow, halfW + 0.074, topY - 0.098, 0));

  // ── 7 · pneumatic transfer actuators tucked under the near end ───────────
  const actZ = halfL - 0.55;
  for (const s of [-1, 1]) {
    const barrel = cyl(0.026, 0.30, M.aluPlain, s * (halfW - 0.14), topY - 0.24, actZ, 10);
    barrel.rotation.z = Math.PI / 2; // lay the cylinder across the line
    B.add(M.aluPlain, barrel);

    const rod = cyl(0.010, 0.22, M.steelBrushed, s * (halfW - 0.30), topY - 0.24, actZ, 8);
    rod.rotation.z = Math.PI / 2;
    B.add(M.steelBrushed, rod);

    B.add(M.plasticDark, box(0.044, 0.030, 0.030, M.plasticDark,
      s * (halfW - 0.14), topY - 0.208, actZ - 0.02));
  }

  B.flush(g, 'conveyor');

  g.userData = {
    length: len,
    width,
    topY,
    zCentre: (zFrom + zTo) / 2,
    rollerR,
    rollerCount,
    joints,
  };
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Portal frame
// ────────────────────────────────────────────────────────────────────────────

/**
 * Aluminium-extrusion portal straddling the conveyor line — two T-slot posts,
 * a top beam, a mid rail, corner gussets and a cable duct, plus the slim
 * light-curtain strips that face each other across the opening.
 *
 * ORIGIN: on the floor at the centre of the portal's footprint; the frame lies
 * in the XY plane and the line passes through it along Z.
 *
 * @param {number} width  outside width across the posts (X)
 * @param {number} height overall height to the top of the beam (Y)
 * @param {number} depth  section depth of the members (Z)
 * @returns {THREE.Group} named 'portalFrame'
 */
export function buildPortalFrame(width = 2.6, height = 2.1, depth = 0.16) {
  const g = group('portalFrame');
  const B = bucket();

  const postW = 0.090;
  const beamH = 0.100;
  const postX = width / 2 - postW / 2;
  const baseT = 0.016;
  const postH = height - beamH - baseT;

  // top beam, slightly proud of the posts
  B.add(M.aluExtrusion, box(width, beamH, depth, M.aluExtrusion, 0, height - beamH / 2, 0));

  for (const s of [-1, 1]) {
    B.add(M.aluExtrusion, box(postW, postH, depth, M.aluExtrusion, s * postX, baseT + postH / 2, 0));
    // base plate + four levelling studs
    B.add(M.steelDark, box(0.190, baseT, depth + 0.10, M.steelDark, s * postX, baseT / 2, 0));
    for (const dz of [-1, 1]) {
      B.add(M.galv, cyl(0.012, 0.016, M.galv, s * postX + 0.070, 0.008, dz * (depth / 2 + 0.030), 8));
      B.add(M.galv, cyl(0.012, 0.016, M.galv, s * postX - 0.070, 0.008, dz * (depth / 2 + 0.030), 8));
    }
    // 45° knee gusset under the beam
    const knee = box(0.042, 0.30, depth * 0.85, M.aluExtrusion,
      s * (postX - 0.115), height - beamH - 0.105, 0);
    knee.rotation.z = -s * Math.PI / 4; // runs up and outward to the post head
    B.add(M.aluExtrusion, knee);
    // dark corner bracket
    B.add(M.steelDark, box(0.072, 0.072, depth + 0.012, M.steelDark,
      s * (postX - 0.062), height - beamH - 0.040, 0));

    // light-curtain / safety-scanner strip on the inner face of each post
    const cx = s * (postX - postW / 2 - 0.022);
    B.add(M.plasticDark, box(0.040, height * 0.56, 0.042, M.plasticDark, cx, height * 0.40, 0));
    for (let i = 0; i < 3; i++) {
      B.add(M.robotRed, box(0.008, 0.020, 0.026, M.robotRed,
        cx - s * 0.021, height * 0.22 + i * height * 0.18, 0));
    }
  }

  // mid rail between the posts
  B.add(M.aluExtrusion, box(width - postW * 2, 0.050, 0.050, M.aluExtrusion, 0, height * 0.44, 0));
  // cable duct clipped to the camera-facing side of the top beam
  B.add(M.cableBlack, box(width - 0.42, 0.055, 0.055, M.cableBlack,
    0, height - beamH / 2, depth / 2 + 0.032));
  // small ivory junction box hanging off one post
  B.add(M.machineIvory, box(0.150, 0.200, 0.090, M.machineIvory,
    postX - 0.150, height * 0.62, depth / 2 + 0.048));

  B.flush(g, 'portal');
  g.userData = { width, height, depth };
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Generic extrusion guarding
// ────────────────────────────────────────────────────────────────────────────

/**
 * A rack/frame of silver T-slot aluminium extrusion, used as cell guarding and
 * as the tall thin screens standing either side of the foreground robots.
 *
 * Degenerate footprints are handled: if `w` (or `d`) is under ~0.26 m the frame
 * collapses to a single plane of posts in the YZ (or XY) plane, which is what
 * LAYOUT's `0.1 × 1.5 × 2.6 upright` guard asks for.
 *
 * ORIGIN: on the floor at the centre of the footprint.
 *
 * @param {number} w overall width  (X)
 * @param {number} h overall height (Y)
 * @param {number} d overall depth  (Z)
 * @returns {THREE.Group} named 'extrusionFrame'
 */
export function buildExtrusionFrame(w = 0.10, h = 1.5, d = 2.6) {
  const g = group('extrusionFrame');
  const B = bucket();
  const s = EXTRUSION;

  const thinX = w <= 0.26;
  const thinZ = d <= 0.26;
  const xs = thinX ? [0] : [-(w / 2 - s / 2), w / 2 - s / 2];
  const zs = thinZ ? [0] : [-(d / 2 - s / 2), d / 2 - s / 2];

  const footT = 0.012;
  const postH = h - footT;

  // corner posts
  for (const x of xs) {
    for (const z of zs) {
      B.add(M.aluExtrusion, box(s, postH, s, M.aluExtrusion, x, footT + postH / 2, z));
      B.add(M.steelDark, box(s + 0.030, footT, s + 0.030, M.steelDark, x, footT / 2, z));
      B.add(M.galv, cyl(0.010, 0.014, M.galv, x, 0.006, z, 8));
    }
  }

  const rails = [h - s / 2, h * 0.52, 0.135];
  rails.forEach((y, ri) => {
    if (!thinX) {
      for (const z of zs) B.add(M.aluExtrusion, box(w, s, s, M.aluExtrusion, 0, y, z));
    }
    if (!thinZ) {
      for (const x of xs) B.add(M.aluExtrusion, box(s, s, d, M.aluExtrusion, x, y, 0));
    }
    // dark corner brackets where the rails meet the posts (crop F)
    if (ri !== 1) {
      for (const x of xs) {
        for (const z of zs) {
          B.add(M.steelDark, box(s * 0.9, 0.056, s * 0.9, M.steelDark,
            x, y + (ri === 0 ? -0.052 : 0.052), z));
        }
      }
    }
  });

  // Two intermediate stiles between the mid rail and the top rail — that is
  // all the photo's guard screens have, and it keeps the silhouette right.
  const stileTop = h - s / 2;
  const stileBot = h * 0.52;
  const stileH = Math.max(0.05, stileTop - stileBot);
  const stileY = (stileTop + stileBot) / 2;
  const stile = (x, z) =>
    B.add(M.aluExtrusion, box(s * 0.8, stileH, s * 0.8, M.aluExtrusion, x, stileY, z));

  if (!thinZ) {
    for (const x of xs) for (let i = 1; i <= 2; i++) stile(x, -d / 2 + (d * i) / 3);
  } else if (!thinX) {
    for (const z of zs) for (let i = 1; i <= 2; i++) stile(-w / 2 + (w * i) / 3, z);
  }

  B.flush(g, 'guard');
  g.userData = { w, h, d, section: s };
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Sheet-metal workpieces
// ────────────────────────────────────────────────────────────────────────────

/**
 * A matte brushed-steel sheet-metal blank — the parts the robots are moving on
 * and off the roller bed.
 *
 * ORIGIN: the geometric centre of the plate, in both orientations. Lying flat
 * the plate spans `w` in X and `h` in Z with thickness `t` in Y; standing it
 * spans `w` in X and `h` in Y with thickness `t` in Z, so a caller can place it
 * at `(x, topY + t/2, z)` flat or `(x, topY + h/2, z)` upright.
 *
 * @param {number} w  plate width  (m)
 * @param {number} h  plate length / height (m)
 * @param {number} t  sheet thickness (m)
 * @param {boolean} standing  true = stood on edge across the bed
 * @returns {THREE.Group} named 'sheetPart'
 */
export function buildSheetPart(w = 1.05, h = 0.6, t = 0.012, standing = false) {
  const g = group('sheetPart');
  const B = bucket();
  const e = Math.max(0.008, t * 0.9); // width of the bright sheared edge band
  const eT = t * 1.06;

  if (standing) {
    B.add(M.steelBrushed, box(w, h, t, M.steelBrushed));
    B.add(MAT.sheetEdge, box(w, e, eT, MAT.sheetEdge, 0, h / 2 - e / 2, 0));
    B.add(MAT.sheetEdge, box(w, e, eT, MAT.sheetEdge, 0, -h / 2 + e / 2, 0));
    B.add(MAT.sheetEdge, box(e, h, eT, MAT.sheetEdge, w / 2 - e / 2, 0, 0));
    B.add(MAT.sheetEdge, box(e, h, eT, MAT.sheetEdge, -w / 2 + e / 2, 0, 0));
  } else {
    B.add(M.steelBrushed, box(w, t, h, M.steelBrushed));
    B.add(MAT.sheetEdge, box(w, eT, e, MAT.sheetEdge, 0, 0, h / 2 - e / 2));
    B.add(MAT.sheetEdge, box(w, eT, e, MAT.sheetEdge, 0, 0, -h / 2 + e / 2));
    B.add(MAT.sheetEdge, box(e, eT, h, MAT.sheetEdge, w / 2 - e / 2, 0, 0));
    B.add(MAT.sheetEdge, box(e, eT, h, MAT.sheetEdge, -w / 2 + e / 2, 0, 0));
  }

  B.flush(g, 'sheet');
  g.userData = { w, h, t, standing };
  return g;
}
