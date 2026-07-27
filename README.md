# 工場 3D — photo-faithful factory reconstruction

A three.js reconstruction of the Japanese machine shop photographed in
`img01.jpg`, built to match the photograph as closely as the medium allows —
same hall geometry, same camera, same light, same equipment, same clutter.

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # static bundle in dist/
```

Everything is procedural. There are no binary assets: all ~30 textures are drawn
on a `<canvas>` at load time, so the scene runs offline and the repository stays
text-only apart from the reference photograph itself.

---

## What is in the scene

| | |
|---|---|
| **Shell** | 13 m × 53 m × 9.6 m hall, green epoxy deck with painted aisle lanes and yellow cell tape, bare concrete aprons, pilastered side walls, two-band glazing on both walls, deep transverse downstand beams |
| **Crane** | Orange single-girder overhead travelling crane with 安 / 全 / ✚ / 第 / 一 panels on the web, welded plate runways with stiffeners on wall corbels, orange end trucks, a yellow electric chain hoist with load chain, hook block, chain bucket and pendant, and an eleven-loop catenary festoon |
| **Robots** | Six FANUC-style six-axis arms (M-710iC and R-2000iC proportions) on cream cast pedestals, with black J2/J3 motor covers, red wrist rings, warning decals, and the signature cream corrugated dress-pack conduit arcing over each arm |
| **Line** | Gravity roller conveyor — one instanced mesh of polished aluminium rollers — with a centre belt slot, stopper block, cream channel frames, T-slot extrusion rails, portal frames and brushed sheet-metal blanks |
| **Right side** | Wall-mounted orange slewing jib cranes, monorail runway with parked chain hoists, blue compressed-air main with drop legs, 消火器 sign, extinguisher, teal hose reel, 非常口 exit signs, steel doors |
| **Left side** | Mint pigeon-hole parts racks, bin racks, green wire roll cages, desks with monitors, whiteboards, cabinets, trolleys, pallets, cartons, traffic cones and a striped cone bar |
| **Mid line** | Charcoal CNC machining centre with andon stack light, a run of ivory machine cabinets, control cabinets, vinyl-draped machines, gas cylinders |

---

## How the camera and hall were derived

The geometry is not eyeballed. It is solved from measurements of the photograph.

1. **Vanishing point.** Intersecting the right wall's ceiling line and floor line
   in the 960 × 800 frame puts the VP at ≈ (506, 308). With the frame's vertical
   FOV of 60.4° (f ≈ 687 px) that is a **2.2° left yaw and a 7.6° downward
   pitch**. The render reproduces it exactly: projecting the −Z direction through
   `CFG.camera` lands on (506.6, 308.3).

2. **Camera X and crane distance.** Two independent measurements pin them down:
   - the right wall's floor line fixes `hallHalfWidth − cameraX = 3.32 m`;
   - the crane girder spans 623 px with its midpoint at x = 334, which fixes
     `runwayX / depth = 0.4534` and `cameraX / depth = 0.252`.

   Holding the half-width at 6.5 m gives **cameraX 3.15 m, crane depth 12.35 m**
   → `bridgeZ = −8.75`. Re-solving from the final render's own girder
   reproduces the config to within 4 cm.

3. **Crane height and depth.** The girder centre sits 146 px above the VP, which
   at 12.35 m puts it at **Y ≈ 6.97 m** — 1.2 m higher than a first estimate, and
   the reason the hall is 9.6 m rather than 9.0 m tall. Its 24 px on-screen depth
   fixes the girder at **0.44 m deep**, not the 0.85 m first modelled.

`tools/` holds the harness used to close the loop: `shot.py` captures a headless
render letterboxed to the photograph's exact 4:5 frame, `compare.py` reports
per-region colour deltas against `img01.jpg`, and `sweep.py` re-renders the
scene under a list of lighting variants in one browser session and scores each.

**Measured agreement with the photograph** (mean per-region colour distance,
lower is better): **61.5 → 22.8** over the tuning passes, with overall frame
colour matching to **Δ 4.7** (`#B2AE97` vs the photograph's `#B4B1A0`) and the
blown-out right-hand glazing clipping to 14 k pure-white pixels against the
photograph's 15 k.

---

## Controls

The page opens in **photo match**: the viewport is letterboxed to the
photograph's 4:5 aspect and the camera is locked to its exact pose, so the
reference overlay lines up pixel for pixel. Because the camera cannot move
there, that first frame looks like a still image — **just drag anywhere and you
drop straight into free orbit**, with the same gesture doing the first rotation.

| | |
|---|---|
| drag / wheel / ⇧+drag | orbit, zoom, pan — dragging in photo match switches to free orbit |
| `O` / `P` | free orbit / photo match |
| `1`–`5` | photo · aisle · cell · crane · overhead views |
| `R` | fade the reference photograph over the render |
| `H` | hide the UI |

**Free orbit** widens the FOV, drops the letterbox and unlocks `OrbitControls`
with the target clamped inside the hall. The Options panel exposes SSAO, bloom,
shadows, exposure and the tone-mapping operator.

---

## Layout of the source

```
src/
  core/      config.js      every dimension + the 90-entry palette, single source of truth
             utils.js       25 geometry helpers (box/cyl/iBeam/tubeBox/corrugatedTube/catenary/instance…)
             textures.js    ~30 procedural canvas textures — epoxy crazing, 安全第一 panels,
                            消火器 / 非常口 signs, hazard stripes, clock face, whiteboard
             materials.js   80-key lazy PBR registry shared by every module
  build/     shell · windows · openings · services      the envelope and its installed services
  equip/     crane · jibcrane · robot · conveyor · machines · furniture
  props/     props · signs
  scene/     lighting · camera · postfx · layout
  main.js    bootstrap, HUD, render loop
tools/       shot.py · compare.py · sweep.py            the photo-matching harness
CONTRACT.md  the module contract every builder follows
LAYOUT.md    the object-by-object placement table read off the photograph
```

Builders return a `THREE.Object3D` and never place themselves; `scene/layout.js`
is the only module that positions anything in the world. All randomness runs
through a seeded PRNG, so the scene is byte-identical on every reload.

**Budget:** 920 meshes, 397 k triangles, 65 instanced meshes, 177 materials,
50 shader programs.

---

## Lighting

The photograph is a bright, warm, high-key interior — daylight floods through the
right-hand window wall, bounces off a white ceiling onto a green floor, and
almost nothing reads as black. That is reproduced with a hemisphere + ambient
base, one shadow-casting sun angled in through the glazing at reduced shadow
intensity, `RectAreaLight`s filling the near window openings, a left-hand bounce
fill, and a PMREM environment baked from a small procedural room.

Two details matter for the look:

- The glazing is **emissive**, not a `toneMapped: false` basic material. The
  post chain ends in an `OutputPass` that tone-maps the whole buffer, so a
  per-material opt-out has no effect and plain white lands well below 255.
  Driving emissive past 1.0 makes the windows genuinely clip, as in the photo.
- Linear fog from 26 m reproduces the real atmospheric lift down the hall.
