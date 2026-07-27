/**
 * config.js — Single source of truth for every dimension and colour in the scene.
 *
 * Coordinate system (metres):
 *   +X → right when looking down the hall,  hall centreline at X = 0
 *   +Y → up,                                floor at Y = 0
 *   +Z → toward the camera,                 the hall recedes toward -Z
 *
 * All values were derived by measuring img01.jpg: the crane girder span fixes the
 * hall width, the vanishing point (≈506, 308 px in the 960×800 frame) fixes the
 * camera pitch/yaw, and the girder's apparent height fixes its distance.
 */

// ────────────────────────────────────────────────────────────────────────────
// Palette — sRGB hex *albedo* values.
// Sampled from img01.jpg then de-exposed (the photo is a bright, high-key
// interior, so raw pixels read ~15-25 % lighter / less saturated than albedo).
// ────────────────────────────────────────────────────────────────────────────
export const PAL = {
  // ── floor ────────────────────────────────────────────────────────────────
  floorGreen: 0x5f8e6c, // main epoxy deck        (photo #86A78A lit)
  floorGreenDark: 0x5a8465, // shaded / worn patches
  floorGreenAisle: 0x6b9a78, // walkway lane, slightly lighter + glossier
  floorLine: 0xe8e6de, // painted aisle demarcation lines
  floorYellow: 0xdcc039, // yellow equipment-footprint tape
  floorTapeBlack: 0x2a2a28, // black half of hazard striping
  concreteApron: 0xbdb9ac, // unpainted strip along the walls
  concreteGrey: 0xa8a49a,

  // ── building shell ───────────────────────────────────────────────────────
  ceilingWhite: 0xd9d8d4, // warm off-white deck soffit
  ceilingBeam: 0xd4cec0, // downstand beam faces
  ceilingBeamShade: 0xc3bcab, // beam webs in shadow
  wallWhite: 0xdcdbd8, // painted wall panels
  wallPanelLine: 0xcbc4b6, // horizontal joint lines in the ribbed siding
  steelWhite: 0xd3d2cd, // painted structural steel (runways, purlins, brackets)
  steelWhiteDark: 0xc2bbaa,
  shutterGrey: 0xd3cec2, // roll-up shutter slats
  shutterHeaderGreen: 0x4f8f6a, // green header band above the shutters
  doorCream: 0xd6d0c2, // steel personnel doors
  windowFrame: 0xeae6dd, // window mullions / frames
  glassTint: 0xdfe8ee,

  // ── crane & lifting gear ─────────────────────────────────────────────────
  craneOrange: 0xf28d33, // JIS safety orange, bridge girder
  craneOrangeDark: 0xb35a10, // shaded faces / end trucks
  jibOrange: 0xef9c3e, // wall jib cranes (slightly lighter, more faded)
  hoistYellow: 0xe8b520, // chain-hoist bodies
  chainSteel: 0x5a5a5c,

  // ── robots ───────────────────────────────────────────────────────────────
  fanucYellow: 0xf2c500, // FANUC yellow           (photo #F7DA42 lit)
  fanucYellowDark: 0xcfa300, // shaded / underside faces
  robotBlack: 0x2a2a2c, // J2/J3 motor covers, cable ducts
  robotDarkGrey: 0x46484b, // machined mounting plates
  robotRed: 0xb32a22, // wrist accent rings + warning decals
  robotBlue: 0x2255aa, // solenoid manifolds, gripper frames
  dressHose: 0xe4dcc2, // corrugated cream dress-pack conduit
  pedestalCream: 0xd6d4ce, // cast robot pedestals

  // ── machinery ────────────────────────────────────────────────────────────
  machineIvory: 0xd8d6d0, // Japanese machine-tool ivory
  machineIvoryDark: 0xc5bfae,
  cncCharcoal: 0x4a4e52, // dark machining-centre covers
  cncBlack: 0x303336,
  machineMint: 0x80aa98, // older mint-green machine bases / benches
  machineMintDark: 0x6f9a88,
  shelfGreen: 0x6a9b87, // parts shelving, pigeonhole racks
  shelfGreenDark: 0x4e7a68,
  cageGreen: 0x3f9f5a, // bright green wire-mesh roll cages

  // ── metals ───────────────────────────────────────────────────────────────
  aluminium: 0xcfd3d8, // polished conveyor rollers
  aluExtrusion: 0xb9bec4, // anodised T-slot profile
  steelBrushed: 0xa9adb2, // sheet-metal workpieces
  steelDark: 0x6e7276,
  galv: 0xbec3c8,

  // ── props ────────────────────────────────────────────────────────────────
  cardboard: 0xb0906a,
  cardboardDark: 0x8f7350,
  wood: 0xc8a97b, // pallets, crates
  woodDark: 0xa28256,
  plywood: 0xc8b189,
  coneOrange: 0xe24a22,
  coneBand: 0xf2d22a,
  helmetOrange: 0xe25a1c,
  binRed: 0xc23a2a,
  binYellow: 0xe0b52a,
  binBlue: 0x2b5ea8,
  binBlack: 0x26282a,
  tarpBlue: 0x26437f,
  cableBlack: 0x1e1f21,
  airPipeBlue: 0x1e5fbf, // compressed-air lines
  waterPipeWhite: 0xd9d5cb,
  hoseReelTeal: 0x7f9c95,
  extinguisherRed: 0xc2211c,

  // ── signage ──────────────────────────────────────────────────────────────
  signRed: 0xd22f27,
  signGreen: 0x11a05a,
  signWhite: 0xf2efe8,
  emissiveLamp: 0xfffaf2,
};

// ────────────────────────────────────────────────────────────────────────────
// Geometry
// ────────────────────────────────────────────────────────────────────────────
export const CFG = {
  /** Building shell. */
  hall: {
    halfWidth: 6.5, // inner face of side walls at X = ±6.5
    zFront: 6.0, // hall stops just behind the camera
    zBack: -46.8, // far gable wall
    get length() {
      return this.zFront - this.zBack;
    },
    ceilingY: 9.6, // underside of the roof deck
    wallTopY: 9.6,
    apronWidth: 0.62, // bare-concrete strip along each wall
    apronY: 0.02,
  },

  /** Structural grid — everything on the walls & ceiling snaps to these lines. */
  bay: {
    spacing: 3.6,
    firstZ: 3.6, // Z of bay line 0; line k is at firstZ - k*spacing
    count: 14,
    /** Z of bay line k. */
    z(k) {
      return this.firstZ - k * this.spacing;
    },
    /** All bay-line Z values as an array. */
    all() {
      return Array.from({ length: this.count }, (_, k) => this.z(k));
    },
  },

  /** Wall pilasters / columns. */
  column: { width: 0.42, depth: 0.22 },

  /** Transverse downstand roof beams (the deep white beams crossing overhead). */
  roofBeam: { soffitY: 8.5, depth: 1.1, width: 0.42 },

  /** Longitudinal edge beam where the roof meets each side wall. */
  edgeBeam: { soffitY: 8.5, depth: 1.1, width: 0.34, x: 6.25 },

  /** Right/left wall glazing — two horizontal bands. */
  windows: {
    lower: { sillY: 2.35, headY: 4.05, width: 2.62, panes: 3 },
    upper: { sillY: 5.55, headY: 7.25, width: 2.62, panes: 2 },
    frameW: 0.07,
    frameD: 0.11,
    reveal: 0.09, // glass is recessed this far into the wall
  },

  /** Overhead travelling crane. */
  crane: {
    runwayX: 5.6, // centreline of each runway girder
    runwaySoffitY: 5.95,
    runwayDepth: 0.75,
    runwayFlangeW: 0.3,
    railTopY: 6.75, // top of the crane rail (bridge wheels ride here)
    bridgeZ: -8.75, // where the bridge currently sits
    girderBottomY: 6.75,
    girderTopY: 7.19,
    girderWidth: 0.38,
    endTruckLen: 1.5,
    trolleyX: -2.6, // hoist position along the bridge
    hookY: 3.8,
    festoonZOffset: -0.42, // festoon wire hangs this far behind the girder
    festoonY: 6.40,
    festoonSag: 0.42,
    festoonCount: 11,
  },

  /** Right-wall monorail runway carrying the small jib/chain hoists. */
  monorail: {
    x: 5.32,
    soffitY: 5.0,
    depth: 0.38,
    zFrom: -3.0,
    zTo: -42.0,
    hoistZ: [-6.6, -13.8, -21.0, -28.2], // trolleys parked along it
  },

  /** Wall-mounted slewing jib cranes (the big orange ones on the right). */
  jibs: [
    { z: -1.2, postTopY: 4.25, boomLen: 2.55, boomY: 3.55, swing: -0.55 },
    { z: -8.4, postTopY: 4.25, boomLen: 2.3, boomY: 3.5, swing: -0.35 },
    { z: -15.6, postTopY: 4.25, boomLen: 2.3, boomY: 3.5, swing: -0.9 },
  ],

  /** The gravity roller conveyor running down the middle of the foreground. */
  conveyor: {
    x: 3.55,
    topY: 0.9,
    width: 1.12,
    zFrom: 5.2,
    zTo: -13.4,
    rollerR: 0.024,
    rollerPitch: 0.045,
    frameH: 0.14,
    legPitch: 1.8,
    /** Aluminium-extrusion portal frames straddling the line. */
    portalsZ: [1.1, -3.4, -7.9],
  },

  /**
   * Robots. `model` picks the arm size; see equip/robot.js.
   *   pose = [J1, J2, J3, J4, J5, J6] in radians.
   *
   * Sign convention (from equip/robot.js, which builds the chain):
   *   J1 yaws about +Y — the arm's world heading is `ry + J1`;
   *   J2 is about +Z and the lower arm starts pointing straight UP, so a
   *      NEGATIVE J2 rakes it forward toward the reach direction and a positive
   *      J2 rakes it back over the waist;
   *   J3 is about +Z off the elbow and the forearm starts pointing horizontally
   *      forward, so a negative J3 drops the forearm below the horizontal;
   *   J4 rolls the forearm about its own axis;
   *   a POSITIVE J5 pitches the wrist down; J6 spins the flange (and with it the
   *      vacuum bar) about the tool axis.
   *
   * The four conveyor arms (A–D) were solved by inverse kinematics against the
   * roller bed rather than eyeballed: every one leans over the line, elbow high
   * (≈ 2.0 m, so the cream dress-pack loop clears the whole arm), forearm raking
   * down and inward, tool flange hanging near-vertical over the rollers. The
   * resulting cup-face positions — verified by forward kinematics through the
   * exact joint graph — are
   *
   *   A  (3.32, 1.15, −2.36)   0.25 m over the bed, arm heading +0.71 rad
   *   B  (3.82, 1.30, −1.05)   0.40 m over the bed, arm heading −2.70 rad
   *   C  (3.13, 1.32, −7.11)   0.42 m over the bed, arm heading +0.63 rad
   *   D  (3.90, 1.09, −6.06)   0.19 m over the bed, arm heading −2.67 rad
   *
   * with the roller crowns at y = 0.90 and the bed spanning x ∈ [2.99, 4.11].
   * A/B reach in opposite directions along Z (1.31 m apart at closest approach)
   * and C/D likewise, so no two arms — or their tools — foul each other.
   */
  robots: [
    // Foreground hero pair flanking the conveyor. A leans downstream over the
    // bed with its lower arm raked 23° forward and the tool a quarter of a metre
    // off the rollers; B is its rough mirror but reaching UPstream, standing
    // taller (18°), wrist pitched harder and the tool held higher — deliberately
    // not a mirror image of A.
    {
      id: 'A', x: 2.42, z: -1.5, ry: Math.PI * 0.52, model: 'm710', pedestal: 'cast',
      pose: [-0.92, -0.41, -0.09, 0.14, 0.90, 0.30], tool: 'barVacuum',
    },
    {
      id: 'B', x: 4.92, z: -1.5, ry: -Math.PI * 0.5, model: 'm710', pedestal: 'cast',
      pose: [-1.13, -0.32, -0.01, -0.10, 1.16, -0.65], tool: 'barVacuum',
    },
    // Second pair further down the line, posed to break the copy-paste look:
    // C is the photograph's classic parked stance — lower arm raked BACK over
    // the waist, elbow the highest of the four, forearm folded steeply down and
    // the tool held well clear of the bed; D is the opposite, a long low reach
    // with the lower arm raked 24° forward and the tool almost touching down.
    {
      id: 'C', x: 2.42, z: -6.5, ry: Math.PI * 0.5, model: 'm710', pedestal: 'cast',
      pose: [-0.94, 0.08, -0.46, 0.12, 0.92, 1.05], tool: 'barVacuum',
    },
    {
      id: 'D', x: 4.92, z: -6.5, ry: -Math.PI * 0.5, model: 'm710', pedestal: 'cast',
      pose: [-1.10, -0.42, -0.17, -0.16, 1.04, -0.20], tool: 'barVacuum',
    },
    // the big hero robot in the middle distance, holding a blue vacuum frame
    {
      id: 'E', x: 2.15, z: -12.2, ry: Math.PI * 0.62, model: 'r2000', pedestal: 'box',
      pose: [0.15, -0.95, 0.55, 0.0, 1.15, 0.25], tool: 'blueVacuumFrame',
    },
    // distant robot, mostly occluded
    {
      id: 'F', x: 1.45, z: -19.5, ry: Math.PI * 0.45, model: 'm710', pedestal: 'box',
      pose: [0.4, -0.7, 0.5, 0.0, 0.8, 0.0], tool: 'gripper',
    },
  ],

  /** Camera — reproduces the photograph's viewpoint. */
  camera: {
    position: [3.15, 4.32, 3.6],
    yaw: 0.0384, // +2.2°, camera turned slightly left of the hall axis
    pitch: -0.1327, // -7.6°, looking down
    /** Vertical FOV that reproduces the photo at its native 4:5 aspect. */
    photoVFov: 60.4,
    photoAspect: 960 / 800,
    /** Comfortable FOV for wide screens (keeps a similar horizontal coverage). */
    freeVFov: 47,
    near: 0.05,
    far: 200,
  },

  /** Lighting. */
  light: {
    sunDir: [-0.62, -0.52, -0.32], // daylight streaming in through the right windows
    sunColor: 0xfffaf0,
    sunIntensity: 2.95,
    skyColor: 0xf2f6ff,
    groundColor: 0x7d9a80,
    hemiIntensity: 0.32,
    ambientIntensity: 0.14,
    windowLightIntensity: 3.7,
    fixtureIntensity: 1.4,
    exposure: 0.48,
  },

  /** Ceiling light fixtures. */
  fixtures: {
    battenX: [-3.4, 3.4],
    battenY: 8.32,
    battenLen: 2.4,
    domeX: 0,
    domeY: 8.15,
    domeSpacing: 7.2,
  },

  /** Rendering quality knobs (overridable from the UI). */
  quality: {
    shadowMapSize: 4096,
    anisotropy: 8,
    ssao: true,
    bloom: true,
    bloomStrength: 0.09,
    bloomRadius: 0.6,
    bloomThreshold: 0.985,
  },
};

/** Deterministic layout seed so the scene is identical on every reload. */
export const SEED = 20260727;
