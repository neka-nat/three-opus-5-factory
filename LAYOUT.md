# Layout brief — where everything goes

Derived by measuring `img01.jpg`. Coordinates are world metres:
`+X` right, `+Y` up, `+Z` toward the camera. Camera at **(2.78, 4.32, 3.60)**
looking down −Z with a 2.2° left yaw and 7.6° downward pitch. The hall recedes
to `z = −46.8`.

Because the camera sits close to the **right** wall (x = +6.5 is only 3.7 m
away) and near the hall's right third, the composition splits into:

| screen region | world region |
|---|---|
| bottom / centre-bottom | the robot cell: conveyor at x ≈ 2.55, z ∈ [−9, +5] |
| centre | the line receding: machines, the hero robot, z ∈ [−10, −25] |
| right edge | the near right wall: windows, jib cranes, air pipes, signs, z ∈ [−1, −10] |
| left half | the aisle and the cluttered left work area, x ∈ [−6.5, 0] |
| top | the ceiling and the orange crane at z = −9.5 |

---

## 1 · Building shell

| item | placement |
|---|---|
| Floor slab | full extent, `M.floor` |
| Aisle lane (lighter green + white edge lines) | centred **x = −2.35**, width 1.95, from z = +5 to z = −34 |
| Cross aisle | z = −21.5, width 1.8, x from −6.0 to −0.5 |
| Yellow cell tape | rectangle x ∈ [0.15, 5.05], z ∈ [−9.2, +4.2]; plus two small L-marks at (5.3, −2.4) and (5.3, −5.2) |
| Concrete apron | 0.62 m along both side walls and the back wall |
| Side walls | inner faces x = ±6.5, pilasters at every bay line |
| Back gable wall | z = −46.8 |
| Roof deck | y = 9.0; downstand beams at every bay line; edge beams at x = ±6.25 |
| Window walls | both sides; `buildWindowWall(+1)` and `buildWindowWall(−1)` |

**Openings**

| item | placement |
|---|---|
| Big roll shutter (back wall) | x = −1.6, z = −46.66, width 4.4, height 4.3, faces +Z, `openFrac 0` |
| Second shutter, left wall, far | z = −24.0, x = −6.36, width 3.6, height 4.0, rotated to face +X |
| Third shutter, left wall, mid | z = −13.2, x = −6.36, width 3.2, height 3.8 |
| Steel personnel door, right wall | z = −5.4, x = +6.36, faces −X |
| Steel personnel door, right wall | z = −12.6, x = +6.36 |
| Open doorway (dark, cluttered room beyond), left wall | z = −16.5, x = −6.36, 1.6 × 2.3 — just a dark recess box |

---

## 2 · Overhead crane and lifting gear

| item | placement |
|---|---|
| Runway girders + rails + corbels | x = ±5.6, full length |
| **Bridge crane** | `(0, CFG.crane.railTopY, −9.5)`, trolley at x = −2.6 |
| Runway conductor bar | inside face of the right runway girder |
| Monorail runway (right wall) | `buildMonorail()`, x = 5.32, z ∈ [−3, −42] |
| Monorail chain hoists | at z = −6.6, −13.8, −21.0, −28.2 |
| Jib crane 1 (**the big orange one on the right edge of frame**) | wall foot at (6.42, 0, −1.2), boom 2.55 m, boom y 3.55, swing −0.55 rad |
| Jib crane 2 | (6.42, 0, −8.4), boom 2.3, swing −0.35 |
| Jib crane 3 | (6.42, 0, −15.6), boom 2.3, swing −0.9 |
| Jib crane 4 (small, left wall, far) | (−6.42, 0, −19.0), mirrored, swing +0.6 |

---

## 3 · The robot cell (foreground — the hero of the shot)

| item | placement |
|---|---|
| **Roller conveyor** | x = 2.55, z from +5.2 to −13.4, rollers at y = 0.90, `centreSlot: true` |
| Portal frames over the line | z = +1.1, −3.4, −7.9 |
| Sheet-metal part lying flat on the rollers | (2.55, 0.92, −0.6), 1.05 × 0.62 |
| Sheet-metal part **standing upright** on the rollers | (2.6, 1.22, −2.9), 0.95 × 0.62, `standing: true`, slight tilt |
| Robots A–F | from `CFG.robots` — `buildRobot()` on `buildRobotPedestal()` |
| Extrusion guard frame, left of robot A | (0.15, 0, −1.4), 0.1 × 1.5 × 2.6 upright |
| Extrusion guard frame, right of robot B | (5.05, 0, −1.4) |
| Ring blower + flex hose | (4.65, 0.55, −4.5); hose runs up to robot D |
| Pneumatic cylinders / actuator rails under the near conveyor end | z ≈ +3.6 |
| Cable festoon loops under the conveyor frame | z ∈ [−2, −8] |

---

## 4 · Right-hand side (near wall, close to camera)

| item | placement |
|---|---|
| Blue air main + drops + white pipe + wire-way | `buildWallServices(+1)` |
| **消火器 sign** | (6.46, 3.55, −3.05), faces −X |
| **Fire extinguisher** on its red stand | (6.05, 0, −3.7) |
| **Teal hose reel** | (6.44, 2.95, −4.35), faces −X |
| 非常口 exit sign | hung at (6.15, 5.35, −5.6) |
| 非常口 exit sign (far) | (6.15, 5.35, −18.0) |
| Notice plaques | (6.46, 1.9, −6.2), (6.46, 2.2, −11.0) |
| Workbench + laptop + papers | (5.35, 0, −6.6), rotated 90° to face the aisle |
| Office chair | (5.0, 0, −7.4) |
| Blue plastic bin on the bench | on top of the workbench |
| Yellow plastic bin on the floor (bottom-right of frame) | (6.05, 0, +2.1) |
| Navy tarp bundle | (5.95, 0, −4.9) |
| Cardboard boxes against the wall | (6.1, 0, −9.5) and (6.05, 0, −13.4) |
| Small trolley | (5.7, 0, −16.2) |

---

## 5 · Middle distance (the machine line, x ∈ [1, 5], z ∈ [−11, −30])

| item | placement |
|---|---|
| **Charcoal machining centre** (behind the hero robot) | (2.6, 0, −15.2), 3.2 × 2.6 × 2.4, rotated ~0.06 rad |
| Andon on top of it | on the machining centre |
| Ivory machine cabinets (a run of them) | (4.15, 0, −13.0), (4.2, 0, −16.4), (4.1, 0, −19.6), (4.25, 0, −23.0) |
| Control cabinets | (3.4, 0, −11.4), (4.6, 0, −21.0) |
| Draped machine (translucent vinyl) | (1.5, 0, −13.6), 2.2 × 1.8 × 1.6 |
| Second draped machine | (3.9, 0, −25.5) |
| Operator panel on a swing arm | at the machining centre, facing the aisle |
| Machine cabinets continuing to the vanishing point | (3.9, 0, −27) … (3.6, 0, −38), progressively smaller detail |
| Pallet with boxes | (4.9, 0, −18.2) |
| Green gas cylinders (3, chained) | (5.4, 0, −24.5) |

---

## 6 · Left-hand work area (x ∈ [−6.5, −0.5])

Read as dense, warm clutter. Exact positions matter less than density and colour.

| item | placement |
|---|---|
| **Traffic cones** (with a striped bar between the first two) | (−1.75, 0, −1.9), (−2.15, 0, −4.5); cone bar between them. Two more at (−2.45, 0, −7.2) and (−2.6, 0, −9.8) |
| Bollard (yellow/black striped) | (−1.95, 0, +1.4) |
| **Big plywood/cardboard crate** (large pale block, mid-left of frame) | (−1.55, 0, −3.4), 1.5 × 1.05 × 1.15 |
| Pallet under it | same spot |
| **White partition screen** (the tall pale panel left of the conveyor) | (−0.85, 0, −2.2), 1.7 × 1.75, rotated ≈ 0.15 rad |
| Workbench with long blue-grey profile parts (bottom-left of frame) | (−0.55, 0, +2.6), 2.4 × 0.8, rotated ≈ 0.10 rad; put 3 long steel profiles on it |
| Stainless bracket / frame leaning on that bench | same spot |
| Blue tarp bundle | (−1.2, 0, +3.6) |
| Mint bench machine + control box + step platform | (−5.25, 0, +0.4) |
| **Helmet rack** (6 orange helmets + coiled cables) on the left wall | (−6.36, 1.55, +1.6), faces +X |
| Grey chip bin | (−4.7, 0, +0.9) |
| Storage cabinets with binders | (−6.15, 0, −4.6) and (−6.15, 0, −6.4) |
| Desk + monitor + keyboard | (−5.2, 0, −5.5), faces +X |
| Second desk + monitor | (−4.6, 0, −7.2) |
| Whiteboard stand | (−3.55, 0, −7.8), rotated ≈ 0.3 rad |
| Yellow notice board (a plain yellow panel with papers) | (−4.85, 0, −8.9), 1.1 × 1.4 |
| **Mint pigeon-hole parts racks** (the big green shelves) | (−4.5, 0, −10.4) and (−4.4, 0, −12.6), 2.2 m wide, facing +X |
| **Bin rack** (grid of small dark bins) | (−2.95, 0, −11.6), facing +X |
| Second bin rack | (−3.1, 0, −13.9) |
| White vinyl partition | (−2.55, 0, −10.2) |
| Mint trolleys / hand carts | (−3.4, 0, −9.0), (−5.5, 0, −11.5) |
| Red plastic bins on a shelf | around (−3.0, 0.9, −12.4) |
| **Green wire roll cages** (かご車, 5 of them, clustered) | (−3.6, 0, −16.0), (−2.9, 0, −17.4), (−4.4, 0, −17.0), (−3.2, 0, −19.2), (−4.8, 0, −19.8) |
| Box stacks on/around the cages | scattered z ∈ [−15, −22] |
| Distant yellow robot (small, on a bench) | (−3.9, 0.9, −18.6) |
| Pallets with cardboard | (−5.4, 0, −14.5), (−5.9, 0, −21.0) |
| Storage shelving continuing into the distance | x ≈ −5.6, z from −24 to −40 |
| 消火器 sign on the left wall | (−6.44, 3.3, −7.4), faces +X |
| Fire extinguisher | (−6.05, 0, −16.8) |
| Drums | (−6.0, 0, −26.5), (−5.6, 0, −27.4) |

---

## 7 · Ceiling & background

| item | placement |
|---|---|
| Light battens | `buildLightFixtures()` — two rows at x = ±3.4, y = 7.72 |
| High-bay domes | centreline, every 7.2 m |
| Cable trays, conduit, sprinklers | `buildCeilingServices()` |
| **Wall clock** on the back-ish wall | (−0.35, 5.55, −24.2) facing +Z — reads as the small round clock in the photo |
| Hanging aisle sign | (−2.35, 4.6, −12.0) |
| Green header band above the back shutter | part of `buildShutterSurround` |
| Distant clutter silhouettes (boxes, carts) | z < −28, low detail |

---

## 8 · Final composition checks

Render in photo-match mode and compare against `img01.jpg`:

1. The **orange crane girder** must cross the upper third of the frame roughly
   horizontally, its left end truck near the left edge at ~20 % frame height and
   its right end at ~22 %, with the **festoon loops** hanging below it.
2. The **conveyor** runs from the bottom edge (slightly right of centre) up to a
   vanishing point just left of frame centre.
3. Two **yellow robots** flank the conveyor at the bottom of the frame, cut off
   by the bottom edge, with their **cream dress-pack hoses** arcing above them.
4. The **right window wall** occupies the right ~28 % of the frame, blown out
   white, with the orange jib crane in the bottom-right corner.
5. The **green floor** with its white aisle line sweeps diagonally across the
   lower-left quadrant.
6. Overall value: bright, low contrast, warm. Nothing should read as black.
