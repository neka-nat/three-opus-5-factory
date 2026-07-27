/**
 * build/services.js — the building services.
 *
 *   buildCeilingServices()   perforated cable trays (with the cable bundles that
 *                            step over every downstand beam), galvanised conduit
 *                            runs, the sprinkler branch mains with their pendent
 *                            heads, and the fat painted fire main that follows
 *                            each wall head just under the roof — the orange
 *                            pipe running above the right-hand windows in crops
 *                            A / B / G.
 *                            Everything except the fire main is deliberately
 *                            near-invisible: in the photograph the ceiling is a
 *                            calm plane broken only by the downstands, the light
 *                            battens and the domes, so the tray, its cables and
 *                            the conduit are few, thin, and toned to the deck.
 *   buildLightFixtures()     two rows of twin-tube fluorescent battens plus the
 *                            round high-bay domes on the centreline, each on a
 *                            suspension rod up to the deck, plus a few small
 *                            wall bulkhead lamps. The lenses are *emissive
 *                            materials only* — `scene/lighting.js` owns every
 *                            THREE.Light in the scene, so none are made here.
 *   buildWallServices(side)  the blue compressed-air main with its drop legs,
 *                            filter/regulators and coiled hoses, the white
 *                            service pipe beside it, the grey wire-way, small
 *                            conduit with isolator boxes, and the clips that
 *                            strap the lot to the columns (crops B / J / E).
 *
 * All three builders are already expressed in **world coordinates** — layout.js
 * adds them at the origin without any further transform.
 *
 * Routing note: `build/shell.js` puts a pilaster `CFG.column.depth` deep on the
 * inner face of each side wall at every *mid-bay* station, so the usable wall
 * face for a continuous longitudinal run is `x = ±(halfWidth − column.depth)` =
 * ±6.28. Everything longitudinal therefore sits a few centimetres inboard of
 * that plane and is clipped back to the column faces with saddle clips, which
 * is exactly how the photograph's pipes are routed. Likewise every run above
 * the beam soffit (`CFG.roofBeam.soffitY`) is broken at the bay lines so it
 * does not drive through a downstand beam.
 */
import * as THREE from 'three';
import { CFG, SEED } from '../core/config.js';
import { M, tinted, variant } from '../core/materials.js';
import {
  box, cable, catenary, cyl, cylGeo, cylX, cylZ, group, instance,
  makeRng, mergeGroup, rf, shadows, V3,
} from '../core/utils.js';

// ────────────────────────────────────────────────────────────────────────────
// Shared dimensions, all derived from CFG
// ────────────────────────────────────────────────────────────────────────────

const HW = CFG.hall.halfWidth; //   6.50 inner face of the side walls
const ZF = CFG.hall.zFront; //   6.00
const ZB = CFG.hall.zBack; // -46.80
const DECK_Y = CFG.hall.ceilingY; //   9.00 roof deck soffit
const BEAM_SOFFIT = CFG.roofBeam.soffitY; //   7.90
const BAY = CFG.bay.spacing; //   3.60
const BAYS = CFG.bay.all(); //   3.6 … −43.2

/** Longitudinal runs stop just short of the gable and the front return. */
const Z0 = ZF - 0.55; //   5.45 near end
const Z1 = ZB + 0.55; // −46.25 far end
const RUN = Z0 - Z1; //  51.70
const RUNMID = (Z0 + Z1) / 2;

/** Inner face of the wall pilasters — the plane every wall run hugs. */
const PIER_X = HW - CFG.column.depth; // 6.28

/** Z of every pilaster: mid-bay, matching `build/shell.js`'s `pilasterZ()`. */
const PIERS = [BAYS[0] + BAY / 2, ...BAYS.map((z) => z - BAY / 2)];

// Wall-service offsets from the hall centre (positive; mirrored by `side`).
const X_AIR = 6.24; // blue compressed-air main   (⌀0.05)
const X_WATER = 6.235; // white service pipe         (⌀0.07)
const X_DUCT = 6.21; // grey wire-way
const X_COND = 6.26; // small galvanised conduit
const X_DROP = 6.16; // drop legs stand proud, in front of the white pipe

const Y_AIR = CFG.windows.lower.headY + 1.10;   // 5.40 — sits in the spandrel band
const Y_WATER = CFG.windows.lower.headY + 0.85; // 5.15
const Y_DUCT = CFG.windows.upper.sillY - 0.35;  // just under the clerestory sill so
//                      the duct never silhouettes against the blown-out glazing
const Y_COND = 2.02;
const Y_FRL = 1.62; // filter/regulator body — drops end at ≈1.6

// ────────────────────────────────────────────────────────────────────────────
// Module-local materials (never mutate the shared registry)
// ────────────────────────────────────────────────────────────────────────────

/** JIS-orange fire main following the right-hand wall head. */
const matFireMain = () => tinted('whitePipe', 0xc9713a);
/** Red rubber air hose coiled under each filter/regulator. */
const matAirHose = () => variant('cableBlack', { color: 0xc4643a, roughness: 0.74 }, 'svcAirHose');
/** Lighter lid strip along the top of the grey wire-way. */
const matDuctLid = () => variant('steelWhiteDark', { color: 0xcfc8b8 }, 'svcDuctLid');
/** Bright galvanised conduit — a touch cooler than M.galv. */
const matConduit = () => variant('galv', { color: 0xc8ccd0, roughness: 0.5 }, 'svcConduit');

/*
 * Ceiling tones. In the photograph the only things you can actually pick out
 * overhead are the deep downstand beams, the light battens, the high-bay domes
 * and the orange fire main; the tray, its cables and the conduit are all so
 * close to the deck colour that they read as texture rather than as lines. The
 * tints below pull those runs back to the ceiling's own value.
 */
/** Dusty grey-cream PVC — the cable bundles lying in the ceiling trays. */
const matTrayCable = () =>
  variant('cableBlack', { color: 0xbdb6a7, roughness: 0.84, metalness: 0.02 }, 'svcTrayCable');
/** Cable tray tinted toward the deck so it reads as a pale ribbon, not a band. */
const matTray = () => variant('perforated', { color: 0xdcd6c9 }, 'svcTray');
/** Ceiling conduit, warmed to sit within a hair of the deck colour. */
const matCeilConduit = () =>
  variant('galv', { color: 0xd2ccbf, roughness: 0.62, metalness: 0.2 }, 'svcCeilConduit');
/** The luminaire feed looping batten to batten — grey PVC, not black rubber. */
const matLampFeed = () =>
  variant('cableBlack', { color: 0xc6c0b2, roughness: 0.8, metalness: 0.02 }, 'svcLampFeed');

// ────────────────────────────────────────────────────────────────────────────
// Local helpers
// ────────────────────────────────────────────────────────────────────────────

/** Scale a geometry's UVs in place (the shared textures are memoised at 1:1). */
function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geo;
}

/** Merge a bucket of same-material meshes into `parent`, skipping empties. */
function bake(parent, name, bucket, material) {
  if (!bucket.children.length) return null;
  const m = mergeGroup(bucket, material);
  m.name = name;
  parent.add(m);
  return m;
}

/**
 * The clear Z spans of a run between `z1` and `z0`, with `clear` metres taken
 * out either side of every bay line — used for anything routed above the
 * downstand-beam soffit.
 */
function baySpans(z0, z1, clear = 0.3) {
  const stops = BAYS.filter((z) => z < z0 && z > z1).sort((a, b) => a - b);
  const spans = [];
  let cur = z1;
  for (const s of stops) {
    if (s - clear - cur > 0.2) spans.push([cur, s - clear]);
    cur = s + clear;
  }
  if (z0 - cur > 0.2) spans.push([cur, z0]);
  return spans;
}

/** A slack coil of hose hanging off a wall drop, flattened against the wall. */
function coilCurve(cx, cy, cz, r, turns, drop, inward) {
  const pts = [];
  const n = Math.max(12, Math.round(turns * 10));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * Math.PI * 2;
    pts.push(V3(
      cx + Math.cos(a) * r * 0.42 * inward - r * 0.18 * inward,
      cy - t * drop - Math.sin(a) * r * 0.10,
      cz + Math.sin(a) * r,
    ));
  }
  return new THREE.CatmullRomCurve3(pts);
}

/** Shallow glass dome for the high-bay luminaires (lower hemisphere, squashed). */
let _domeGeo = null;
function domeGeo() {
  if (!_domeGeo) {
    _domeGeo = new THREE.SphereGeometry(0.235, 18, 7, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    _domeGeo.scale(1, 0.66, 1);
  }
  return _domeGeo;
}

// ────────────────────────────────────────────────────────────────────────────
// Ceiling services
// ────────────────────────────────────────────────────────────────────────────

/**
 * Everything hanging from the roof, in world coordinates:
 *
 *  • two perforated cable trays at `x = ±4.6`, `y = 8.9`, on trapeze hangers up
 *    to the deck, broken at every bay line so they clear the downstand beams;
 *    two pale cable runs lie in each tray and step over each beam on a shallow
 *    loop;
 *  • one galvanised conduit a side at `x = ±2.2`, above the beam soffit and
 *    broken at every bay, on short straps up to the deck;
 *  • two sprinkler branch mains (`M.whitePipe`) at `x = ±1.35` with hanger rods
 *    and pendent heads every 4.8 m;
 *  • the fat painted fire main following each wall head just inside the edge
 *    beam — orange on the right (as photographed), plain white on the left.
 *
 * Nothing up here casts a shadow: it all lives above the head band where no
 * sunlight reaches, and skipping it keeps the shadow pass cheap.
 *
 * @returns {THREE.Group} named 'ceilingServices'
 */
export function buildCeilingServices() {
  const g = group('ceilingServices');
  const rng = makeRng(SEED ^ 0x5e12);

  const perf = new THREE.Group(); // tray bases        → matTray()
  const galv = new THREE.Group(); // tray rails, clips → M.galv
  const rodBucket = new THREE.Group(); // trapeze channels  → M.steelWhiteDark
  const cables = new THREE.Group(); // cable runs        → matTrayCable()
  const conduit = new THREE.Group(); // conduit           → matCeilConduit()
  const sprink = new THREE.Group(); // sprinkler pipe    → M.whitePipe
  const fireR = new THREE.Group(); // right fire main   → matFireMain()
  const fireL = new THREE.Group(); // left  header      → M.whitePipe
  const boxes = new THREE.Group(); // junction boxes    → M.plasticWhite

  // ── perforated cable trays ────────────────────────────────────────────────
  const TRAY_X = 4.6;
  const TRAY_Y = DECK_Y - 0.70;
  const TRAY_W = 0.34;
  const spans = baySpans(Z0, Z1, 0.3);
  const rodTf = [];

  for (const s of [-1, 1]) {
    const tx = s * TRAY_X;

    for (const [a, b] of spans) {
      const len = b - a;
      const zc = (a + b) / 2;

      // punched base sheet, face up (the material is DoubleSide so it also
      // reads from underneath, which is the only view the camera ever gets)
      const base = new THREE.Mesh(
        scaleUV(new THREE.PlaneGeometry(TRAY_W, len), TRAY_W / 0.22, len / 0.22),
        matTray(),
      );
      base.rotation.x = -Math.PI / 2;
      base.position.set(tx, TRAY_Y, zc);
      perf.add(base);

      // return-flange side rails
      for (const o of [-1, 1]) {
        galv.add(box(0.014, 0.055, len, M.galv, tx + o * (TRAY_W / 2), TRAY_Y + 0.026, zc));
      }

      // trapeze hangers every ≈2.4 m along the segment
      const n = Math.max(1, Math.round(len / 2.4));
      for (let i = 0; i < n; i++) {
        const hz = a + (len * (i + 0.5)) / n;
        rodBucket.add(box(TRAY_W + 0.13, 0.026, 0.04, M.steelWhiteDark, tx, TRAY_Y - 0.02, hz));
        for (const o of [-1, 1]) {
          rodTf.push({ pos: [tx + o * (TRAY_W / 2 + 0.045), TRAY_Y + 0.31, hz] });
        }
      }

      // two cable runs lying in the tray (four read as a dark stripe)
      for (let c = 0; c < 2; c++) {
        const cx = tx + (c - 0.5) * 0.085;
        cables.add(cylZ(0.012, len - 0.02, matTrayCable(), cx, TRAY_Y + 0.016, zc, 6));
      }
    }

    // the bundles step over every downstand beam. They keep the shallowest sag
    // that still reads as slack: at the old 0.54 m they hung well below the
    // beam soffits and drew hard dark loops right across the top of the frame.
    for (let i = 0; i < spans.length - 1; i++) {
      const za = spans[i][1];
      const zb = spans[i + 1][0];
      for (let c = 0; c < 2; c++) {
        const cx = tx + (c - 0.5) * 0.085;
        const sag = 0.15 + rf(rng, -0.02, 0.04);
        const curve = catenary(
          V3(cx, TRAY_Y + 0.016, za - 0.28),
          V3(cx, TRAY_Y + 0.016, zb + 0.28),
          sag, 10,
        );
        cables.add(cable(curve, matTrayCable(), 0.011, 14, 5));
      }
    }
  }

  const rods = instance(cylGeo(0.008, 0.008, DECK_Y - TRAY_Y - 0.02, 6), M.steelWhiteDark, rodTf);
  rods.name = 'trayHangers';
  g.add(rods);

  // ── galvanised conduit, tucked up into the coffers ────────────────────────
  // One run a side rather than two, thinner, warmed to the deck colour and
  // lifted *above* the beam soffit so it is broken at every downstand instead
  // of drawing an unbroken line the whole length of the hall.
  const CONDUIT_Y = BEAM_SOFFIT + 0.36; // 8.86
  const saddleTf = [];
  for (const s of [-1, 1]) {
    const cx = s * 2.2;
    for (const [a, b] of baySpans(Z0, Z1, 0.3)) {
      conduit.add(cylZ(0.017, b - a, matCeilConduit(), cx, CONDUIT_Y, (a + b) / 2, 8));
    }
    for (let z = Z0 - 1.8; z > Z1; z -= 3.6) {
      saddleTf.push({ pos: [cx + s * 0.030, (CONDUIT_Y + DECK_Y) / 2, z] });
    }
  }
  const saddles = instance(
    cylGeo(0.008, 0.008, DECK_Y - CONDUIT_Y, 5), matCeilConduit(), saddleTf,
  );
  saddles.name = 'conduitHangers';
  g.add(saddles);

  // ── sprinkler branch mains + pendent heads ────────────────────────────────
  // These stay below the beams — that thin white line running the length of the
  // hall is genuinely there in crop A — but they are slimmer now, and the heads
  // are spaced out and lightened so they stop peppering the ceiling with dots.
  const SPR_Y = BEAM_SOFFIT - 0.20; // 8.30
  const headTf = [];
  const deflTf = [];
  for (const s of [-1, 1]) {
    const sx = s * 1.35;
    sprink.add(cylZ(0.025, RUN, M.whitePipe, sx, SPR_Y, RUNMID, 10));
    // slip couplings every bay
    for (const bz of BAYS) sprink.add(cylZ(0.033, 0.07, M.whitePipe, sx, SPR_Y, bz, 10));
    // hanger rods up to the purlin/beam line
    for (let z = Z0 - 3.6; z > Z1; z -= 7.2) {
      sprink.add(cyl(0.008, 0.26, M.whitePipe, sx, SPR_Y + 0.15, z, 5));
    }
    // pendent heads
    for (let z = Z0 - 2.4; z > Z1; z -= 4.8) {
      sprink.add(cyl(0.011, 0.16, M.whitePipe, sx, SPR_Y - 0.10, z, 6));
      headTf.push({ pos: [sx, SPR_Y - 0.205, z] });
      deflTf.push({ pos: [sx, SPR_Y - 0.238, z] });
    }
  }
  const heads = instance(cylGeo(0.016, 0.014, 0.052, 8), M.galv, headTf);
  heads.name = 'sprinklerHeads';
  g.add(heads);
  const defls = instance(cylGeo(0.026, 0.026, 0.005, 8), M.galv, deflTf);
  defls.name = 'sprinklerDeflectors';
  g.add(defls);

  // ── the fat fire main along each wall head, just inside the edge beam ─────
  const FM_Y = 8.12;
  const FM_X = CFG.edgeBeam.x - 0.27; // 5.98 — clear of the edge-beam web
  for (const s of [-1, 1]) {
    const bucket = s > 0 ? fireR : fireL;
    const fx = s * FM_X;
    for (const [a, b] of baySpans(Z0, Z1, 0.28)) {
      bucket.add(cylZ(0.055, b - a, s > 0 ? matFireMain() : M.whitePipe, fx, FM_Y, (a + b) / 2, 10));
    }
    for (const bz of BAYS) {
      // flanged joint either side of each beam
      for (const o of [-0.34, 0.34]) {
        bucket.add(cylZ(0.075, 0.055, s > 0 ? matFireMain() : M.whitePipe, fx, FM_Y, bz + o, 10));
      }
      // stub bracket back to the edge beam
      bucket.add(box(0.22, 0.05, 0.075, s > 0 ? matFireMain() : M.whitePipe,
        s * (FM_X + 0.13), FM_Y + 0.09, bz + 0.34));
      for (const o of [-0.062, 0.062]) {
        bucket.add(box(0.014, 0.13, 0.05, s > 0 ? matFireMain() : M.whitePipe,
          fx + o, FM_Y + 0.055, bz + 0.34));
      }
    }
  }

  // ── a handful of ceiling junction boxes and their tails ───────────────────
  for (let i = 0; i < 6; i++) {
    const s = i % 2 ? 1 : -1;
    const z = 0.6 - i * 7.2;
    if (z < Z1 + 1) break;
    boxes.add(box(0.16, 0.13, 0.22, M.plasticWhite, s * (TRAY_X + 0.34), TRAY_Y + 0.08, z));
    const curve = catenary(
      V3(s * (TRAY_X + 0.26), TRAY_Y + 0.08, z),
      V3(s * TRAY_X, TRAY_Y + 0.05, z + 0.55),
      0.12, 8,
    );
    cables.add(cable(curve, matTrayCable(), 0.011, 12, 5));
  }

  bake(g, 'cableTrayBase', perf, matTray());
  bake(g, 'cableTrayRails', galv, M.galv);
  bake(g, 'trayTrapezes', rodBucket, M.steelWhiteDark);
  bake(g, 'trayCables', cables, matTrayCable());
  bake(g, 'ceilingConduit', conduit, matCeilConduit());
  bake(g, 'sprinklerMains', sprink, M.whitePipe);
  bake(g, 'fireMainRight', fireR, matFireMain());
  bake(g, 'fireMainLeft', fireL, M.whitePipe);
  bake(g, 'ceilingJunctionBoxes', boxes, M.plasticWhite);

  shadows(g, false, true);
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Luminaires
// ────────────────────────────────────────────────────────────────────────────

/**
 * Every luminaire in the hall — **materials only, no THREE.Light objects**
 * (`scene/lighting.js` owns those).
 *
 *  • twin-tube fluorescent battens in two rows at `CFG.fixtures.battenX`,
 *    `y = CFG.fixtures.battenY`, one `CFG.fixtures.battenLen` unit per bay,
 *    centred mid-bay so the suspension rods run clear up to the deck;
 *  • round high-bay domes on the centreline every `CFG.fixtures.domeSpacing`,
 *    a white steel reflector ring with a shallow glass dome under it;
 *  • three small bulkhead lamps on the right-hand wall (crop J).
 *
 * @returns {THREE.Group} named 'lightFixtures'
 */
export function buildLightFixtures() {
  const g = group('lightFixtures');

  const f = CFG.fixtures;
  const body = new THREE.Group(); // → M.steelWhite
  const wire = new THREE.Group(); // → matLampFeed()
  const tubeTf = [];
  const rodTf = [];

  // ── linear battens ────────────────────────────────────────────────────────
  const LEN = f.battenLen; // 2.40
  const BY = f.battenY; // 8.32
  const zs = BAYS.map((z) => z - BAY / 2); // mid-bay stations

  for (const bx of f.battenX) {
    for (const bz of zs) {
      // reflector tray + spine
      body.add(box(0.215, 0.022, LEN, M.steelWhite, bx, BY + 0.048, bz));
      body.add(box(0.135, 0.070, LEN, M.steelWhite, bx, BY + 0.010, bz));
      for (const o of [-1, 1]) {
        // shallow side reflector wings
        body.add(box(0.030, 0.055, LEN, M.steelWhite, bx + o * 0.103, BY + 0.020, bz));
        // end caps
        body.add(box(0.175, 0.085, 0.045, M.steelWhite, bx, BY + 0.012, bz + o * (LEN / 2)));
      }
      // gear tray on top, and the two lamps below
      body.add(box(0.10, 0.045, 0.55, M.steelWhite, bx, BY + 0.081, bz));
      for (const o of [-1, 1]) {
        tubeTf.push({ pos: [bx + o * 0.042, BY - 0.032, bz], rot: [Math.PI / 2, 0, 0] });
      }
      // suspension rods with their ceiling roses
      for (const o of [-1, 1]) {
        rodTf.push({ pos: [bx, (BY + 0.06 + DECK_Y) / 2, bz + o * 0.85] });
        body.add(box(0.09, 0.028, 0.09, M.steelWhite, bx, DECK_Y - 0.016, bz + o * 0.85));
      }
    }
    // the feed running the length of each row, looping unit to unit — grey PVC
    // pulled fairly taut, so it stops drawing a black scallop across the deck
    for (let i = 0; i < zs.length - 1; i++) {
      const curve = catenary(
        V3(bx + 0.07, BY + 0.075, zs[i] - LEN / 2),
        V3(bx + 0.07, BY + 0.075, zs[i + 1] + LEN / 2),
        0.09, 8,
      );
      wire.add(cable(curve, matLampFeed(), 0.007, 12, 5));
    }
  }

  const tubes = instance(cylGeo(0.019, 0.019, LEN - 0.09, 10), M.lampWhite, tubeTf);
  tubes.name = 'lampTubes';
  g.add(tubes);

  const rods = instance(cylGeo(0.008, 0.008, DECK_Y - BY - 0.06, 6), M.steelWhiteDark, rodTf);
  rods.name = 'battenHangers';
  g.add(rods);

  // ── round high-bay domes on the centreline ────────────────────────────────
  const DY = f.domeY; // 7.55
  for (let z = 1.8; z > Z1; z -= f.domeSpacing) {
    // canopy at the deck, stem, reflector ring
    body.add(cyl(0.075, 0.075, M.steelWhite, f.domeX, DECK_Y - 0.038, z, 10));
    body.add(cyl(0.020, DECK_Y - DY - 0.20, M.steelWhite, f.domeX, (DY + 0.10 + DECK_Y - 0.075) / 2, z, 6));
    body.add(cyl(0.245, 0.058, M.steelWhite, f.domeX, DY + 0.075, z, 18));
    body.add(cyl(0.185, 0.045, M.steelWhite, f.domeX, DY + 0.120, z, 14));

    const lens = new THREE.Mesh(domeGeo(), M.lampWhite);
    lens.position.set(f.domeX, DY + 0.055, z);
    lens.castShadow = false;
    lens.receiveShadow = false;
    lens.name = 'highBayLens';
    g.add(lens);
  }

  // ── small wall bulkhead lamps on the right wall (crop J) ──────────────────
  // Sited on the narrow solid strips beside the pilasters so they never sit in
  // front of a glazing opening: pilaster Z ± 0.34, hard against the wall face.
  for (const z of [-8.66, -15.86, -23.06]) {
    const wx = HW - 0.03; // 6.47 — on the wall face, facing −X
    body.add(box(0.06, 0.175, 0.175, M.steelWhite, wx, 4.05, z));
    body.add(cylX(0.086, 0.030, M.steelWhite, wx - 0.05, 4.05, z, 12));
    const glass = cylX(0.072, 0.080, M.lampWhite, wx - 0.098, 4.05, z, 12);
    glass.castShadow = false;
    glass.name = 'bulkheadLens';
    g.add(glass);
  }

  bake(g, 'luminaireBodies', body, M.steelWhite);
  bake(g, 'luminaireWiring', wire, matLampFeed());

  shadows(g, false, false);
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Wall pipework
// ────────────────────────────────────────────────────────────────────────────

/**
 * The pipework strapped to one side wall, built in world coordinates.
 *
 * Contents, top to bottom (crops B, J and E):
 *  • a grey wire-way just under the clerestory sill, with junction boxes;
 *  • the **blue compressed-air main** (`M.airPipe`, ⌀0.05) at `y ≈ 4.95` with a
 *    slip coupling at every bay line;
 *  • a white service pipe (`M.whitePipe`, ⌀0.07) alongside and just below it;
 *  • a **drop leg at every second column** falling to ≈1.6 m, with a ball
 *    valve, an aluminium filter/regulator, a white plastic bowl, a pressure
 *    gauge and a coiled red air hose; the intervening columns get a shorter
 *    branch drop ending in a quick coupler, which is the ≈3.6 m rhythm of blue
 *    verticals the photograph shows;
 *  • galvanised conduit low down feeding wall isolator boxes;
 *  • saddle clips on every column face — they read clearly in the photo.
 *
 * Origin is the world origin; the group is already placed. `side` mirrors it.
 *
 * @param {1|-1} side  +1 = right wall (+X), −1 = left wall (−X)
 * @returns {THREE.Group} named 'wallServices'
 */
export function buildWallServices(side = 1) {
  const S = side < 0 ? -1 : 1;
  const g = group('wallServices');
  const rng = makeRng(SEED ^ (S > 0 ? 0x7a11 : 0x7a12));

  const blue = new THREE.Group(); // → M.airPipe
  const white = new THREE.Group(); // → M.whitePipe
  const grey = new THREE.Group(); // → M.steelWhiteDark
  const lid = new THREE.Group(); // → matDuctLid()
  const galv = new THREE.Group(); // → M.galv
  const conduit = new THREE.Group(); // → matConduit()
  const alu = new THREE.Group(); // → M.aluPlain
  const dark = new THREE.Group(); // → M.steelDark
  const plastic = new THREE.Group(); // → M.plasticWhite
  const accent = new THREE.Group(); // → M.robotRed
  const hose = new THREE.Group(); // → matAirHose()

  const xAir = S * X_AIR;
  const xWater = S * X_WATER;
  const xDuct = S * X_DUCT;
  const xCond = S * X_COND;
  const xDrop = S * X_DROP;

  // ── grey wire-way ─────────────────────────────────────────────────────────
  grey.add(box(0.125, 0.155, RUN, M.steelWhiteDark, xDuct, Y_DUCT, RUNMID));
  lid.add(box(0.135, 0.022, RUN, matDuctLid(), xDuct, Y_DUCT + 0.078, RUNMID));
  for (const pz of PIERS) {
    if (pz > Z0 || pz < Z1) continue;
    // fixing bracket back to the column face
    grey.add(box(0.055, 0.075, 0.11, M.steelWhiteDark, S * (X_DUCT + 0.093), Y_DUCT, pz));
  }

  // ── the blue compressed-air main ──────────────────────────────────────────
  blue.add(cylZ(0.025, RUN, M.airPipe, xAir, Y_AIR, RUNMID, 10));
  for (const bz of BAYS) {
    if (bz > Z0 || bz < Z1) continue;
    blue.add(cylZ(0.032, 0.075, M.airPipe, xAir, Y_AIR, bz, 10)); // slip coupling
  }
  // the main turns up into the ceiling distribution at the far end
  blue.add(cyl(0.025, 2.30, M.airPipe, xAir, Y_AIR + 1.15, Z1 + 0.4, 10));
  blue.add(cylZ(0.025, 0.9, M.airPipe, xAir, Y_AIR + 2.28, Z1 + 0.85, 10));
  // an isolating gate valve near the near end
  dark.add(box(0.075, 0.085, 0.075, M.steelDark, xAir, Y_AIR, -2.6));
  accent.add(box(0.020, 0.020, 0.185, M.robotRed, xAir, Y_AIR + 0.075, -2.6));

  // ── the white service pipe alongside ──────────────────────────────────────
  white.add(cylZ(0.035, RUN, M.whitePipe, xWater, Y_WATER, RUNMID, 10));
  for (const bz of BAYS) {
    if (bz > Z0 || bz < Z1) continue;
    white.add(cylZ(0.045, 0.08, M.whitePipe, xWater, Y_WATER, bz, 10));
  }
  // two in-line gate valves, kept in the solid spandrel band so they never
  // silhouette against a glazing opening
  for (const vz of [-12.5, -30.1]) {
    if (vz < Z1) continue;
    dark.add(box(0.085, 0.095, 0.085, M.steelDark, xWater, Y_WATER, vz));
    dark.add(cyl(0.020, 0.11, M.steelDark, xWater, Y_WATER + 0.10, vz, 6));
    dark.add(cyl(0.078, 0.014, M.steelDark, xWater, Y_WATER + 0.16, vz, 12));
  }

  // ── saddle clips on every column face ─────────────────────────────────────
  for (const pz of PIERS) {
    if (pz > Z0 || pz < Z1) continue;
    for (const [px, py, pr] of [[xAir, Y_AIR, 0.025], [xWater, Y_WATER, 0.035]]) {
      // back plate against the pilaster + short stand-off arm
      grey.add(box(0.022, 0.10, 0.115, M.steelWhiteDark, S * (PIER_X - 0.011), py, pz));
      const reach = PIER_X - Math.abs(px) - pr;
      if (reach > 0.005) {
        grey.add(box(reach, 0.035, 0.045, M.steelWhiteDark,
          S * (Math.abs(px) + pr + reach / 2), py, pz));
      }
      // the clamp band itself
      const band = new THREE.Mesh(cylGeo(pr + 0.013, pr + 0.013, 0.038, 10, true), M.galv);
      band.rotation.x = Math.PI / 2;
      band.position.set(px, py, pz);
      galv.add(band);
    }
  }

  // ── drop legs ─────────────────────────────────────────────────────────────
  for (let i = 1; i < PIERS.length; i++) {
    const pz = PIERS[i];
    if (pz > Z0 - 0.2 || pz < Z1) continue;
    const full = i % 2 === 1; // alternate: full drop / short branch

    // tee off the main, then the short jog out clear of the white pipe
    blue.add(cylZ(0.034, 0.10, M.airPipe, xAir, Y_AIR, pz, 10));
    blue.add(cylX(0.025, Math.abs(X_DROP - X_AIR) + 0.03, M.airPipe,
      (xAir + xDrop) / 2, Y_AIR, pz, 8));

    const yBot = full ? Y_FRL + 0.095 : 2.62;
    const yMid = (Y_AIR + yBot) / 2;
    blue.add(cyl(0.025, Y_AIR - yBot, M.airPipe, xDrop, yMid, pz, 10));
    // elbow blob at the top corner
    blue.add(cyl(0.030, 0.055, M.airPipe, xDrop, Y_AIR - 0.012, pz, 10));

    // intermediate stand-off clip halfway down, back onto the column
    grey.add(box(0.022, 0.085, 0.10, M.steelWhiteDark, S * (PIER_X - 0.011), yMid, pz));
    const reachD = PIER_X - X_DROP - 0.025;
    grey.add(box(reachD, 0.030, 0.042, M.steelWhiteDark,
      S * (X_DROP + 0.025 + reachD / 2), yMid, pz));
    const bandM = new THREE.Mesh(cylGeo(0.038, 0.038, 0.036, 10, true), M.galv);
    bandM.position.set(xDrop, yMid, pz);
    galv.add(bandM);

    if (full) {
      // ball valve with a red lever
      dark.add(box(0.058, 0.078, 0.058, M.steelDark, xDrop, 2.42, pz));
      accent.add(box(0.018, 0.016, 0.115, M.robotRed, xDrop, 2.48, pz + 0.06));

      // filter / regulator: alloy body, plastic bowl, gauge, outlet
      alu.add(box(0.082, 0.145, 0.082, M.aluPlain, xDrop, Y_FRL, pz));
      alu.add(box(0.105, 0.030, 0.105, M.aluPlain, xDrop, Y_FRL + 0.086, pz));
      plastic.add(cyl(0.034, 0.088, M.plasticWhite, xDrop, Y_FRL - 0.115, pz, 10));
      plastic.add(cyl(0.026, 0.020, M.plasticWhite, xDrop, Y_FRL - 0.168, pz, 8));
      alu.add(cylX(0.030, 0.016, M.aluPlain, xDrop - S * 0.062, Y_FRL + 0.055, pz, 12));
      dark.add(box(0.052, 0.030, 0.052, M.steelDark, xDrop, Y_FRL + 0.118, pz));

      // outlet elbow + a coil of red hose hanging off it
      alu.add(box(0.055, 0.045, 0.075, M.aluPlain, xDrop, Y_FRL - 0.045, pz + 0.06));
      const turns = 2.4 + rf(rng, -0.4, 0.6);
      hose.add(cable(
        coilCurve(xDrop - S * 0.05, Y_FRL - 0.09, pz + 0.10, 0.135, turns, 0.36, S),
        matAirHose(), 0.014, 54, 5,
      ));
      // and the tail dropping to the floor
      hose.add(cable(catenary(
        V3(xDrop - S * 0.11, Y_FRL - 0.46, pz + 0.10),
        V3(xDrop - S * 0.30, 0.06, pz + rf(rng, 0.25, 0.55)),
        0.22, 12,
      ), matAirHose(), 0.014, 20, 5));
    } else {
      // short branch: quick coupler and a stub hose
      alu.add(box(0.052, 0.075, 0.052, M.aluPlain, xDrop, yBot - 0.05, pz));
      dark.add(cyl(0.020, 0.055, M.steelDark, xDrop, yBot - 0.11, pz, 8));
      hose.add(cable(catenary(
        V3(xDrop, yBot - 0.14, pz),
        V3(xDrop - S * 0.16, yBot - 0.72, pz + rf(rng, -0.2, 0.2)),
        0.16, 10,
      ), matAirHose(), 0.013, 16, 5));
    }
  }

  // ── low-level conduit and wall isolators ──────────────────────────────────
  conduit.add(cylZ(0.013, RUN, matConduit(), xCond, Y_COND, RUNMID, 8));
  // only on the *even* columns — the odd ones carry the full drop legs
  for (let i = 2; i < PIERS.length; i += 4) {
    const pz = PIERS[i];
    if (pz > Z0 || pz < Z1) continue;
    // drop from the wire-way, down past the conduit, into an isolator box
    conduit.add(cyl(0.013, Y_DUCT - Y_COND - 0.10, matConduit(),
      xCond, (Y_DUCT + Y_COND) / 2, pz + 0.09, 8));
    conduit.add(cyl(0.013, Y_COND - 1.62, matConduit(), xCond, (Y_COND + 1.62) / 2, pz - 0.09, 8));
    plastic.add(box(0.095, 0.215, 0.155, M.plasticWhite, S * (X_COND - 0.03), 1.50, pz - 0.09));
    dark.add(box(0.030, 0.055, 0.026, M.steelDark, S * (X_COND - 0.082), 1.50, pz - 0.09));
    // and a wire-way junction box where the drop leaves the duct
    plastic.add(box(0.09, 0.18, 0.14, M.plasticWhite, S * (X_DUCT - 0.10), Y_DUCT, pz + 0.09));
  }
  for (let z = Z0 - 0.7; z > Z1; z -= 1.6) {
    galv.add(box(0.026, 0.030, 0.028, M.galv, S * (X_COND + 0.020), Y_COND, z));
  }

  bake(g, 'airMain', blue, M.airPipe);
  bake(g, 'waterPipe', white, M.whitePipe);
  bake(g, 'pipeBrackets', grey, M.steelWhiteDark);
  bake(g, 'wireWayLid', lid, matDuctLid());
  bake(g, 'pipeClips', galv, M.galv);
  bake(g, 'wallConduit', conduit, matConduit());
  bake(g, 'airFittings', alu, M.aluPlain);
  bake(g, 'airValves', dark, M.steelDark);
  bake(g, 'airBowls', plastic, M.plasticWhite);
  bake(g, 'valveLevers', accent, M.robotRed);
  bake(g, 'airHoses', hose, matAirHose());

  shadows(g, true, true);
  return g;
}
