/**
 * crane.js — the orange single-girder overhead travelling crane and its runways.
 *
 * This is the most recognisable object in `img01.jpg`: a slender deep-orange box
 * girder crossing the upper third of the frame, five white 安全第一 panels on its
 * camera-facing web, a small yellow electric chain hoist parked left of centre,
 * and eleven catenary loops of festoon cable strung beneath it.
 *
 * Everything here was measured off the photograph:
 *   • scanning the orange across the frame gives a near-constant 24 px web with
 *     a 3 px camber over the whole 635 px span: the girder is a genuinely
 *     slender blade, and the only section detail the camera resolves is a
 *     hairline top lip and a single dark stroke under the bottom flange — hence
 *     the thin `WEB_T` / `BOT_FLANGE_T` / `LIP_T` below;
 *   • the ends deepen by ≈ 11 px over ≈ 0.8 m before meeting the end trucks —
 *     a short, shallow haunch, not the long wedge that reads as a slab;
 *   • the five sign panels are NOT evenly spaced. Back-projecting their pixel
 *     centres (x = 142, 262, 336, 406, 530 in the 960 px frame) through the
 *     `CFG.camera` pinhole gives gaps of ≈ 2.3 / 1.4 / 1.3 / 2.3 m — a
 *     wide-narrow-narrow-wide rhythm that is very legible in the render;
 *   • the festoon hangers step from ≈ 1.17 m down to ≈ 0.33 m apart, bunching
 *     toward the fixed (+X) end with the loops trailing back to the trolley;
 *   • each end truck dips ≈ 0.2 m below the girder soffit and is tied into the
 *     web by a diagonal end rib plus a short haunch.
 *
 * Coordinates: metres, +X right, +Y up, −Z down the hall.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG } from '../core/config.js';
import { M, variant } from '../core/materials.js';
import * as T from '../core/textures.js';
import {
  box, cyl, cylX, cylZ, cable, catenary, instance, mergeGroup, group,
  makeRng, rf, V3,
} from '../core/utils.js';

const C = CFG.crane;

/** Overall depth of the bridge girder (m) — fixed by CFG, do not derive around it. */
const GIRDER_D = C.girderTopY - C.girderBottomY; // 0.85
/** Half the bridge span — the bridge runs rail centre to rail centre. */
const HALF_SPAN = C.runwayX; // 5.6
/**
 * Thickness of the box-girder *web* (its extent along Z).
 *
 * `CFG.crane.girderWidth` (0.38) is the nominal box width the rest of the scene
 * is dimensioned against and must not change, but the photograph's girder is a
 * markedly thinner plate than that: at 11.2 m span it reads as a shallow, almost
 * two-dimensional blade, and the only parts of the section the camera actually
 * resolves are the flange overhangs — which are hairlines in `img01.jpg`, not
 * the 70 mm ledges a 0.38 m box produces. Slimming the drawn web to 0.26 kills
 * the "slab" read without touching a single CFG value.
 */
const WEB_T = 0.26;
/** Width of the bottom flange the hoist trolley rides on. */
const BOT_FLANGE_W = WEB_T + 0.08; // 0.34
/** Thickness of that flange (the trolley hooks over it) — a thin plate, not a slab. */
const BOT_FLANGE_T = 0.03;
/** The crisp top lip: a narrow capping plate, barely proud of the web. */
const LIP_OVERHANG = 0.028; // each side
const LIP_T = 0.016;
/** End haunch geometry — short and shallow, as measured off the photo's ends. */
const HAUNCH_LEN = 0.85;
const HAUNCH_DROP = 0.14;

/** Glyphs of the 安全第一 panel row, left → right as seen in the photo. */
const SIGN_GLYPHS = ['安', '全', 'cross', '第', '一'];
/**
 * Measured (deliberately non-uniform) panel centres along the span, local X.
 * Obtained by back-projecting the panels' pixel centres through the `CFG.camera`
 * pinhole and re-centring on the crane's own mid-span: the gaps come out
 * 2.32 / 1.39 / 1.32 / 2.32 m — wide, narrow, narrow, wide.
 */
const SIGN_X = [-3.54, -1.22, 0.17, 1.49, 3.81];
const SIGN_SIZE = 0.30;
/** Height of the panel centres up the web. */
const SIGN_Y = 0.38;

const SEED_CRANE = 40711;

// ────────────────────────────────────────────────────────────────────────────
// Local helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Merge a subtree whose meshes MIX indexed (Box/Cylinder) and non-indexed
 * (Extrude) geometry into one Mesh. `mergeGroup()` from core/utils.js cannot do
 * this — `mergeGeometries` rejects a batch that is not uniformly indexed — so
 * everything is converted to non-indexed first.
 * @param {THREE.Object3D} src
 * @param {THREE.Material} material
 * @returns {THREE.Mesh|null}
 */
function mergeMixed(src, material) {
  src.updateMatrixWorld(true);
  const geos = [];
  src.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const key of Object.keys(g.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') g.deleteAttribute(key);
    }
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    geos.push(g);
  });
  if (!geos.length) return null;
  const m = new THREE.Mesh(mergeGeometries(geos, false), material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Painted-steel sign plate carrying one 安全第一 glyph.
 * @param {string} which '安' | '全' | 'cross' | '第' | '一'
 * @returns {THREE.MeshStandardMaterial}
 */
function signPanelMaterial(which) {
  return variant(
    'steelWhite',
    {
      map: T.signGirderPanel(which),
      color: 0xffffff,
      roughness: 0.58,
      metalness: 0.04,
      needsUpdate: true,
    },
    `girderSign-${which}`,
  );
}

/** Milky translucent fabric of the hoist's chain bucket. */
function chainBucketMaterial() {
  return variant(
    'plasticWhite',
    {
      color: 0xe9ece8,
      transparent: true,
      opacity: 0.55,
      roughness: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    },
    'chainBucket',
  );
}

/**
 * Top edge of the bridge girder *web* at local X (local Y = 0 is the rail top,
 * i.e. the girder soffit). The capping lip sits on top of this, so the assembly
 * tops out at exactly `GIRDER_D` (= CFG's girderTopY) at mid-span.
 *
 * Camber is deliberately tiny: scanning the photograph's girder gives a top edge
 * that drifts only ~3 px over the whole 635 px span, i.e. ≈ 0.05 m of rise, so a
 * 30 mm camber is all that is warranted. Anything more and the girder starts to
 * read as a bowed slab instead of a straight blade.
 * @param {number} x
 * @returns {number}
 */
function girderTopLocal(x) {
  const xc = Math.max(-HALF_SPAN, Math.min(HALF_SPAN, x));
  return GIRDER_D - LIP_T - 0.03 + 0.03 * (0.5 + 0.5 * Math.cos((Math.PI * xc) / HALF_SPAN));
}

/**
 * A closed 2-D band between two Y-of-X functions, ready to extrude along Z.
 * @param {number} x0 @param {number} x1
 * @param {(x:number)=>number} fLo lower edge
 * @param {(x:number)=>number} fHi upper edge
 * @param {number} hiSamples segments along the upper edge
 * @param {number} loSamples segments along the lower edge (1 when it is flat)
 * @returns {THREE.Shape}
 */
function bandShape(x0, x1, fLo, fHi, hiSamples = 24, loSamples = hiSamples) {
  const s = new THREE.Shape();
  for (let i = 0; i <= loSamples; i++) {
    const x = x0 + ((x1 - x0) * i) / loSamples;
    if (i === 0) s.moveTo(x, fLo(x));
    else s.lineTo(x, fLo(x));
  }
  for (let i = hiSamples; i >= 0; i--) {
    const x = x0 + ((x1 - x0) * i) / hiSamples;
    s.lineTo(x, fHi(x));
  }
  s.closePath();
  return s;
}

/** Extrude a shape symmetrically about Z and return a shadowed Mesh. */
function extrudeBand(shape, width, material) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
  geo.translate(0, 0, -width / 2);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ────────────────────────────────────────────────────────────────────────────
// Runways
// ────────────────────────────────────────────────────────────────────────────

/** One triangular wall corbel, merged down to a single geometry for instancing. */
function makeCorbelGeometry() {
  const reach = 0.84; // pilaster face → outer edge of the seat plate
  const drop = 0.62;
  const g = new THREE.Group();
  // seat plate, directly under the runway girder soffit
  g.add(box(reach, 0.026, 0.34, M.steelWhite, -reach / 2, -0.013, 0));
  // back plate bolted to the pilaster
  g.add(box(0.032, drop + 0.12, 0.34, M.steelWhite, -0.016, -(drop + 0.12) / 2 + 0.03, 0));
  // two triangular gussets
  const tri = new THREE.Shape();
  tri.moveTo(-0.02, -0.026);
  tri.lineTo(-reach + 0.05, -0.026);
  tri.lineTo(-0.02, -drop);
  tri.closePath();
  const triGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.018, bevelEnabled: false });
  for (const z of [-0.115, 0.097]) {
    const m = new THREE.Mesh(triGeo, M.steelWhite);
    m.position.z = z;
    g.add(m);
  }
  return mergeMixed(g, M.steelWhite).geometry;
}

/**
 * The two crane runway girders, their rails, the vertical web stiffeners, the
 * triangular wall corbels that carry them, and the runway conductor bar on the
 * inside face of the right-hand girder.
 *
 * Welded plate girders in `M.steelWhite`, `CFG.crane.runwayDepth` deep, soffit at
 * `CFG.crane.runwaySoffitY`, centred on `x = ±CFG.crane.runwayX`, running the full
 * hall length; stiffener plates every 1.8 m on the hall-facing web face, exactly
 * as they read in the photo. Already in WORLD coordinates — `layout.js` adds this
 * at the origin without transforming it.
 *
 * @returns {THREE.Group} named 'craneRunways'
 */
export function buildCraneRunways() {
  const g = group('craneRunways');

  const zA = CFG.hall.zFront - 0.4; // +5.6
  const zB = CFG.hall.zBack + 0.3; // −46.5
  const len = zA - zB;
  const zc = (zA + zB) / 2;

  const flangeT = 0.028;
  const webT = 0.020;
  const soffit = C.runwaySoffitY;
  const dep = C.runwayDepth;
  const fw = C.runwayFlangeW;

  // ── plate girders: top flange / bottom flange / web ───────────────────────
  const steel = new THREE.Group();
  for (const side of [1, -1]) {
    const x = side * C.runwayX;
    steel.add(box(fw, flangeT, len, M.steelWhite, x, soffit + dep - flangeT / 2, zc));
    steel.add(box(fw, flangeT, len, M.steelWhite, x, soffit + flangeT / 2, zc));
    steel.add(box(webT, dep - flangeT * 2, len, M.steelWhite, x, soffit + dep / 2, zc));
  }
  const girders = mergeGroup(steel, M.steelWhite);
  girders.name = 'runwayGirders';
  g.add(girders);

  // ── crane rails sitting on the top flanges ────────────────────────────────
  const rails = new THREE.Group();
  for (const side of [1, -1]) {
    rails.add(box(0.075, 0.07, len, M.steelDark, side * C.runwayX, C.railTopY - 0.035, zc));
  }
  const railMesh = mergeGroup(rails, M.steelDark);
  railMesh.name = 'runwayRails';
  g.add(railMesh);

  // ── vertical web stiffeners every 1.8 m ───────────────────────────────────
  const stiffPitch = 1.8;
  const stiffN = Math.floor(len / stiffPitch);
  const stiffGeo = new THREE.BoxGeometry(0.125, dep - flangeT * 2, 0.018);
  const stiffTf = [];
  for (const side of [1, -1]) {
    for (let i = 0; i <= stiffN; i++) {
      stiffTf.push({ pos: [side * (C.runwayX - 0.0725), soffit + dep / 2, zA - i * stiffPitch] });
    }
  }
  const stiffeners = instance(stiffGeo, M.steelWhite, stiffTf);
  stiffeners.name = 'runwayStiffeners';
  g.add(stiffeners);

  // ── triangular corbels off every wall pilaster ────────────────────────────
  const corbelGeo = makeCorbelGeometry();
  const pilasterX = CFG.hall.halfWidth - CFG.column.depth; // 6.28
  const corbelTf = [];
  for (const z of CFG.bay.all()) {
    corbelTf.push({ pos: [pilasterX, soffit, z] });
    // rotate (never mirror-scale) so the winding order stays right-handed
    corbelTf.push({ pos: [-pilasterX, soffit, z], rot: [0, Math.PI, 0] });
  }
  const corbels = instance(corbelGeo, M.steelWhite, corbelTf);
  corbels.name = 'runwayCorbels';
  g.add(corbels);

  // ── conductor bar on the inside face of the right runway girder ───────────
  const cbX = C.runwayX - 0.32; // 5.28
  const cbY = 4.80;
  const bar = box(0.055, 0.13, len, M.craneOrange, cbX, cbY, zc);
  bar.name = 'conductorBar';
  g.add(bar);
  g.add(box(0.024, 0.055, len, M.plasticWhite, cbX - 0.036, cbY - 0.028, zc));

  const cbClipGeo = new THREE.BoxGeometry(0.30, 0.024, 0.05);
  const cbClipTf = [];
  for (let i = 0; i <= stiffN; i++) {
    cbClipTf.push({ pos: [(C.runwayX - 0.02 + cbX) / 2, cbY + 0.088, zA - i * stiffPitch] });
  }
  g.add(instance(cbClipGeo, M.steelWhiteDark, cbClipTf));

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Bridge crane sub-assemblies
// ────────────────────────────────────────────────────────────────────────────

/**
 * One orange end truck. Local origin on the rail top plane at the truck centre;
 * the wheel-frame plates straddle the rail and dip below the girder soffit,
 * which is what gives the truck its noticeably deeper silhouette in the photo.
 * @param {1|-1} side +1 = right-hand (+X) truck
 * @param {boolean} driven give this truck the long-travel motor/gearbox lump
 * @returns {THREE.Group}
 */
function buildEndTruck(side, driven) {
  const g = new THREE.Group();
  g.name = `endTruck${side > 0 ? 'R' : 'L'}`;
  const L = C.endTruckLen; // 1.5
  const plateX = 0.205; // clears the 0.30 m runway top flange

  const orange = new THREE.Group();
  const dark = new THREE.Group();
  const steel = new THREE.Group();

  // wheel-frame side plates — the big shaded faces, so the darker orange
  for (const sx of [-1, 1]) dark.add(box(0.024, 0.72, L, M.craneOrangeDark, sx * plateX, 0.16, 0));
  // cross box between the plates
  dark.add(box(plateX * 2 - 0.02, 0.34, L - 0.06, M.craneOrangeDark, 0, 0.35, 0));
  // capping plate over the frame, catching the light like the girder
  orange.add(box(plateX * 2 + 0.08, 0.05, L + 0.05, M.craneOrange, 0, 0.545, 0));
  // transverse end plates closing the frame
  for (const sz of [-1, 1]) {
    orange.add(box(plateX * 2 + 0.03, 0.72, 0.03, M.craneOrange, 0, 0.16, sz * (L / 2 - 0.015)));
  }

  // four wheels on the rail plus their outboard axle bosses
  for (const z of [-0.46, -0.16, 0.16, 0.46]) {
    steel.add(cylX(0.155, 0.10, M.steelDark, 0, 0.155, z, 12));
    for (const sx of [-1, 1]) {
      steel.add(cylX(0.055, 0.03, M.steelDark, sx * (plateX + 0.017), 0.155, z, 8));
    }
  }

  g.add(mergeMixed(orange, M.craneOrange));
  g.add(mergeMixed(dark, M.craneOrangeDark));
  g.add(mergeMixed(steel, M.steelDark));

  // rubber-faced buffers
  const buff = new THREE.Group();
  for (const sz of [-1, 1]) buff.add(box(0.14, 0.14, 0.06, M.rubberBlack, 0, 0.30, sz * (L / 2 + 0.04)));
  g.add(mergeGroup(buff, M.rubberBlack));

  // long-travel drive hanging on the inboard face
  if (driven) {
    const inx = -side * (plateX + 0.14);
    const drive = new THREE.Group();
    drive.add(box(0.26, 0.26, 0.34, M.steelDark, inx, 0.10, 0.36));
    drive.add(cylX(0.085, 0.26, M.steelDark, inx - side * 0.20, 0.10, 0.36, 10));
    drive.add(box(0.10, 0.14, 0.10, M.steelDark, inx, 0.30, 0.16));
    g.add(mergeGroup(drive, M.steelDark));
  }

  return g;
}

/**
 * The yellow electric chain hoist trolley: a carriage hooked over the girder's
 * bottom flange, the hoist body, a translucent chain bucket, the load chain, an
 * orange hook block and the pendant control hanging on its own cable. Local
 * origin at the girder soffit (local Y = 0 = rail top) on the bridge centreline.
 * @param {number} hookLocalY local Y of the hook block
 * @returns {THREE.Group}
 */
function buildHoistTrolley(hookLocalY) {
  const g = new THREE.Group();
  g.name = 'hoistTrolley';

  const yellow = new THREE.Group();
  const steel = new THREE.Group();
  const black = new THREE.Group();

  // ── carriage hooked over the bottom flange ────────────────────────────────
  for (const sz of [-1, 1]) {
    yellow.add(box(0.30, 0.28, 0.026, M.hoistYellow, 0, 0.02, sz * (BOT_FLANGE_W / 2 + 0.028)));
    for (const sx of [-1, 1]) {
      steel.add(cylZ(0.046, 0.05, M.steelDark, sx * 0.11, BOT_FLANGE_T + 0.046,
        sz * (BOT_FLANGE_W / 2 - 0.03), 10));
    }
  }
  yellow.add(box(0.32, 0.14, BOT_FLANGE_W + 0.02, M.hoistYellow, 0, -0.06, 0));
  black.add(box(0.16, 0.09, 0.012, M.plasticDark, 0, 0.02, BOT_FLANGE_W / 2 + 0.048));
  black.add(box(0.10, 0.10, 0.20, M.plasticDark, -0.02, -0.16, 0)); // suspension yoke

  // ── hoist body ────────────────────────────────────────────────────────────
  yellow.add(box(0.42, 0.25, 0.30, M.hoistYellow, -0.05, -0.30, 0.01));
  black.add(box(0.20, 0.11, 0.014, M.plasticDark, -0.10, -0.29, 0.166)); // nameplate
  black.add(cylX(0.11, 0.13, M.plasticDark, -0.30, -0.30, 0.01, 12)); // motor / brake
  black.add(box(0.13, 0.13, 0.13, M.plasticDark, 0.20, -0.30, 0.01)); // gear housing
  steel.add(cylX(0.085, 0.18, M.steelDark, 0.10, -0.30, 0.01, 12)); // chain drum
  steel.add(box(0.16, 0.02, 0.10, M.steelDark, -0.11, -0.43, 0.02)); // bucket hanger

  // ── hook block ────────────────────────────────────────────────────────────
  yellow.add(box(0.15, 0.20, 0.11, M.hoistYellow, 0.08, hookLocalY + 0.11, 0.02));
  steel.add(cyl(0.022, 0.09, M.steelDark, 0.08, hookLocalY - 0.03, 0.02, 8));

  g.add(mergeMixed(yellow, M.hoistYellow));
  g.add(mergeMixed(steel, M.steelDark));
  g.add(mergeMixed(black, M.plasticDark));

  const hookCap = box(0.17, 0.035, 0.13, M.craneOrangeDark, 0.08, hookLocalY + 0.22, 0.02);
  g.add(hookCap);
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.019, 6, 14, Math.PI * 1.55), M.craneOrange);
  hook.rotation.z = -Math.PI * 0.275;
  hook.position.set(0.08, hookLocalY - 0.15, 0.02);
  hook.castShadow = true;
  g.add(hook);

  // ── translucent chain bucket ──────────────────────────────────────────────
  const bucketMat = chainBucketMaterial();
  const bucket = cyl(0.11, 0.40, bucketMat, -0.11, -0.63, 0.02, 12);
  bucket.castShadow = false;
  g.add(bucket);
  const bucketBase = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    bucketMat,
  );
  bucketBase.position.set(-0.11, -0.83, 0.02);
  g.add(bucketBase);

  // ── load chain down to the hook, plus the slack fall into the bucket ──────
  const chainTop = -0.44;
  const chainBot = hookLocalY + 0.24;
  const chainPts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    chainPts.push(V3(
      0.08 + Math.sin(t * 6.1) * 0.007,
      chainTop + (chainBot - chainTop) * t,
      0.02 + Math.cos(t * 4.7) * 0.007,
    ));
  }
  g.add(cable(new THREE.CatmullRomCurve3(chainPts), M.chain, 0.014, 26, 5));
  g.add(cable(catenary(V3(0.02, -0.42, 0.02), V3(-0.11, -0.44, 0.02), 0.06, 6), M.chain, 0.013, 8, 5));

  // ── pendant control on its own strain-relieved cable ──────────────────────
  const pendantY = 1.80 - C.railTopY; // hangs at world y = 1.80 m
  g.add(cable(
    new THREE.CatmullRomCurve3([
      V3(0.16, -0.22, 0.10),
      V3(0.24, -0.95, 0.15),
      V3(0.27, -2.10, 0.13),
      V3(0.26, pendantY + 0.12, 0.12),
    ]),
    M.cableBlack, 0.011, 22, 5,
  ));
  const pend = new THREE.Group();
  pend.name = 'pendant';
  pend.position.set(0.26, pendantY, 0.12);
  pend.add(box(0.075, 0.24, 0.05, M.plasticDark, 0, 0, 0));
  pend.add(box(0.055, 0.05, 0.012, M.hoistYellow, 0, 0.055, 0.031));
  pend.add(box(0.055, 0.05, 0.012, M.plasticWhite, 0, -0.015, 0.031));
  pend.add(cylZ(0.016, 0.02, M.binRed, 0, -0.085, 0.032, 8));
  g.add(pend);

  return g;
}

/**
 * The festoon: a taut messenger wire under the girder plus catenary loops of
 * flat cable trailing from the trolley to the fixed (+X) end and bunching as
 * they approach it — the exact rhythm visible in the photograph.
 * @param {number} trolleyX
 * @returns {THREE.Group}
 */
function buildFestoon(trolleyX) {
  const g = new THREE.Group();
  g.name = 'festoon';
  const rng = makeRng(SEED_CRANE);

  const y = C.festoonY - C.railTopY; // ≈ −0.37 below the girder soffit
  const z = C.festoonZOffset; // ≈ −0.42, hangs behind the girder
  const n = C.festoonCount; // 11 loops → 12 hangers

  // Geometric spacing: wide next to the trolley, tight at the fixed end. The
  // photo's resolvable hangers sit 1.34 / 1.23 / 1.07 / 0.94 / 0.84 / 0.59 m
  // apart — a common ratio of ≈ 0.88 — with the first one ≈ 0.93 m clear of the
  // trolley body.
  const xStart = Math.min(trolleyX + 0.93, HALF_SPAN - 2.2);
  const xEnd = HALF_SPAN - 0.32;
  const ratio = 0.88;
  let denom = 0;
  for (let i = 0; i < n; i++) denom += Math.pow(ratio, i);
  const s0 = (xEnd - xStart) / denom;

  const hangers = [xStart];
  for (let i = 0; i < n; i++) hangers.push(hangers[i] + s0 * Math.pow(ratio, i));

  // taut messenger wire spanning the whole run
  g.add(cable(
    new THREE.CatmullRomCurve3([
      V3(hangers[0], y + 0.03, z),
      V3((hangers[0] + xEnd) * 0.5, y + 0.012, z),
      V3(xEnd, y + 0.03, z),
    ]),
    M.cableBlack, 0.008, 12, 5,
  ));

  // the hanging loops of flat cable
  for (let i = 0; i < n; i++) {
    const a = hangers[i];
    const b = hangers[i + 1];
    const sag = C.festoonSag * (0.68 + 0.32 * ((b - a) / s0)) * rf(rng, 0.94, 1.06);
    g.add(cable(catenary(V3(a, y, z), V3(b, y, z), sag, 12), M.cableBlack, 0.021, 16, 5));
  }

  // small orange trolley clips: a stem from the bottom flange down to the wire.
  // The hanger's top plate has to reach back to the (now narrower) flange edge,
  // otherwise the whole festoon reads as floating free of the girder.
  const drop = Math.abs(y);
  const reach = Math.abs(C.festoonZOffset) - BOT_FLANGE_W / 2 + 0.06;
  const clip = new THREE.Group();
  clip.add(box(0.036, drop - 0.06, 0.028, M.craneOrange, 0, -(drop - 0.06) / 2 - 0.03, 0));
  clip.add(box(0.10, 0.055, 0.075, M.craneOrange, 0, -drop + 0.02, 0));
  clip.add(box(0.13, 0.03, reach, M.craneOrange, 0, -0.02, reach / 2 - 0.05));
  const clipGeo = mergeGroup(clip, M.craneOrange).geometry;
  g.add(instance(clipGeo, M.craneOrange, hangers.map((hx) => ({ pos: [hx, 0, z] }))));

  // drop from the first hanger into the trolley …
  g.add(cable(
    catenary(V3(hangers[0], y, z), V3(trolleyX + 0.12, -0.16, -0.06), 0.10, 8),
    M.cableBlack, 0.019, 12, 5,
  ));
  // … and the terminal feed dropping into a junction box at the fixed end
  g.add(cable(
    new THREE.CatmullRomCurve3([
      V3(xEnd, y, z),
      V3(xEnd + 0.16, y - 0.45, z - 0.05),
      V3(xEnd + 0.21, y - 0.95, z - 0.02),
    ]),
    M.cableBlack, 0.017, 14, 5,
  ));
  g.add(box(0.13, 0.20, 0.10, M.plasticDark, xEnd + 0.21, y - 1.05, z));

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// The crane
// ────────────────────────────────────────────────────────────────────────────

/**
 * The orange single-girder overhead travelling crane.
 *
 * Origin is the **centre of the bridge span, on the rail top plane** — place it
 * at `(0, CFG.crane.railTopY, CFG.crane.bridgeZ)`. Local +Y runs up from the rail
 * head, so the girder soffit is local Y = 0 and its top is local
 * Y = `girderTopY − girderBottomY`. The bridge spans `±CFG.crane.runwayX` and the
 * whole assembly faces the camera along +Z.
 *
 * Contains: the slender orange box girder with its crisp top lip and thin
 * bottom flange; the five 安 / 全 / [green cross] / 第 / 一 panels standing 3 mm
 * proud of the camera-facing web; two orange end trucks with wheels, axle bosses
 * and a drive gearbox; the yellow chain-hoist trolley with load chain, hook
 * block, translucent chain bucket and pendant control; the eleven-loop festoon;
 * and the collector arm reaching down to the runway conductor bar.
 *
 * `.userData.trolley` is the trolley Group and `.userData.trolleyX` its clamped
 * position, so the hoist can be re-parked or animated later.
 *
 * @param {number} [trolleyX=CFG.crane.trolleyX] hoist position along the bridge
 * @returns {THREE.Group} named 'bridgeCrane'
 */
export function buildBridgeCrane(trolleyX = C.trolleyX) {
  const g = group('bridgeCrane');
  const tx = Math.max(-HALF_SPAN + 1.4, Math.min(HALF_SPAN - 1.4, trolleyX));

  // ── main box girder, top lip, bottom flange, end haunches, web ribs ───────
  const shell = new THREE.Group();
  shell.add(extrudeBand(
    bandShape(-HALF_SPAN, HALF_SPAN, () => 0, girderTopLocal, 26, 1),
    WEB_T, M.craneOrange,
  ));
  shell.add(extrudeBand(
    bandShape(-HALF_SPAN, HALF_SPAN, girderTopLocal, (x) => girderTopLocal(x) + LIP_T, 26, 26),
    WEB_T + LIP_OVERHANG * 2, M.craneOrange,
  ));
  shell.add(box(HALF_SPAN * 2, BOT_FLANGE_T, BOT_FLANGE_W, M.craneOrange, 0, BOT_FLANGE_T / 2, 0));

  const ribGeo = new THREE.BoxGeometry(1, 0.05, 0.014);
  for (const side of [-1, 1]) {
    // short haunch deepening the girder into the end truck
    const tri = new THREE.Shape();
    tri.moveTo(0, 0.001);
    tri.lineTo(HAUNCH_LEN, 0.001);
    tri.lineTo(HAUNCH_LEN, -HAUNCH_DROP);
    tri.closePath();
    const hg = new THREE.ExtrudeGeometry(tri, { depth: WEB_T, bevelEnabled: false });
    hg.translate(0, 0, -WEB_T / 2);
    const hm = new THREE.Mesh(hg, M.craneOrange);
    hm.position.x = side * (HALF_SPAN - HAUNCH_LEN);
    if (side < 0) hm.rotation.y = Math.PI; // rotate, never mirror-scale
    shell.add(hm);

    // diagonal end rib on the visible web face, top flange → end truck
    const xa = side * (HALF_SPAN - 1.20);
    const xb = side * (HALF_SPAN - 0.30);
    const ya = girderTopLocal(xa) - 0.10;
    const yb = -0.04;
    const rib = new THREE.Mesh(ribGeo, M.craneOrange);
    rib.scale.x = Math.hypot(xb - xa, yb - ya);
    rib.rotation.z = Math.atan2(yb - ya, xb - xa);
    rib.position.set((xa + xb) / 2, (ya + yb) / 2, WEB_T / 2 + 0.007);
    shell.add(rib);

    // vertical end post on the web
    shell.add(box(0.048, GIRDER_D - 0.12, 0.014, M.craneOrange,
      side * (HALF_SPAN - 1.26), (GIRDER_D - 0.12) / 2 + 0.04, WEB_T / 2 + 0.006));
  }
  // web splice plates (two are visible in the photo)
  for (const sx of [-0.12, 3.07]) {
    shell.add(box(0.058, GIRDER_D - 0.11, 0.011, M.craneOrange, sx, GIRDER_D / 2 - 0.03,
      WEB_T / 2 + 0.005));
  }
  const girder = mergeMixed(shell, M.craneOrange);
  girder.name = 'bridgeGirder';
  g.add(girder);

  // hairline shadow under the bottom flange — in the photo the girder's underside
  // is a single dark stroke, not a band, so keep it under a centimetre
  g.add(box(HALF_SPAN * 2 - 0.01, 0.009, BOT_FLANGE_W - 0.06, M.craneOrangeDark, 0, 0.0045, 0));

  // ── 安全第一 sign panels on the camera-facing (+Z) web ────────────────────
  const panels = new THREE.Group();
  panels.name = 'safetyPanels';
  SIGN_GLYPHS.forEach((glyph, i) => {
    const p = box(SIGN_SIZE, SIGN_SIZE, 0.006, signPanelMaterial(glyph),
      SIGN_X[i], SIGN_Y, WEB_T / 2 + 0.003);
    p.castShadow = false;
    panels.add(p);
  });
  g.add(panels);

  // ── end trucks ────────────────────────────────────────────────────────────
  const truckL = buildEndTruck(-1, true);
  truckL.position.x = -HALF_SPAN;
  g.add(truckL);
  const truckR = buildEndTruck(1, false);
  truckR.position.x = HALF_SPAN;
  g.add(truckR);

  // ── kit riding the girder walkway: junction boxes, panel, cable run ───────
  const kit = new THREE.Group();
  for (const jx of [-0.62, 3.02]) {
    kit.add(box(0.17, 0.11, 0.20, M.steelWhiteDark, jx, girderTopLocal(jx) + 0.081, 0.02));
  }
  g.add(mergeGroup(kit, M.steelWhiteDark));
  g.add(box(0.30, 0.26, 0.28, M.plasticDark, 5.23, girderTopLocal(5.23) + 0.156, 0.0));
  g.add(cable(
    new THREE.CatmullRomCurve3([
      V3(3.10, girderTopLocal(3.10) + 0.055, 0.07),
      V3(3.85, girderTopLocal(3.85) + 0.048, -0.03),
      V3(4.55, girderTopLocal(4.55) + 0.055, 0.06),
      V3(5.14, girderTopLocal(5.14) + 0.085, 0.0),
    ]),
    M.cableBlack, 0.017, 20, 5,
  ));

  // ── hoist trolley ─────────────────────────────────────────────────────────
  const trolley = buildHoistTrolley(C.hookY - C.railTopY);
  trolley.position.x = tx;
  g.add(trolley);

  // ── festoon ───────────────────────────────────────────────────────────────
  g.add(buildFestoon(tx));

  // ── current collector reaching the runway conductor bar at x = 5.28 ───────
  const collector = new THREE.Group();
  collector.name = 'collector';
  collector.position.set(HALF_SPAN - 0.24, -0.02, 0.52);
  collector.add(box(0.12, 0.18, 0.10, M.craneOrangeDark, 0, 0, 0));
  collector.add(box(0.035, 0.44, 0.035, M.steelWhiteDark, -0.05, -0.28, 0));
  collector.add(box(0.14, 0.035, 0.035, M.steelWhiteDark, -0.02, -0.50, 0));
  collector.add(box(0.05, 0.10, 0.06, M.plasticDark, -0.08, -0.55, 0));
  g.add(collector);

  g.userData.trolley = trolley;
  g.userData.trolleyX = tx;
  return g;
}
