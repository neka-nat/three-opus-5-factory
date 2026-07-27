/**
 * utils.js — small geometry/scene helpers shared by every builder module.
 *
 * Conventions used throughout the project:
 *   • every builder returns a THREE.Object3D (usually a Group) positioned at
 *     its own local origin, with +Y up and its "footprint centre" at (0,0,0)
 *     unless the doc-comment says otherwise;
 *   • builders never add themselves to the scene — layout.js does the placing;
 *   • prefer the helpers below over `new THREE.Mesh(new THREE.BoxGeometry…)`
 *     so shadow flags and cached geometry stay consistent.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ────────────────────────────────────────────────────────────────────────────
// Deterministic randomness
// ────────────────────────────────────────────────────────────────────────────

/** Mulberry32 — tiny, fast, seedable PRNG. Returns a function in [0,1). */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience: seeded float in [lo,hi). */
export const rf = (rng, lo, hi) => lo + rng() * (hi - lo);
/** Convenience: seeded int in [lo,hi]. */
export const ri = (rng, lo, hi) => Math.floor(lo + rng() * (hi - lo + 1));
/** Convenience: seeded pick from an array. */
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// ────────────────────────────────────────────────────────────────────────────
// Geometry cache — BoxGeometry/CylinderGeometry are created constantly, and
// re-using them keeps the draw-call setup and memory sane.
// ────────────────────────────────────────────────────────────────────────────
const _geoCache = new Map();
function cached(key, make) {
  let g = _geoCache.get(key);
  if (!g) {
    g = make();
    _geoCache.set(key, g);
  }
  return g;
}

export function boxGeo(w, h, d) {
  return cached(`b|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
}

export function cylGeo(rt, rb, h, seg = 16, open = false) {
  return cached(`c|${rt}|${rb}|${h}|${seg}|${open}`, () =>
    new THREE.CylinderGeometry(rt, rb, h, seg, 1, open),
  );
}

export function planeGeo(w, h, ws = 1, hs = 1) {
  return cached(`p|${w}|${h}|${ws}|${hs}`, () => new THREE.PlaneGeometry(w, h, ws, hs));
}

export function sphereGeo(r, ws = 16, hs = 12) {
  return cached(`s|${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
}

// ────────────────────────────────────────────────────────────────────────────
// Mesh factories
// ────────────────────────────────────────────────────────────────────────────

/**
 * Axis-aligned box centred at (x,y,z).
 * @param {number} w width (X)  @param {number} h height (Y)  @param {number} d depth (Z)
 */
export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(boxGeo(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Box whose *bottom* face sits at y (handy for anything standing on the floor). */
export function boxOn(w, h, d, material, x = 0, y = 0, z = 0) {
  return box(w, h, d, material, x, y + h / 2, z);
}

/** Y-axis cylinder centred at (x,y,z). */
export function cyl(r, h, material, x = 0, y = 0, z = 0, seg = 16) {
  const m = new THREE.Mesh(cylGeo(r, r, h, seg), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Cylinder laid along the X axis (rollers, shafts, pipes across the hall). */
export function cylX(r, len, material, x = 0, y = 0, z = 0, seg = 16) {
  const m = cyl(r, len, material, x, y, z, seg);
  m.rotation.z = Math.PI / 2;
  return m;
}

/** Cylinder laid along the Z axis (pipes running down the hall). */
export function cylZ(r, len, material, x = 0, y = 0, z = 0, seg = 16) {
  const m = cyl(r, len, material, x, y, z, seg);
  m.rotation.x = Math.PI / 2;
  return m;
}

/** Cylinder spanning two arbitrary points — used for braces, chains, cables. */
export function cylBetween(r, material, a, b, seg = 10) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(cylGeo(r, r, 1, seg), material);
  m.scale.set(1, len, 1);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Hollow rectangular tube (the section used for aluminium extrusion, jib booms,
 * crane girders …) built from four boxes so the inside is genuinely open when
 * seen end-on. Extruded along +Z, centred on the origin.
 */
export function tubeBox(w, h, len, wall, material) {
  const g = new THREE.Group();
  g.add(box(w, wall, len, material, 0, h / 2 - wall / 2, 0));
  g.add(box(w, wall, len, material, 0, -h / 2 + wall / 2, 0));
  g.add(box(wall, h - wall * 2, len, material, w / 2 - wall / 2, 0, 0));
  g.add(box(wall, h - wall * 2, len, material, -w / 2 + wall / 2, 0, 0));
  return g;
}

/**
 * Standard steel I-beam extruded along +Z. Returns a single merged Mesh.
 * @param {number} h  overall depth (Y)
 * @param {number} bf flange width (X)
 * @param {number} tf flange thickness
 * @param {number} tw web thickness
 */
export function iBeam(h, bf, tf, tw, len, material) {
  const parts = [
    new THREE.BoxGeometry(bf, tf, len).translate(0, h / 2 - tf / 2, 0),
    new THREE.BoxGeometry(bf, tf, len).translate(0, -h / 2 + tf / 2, 0),
    new THREE.BoxGeometry(tw, h - tf * 2, len),
  ];
  const m = new THREE.Mesh(mergeGeometries(parts), material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Rounded box via a lathe-free trick: a BoxGeometry with bevelled corners. */
export function roundedBox(w, h, d, r, material, seg = 3) {
  const shape = new THREE.Shape();
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  shape.moveTo(-hw - r, -hh);
  shape.lineTo(-hw - r, hh);
  shape.quadraticCurveTo(-hw - r, hh + r, -hw, hh + r);
  shape.lineTo(hw, hh + r);
  shape.quadraticCurveTo(hw + r, hh + r, hw + r, hh);
  shape.lineTo(hw + r, -hh);
  shape.quadraticCurveTo(hw + r, -hh - r, hw, -hh - r);
  shape.lineTo(-hw, -hh - r);
  shape.quadraticCurveTo(-hw - r, -hh - r, -hw - r, -hh);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: d,
    bevelEnabled: true,
    bevelSize: r * 0.4,
    bevelThickness: r * 0.4,
    bevelSegments: seg,
    curveSegments: seg + 2,
  });
  geo.translate(0, 0, -d / 2);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ────────────────────────────────────────────────────────────────────────────
// Curved / swept geometry
// ────────────────────────────────────────────────────────────────────────────

/**
 * Tube swept along a curve, with an optional corrugation ripple — this is how
 * the cream robot dress-pack conduits and the flexible vacuum hoses are made.
 * @param {THREE.Curve} curve
 * @param {object} o {radius, segments, radial, corrugate, corrugatePeriod, corrugateDepth}
 */
export function corrugatedTube(curve, material, o = {}) {
  const {
    radius = 0.045,
    segments = 160,
    radial = 12,
    corrugate = true,
    corrugatePeriod = 0.035, // metres per rib
    corrugateDepth = 0.22, // fraction of radius
  } = o;

  const geo = new THREE.TubeGeometry(curve, segments, radius, radial, false);
  if (corrugate) {
    const len = curve.getLength();
    const ribs = Math.max(4, Math.round(len / corrugatePeriod));
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i); // 0..1 along the curve
      const k = Math.sin(u * ribs * Math.PI * 2);
      v.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nrm, i);
      v.addScaledVector(n, k * radius * corrugateDepth);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Catenary between two points — used for the crane festoon cable loops and any
 * slack wire. `sag` is the vertical drop of the lowest point below the chord.
 */
export function catenary(a, b, sag, samples = 24) {
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = new THREE.Vector3().lerpVectors(a, b, t);
    p.y -= Math.sin(Math.PI * t) * sag;
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}

/** Thin swept tube with no corrugation — cables, chains, hoses, wires. */
export function cable(curve, material, radius = 0.012, segments = 48, radial = 6) {
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, radial, false), material);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

// ────────────────────────────────────────────────────────────────────────────
// Instancing & merging
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build an InstancedMesh from a list of {pos:[x,y,z], rot?:[x,y,z], scale?:number|[x,y,z]}.
 * Use this for anything repeated more than ~30 times (rollers, bolts, bins).
 */
export function instance(geometry, material, transforms) {
  const im = new THREE.InstancedMesh(geometry, material, transforms.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  transforms.forEach((t, i) => {
    p.set(t.pos[0], t.pos[1], t.pos[2]);
    e.set(t.rot?.[0] ?? 0, t.rot?.[1] ?? 0, t.rot?.[2] ?? 0);
    q.setFromEuler(e);
    const sc = t.scale ?? 1;
    if (Array.isArray(sc)) s.set(sc[0], sc[1], sc[2]);
    else s.set(sc, sc, sc);
    m.compose(p, q, s);
    im.setMatrixAt(i, m);
  });
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = true;
  im.receiveShadow = true;
  im.frustumCulled = false;
  return im;
}

/**
 * Flatten a Group of same-material meshes into one merged Mesh.
 * Returns the original group unchanged if the meshes disagree on material.
 */
export function mergeGroup(group, material) {
  const geos = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      // Merging requires identical attribute sets.
      for (const key of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
      }
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      }
      geos.push(g);
    }
  });
  if (!geos.length) return group;
  const merged = new THREE.Mesh(mergeGeometries(geos, false), material);
  merged.castShadow = true;
  merged.receiveShadow = true;
  return merged;
}

// ────────────────────────────────────────────────────────────────────────────
// Misc
// ────────────────────────────────────────────────────────────────────────────

/** Set castShadow/receiveShadow on a whole subtree. */
export function shadows(obj, cast = true, receive = true) {
  obj.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh) {
      o.castShadow = cast;
      o.receiveShadow = receive;
    }
  });
  return obj;
}

/** Group helper: `group('name', childA, childB, …)`. */
export function group(name, ...children) {
  const g = new THREE.Group();
  g.name = name;
  children.filter(Boolean).forEach((c) => g.add(c));
  return g;
}

/** Place an object and return it (chainable in array literals). */
export function at(obj, x, y, z, ry = 0) {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  return obj;
}

/** A flat quad lying on the floor, facing +Y — for painted markings and decals. */
export function decal(w, d, material, x, z, y = 0.004, ry = 0) {
  const m = new THREE.Mesh(planeGeo(w, d), material);
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = ry;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  m.renderOrder = 1;
  return m;
}

/** A vertical quad facing +X / -X / +Z / -Z — for wall signs and labels. */
export function billboard(w, h, material, x, y, z, ry = 0) {
  const m = new THREE.Mesh(planeGeo(w, h), material);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

export const DEG = Math.PI / 180;
export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
