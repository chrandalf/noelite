# Jet mode: stunts, and making it look like a jet

Research pass, 2026-09-05 night, for DESIGN §10l. Chris: "jet needs to look like a jet, not
like the ship in space, it's different, needs to be able to do stunts easily."

## 1. How the arcade games do it

They all agree on one thing: **the rotation rate is a hard cap, not a force balance.**
Nothing about air, mass or speed touches how fast the nose swings. Speed changes the
*radius* of a manoeuvre, never its *duration*. That is why a Star Fox loop feels the same at
every throttle setting, and why our jet, whose turn falls out of a lag time constant, feels
like porridge.

| Game | Roll | Pitch | Nose to velocity | Stall | Auto-level |
|---|---|---|---|---|---|
| Rocket League, aerial | 315 °/s clamp, torque 38.1 rad/s², damp 4.76 /s, cap in 0.15 s | 315 °/s clamp, torque 12.4 rad/s², damp 2.86 /s | none, it is a brick | none | pitch and yaw damping is ×(1−\|input\|), so none while the stick is in |
| Ace Combat 7 | Expert is rate; Standard is a bank target that overshoots to ~100° then corrects | pull is the turn; High-G turn buys rate with speed | assisted, and stock AC7 has no drift after release | real, about 120 km/h | Standard only, and it deletes roll entirely |
| Star Fox 64 (decomp) | real rotation: 30°/frame for 10 frames on rails, then a 5/frame decay tail. 1800 °/s, a full roll in under 0.2 s. 20°/frame × 15 in all-range | U-turn smoothsteps a 90° turn cap and 180° of pitch | total | none | yes, `SmoothStepTo(roll, 0, 0.1, 10)` every frame with no input: τ 0.17 s, capped 600 °/s |
| GTA V planes | rate. `fRollMult` 0.0090 Lazer, 0.0070 Hydra | `fPitchMult` 0.0020, 0.0015: roll is 4.5× pitch | partial, separate climb and dive lift curves | yes, scripted engine stall | `fRollStabilise` damping, scaled by airspeed |
| F-16, for scale | 240 °/s | 25.5 °/s instantaneous, sea level, 9 g | n/a | yes | n/a |

Three things worth stealing. **Rocket League's damping trick**: pitch and yaw damping is
multiplied by `(1 − |input|)`, so while you hold the stick there is no damping at all and
the axis accelerates flat out to a 5.5 rad/s clamp, then stops in 0.22 s when you let go.
Our exponential damp does the opposite, making the approach slow and the ceiling low.
**Ace Combat's High-G turn** buys rate with airspeed: hold throttle and brake, pull, and
your speed plummets toward the stall. That is arcade induced drag, and it is what makes
throttle matter. **Star Fox's roll**, which I expected to be a canned animation and is not:
the decomp runs it at 30° a frame for ten frames, 1800 °/s, with a permanent
`Math_SmoothStepToF` pulling roll to zero at τ 0.17 s whenever the stick is out. Fast
in, fast back to level. Roll rate and auto-level are what make a stunt cheap to attempt.
The genre's other lesson, from Pilotwings 64's Makoto Wada: "the player must be king".

## The maths of a loop, in the model as it stands tonight

Empty ship on Vale, g = 9.81, sea-level air. Max pitch rate is
`ANG_ACCEL 6 × JET_ANG 0.5 / ANG_DAMP 4 = 0.75 rad/s = 43 °/s`. Roll is
`6 × 0.8 / 4 = 1.20 rad/s = 69 °/s`. Yaw is `6 × 0.6 × 0.5 / 4 = 0.45 rad/s = 26 °/s`.
Stick response time constant is `1/4 = 0.25 s`.

A loop here does not come from lift. It comes from the alignment: the nose turns at ω, the
velocity chases it, and in the steady state the velocity turns at ω too. So the centripetal
pull is `a = v·ω` and the radius `R = v/ω`, uncapped, with no g limit anywhere. Loop period
`2π/ω = 8.4 s` at every speed.

| v (m/s) | radius (m) | a (m/s²) | fake g | speed over the top |
|---|---|---|---|---|
| 80 | 107 | 60 | 6.1 | 47 m/s, **stalls** |
| 100 | 133 | 75 | 7.6 | 69 m/s |
| 150 | 200 | 113 | 11.5 | 121 m/s |
| 237, top | 316 | 178 | 18.1 | 209 m/s |

Minimum entry speed to clear the top above the 60 m/s stall, from `v² = 60² + 4gv/ω`, is
**92 m/s**.

### Three things fighting the stunts, and Chris was right about all three

1. **`JET_ALIGN_TAU = 0.7 s` is the mush.** In a steady turn the velocity lags the nose by
   `θ = atan(ω·τ)`. At full pitch that is `atan(0.75 × 0.7) = 27.7°`. All the way round a
   loop the ship is flying 28 degrees nose-high to its own path. It reads as a skid, not as
   angle of attack, and it means a 30° nose snap at 237 m/s takes 166 m of travel to bite.
   In a canyon that is a hillside. The fix is a short τ, 0.2 s, which gives a 14.7° lag and
   47 m of travel. The alignment was never a g limiter, so shortening it costs nothing.
2. **The auto-trim only works right way up, and `JET_LIFT_MAX_G` is dead code.**
   `need = g · bodyUp·up`, applied only `if (need > 0)`, so inverted the wings do nothing and
   you fall out of the sky. And `need` can never exceed `g`, so `min(need, can)` is capped at
   1 g and the 3.5 g limit never binds at all. One-line fix: drop the `need > 0` guard, clamp
   the magnitude instead. Upright the wing pushes toward the canopy, inverted toward the
   belly, which is what a real wing at negative alpha does and what makes inverted flight
   possible.
3. **`ANG_DAMP 4` with half stick is too slow for a snap roll.** 69 °/s means a full roll
   takes 5.2 s. Rocket League does 315 °/s and an F-16 does 240. Nobody rolls a fighter in
   five seconds.

A fourth, smaller: the coordinated bank turn is almost invisible at jet speed, 6.5 °/s at
150 m/s and 60° bank against a 43 °/s pitch rate. Keep it, it is right and it matters at
80 m/s (19 °/s at the bank cap), but it is not the turning mechanism.

### Recommended numbers

| Parameter | Now | Recommend | Why |
|---|---|---|---|
| Pitch rate (jet) | 43 °/s | **75 °/s** (1.31 rad/s) | 4.8 s loop at every speed. Star Fox pacing. |
| Roll rate (jet) | 69 °/s | **240 °/s** (4.19 rad/s) | The F-16 number, and 3.2× pitch, near GTA's 4.5×. A 360 in 1.5 s. |
| Yaw rate (jet) | 26 °/s | **30 °/s** (0.52 rad/s) | Enough to kick a hammerhead, not enough to flat-turn. |
| Stick damping (jet) | 4 /s always | **8 /s × (1 − \|input\|)** | Rocket League's trick: cap reached in 0.16 s, stopped in 0.13 s. |
| Rate cap | none, damping sets it | **hard clamp per axis** | Predictable ceiling, and cargo mass stops slowing your aerobatics. |
| `JET_ALIGN_TAU` | 0.7 s | **0.20 s** | 14.7° lag instead of 27.7°. This is the single biggest change. |
| Auto-level (roll) | none | **τ 0.8 s, only with roll stick centred and \|bank\| < 90°, capped 60 °/s, 8° dead band** | Star Fox uses τ 0.17 s. Slower here because we keep real inverted flight, and the \|bank\| gate is what preserves it. |
| Auto-level (pitch) | none | **none, ever** | Pitch centring fights every loop. |
| Lift g cap | 3.5 g, dead | **4 g, live and signed** | Makes inverted flight work and gives the cap a job. |
| Induced drag | none | **4.5 m/s² × \|pitch stick\|** along −velocity | About 20 m/s a loop. AC7's High-G turn in one line. |
| `JET_DRAG` | 0.0005 | **unchanged** | 237 m/s, 380 boosted, is right over these mountains. |
| Min speed for a clean loop | 92 m/s | **77 m/s** | Falls out of the pitch rate. Stalling atop a botched loop is a good failure, keep it. |
| Camera follow gain | `6 + speed × 0.5`, 124 at top speed | **flat 7** in jet | The offset is craft-relative, so the stiffening buys nothing and kills all lag. |
| Camera roll follow | 0 in air | **0.6 toward ship up** in jet | A roll you cannot see the horizon spin through is not a roll. |
| Camera offset | back 30, up 26 above 150 m | **back 26, up 5**, look 14 m ahead | Looking down from 26 m up is a lander camera. |
| FOV | 62° fixed | **62 + 10·(v/237), +4 on boost, τ 0.5 s** | Standard arcade speed cue. |

With the recommended pitch rate the loop table becomes:

| v (m/s) | radius (m) | fake g | split-S height loss |
|---|---|---|---|
| 80 | 61 | 10.7 | 122 m |
| 100 | 76 | 13.4 | 153 m |
| 150 | 115 | 20.0 | 229 m |
| 237 | 181 | 31.6 | 362 m |

Thirty g is nonsense and nobody will notice. What they will notice is that a split-S at top
speed eats 362 m of altitude, a real constraint over Vale's mountains and worth a HUD tick.

Add two canned moves, because "easy" means one key: **Immelmann** (half loop then half roll,
3.2 s) and **split-S**. Drive them by feeding the stick the player would have held, so they
read as flying, and refuse them below 80 m/s or with less than 2·R of air below.

---

## 2. The look: a jet that reads as a jet

### Proportions of the real thing

| Aircraft | Length | Span | Height | Span/length | Height/length | Wing |
|---|---|---|---|---|---|---|
| MiG-21bis | 15.76 m | 7.15 m | 4.13 m | 0.45 | 0.26 | delta, 57° LE |
| F-104 | 16.66 m | 6.63 m | 4.11 m | 0.40 | 0.25 | straight trapezoid, 26° |
| F-16 | 15.03 m | 9.45 m | 5.09 m | 0.63 | 0.34 | cropped delta + LERX, 40° |
| Mirage 2000 | 14.36 m | 9.13 m | 5.20 m | 0.64 | 0.36 | delta, 58° |
| F-86 Sabre | 11.43 m | 11.30 m | 4.47 m | 0.99 | 0.39 | swept trapezoid, 35° |

Height over length is the stable one, 0.25 to 0.36 without exception. A fighter is three to
four times longer than it is tall. Span over length ranges wildly, so it is the free
parameter. At 9 m long the F-16 ratio would give a 5.7 m span, too thin to read from behind
in flat polygons. Take **7.0 m, ratio 0.78**, Sabre-ish. A wing you can see beats a correct
table.

WEFT, the WW2 aircraft-recognition system (wings, engine, fuselage, tail), is a
silhouette-reading problem, and it ranks the wing planform first, then the tail, then nose
and canopy. Low-poly practice agrees: keep the wing edge, nose taper, canopy bump and fin;
drop belly detail, panel lines, intake internals. The SNES Arwing was about ten faces and
the N64 one sixty, so we have room.

### The three things a flat-shaded jet needs that the lander does not

1. **A fin.** It is the one shape that gives you roll angle from any viewing direction, and
   in the WEFT tables it is what separates fighter from airliner. Twin canted fins read
   better at low poly, because a single thin fin vanishes edge-on.
2. **A canopy bump.** A raised glass wedge on the spine, forward of the wing. It says
   cockpit, therefore aircraft, and it tells you which way is up mid-roll. The dart's flat
   GLASS patch does not break the top line, so it does not do this.
3. **Nozzles with flame out of them.** Two, at the tail, on the axis. At 200 m/s the flame is
   the throttle readout, and thrust coming out of the back instead of the belly is the whole
   difference from hover.

A fourth, free: **a swept leading edge**. One straight 45° line is the most information-dense
shape on an aircraft.

### The vertex list

Ship frame, nose toward −z, +y up, x is span. 9.0 m long, 7.0 m span, 2.6 m tall, fuselage
fineness ratio 5.0. About 20 triangles on top of the existing hull.

**Fuselage: the same five-point hull, moved.** `split()` runs at level 2 over six facets in
a deterministic order, so a second call with a different vertex set gives a position buffer
with identical layout. Put it in `morphAttributes.position` and Three lerps it for free.

```
              dart                 jet
  N   nose   ( 0,     0,   -4.6)   ( 0,     0,   -5.4)
  TL  tail L (-3.3,   0,    2.6)   (-0.9,   0,    3.6)
  TR  tail R ( 3.3,   0,    2.6)   ( 0.9,   0,    3.6)
  T   spine  ( 0,     1.15, 0.9)   ( 0,     0.75, 0.4)
  B   keel   ( 0,    -0.75, 0.9)   ( 0,    -0.55, 0.4)
```

The wide flat dart becomes a needle: 9.0 m long, 1.8 m across the tail, 1.30 m deep. The
`paint()` livery rules carry over untouched, so the NAVY spine stripe, GLASS nose patch and
RED belly all survive. Keep the red belly. A flash of red underside mid-roll is a free
inverted cue.

**Wings**, one flat plate each side, two triangles, `side: DoubleSide`, WHITE above by
normal, RED below. 45° leading edge, taper 0.21, root chord 4.3 m, tip chord 0.9 m:

```
  L: (-0.70, -0.05, -0.80)  (-3.50, -0.05,  2.00)  (-3.50, -0.05,  2.90)
     (-0.70, -0.05, -0.80)  (-3.50, -0.05,  2.90)  (-0.80, -0.05,  3.50)
  R: mirror in x
```

**LERX**, the sliver forward of the wing root that makes an F-16 an F-16. One triangle a
side, DARK:

```
  L: (-0.70, -0.05, -0.80)  (-0.34, -0.05, -3.60)  (-0.50, -0.05, -0.80)
```

**Twin fins**, canted 22° out, one triangle each, CREAM with a NAVY tip if you want the
stripe to carry:

```
  L: (-0.75, 0.35, 1.80)  (-0.85, 0.35, 3.50)  (-1.55, 2.05, 3.10)
```

**Stabilators**, small aft deltas, one triangle each, WHITE:

```
  L: (-0.90, 0.00, 2.90)  (-2.20, 0.00, 3.90)  (-0.95, 0.00, 3.60)
```

**Canopy**, five points, six triangles, GLASS, sitting on the nose-to-spine ridge:

```
  front (0, 0.42, -3.40)   top (0, 0.95, -1.90)   rear (0, 0.62, -0.40)
  left (-0.42, 0.55, -1.60)   right (0.42, 0.55, -1.60)
```

**Chin intake**, a DARK quad under the nose, two triangles, x ±0.55, y −0.45, z −2.60 to
−1.60. Cheap, and it is the other F-16 tell.

**Nozzles**: move the two existing 0.26 m cylinders from (±1.0, 0.2, 2.55) to
(±0.50, 0.05, 3.70), radius ×1.6. Reuse the `cruiseFlames` cones, length scaled by throttle.

### The morph, half a second

Same `set(t)` idiom as the TIE morph, smoothstepped over 0.5 s, driven by `craft.jet`:

| Part | t = 0 (dart) → t = 1 (jet) |
|---|---|
| Hull | dart vertex set → jet set, via `morphTargetInfluences[0]` |
| Wings | `scale.x` 0.04 → 1, rotation 70° up against the flank → 0 |
| Fins | `scale.y` 0.02 → 1 |
| Stabilators | `scale.x` 0.05 → 1 |
| Canopy | `scale.y` 0 (flush, the flat GLASS patch covers it) → 1 |
| LERX, intake | `scale.z` 0.1 → 1, `visible = t > 0.05` |
| Nozzles | z 2.55 → 3.70, radius ×1 → ×1.6 |
| TIE panels, legs | forced folded and up throughout: jet and cruise are exclusive |

The dart's wide tail pinches in, the nose stretches forward, wings slide out of the flanks,
two fins stand up out of the tail, the canopy swells on the spine. Half a second, the same
beat as the TIE morph, so it belongs to the same ship.

---

## Sources

Feel: [Rocket League aerial constants](https://www.smish.dev/rocket_league/aerial_control/) ·
[AC7 expert controls](https://www.dualshockers.com/ace-combat-7-gameplay-expert-controls/) ·
[AC7 post-stall](https://acecombat.wiki.gg/wiki/Post_Stall_Maneuver) ·
[SF64 U-turn](https://starfox.fandom.com/wiki/U-Turn) ·
[F-16 rates](https://www.f-16.net/forum/viewtopic.php?f=23&t=59982) ·
[F-16 turn analysis](https://boltflight.com/f-16-turn-rate-a-detailed-analysis-of-maneuverability/) ·
[SF64 decomp, fox_play.c](https://github.com/MegaMech/sf64/blob/master/src/main/fox_play.c) ·
[RLUtilities car.cc](https://github.com/samuelpmish/RLUtilities/blob/master/src/simulation/car.cc) ·
[GTA V handling.meta](https://gtamods.com/wiki/Handling.meta) ·
[default handling values](https://github.com/Firecul/GTA-V-Default-Handling-Files---FiveM-resource/blob/master/handling/merged-handling.meta) ·
[AC7 stalling](https://acecombat.wiki.gg/wiki/Stalling) ·
[Pilotwings 64, the making of](https://www.nintendolife.com/news/2013/07/feature_the_making_of_pilotwings_64) ·
[War Thunder arcade instructor](https://warthunder.com/en/news/4366-wiki-article-how-the-instructor-works)

Shape: [F-16](https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104505/f-16-fighting-falcon/) ·
[MiG-21](https://migflug.com/aircraft/mig-21-fishbed/), [Mirage 2000](https://migflug.com/aircraft/mirage-2000/), [F-86](https://migflug.com/aircraft/f-86-sabre/), [F-104](https://www.flugzeuginfo.net/acdata_php/acdata_f104_en.php) ·
[WEFT, Smithsonian](https://www.si.edu/object/weft-system-aircraft-identification:nasm_A19960580000) ·
[low-poly assets](https://www.juegostudio.com/blog/low-poly-3d-modeling-for-game-assets), [Super FX Arwing](https://www.theregister.com/2013/08/15/starfox/), [triangle counts](https://polycount.com/discussion/126662/triangle-counts-for-assets-from-various-videogames)
