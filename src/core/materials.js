/**
 * materials.js — the scene's material registry.
 *
 * Usage from any builder module:
 *
 *     import { M } from '../core/materials.js';
 *     const mesh = box(1, 1, 1, M.craneOrange);
 *
 * `M` is a lazy Proxy: a material is only constructed the first time its key is
 * touched, and the same instance is shared everywhere afterwards. That keeps the
 * program count low and lets the renderer batch aggressively.
 *
 * If you need a one-off variant, use `tinted(key, hexColour)` or `clone(key, patch)`
 * rather than mutating `M.something` — mutation is global.
 */
import * as THREE from 'three';
import { PAL } from './config.js';
import * as T from './textures.js';

const defs = {
  // ── floor ────────────────────────────────────────────────────────────────
  floor: () =>
    new THREE.MeshStandardMaterial({
      map: T.floorEpoxy(PAL.floorGreen),
      roughnessMap: T.floorEpoxyRough(),
      color: 0xffffff,
      roughness: 1.0, // modulated by roughnessMap → ~0.22-0.55
      metalness: 0.0,
      envMapIntensity: 0.85,
    }),
  floorAisle: () =>
    new THREE.MeshStandardMaterial({
      map: T.floorEpoxy(PAL.floorGreenAisle),
      roughnessMap: T.floorEpoxyRough(),
      roughness: 0.86,
      metalness: 0.0,
      envMapIntensity: 1.0,
    }),
  floorLine: () =>
    new THREE.MeshStandardMaterial({ color: PAL.floorLine, roughness: 0.6, metalness: 0 }),
  floorYellow: () =>
    new THREE.MeshStandardMaterial({ color: PAL.floorYellow, roughness: 0.62, metalness: 0 }),
  hazardTape: () =>
    new THREE.MeshStandardMaterial({ map: T.hazardStripe(45), roughness: 0.6, metalness: 0 }),
  concrete: () =>
    new THREE.MeshStandardMaterial({ map: T.concrete(), roughness: 0.92, metalness: 0 }),

  // ── building shell ───────────────────────────────────────────────────────
  wall: () =>
    new THREE.MeshStandardMaterial({ map: T.wallPanel(PAL.wallWhite), roughness: 0.86, metalness: 0 }),
  wallPlain: () =>
    new THREE.MeshStandardMaterial({ color: PAL.wallWhite, roughness: 0.88, metalness: 0 }),
  ceiling: () =>
    new THREE.MeshStandardMaterial({ map: T.ceilingDeck(), roughness: 0.9, metalness: 0 }),
  ceilingBeam: () =>
    new THREE.MeshStandardMaterial({ color: PAL.ceilingBeam, roughness: 0.84, metalness: 0.03 }),
  steelWhite: () =>
    new THREE.MeshStandardMaterial({
      map: T.paintedMetal(PAL.steelWhite), roughness: 0.72, metalness: 0.12,
    }),
  steelWhiteDark: () =>
    new THREE.MeshStandardMaterial({ color: PAL.steelWhiteDark, roughness: 0.75, metalness: 0.12 }),
  shutter: () =>
    new THREE.MeshStandardMaterial({ map: T.shutterSlats(), roughness: 0.62, metalness: 0.35 }),
  shutterHeader: () =>
    new THREE.MeshStandardMaterial({ color: PAL.shutterHeaderGreen, roughness: 0.68, metalness: 0.05 }),
  doorCream: () =>
    new THREE.MeshStandardMaterial({ map: T.paintedMetal(PAL.doorCream), roughness: 0.7, metalness: 0.15 }),
  windowFrame: () =>
    new THREE.MeshStandardMaterial({ color: PAL.windowFrame, roughness: 0.55, metalness: 0.2 }),
  /**
   * Blown-out daylight seen through the glazing.
   *
   * This has to be *emissive*, not a `toneMapped: false` basic material: the
   * post-processing chain ends in an OutputPass, which tone-maps the whole
   * buffer, so a per-material opt-out has no effect and plain white would land
   * well below 255. Driving emissive far past 1.0 makes the glazing genuinely
   * clip, exactly as it does in the photograph (~15 k pure-white pixels down
   * the right-hand wall), and gives the bloom pass something real to catch.
   */
  windowGlow: () =>
    new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xfffdf8, emissiveIntensity: 9,
      emissiveMap: T.windowSky(), roughness: 1, metalness: 0,
    }),
  /** Same, for the near bays the camera sees straight into. */
  windowGlowHot: () =>
    new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0xffffff, emissiveIntensity: 14,
      roughness: 1, metalness: 0,
    }),
  glass: () =>
    new THREE.MeshPhysicalMaterial({
      color: PAL.glassTint, roughness: 0.05, metalness: 0, transmission: 0.97,
      thickness: 0.004, transparent: true, opacity: 0.14, ior: 1.5,
      side: THREE.DoubleSide, depthWrite: false,
    }),
  screenMesh: () =>
    new THREE.MeshStandardMaterial({
      map: T.screenMesh(), transparent: true, alphaTest: 0.25, roughness: 0.8,
      metalness: 0.1, side: THREE.DoubleSide, color: 0x33363a,
    }),

  // ── crane / lifting ──────────────────────────────────────────────────────
  craneOrange: () =>
    new THREE.MeshStandardMaterial({
      map: T.weatheredPaint(PAL.craneOrange), roughness: 0.66, metalness: 0.16,
    }),
  craneOrangeDark: () =>
    new THREE.MeshStandardMaterial({ color: PAL.craneOrangeDark, roughness: 0.7, metalness: 0.16 }),
  jibOrange: () =>
    new THREE.MeshStandardMaterial({
      map: T.weatheredPaint(PAL.jibOrange), roughness: 0.68, metalness: 0.14,
    }),
  hoistYellow: () =>
    new THREE.MeshStandardMaterial({ color: PAL.hoistYellow, roughness: 0.55, metalness: 0.2 }),
  chain: () =>
    new THREE.MeshStandardMaterial({ color: PAL.chainSteel, roughness: 0.42, metalness: 0.9 }),

  // ── robots ───────────────────────────────────────────────────────────────
  fanucYellow: () =>
    new THREE.MeshStandardMaterial({
      map: T.paintedMetal(PAL.fanucYellow), roughness: 0.42, metalness: 0.12, envMapIntensity: 1.1,
    }),
  fanucYellowDark: () =>
    new THREE.MeshStandardMaterial({ color: PAL.fanucYellowDark, roughness: 0.48, metalness: 0.12 }),
  robotBlack: () =>
    new THREE.MeshStandardMaterial({ color: PAL.robotBlack, roughness: 0.4, metalness: 0.32 }),
  robotDarkGrey: () =>
    new THREE.MeshStandardMaterial({ color: PAL.robotDarkGrey, roughness: 0.55, metalness: 0.5 }),
  robotRed: () =>
    new THREE.MeshStandardMaterial({ color: PAL.robotRed, roughness: 0.38, metalness: 0.2 }),
  robotBlue: () =>
    new THREE.MeshStandardMaterial({ color: PAL.robotBlue, roughness: 0.4, metalness: 0.3 }),
  dressHose: () =>
    new THREE.MeshStandardMaterial({ color: PAL.dressHose, roughness: 0.78, metalness: 0.02 }),
  pedestal: () =>
    new THREE.MeshStandardMaterial({
      map: T.paintedMetal(PAL.pedestalCream), roughness: 0.62, metalness: 0.06,
    }),
  warningDecal: () =>
    new THREE.MeshBasicMaterial({ map: T.decalWarning(), transparent: true, alphaTest: 0.3 }),

  // ── machinery ────────────────────────────────────────────────────────────
  machineIvory: () =>
    new THREE.MeshStandardMaterial({
      map: T.paintedMetal(PAL.machineIvory), roughness: 0.55, metalness: 0.12,
    }),
  machineIvoryDark: () =>
    new THREE.MeshStandardMaterial({ color: PAL.machineIvoryDark, roughness: 0.6, metalness: 0.12 }),
  cncCharcoal: () =>
    new THREE.MeshStandardMaterial({
      map: T.paintedMetal(PAL.cncCharcoal), roughness: 0.44, metalness: 0.3,
    }),
  cncBlack: () =>
    new THREE.MeshStandardMaterial({ color: PAL.cncBlack, roughness: 0.36, metalness: 0.35 }),
  machineMint: () =>
    new THREE.MeshStandardMaterial({
      map: T.paintedMetal(PAL.machineMint), roughness: 0.6, metalness: 0.1,
    }),
  machineMintDark: () =>
    new THREE.MeshStandardMaterial({ color: PAL.machineMintDark, roughness: 0.64, metalness: 0.1 }),
  shelfGreen: () =>
    new THREE.MeshStandardMaterial({
      map: T.paintedMetal(PAL.shelfGreen), roughness: 0.64, metalness: 0.1,
    }),
  shelfGreenDark: () =>
    new THREE.MeshStandardMaterial({ color: PAL.shelfGreenDark, roughness: 0.66, metalness: 0.1 }),
  cageGreen: () =>
    new THREE.MeshStandardMaterial({ color: PAL.cageGreen, roughness: 0.5, metalness: 0.4 }),
  /** Wire-mesh panel for roll cages and light fencing (alpha-tested plane). */
  cageMesh: () =>
    new THREE.MeshStandardMaterial({
      color: PAL.cageGreen, map: T.meshAlpha(10, 2), alphaMap: T.meshAlpha(10, 2),
      transparent: true, alphaTest: 0.4, side: THREE.DoubleSide,
      roughness: 0.5, metalness: 0.4,
    }),

  // ── metals ───────────────────────────────────────────────────────────────
  /** Polished conveyor rollers — the brightest thing in the foreground. */
  rollerAlu: () =>
    new THREE.MeshStandardMaterial({
      color: PAL.aluminium, roughnessMap: T.alumRough(), roughness: 0.85,
      metalness: 0.96, envMapIntensity: 1.25,
    }),
  aluExtrusion: () =>
    new THREE.MeshStandardMaterial({
      map: T.extrusionFace(), roughness: 0.44, metalness: 0.82, envMapIntensity: 1.0,
    }),
  aluPlain: () =>
    new THREE.MeshStandardMaterial({ color: PAL.aluExtrusion, roughness: 0.45, metalness: 0.8 }),
  steelBrushed: () =>
    new THREE.MeshStandardMaterial({
      map: T.brushedSteel(), roughness: 0.38, metalness: 0.9, envMapIntensity: 1.1,
    }),
  steelDark: () =>
    new THREE.MeshStandardMaterial({ color: PAL.steelDark, roughness: 0.5, metalness: 0.75 }),
  galv: () =>
    new THREE.MeshStandardMaterial({ color: PAL.galv, roughness: 0.62, metalness: 0.45 }),
  checkerPlate: () =>
    new THREE.MeshStandardMaterial({ map: T.checkerPlate(), roughness: 0.55, metalness: 0.7 }),
  perforated: () =>
    new THREE.MeshStandardMaterial({
      color: 0xd7dad9, alphaMap: T.perforatedAlpha(), transparent: true, alphaTest: 0.5,
      side: THREE.DoubleSide, roughness: 0.72, metalness: 0.25,
    }),

  // ── props ────────────────────────────────────────────────────────────────
  cardboard: () =>
    new THREE.MeshStandardMaterial({ map: T.cardboard(), roughness: 0.94, metalness: 0 }),
  wood: () =>
    new THREE.MeshStandardMaterial({ map: T.timber(PAL.wood), roughness: 0.85, metalness: 0 }),
  plywood: () =>
    new THREE.MeshStandardMaterial({ map: T.timber(PAL.plywood), roughness: 0.82, metalness: 0 }),
  coneOrange: () =>
    new THREE.MeshStandardMaterial({ color: PAL.coneOrange, roughness: 0.55, metalness: 0 }),
  coneBand: () =>
    new THREE.MeshStandardMaterial({ color: PAL.coneBand, roughness: 0.35, metalness: 0.1 }),
  helmetOrange: () =>
    new THREE.MeshStandardMaterial({ color: PAL.helmetOrange, roughness: 0.3, metalness: 0.05 }),
  binRed: () => new THREE.MeshStandardMaterial({ color: PAL.binRed, roughness: 0.5, metalness: 0 }),
  binYellow: () => new THREE.MeshStandardMaterial({ color: PAL.binYellow, roughness: 0.5, metalness: 0 }),
  binBlue: () => new THREE.MeshStandardMaterial({ color: PAL.binBlue, roughness: 0.5, metalness: 0 }),
  binBlack: () => new THREE.MeshStandardMaterial({ color: PAL.binBlack, roughness: 0.62, metalness: 0.05 }),
  tarpBlue: () => new THREE.MeshStandardMaterial({ color: PAL.tarpBlue, roughness: 0.82, metalness: 0 }),
  cableBlack: () => new THREE.MeshStandardMaterial({ color: PAL.cableBlack, roughness: 0.62, metalness: 0.08 }),
  airPipe: () => new THREE.MeshStandardMaterial({ color: PAL.airPipeBlue, roughness: 0.4, metalness: 0.3 }),
  whitePipe: () => new THREE.MeshStandardMaterial({ color: PAL.waterPipeWhite, roughness: 0.6, metalness: 0.2 }),
  hoseReel: () => new THREE.MeshStandardMaterial({ color: PAL.hoseReelTeal, roughness: 0.6, metalness: 0.25 }),
  extinguisher: () => new THREE.MeshStandardMaterial({ color: PAL.extinguisherRed, roughness: 0.32, metalness: 0.25 }),
  plasticWhite: () => new THREE.MeshStandardMaterial({ color: 0xefece4, roughness: 0.5, metalness: 0 }),
  plasticDark: () => new THREE.MeshStandardMaterial({ color: 0x2e3033, roughness: 0.45, metalness: 0.05 }),
  /** Translucent vinyl sheeting / machine dust covers. */
  vinyl: () =>
    new THREE.MeshPhysicalMaterial({
      color: 0xf0f2f0, roughness: 0.35, metalness: 0, transmission: 0.55,
      thickness: 0.01, transparent: true, opacity: 0.62, side: THREE.DoubleSide,
    }),
  rubberBlack: () => new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.85, metalness: 0 }),

  // ── signage & emissive ───────────────────────────────────────────────────
  signExtinguisher: () =>
    new THREE.MeshStandardMaterial({ map: T.signExtinguisher(), roughness: 0.5, metalness: 0, side: THREE.DoubleSide }),
  signExit: () =>
    new THREE.MeshStandardMaterial({
      map: T.signExit(), emissiveMap: T.signExit(), emissive: 0xffffff,
      emissiveIntensity: 1.6, roughness: 0.5, metalness: 0, side: THREE.DoubleSide,
    }),
  clockFace: () =>
    new THREE.MeshStandardMaterial({ map: T.clockFace(), roughness: 0.4, metalness: 0 }),
  whiteboard: () =>
    new THREE.MeshStandardMaterial({ map: T.whiteboard(), roughness: 0.25, metalness: 0 }),
  paper: () =>
    new THREE.MeshStandardMaterial({ map: T.paperSheet(1), roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
  /** Fluorescent tube / LED batten face. */
  lampWhite: () =>
    new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: PAL.emissiveLamp, emissiveIntensity: 3.4,
      roughness: 0.4, metalness: 0,
    }),
  andonRed: () => andon(0xff2a1a),
  andonYellow: () => andon(0xffc400),
  andonGreen: () => andon(0x2ade60),
};

function andon(c) {
  return new THREE.MeshStandardMaterial({
    color: c, emissive: c, emissiveIntensity: 2.2, roughness: 0.3,
    metalness: 0, transparent: true, opacity: 0.9,
  });
}

const _built = new Map();

/** Lazily-built, shared material registry. */
export const M = new Proxy(
  {},
  {
    get(_t, key) {
      if (typeof key !== 'string') return undefined;
      if (_built.has(key)) return _built.get(key);
      const make = defs[key];
      if (!make) {
        console.warn(`[materials] unknown key "${key}" — falling back to wallPlain`);
        return M.wallPlain;
      }
      const m = make();
      m.name = key;
      _built.set(key, m);
      return m;
    },
    has: (_t, key) => key in defs,
    ownKeys: () => Reflect.ownKeys(defs),
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
  },
);

/** A cached clone of `key` with a different colour — cheap one-off variants. */
export function tinted(key, color) {
  const id = `${key}#${color}`;
  if (_built.has(id)) return _built.get(id);
  const m = M[key].clone();
  m.color = new THREE.Color(color);
  m.name = id;
  _built.set(id, m);
  return m;
}

/** A cached clone of `key` with arbitrary property overrides. */
export function variant(key, patch, id = JSON.stringify(patch)) {
  const cacheId = `${key}~${id}`;
  if (_built.has(cacheId)) return _built.get(cacheId);
  const m = M[key].clone();
  Object.assign(m, patch);
  if (patch.color !== undefined) m.color = new THREE.Color(patch.color);
  if (patch.emissive !== undefined) m.emissive = new THREE.Color(patch.emissive);
  m.name = cacheId;
  _built.set(cacheId, m);
  return m;
}

/** Apply the PMREM environment map to every registered material. */
export function applyEnvironment(envTexture, intensity = 1) {
  _built.forEach((m) => {
    if ('envMap' in m) {
      m.envMap = envTexture;
      m.envMapIntensity = (m.envMapIntensity ?? 1) * intensity;
      m.needsUpdate = true;
    }
  });
}

export function disposeMaterials() {
  _built.forEach((m) => m.dispose());
  _built.clear();
}
