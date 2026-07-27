/**
 * build/shell.js — the building itself.
 *
 *   buildFloor()    green epoxy slab + every painted marking + concrete aprons
 *   buildWalls()    both side walls, the far gable, the near returns, pilasters
 *   buildCeiling()  roof deck soffit, transverse downstand beams, edge beams,
 *                   purlins and the bolted end gussets
 *
 * The window openings are NOT cut with CSG. The side walls are emitted as
 * horizontal *bands* (sill / spandrel / head) plus solid vertical piers between
 * the bay lines, so every bay line from `CFG.bay.all()[1]` to `[12]` is left as
 * a genuine 2.62 m gap in the two glazing bands. `build/windows.js` fills them.
 *
 * All three builders are already expressed in world coordinates — `layout.js`
 * adds them at the origin without any further transform.
 *
 * Reference: img01.jpg (crops A_ceiling_crane, D_leftside, F_bottomleft,
 * G_topleft, B_rightwall, E_foreground).
 */
import * as THREE from 'three';
import { CFG, PAL, SEED } from '../core/config.js';
import { M, variant } from '../core/materials.js';
import {
  box, cylGeo, decal, group, instance, makeRng, mergeGroup, rf, shadows,
} from '../core/utils.js';

// ────────────────────────────────────────────────────────────────────────────
// Shell constants derived from CFG
// ────────────────────────────────────────────────────────────────────────────

const HW = CFG.hall.halfWidth; //  6.50  inner face of the side walls
const ZF = CFG.hall.zFront; //  6.00  front (behind the camera)
const ZB = CFG.hall.zBack; // -46.80  far gable
const TOPY = CFG.hall.wallTopY; //  9.00

const WALL_T = 0.25; // wall thickness
const OUT_X = HW + WALL_T; // 6.75 outer face of the side walls
const Z_OUT_F = ZF + WALL_T; //  6.25
const Z_OUT_B = ZB - WALL_T; // -47.05
const MID_Z = (Z_OUT_F + Z_OUT_B) / 2; // -20.40
const HALL_LEN = Z_OUT_F - Z_OUT_B; //  53.30

/**
 * One tile of the painted-panel wall texture is 3.6 m × 3.6 m. The texture draws
 * four horizontal joints per tile, so the panel joints land every 0.90 m — the
 * rhythm the ribbed siding has in crops B and J. (At the old 1.2 m tile the
 * joints fell every 0.30 m, which mip-mapped away to a flat grey at this
 * distance and left the wall reading as blank paper.)
 */
const WALL_TILE_U = 3.6;
const WALL_TILE_V = 3.6;
/**
 * The joints that get real geometry as well as texture — a slim proud cover
 * strip, so they still throw a line at 3.5 m from the camera. Each Y must fall
 * inside a *full-length* band (sill / spandrel / head), never a glazing band.
 */
const WALL_JOINTS = [0.90, 1.80, 4.50, 8.10];
/** One tile of the epoxy / concrete / deck textures is 4 m square. */
const FLOOR_TILE = 4.0;

/** Paint layers, stacked in Y so nothing z-fights. */
const Y_PATCH = 0.0025;
const Y_LANE = 0.0050;
const Y_LINE = 0.0090;

// Aisle geometry (LAYOUT.md §1)
const AISLE_X = -2.35;
const AISLE_W = 1.95;
const AISLE_Z0 = 5.0;
const AISLE_Z1 = -34.0;
const LINE_W = 0.10;

// Cross aisle
const CROSS_Z = -21.5;
const CROSS_W = 1.8;
const CROSS_X0 = -6.0;
const CROSS_X1 = -0.5;

// Robot-cell yellow tape
const TAPE_W = 0.08;
const CELL_X0 = 0.15;
const CELL_X1 = 5.05;
const CELL_Z0 = -9.2;
const CELL_Z1 = 4.2;

// ────────────────────────────────────────────────────────────────────────────
// Local helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Scale (and optionally shift) a geometry's UV set in place. The shared textures
 * in `core/textures.js` are memoised at `repeat = (1,1)`, so tiling has to live
 * on the geometry — mutating `texture.repeat` would corrupt every other user of
 * that texture. `ov` lets the separate wall bands share one *world* V origin so
 * their panel joints line up across the glazing.
 */
function scaleUV(geo, su, sv, ou = 0, ov = 0) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv + ov);
  uv.needsUpdate = true;
  return geo;
}

/** A textured horizontal quad lying on the slab, UV-tiled at `tile` metres. */
function floorQuad(w, d, material, x, z, y = Y_PATCH, tile = FLOOR_TILE) {
  const geo = scaleUV(new THREE.PlaneGeometry(w, d), w / tile, d / tile);
  const m = new THREE.Mesh(geo, material);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

/**
 * A painted-wall slab. `su`/`sv` tile the ribbed-siding texture; the ±X faces of
 * a long thin box map U along Z and V along Y, which is what the side walls
 * need, and the ±Z faces map U along X, which is what the gable needs. Both
 * have V = 0 at the bottom edge, so `ov` shifts a band onto the world-Y joint
 * grid.
 */
function wallSlab(w, h, d, x, y, z, su, sv, ov = 0) {
  const geo = scaleUV(new THREE.BoxGeometry(w, h, d), su, sv, 0, ov);
  const m = new THREE.Mesh(geo, M.wall);
  m.position.set(x, y, z);
  return m;
}

/** Grey concrete plinth / skirting colour — a one-off tint of `wallPlain`. */
const plinthMat = () => variant('wallPlain', { color: PAL.concreteGrey, roughness: 0.92 }, 'shellPlinth');
/** Slightly dulled epoxy for worn patches and old repairs. */
const wornMat = () => variant('floor', { color: 0xd6dbd2 }, 'shellFloorWorn');
/** A greyer, dirtier epoxy patch (the scuffed area under the machine line). */
const scuffMat = () => variant('floor', { color: 0xc4cbc1 }, 'shellFloorScuff');

/**
 * The wall paint, pushed warm. `PAL.wallWhite` on its own goes paper-white once
 * the daylight coming through the right-hand glazing lands on it; the photo's
 * wall is a distinctly creamy off-white even where it is brightest.
 */
const wallPaintMat = () => variant('wall', { color: 0xfff8e8 }, 'shellWallWarm');
/** Panel-joint cover strip — a hair darker than the paint around it. */
const wallJointMat = () => variant('wallPlain', { color: 0xd0c9b8, roughness: 0.9 }, 'shellWallJoint');
/**
 * Carrier for the soft wall shading. Vertex colours are RGBA, so the alpha
 * gradient rides on the geometry and no bespoke texture is needed; `color` is
 * neutralised to white so the vertex colour *is* the grime colour.
 */
const wallShadeMat = () => variant('wallPlain', {
  color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false,
  roughness: 0.95, metalness: 0,
}, 'shellWallShade');

/** Downstand-beam webs sit a value step below their soffit flange (crop A). */
const beamWebMat = () => variant('ceilingBeam', { color: PAL.ceilingBeamShade }, 'shellBeamWeb');
/**
 * Purlins are all but invisible in the photograph — the ceiling reads as one
 * calm plane broken only by the downstands — so they are toned to the deck.
 */
const purlinMat = () => variant('ceilingBeam', { color: 0xdad5c9, roughness: 0.9 }, 'shellPurlin');

// ── soft wall shading ───────────────────────────────────────────────────────

/*
 * Overlay albedos, given in the renderer's *linear* working space (three reads
 * a vertex-colour attribute as working-space, unlike `material.color`, which it
 * converts from sRGB). These are roughly sRGB #665C4A and #757571.
 */
/** Warm floor grime creeping up off the apron. */
const GRIME = [0.133, 0.107, 0.068];
/** Neutral soft shadow — sill returns, pilaster contacts, the wall head. */
const SHADE = [0.179, 0.179, 0.171];

/**
 * Accumulates vertex-coloured quads that darken a wall face. RGBA vertex
 * colours give a smooth alpha falloff without a bespoke texture and without
 * banding, and the whole lot bakes down to one draw call.
 */
function shadeBuffer() {
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  return {
    /**
     * A grid on the inner face of side wall `s` at |x| = `xa`, spanning
     * z ∈ [zA,zB] and y ∈ [y0,y1] with nz × ny cells. `fn(tz, ty, i, j)`
     * returns the [r,g,b,a] written at each node.
     */
    wall(s, xa, zA, zB, y0, y1, nz, ny, fn) {
      const base = pos.length / 3;
      for (let j = 0; j <= ny; j++) {
        const ty = j / ny;
        const y = y0 + (y1 - y0) * ty;
        for (let i = 0; i <= nz; i++) {
          const tz = i / nz;
          pos.push(s * xa, y, zA + (zB - zA) * tz);
          nrm.push(-s, 0, 0);
          const c = fn(tz, ty, i, j);
          col.push(c[0], c[1], c[2], c[3]);
        }
      }
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nz; i++) {
          const a = base + j * (nz + 1) + i;
          const b = a + 1;
          const c = a + nz + 1;
          const d = c + 1;
          // wind so the face looks into the hall on whichever wall this is
          if (s > 0) idx.push(a, b, c, b, d, c);
          else idx.push(a, c, b, b, c, d);
        }
      }
    },
    /** @returns {THREE.Mesh|null} */
    build(material, name) {
      if (!idx.length) return null;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, material);
      m.name = name;
      m.castShadow = false;
      m.receiveShadow = true;
      m.renderOrder = 3;
      return m;
    },
  };
}

/**
 * A smooth seeded 0..1 band of `n + 1` samples, used to break the grime up along
 * the length of the wall so it never reads as an airbrushed stripe.
 */
function bandNoise(rng, n, octaves = 3, base = 6) {
  const out = new Array(n + 1).fill(0);
  let amp = 1;
  let k = base;
  let tot = 0;
  for (let o = 0; o < octaves; o++) {
    const ctrl = Array.from({ length: k + 1 }, () => rng());
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * k;
      const a = Math.min(k - 1, Math.floor(t));
      const f = t - a;
      out[i] += (ctrl[a] * (1 - f) + ctrl[a + 1] * f) * amp;
    }
    tot += amp;
    amp *= 0.55;
    k *= 3;
  }
  return out.map((v) => v / tot);
}

/**
 * The solid Z-spans of a side wall inside the two glazing bands: everything
 * that is *not* a bay-line window opening. Returned ascending in Z.
 */
function solidSpans() {
  const bays = CFG.bay.all(); // descending Z
  const half = CFG.windows.lower.width / 2; // 1.31 — both bands are 2.62 wide
  const ops = [];
  for (let k = 1; k <= bays.length - 2; k++) ops.push([bays[k] - half, bays[k] + half]);
  ops.sort((a, b) => a[0] - b[0]);

  const spans = [];
  let cur = Z_OUT_B;
  for (const [a, b] of ops) {
    if (a - cur > 0.02) spans.push([cur, a]);
    cur = Math.max(cur, b);
  }
  if (Z_OUT_F - cur > 0.02) spans.push([cur, Z_OUT_F]);
  return spans;
}

/** Z positions of the wall pilasters: mid-bay, i.e. on the solid piers. */
function pilasterZ() {
  const bays = CFG.bay.all();
  const zs = [bays[0] + CFG.bay.spacing / 2];
  for (const bz of bays) zs.push(bz - CFG.bay.spacing / 2);
  return zs;
}

// ────────────────────────────────────────────────────────────────────────────
// Floor
// ────────────────────────────────────────────────────────────────────────────

/**
 * The green epoxy floor slab and every painted marking on it.
 *
 * Origin is the world origin — the group is already world-placed, `layout.js`
 * just adds it. Layers, bottom to top: slab (y = 0), worn/repair patches,
 * the lighter aisle lane and its cross branch, then the white demarcation
 * lines and the yellow robot-cell tape. Bare concrete aprons run along both
 * side walls, the gable and the front return at `CFG.hall.apronY`.
 *
 * @returns {THREE.Group} named 'floor'
 */
export function buildFloor() {
  const g = group('floor');
  const rng = makeRng(SEED ^ 0x51ab);

  // ── the slab itself ───────────────────────────────────────────────────────
  g.add(floorQuad(OUT_X * 2 + 0.4, HALL_LEN + 0.4, M.floor, 0, MID_Z, 0));

  // ── worn / patched epoxy (the photo's floor is far from uniform) ──────────
  const patches = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const w = rf(rng, 1.6, 4.2);
    const d = rf(rng, 2.4, 7.0);
    patches.add(floorQuad(w, d, M.floor, rf(rng, -5.4, 5.4), rf(rng, -34, 4), Y_PATCH));
  }
  const worn = mergeGroup(patches, wornMat());
  worn.name = 'floorWorn';
  worn.castShadow = false;
  worn.renderOrder = 1;
  g.add(worn);

  // one big dull region under the machine line, and one in the far bays
  const scuffs = new THREE.Group();
  scuffs.add(floorQuad(3.6, 11.0, M.floor, 3.9, -19.5, Y_PATCH + 0.0005));
  scuffs.add(floorQuad(4.4, 8.0, M.floor, -4.6, -30.0, Y_PATCH + 0.0005));
  const scuff = mergeGroup(scuffs, scuffMat());
  scuff.name = 'floorScuff';
  scuff.castShadow = false;
  scuff.renderOrder = 1;
  g.add(scuff);

  // ── concrete aprons along the walls ───────────────────────────────────────
  const ap = CFG.hall.apronWidth; // 0.62
  const apY = CFG.hall.apronY; // 0.02
  const aprons = new THREE.Group();
  for (const s of [-1, 1]) {
    aprons.add(floorQuad(ap, HALL_LEN - 0.6, M.concrete, s * (HW - ap / 2), MID_Z, apY));
  }
  aprons.add(floorQuad((HW - ap) * 2, ap, M.concrete, 0, ZB + ap / 2, apY));
  aprons.add(floorQuad((HW - ap) * 2, ap, M.concrete, 0, ZF - ap / 2, apY));
  const apron = mergeGroup(aprons, M.concrete);
  apron.name = 'concreteApron';
  apron.castShadow = false;
  apron.renderOrder = 1;
  g.add(apron);

  // ── the aisle lane: lighter, glossier green sweeping across the lower left ─
  const aisleLen = AISLE_Z0 - AISLE_Z1; // 39.0
  const aisleZ = (AISLE_Z0 + AISLE_Z1) / 2; // -14.5
  const lanes = new THREE.Group();
  lanes.add(floorQuad(AISLE_W, aisleLen, M.floorAisle, AISLE_X, aisleZ, Y_LANE));
  lanes.add(floorQuad(CROSS_X1 - CROSS_X0, CROSS_W, M.floorAisle,
    (CROSS_X0 + CROSS_X1) / 2, CROSS_Z, Y_LANE - 0.0006));
  const lane = mergeGroup(lanes, M.floorAisle);
  lane.name = 'aisleLane';
  lane.castShadow = false;
  lane.renderOrder = 1;
  g.add(lane);

  // ── crisp white demarcation lines ─────────────────────────────────────────
  const lines = new THREE.Group();
  const lx0 = AISLE_X - AISLE_W / 2; // -3.325
  const lx1 = AISLE_X + AISLE_W / 2; // -1.375
  lines.add(decal(LINE_W, aisleLen, M.floorLine, lx0, aisleZ, Y_LINE));
  lines.add(decal(LINE_W, aisleLen, M.floorLine, lx1, aisleZ, Y_LINE));

  // the cross branch's lines stop where they meet the main lane
  for (const cz of [CROSS_Z + CROSS_W / 2, CROSS_Z - CROSS_W / 2]) {
    const segA = [CROSS_X0, lx0];
    const segB = [lx1, CROSS_X1];
    for (const [a, b] of [segA, segB]) {
      if (b - a < 0.05) continue;
      lines.add(decal(b - a, LINE_W, M.floorLine, (a + b) / 2, cz, Y_LINE));
    }
  }

  // a short spur line peeling off toward the shelving, as in crop D
  lines.add(decal(LINE_W, 5.6, M.floorLine, -5.15, -12.4, Y_LINE));
  lines.add(decal(1.85, LINE_W, M.floorLine, -4.25, -9.6, Y_LINE));

  const line = mergeGroup(lines, M.floorLine);
  line.name = 'floorLines';
  line.castShadow = false;
  line.renderOrder = 2;
  g.add(line);

  // ── yellow equipment tape around the robot cell ───────────────────────────
  const tapes = new THREE.Group();
  const cellW = CELL_X1 - CELL_X0;
  const cellD = CELL_Z1 - CELL_Z0;
  const cellCx = (CELL_X0 + CELL_X1) / 2;
  const cellCz = (CELL_Z0 + CELL_Z1) / 2;
  tapes.add(decal(TAPE_W, cellD, M.floorYellow, CELL_X0, cellCz, Y_LINE));
  tapes.add(decal(TAPE_W, cellD, M.floorYellow, CELL_X1, cellCz, Y_LINE));
  tapes.add(decal(cellW, TAPE_W, M.floorYellow, cellCx, CELL_Z0, Y_LINE));
  tapes.add(decal(cellW, TAPE_W, M.floorYellow, cellCx, CELL_Z1, Y_LINE));

  // two little L-marks against the right wall (crop E, beside robot B)
  for (const [lx, lz] of [[5.3, -2.4], [5.3, -5.2]]) {
    tapes.add(decal(0.42, TAPE_W, M.floorYellow, lx + 0.21, lz, Y_LINE));
    tapes.add(decal(TAPE_W, 0.42, M.floorYellow, lx, lz - 0.21, Y_LINE));
  }
  // pallet-drop squares beside the line
  for (const [px, pz] of [[4.85, -18.2], [-5.35, -14.5]]) {
    tapes.add(decal(1.25, TAPE_W, M.floorYellow, px, pz - 0.62, Y_LINE));
    tapes.add(decal(1.25, TAPE_W, M.floorYellow, px, pz + 0.62, Y_LINE));
    tapes.add(decal(TAPE_W, 1.25, M.floorYellow, px - 0.62, pz, Y_LINE));
    tapes.add(decal(TAPE_W, 1.25, M.floorYellow, px + 0.62, pz, Y_LINE));
  }
  const tape = mergeGroup(tapes, M.floorYellow);
  tape.name = 'floorTape';
  tape.castShadow = false;
  tape.renderOrder = 2;
  g.add(tape);

  shadows(g, false, true);
  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Walls
// ────────────────────────────────────────────────────────────────────────────

/**
 * Both side walls, the far gable wall and the two near return walls, plus the
 * inward-projecting pilasters.
 *
 * Origin is the world origin. Wall thickness is 0.25 m with the inner faces at
 * `x = ±CFG.hall.halfWidth` and the gable's inner face at `CFG.hall.zBack`.
 *
 * Each side wall is emitted as three full-length horizontal bands —
 * sill (0 → `CFG.windows.lower.sillY`), spandrel (`lower.headY` →
 * `upper.sillY`) and head (`upper.headY` → `CFG.hall.wallTopY`) — with solid
 * vertical piers filling the two glazing bands everywhere except the
 * 2.62 m-wide bay-line openings, which `windows.js` glazes.
 *
 * Pilasters (`CFG.column`) sit on the solid piers, i.e. mid-bay, so that they
 * read as the structural columns visible in crop B without standing in front of
 * a window opening.
 *
 * Surfacing, all fitted to crops B and J: the paint is warmed off paper-white,
 * the siding texture is tiled so its joints land every 0.90 m instead of every
 * 0.30 m (where they mip-mapped into a flat grey), those joints get slim proud
 * cover strips so they survive at 3.5 m from the camera, and a single
 * vertex-coloured overlay mesh carries the floor grime, the shadow under each
 * window sill, the contact shading beside every pilaster and the darkening of
 * the wall head under the edge beam.
 *
 * @returns {THREE.Group} named 'walls'
 */
export function buildWalls() {
  const g = group('walls');

  const w = CFG.windows;
  const spans = solidSpans();
  const painted = new THREE.Group(); // everything on M.wall → one merged mesh
  const plain = new THREE.Group(); // pilasters + reveal-less trim → M.wallPlain
  const plinths = new THREE.Group(); // grey concrete skirting
  const joints = new THREE.Group(); // horizontal panel-joint cover strips

  // ── the two side walls ────────────────────────────────────────────────────
  const bands = [
    [0, w.lower.sillY], // sill band          0.00 → 2.35
    [w.lower.headY, w.upper.sillY], // spandrel band      4.05 → 5.55
    [w.upper.headY, TOPY], // head band          7.25 → 9.60
  ];
  const pierBands = [
    [w.lower.sillY, w.lower.headY], // lower glazing band 2.35 → 4.05
    [w.upper.sillY, w.upper.headY], // clerestory band    5.55 → 7.25
  ];

  for (const s of [-1, 1]) {
    const xc = s * (HW + WALL_T / 2);

    for (const [y0, y1] of bands) {
      const h = y1 - y0;
      painted.add(wallSlab(WALL_T, h, HALL_LEN, xc, (y0 + y1) / 2, MID_Z,
        HALL_LEN / WALL_TILE_U, h / WALL_TILE_V, y0 / WALL_TILE_V));
    }

    for (const [y0, y1] of pierBands) {
      const h = y1 - y0;
      for (const [a, b] of spans) {
        const len = b - a;
        painted.add(wallSlab(WALL_T, h, len, xc, (y0 + y1) / 2, (a + b) / 2,
          len / WALL_TILE_U, h / WALL_TILE_V, y0 / WALL_TILE_V));
      }
    }

    // projecting sill nib under the lower windows (the step visible in crop B)
    painted.add(wallSlab(0.07, 0.055, HALL_LEN, s * (HW - 0.035), w.lower.sillY - 0.028, MID_Z,
      HALL_LEN / WALL_TILE_U, 0.05));

    // panel-joint cover strips, so the joints survive mip-mapping at 3.5 m
    for (const jy of WALL_JOINTS) {
      joints.add(box(0.014, 0.024, HALL_LEN, wallJointMat(), s * (HW - 0.007), jy, MID_Z));
    }

    // pilasters
    for (const pz of pilasterZ()) {
      const p = box(CFG.column.depth, TOPY, CFG.column.width, M.wallPlain,
        s * (HW - CFG.column.depth / 2), TOPY / 2, pz);
      plain.add(p);
      // a slightly wider foot, as cast at the base of each column
      plain.add(box(CFG.column.depth + 0.05, 0.26, CFG.column.width + 0.08, M.wallPlain,
        s * (HW - (CFG.column.depth + 0.05) / 2), 0.13, pz));
    }

    // grey skirting where the wall meets the apron
    plinths.add(box(0.055, 0.17, HALL_LEN, plinthMat(), s * (HW - 0.027), 0.085, MID_Z));
  }

  // ── far gable wall ────────────────────────────────────────────────────────
  const gableW = OUT_X * 2;
  painted.add(wallSlab(gableW, TOPY, WALL_T, 0, TOPY / 2, ZB - WALL_T / 2,
    gableW / WALL_TILE_U, TOPY / WALL_TILE_V));
  for (const gx of [-4.6, 4.6]) {
    plain.add(box(CFG.column.width, TOPY, CFG.column.depth, M.wallPlain,
      gx, TOPY / 2, ZB + CFG.column.depth / 2));
  }
  plinths.add(box(gableW - 0.4, 0.17, 0.055, plinthMat(), 0, 0.085, ZB + 0.027));

  // ── near return walls (behind the camera) + the lintel over the opening ───
  const retW = OUT_X - 3.1;
  for (const s of [-1, 1]) {
    painted.add(wallSlab(retW, TOPY, WALL_T, s * (3.1 + retW / 2), TOPY / 2, ZF + WALL_T / 2,
      retW / WALL_TILE_U, TOPY / WALL_TILE_V));
  }
  painted.add(wallSlab(6.2, TOPY - 4.6, WALL_T, 0, (TOPY + 4.6) / 2, ZF + WALL_T / 2,
    6.2 / WALL_TILE_U, (TOPY - 4.6) / WALL_TILE_V, 4.6 / WALL_TILE_V));

  // ── merge & flag ──────────────────────────────────────────────────────────
  const shell = mergeGroup(painted, wallPaintMat());
  shell.name = 'wallShell';
  g.add(shell);

  const cols = mergeGroup(plain, M.wallPlain);
  cols.name = 'pilasters';
  g.add(cols);

  const trim = mergeGroup(joints, wallJointMat());
  trim.name = 'wallPanelJoints';
  g.add(trim);

  const skirt = mergeGroup(plinths, plinthMat());
  skirt.name = 'wallPlinth';
  g.add(skirt);

  shadows(g, true, true);

  // ── soft shading: floor grime, sill returns, pilaster contacts (crops B/J) ─
  const sb = shadeBuffer();
  const rng = makeRng(SEED ^ 0x77aa);
  const xFace = HW - 0.006; // 6 mm proud of the paint, safely in front of it

  const NZ = 132; // ≈0.39 m per node down the hall
  const NS = 40; // ≈0.07 m per node across a sill

  for (const s of [-1, 1]) {
    // 1 · dirt creeping up off the apron, broken up along the wall
    const streak = bandNoise(rng, NZ, 3, 7);
    sb.wall(s, xFace, Z_OUT_B + 0.3, Z_OUT_F - 0.3, 0.175, 1.80, NZ, 7, (tz, ty, i) => {
      const f = (1 - ty) ** 2.3 * (0.42 + 0.95 * streak[i]);
      return [GRIME[0], GRIME[1], GRIME[2], Math.min(0.30, f * 0.32)];
    });

    // 2 · the shadow the sill nib throws, and the dribbles that run out of it
    for (const bz of CFG.bay.all().slice(1, -1)) {
      const drip = bandNoise(rng, NS, 2, 7);
      const yTop = w.lower.sillY - 0.06;
      sb.wall(s, xFace, bz - 1.42, bz + 1.42, yTop - 0.78, yTop, NS, 6, (tz, ty, i) => {
        const edge = Math.min(1, (0.5 - Math.abs(tz - 0.5)) * 7);
        const f = ty ** 2.0 * edge * (0.45 + 0.85 * drip[i]);
        return [SHADE[0], SHADE[1], SHADE[2], Math.min(0.32, f * 0.34)];
      });
    }

    // 3 · contact shading either side of every pilaster — this is where the
    //     wall turns away from the glazing and visibly loses light
    for (const pz of pilasterZ()) {
      for (const o of [-1, 1]) {
        const za = pz + o * (CFG.column.width / 2 + 0.005);
        const zb = pz + o * (CFG.column.width / 2 + 0.26);
        sb.wall(s, xFace, Math.min(za, zb), Math.max(za, zb), 0.20, 7.20, 8, 5, (tz) => {
          const d = o > 0 ? tz : 1 - tz; // 0 hard against the pilaster
          return [SHADE[0], SHADE[1], SHADE[2], (1 - d) ** 2.2 * 0.22];
        });
      }
    }

    // 4 · the wall head goes off under the edge beam and the runway girder
    sb.wall(s, xFace, Z_OUT_B + 0.3, Z_OUT_F - 0.3, 7.60, TOPY - 0.02, 24, 4,
      (tz, ty) => [SHADE[0], SHADE[1], SHADE[2], ty ** 1.8 * 0.26]);
  }

  const soft = sb.build(wallShadeMat(), 'wallSoftShading');
  if (soft) g.add(soft);

  return g;
}

// ────────────────────────────────────────────────────────────────────────────
// Ceiling / roof structure
// ────────────────────────────────────────────────────────────────────────────

/**
 * The roof: deck soffit, the deep transverse downstand beams at every bay line,
 * the longitudinal edge beams at `±CFG.edgeBeam.x`, the purlins between the
 * downstands and the bolted end gussets where each downstand lands on the wall.
 *
 * The downstands are the ceiling's only real feature in the photograph, so they
 * get a two-tone treatment (bright soffit flange, slightly deeper web) while the
 * purlins are pulled back to a barely-there ribbing — see the note by them.
 *
 * Origin is the world origin. The deck plane faces down (−Y) at
 * `CFG.hall.ceilingY`; every beam soffit is at `CFG.roofBeam.soffitY`.
 * Nothing up here casts a shadow — the whole roof sits above the head band, so
 * it never sees the sun, and skipping it keeps the shadow pass cheap.
 *
 * @returns {THREE.Group} named 'ceiling'
 */
export function buildCeiling() {
  const g = group('ceiling');

  const rb = CFG.roofBeam; // soffitY 8.5, depth 1.1, width 0.42
  const eb = CFG.edgeBeam; // soffitY 8.5, depth 1.1, width 0.34, x 6.25
  const deckY = CFG.hall.ceilingY; // 9.6

  // ── deck soffit ───────────────────────────────────────────────────────────
  const deckW = OUT_X * 2;
  const deckGeo = scaleUV(new THREE.PlaneGeometry(deckW, HALL_LEN),
    deckW / FLOOR_TILE, HALL_LEN / FLOOR_TILE);
  const deck = new THREE.Mesh(deckGeo, M.ceiling);
  deck.rotation.x = Math.PI / 2; // normal → −Y, faces the hall
  deck.position.set(0, deckY, MID_Z);
  deck.name = 'roofDeck';
  g.add(deck);

  // ── structure ─────────────────────────────────────────────────────────────
  // Three buckets, three merged meshes: the lit soffit faces, the slightly
  // deeper beam webs (that value step is what makes the downstands read as
  // *deep* rather than as painted-on lines) and the near-invisible purlins.
  const steel = new THREE.Group();
  const webs = new THREE.Group();
  const purlins = new THREE.Group();

  const FLANGE_T = 0.09;
  const WEB_W = 0.30; // web is narrower than the 0.42 flange → plate girder
  const beamSpan = HW * 2 + 0.2;
  const webH = deckY - (rb.soffitY + FLANGE_T);
  const bays = CFG.bay.all();

  for (const bz of bays) {
    steel.add(box(beamSpan, FLANGE_T, rb.width, M.ceilingBeam,
      0, rb.soffitY + FLANGE_T / 2, bz));
    webs.add(box(beamSpan, webH, WEB_W, M.ceilingBeam,
      0, rb.soffitY + FLANGE_T + webH / 2, bz));
    // a shallow top haunch either side of the web, tucked under the deck
    steel.add(box(beamSpan, 0.05, rb.width, M.ceilingBeam, 0, deckY - 0.025, bz));
  }

  // longitudinal edge beams at the wall head
  const ebWebH = eb.depth - FLANGE_T;
  for (const s of [-1, 1]) {
    steel.add(box(eb.width, FLANGE_T, HALL_LEN, M.ceilingBeam,
      s * eb.x, eb.soffitY + FLANGE_T / 2, MID_Z));
    webs.add(box(eb.width - 0.1, ebWebH, HALL_LEN, M.ceilingBeam,
      s * eb.x, eb.soffitY + FLANGE_T + ebWebH / 2, MID_Z));
  }

  /*
   * Purlins. In the photograph the coffers between the downstands are a calm,
   * almost featureless plane — there is no visible grid up there at all. So the
   * runs are 2.4 m apart rather than 1.2 (six across the hall instead of
   * eleven), only 0.12 m deep instead of 0.20, tucked hard up under the deck
   * instead of hanging 0.65 m below the beam soffits, and toned to the deck.
   * They survive as the faintest ribbing and nothing more.
   */
  const PURLIN_D = 0.12;
  const PURLIN_Y = deckY - 0.005 - PURLIN_D / 2;
  const stations = [Z_OUT_B, ...bays, Z_OUT_F].sort((a, b) => a - b);
  const halfBeam = rb.width / 2;
  for (let px = -6.0; px <= 6.01; px += 2.4) {
    const x = Math.round(px * 1000) / 1000;
    for (let i = 0; i < stations.length - 1; i++) {
      const a = stations[i] + (i === 0 ? 0 : halfBeam);
      const b = stations[i + 1] - (i + 1 === stations.length - 1 ? 0 : halfBeam);
      const len = b - a;
      if (len < 0.12) continue;
      purlins.add(box(0.10, PURLIN_D, len, M.ceilingBeam, x, PURLIN_Y, (a + b) / 2));
    }
  }

  // bolted end gussets where each downstand lands on the wall head (crop A)
  const gx = HW - 0.6;
  const gz = rb.width / 2 + 0.012;
  for (const bz of bays) {
    for (const s of [-1, 1]) {
      steel.add(box(0.82, 0.86, 0.024, M.ceilingBeam, s * gx, deckY - 0.56, bz + gz));
    }
  }

  const frame = mergeGroup(steel, M.ceilingBeam);
  frame.name = 'roofFrame';
  g.add(frame);

  const beamWebs = mergeGroup(webs, beamWebMat());
  beamWebs.name = 'roofBeamWebs';
  g.add(beamWebs);

  const purl = mergeGroup(purlins, purlinMat());
  purl.name = 'roofPurlins';
  g.add(purl);

  // ── gusset bolt heads (instanced — 336 of them) ───────────────────────────
  const bolts = [];
  for (const bz of bays) {
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 3; j++) {
          bolts.push({
            pos: [s * gx + (i - 1.5) * 0.2, deckY - 0.56 + (j - 1) * 0.23, bz + gz + 0.016],
            rot: [Math.PI / 2, 0, 0],
          });
        }
      }
    }
  }
  const boltMesh = instance(cylGeo(0.026, 0.026, 0.016, 6), M.steelWhiteDark, bolts);
  boltMesh.name = 'gussetBolts';
  g.add(boltMesh);

  shadows(g, false, true);
  return g;
}
