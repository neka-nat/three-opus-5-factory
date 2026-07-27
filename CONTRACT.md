# Module contract

Every builder module in this project follows the same rules. Read this before
writing or changing any file under `src/`.

## Ground rules

1. **Foundation files are frozen.** `src/core/config.js`, `src/core/utils.js`,
   `src/core/textures.js`, `src/core/materials.js` already exist and are the
   shared vocabulary. Read them. Do not edit them. If you truly need a new
   material key or palette entry, add it — but never rename or remove one.
2. **One file per module.** Do not create files other than the one you were
   assigned, and never edit another module's file.
3. **Builders return, they do not add.** Every exported builder returns a
   `THREE.Object3D` (usually a `THREE.Group`) with `.name` set. `layout.js` is
   the only module that positions things in the world.
4. **Local origin convention.** Unless the doc-comment says otherwise, a
   builder's origin is the **centre of its footprint on the floor** (`y = 0` is
   the ground plane it stands on) and it faces **−Z** (down the hall, away from
   the camera). Wall-mounted builders have their origin **on the wall face**
   and face **−X** for the right wall / **+X** for the left wall — see each
   signature.
5. **Units are metres. Angles are radians.**
6. **Use the helpers.** `box/boxOn/cyl/cylX/cylZ/cylBetween/iBeam/tubeBox/
   roundedBox/corrugatedTube/catenary/cable/instance/mergeGroup/group/at/decal/
   billboard` from `core/utils.js`. Use `M.<key>` from `core/materials.js`.
   Never call `new THREE.MeshStandardMaterial` inline — add a key to
   `materials.js` or use `variant()/tinted()`.
7. **Instance anything repeated > 30×** (`instance()` from utils).
8. **Determinism.** Any randomness must come from `makeRng(seed)` with a fixed
   seed, so the scene is byte-identical on every reload.
9. **Performance budget.** The whole scene must stay under ~2.5 M triangles and
   ~900 draw calls, and hold 60 fps on integrated graphics. Keep cylinder
   segment counts low (8–16) for anything small or distant.
10. **No network, no binary assets.** Textures come from `core/textures.js`.
11. **ES modules, no TypeScript.** Import three as `import * as THREE from 'three'`
    and examples as `'three/examples/jsm/…'`.
12. **Every exported function gets a JSDoc block** stating what it models, its
    origin/orientation, and its parameters.

## The reference photograph

`img01.jpg` — a Japanese machine shop shot from an elevated platform looking
down the length of the hall. Key facts every module should respect:

- Bright, high-key, almost shadowless daylight pouring in through a two-band
  window wall on the **right** (+X). Everything is washed-out and warm-white.
- Structural steel, walls and ceiling are all the same **warm off-white/cream**.
- The **floor is green epoxy** with white painted aisle lines and yellow tape.
- The only saturated colours are: **orange** (overhead crane, jib cranes, cones,
  helmets), **FANUC yellow** (robots), **mint green** (shelving, old machine
  bases), **blue** (air pipes, gripper frames) and **red** (signs, extinguishers).
- Equipment is **used, not showroom-new**: scuffed paint, taped cables, boxes and
  clutter everywhere, cardboard on pallets, vinyl dust sheets over machines.

## World layout (from `CFG`)

```
+X → right      hall interior X ∈ [−6.5, +6.5]
+Y → up         floor at Y = 0, roof deck soffit at Y = 9.0
+Z → toward the camera; the hall recedes toward −Z (back wall at Z = −46.8)
Bay lines every 3.6 m at Z = 3.6, 0, −3.6, −7.2, … (CFG.bay.z(k))
Camera sits at (2.78, 4.32, 3.6) looking down −Z, so the RIGHT wall is close
and dominant, the LEFT side of the hall recedes into clutter.
```

---

# Module specifications

Each heading is one file. Implement **exactly** the listed exports (extra
private helpers are fine). Signatures use `(param = default)`.

---

## `src/build/shell.js`

```js
/** Floor slab + painted markings. Origin at world origin; already world-placed. */
export function buildFloor()            // → Group 'floor'
/** Both side walls + far gable wall + near return walls, with pilasters. */
export function buildWalls()            // → Group 'walls'
/** Roof deck soffit, transverse downstand beams, edge beams, purlins. */
export function buildCeiling()          // → Group 'ceiling'
```

Details:

- **Floor**: one big plane at `y=0` using `M.floor`, UV-repeated so one texture
  tile ≈ 4 m. Overlay, as separate very thin boxes/decals at y ≈ 0.004–0.01:
  - a lighter **aisle lane** (`M.floorAisle`) about 1.9 m wide running from
    `z=+5` to `z=−34`, centred near `x=−2.3`, with **white lines**
    (`M.floorLine`, 0.10 m wide) down both edges;
  - a second short aisle branch crossing at `z≈−22`;
  - **yellow tape** rectangles (`M.floorYellow`, 0.08 m wide) outlining the
    robot-cell footprint around the conveyor (roughly x ∈ [0.2, 5.0],
    z ∈ [−9, +4]) and a couple of small L-marks near the right wall;
  - **bare concrete aprons** (`M.concrete`) `CFG.hall.apronWidth` wide along
    both side walls and the back wall.
- **Walls**: 0.25 m thick boxes. Inner faces at `x = ±6.5`, back wall at
  `z = CFG.hall.zBack`. Add **pilasters** (`CFG.column`) projecting inward at
  every bay line on both walls, from `y=0` to `y=CFG.hall.wallTopY`. The window
  openings themselves are cut by *building the wall as bands*, not CSG: emit a
  sill band (y 0 → 2.3), a spandrel band (4.3 → 5.3), a head band (6.9 → 9.0)
  and vertical piers between bays — `windows.js` fills the gaps.
- **Ceiling**: deck plane at `y=CFG.hall.ceilingY` facing down (`M.ceiling`),
  UV ≈ 4 m tiles. Transverse **downstand beams** at every bay line
  (`CFG.roofBeam`: 1.1 m deep, 0.42 wide, soffit 7.9) spanning the full width —
  model them with a bottom flange slightly wider than the web so they read as
  built-up plate girders. Longitudinal **edge beams** at `x = ±CFG.edgeBeam.x`.
  Add thin **purlins** (0.12 × 0.2) every 1.2 m running along Z between the
  downstand beams, at y = 7.85.
- Everything static: merge aggressively with `mergeGroup` where materials allow.

---

## `src/build/windows.js`

```js
/**
 * One side wall's glazing: both horizontal bands, one window per bay.
 * @param {1|-1} side  +1 = right wall (+X), −1 = left wall (−X)
 */
export function buildWindowWall(side = 1)   // → Group 'windows'
```

- Uses `CFG.windows`. For each bay line in `CFG.bay.all()` (skip the first and
  last), emit a **lower window** (`CFG.windows.lower`, 3 panes: two tall fixed
  lights plus a short top-hung awning light) and an **upper clerestory window**
  (`CFG.windows.upper`, 2 panes).
- Each window = an outer frame (`M.windowFrame`, `CFG.windows.frameW` square
  section), vertical/horizontal mullions, plus **two** infill quads:
  a `M.windowGlow` quad on the *outside* face (the blown-out daylight the camera
  sees) and a faint `M.glass` quad just inside it. Recess by `CFG.windows.reveal`.
- Add a **plaster reveal** (`M.wallPlain`) around each opening so the wall reads
  as thick.
- On the right wall only, give **one** lower window (choose `k === 4`) a dark
  `M.screenMesh` insect screen, and add a slim opening restrictor arm to two others.
- Left wall: same construction, but the far-field only — the near bays on the
  left are hidden behind shelving, so it is fine to emit them all.

---

## `src/build/openings.js`

```js
/**
 * Roll-up shutter door. Origin on the floor at the centre of the opening,
 * on the wall face; the shutter faces +Z by default (rotate in layout).
 */
export function buildRollShutter(width = 4.0, height = 4.2, openFrac = 0)  // → Group
/** Steel personnel door, hinge on the left, origin at floor centre, faces +Z. */
export function buildSteelDoor(width = 0.95, height = 2.1)                 // → Group
/** Green header band + guide channels that frame a shutter opening. */
export function buildShutterSurround(width = 4.0, height = 4.2)            // → Group
```

- Shutter: slats via `M.shutter` on a box, guide channels (`M.steelWhiteDark`)
  each side, a **green header box** (`M.shutterHeader`) above, and the coiled
  roll behind the header. `openFrac` raises the curtain.
- Steel door: `M.doorCream` leaf with a recessed panel, lever handle
  (`M.steelDark`), small `M.paper` notice, kick plate, and a frame.

---

## `src/build/services.js`

```js
/** Everything hanging from the roof: cable trays, conduit, sprinkler drops. */
export function buildCeilingServices()      // → Group 'ceilingServices'
/** Linear fluorescent battens + round high-bay domes (with emissive lenses). */
export function buildLightFixtures()        // → Group 'lightFixtures'
/**
 * Pipework running along one wall: the blue compressed-air main with drops,
 * white water pipe, conduit and the wire-way. Origin at world origin.
 * @param {1|-1} side
 */
export function buildWallServices(side = 1) // → Group 'wallServices'
```

- **Light fixtures**: two rows of twin-tube battens at `CFG.fixtures.battenX`,
  `y = CFG.fixtures.battenY`, one `CFG.fixtures.battenLen` unit per bay —
  white steel body (`M.steelWhite`) + two `M.lampWhite` tubes. Plus round
  high-bay domes down the centreline every `CFG.fixtures.domeSpacing`
  (`M.steelWhite` reflector + `M.lampWhite` lens). Give each fixture a suspension
  rod up to the deck. **Do not add THREE.Light here** — `lighting.js` owns lights.
- **Wall services**: the blue air main (`M.airPipe`, ⌀0.05) at y ≈ 4.95 running
  the length of the wall at `x = side*6.28`, with a **drop leg** at every second
  bay going down to y ≈ 1.6 ending in a small filter/regulator
  (`M.aluPlain` + `M.plasticWhite`) and a coiled hose. A white pipe
  (`M.whitePipe`, ⌀0.07) alongside, and a grey wire-way (`M.steelWhiteDark`)
  at y ≈ 5.4. Include the pipe **clips/brackets** at each bay — they read
  clearly in the photo.
- **Ceiling services**: perforated cable trays (`M.perforated`) at `x = ±4.6`,
  `y = 8.3`; small conduit runs; a few `M.whitePipe` sprinkler mains with
  pendent heads.

---

## `src/equip/crane.js`

```js
/** The two runway girders + rails + wall corbels, full hall length. */
export function buildCraneRunways()   // → Group 'craneRunways'
/**
 * The orange single-girder overhead travelling crane.
 * Origin at the *centre of the bridge span, on the rail top plane* — i.e. put
 * it at (0, CFG.crane.railTopY, CFG.crane.bridgeZ). The bridge spans ±runwayX.
 * @param {number} trolleyX  hoist position along the bridge
 */
export function buildBridgeCrane(trolleyX = CFG.crane.trolleyX)  // → Group 'bridgeCrane'
```

This is the single most recognisable object in the photograph. Get it right:

- **Runway girders**: welded plate girders (`M.steelWhite`), `CFG.crane.runwayDepth`
  deep, with a top flange, bottom flange, and **vertical stiffener plates every
  1.8 m** — those stiffeners are clearly visible. Rail on top: a small
  `M.steelDark` bar. Supported on **triangular corbel brackets** off each wall
  pilaster.
- **Bridge girder**: a deep **orange box girder** (`M.craneOrange`), 0.38 wide,
  `girderTopY − girderBottomY` deep, spanning the full runway-to-runway distance.
  Slightly **haunched** — deeper in the middle third. Add a top walkway lip and
  bottom flange plate a little wider than the web.
- **Signage on the girder web** (facing the camera, i.e. +Z face): five square
  white panels reading **安 / 全 / [green cross] / 第 / 一**, evenly spaced across
  the middle of the span. Use `billboard()` + `variant('signExit', …)`? No —
  use a `MeshStandardMaterial` built from `T.signGirderPanel('安')` etc. Add
  a material key if needed. Panels ≈ 0.28 m square, standing ~2 mm proud.
- **End trucks**: orange box carriages (`M.craneOrangeDark` sides,
  `M.craneOrange` top) at each end, `CFG.crane.endTruckLen` long, with four
  visible wheels each and a drive motor/gearbox lump on one.
- **Hoist trolley** at `trolleyX`: a small carriage riding the *bottom flange*
  of the bridge, `M.hoistYellow` body, a black gear housing, the drum, and
  below it the hoist block. Hang a **load chain** (`M.chain`, thin `cable()`
  down to `CFG.crane.hookY`) ending in a hook block with an orange hook, plus a
  translucent **chain bucket**. Hang a **pendant control** on a separate cable:
  a small black handset (`M.plasticDark`) at about y = 1.8.
- **Festoon**: a taut messenger wire along the girder at
  `y = CFG.crane.festoonY`, `z = bridgeZ + CFG.crane.festoonZOffset`, and
  `CFG.crane.festoonCount` **catenary loops** of flat cable hanging from it
  (`catenary()` + `cable()`, sag `CFG.crane.festoonSag`, `M.cableBlack`),
  bunched toward the trolley end. Small orange trolley clips at each hanger.
- Add the **runway conductor bar** (a thin orange/white rail) on the inside face
  of the right runway girder with a collector arm from the crane.

---

## `src/equip/jibcrane.js`

```js
/**
 * Wall-mounted slewing jib crane, orange. Origin at the foot of the post, on
 * the wall face; the post rises +Y and the boom projects toward −X (i.e. into
 * the hall from the RIGHT wall). Mirror in layout for the left wall.
 * @param {object} o {postTopY, boomLen, boomY, swing}  swing = boom yaw (rad)
 */
export function buildJibCrane(o = {})     // → Group 'jibCrane'
/** The right-wall monorail runway beam (I-section, on wall brackets). */
export function buildMonorail()           // → Group 'monorail'
/** A chain hoist + trolley that hangs under a monorail/jib boom. Origin = top. */
export function buildChainHoist(dropTo = 1.2)  // → Group 'chainHoist'
```

- The photo's jib cranes are chunky **orange** square-section posts with a
  horizontal boom, a **cylindrical slewing housing** where the boom meets the
  post, a diagonal tie back to the post top, and a yellow/orange chain hoist
  hanging from a trolley on the boom. Wall brackets top and bottom.
- `buildMonorail` spans `CFG.monorail.zFrom → zTo` at `x = CFG.monorail.x`,
  soffit `CFG.monorail.soffitY`, `M.steelWhite`, hung on **angled brackets**
  from the wall pilasters every bay. Add the little white **festoon track**
  (a C-channel with hanger clips) alongside it.
- `buildChainHoist`: `M.hoistYellow` body, black motor, chain to a hook block,
  a hanging pendant, and the chain container.

---

## `src/equip/robot.js`

```js
/**
 * Parametric FANUC-style 6-axis articulated arm.
 * Origin = centre of the base mounting face, arm points toward +X at pose 0.
 * @param {object} o
 *   model: 'm710' | 'r2000'         size class (m710 ≈ 2.05 m reach, slim;
 *                                    r2000 ≈ 2.65 m reach, chunkier)
 *   pose:  [j1,j2,j3,j4,j5,j6]      radians
 *   tool:  'barVacuum'|'blueVacuumFrame'|'gripper'|'none'
 *   dressPack: boolean              default true
 *   seed: number
 * @returns {THREE.Group} with `.userData.joints = {j1..j6}` (the pivot Objects)
 *          and `.userData.flange` (an Object3D at the tool flange) so the arm
 *          can be re-posed or animated later.
 */
export function buildRobot(o = {})   // → Group 'robot'

/** The cream cast pedestal robots stand on. Origin on the floor. */
export function buildRobotPedestal(kind = 'cast', h = 0.62)  // → Group
```

Anatomy to reproduce (measure against the crops — this is the second most
recognisable object after the crane):

- **J1 base**: a yellow ring/plinth on a dark machined plate (`M.robotDarkGrey`)
  with visible bolt heads, plus a **cross-shaped cast foot**. A black cable-entry
  box on the back.
- **J1 body** (rotates about Y): a barrel/teardrop casting, yellow, wider at the
  bottom, with a black side cover.
- **J2 lower arm** (rotates about the horizontal axis): a tapered box-section
  arm, yellow, with a **large black cylindrical motor cover** on one side at the
  J2 axis and a **yellow warning triangle decal** (`M.warningDecal`) plus a small
  red label on the body.
- **J3 elbow**: a yellow casting with a black motor cover on the opposite side.
- **J3 upper arm**: a long slender tube/box tapering toward the wrist, yellow,
  with a black cable duct running along the top.
- **J4 roll**: a slim cylindrical section, yellow, with a thin **red accent ring**
  at the wrist joint (visible in the photo).
- **J5/J6 wrist**: compact yellow housing, red ring, and a bright steel tool
  flange (`M.steelBrushed`) with bolt circle.
- **Dress pack** (`dressPack: true`): the signature detail. A fat **cream
  corrugated conduit** (`corrugatedTube`, radius ≈ 0.055, `M.dressHose`) leaving
  a black bracket at the back of the J1 body, arcing **high above** the arm in a
  generous loop, and clamping to a black bracket near the wrist. On the bigger
  robot emit **two** parallel conduits held by a shared black yoke — that is
  exactly what the photo shows. Route with `CatmullRomCurve3` control points
  derived from the *posed* joint world positions.
- **Tools**:
  - `barVacuum` — a horizontal aluminium bar with 4–6 small suction cups
    hanging below, plus a small blue solenoid manifold (`M.robotBlue`) and a
    green mounting plate.
  - `blueVacuumFrame` — a large **blue** rectangular frame (`M.robotBlue`,
    ~1.1 × 0.7 m) of extrusion, carrying a grid of ~12 grey suction cups and a
    green tray edge; this is the gripper on the hero robot in the photo.
  - `gripper` — a simple two-finger pneumatic gripper.
- **Pedestals**: `'cast'` is the cream, softly-tapered cast pedestal with a
  concave fillet and a rounded top plate (photo foreground); `'box'` is a plain
  ivory box pedestal with a dark top plate.
- Keep it to **≤ 45 k triangles** per robot.

---

## `src/equip/conveyor.js`

```js
/**
 * Gravity roller conveyor running along Z. Origin at the floor, at the centre
 * of the run; rollers sit at CFG.conveyor.topY.
 * @param {object} o {zFrom, zTo, width, topY, withLegs, centreSlot}
 */
export function buildRollerConveyor(o = {})   // → Group 'rollerConveyor'
/** Aluminium-extrusion portal straddling the line. Origin on the floor centre. */
export function buildPortalFrame(width = 2.6, height = 2.1, depth = 0.16)  // → Group
/** A stack/rack of aluminium extrusion guarding, used around the cell. */
export function buildExtrusionFrame(w, h, d)  // → Group
/** A flat brushed-steel sheet-metal workpiece (the parts being handled). */
export function buildSheetPart(w = 1.05, h = 0.6, t = 0.012, standing = false)  // → Mesh|Group
```

- The rollers are the visual highlight of the foreground: **polished aluminium**
  (`M.rollerAlu`), ⌀`2*CFG.conveyor.rollerR`, pitch `CFG.conveyor.rollerPitch`,
  spanning the width, built as **one InstancedMesh** for the whole run.
  Give each roller a tiny random rotation from a seeded rng.
- Side frames: a cream painted channel (`M.machineIvory`) outboard of a silver
  **aluminium extrusion rail** (`M.aluExtrusion`) at the top edge, with bolt
  bosses. Legs (`M.aluExtrusion` 60 × 60) every `CFG.conveyor.legPitch` with
  levelling feet, plus a lower cross-brace.
- `centreSlot: true` adds the dark longitudinal gap with a black belt and a
  small yellow-topped stopper/sensor block at one point — visible in the photo.
- Add photo-eye sensor brackets, a couple of cable festoons under the frame, and
  a yellow guide-rail strip on the outside of one frame.

---

## `src/equip/machines.js`

```js
/** Charcoal CNC machining centre with an enclosure, door window and chip conveyor. */
export function buildMachiningCentre(o = {})   // → Group  (default ≈ 3.2 × 2.6 × 2.4)
/** Ivory sheet-metal machine cabinet — the generic Japanese machine-tool box. */
export function buildMachineCabinet(w = 1.4, h = 1.9, d = 1.1, o = {})  // → Group
/** Free-standing electrical control cabinet with a door, louvres and a handle. */
export function buildControlCabinet(w = 0.8, h = 1.9, d = 0.5)          // → Group
/** Andon stack light: 3 lenses + pole. Origin at the bottom of the pole. */
export function buildAndon(h = 0.55)                                    // → Group
/** Pendant HMI / operator panel on a swing arm. Origin at the mount point. */
export function buildOperatorPanel()                                    // → Group
/** Old mint-green bench machine (small press / grinder) with a control box. */
export function buildMintMachine(w = 1.1, h = 1.35, d = 0.8)            // → Group
/** A machine draped in a translucent vinyl dust sheet. */
export function buildDraped(w, h, d, seed = 1)                          // → Group
```

- Machining centre: `M.cncCharcoal` body, `M.cncBlack` recesses, a sliding door
  with a dark **window** (`M.glass` over `M.cncBlack`), a control pendant, an
  `buildAndon()` on top, coolant/chip units at the base, warning labels
  (`M.warningDecal`), and a fat coolant hose.
- Machine cabinet: rounded top edge, a recessed door with a **latch**, louvred
  vents, kick plinth (`M.machineIvoryDark`), and a small `M.paper` label.
- `buildDraped` uses `M.vinyl` over a coarse, wrinkled box — displace a
  segmented BoxGeometry's vertices with seeded noise so it reads as loose film.

---

## `src/equip/furniture.js`

```js
export function buildWorkbench(w = 1.8, d = 0.75, h = 0.82, o = {})  // → Group
export function buildDesk(w = 1.4, d = 0.7, o = {})                  // → Group (with monitor/keyboard if o.monitor)
export function buildStorageCabinet(w = 0.9, h = 1.85, d = 0.45)     // → Group (with binder shelves)
export function buildShelfRack(bays = 4, cols = 6, rows = 4)         // → Group  mint pigeon-hole parts rack
export function buildBinRack(cols = 8, rows = 6)                     // → Group  frame full of small dark bins
export function buildRollCage(w = 0.8, d = 1.1, h = 1.7)             // → Group  green wire-mesh trolley (かご車)
export function buildOfficeChair()                                   // → Group
export function buildStool()                                         // → Group
export function buildWhiteboardStand(w = 1.2, h = 0.9)               // → Group
export function buildTrolley(w = 0.6, d = 0.9)                       // → Group  mint 2-shelf hand cart
export function buildPartitionScreen(w = 1.6, h = 1.7)               // → Group  white vinyl partition on a frame
```

- Everything on the left half of the photo is this stuff, seen small and
  cluttered. Favour **silhouette accuracy over detail**: correct proportions,
  correct colour, a few strong lines.
- `buildShelfRack`: `M.shelfGreen` frame, open pigeon-holes, and a seeded mix of
  cardboard boxes / paper stacks / small parts filling some cells (leave others
  empty — the photo is irregular).
- `buildBinRack`: `M.shelfGreenDark` frame with a grid of small `M.binBlack`
  bins, a few `M.binRed` and `M.binBlue` amongst them.
- `buildRollCage`: `M.cageGreen` tube frame + `M.cageMesh` panels on three sides,
  four castors, and optional cardboard inside.
- Desks carry a black flat monitor (`M.plasticDark` + a dark screen), a keyboard,
  and a couple of `M.paper` sheets.

---

## `src/props/props.js`

All origins on the floor unless noted. Use `makeRng` for all variation.

```js
export function buildTrafficCone(h = 0.7)                    // orange, 2 yellow bands, black square base
export function buildConeBar(len = 1.6)                      // yellow/black striped bar between two cones
export function buildPallet(w = 1.1, d = 1.1)                // timber, 9-block JIS pallet
export function buildCardboardBox(w, h, d, seed = 1)         // taped kraft box with a label
export function buildBoxStack(seed = 1, n = 4)               // irregular stack of boxes
export function buildWoodCrate(w = 1.2, h = 0.9, d = 0.9)    // plywood crate / packing case
export function buildPlasticBin(w = 0.5, d = 0.35, h = 0.22, colorKey = 'binRed')
export function buildFireExtinguisher()                      // red bottle on a red circular stand + sign post
export function buildHoseReel(r = 0.42)                      // wall-mounted teal spiral hose reel — origin ON THE WALL, faces −X
export function buildHelmetRack(n = 6)                       // wall board with orange helmets + coiled cables — origin ON THE WALL, faces +X
export function buildCableCoil(r = 0.28)                     // coiled black cable
export function buildRingBlower()                            // the silver side-channel blower + volute + flex hose
export function buildFlexHose(from, to, r = 0.06, sag = 0.35)// corrugated hose between two THREE.Vector3
export function buildGasCylinder(h = 1.35, colorKey = 'cageGreen')
export function buildDrum(h = 0.88)                          // 200 L drum
export function buildTarpBundle(seed = 1)                    // crumpled blue tarp on the floor
export function buildStepPlatform(w = 0.6, d = 0.4, h = 0.2) // perforated steel step
export function buildBollard(h = 0.9)                        // yellow/black striped post
export function buildLaptop()                                // open laptop, origin at its base centre
export function buildPaperStack(n = 3)
```

---

## `src/props/signs.js`

```js
/** Origin ON the wall face, sign faces −X (right wall). Mirror for the left. */
export function buildExtinguisherSign(w = 0.34, h = 0.42)   // 消火器, red
/** Ceiling/wall-hung 非常口 exit sign, double-sided, with a bracket. */
export function buildExitSign(w = 0.4, h = 0.2)
/** Round analogue wall clock. */
export function buildWallClock(r = 0.22)
/** Small notice / nameplate plaque. */
export function buildNotice(w = 0.3, h = 0.21, title = '注意')
/** A hanging aisle sign board suspended from the roof on two rods. */
export function buildHangingSign(w = 0.9, h = 0.3)
/** The five 安全第一 panels for the crane girder; returns them in a row group. */
export function buildSafetyPanels(span = 4.0, size = 0.28)
```

---

## `src/scene/lighting.js`

```js
/**
 * All THREE.Light objects + the PMREM environment.
 * @returns {{group: THREE.Group, sun: THREE.DirectionalLight,
 *            update(dt: number): void, setShadows(on: boolean): void}}
 */
export function buildLighting(renderer, scene)
```

- Reproduce a bright, nearly shadowless, warm-white interior:
  - `HemisphereLight` (`CFG.light.skyColor` / `groundColor`, `hemiIntensity`).
  - `AmbientLight` at `ambientIntensity`.
  - One shadow-casting `DirectionalLight` (`sunColor`, `sunIntensity`) aimed
    along `CFG.light.sunDir` — it comes **through the right window wall**, so
    position it out beyond +X and above. Shadow camera must be an orthographic
    box tight around the foreground cell (roughly x ∈ [−8, 8], z ∈ [−26, 7],
    y ∈ [0, 11]); `shadowMapSize` from `CFG.quality`, `bias ≈ −0.0006`,
    `normalBias ≈ 0.035`.
  - `RectAreaLight`s (remember `RectAreaLightUniformsLib.init()`) filling the
    right wall's lower window openings — 4 near ones is enough — pointing −X.
  - A soft fill `DirectionalLight` from the left at ~0.25 intensity, no shadows.
  - Cheap `PointLight`s under a few ceiling fixtures (low intensity, no shadow).
- Build the **environment map** with `PMREMGenerator` from a small procedural
  room scene (bright white ceiling, bright +X wall, green floor) and assign it
  to `scene.environment`; call `applyEnvironment()` from `materials.js`.
- `update(dt)` may gently vary nothing (keep it a no-op) — it exists so main.js
  has a stable API.

---

## `src/scene/postfx.js`

```js
/**
 * @returns {{composer, render(dt), setSize(w,h), setSSAO(on), setBloom(on),
 *            setToneMapping(name), dispose()}}
 */
export function makeComposer(renderer, scene, camera)
```

- `EffectComposer` → `RenderPass` → `GTAOPass` (fall back to `SSAOPass` if
  unavailable) → `UnrealBloomPass` (subtle: `CFG.quality.bloom*`) →
  `OutputPass` → `SMAAPass`. Must degrade gracefully: if a pass fails to
  construct, log a warning and continue without it.
- `setToneMapping('neutral'|'aces'|'agx'|'linear')` sets `renderer.toneMapping`.

---

## `src/scene/camera.js`

```js
/**
 * @returns {{camera, controls, setView(name), setPhotoMatch(on), isPhoto: boolean,
 *            resize(w,h), update(dt)}}
 */
export function setupCamera(renderer, domElement)
```

- Default camera from `CFG.camera`: position, and a target derived from
  `yaw`/`pitch` (Euler order `'YXZ'`).
- **Photo-match mode**: FOV = `CFG.camera.photoVFov`, and the *viewport is
  letterboxed* to `CFG.camera.photoAspect` — `resize()` must return the pixel
  rect so `main.js` can size the renderer's viewport/scissor and drive the
  `#matte` DOM elements. Return that rect on `resize()` as
  `{x, y, w, h}` in CSS pixels.
- Free mode: FOV = `CFG.camera.freeVFov`, full viewport, `OrbitControls` with
  damping, `maxPolarAngle ≈ 1.55`, target clamped inside the hall.
- `setView('photo'|'aisle'|'cell'|'crane'|'top')` tweens position/target over
  ~0.9 s with an ease-in-out; pick framings that show off the reconstruction.

---

## `src/scene/layout.js`

```js
/** Assemble the entire factory. @returns {THREE.Group} */
export function buildFactory()
```

The composition brief is in the "World layout" section above and in
`LAYOUT.md` (read it — it lists every object's world position). Follow it, then
add the incidental clutter that makes the photo believable.

---

## `src/main.js`

Bootstrap: renderer (`WebGLRenderer` antialias false — SMAA handles it,
`powerPreference:'high-performance'`, `outputColorSpace: SRGBColorSpace`,
`toneMapping` neutral, `toneMappingExposure: CFG.light.exposure`,
`shadowMap.enabled`, `PCFSoftShadowMap`), scene, `buildFactory()`,
`buildLighting()`, `setupCamera()`, `makeComposer()`, resize handling,
the render loop, the HUD wiring described by the ids in `index.html`, and the
keyboard shortcuts (`1`–`5`, `R`, `H`). Hide `#loader` when the first frame is
rendered. Update `#s-fps`, `#s-tri`, `#s-calls` twice a second.
