/**
 * equip/robot.js — the FANUC-style articulated arms that flank the conveyor in
 * img01.jpg, their end-effectors, and the cream cast pedestals they stand on.
 *
 * Everything here was measured against the reference photograph and the detail
 * crops C (hero robot + CNC), E (foreground pair) and I (pedestals):
 *
 *   • FANUC yellow castings, a fat black cylindrical motor cover on the J2
 *     knuckle (with a white nameplate, a yellow warning triangle and a small
 *     red label on it) and a flatter black motor boss on the J3 elbow;
 *   • red bearing caps either side of the J2 axis and a thin red accent ring at
 *     the wrist, ending in a bright brushed-steel tool flange with a bolt circle;
 *   • a cross/star-shaped yellow cast foot bolted to a dark machined adapter
 *     plate — the plate is part of the robot, the cream casting under it is the
 *     pedestal;
 *   • and, the signature detail, the CREAM CORRUGATED DRESS-PACK CONDUIT that
 *     leaves a black bracket at the back of the J1 body, arcs in a generous loop
 *     high above the whole arm and clamps to a black bracket at the wrist. The
 *     big hero robot carries two of them side by side in a shared black yoke.
 *
 * Origin convention: the robot's local origin is the centre of its base
 * *mounting face* (y = 0 is the top of whatever it is bolted to) and the arm
 * reaches toward +X at pose 0. Pedestals stand on the floor with their top face
 * at y = h, so `layout.js` places the robot at the pedestal height.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { M, variant } from '../core/materials.js';
import {
  box,
  cylX,
  cylZ,
  cylGeo,
  boxGeo,
  roundedBox,
  corrugatedTube,
  billboard,
  instance,
  makeRng,
  rf,
  V3,
} from '../core/utils.js';

// ────────────────────────────────────────────────────────────────────────────
// Module-local material variants (materials.js is frozen — build them here).
// ────────────────────────────────────────────────────────────────────────────
const MAT = {
  /** The vivid yellow-green tray edge on the hero robot's vacuum frame. */
  get trayGreen() {
    return variant('cageGreen', { color: 0x6cbf4a, roughness: 0.5, metalness: 0.14 }, 'robotTray');
  },
  /** Suction-cup rubber — grey rather than the near-black M.rubberBlack. */
  get cupGrey() {
    return variant('rubberBlack', { color: 0x4c4f54, roughness: 0.88 }, 'robotCup');
  },
  /** The gripper-frame blue is a touch lighter than the solenoid blue. */
  get frameBlue() {
    return variant('robotBlue', { color: 0x2a5fb4, roughness: 0.42 }, 'robotFrame');
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Size classes. `S` is the overall scale factor used for the small details.
// ────────────────────────────────────────────────────────────────────────────
const MODELS = {
  // FANUC M-710iC-class: ~2.05 m reach, slim forearm. The four conveyor robots.
  m710: {
    S: 1.0,
    plateW: 0.62, plateD: 0.58, plateH: 0.075,
    footR: 0.260, footH: 0.055, footArmW: 0.100,
    plinthR: 0.165, plinthH: 0.100,
    j2Y: 0.575, j2X: 0.155,
    j1W: 0.40, j1D: 0.40,
    knuckleR: 0.145, knuckleD: 0.34,
    lower: 0.870,
    upper: 0.795, upperH: 0.200, upperD: 0.225,
    motorR: 0.105, motorL: 0.255,
    hoseR: 0.047, hoseCount: 1,
  },
  // FANUC R-2000iC-class: ~2.65 m reach, chunkier. The hero robot at z = −12.2.
  r2000: {
    S: 1.3,
    plateW: 0.80, plateD: 0.74, plateH: 0.095,
    footR: 0.335, footH: 0.070, footArmW: 0.130,
    plinthR: 0.215, plinthH: 0.130,
    j2Y: 0.720, j2X: 0.312,
    j1W: 0.52, j1D: 0.52,
    knuckleR: 0.190, knuckleD: 0.44,
    lower: 1.075,
    upper: 1.000, upperH: 0.260, upperD: 0.290,
    motorR: 0.135, motorL: 0.320,
    hoseR: 0.056, hoseCount: 2,
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Small local helpers
// ────────────────────────────────────────────────────────────────────────────

/** Truncated cone / frustum about +Y (utils.cyl only does equal radii). */
function frustum(rTop, rBot, h, material, x = 0, y = 0, z = 0, seg = 16, open = false) {
  const m = new THREE.Mesh(cylGeo(rTop, rBot, h, seg, open), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Merge a list of same-material meshes into one. Handles the indexed /
 * non-indexed mismatch between BoxGeometry and the ExtrudeGeometry that
 * `roundedBox` produces, which plain `mergeGroup` cannot.
 * @returns {THREE.Mesh|null} null if the merge is not possible.
 */
function fuse(meshes, material, name) {
  const geos = [];
  for (const mesh of meshes) {
    mesh.updateMatrix();
    let g = mesh.geometry.clone();
    g.applyMatrix4(mesh.matrix);
    if (g.index) g = g.toNonIndexed();
    for (const key of Object.keys(g.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') g.deleteAttribute(key);
    }
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    geos.push(g);
  }
  let merged = null;
  try {
    merged = mergeGeometries(geos, false);
  } catch (err) {
    merged = null;
  }
  if (!merged || !merged.attributes || !merged.attributes.position) return null;
  const out = new THREE.Mesh(merged, material);
  out.name = name;
  out.castShadow = true;
  out.receiveShadow = true;
  return out;
}

/**
 * Bundle the parts of one rigid link into a Group, fusing every run of meshes
 * that shares a material so a whole robot stays at a few dozen draw calls.
 */
function pack(name, parts) {
  const g = new THREE.Group();
  g.name = name;
  const buckets = new Map();
  const loose = [];
  for (const p of parts) {
    if (!p) continue;
    if (p.isMesh && !p.isInstancedMesh && p.material && !Array.isArray(p.material)) {
      const k = p.material.uuid;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(p);
    } else {
      loose.push(p);
    }
  }
  buckets.forEach((arr) => {
    if (arr.length < 2) {
      arr.forEach((m) => g.add(m));
      return;
    }
    const fused = fuse(arr, arr[0].material, `${name}:${arr[0].material.name || 'part'}`);
    if (fused) g.add(fused);
    else arr.forEach((m) => g.add(m));
  });
  loose.forEach((m) => g.add(m));
  return g;
}

/** A black clamp ring sitting on a hose curve at parameter t. */
function clampRing(curve, t, radius, tube, material) {
  const p = curve.getPointAt(Math.min(0.999, Math.max(0.001, t)));
  const tan = curve.getTangentAt(Math.min(0.999, Math.max(0.001, t))).normalize();
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 6, 14), material);
  m.position.copy(p);
  m.quaternion.setFromUnitVectors(V3(0, 0, 1), tan);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-assemblies
// ────────────────────────────────────────────────────────────────────────────

/** Dark machined adapter plate + cross-shaped yellow cast foot + J1 plinth. */
function buildFoot(P) {
  const parts = [];
  const S = P.S;

  // Machined adapter plate — thick charcoal steel with a lighter skimmed top.
  parts.push(box(P.plateW, P.plateH, P.plateD, M.robotDarkGrey, 0, P.plateH / 2, 0));
  parts.push(box(P.plateW * 0.98, 0.008, P.plateD * 0.98, M.steelDark, 0, P.plateH + 0.003, 0));
  // a chamfered lip so the plate does not read as a flat slab
  parts.push(box(P.plateW * 1.03, 0.012, P.plateD * 1.03, M.robotDarkGrey, 0, 0.006, 0));

  // Bolt heads round the perimeter of the plate.
  const bolts = [];
  const bx = P.plateW * 0.42;
  const bz = P.plateD * 0.42;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) bolts.push({ pos: [sx * bx, P.plateH + 0.012, sz * bz] });
  }
  bolts.push({ pos: [0, P.plateH + 0.012, bz] });
  bolts.push({ pos: [0, P.plateH + 0.012, -bz] });
  parts.push(instance(cylGeo(0.014 * S, 0.016 * S, 0.014, 6), M.steelDark, bolts));

  const footY = P.plateH;

  // Cross / star cast foot: four tapered arms on a central hub. Kept flat (no
  // nested Groups) so `pack` can fuse the whole star into one draw call.
  parts.push(frustum(P.footR * 0.44, P.footR * 0.50, P.footH, M.fanucYellow, 0, footY + P.footH / 2, 0, 14));
  const armY = footY + P.footH * 0.43;
  const footNuts = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const ux = Math.cos(a);
    const uz = -Math.sin(a);
    const arm = box(P.footR, P.footH * 0.86, P.footArmW, M.fanucYellow,
      ux * P.footR * 0.5, armY, uz * P.footR * 0.5);
    arm.rotation.y = a;
    parts.push(arm);
    // the arm tip carries a bolt boss
    parts.push(frustum(P.footArmW * 0.52, P.footArmW * 0.58, P.footH * 1.05, M.fanucYellow,
      ux * P.footR * 0.93, armY, uz * P.footR * 0.93, 10));
    footNuts.push({ pos: [ux * P.footR * 0.93, armY + P.footH * 0.6, uz * P.footR * 0.93] });
  }
  parts.push(instance(cylGeo(0.017 * S, 0.019 * S, 0.016, 6), M.steelDark, footNuts));

  // Yellow J1 plinth ring the body turns on.
  const plinthY = footY + P.footH;
  parts.push(frustum(P.plinthR, P.plinthR * 1.14, P.plinthH, M.fanucYellow, 0, plinthY + P.plinthH / 2, 0, 18));
  parts.push(frustum(P.plinthR * 1.04, P.plinthR * 1.04, 0.012, M.fanucYellowDark, 0, plinthY + P.plinthH, 0, 18));

  // Black cable-entry box on the back of the plinth.
  parts.push(box(0.13 * S, 0.15 * S, 0.22 * S, M.robotBlack, -P.plinthR - 0.05 * S, plinthY + 0.075 * S, 0));
  parts.push(cylX(0.028 * S, 0.06 * S, M.steelDark, -P.plinthR - 0.10 * S, plinthY + 0.075 * S, 0.06 * S, 10));

  return pack('robotFoot', parts);
}

/** The J1 body (turns about Y) plus the whole J2 knuckle assembly. */
function buildJ1Body(P) {
  const parts = [];
  const S = P.S;
  const baseTop = P.plateH + P.footH + P.plinthH;
  const bodyH = P.j2Y - baseTop + 0.10 * S;

  // Barrel casting, wider at the bottom, leaning toward the J2 axis.
  parts.push(frustum(P.j1W * 0.46, P.j1W * 0.54, 0.10 * S, M.fanucYellow, 0, baseTop + 0.05 * S, 0, 18));
  const body = roundedBox(P.j1W * 0.94, bodyH, P.j1D * 0.86, 0.075 * S, M.fanucYellow, 2);
  body.position.set(P.j2X * 0.34, baseTop + bodyH * 0.5, 0);
  parts.push(body);

  // Black side cover panel (photo: the flat dark plate on the near cheek).
  parts.push(box(0.20 * S, 0.19 * S, 0.014, M.robotBlack,
    P.j2X * 0.30, P.j2Y - 0.15 * S, P.j1D * 0.435));
  // ... and the cable-loom cover on the back.
  parts.push(box(0.09 * S, bodyH * 0.62, 0.20 * S, M.robotBlack,
    -P.j1W * 0.44, baseTop + bodyH * 0.44, 0));

  // ── J2 knuckle ──────────────────────────────────────────────────────────
  const kx = P.j2X;
  const ky = P.j2Y;
  parts.push(cylZ(P.knuckleR, P.knuckleD, M.fanucYellow, kx, ky, 0, 20));
  for (const sz of [-1, 1]) {
    parts.push(cylZ(P.knuckleR * 1.03, 0.022, M.fanucYellowDark, kx, ky, sz * (P.knuckleD / 2 - 0.012), 20));
    // bright red bearing caps — very visible on the hero robot in crop C
    parts.push(cylZ(P.knuckleR * 0.50, 0.045 * S, M.robotRed, kx, ky, sz * (P.knuckleD / 2 + 0.018 * S), 14));
    parts.push(cylZ(P.knuckleR * 0.22, 0.052 * S, M.steelBrushed, kx, ky, sz * (P.knuckleD / 2 + 0.026 * S), 12));
  }

  // ── the big black cylindrical J2 motor cover (−Z side) ──────────────────
  const mz = -(P.knuckleD / 2 + P.motorL / 2 + 0.012);
  const endZ = mz - P.motorL / 2;
  parts.push(cylZ(P.motorR, P.motorL, M.robotBlack, kx - 0.015 * S, ky - 0.02 * S, mz, 18));
  parts.push(cylZ(P.motorR * 0.86, 0.05 * S, M.steelDark, kx - 0.015 * S, ky - 0.02 * S, endZ - 0.024 * S, 18));
  parts.push(cylZ(P.motorR * 0.30, 0.03 * S, M.robotBlack, kx - 0.015 * S, ky - 0.02 * S, endZ - 0.055 * S, 10));
  parts.push(box(0.07 * S, 0.055 * S, 0.06 * S, M.robotBlack,
    kx - 0.015 * S, ky + P.motorR * 0.92, mz + P.motorL * 0.22));

  // small red label block clinging to the side of the motor housing
  parts.push(box(0.05 * S, 0.10 * S, 0.055 * S, M.robotRed,
    kx - P.motorR * 0.95, ky - 0.055 * S, mz - P.motorL * 0.16));

  // white nameplate + yellow warning triangle on the motor end face
  const faceZ = endZ - 0.052 * S;
  parts.push(billboard(0.095 * S, 0.048 * S, M.plasticWhite,
    kx - 0.015 * S, ky + 0.028 * S, faceZ, Math.PI));
  parts.push(billboard(0.062 * S, 0.062 * S, M.warningDecal,
    kx - 0.015 * S, ky - 0.048 * S, faceZ - 0.002, Math.PI));

  return pack('robotJ1', parts);
}

/** The J2 lower arm (a tapered flat casting) and the J3 elbow at its top. */
function buildLowerArm(P) {
  const parts = [];
  const S = P.S;
  const L = P.lower;
  const w1 = P.knuckleR * 1.62;
  const w2 = P.knuckleR * 1.24;
  const d1 = P.knuckleD * 0.84;

  // hip → shaft → neck gives the casting its taper without a lathe
  const hip = roundedBox(P.knuckleR * 2.05, 0.30 * S, P.knuckleD * 0.94, 0.09 * S, M.fanucYellow, 2);
  hip.position.set(0, 0.11 * S, 0);
  parts.push(hip);
  const shaft = roundedBox(w1, L * 0.74, d1, 0.055 * S, M.fanucYellow, 2);
  shaft.position.set(0, L * 0.44, 0);
  parts.push(shaft);
  const neck = roundedBox(w2, L * 0.26, P.knuckleD * 0.70, 0.05 * S, M.fanucYellow, 2);
  neck.position.set(0, L * 0.865, 0);
  parts.push(neck);

  // recessed side panels — the cast ribs read as a darker inset in the photo
  for (const sz of [-1, 1]) {
    parts.push(box(w1 * 0.76, L * 0.60, 0.010, M.fanucYellowDark, 0, L * 0.46, sz * d1 * 0.5));
  }
  // black cable clamp part-way up the back edge
  parts.push(box(0.085 * S, 0.06 * S, 0.15 * S, M.robotBlack, -w1 * 0.46, L * 0.78, 0));

  // ── J3 elbow ────────────────────────────────────────────────────────────
  parts.push(cylZ(P.knuckleR * 0.94, P.knuckleD * 0.86, M.fanucYellow, 0, L, 0, 20));
  parts.push(cylZ(P.knuckleR * 0.97, 0.024, M.fanucYellowDark, 0, L, -P.knuckleD * 0.42, 20));

  // the yellow "hook" lobe behind the elbow, with cast louvre slots
  const lobe = roundedBox(P.knuckleR * 1.55, P.knuckleR * 1.85, P.knuckleD * 0.78, 0.06 * S, M.fanucYellow, 2);
  lobe.position.set(-P.knuckleR * 0.78, L + P.knuckleR * 0.22, 0);
  parts.push(lobe);
  for (let i = 0; i < 3; i++) {
    parts.push(box(P.knuckleR * 0.92, 0.016 * S, 0.010, M.robotBlack,
      -P.knuckleR * 0.78, L + P.knuckleR * 0.02 + i * 0.042 * S, P.knuckleD * 0.40));
  }

  // black J3 motor boss on the +Z side
  parts.push(cylZ(P.motorR * 0.82, 0.11 * S, M.robotBlack, 0, L, P.knuckleD * 0.44 + 0.05 * S, 16));
  parts.push(cylZ(P.motorR * 0.60, 0.022 * S, M.steelDark, 0, L, P.knuckleD * 0.44 + 0.11 * S, 16));

  return pack('robotJ2', parts);
}

/** The J3 upper arm / forearm, the slim J4 roll section and its red ring. */
function buildUpperArm(P) {
  const parts = [];
  const S = P.S;
  const U = P.upper;
  const h = P.upperH;
  const d = P.upperD;

  const boss = roundedBox(0.28 * S, 0.31 * S, d, 0.075 * S, M.fanucYellow, 2);
  boss.position.set(0.10 * S, 0, 0);
  parts.push(boss);

  const shaft = roundedBox(U * 0.80, h, d * 0.86, 0.05 * S, M.fanucYellow, 2);
  shaft.position.set(U * 0.46, 0.008 * S, 0);
  parts.push(shaft);

  const taper = roundedBox(U * 0.30, h * 0.72, d * 0.64, 0.04 * S, M.fanucYellow, 2);
  taper.position.set(U * 0.85, 0, 0);
  parts.push(taper);

  // black cable duct along the top of the forearm + two clamps
  parts.push(box(U * 0.66, 0.05 * S, 0.085 * S, M.robotBlack, U * 0.46, h * 0.52, 0));
  parts.push(box(0.03 * S, 0.07 * S, 0.115 * S, M.robotBlack, U * 0.22, h * 0.46, 0));
  parts.push(box(0.03 * S, 0.07 * S, 0.115 * S, M.robotBlack, U * 0.70, h * 0.46, 0));

  // the little white FANUC model nameplate on the side of the forearm
  parts.push(box(0.24 * S, 0.030 * S, 0.002, M.plasticWhite, U * 0.45, h * 0.10, d * 0.435));

  // slim J4 roll section + the thin red accent ring at the wrist
  parts.push(cylX(0.088 * S, 0.17 * S, M.fanucYellow, U - 0.065 * S, 0, 0, 16));
  parts.push(cylX(0.093 * S, 0.016 * S, M.robotRed, U - 0.145 * S, 0, 0, 16));

  return pack('robotJ4', parts);
}

/** The compact J5 wrist yoke. */
function buildWrist(P) {
  const parts = [];
  const S = P.S;
  const yoke = roundedBox(0.155 * S, 0.19 * S, 0.175 * S, 0.05 * S, M.fanucYellow, 2);
  yoke.position.set(0.035 * S, 0, 0);
  parts.push(yoke);
  parts.push(cylZ(0.083 * S, 0.19 * S, M.fanucYellow, 0.018 * S, 0, 0, 16));
  for (const sz of [-1, 1]) {
    parts.push(cylZ(0.085 * S, 0.013 * S, M.robotRed, 0.018 * S, 0, sz * 0.098 * S, 16));
    parts.push(cylZ(0.030 * S, 0.018 * S, M.steelDark, 0.018 * S, 0, sz * 0.106 * S, 10));
  }
  return pack('robotJ5', parts);
}

/** The J6 roll tube and the bright brushed-steel tool flange. */
function buildFlangeHead(P) {
  const parts = [];
  const S = P.S;
  parts.push(cylX(0.062 * S, 0.088 * S, M.fanucYellow, 0.040 * S, 0, 0, 16));
  parts.push(cylX(0.066 * S, 0.012 * S, M.robotRed, 0.080 * S, 0, 0, 16));
  parts.push(cylX(0.057 * S, 0.020 * S, M.steelBrushed, 0.095 * S, 0, 0, 18));
  parts.push(cylX(0.019 * S, 0.026 * S, M.robotBlack, 0.098 * S, 0, 0, 10));
  const bolts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    bolts.push({
      pos: [0.104 * S, Math.sin(a) * 0.040 * S, Math.cos(a) * 0.040 * S],
      rot: [0, 0, -Math.PI / 2],
    });
  }
  parts.push(instance(cylGeo(0.007 * S, 0.007 * S, 0.010, 6), M.steelDark, bolts));
  return pack('robotJ6', parts);
}

// ────────────────────────────────────────────────────────────────────────────
// Tools
// ────────────────────────────────────────────────────────────────────────────

/**
 * Bar-type vacuum gripper: alu bar, five suction cups, a blue solenoid
 * manifold and a green mounting plate. Built in flange space: the mounting face
 * is at the origin and the tool grows along +X.
 */
function buildBarVacuum(P) {
  const S = P.S;
  const parts = [];
  parts.push(cylX(0.056 * S, 0.014 * S, M.steelBrushed, 0.007 * S, 0, 0, 16));
  parts.push(box(0.055 * S, 0.135 * S, 0.135 * S, M.robotBlack, 0.042 * S, 0, 0));
  parts.push(box(0.012 * S, 0.10 * S, 0.20 * S, M.aluPlain, 0.075 * S, 0, 0));

  // blue solenoid manifold with its silver valve caps
  parts.push(box(0.075 * S, 0.085 * S, 0.155 * S, M.robotBlue, 0.115 * S, 0.030 * S, 0));
  for (let i = 0; i < 4; i++) {
    parts.push(cylX(0.013 * S, 0.026 * S, M.aluPlain,
      0.158 * S, 0.038 * S, (-0.055 + i * 0.037) * S, 8));
  }
  parts.push(box(0.006 * S, 0.014 * S, 0.09 * S, M.robotRed, 0.153 * S, 0.070 * S, 0));

  // green mounting plate + aluminium cup bar
  parts.push(box(0.014 * S, 0.075 * S, 0.28 * S, MAT.trayGreen, 0.150 * S, -0.030 * S, 0));
  parts.push(box(0.05 * S, 0.05 * S, 0.42 * S, M.aluPlain, 0.183 * S, -0.038 * S, 0));

  // five suction cups hanging off the bar
  const cups = [];
  const stems = [];
  for (let i = 0; i < 5; i++) {
    const z = (-0.16 + i * 0.08) * S;
    stems.push({ pos: [0.213 * S, -0.038 * S, z], rot: [0, 0, -Math.PI / 2] });
    cups.push({ pos: [0.243 * S, -0.038 * S, z], rot: [0, 0, -Math.PI / 2] });
  }
  parts.push(instance(cylGeo(0.009 * S, 0.009 * S, 0.030 * S, 8), M.aluPlain, stems));
  parts.push(instance(cylGeo(0.034 * S, 0.019 * S, 0.030 * S, 12), MAT.cupGrey, cups));

  // a couple of air tubes from the manifold down to the bar
  for (const z of [-0.06 * S, 0.06 * S]) {
    parts.push(box(0.075 * S, 0.008 * S, 0.008 * S, M.robotBlue, 0.170 * S, -0.006 * S, z));
  }
  return pack('toolBarVacuum', parts);
}

/**
 * The large blue rectangular vacuum frame the hero robot carries: extrusion
 * frame ≈ 1.1 × 0.7 m, a grid of twelve grey cups and a green tray edge.
 * Built in flange space, the frame plane perpendicular to +X.
 */
function buildBlueVacuumFrame(P) {
  const S = P.S;
  const parts = [];
  const LZ = 1.10;
  const LY = 0.70;
  const t = 0.055;

  parts.push(cylX(0.058 * S, 0.016 * S, M.steelBrushed, 0.008 * S, 0, 0, 16));
  parts.push(box(0.022, 0.24, 0.26, M.steelBrushed, 0.024, 0, 0));
  // blue pyramid-ish mounting hub
  parts.push(box(0.075, 0.26, 0.30, MAT.frameBlue, 0.072, 0, 0));
  parts.push(box(0.030, 0.34, 0.44, MAT.frameBlue, 0.120, 0, 0));

  const fx = 0.150;
  // outer rectangle
  for (const sy of [-1, 1]) parts.push(box(t, t, LZ, MAT.frameBlue, fx, (sy * LY) / 2, 0));
  for (const sz of [-1, 1]) parts.push(box(t, LY - t, t, MAT.frameBlue, fx, 0, (sz * LZ) / 2 - sz * t / 2));
  // two internal cross rails
  for (const sy of [-1, 1]) parts.push(box(t * 0.8, t * 0.8, LZ - t, MAT.frameBlue, fx, sy * LY * 0.18, 0));
  // three transverse ties
  for (const z of [-LZ * 0.3, 0, LZ * 0.3]) {
    parts.push(box(t * 0.7, LY - t, t * 0.7, MAT.frameBlue, fx, 0, z));
  }

  // grid of suction cups (4 along the frame × 3 across)
  const cups = [];
  const stems = [];
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 3; k++) {
      const z = (-0.375 + i * 0.25);
      const y = (-0.22 + k * 0.22);
      stems.push({ pos: [fx + 0.038, y, z], rot: [0, 0, -Math.PI / 2] });
      cups.push({ pos: [fx + 0.070, y, z], rot: [0, 0, -Math.PI / 2] });
    }
  }
  parts.push(instance(cylGeo(0.012, 0.012, 0.042, 8), M.aluPlain, stems));
  parts.push(instance(cylGeo(0.040, 0.024, 0.034, 12), MAT.cupGrey, cups));

  // the bright green tray edge along the leading long side
  parts.push(box(0.055, 0.030, LZ + 0.03, MAT.trayGreen, fx + 0.055, -LY / 2 - 0.028, 0));
  const teeth = [];
  for (let i = 0; i < 14; i++) {
    teeth.push({ pos: [fx + 0.055, -LY / 2 - 0.052, -LZ / 2 + 0.045 + i * 0.078] });
  }
  parts.push(instance(boxGeo(0.05, 0.026, 0.028), MAT.trayGreen, teeth));

  // small solenoid pack + vacuum hoses on the back of the frame
  parts.push(box(0.06, 0.07, 0.18, M.robotBlue, fx - 0.055, LY * 0.28, -0.16));
  parts.push(box(0.05, 0.05, 0.12, M.robotBlack, fx - 0.050, LY * 0.28, 0.20));
  for (const z of [-0.30, 0.30]) {
    parts.push(box(0.028, 0.028, 0.34, M.cableBlack, fx - 0.040, LY * 0.10, z));
  }
  return pack('toolBlueVacuumFrame', parts);
}

/** Simple two-finger pneumatic gripper. */
function buildTwoFingerGripper(P) {
  const S = P.S;
  const parts = [];
  parts.push(cylX(0.056 * S, 0.014 * S, M.steelBrushed, 0.007 * S, 0, 0, 16));
  parts.push(box(0.055 * S, 0.10 * S, 0.10 * S, M.robotBlack, 0.042 * S, 0, 0));
  parts.push(box(0.10 * S, 0.075 * S, 0.13 * S, M.aluPlain, 0.120 * S, 0, 0));
  parts.push(box(0.035 * S, 0.05 * S, 0.16 * S, M.aluPlain, 0.185 * S, 0, 0));
  for (const sz of [-1, 1]) {
    parts.push(box(0.11 * S, 0.022 * S, 0.020 * S, M.steelBrushed, 0.255 * S, 0, sz * 0.055 * S));
    parts.push(box(0.030 * S, 0.030 * S, 0.028 * S, M.rubberBlack, 0.305 * S, 0, sz * 0.048 * S));
    parts.push(cylX(0.011 * S, 0.030 * S, M.robotBlue, 0.150 * S, 0.048 * S, sz * 0.045 * S, 8));
  }
  return pack('toolGripper', parts);
}

/** Dispatch for the `tool` option. */
function buildTool(kind, P) {
  if (kind === 'barVacuum') return buildBarVacuum(P);
  if (kind === 'blueVacuumFrame') return buildBlueVacuumFrame(P);
  if (kind === 'gripper') return buildTwoFingerGripper(P);
  return null;
}

// ────────────────────────────────────────────────────────────────────────────
// Dress pack
// ────────────────────────────────────────────────────────────────────────────

/**
 * The cream corrugated dress-pack conduit(s). Routed with a CatmullRomCurve3
 * through control points derived from the *posed* joint positions, expressed in
 * J1-local space so the loop turns with the waist. Returns a Group to be added
 * to the J1 node.
 */
function buildDressPack(P, root, j1, joints, flangeObj, rng) {
  root.updateMatrixWorld(true);
  const toJ1 = new THREE.Matrix4().copy(j1.matrixWorld).invert();
  const local = (o) => o.getWorldPosition(new THREE.Vector3()).applyMatrix4(toJ1);

  const S = P.S;
  const pElbow = local(joints.j3);
  const pWrist = local(joints.j5);
  const pFlange = local(flangeObj);

  // apex of the loop: high above the middle of the forearm
  const apex = pElbow.clone().lerp(pWrist, 0.55);
  apex.y += (0.56 + rf(rng, -0.03, 0.04)) * S;
  apex.x -= 0.05 * S;

  const bracket = V3(-0.20 * S, 0.19 * S, 0);
  const spine = [
    // the tail stops just above the mounting face — below it the loom
    // disappears into the top of the pedestal.
    bracket.clone().add(V3(0.03 * S, -0.10 * S, 0)),
    bracket,
    V3(-0.33 * S, 0.60 * S, 0),
    pElbow.clone().add(V3(-0.31 * S, 0.24 * S, 0)),
    apex,
    pWrist.clone().add(V3(-0.02 * S, 0.34 * S, 0)),
    pFlange.clone().add(V3(0.03 * S, 0.12 * S, 0)),
  ];

  const parts = [];
  const n = Math.max(1, P.hoseCount | 0);
  const gap = P.hoseR * 2.35;

  for (let i = 0; i < n; i++) {
    const dz = n === 1 ? 0 : (i - (n - 1) / 2) * gap;
    const pts = spine.map((p) => new THREE.Vector3(p.x, p.y, p.z + dz));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
    const len = curve.getLength();
    const seg = Math.max(56, Math.min(210, Math.round(len / 0.017)));
    const hose = corrugatedTube(curve, M.dressHose, {
      radius: P.hoseR,
      segments: seg,
      radial: 10,
      corrugate: true,
      corrugatePeriod: 0.058,
      corrugateDepth: 0.20,
    });
    hose.name = `dressHose${i}`;
    parts.push(hose);

    // the black clamp rings — a pair just before/after the apex plus one at
    // the wrist end, exactly as in crop H.
    const R = P.hoseR * 1.28;
    parts.push(clampRing(curve, 0.055, R, 0.016 * S, M.robotBlack));
    parts.push(clampRing(curve, 0.455, R, 0.019 * S, M.robotBlack));
    parts.push(clampRing(curve, 0.545, R, 0.019 * S, M.robotBlack));
    parts.push(clampRing(curve, 0.935, R, 0.017 * S, M.robotBlack));
  }

  // black bracket at the base of the loop
  parts.push(box(0.11 * S, 0.13 * S, gap * n + 0.09 * S, M.robotBlack, bracket.x, bracket.y, 0));
  parts.push(box(0.055 * S, 0.20 * S, gap * n + 0.05 * S, M.robotBlack,
    bracket.x + 0.05 * S, bracket.y - 0.10 * S, 0));

  // shared black yoke bar across the apex (the pair-carrier on the hero robot)
  if (n > 1) {
    parts.push(box(0.045 * S, 0.045 * S, gap * n + 0.05 * S, M.robotBlack, apex.x, apex.y, 0));
  }
  // black clamp bracket near the wrist
  const wc = pFlange.clone().add(V3(0.03 * S, 0.12 * S, 0));
  parts.push(box(0.07 * S, 0.09 * S, gap * n + 0.06 * S, M.robotBlack, wc.x, wc.y, 0));

  const g = pack('dressPack', parts);
  g.name = 'dressPack';
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Exports
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parametric FANUC-style 6-axis articulated arm, complete with its dress pack
 * and end-effector.
 *
 * Origin = the centre of the base mounting face (y = 0 is the top of the
 * pedestal it bolts to); the arm reaches toward **+X** at pose 0 and the J2/J3
 * axes run along Z.
 *
 * Joint sign convention (documented because the poses in `CFG.robots` rely on
 * it): `j1` yaws about +Y; a **negative** `j2` leans the lower arm forward
 * toward +X; `j3` swings the forearm up from the perpendicular; `j4` rolls the
 * forearm about its own axis; a **positive** `j5` pitches the wrist *down*;
 * `j6` rolls the flange.
 *
 * @param {object} o
 * @param {'m710'|'r2000'} [o.model='m710'] size class — m710 ≈ 2.05 m reach and
 *        slim, r2000 ≈ 2.65 m reach and chunkier (and gets two dress hoses).
 * @param {number[]} [o.pose=[0,0,0,0,0,0]] `[j1,j2,j3,j4,j5,j6]` in radians.
 * @param {'barVacuum'|'blueVacuumFrame'|'gripper'|'none'} [o.tool='barVacuum']
 * @param {boolean} [o.dressPack=true] emit the cream corrugated conduit loop.
 * @param {number} [o.seed=7] seed for the (small) deterministic variation.
 * @returns {THREE.Group} named 'robot', with `.userData.joints = {j1..j6}` (the
 *          pivot Object3Ds, so the arm can be re-posed or animated) and
 *          `.userData.flange`, an Object3D sitting on the tool mounting face.
 */
export function buildRobot(o = {}) {
  const {
    model = 'm710',
    pose = [0, 0, 0, 0, 0, 0],
    tool = 'barVacuum',
    dressPack = true,
    seed = 7,
  } = o;

  const P = MODELS[model] || MODELS.m710;
  const rng = makeRng(seed >>> 0 || 7);
  const p = [0, 0, 0, 0, 0, 0].map((_, i) => (typeof pose[i] === 'number' ? pose[i] : 0));

  const root = new THREE.Group();
  root.name = 'robot';

  // ── static base ─────────────────────────────────────────────────────────
  root.add(buildFoot(P));

  // ── J1 (waist, about +Y) ────────────────────────────────────────────────
  const j1 = new THREE.Group();
  j1.name = 'J1';
  j1.rotation.y = p[0];
  root.add(j1);
  j1.add(buildJ1Body(P));

  // ── J2 (shoulder, about +Z) ─────────────────────────────────────────────
  const j2 = new THREE.Group();
  j2.name = 'J2';
  j2.position.set(P.j2X, P.j2Y, 0);
  j2.rotation.z = p[1];
  j1.add(j2);
  j2.add(buildLowerArm(P));

  // ── J3 (elbow, about +Z) ────────────────────────────────────────────────
  const j3 = new THREE.Group();
  j3.name = 'J3';
  j3.position.set(0, P.lower, 0);
  j3.rotation.z = p[2];
  j2.add(j3);

  // ── J4 (forearm roll, about the arm's own +X) ───────────────────────────
  const j4 = new THREE.Group();
  j4.name = 'J4';
  j4.rotation.x = p[3];
  j3.add(j4);
  j4.add(buildUpperArm(P));

  // ── J5 (wrist pitch — positive pitches the tool down) ───────────────────
  const j5 = new THREE.Group();
  j5.name = 'J5';
  j5.position.set(P.upper, 0, 0);
  j5.rotation.z = -p[4];
  j4.add(j5);
  j5.add(buildWrist(P));

  // ── J6 (flange roll) ────────────────────────────────────────────────────
  const j6 = new THREE.Group();
  j6.name = 'J6';
  j6.position.set(0.100 * P.S, 0, 0);
  j6.rotation.x = p[5];
  j5.add(j6);
  j6.add(buildFlangeHead(P));

  const flange = new THREE.Object3D();
  flange.name = 'flange';
  flange.position.set(0.107 * P.S, 0, 0);
  j6.add(flange);

  // ── tool ────────────────────────────────────────────────────────────────
  if (tool && tool !== 'none') {
    const t = buildTool(tool, P);
    if (t) flange.add(t);
  }

  // ── dress pack (needs the posed world matrices, so it goes last) ────────
  if (dressPack) j1.add(buildDressPack(P, root, j1, { j3, j5 }, flange, rng));

  root.userData.joints = { j1, j2, j3, j4, j5, j6 };
  root.userData.flange = flange;
  root.userData.model = model;
  root.userData.pose = p.slice();
  return root;
}

/**
 * The pedestal a robot stands on. Origin on the floor, top face at `y = h`, so
 * a robot placed at that height lands exactly on it.
 *
 * `'cast'` reproduces the foreground pedestals of crop I: a cream sand-cast
 * column with a deep concave cove sweeping out to a bolted-down base flange, a
 * cream top flange and a thin dark machined plate on top.
 * `'box'` is the plainer tapered ivory box under the hero robot in crop C.
 *
 * @param {'cast'|'box'} [kind='cast']
 * @param {number} [h=0.62] overall height in metres.
 * @returns {THREE.Group} named 'robotPedestal'.
 */
export function buildRobotPedestal(kind = 'cast', h = 0.62) {
  const parts = [];
  const rng = makeRng(4127);

  if (kind === 'box') {
    const bodyH = h - 0.075;
    parts.push(box(0.94, 0.045, 0.88, M.machineIvoryDark, 0, 0.0225, 0));
    const body = new THREE.Mesh(cylGeo(0.38 * Math.SQRT2, 0.45 * Math.SQRT2, bodyH, 4), M.machineIvory);
    body.rotation.y = Math.PI / 4;
    body.position.y = 0.045 + bodyH / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    parts.push(body);
    parts.push(box(0.84, 0.030, 0.78, M.machineIvory, 0, h - 0.055, 0));
    parts.push(box(0.80, 0.040, 0.74, M.robotDarkGrey, 0, h - 0.020, 0));
    parts.push(billboard(0.085, 0.058, M.paper, 0.16, h * 0.52, 0.418, 0));
  } else {
    const k = h / 0.62;

    // bolted base flange with rounded corners (roundedBox bevels outward by
    // 0.4·r on every axis, so the slab really is 0.068 thick — sit it on y = 0)
    const flange = roundedBox(0.94, 0.88, 0.032, 0.045, M.pedestal, 2);
    flange.rotation.x = -Math.PI / 2;
    flange.position.y = 0.034;
    parts.push(flange);

    // four anchor bolts standing proud of the flange
    const studs = [];
    const nuts = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        studs.push({ pos: [sx * 0.405, 0.085, sz * 0.375] });
        nuts.push({ pos: [sx * 0.405, 0.062, sz * 0.375] });
      }
    }
    parts.push(instance(cylGeo(0.011, 0.011, 0.09, 8), M.steelDark, studs));
    parts.push(instance(cylGeo(0.021, 0.023, 0.020, 6), M.steelDark, nuts));

    // the concave cove sweeping up into a near-cylindrical column
    const prof = [
      [0.042, 0.455],
      [0.100, 0.398],
      [0.190, 0.357],
      [0.335, 0.339],
      [0.440, 0.352],
      [0.510, 0.398],
    ];
    for (let i = 0; i < prof.length - 1; i++) {
      const [y0, r0] = prof[i];
      const [y1, r1] = prof[i + 1];
      const seg = (y1 - y0) * k;
      parts.push(frustum(r1, r0, seg, M.pedestal, 0, (y0 * k) + seg / 2, 0, 20, true));
    }

    // cream top flange, then the thin dark machined plate
    const colTop = 0.510 * k;
    const topH = Math.max(0.05, h - 0.030 - colTop);
    const top = roundedBox(0.86, 0.80, topH, 0.05, M.pedestal, 2);
    top.rotation.x = -Math.PI / 2;
    top.position.y = colTop + topH / 2;
    parts.push(top);
    parts.push(box(0.80, 0.030, 0.74, M.robotDarkGrey, 0, h - 0.015, 0));

    // the little paper equipment labels stuck to the column
    parts.push(billboard(0.075, 0.052, M.paper, 0.055, h * 0.60, 0.344, 0));
    parts.push(billboard(0.062, 0.044, M.paper, -0.11, h * 0.38, 0.337, rf(rng, -0.05, 0.05)));
  }

  const g = pack('robotPedestal', parts);
  g.name = 'robotPedestal';
  return g;
}
