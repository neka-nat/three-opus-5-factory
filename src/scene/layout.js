/**
 * scene/layout.js — the assembly drawing.
 *
 * Every other module builds an object at its own local origin; this file is the
 * only place that decides *where* things stand in the world. It works straight
 * down `LAYOUT.md`, section by section:
 *
 *   1 · shell        the building envelope, glazing and the openings in it
 *   2 · structure    crane runways, monorail, wall pipework (already world-placed)
 *   2 · crane        the orange bridge crane and the four wall jibs
 *   3 · cell         the foreground robot cell — conveyor, robots, guarding
 *   4 · rightSide    the near right wall: signs, bench, extinguisher, clutter
 *   5 · midLine      the receding machine line, x ∈ [1, 5], z ∈ [−11, −38]
 *   6 · leftArea     the dense, warm clutter filling the left half of the frame
 *   7 · overhead     ceiling services, luminaires, the clock and the aisle sign
 *
 * Conventions this file relies on (verified against each module's source):
 *
 *   • `buildFloor/Walls/Ceiling`, `buildWindowWall`, `buildCraneRunways`,
 *     `buildMonorail`, `buildWallServices`, `buildCeilingServices` and
 *     `buildLightFixtures` all return **world-placed** groups — they are added
 *     at the origin with no transform.
 *   • Free-standing builders put their origin at the centre of their footprint
 *     on the floor. Most of them face **−Z**; the `machines.js` family and the
 *     `openings.js` family deliberately face **+Z**. The `TO_*` constants below
 *     spell out the yaw needed to turn either convention toward ±X.
 *   • Wall-mounted builders (`buildHoseReel`, `buildHelmetRack`,
 *     `buildExtinguisherSign`, `buildNotice`, `buildWallClock`) have their
 *     origin ON the wall face; the right-wall ones are placed unrotated and the
 *     left-wall ones are rotated by π.
 *   • Every top-level group is left at the identity, so the coordinates written
 *     here are literally the world coordinates in `LAYOUT.md`.
 *
 * All incidental scatter comes from `makeRng()` seeded off `SEED`, so the hall
 * is byte-identical on every reload.
 *
 * @module scene/layout
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { CFG, SEED } from '../core/config.js';
import { M } from '../core/materials.js';
import {
  at, billboard, box, boxOn, boxGeo, cable, catenary, cylZ, group,
  instance, makeRng, rf, ri, V3,
} from '../core/utils.js';

import { buildFloor, buildWalls, buildCeiling } from '../build/shell.js';
import { buildWindowWall } from '../build/windows.js';
import { buildRollShutter, buildSteelDoor, buildShutterSurround } from '../build/openings.js';
import { buildCeilingServices, buildLightFixtures, buildWallServices } from '../build/services.js';

import { buildCraneRunways, buildBridgeCrane } from '../equip/crane.js';
import { buildJibCrane, buildMonorail, buildChainHoist } from '../equip/jibcrane.js';
import { buildRobot, buildRobotPedestal } from '../equip/robot.js';
import {
  buildRollerConveyor, buildPortalFrame, buildExtrusionFrame, buildSheetPart,
} from '../equip/conveyor.js';
import {
  buildMachiningCentre, buildMachineCabinet, buildControlCabinet, buildMintMachine, buildDraped,
} from '../equip/machines.js';
import {
  buildWorkbench, buildDesk, buildStorageCabinet, buildShelfRack, buildBinRack,
  buildRollCage, buildOfficeChair, buildStool, buildWhiteboardStand, buildTrolley,
  buildPartitionScreen,
} from '../equip/furniture.js';

import {
  buildTrafficCone, buildConeBar, buildBollard, buildPallet, buildCardboardBox,
  buildBoxStack, buildWoodCrate, buildPlasticBin, buildFireExtinguisher, buildHoseReel,
  buildHelmetRack, buildCableCoil, buildFlexHose, buildRingBlower, buildGasCylinder,
  buildDrum, buildTarpBundle, buildStepPlatform, buildLaptop, buildPaperStack,
} from '../props/props.js';
import {
  buildExtinguisherSign, buildExitSign, buildWallClock, buildNotice, buildHangingSign,
} from '../props/signs.js';

// ────────────────────────────────────────────────────────────────────────────
// Orientation helpers
//
// A yaw `a` about +Y maps a builder's forward vector f to R_y(a)·f, so:
//   f = (0,0,−1)  (the default "faces −Z" convention)
//        a = −π/2 → +X      a = +π/2 → −X      a = π → +Z
//   f = (0,0,+1)  (machines.js / openings.js "faces +Z")
//        a = +π/2 → +X      a = −π/2 → −X      a = π → −Z
// ────────────────────────────────────────────────────────────────────────────

/** Yaw that turns a −Z-facing builder toward +X (i.e. off the LEFT wall). */
const NZ_TO_PX = -Math.PI / 2;
/** Yaw that turns a −Z-facing builder toward −X (i.e. off the RIGHT wall). */
const NZ_TO_NX = Math.PI / 2;
/** Yaw that turns a −Z-facing builder toward the camera. */
const NZ_TO_PZ = Math.PI;
/** Yaw that turns a +Z-facing builder toward +X. */
const PZ_TO_PX = Math.PI / 2;
/** Yaw that turns a +Z-facing builder toward −X. */
const PZ_TO_NX = -Math.PI / 2;

/** Shorthand: place `obj` and add it to `parent`. */
function add(parent, obj, x = 0, y = 0, z = 0, ry = 0) {
  parent.add(at(obj, x, y, z, ry));
  return obj;
}

// ────────────────────────────────────────────────────────────────────────────
// Zone welding
// ────────────────────────────────────────────────────────────────────────────

/** Attributes a merged geometry is allowed to keep. */
const WELD_ATTRS = ['position', 'normal', 'uv'];

/**
 * Bake a whole zone of static set dressing down to **one mesh per material**.
 *
 * `core/utils.js`'s `mergeGroup()` cannot do this job here: it takes a single
 * material for the whole group, and `mergeGeometries()` refuses to mix indexed
 * `BoxGeometry` with the non-indexed `ExtrudeGeometry` that `roundedBox()` and
 * several equipment modules emit. This bucketises by material and converts
 * everything to non-indexed first, so any mixture merges.
 *
 * `InstancedMesh`es and anything flagged `userData.noWeld` are re-parented with
 * their world transform baked in rather than merged. Cached geometry from
 * `utils.js` is never mutated — every source geometry is cloned first.
 *
 * @param {THREE.Object3D} src an untransformed group of static meshes
 * @param {string} name name for the returned group
 * @returns {THREE.Group}
 */
function weld(src, name) {
  src.updateMatrixWorld(true);

  /** @type {Map<THREE.Material, THREE.BufferGeometry[]>} */
  const buckets = new Map();
  const keep = [];

  const walk = (o) => {
    const skip = o !== src && o.userData && o.userData.noWeld;
    if (skip || o.isInstancedMesh || o.isBatchedMesh || o.isSprite || o.isLine || o.isPoints) {
      keep.push(o);
      return; // its subtree travels with it
    }
    if (o.isMesh) {
      // Anything the merger cannot represent faithfully — a render-order
      // override, a multi-material mesh, a hidden one — is kept as it is.
      const weldable = Boolean(o.geometry) && o.visible && o.renderOrder === 0
        && Boolean(o.material) && !Array.isArray(o.material);
      if (!weldable) {
        keep.push(o);
        return;
      }
      const src0 = o.geometry;
      const g = src0.index !== null ? src0.toNonIndexed() : src0.clone();
      for (const k of Object.keys(g.attributes)) {
        if (!WELD_ATTRS.includes(k)) g.deleteAttribute(k);
      }
      if (!g.attributes.position) {
        g.dispose();
      } else {
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) {
          g.setAttribute('uv', new THREE.BufferAttribute(
            new Float32Array(g.attributes.position.count * 2), 2,
          ));
        }
        g.morphAttributes = {};
        g.clearGroups();
        g.applyMatrix4(o.matrixWorld);
        const list = buckets.get(o.material);
        if (list) list.push(g);
        else buckets.set(o.material, [g]);
      }
    }
    for (const c of o.children.slice()) walk(c);
  };
  walk(src);

  const out = group(name);

  buckets.forEach((geos, mat) => {
    let geo = geos[0];
    if (geos.length > 1) {
      const merged = mergeGeometries(geos, false);
      if (merged) {
        geos.forEach((g) => g.dispose());
        geo = merged;
      } else {
        // Should not happen (everything above is non-indexed with the same
        // attribute set) — but never drop geometry on the floor if it does.
        console.warn(`[layout] weld(${name}) could not merge ${mat.name || 'material'}`);
        geos.forEach((g, i) => {
          if (i === 0) return;
          const m = new THREE.Mesh(g, mat);
          m.castShadow = true;
          m.receiveShadow = true;
          out.add(m);
        });
      }
    }
    const m = new THREE.Mesh(geo, mat);
    m.name = `${name}_${mat.name || 'mat'}`;
    m.castShadow = true;
    m.receiveShadow = true;
    out.add(m);
  });

  // InstancedMeshes (and opt-outs) keep their identity; bake in their world
  // transform because their old parents are about to be discarded.
  for (const k of keep) {
    k.updateMatrixWorld(true);
    k.matrixWorld.decompose(k.position, k.quaternion, k.scale);
    out.add(k);
  }

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Small pieces of set dressing that no other module owns
// ────────────────────────────────────────────────────────────────────────────

/**
 * The dark open doorway on the left wall (`LAYOUT.md` §1): a black recess
 * behind a cream architrave, with a couple of dim silhouettes inside so the
 * room beyond reads as cluttered rather than as a painted-on black rectangle.
 *
 * @param {number} x wall-face X (−6.36 for the left wall)
 * @param {number} z centre of the opening
 * @param {number} [w=1.6] clear width (spans Z)
 * @param {number} [h=2.3] clear height
 * @param {-1|1} [side=-1] −1 = left wall (looks +X), +1 = right wall
 * @returns {THREE.Group} named 'openDoorway'
 */
function buildOpenDoorway(x, z, w = 1.6, h = 2.3, side = -1) {
  const g = group('openDoorway');
  const nx = -side; // hall-inward direction in X
  const ry = side < 0 ? PZ_TO_PX : PZ_TO_NX;
  const t = 0.07;

  // the void: a shallow dark box sunk behind the wall face + a black mouth
  g.add(box(0.55, h, w, M.cncBlack, x - nx * 0.3, h / 2, z));
  g.add(billboard(w, h, M.cncBlack, x + nx * 0.008, h / 2, z, ry));

  // cream architrave
  for (const s of [-1, 1]) {
    g.add(boxOn(0.13, h + t, t, M.wallPlain, x + nx * 0.05, 0, z + s * (w / 2 + t / 2)));
  }
  g.add(box(0.13, t, w + t * 2, M.wallPlain, x + nx * 0.05, h + t / 2, z));

  // dim junk in the room beyond
  const rng = makeRng(SEED ^ 0x0d00);
  for (let i = 0; i < 4; i++) {
    g.add(boxOn(
      rf(rng, 0.2, 0.34), rf(rng, 0.25, 0.6), rf(rng, 0.2, 0.4), M.machineIvoryDark,
      x - nx * rf(rng, 0.15, 0.45), rf(rng, 0, 0.55), z + rf(rng, -w * 0.35, w * 0.35),
    ));
  }
  return g;
}

/**
 * The plain yellow notice board standing in the left work area (crop D): a
 * saturated yellow panel on two slim posts with A4 sheets taped to it.
 * Origin on the floor at the panel centreline; the printed face looks **+X**.
 *
 * @param {number} [w=1.1] panel width (spans Z)
 * @param {number} [h=1.4] panel height
 * @param {number} [seed=17]
 * @returns {THREE.Group} named 'noticeBoard'
 */
function buildNoticeBoard(w = 1.1, h = 1.4, seed = 17) {
  const g = group('noticeBoard');
  const rng = makeRng(SEED + seed);
  const y0 = 0.42;

  for (const s of [-1, 1]) {
    g.add(boxOn(0.05, y0 + h - 0.05, 0.05, M.steelWhiteDark, 0, 0, s * (w / 2 - 0.07)));
    g.add(boxOn(0.26, 0.03, 0.06, M.steelWhiteDark, 0.06, 0, s * (w / 2 - 0.07)));
  }
  g.add(box(0.04, h, w, M.floorYellow, 0.012, y0 + h / 2, 0));
  g.add(box(0.05, 0.05, w + 0.02, M.machineIvoryDark, 0.012, y0 + h - 0.02, 0));

  for (let i = 0; i < 4; i++) {
    const p = billboard(0.21, 0.297, M.paper, 0.036, y0 + rf(rng, 0.42, h - 0.24),
      rf(rng, -w * 0.34, w * 0.34), PZ_TO_PX);
    p.rotation.z = rf(rng, -0.05, 0.05);
    g.add(p);
  }
  return g;
}

/**
 * A small ivory plinth — the stand the ring blower and one or two other bits of
 * ancillary kit sit on beside the conveyor. Origin on the floor.
 *
 * @param {number} w @param {number} h @param {number} d
 * @returns {THREE.Group} named 'plinth'
 */
function buildPlinth(w, h, d) {
  const g = group('plinth');
  g.add(boxOn(w, h - 0.03, d, M.machineIvory, 0, 0));
  g.add(boxOn(w + 0.04, 0.03, d + 0.04, M.machineIvoryDark, 0, h - 0.03));
  return g;
}

/**
 * Long blue-grey extruded profiles laid on the bottom-left workbench, plus the
 * stainless bracket leaning against its end. Origin at the bench top centre.
 *
 * @param {number} len bar length along X
 * @param {number} [seed=31]
 * @returns {THREE.Group} named 'profileStock'
 */
function buildProfileStock(len = 2.2, seed = 31) {
  const g = group('profileStock');
  const rng = makeRng(SEED + seed);
  for (let i = 0; i < 3; i++) {
    const b = box(len - i * 0.14, 0.055, 0.14, M.aluExtrusion, 0, 0.03 + i * 0.058, -0.16 + i * 0.16);
    b.rotation.y = rf(rng, -0.02, 0.02);
    g.add(b);
  }
  // a stainless bracket leaning on the end of the bench
  const br = box(0.03, 0.62, 0.42, M.steelBrushed, len * 0.42, 0.3, 0.2);
  br.rotation.z = 0.22;
  br.rotation.x = 0.08;
  g.add(br);
  return g;
}

/**
 * The little pneumatic actuator rails tucked under the near end of the roller
 * bed. Origin on the floor under the conveyor centreline.
 *
 * @returns {THREE.Group} named 'actuatorRail'
 */
function buildActuatorRail() {
  const g = group('actuatorRail');
  for (const s of [-1, 1]) {
    g.add(cylZ(0.032, 0.72, M.aluPlain, s * 0.34, 0.62, 0, 12));
    g.add(box(0.1, 0.11, 0.13, M.robotBlue, s * 0.34, 0.62, 0.3));
    g.add(box(0.08, 0.16, 0.08, M.aluPlain, s * 0.34, 0.54, -0.3));
  }
  g.add(box(0.86, 0.05, 0.1, M.aluExtrusion, 0, 0.5, 0));
  return g;
}

/**
 * The pale panel the far wall clock hangs on (the hall has no wall at z = −24,
 * but the photograph clearly reads a clock against a light surface there).
 * Origin on the panel's camera-facing surface.
 *
 * @returns {THREE.Group} named 'clockPanel'
 */
function buildClockPanel() {
  const g = group('clockPanel');
  g.add(box(0.72, 0.72, 0.07, M.wallPlain, 0, 0, -0.035));
  g.add(box(0.78, 0.05, 0.09, M.machineIvoryDark, 0, 0.385, -0.04));
  g.add(buildWallClock(0.21));
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// 1 · Building shell
// ────────────────────────────────────────────────────────────────────────────

/**
 * The envelope: floor slab and markings, both side walls plus the gable, the
 * roof, both glazed walls, and every opening cut into them (`LAYOUT.md` §1).
 * @returns {THREE.Group} named 'shell'
 */
function buildShell() {
  const g = group('shell');

  g.add(buildFloor());
  g.add(buildWalls());
  g.add(buildCeiling());
  g.add(buildWindowWall(1));
  g.add(buildWindowWall(-1));

  const op = group('openings');

  // big roll shutter in the back gable (surround first — its hood sits proud)
  add(op, buildShutterSurround(4.4, 4.3), -1.6, 0, -46.66);
  add(op, buildRollShutter(4.4, 4.3, 0), -1.6, 0, -46.66);

  // two shutters down the left wall, both turned to face +X
  add(op, buildShutterSurround(3.6, 4.0), -6.36, 0, -24.0, PZ_TO_PX);
  add(op, buildRollShutter(3.6, 4.0, 0), -6.36, 0, -24.0, PZ_TO_PX);
  add(op, buildShutterSurround(3.2, 3.8), -6.36, 0, -13.2, PZ_TO_PX);
  add(op, buildRollShutter(3.2, 3.8, 0.14), -6.36, 0, -13.2, PZ_TO_PX);

  // steel personnel doors on the right wall, facing −X
  add(op, buildSteelDoor(0.95, 2.1), 6.36, 0, -5.4, PZ_TO_NX);
  add(op, buildSteelDoor(0.95, 2.1), 6.36, 0, -12.6, PZ_TO_NX);

  // the dark cluttered room beyond the left wall
  op.add(buildOpenDoorway(-6.36, -16.5, 1.6, 2.3, -1));

  g.add(op);
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// 2 · Fixed structure & installed services
// ────────────────────────────────────────────────────────────────────────────

/**
 * The permanently installed steelwork and pipework: both crane runway girders,
 * the right-wall monorail with its parked chain hoists, and the wall services
 * (blue air main, white pipe, wire-way) on both walls.
 * @returns {THREE.Group} named 'structure'
 */
function buildStructure() {
  const g = group('structure');
  const rng = makeRng(SEED ^ 0x2a17);

  g.add(buildCraneRunways());
  g.add(buildWallServices(1));
  g.add(buildWallServices(-1));

  g.add(buildMonorail());
  CFG.monorail.hoistZ.forEach((z, i) => {
    add(
      g,
      buildChainHoist(rf(rng, 1.05, 1.85), { seed: 9031 + i * 131, bag: i !== 2 }),
      CFG.monorail.x, CFG.monorail.soffitY, z,
    );
  });

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// 2 · Lifting gear
// ────────────────────────────────────────────────────────────────────────────

/**
 * The orange overhead travelling crane at z = −9.5 with its trolley parked at
 * x = −2.6, plus the three right-wall slewing jibs from `CFG.jibs` and the
 * smaller mirrored jib far down the left wall (`LAYOUT.md` §2).
 * @returns {THREE.Group} named 'crane'
 */
function buildCraneGear() {
  const g = group('crane');

  add(g, buildBridgeCrane(CFG.crane.trolleyX), 0, CFG.crane.railTopY, CFG.crane.bridgeZ);

  CFG.jibs.forEach((j, i) => {
    add(g, buildJibCrane({
      postTopY: j.postTopY,
      boomLen: j.boomLen,
      boomY: j.boomY,
      swing: j.swing,
      hoistAt: 0.62 + i * 0.06,
      hoistDrop: 1.5 - i * 0.15,
      seed: 5150 + i * 37,
    }), 6.42, 0, j.z);
  });

  // left wall, far: rotate π about Y — never mirror-scale (winding would flip)
  add(g, buildJibCrane({
    postTopY: 3.95, boomLen: 1.95, boomY: 3.25, swing: 0.6,
    postSize: 0.17, hoistAt: 0.7, hoistDrop: 1.2, seed: 771,
  }), -6.42, 0, -19.0, Math.PI);

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// 3 · The foreground robot cell
// ────────────────────────────────────────────────────────────────────────────

/**
 * The hero of the photograph: the roller conveyor running out of the bottom of
 * frame, its three extrusion portals, the six FANUC arms on their pedestals,
 * the sheet-metal blanks on the bed, the guarding and the ring blower with its
 * hose running up to robot D (`LAYOUT.md` §3).
 * @returns {THREE.Group} named 'cell'
 */
function buildCell() {
  const g = group('cell');
  const C = CFG.conveyor;
  const rng = makeRng(SEED ^ 0x3c01);

  // ── the line ─────────────────────────────────────────────────────────────
  add(g, buildRollerConveyor({ centreSlot: true, withLegs: true }), C.x, 0, (C.zFrom + C.zTo) / 2);
  for (const z of C.portalsZ) add(g, buildPortalFrame(2.6, 2.1, 0.16), C.x, 0, z);
  add(g, buildActuatorRail(), C.x, 0, 3.6);

  // ── the parts being handled ──────────────────────────────────────────────
  const flat = at(buildSheetPart(1.05, 0.62, 0.012, false), C.x, 0.92, -0.6);
  flat.rotation.y = 0.02;
  g.add(flat);

  const upright = at(buildSheetPart(0.95, 0.62, 0.012, true), C.x + 0.05, 1.22, -2.9);
  upright.rotation.z = 0.05;
  upright.rotation.y = 0.07;
  g.add(upright);

  const spare = at(buildSheetPart(0.9, 0.55, 0.012, false), C.x - 1.0, 0.009, 1.2);
  spare.rotation.y = 0.34;
  g.add(spare);

  // ── the robots ───────────────────────────────────────────────────────────
  CFG.robots.forEach((r, i) => {
    const pedH = r.pedestal === 'box' ? (r.model === 'r2000' ? 0.5 : 0.45) : 0.62;
    add(g, buildRobotPedestal(r.pedestal, pedH), r.x, 0, r.z, r.ry);
    add(g, buildRobot({
      model: r.model,
      pose: r.pose,
      tool: r.tool,
      dressPack: true,
      seed: 7 + i * 101,
    }), r.x, pedH, r.z, r.ry);
  });

  // ── guarding ─────────────────────────────────────────────────────────────
  add(g, buildExtrusionFrame(0.1, 1.5, 2.6), C.x - 2.4, 0, -1.4);
  add(g, buildExtrusionFrame(0.1, 1.5, 2.6), C.x + 1.5, 0, -1.4);

  // ── ring blower on its plinth, hose arcing up to robot D ─────────────────
  add(g, buildPlinth(0.5, 0.55, 0.56), C.x + 1.1, 0, -4.5);
  const blower = add(g, buildRingBlower(), C.x + 1.1, 0.55, -4.5, -0.35);
  const port = blower.userData && blower.userData.hosePort;
  if (port) {
    blower.updateWorldMatrix(true, true);
    const from = port.getWorldPosition(V3());
    g.add(buildFlexHose(from, V3(C.x + 0.77, 1.34, -6.02), 0.055, 0.3));
  }

  // ── incidental cell clutter ──────────────────────────────────────────────
  add(g, buildCardboardBox(0.62, 0.42, 0.46, 5), 2.42, 0, 4.35, rf(rng, -0.2, 0.2));
  add(g, buildPlasticBin(0.4, 0.3, 0.2, 'binBlue'), 5.15, 0, -3.1, rf(rng, -0.3, 0.3));
  add(g, buildCableCoil(0.24), 0.55, 0, -3.4);

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// 4 · The near right-hand wall
// ────────────────────────────────────────────────────────────────────────────

/**
 * The right wall as the camera sees it, close and dominant (`LAYOUT.md` §4):
 * the 消火器 sign and extinguisher, the teal hose reel, two 非常口 signs, the
 * notice plaques, the bench with its laptop, the chair, and the bins, tarp and
 * cartons pushed up against the wall.
 * @returns {THREE.Group} named 'rightSide'
 */
function buildRightSide() {
  const g = group('rightSide');
  const rng = makeRng(SEED ^ 0x4b22);

  // ── signage (origins on the wall face, already facing −X) ────────────────
  add(g, buildExtinguisherSign(0.34, 0.42), 6.46, 3.55, -3.05);
  add(g, buildNotice(0.3, 0.21, '注意'), 6.46, 1.9, -6.2);
  add(g, buildNotice(0.26, 0.19, '点検表'), 6.46, 2.2, -11.0);
  add(g, buildExitSign(0.4, 0.2), 6.15, 5.35, -5.6);
  add(g, buildExitSign(0.4, 0.2), 6.15, 5.35, -18.0);

  // ── fire point + the pale-teal spiral hose reel above the bench ──────────
  add(g, buildFireExtinguisher(), 6.05, 0, -3.7, NZ_TO_NX);
  add(g, buildHoseReel(0.28), 6.44, 2.95, -4.35);

  // ── the workbench island (bench turned to face the aisle) ────────────────
  add(g, buildWorkbench(1.7, 0.72, 0.82, {
    top: 'steel', frameKey: 'machineIvoryDark', backboard: true, clutter: false, seed: 811,
  }), 5.85, 0, -6.6, NZ_TO_NX);   // pushed clear of relocated robot D at x 4.92
  add(g, buildLaptop(), 5.22, 0.82, -6.52, PZ_TO_NX);
  add(g, buildPaperStack(3), 5.34, 0.82, -6.02, 0.42);
  add(g, buildPlasticBin(0.34, 0.25, 0.17, 'binBlue'), 5.3, 0.82, -7.16, 0.18);
  add(g, buildOfficeChair(), 5.0, 0, -7.4, NZ_TO_PX);
  add(g, buildStool({ h: 0.58, seatKey: 'machineMint' }), 5.55, 0, -8.35);

  // ── floor clutter against the wall ───────────────────────────────────────
  add(g, buildPlasticBin(0.58, 0.42, 0.3, 'binYellow'), 6.05, 0, 2.1, 0.24);
  add(g, buildTarpBundle(3), 5.95, 0, -4.9, rf(rng, -0.6, 0.6));
  add(g, buildBoxStack(21, 4), 6.1, 0, -9.5, 0.12);
  add(g, buildBoxStack(22, 3), 6.05, 0, -13.4, -0.2);
  add(g, buildTrolley(0.6, 0.9, { seed: 1207, cargo: true }), 5.7, 0, -16.2, NZ_TO_NX);
  add(g, buildCardboardBox(0.5, 0.34, 0.38, 9), 6.12, 0, -10.9, rf(rng, -0.3, 0.3));

  return weld(g, 'rightSide');
}

// ────────────────────────────────────────────────────────────────────────────
// 5 · The machine line receding into the middle distance
// ────────────────────────────────────────────────────────────────────────────

/**
 * The line of machinery between the conveyor and the right wall
 * (`LAYOUT.md` §5): the charcoal machining centre behind the hero robot, the
 * run of ivory machine-tool cabinets, two control cabinets, two mothballed
 * machines under vinyl, a loaded pallet, the chained gas cylinders, and the
 * cabinets that carry on shrinking toward the vanishing point.
 * @returns {THREE.Group} named 'midLine'
 */
function buildMidLine() {
  const g = group('midLine');
  const rng = makeRng(SEED ^ 0x5d33);

  // ── the charcoal machining centre (andon + pendant come with it) ─────────
  add(g, buildMachiningCentre({
    w: 3.2, h: 2.6, d: 2.4, andon: true, pendant: true, chipConveyor: true, hose: true, seed: 4101,
  }), 2.6, 0, -15.2, 0.06);

  // ── the run of ivory machine-tool boxes, fronts kept toward the camera ───
  const cabinets = [
    { x: 4.15, z: -13.0, w: 1.5, h: 1.95, d: 1.15, o: { seed: 701, topBox: true } },
    { x: 4.2, z: -16.4, w: 1.4, h: 1.85, d: 1.1, o: { seed: 702, andon: true } },
    { x: 4.1, z: -19.6, w: 1.6, h: 2.05, d: 1.2, o: { seed: 703, topBox: true } },
    { x: 4.25, z: -23.0, w: 1.35, h: 1.8, d: 1.05, o: { seed: 704 } },
  ];
  for (const c of cabinets) {
    add(g, buildMachineCabinet(c.w, c.h, c.d, c.o), c.x, 0, c.z, rf(rng, -0.09, 0.09));
  }

  // ── control cabinets ─────────────────────────────────────────────────────
  add(g, buildControlCabinet(0.8, 1.9, 0.5), 3.4, 0, -11.4, 0.04);
  add(g, buildControlCabinet(0.75, 1.85, 0.48), 4.6, 0, -21.0, -0.42);

  // ── machines bagged under translucent vinyl ──────────────────────────────
  add(g, buildDraped(2.2, 1.8, 1.6, 1), 1.5, 0, -13.6, 0.05);
  add(g, buildDraped(1.9, 1.6, 1.4, 4), 3.9, 0, -25.5, -0.18);

  // ── a loaded pallet and the chained gas cylinders ────────────────────────
  const pallet = add(g, buildPallet(1.15, 1.15), 4.9, 0, -18.2, 0.1);
  const deckY = (pallet.userData && pallet.userData.deckY) || 0.13;
  add(g, buildBoxStack(31, 4), 4.9, deckY, -18.2, 0.16);

  const botX = [5.22, 5.42, 5.6];
  const botZ = [-24.66, -24.5, -24.36];
  for (let i = 0; i < 3; i++) {
    add(g, buildGasCylinder(rf(rng, 1.28, 1.4), 'cageGreen'), botX[i], 0, botZ[i], rf(rng, 0, 3));
  }
  g.add(cable(
    catenary(V3(botX[0], 0.98, botZ[0]), V3(botX[2], 0.98, botZ[2]), 0.05, 10),
    M.chain, 0.011, 18, 5,
  ));
  add(g, buildCardboardBox(0.55, 0.4, 0.42, 12), 5.05, 0, -26.4, rf(rng, -0.3, 0.3));

  // ── cabinets carrying on to the vanishing point, detail falling away ─────
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const z = -27 - t * 11;
    add(g, buildMachineCabinet(
      rf(rng, 1.15, 1.5), rf(rng, 1.6, 2.0), rf(rng, 0.9, 1.2),
      { seed: 810 + i, label: i < 3, vents: i < 3 },
    ), 3.9 - t * 0.3, 0, z, rf(rng, -0.12, 0.12));
  }

  // ── far-field silhouettes on the right, one instanced draw ───────────────
  const tf = [];
  for (let i = 0; i < 22; i++) {
    const w = rf(rng, 0.36, 0.8);
    const h = rf(rng, 0.3, 0.62);
    const d = rf(rng, 0.32, 0.6);
    const y = rng() < 0.35 ? h / 2 + rf(rng, 0.3, 0.55) : h / 2;
    tf.push({
      pos: [rf(rng, 2.6, 5.4), y, rf(rng, -44.5, -28.5)],
      rot: [0, rf(rng, -0.6, 0.6), 0],
      scale: [w, h, d],
    });
  }
  g.add(instance(boxGeo(1, 1, 1), M.cardboard, tf));

  return weld(g, 'midLine');
}

// ────────────────────────────────────────────────────────────────────────────
// 6 · The left-hand work area
// ────────────────────────────────────────────────────────────────────────────
//
// The photograph's left third is a continuous, mid-tone wall of workshop
// clutter that starts almost at the frame edge and runs to the vanishing
// point. Reproducing that needs two things the first pass did not have:
//
//   a) the storage must start much closer to the camera. With the frozen
//      viewpoint the left frustum plane crosses the floor along
//          x_min(z) ≈ −(0.751·(3.6 − z) − 2.83)
//      so x = −3.6 only enters frame at z ≈ −5, x = −5.0 at z ≈ −6.9 and the
//      left wall itself at z ≈ −9. Anything at x ≤ −5 nearer than z = −7 is
//      simply off-screen — which is why the old racks at z = −10.4 projected
//      tiny and the near-left read as bare floor.
//   b) it must be *continuous*. The two ranks below are laid out so their Z
//      footprints touch: a tall pigeon-hole rank at x ≈ −4.95 with a lower
//      rank of desks / bin racks / benches at x ≈ −4.0 in front of it, then a
//      yard of roll cages, then more racks past the cross aisle.
//
// The painted lane (x ∈ [−3.325, −1.375]) stays empty apart from the cones and
// the big crate `LAYOUT.md` §6 explicitly puts there; every footprint below is
// kept on the far side of the white line.
// ────────────────────────────────────────────────────────────────────────────

/** Left edge of the painted aisle lane — no set dressing may cross it. */
const LANE_EDGE = -3.325;

/**
 * Back rank of the storage wall: the tall mint pigeon-hole racks.
 * `[z, x, bays, rows, fill, seed]`. A bay is 0.55 m wide and a row 0.19 m
 * high, so the Z spans below butt up against one another from z = −6.90 to
 * z = −16.28 with no gap wider than 0.33 m.
 */
const RANK_A = [
  [-7.45, -4.92, 2, 6, 0.78, 4409],
  [-9.15, -4.98, 3, 6, 0.72, 4417],
  [-11.20, -4.95, 4, 7, 0.70, 4423],
  [-13.50, -5.01, 4, 6, 0.74, 4431],
  [-15.45, -4.90, 3, 7, 0.66, 4437],
];

/** The same rank picking up again beyond the cross aisle at z = −21.5. */
const RANK_C = [
  [-23.40, -4.86, 3, 6, 0.60, 4443],
  [-25.65, -4.92, 4, 6, 0.56, 4451],
  [-27.60, -5.08, 3, 6, 0.50, 4457],
];

/**
 * Roll-cage yard (かご車): a 3 × 3 park filling z −16.60 … −20.10. The
 * near-left slot is left out — the bench with the little yellow arm stands
 * there, exactly as one does in the photograph.
 */
const CAGE_X = [-4.00, -4.95, -5.85];
const CAGE_Z = [-17.15, -18.35, -19.55];

/**
 * A timber pallet with a stack of cartons on it — the single most repeated
 * piece of floor clutter down the left of the photograph.
 *
 * @param {THREE.Group} parent
 * @param {number} x @param {number} z
 * @param {number} ry pallet yaw
 * @param {number} seed
 * @param {number} [n=3] cartons in the stack
 * @param {number} [w=1.1] pallet size
 */
function addPalletLoad(parent, x, z, ry, seed, n = 3, w = 1.1) {
  const pal = add(parent, buildPallet(w, w), x, 0, z, ry);
  const dy = (pal.userData && pal.userData.deckY) || 0.13;
  add(parent, buildBoxStack(seed, n), x, dy, z, ry + 0.18);
}

/**
 * The whole left half of the frame (`LAYOUT.md` §6): cones roping off the
 * aisle, the big plywood crate, the pale partition screens, the desks and
 * cabinets, the mint pigeon-hole racks and bin racks, the cluster of green
 * roll cages, and the shelving that carries on into the haze.
 * @returns {THREE.Group} named 'leftArea'
 */
function buildLeftArea() {
  const g = group('leftArea');
  const rng = makeRng(SEED ^ 0x6e44);
  const rngRack = makeRng(0x51a0c7); // the two rack ranks
  const rngYard = makeRng(0x51a1d3); // the roll-cage yard
  const rngJunk = makeRng(0x51a2e9); // loose boxes, bins and pallets
  const rngFar = makeRng(0x51a3fb); // instanced far-field silhouettes

  // ── cones and the striped bar across the aisle mouth ─────────────────────
  const coneA = [-1.75, -1.9];
  const coneB = [-2.15, -4.5];
  add(g, buildTrafficCone(0.7), coneA[0], 0, coneA[1], rf(rng, -0.4, 0.4));
  add(g, buildTrafficCone(0.7), coneB[0], 0, coneB[1], rf(rng, -0.4, 0.4));
  add(g, buildTrafficCone(0.7), -2.45, 0, -7.2, rf(rng, -0.4, 0.4));
  add(g, buildTrafficCone(0.7), -2.6, 0, -9.8, rf(rng, -0.4, 0.4));

  const dx = coneB[0] - coneA[0];
  const dz = coneB[1] - coneA[1];
  add(
    g,
    buildConeBar(Math.hypot(dx, dz)),
    (coneA[0] + coneB[0]) / 2, 0, (coneA[1] + coneB[1]) / 2,
    Math.atan2(-dz, dx),
  );
  add(g, buildBollard(0.9), -1.95, 0, 1.4);

  // ── the big pale crate on its pallet, mid-left of frame ──────────────────
  // Back-projected from the photograph rather than taken from LAYOUT.md §6:
  // the crate's 1.5 m width subtends ~120 px there, which puts it 8.6 m out,
  // and its base at y≈545 px puts it at world x≈+1.3. At LAYOUT's (−1.55,−3.4)
  // it landed against the left frame edge and left the centre-left empty.
  const cratePallet = add(g, buildPallet(1.42, 1.22), 1.35, 0, -5.2, 0.06);
  const crateY = (cratePallet.userData && cratePallet.userData.deckY) || 0.13;
  add(g, buildWoodCrate(1.5, 1.05, 1.15), 1.35, crateY, -5.2, 0.06);

  // ── the tall pale screen beside the conveyor ─────────────────────────────
  add(g, buildPartitionScreen(1.7, 1.75, { seed: 4923 }), 0.55, 0, -8.4, 0.15);

  // ── the band between the aisle and the line, empty in r06 but occupied in
  //    the photograph by pallets, cartons and a second crate ────────────────
  const p2 = add(g, buildPallet(1.15, 1.15), 0.85, 0, -7.1, -0.12);
  const p2y = (p2.userData && p2.userData.deckY) || 0.13;
  add(g, buildBoxStack(4471, 4), 0.85, p2y, -7.1, -0.12);
  add(g, buildBoxStack(4483, 3), 1.75, 0, -9.4, 0.22);
  add(g, buildWoodCrate(1.1, 0.72, 0.85), 0.35, 0, -11.2, -0.18);
  add(g, buildCardboardBox(0.62, 0.44, 0.46, 4491), 1.95, 0, -3.6, 0.3);

  // ── bottom-left workbench carrying the long profiles ─────────────────────
  add(g, buildWorkbench(2.4, 0.8, 0.82, {
    top: 'steel', frameKey: 'machineMintDark', clutter: false, seed: 4102,
  }), -0.95, 0, 2.4, 0.1);
  add(g, buildProfileStock(2.2, 31), -0.95, 0.82, 2.4, 0.1);
  add(g, buildTarpBundle(7), -1.2, 0, 3.6, rf(rng, -0.6, 0.6));

  // ── the mint bench machine bottom-left, with its step ────────────────────
  add(g, buildMintMachine(1.1, 1.35, 0.8), -5.25, 0, 0.4, 0.16);
  add(g, buildStepPlatform(0.62, 0.42, 0.2), -5.25, 0, 1.05, 0.16);
  add(g, buildPlasticBin(0.6, 0.44, 0.42, 'steelWhiteDark'), -4.7, 0, 0.9, -0.2);
  add(g, buildCableCoil(0.3), -6.0, 0, -0.7);

  // ── helmet board on the left wall (already projects +X) ──────────────────
  add(g, buildHelmetRack(6), -6.36, 1.55, 1.6);

  // ── 6a · the near-left office pocket, z −5 … −11 ──────────────────────────
  // These sit in the narrow wedge of floor the camera can actually see past
  // the aisle: at z = −6 only x ≥ −4.4 is in frame, at z = −8 only x ≥ −5.9.
  add(g, buildWhiteboardStand(1.25, 0.95), -3.88, 0, -5.72, NZ_TO_PX + 0.07);
  add(g, buildDesk(1.5, 0.72, { monitor: true, seed: 4203 }), -4.12, 0, -7.15, NZ_TO_PX);
  add(g, buildDesk(1.35, 0.68, {
    monitor: true, pedestal: 'left', seed: 4209,
  }), -4.14, 0, -8.70, NZ_TO_PX - 0.03);
  add(g, buildDesk(1.30, 0.66, {
    monitor: true, pedestal: 'none', papers: 3, seed: 4217,
  }), -4.13, 0, -10.05, NZ_TO_PX + 0.02);
  add(g, buildOfficeChair(), -3.78, 0, -7.20, NZ_TO_NX);
  add(g, buildStool({ h: 0.6, seatKey: 'binBlue' }), -3.72, 0, -9.90);

  // the saturated yellow notice board, tucked between the desks and the racks
  g.add(at(buildNoticeBoard(1.1, 1.4, 17), -4.62, 0, -6.90, 0.04));
  add(g, buildExtinguisherSign(0.34, 0.42), -6.44, 3.3, -7.4, Math.PI);

  // ── white binder cabinets lining the wall behind the desks ───────────────
  [[-8.40, 4307], [-9.35, 4311], [-11.15, 4319]].forEach(([z, seed], i) => {
    add(g, buildStorageCabinet(0.9, 1.85, 0.45, {
      seed, glass: i !== 1,
    }), -5.98, 0, z, NZ_TO_PX);
  });

  // ── 6b · back rank — the tall mint pigeon-hole racks ─────────────────────
  for (const [z, x, bays, rows, fill, seed] of RANK_A) {
    add(g, buildShelfRack(bays, 6, rows, { seed, fill }), x, 0, z,
      NZ_TO_PX + rf(rngRack, -0.015, 0.015));
  }

  // ── 6c · front rank — bin racks, a bench and a screen against the aisle ──
  // The two bin racks are stepped back to x ≈ −4.56 to open floor pockets for
  // the pallets and totes that read against the white aisle line.
  add(g, buildBinRack(12, 8, { seed: 4511 }), -4.55, 0, -11.60, NZ_TO_PX);
  add(g, buildWorkbench(1.3, 0.6, 0.88, {
    top: 'mint', shelf: true, clutter: false, seed: 4131,
  }), -4.06, 0, -13.05, NZ_TO_PX);
  add(g, buildPlasticBin(0.42, 0.3, 0.18, 'binRed'), -4.06, 0.88, -13.30, 0.1);
  add(g, buildPlasticBin(0.42, 0.3, 0.18, 'binRed'), -4.06, 0.88, -12.82, -0.06);
  add(g, buildPaperStack(3), -4.02, 0.88, -12.55, 0.3);
  add(g, buildBinRack(10, 7, { seed: 4519 }), -4.58, 0, -14.30, NZ_TO_PX - 0.03);
  add(g, buildPartitionScreen(1.5, 1.7, { seed: 4931 }), -3.98, 0, -15.55, NZ_TO_PX + 0.05);

  // ── 6d · loose clutter on the strip of floor beside the aisle line ───────
  // Every footprint below is checked against LANE_EDGE with its yaw applied.
  add(g, buildCardboardBox(0.44, 0.34, 0.38, 6101), -3.66, 0, -5.50, rf(rngJunk, -0.4, 0.4));
  add(g, buildPlasticBin(0.42, 0.30, 0.20, 'binRed'), -3.60, 0, -6.25, rf(rngJunk, -0.3, 0.3));
  add(g, buildCardboardBox(0.40, 0.30, 0.34, 6103), -3.64, 0, -7.98, rf(rngJunk, -0.4, 0.4));
  add(g, buildCableCoil(0.22), -3.60, 0, -9.40);
  add(g, buildPlasticBin(0.50, 0.36, 0.24, 'binYellow'), -3.66, 0, -10.78, rf(rngJunk, -0.3, 0.3));
  addPalletLoad(g, -3.90, -11.55, rf(rngJunk, -0.08, 0.08), 6105, ri(rngJunk, 3, 5), 1.0);
  // a loaded cage pulled out of the yard and parked hard against the line
  add(g, buildRollCage(0.8, 1.1, 1.7, { seed: 4841, cargo: true }),
    -3.88, 0, -14.25, rf(rngJunk, -0.12, 0.12));
  add(g, buildPlasticBin(0.46, 0.32, 0.22, 'binRed'), -3.64, 0, -15.05, 0.12);
  add(g, buildPlasticBin(0.46, 0.32, 0.22, 'binRed'), -3.64, 0.22, -15.05, -0.05);

  // ── hand carts ───────────────────────────────────────────────────────────
  add(g, buildTrolley(0.62, 0.95, { seed: 4829 }), -5.60, 0, -12.10, NZ_TO_PZ - 0.3);
  add(g, buildTrolley(0.60, 0.90, { seed: 4837, cargo: true }), -5.65, 0, -24.10, NZ_TO_PZ + 0.25);

  // ── 6e · the yard of green wire roll cages, z −16.6 … −20.1 ──────────────
  let cageSeed = 4613;
  CAGE_Z.forEach((z, r) => {
    CAGE_X.forEach((x, c) => {
      if (r === 0 && c === 0) return; // the robot bench occupies this slot
      // the cages face alternately toward and away from the camera, exactly
      // as they are parked in the photograph
      const ry = ((r + c) % 2 ? Math.PI : 0) + rf(rngYard, -0.09, 0.09);
      add(g, buildRollCage(0.8, 1.1, 1.7, {
        seed: cageSeed, cargo: (r * 3 + c) % 5 !== 3,
      }), x, 0, z, ry);
      cageSeed += 29;
    });
  });
  // two more parked past the cross aisle
  add(g, buildRollCage(0.8, 1.1, 1.7, { seed: 4801, cargo: true }),
    -3.95, 0, -22.95, rf(rngYard, -0.1, 0.1));
  add(g, buildRollCage(0.8, 1.1, 1.7, { seed: 4807, cargo: true }),
    -3.90, 0, -24.15, Math.PI + rf(rngYard, -0.1, 0.1));

  // ── the small yellow robot on a bench, silhouetted against the racks ─────
  add(g, buildWorkbench(1.3, 0.75, 0.9, {
    top: 'steel', frameKey: 'machineMintDark', clutter: false, seed: 4141,
  }), -4.15, 0, -16.95, NZ_TO_PX);
  // yaw + pose[0] together decide which way the arm reaches; −2.75 + 0.9 swings
  // it toward the camera instead of out over the aisle lane
  const small = at(buildRobot({
    model: 'm710', pose: [0.9, -0.62, 0.48, 0.0, 0.72, 0.2], tool: 'gripper',
    dressPack: false, seed: 991,
  }), -4.15, 0.9, -16.95, -2.75);
  small.scale.setScalar(0.55);
  g.add(small);

  // ── 6f · the rack run picking up again past the cross aisle ──────────────
  for (const [z, x, bays, rows, fill, seed] of RANK_C) {
    add(g, buildShelfRack(bays, 5, rows, { seed, fill, topClutter: true }), x, 0, z,
      NZ_TO_PX + rf(rngRack, -0.02, 0.02));
  }
  addPalletLoad(g, -4.05, -25.60, rf(rngJunk, -0.2, 0.2), 6111, 4);
  addPalletLoad(g, -4.05, -27.30, rf(rngJunk, -0.2, 0.2), 6113, 3);
  addPalletLoad(g, -5.70, -22.95, rf(rngJunk, -0.2, 0.2), 6115, 3, 1.0);

  // ── shelving continuing into the distance ────────────────────────────────
  const farRacks = [-29.5, -32.8, -36.1, -39.4];
  farRacks.forEach((z, i) => {
    add(g, buildShelfRack(3, 5, 4, { seed: 4601 + i * 13, fill: 0.5, topClutter: i < 2 }),
      -5.6, 0, z, NZ_TO_PX);
  });

  // ── fire point, drums ────────────────────────────────────────────────────
  add(g, buildFireExtinguisher(), -6.00, 0, -16.05, NZ_TO_PX);
  add(g, buildDrum(0.88), -6.05, 0, -26.20);
  add(g, buildDrum(0.86), -5.75, 0, -25.30);

  // ── 6g · mid-field cartons, one instanced draw ───────────────────────────
  // Fills the ground either side of the far rack run so the storage never
  // reads as a clean edge; two lanes keep them clear of the racks themselves.
  const mid = [];
  for (let i = 0; i < 30; i++) {
    const w = rf(rngFar, 0.32, 0.7);
    const h = rf(rngFar, 0.24, 0.5);
    const d = rf(rngFar, 0.3, 0.58);
    const wallLane = rngFar() < 0.45;
    mid.push({
      pos: [
        wallLane ? rf(rngFar, -6.10, -5.45) : rf(rngFar, -4.42, -4.02),
        h / 2,
        rf(rngFar, -28.7, -22.7),
      ],
      rot: [0, rf(rngFar, -0.7, 0.7), 0],
      scale: [w, h, d],
    });
  }
  g.add(instance(boxGeo(1, 1, 1), M.cardboard, mid));

  // ── far-field silhouettes, one instanced draw ────────────────────────────
  const tf = [];
  for (let i = 0; i < 34; i++) {
    const w = rf(rng, 0.34, 0.82);
    const h = rf(rng, 0.28, 0.66);
    const d = rf(rng, 0.3, 0.62);
    const y = rng() < 0.4 ? h / 2 + rf(rng, 0.32, 0.62) : h / 2;
    tf.push({
      // 0.9 m of margin absorbs the ±0.7 rad yaw on a 0.82 m box
      pos: [rf(rng, -6.15, LANE_EDGE - 0.9), y, rf(rng, -45.0, -29.0)],
      rot: [0, rf(rng, -0.7, 0.7), 0],
      scale: [w, h, d],
    });
  }
  g.add(instance(boxGeo(1, 1, 1), M.cardboard, tf));

  return weld(g, 'leftArea');
}

// ────────────────────────────────────────────────────────────────────────────
// 7 · Ceiling & background
// ────────────────────────────────────────────────────────────────────────────

/**
 * Everything above head height that is not structure (`LAYOUT.md` §7): the
 * cable trays / conduit / sprinklers, every luminaire, the hanging aisle sign
 * and the round wall clock in the middle distance.
 *
 * NOTE the group is called `overhead`, not `ceiling`: `scene/lighting.js`
 * strips `castShadow` from the entire subtree of anything named `ceiling`
 * (it means the roof deck), and the clock and the aisle sign should keep
 * theirs.
 *
 * @returns {THREE.Group} named 'overhead'
 */
function buildOverhead() {
  const g = group('overhead');

  g.add(buildCeilingServices());
  g.add(buildLightFixtures());

  add(g, buildHangingSign(0.9, 0.3), -2.35, 4.6, -12.0);
  add(g, buildClockPanel(), -0.35, 5.55, -24.2);

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/**
 * Assemble the entire factory, following `LAYOUT.md` section by section.
 *
 * The returned group sits at the world origin with no transform, so every
 * coordinate inside it is a world coordinate. Its eight children are named
 * `shell`, `structure`, `crane`, `cell`, `rightSide`, `midLine`, `leftArea`
 * and `overhead`, and are also exposed on `.userData.zones` so the HUD or a
 * debugging tool can toggle them.
 *
 * Nothing here creates a light — `scene/lighting.js` owns those — and nothing
 * here mutates a shared material.
 *
 * @returns {THREE.Group} named 'factory'
 */
export function buildFactory() {
  const root = new THREE.Group();
  root.name = 'factory';

  const zones = {
    shell: buildShell(),
    structure: buildStructure(),
    crane: buildCraneGear(),
    cell: buildCell(),
    rightSide: buildRightSide(),
    midLine: buildMidLine(),
    leftArea: buildLeftArea(),
    overhead: buildOverhead(),
  };

  for (const key of Object.keys(zones)) root.add(zones[key]);

  root.userData.zones = zones;
  root.updateMatrixWorld(true);
  return root;
}
