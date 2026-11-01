# MonoSpace 500 / MX10 — the model behind the simulator

An independent study model built from published figures plus guesses, all marked. **It is not manufacturer data.**
Every number below is tagged **S** (source, a published figure), **D** (derived here from other numbers) or
**G** (guess: a typical engineering value with no MX10-specific source, with where it came from).

## The one input

Everything is a pure function of **t, the mission clock (seconds)**. A *mission* is fixed data: a list of trips
`(from floor, to floor, load)`. `stateAt(mission, t)` in `shared/lift.js` returns every pose and every reading. The 3D
(`model3d.js`), the gauges and chart (`console.js`) and the labels (`film.js`) only read that object. In the live
page, pressing a floor appends a planned trip to the mission. The clock only advances `t`.

Each trip runs on its own fixed timeline (τ = seconds since the trip started):

| τ | event |
|---|---|
| 0 → 2.825 s | doors close (jerk-limited S-curve, 0.9 m) |
| +0.3 s | brake lifts, drive energised |
| +0.4 s | drive holds at zero speed (pre-torque) |
| run | 7-segment S-curve over the floor distance |
| +0.2 s | brake drops |
| +0.1 s | doors open (same S-curve), then a 3 s dwell |

Poses then follow from the car height `y` alone (2:1 kinematics):

- counterweight pulley height = K − (car pulley height), so the counterweight drops 1 m for every metre the car rises
- sheave angle = 2y / R (rope speed is twice the car speed)
- each diverting pulley angle = y / r (it rolls at v / r)
- governor sheave angle = y / r_gov (its rope is tied to the car, 1:1)
- tracer marks on rope 3 sit at fixed distances along the rope from the dead-end hitch (the rope doesn't stretch in this model), so they ride with the rope over every pulley
- landing door at the stopped floor = car door (coupled), fast panel = opening × 0.9 m, slow panel = half that

## The numbers

| | value | tag | where from |
|---|---|---|---|
| rated speed v | 1.0 m/s | S | KONE MonoSpace 500 planning guides: 1.0–1.75 m/s |
| rated load Q | 1000 kg (13 persons) | S | KONE: 320–1150 kg. 1000 kg chosen. 13 persons from EN 81-20 Table 6 |
| car 1100 × 2100 × 2100 | | D | EN 81-20: 1000 kg allows ≤ 2.40 m². 1.1 × 2.1 = 2.31 m² |
| pit | 1050 mm | S | KONE planning table, 1.0 m/s |
| headroom | car height + 1300 mm = 3.4 m | S | KONE planning table, 1.0 m/s |
| stops / floor height | 6 / 3.0 m (15 m travel) | G | a residential block, well inside KONE's 55 m / 21 stops at 1.0 m/s |
| roping | 2:1 | S* | user-maintained wiki: MX10 runs 2:1 in MonoSpace. The reference render shows the under-car pulleys |
| sheave pitch diameter | 480 mm | S* | two parts-vendor listings give Ø480 for the MX10 (a ZIEHL-ABEGG retrofit flyer shows 400 mm in a table not clearly tied to the MX10). The rpm check below supports 480 |
| MX10 rated output | 5.7 kW | S* | vendor listing: 5.7–14.6 kW. 5.7 kW is the 1.0 m/s rating |
| empty car mass P | 1100 kg | G | typical MRL car for 1000 kg: 1.0–1.2 × Q |
| counterweight balance | 50 % → W = 1600 kg | G / D | conventional |
| ropes | 6 × Ø8 mm, 0.22 kg/m, MBF 40.3 kN | G | catalogue values for an 8 mm lift rope. Checked below |
| diverting pulleys | Ø330 mm | D | EN 81-20 D/d ≥ 40 → ≥ 320 mm |
| acceleration / jerk | 0.7 m/s² / 1.0 m/s³ | G | typical comfort settings |
| rotor + sheave inertia | 3.0 kg·m² | G | disc rotor ≈ 60 kg at r ≈ 0.3 m |
| motor / drive efficiency | 0.90 / 0.96 | G | gearless PM machine, IGBT inverter |
| guide + bearing friction | 250 N at the car | G | a few % of the imbalance |
| groove | undercut, γ 30°, β 90°, 180° wrap, μ 0.1 | G / S | groove geometry guessed. μ 0.1 from EN 81-20 Annex D (loading case) |
| door leaves | 4 × 25 kg, 0.5 m/s max | G | chosen to stay under EN 81-20's 10 J |
| shaft 1750 × 2400 mm | | G | car + counterweight + clearances. Not taken from KONE's shaft table |

\* secondary sources (vendor listings, a user wiki). KONE's own MX10 data sheet was not available.

## Hand checks

`node shared/check.mjs` works each of these by hand and asserts it against the model (output in `CHECK.txt`, all pass).

**1. Sheave speed.** With 2:1 roping the rope runs at 2v. n = 2 × 1.0 / (π × 0.48) = 1.3263 rev/s = **79.58 rpm**.
A vendor listing quotes 79.6 r/min at 5.7 kW. That matches 480 mm at 2:1 and 1.0 m/s, and rules out 400 mm, which
would give 95.5 rpm. ω = 2v / R = 2 / 0.24 = **8.333 rad/s**.

**2. Rated torque.** 5700 W / 8.333 rad/s = **684 N·m** (D).

**3. Static full-load torque (rope weight left out).** The imbalance at the car is 0.5 Q g = 4905 N. At 2:1 each side of the
sheave carries half: ΔT = 2452.5 N. τ = ΔT × R = 2452.5 × 0.24 = **588.6 N·m**, which is 86 % of rated. Power check:
τω = 588.6 × 8.333 = 4905 W = 0.5 Q g v ✓. The model gives exactly 588.6 N·m at the height where the rope weight on
the two sides balances (car floor at 8.88 m).

**4. Ride profile.** Jerk phase a/j = 0.7 s. Constant-acceleration phase (v − a²/j)/a = 0.7286 s. Distance to reach
1 m/s = v × 2.1286 / 2 = 1.0643 m.
- One floor (3 m): 2 × 2.1286 + (3 − 2.1286)/1 = **5.129 s**.
- Five floors (15 m): D/v + v/a + a/j = 15 + 1.4286 + 0.7 = **17.129 s**.
- A 1 m move never reaches 1 m/s. Its peak solves vp²/a + vp·a/j = D, so vp = **0.6268 m/s**.

The model matches all of these and never exceeds 1.0 m/s or 0.7 m/s².

**5. 2:1 kinematics.** Each rope is **41.77 m** long (one length per rope) with the car at the bottom and with the car at the top. The rope
length stays constant, so the falls are right. Car +1 m → counterweight −1 m, and 2 m of rope passes over the sheave.

**6. Rope safety factor.** Car side at the sheave, full load, car at the bottom:
2100 × 9.81 / 2 + 6 × 0.22 × 9.81 × 18.1 m ≈ 10.54 kN. Sf = 6 × 40.3 kN / 10.54 kN = **22.9** against EN 81-20's
minimum of 12 (Annex N can ask more for many bends).

**7. Traction (EN 81-20 Annex D).**
- f = 0.1 × 4(cos 15° − sin 45°) / (π − π/2 − π/6 − 1 + 0.5) = **0.1892**, so the limit e^(fα) = e^(0.1892 π) = **1.812**.
- At 125 % load, static: (1100 + 1250) / 1600 = **1.469** < 1.812 ✓.
- The model's live ratio, static: 1.34 at full load at the bottom, 1.48 with the car empty at the top.
- The model's live ratio, running (the max over each run): 1.57 on the full-load climb, 1.53 on the full-load descent, and **1.74 with the car empty
  accelerating downwards**. That is 96 % of the limit. **Flag:** the groove geometry is a guess. A real installation
  would need margin here (EN 81-20's emergency-braking μ = 0.1/(1 + v/10) gives a limit of 1.72), so either KONE's
  groove grips harder than my γ 30° / β 90° guess, or the empty car is heavier than 1100 kg. The console's traction bar
  turns orange above 90 % so you can watch this happen: call the empty car from 5 down to G.

**8. Doors.** At full speed: ½ × 50 × 0.5² + ½ × 50 × 0.25² = **7.8 J** ≤ 10 J ✓. The doors take 2.825 s to open or close.

**9. Counterweight build.** Fillers (1600 − 160) kg / 7850 kg/m³ / (0.16 × 0.62 m) = **1.85 m** stack = 37 plates of 50 mm.
That's why the counterweight is tall and slim in the 160 mm gap.

**10. Full-load climb, G → 5.**
- Equivalent mass at the car: car 2100 + counterweight 1600 + rotor 3.0 × (2/0.24)² = 208 + pulleys 22 + moving rope ≈ **4034 kg**.
- Torque at full acceleration from the bottom: (4034 × 0.7 + 4905 + rope 388 + 250) × 0.12 = **1013 N·m** = 148 % of rated. That's a short peak; inverters usually allow 1.5–2×.
- Peak shaft power is 6.65 kW, briefly above the 5.7 kW rating.
- Energy from the grid: model **25.2 Wh**. By hand: (4905 N × 15 m + 250 N × 15 m) / (0.9 × 0.96) = 24.9 Wh, which leaves out rope weight and the losses on the kinetic energy.

## Torque and power, in one line

Referred to the car (up +):

F = M_eq·a + (m_car − W)·g + F_rope + F_f·sign(v), τ = F·R/2, P_shaft = τ·ω

F_rope = n·μ·g·[2(y_cwPulley − y_carPulley) + under-car span]

F_rope comes from d(PE)/dy summed over every rope fall. P_grid = P_shaft / η when motoring and P_shaft·η when
regenerating. Tensions at the sheave come from each fall's own dynamics (falls moving at 2v). With the brake set, the
motor torque is 0 and the console shows the static torque the brake holds.

## Not modelled

Rope stretch and the bounce it causes, inverter and current dynamics, pulley inertia inside the tension split (it is in
the torque), the governor and safety gear actually tripping, door reopening, the car's sway on its guides.

## Files

- `shared/lift.js` — the model (no three.js)
- `shared/check.mjs` — the hand checks
- `shared/model3d.js`, `stage.js` — geometry and studio
- `shared/console.js` — gauges and chart
- `shared/film.js` — tour script and labels
- `shared/live.js` — the interactive page
- `dist/monospace-live.html` — open this. Offline, ~790 KB
- `dist/monospace-film.html` — the tour as a pure `render(t)`, used for frame capture

Rebuild with the teardown skill: `node ~/.claude/skills/teardown/sims/build.mjs ./teardown/monospace-500/monospace-live`.

### Sources consulted

- KONE MonoSpace 500 planning guides (speeds, loads, pit, headroom): kone.us, kone.fi, kone.co.il editions
- Parts-vendor listings for the KONE MX10 / MX06 (sheave Ø480, 5.7–14.6 kW, 79.6 r/min): potensielevator.com and similar
- ZIEHL-ABEGG ZAmod Disc retrofit flyer (EcoDisc MX05/MX10 retrofit kits)
- Elevation wiki, "Kone EcoDisc" (MX10: 2:1, up to 1000 kg, up to 1.6 m/s; user-maintained)
- EN 81-20:2020 (car area, rope safety factor, traction Annex D, door kinetic energy)
