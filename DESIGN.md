# noelite

Elite's structure, Lander's face.

A seeded universe you fly, land on, dig up, and sell across. Small planets, real
spheres, seamless descent, flat-shaded polygons and no textures anywhere.

---

## 1. The pitch

You have a craft, a hold, and not much fuel. Worlds are computed rather than authored,
so what a planet holds is a fact you can learn and act on. Go down, scoop something out
of the ground, come back up, sell it somewhere it's worth more. Get a bit richer, reach
a bit further.

The reference points, both David Braben:

- **Elite (1984)** — the galaxy as a pure function of a seed. Derived economies. Fuel as
  the leash. No plot.
- **Lander / Zarch (1987)** — flat-shaded filled polygons over a heightmap, bright and
  faceted, and a craft that tilts to move and has no brakes.

## 2. What this is not

- Not No Man's Sky. Everything-everywhere means nothing is scarce, and nothing scarce
  means nothing is worth flying to. Scarcity is the design.
- Not a faithful Elite remake. Own ships, own worlds, own names.
- Not on foot. Ever. Gathering happens from the cockpit.

## 3. The loop

    land → gather → take off → travel → land → sell → repeat, richer

## 4. Decisions taken

| Question | Decision |
|---|---|
| Stack | Three.js + TypeScript + Vite |
| Look | Flat-shaded filled polygons, Lander palette, zero textures |
| Space↔surface | Seamless. No cut, no loading screen. |
| Planet shape | Real sphere, circumnavigable |
| Planet radius | **40 km since 2026-09-02** (started at 2 km). Earth at 1:159; a config number. |
| Scale | Everything real through one factor, except atmosphere depth and relief, each exaggerated about 3x. |
| Gathering | From the craft. Hover, scan, scoop. |
| Flight model | One rigid body. Gravity and drag vary with altitude. |
| First slice | Land on one planet |

### Why 2 km

The full loop across two worlds on a seamless full-scale sphere is a three-month first
build, and projects die from having nothing to play, not from difficulty. At 2 km radius
every hard problem shrinks at once: two or three LOD levels instead of twelve, float32
precision never runs out, and the whole world loads instantly. You still get the moment
that matters, which is pitching up and watching the ground become a ball.

The radius is a number in a config file. Get the machinery right small, then turn the dial.

### The dial got turned: 1:159 (2026-09-02)

Chris, after a day at 2 km: *"I want everything to be realistic apart from the fact that we
can travel far to the other planets and everything is on a much smaller scale... make things
bigger then, 20x bigger and only exaggerate a little bit with the atmosphere."* So home is
Earth at 40 km radius and every other body is its real analogue through the same factor,
`K = 40 km / 6371 km`. One factor means angles survive: the sun is a half-degree disc from
home, the moon too, and an eclipse is geometrically possible. Surface gravities are the real
ones, so `GM = g·R²` scales by K², periods by √K: a 29-day year, a 2.2-day month, Jupiter's
year most of a real one. Home orbits at 2,360 m/s, which is why the craft has to live in the
sun's frame (Stage C) before anything else.

Two things are deliberately not to scale, and both by about 3x. **Atmosphere depth** is set
by temperature and gravity in the real world, not by radius; scaled it would be 30 m and a
re-entry would last two frames. Home has 2 km of air. **Relief**: Everest at 1:159 is 56 m;
home has 200 m and the other rocky bodies 0.5% of their radius. Rotation isn't gravitational
either, so day length is a gameplay number (40 minutes; the equator moves at 105 m/s).

What it costs, honestly: the sky from home is dots, like a field in Sussex, because Venus at
closest is one arcminute across. The spectacle is in arriving. And distances are 100x what
the toy system had (Jupiter is 4.9 million km out), so cruise needs a supercruise-style ramp
far from bodies or nobody ever gets there. That ramp is on the list after Stage C.

## 5. Architecture

### The one interface

```ts
height(p: UnitVector, seed: PlanetSeed): number   // metres above datum
```

Pure, deterministic, and evaluated on the **normalised sphere vector** — never on
cube-face coordinates, or the six faces won't agree at their seams.

Everything derives from this and the planet seed: terrain, materials, what's worth
landing for. Same trick Elite pulled on the galaxy, and it makes the whole world
unit-testable before a pixel exists.

### Rendering

- Cube-sphere, per-face quadtree LOD, subdivided on camera distance
- `.toNonIndexed()` **then** `computeVertexNormals()` so every triangle keeps its facet.
  Skip this and Three averages the normals and you get smooth Gouraud mush.
- One directional light, one weak ambient, saturated flat colours, no textures
- `logarithmicDepthBuffer: true` — kills depth precision fights between orbit and ground
- **`flatShading` stays OFF on the terrain material.** With it on, Three discards the
  normal attribute and derives normals from screen-space derivatives, so a skirt lights
  as the vertical wall it is and every LOD seam draws as a dark dotted line. The chunk
  builder supplies true per-facet normals itself; skirts inherit their surface triangle's
  normal and colour and vanish. Found 2026-09-01 after four wrong theories; the red-skirt
  debug mode (`?skirts=red`) and `verify-chunk` are what finally pinned it.
- Camera-relative rendering: translate the world so the ship sits near origin each frame

Hard facets hide LOD popping, because the eye already expects discontinuity there. The
art direction is doing real engineering work.

### Flight: one model, not two

One rigid body. Gravity and atmospheric drag are functions of altitude.

- Low down, drag and gravity dominate → Zarch. Tilt to move, argue with your own momentum.
- Up high, drag vanishes and gravity thins → Elite.

Same code. The craft flies differently in different places because the air is different,
which is both correct and free.

**The atmosphere is one number.** `atmosphereDensity(altitude)`: 1 on the deck, 0 at
`ATMOSPHERE_HEIGHT`. Drag, sky colour, haze, the rim-glow shell you see from orbit and the
HUD readout all key off it, so when the panel says VACUUM the physics agrees. That readout
is the trigger for the space half of the game.

**Landing is felt, not read off a number** (from the first flight, 2026-09-01). The stack:
a blob shadow that conforms to the terrain and grows as you descend; an altimeter ladder
with four landing lights (vertical speed, drift, tilt, ground slope) that arm under 60 m;
ground effect in the physics, the last six metres pushing back harder the faster you fall
into them; dust when you burn near the deck; a radar-altimeter blip that quickens on the
way down; and a chase camera that closes in as you get low. Shift boosts thrust 2.6x, and
because drag caps it low down and nothing caps it above the atmosphere, it is faster
exactly where the air thins. Drag orbits the camera, wheel zooms, C snaps it back.

### Scarcity and rarity

What a world holds falls out of its seed, so "the third one out from that red dwarf is
lousy with iridium" is a real, stable, learnable fact. Knowledge is the progression.

**The unit of search is the site.** A site is a discrete derived point of interest on a
surface: a deposit, a wreck, a ruin, a signal source. Each planet has some number of them,
derived from its seed. Working numbers, all of them config:

    ~2,000 systems × ~3 planets × ~50 sites ≈ 300,000 sites in the universe

**Rarity is a count, not a dice roll.** Each site hashes to a tier. In a fixed universe
"1 in N" means "this many exist," and they are always in the same place:

| Tier | Odds | ≈ in universe | What it is |
|---|---|---|---|
| common | 1 in 100 | 3,000 | ordinary deposits, the bread and butter |
| uncommon | 1 in 1,000 | 300 | worth a detour, worth remembering |
| rare | 1 in 10,000 | 30 | worth a story |
| legendary | 1 in 100,000 | 3 | the reason people play for a year |

Per-scan probability is explicitly rejected. If every scan is a lottery ticket then
nothing is anywhere and the map stops meaning anything.

**Tough means a trail, not a grind.** Nobody lands on 300,000 sites. The game's job is
to narrow the search: a rumour at a station, an orbital signal that gives you a
hemisphere, a mineral that only forms on a certain slope, a wreck that only ever fell
near a pole. Each tier up, the trail gets longer and fainter. The funnel is the game;
the last hundred metres are the hard bit.

**Easter eggs are hand-placed on top of all this.** Not seeded, not generated, authored
in a checked-in table keyed by (system, planet, lat, lon). The universe is a fixed
function of one master seed, so a coordinate means the same thing forever, and the seed
gets a version number and never moves once authoring has started against it.
`height()` grows an override term (`base + overrides`) so authored spots can flatten a
pad or dig a crater without fighting the noise. If nine things in the galaxy were put
there on purpose, those nine things are the only things anyone will tell a story about.

### Missions

Missions are how the funnel reaches the player, and they are **data, not code.** A
mission is a list of steps over a small verb set:

    go_to · land_at · scan · collect · deliver · return

Same shape as night-shift's mission chain, same verify harness pattern.

Two layers, again:

- **Derived.** Every station has a board, generated from its seed and the economy:
  fetch N of X, carry this from A to B, survey that planet. Infinite, cheap, the
  ordinary texture of making a living.
- **Authored.** Hand-written missions that *are* the trail to rare and legendary sites.
  A derived mission tells you where iridium is. An authored one tells you someone heard
  a signal near the south pole of a planet nobody lands on.

### Space has to have a reference frame

Found on the second flight: with no drag, no stars and a camera built for the horizon,
leaving the atmosphere meant accelerating into nothing with no way to tell which way was
back. Escape velocity on a 2 km world is 167 m/s and boost gets you there in five seconds.
That is correct physics; the game just gave you nothing to do about it. So:

- **Stars, sun, a sky dome** with a horizon gradient keyed on the local up and the sun.
  Orange toward a low sun, navy at night with the stars out, transparent in vacuum. An
  8-minute day. All at the scene root, which camera-relative rendering makes free.
- **Nav markers**: planet, prograde, retrograde, pinned to the screen edge with an arrow
  when off-screen. "Where is the planet" always has an answer.
- **Attitude assists**: X points the thrust axis against velocity, Z points it at the
  planet. They play the same keys a pilot would; the physics does not change. A pure
  P-controller balances forever if the target is dead astern, which is exactly the state
  after boosting straight up, so it pitches over from there on purpose.
- **Readouts** against orbital and escape speed at the current radius, with ESCAPING
  called before it is too late.
- **The camera** locks to the ship's frame in vacuum, blending from the horizon follow as
  the air thins; position smoothing stiffens with speed so the ship cannot outrun it.
- `GRAVITY_FALLOFF` is a dial (2 is real) if space still feels too easy to lose.

The sun currently goes round a fixed planet. That is a placeholder the solar system
replaces.

## 5b. The solar system (asked for 2026-09-01, not yet built)

Several planets round one sun, fly between them once out of the atmosphere, and leave
the system to enter the Elite half. Two positions taken before a line is written:

- **Planets follow analytic Kepler orbits, not N-body integration.** Kepler *is* the
  physics of two bodies, it is exact, it is a pure function of the seed and time, and
  it never drifts. Integrating N bodies would break "the universe is a function" within
  an hour of play. The *craft* feels gravity from every body, summed; that is cheap and
  it is what makes a transfer real.
- **Planets spin.** Day and night come from rotation, and each atmosphere co-rotates so
  hovering still over the ground stays natural (drag is against local air, not against
  the inertial frame). Landed, the craft rides the planet; lifting off, it inherits the
  surface velocity.

What that costs: the craft's position becomes heliocentric float64 with planets moving
under it; height queries transform into each planet's rotating frame; every body gets its
own seed, radius, atmosphere and LOD; nearest-body logic picks which sky and which
altimeter you get. Frontier's structure.

**The roster (Chris, 2026-09-02):** the real inner solar system plus Jupiter, at 1:159,
"based on Mercury, Venus, Earth and Jupiter, and the moon on Earth". The fiction's names,
the real numbers. The 2026-09-01 toy roster (five invented planets, nine moons at
hundreds of km) is gone; Jupiter's Galilean moons and the rest can be added the same
way when wanted, they are one line each.

| Body | Is | Radius | Orbit | Air | Surface g | Year |
|---|---|---|---|---|---|---|
| Sol | the Sun | 4,370 km | | | 274 | |
| Cinder | Mercury | 15.3 km | 364,000 km | none | 3.7 | 7 days |
| Marram | Venus | 38 km | 679,000 km | 4 km, thick | 8.9 | 18 days |
| Vale | Earth, home | 40 km | 939,000 km | 2 km | 9.8 | 29 days |
| Vale I | the Moon | 10.9 km | 2,413 km from Vale | none | 1.6 | 2.2 days |
| Bulwark | Jupiter | 439 km | 4.89 million km | 40 km, no surface | 24.8 | 344 days |

**Physics-law-abiding means:** every body has `GM = g·R²`; every orbit's period comes from
Kepler III, `T = 2π√(a³/GM_parent)`; the moon sits inside a third of home's Hill radius
(it is at a quarter, as the real one is) so the craft feels the planet, not the sun, near
it; nothing overlaps. The sun's gravity is the real 274 m/s² at its surface; at home's
distance it pulls at 6 mm/s², so it matters for transfers and nothing else.
`verify-system` asserts all of it.

**Stages:** A, the system model and its instrument, pure and headless. B, render every
body with a floating origin, LOD on the near ones, plain spheres far off, the sun as a
mesh and a point light; a free-camera tour. C, the craft in the heliocentric frame with
summed gravity, per-body atmosphere, landed-rides-the-planet; `verify-flight` ported. D,
body targeting on the HUD (Tab cycles), distance and closing speed, sphere-of-influence
readout, a lock-view camera that keeps the ship in the foreground and the target framed,
and the escape-the-system trigger for the Elite half.

## 5c. Seas, mountains, canyons (built 2026-09-02); forests (not yet)

Chris: *"proper canyons, lakes, mountains, like a planet. SEAs, oceans."* All of it is
terms on `height()`, still evaluated on the unit sphere and nowhere else:

- **Warp.** The coordinates are bent by a slow noise before anything samples them, so
  coastlines and ranges meander instead of looking like noise.
- **Continents** from the shaped broad field, and a **sea level per body** (`seaLevel` in
  the roster, home at datum). Every basin below it fills: seas, oceans, and lakes where
  the land dips. 42% of home is under water.
- **Mountains**: a ridged multifractal (crests on the noise's zero crossings, each octave
  weighted by the last) in belts from a mask, standing only on land, reaching `MOUNTAIN`
  (2.2) amplitudes above the plains. Highest point on home is 442 m.
- **Canyons**: a thin inverted ridge line, cut `CANYON` (0.6) amplitudes into plateaus
  away from the ranges.
- **Water is ground.** `groundRadius` is the sea where the land is below it, so you can
  put down on the sea and float, level. The pad search only accepts dry land.
- **The sea is drawn by the same LOD** as the ground, with a flat height and a water
  shader: facets ride three slow swells, the normal comes from the position derivatives so
  the flat shading moves, the colour turns from deep to pale with the view angle, and the
  sun glints off whichever facets face it. A water chunk whose ground is all above the
  sea builds to nothing and is remembered as nothing.
- **Palette** by height above the sea in units of amplitude: sea floor, sand, plains,
  forest green, upland, tan, stone, snow. The far sphere paints the sea blue.

The terrain harness holds the declared bounds, an ocean fraction between a third and
two thirds, mountains above twice the amplitude, no cracks on simplex boundaries, and
continuity across all 24 face edges to a millimetre at a nanoradian. The flight harness
puts down on deep water and floats.

**Forests (built 2026-09-02, "like big bunches").** `src/world/forest.ts`: a chunk at LOD
level 8 or finer on a living world gets one InstancedMesh of a shared six-sided cone on a
trunk, placed by a seed hashed from the chunk key, one tree per 30 m² where the height
band is forest (0.04 to 0.85 amplitudes above the sea), the slope under 22° and a clump
mask (cells of a kilometre or two) says so. It hangs off the chunk mesh, so it appears
and retires with the chunk and the shared geometry is never disposed. Known: forests
start where level-8 chunks start, a few hundred metres out; further off the palette's
forest green stands in for them. The chunk harness holds that some chunk grows more
than fifty trees, the same chunk grows the same trees, every tree stands in the band,
and water and coarse chunks grow nothing.

**The water under the land is still.** Every water vertex carries (depth, deepest water
in the chunk). Nothing displaces where the land is above the water, or the beach seems to
move; swell and shore ripple need a real body of water (a chunk whose deepest point is
past 6 m), so ponds lie flat. Chris's call, 2026-09-02.

## 6. Instruments, before the game

Most of this is invisible, so it gets measured rather than eyeballed.

| Harness | Asserts |
|---|---|
| `verify-terrain` | `height()` deterministic, bounded, continuous across all twelve cube-face seams |
| `verify-chunk` | every skirt quad hangs from a real surface edge and carries its owner's normal and colour |
| `verify-lod` | scripted orbit-to-deck descent in the browser: chunk count bounded, level 0 in orbit, level 6 on the deck, tree stable at rest |
| `verify-flight` | drives the physics in Node, no browser: rests, lifts, crashes, terminal velocity, a bang-bang autopilot lands, the same run is bit-identical, tilt-to-move works, control pulses decay, boost and ground effect, escape and the retro/nadir assists |
| `verify-loop` | launch → orbit → transfer → descend → land → scoop → return → sell |

## 7. Build order

Every step is playable. That's the point of the ordering.

1. **Sphere with LOD, no ship.** Free camera. Terrain right, seams closed.
2. **The craft, and the flight model.** Land it on a flat bit. Make or break.
3. **Take off and keep going.** Watch it become a ball. Seamless proven.
4. **Scoop.** One seed-derived resource, one hold.
5. **Second world.** Transfer, land, sell. The full loop, as slice five rather than slice one.
6. **Sites and tiers.** Derived points of interest, hashed to rarity. A scanner that funnels.
7. **Mission board.** Derived fetch / deliver / survey from station seeds.
8. **Authored missions and eggs.** The trails to the thirty rares and the three legendaries.

## 8. Known and left alone

- **The terrain is flat.** After the rescale 100% of home is under 15° and the steepest
  slope is 15°. Real, and dull from the deck. The relief dial (200 m) and the detail
  octave's weight are where to push when the look matters more than the physics does.
- **Re-entry is a cliff.** A full-boost dive is handed from cruise to hover at 2.5 km
  doing 1,600 m/s. Step 4 in §8b.

- **LOD seams show under grazing light.** At dawn and dusk the facet normals on either
  side of a level boundary differ enough that a whole chunk reads a shade brighter. Not
  visible at any other hour. Options if it ever matters: higher `SPLIT_K` so the boundary
  is further away, or blend normals across the boundary row.

## 8b. The order from here (agreed 2026-09-02)

1. ~~**Rescale to 1:159.**~~ Done 2026-09-02, all six instruments green (terrain 8, chunk 12,
   flight 23, system 11, lod 16, shot). LOD went to level 10 for ~5 m vertices on the deck;
   peak 203 chunks on the orbit-to-deck descent. A deck-scale noise octave in absolute
   metres (600 m cells down to 150 m) keeps the ground from going billiard-ball.
2. ~~**Stage C: the craft in the sun's frame.**~~ Done 2026-09-02, after Chris hit it a
   second time ("I get to 50 km from another planet and can't land, it just gets stuck").
   The truth is now heliocentric (`Craft.hpos/hvel/hquat`), gravity is summed from every
   body, the reference body is chosen by sphere of influence with 5% hysteresis, and
   everything outside the craft reads a local view in that body's rotating frame with a
   ground-relative velocity. Landed means riding the body; lift-off inherits the surface
   velocity because there is nothing else it could do. Ship, shadow, dust and camera
   re-parent to the reference body's group when it changes. `?over=home-1:300` starts you
   over the moon. **What the harness caught, all of which would have shipped:** the
   ground-effect cushion was a fixed 2.5 m/s² and out-pushed the moon's 1.62, so the craft
   floated two metres up forever (now a fraction of local g); an inertial attitude drifts
   9° a minute against a 40-minute day, so near the ground the attitude holds against the
   ground and by 5 km it holds against the stars; hover has to engage by altitude as well
   as density (`CRUISE_FLOOR`, 2.5 km) or an airless moon is unlandable; and **the noise
   kernel was 0.6**, the reference layout's value, which leaves the field discontinuous on
   every simplex boundary and put a 12 cm step in the ground exactly under the pad. It is
   0.5 now, the terrain harness checks for cracks, and the universe is SEED_VERSION 3.
3. ~~**Supercruise.**~~ Done 2026-09-02. Far from anything the cap is distance to the
   nearest surface over `CRUISE_SECONDS` (7 s), so at full speed you are always seven
   seconds from the nearest thing and the same rule reels you in; inside ~50 km the old
   brakeable-from formula takes over and lands you at 150 m/s. A target within 30° of the
   nose caps the same way off its surface, so you arrive at what you aim at. Thrust spools
   so full throttle reaches whatever the cap is in `CRUISE_SPOOL` (4 s). The rotating
   frame's velocity fades out above 5 km (`Craft.hold`), because the sun's co-rotating
   frame at home's distance moves at 650 km/s. Measured: home to 60 km over the moon in
   39 s with a 169 km/s peak; 5,000 km out, 20 s of boost reaches 5,563 km/s. Elite
   Dangerous's answer, and the right one.
   **Second pass, 2026-09-03, from Chris's first evening at the moon:** "getting into the
   close proximity of the moon quite hard, needs a more shallow entry and a way of getting
   the craft close to the surface ... the craft went in at the wrong angle ... the top
   thrust didn't really do much, was a hassle not fun." The near-body cap was referenced
   to the ground (150 m/s at the surface), so at the 2.5 km hover floor it was 1,600 m/s,
   and the harness had that written in as the pass condition. On an airless moon nothing
   slows you after the hand-off and hover has 18 m/s²: 1.6 s to the ground. **The body cap
   is now referenced to the floor:** 60 m/s at the floor, √(60² + 2·500·(d − floor)) above
   it, (d − floor)/7 s far out (`Craft.bodyCap`, `CRUISE_FLOOR_SPEED`). Cruise brings you
   to the floor at 60 m/s in whatever direction you were going, so a shallow approach
   works: cruise round at 3 km, dip the nose, arrive in hover at walking pace with time to
   tilt and land. Rocks keep the old surface-referenced profile (`cruiseCap`, 150 m/s at
   contact); the target cap uses whichever fits the target. The reference body's gap is
   its real altitude now, not the distance to its sphere, so mountains count. The harness:
   the moon hands over at 61 m/s at 2,497 m and a plain tilt-and-descend lands from there;
   the full-boost dive on home hands over at 65 m/s. The "top thrust did nothing" was the
   cruise brake bug found the same evening (it pushed backwards without limit).
4. ~~**Re-entry.**~~ Done 2026-09-03 (`config.ts` HEAT_*/HULL_*/HOVER_MAX_SPEED,
   `Craft.hull/damage/burned/heatTarget`, flight harness 26), built on the research
   report's XRVessels findings rather than the line above. **Hull heat is an equilibrium
   temperature the hull rises toward** (3 s), not an integral, so it is stable at any
   step; the target is HEAT_K · √ρ · v³ · ramp(ρ). The square root is Sutton-Graves (the
   real flux; it is what makes thin air bite). The ramp is XRVessels' conductive cooling:
   it falls to a tenth in thick air, so 300 m/s on the deck is 6% of the limit while
   500 m/s in the upper air is over it. Cooling is 2% of the excess a second (a hull
   stays warm for minutes). **Over the limit, damage accrues** at ((T/limit)² − 1)/8 a
   second, the expectation of XRVessels' dice, and at 1 the hull is gone: a crash flagged
   HULL BURNED THROUGH. Docked at a station it is repaired at 5% a second. **Hover does
   not engage above 250 m/s ground-relative**, whatever the air: above it you are still
   re-entering, in cruise, with drag on and the hull heating, and the way out is to flip
   and brake. The HUD shows HULL % (amber past 80%, red over), DAMAGE, and says
   RE-ENTRY: flip and brake while you are in cruise in air; the hull glows orange from
   39% of the limit to 80%, the same numbers as the gauge. **What the harness settled:**
   the full-boost dive that used to be handed to hover at 1,590 m now burns through at
   564 m doing 506 m/s; a braked entry, 380 m/s into the air then the brake to 249, comes
   through at 21% with no damage; heat goes as √ρ and v³ in the shape check. **What it
   found:** the cruise brake pushed you backwards without limit when held (the entry
   craft was at 5 × 10¹⁸ m); it now stops at zero along the nose. **Then the moon pass
   (item 3, second pass) moved the cap to the floor, and re-entry moved to Marram:** home's
   air (2 km) lies under the hover floor (2.5 km), so coming home is benign, which is right
   for the first rung; Marram's air is 4 km deep, so the last 1.5 km of cruise is in air
   at up to 1,200 m/s, and that is where re-entry lives. HEAT_K 4e-5, HEAT_TAU 2 s. The
   harness: a full-boost dive into Marram burns through at 2,580 m; a braked entry held at
   300 m/s comes through at 25%. The heat shield (a purchasable that raises HULL_LIMIT) is
   the gate to Venus, as §10b says. There is no shallow coasting entry in this flight
   model, because the cruise assist bleeds gravity's pull off your velocity along with
   everything across the nose; every entry is a dive whose speed the cap sets, and the
   corridor is a speed you hold with the brake against a gauge that shouts. The giant's
   40 km of air will be the same thing with no floor to land on. DRAG stays at 0.004.
5. ~~**Orbit autopilot**~~ Done 2026-09-02 (`src/engine/Autopilot.ts`, the O key). It flies
   the pilot's own controls: under the floor it climbs; in cruise it wants a velocity,
   inward at gap/30 s blending into circular speed sideways as the gap closes, and since
   velocity follows the nose in cruise the nose goes where that velocity should be and
   nowhere else, with thrust and brake setting the magnitude. The first version aimed at
   the velocity error and the assist bled the orbit away; the harness saw it take 400 s
   and oscillate. Parks 6 km up (or 1.5 airs, or a tenth of the radius): over the moon
   from 150 km in 218 s, over home from 400 km in 239 s, holds to 80 m for ten minutes.
   Any control releases it. Snow went in the same commit: a snowline at 1.8 amplitudes
   falling to the shore at the poles, feathered, and it does not stick to cliffs.
   **Second pass, later the same day**, from Chris: "the thrusters kept flickering", "I was
   coming in on a sideways angle", "speed it up slightly", "orbit on smaller planets needs
   to be lower". The approach now aims along the line from the craft that grazes the
   parking circle (`sin a = r_park / r`), so the path curves in and arrives tangential; the
   wanted speed is circular plus gap/12 s, capped; a deadband either side of it and
   smoothed throttle commands stop the chatter; the park height is 1.5 airs or 1.2 floors
   plus 8% of the radius (moon 3.9 km, home 6.2 km, giant 95 km). Parks from 150 km over
   the moon in 100 s (was 218) and from 400 km over home in 81 s (was 239). The harness
   counts throttle flips during the hold.
6. ~~**Weather, clouds and tides**~~ Done 2026-09-02 (`src/world/weather.ts`, `Rain.ts`,
   `Clouds.ts`). One slow seeded noise in position and time per body is the FRONT, -1
   calm to +1 storm. Wind blows along its contours (rotated gradient: divergence-free, it
   swirls round systems) at 4 to 30 m/s with gusts, and the craft feels it through drag
   against the moving air. Rain is streaks in a box round the craft where the front is
   high; clouds are a shell at 0.6 airs whose faces take cover from the same front,
   refreshed 256 faces a frame, so what is overhead is what is falling; under cloud the
   sun dims, the fill greys, the fog thickens. The tide is the moon's two bulges, 2.5 m
   (the real equilibrium tide at 1:159 is three millimetres), in the physics through
   `seaSurface` with a ground clock the craft sets, and in the water shader. Chris's
   correction held: every water vertex carries its depth, the swell only builds past
   4 m and the tide past 10 m of water, so ponds and lakes lie flat; the shallows get a
   short ripple running in toward the beach that breaks into foam. DRAG went from 0.012
   to 0.004 (a 50 m/s terminal velocity, a vehicle rather than a feather) because a gale
   against the old value would have shoved the craft at 11 m/s². The harnesses hold the
   wind tangential and bounded, the tide's range, no wind on the moon, a gale pushing a
   falling craft downwind and a calm not, and the craft floating on the tide.
7. ~~Forests.~~ Done 2026-09-02.
8. ~~**The pad, the puffs, the livery, the gear.**~~ Done 2026-09-02, from Chris's first
   evening of flying the update, his words in the commit. **The pad** is the first authored
   shape: `padOf()` spirals out from (0, 0, 1) for a dry, flat, forest-free site 25 to 140 m
   above the sea, `height()` flattens a 22 m disc there and ramps back over 18 m, trees keep
   65 m clear, and `Pad.ts` paints a grey octagon with a ring flush with it. **Puffs**
   (`CloudPuffs.ts`): low-poly blobs at cloud height in a field of ~500 m cells round the
   camera, seeded per cube-sphere cell so they stay put, present and sized by the front;
   the shell fades out within 9 km so nobody looks up at its kilometre faces again. Then
   Chris: "like someone has been blowing bubbles, we need them to be proper weather
   systems." So the puffs became cumulus: each site grows four to twelve overlapping lobes
   cut flat underneath and sat on the cloud base, so a cluster is one deck with a lumpy
   top; lobe count, size and spread grow with cover so heavy cover merges into overcast;
   a finer drifting field (`cloudDetail`, `cloudCover`) breaks a system's deck into masses,
   streets and gaps; clusters stretch along one heading. The shell is gone below 3.5 km
   of camera altitude, where its faces showed edge-on at the horizon. Rain
   streaks are longer and brighter. **Livery** (`craftMesh.ts`): every hull face split into
   sixteen panels shaded a few percent apart, a navy spine stripe, a tinted canopy, a white
   belly stripe, two nozzles, red and green wingtip lamps. **Gear**: three skids to the real
   contact height (the hull hung 85 cm over its own shadow before), hinged groups that
   retract above 100 m over the ground directly below (the altimeter's number, so mountains
   count) and drop below it; the contact shadow stays on when landed. **Trees** shrink into
   the ground between 500 and 1,500 m from the camera (a vertex-shader scale on each
   instance) and exist one LOD level further out, sparse and half again as big, so a forest
   sinks into the palette's green instead of switching off with its chunk.
9. ~~**The TIE morph.**~~ Done 2026-09-03, first thing, because Chris asked for it that
   morning ("the ship should morph into a different shape when it goes into space, more
   like a tie fighter"). Four hexagonal panels hinged at the wingtips, an upper and a
   lower each side, lie folded into the wing as stubs in air and swing out to vertical
   in cruise over about a second and a half; two boosters slide out of the tail and carry
   the cruise flame, so the engine fires backwards in space and downwards in air, handing
   over halfway through the morph. Driven from the craft's existing cruise flag
   (`craftMesh.ts` `Morph`, `main.ts` `morphed`), no key. The two ships are visibly two
   ships, and the fold on the way back in is the Starship flip re-entry will need.
10. ~~**Fuel.**~~ Done 2026-09-03 (`config.ts` FUEL_*, `Craft.fuel/burn/endurance/onPad`,
   flight harness 23). A tank of 100 units; the hover engine burns 0.25 a second at full
   thrust (twelve minutes of hovering at home), the cruise drive 0.4 (the cap is reached
   in four seconds and coasting is free, so home to the moon at full boost is 42 units),
   boost multiplies burn the way it multiplies thrust, the cruise brake burns like the
   drive, the RCS sips. Chris: "not sure why fuel is so complex, but we'll need ways to
   refuel without annoyingly running out of fuel." So: **any pad refills you on touchdown**
   (full in 20 s, free until money exists); **landed anywhere else the solar cells
   trickle** (0.1 a second, a dry tank has 40 s of full thrust after 100 s on the ground),
   which is the reserve that means a dry tank never strands you, only delays you; in the
   air the engine dies with the last drop and on the ground it needs one unit to relight;
   the HUD shows the tank, the endurance at the current burn, LOW under 20% and DRY.
   Respawn is a full tank. **Not yet:** the point-of-no-return beeper, the nearest-refuel
   nav marker, a tank you can buy bigger, night stopping the trickle, and stations.
11. ~~**Asteroids and the gun.**~~ Done 2026-09-03 (`src/world/asteroids.ts`,
   `src/engine/Asteroids.ts`, `Craft.fire/rockNear/placeNearRock`, system harness 8,
   flight harness 24). Chris: "in No Man's Sky you could fill up by destroying asteroids,
   can we have asteroids that we destroy too, make it a bit more challenging to find what
   you need, cos we'll have fuel stations as well." Twelve fields as a function of the
   seed, riding Kepler orbits like the bodies: home's and Marram's Trojan clusters at L4
   and L5 (60° ahead and behind on the planet's own orbit, 70 rocks in 40 km, where real
   Trojans sit) and eight clumps of 150 in a main belt at 2.1 to 3.2 of home's distance.
   Every rock has a fixed offset in its field's orbiting frame, so a cluster keeps its
   shape; rocks are sparse (nothing within eight radii of another). Ice is a minority
   (22% at home's Trojans, 45% in the belt) and reads as ice only up close: pale and
   faintly lit against stone, and the HUD names it inside 2 km. A rock is a surface to
   the cruise cap and a wall to the hull: fly into one and you are wreckage on it. **The
   gun** (F, hitscan to 3 km, four shots a second) takes one hit off a rock per shot, one
   plus a hit per 40 m of radius; when a rock breaks its facets burst outward and, if it
   was ice and within 3 km, half a unit of fuel per metre of radius streaks to the tank
   (a 100 m ice rock is half a tank). Stone gives nothing yet; that is ore, later. Broken
   rocks stay broken for the session. Fields are Tab targets after the bodies.
   **Second pass, same day**, from Chris: "shooting looks like shit, need to see more a
   projectile shot, plus need random asteroids out in space, lots of clusters of them,
   they can appear from anywhere, not just in belts" and "we need there to be more seeded
   loads here too, we originally built this to be more random, is that still possible?"
   The gun fires **bolts** now: from alternate wingtips at 900 m/s on top of the ship's
   velocity, dying at 3 km, five a second, swept against the rocks each substep **in each
   field's own frame** (swept heliocentrically the first version flew straight through a
   rock and registered on the way out, because the field moves at 2.4 km/s sideways and
   the rock is held still for the step). On screen a glowing rod with a bright core, a
   spark flash where it strikes. And the sky is fuller: **240 drifting clusters** of 8 to
   40 rocks on their own orbits, tilted up to 30° out of the ecliptic, from inside
   Cinder's orbit to beyond the belt, any that would ever pass through a sphere of
   influence rerolled; and **rings** of 6 to 20 rocks orbiting home (six, from 620 km out)
   and Marram (three), inside the sphere of influence and clear of the moon, so there is
   rock within a minute of the pad, with less ice than the deep clusters. 261 fields,
   7,158 rocks, all from the master seed: random and seeded are the same thing here, and
   the harness proves the sky rebuilds identically. A field is a frame in any body's
   sphere now, as its velocity over the body's own, fading with `hold` near the ground. **Three
   things the build caught:** a field is a frame (in the sun's sphere its velocity blends
   into the frame's within three spreads, or the cruise assist bleeds your co-orbital
   speed and the rocks stream past at 1.6 km/s); the ship cannot be a child of the
   reference body's group in the sun's frame (939 million metres in float32 puts it 100 m
   from where the camera looks; it now sits at the scene root, placed camera-relative in
   float64); and the chase camera has to smooth its offset from the craft, not its
   position, because the sun's rotating frame carries the craft round at 600 km/s and an
   absolute lerp trailed 90 km behind. **Not yet:** fuel stations (Chris's brief), ore
   from stone, a scanner, rock persistence across sessions, wreck-on-a-rock riding the
   field properly.
12. ~~**The home station.**~~ Done 2026-09-03 (`height.ts` `stationOf`/`findSite`,
   `engine/Station.ts`, `Craft.padHere`, terrain harness 10, flight harness 25). The
   second authored place, built the way the pad was: a site search (flat over 40 m, dry,
   25 to 140 m above the sea, forest-free, at least 15 km from the outpost pad, spiralling
   out from a seeded direction 32 km round the body) and a 110 m disc flattened to one
   height with a 30 m ramp. On it: four pads 62 m out at the compass points, each a slab
   with a ring, four lamps and one to four yellow pips for its number; a half-buried dome;
   a tower with a beacon that pulses; sixteen edge lights. The pads are placed by taking
   their directions into the mesh's local frame, so paint and physics agree. **Landing on
   a numbered pad docks you** (the altimeter says DOCKED PAD 2) and refuels at the pad
   rate; on the disc but off a pad you are down, not docked, and only the sun feeds you.
   Stations are Tab targets between the bodies and the fields, and inside 5 km the marker
   clears you to the nearest pad, which is the surface-station version of the docking
   computer the research report found in Oolite (a waypoint table, not a controller).
   Home's is 38 km from the pad. Every terrestrial body with land gets one. ?station=N
   starts you on pad N (0 hangs you over the dome). **Not yet:** the shop (fuel for
   money, tank II, the heat shield), repair, cargo, the Coriolis in orbit.
13. ~~**Sound, and Dawn Shift.**~~ Done 2026-09-03. Chris: "the noise of the ship is
   annoying" (it was a square-wave altimeter blip under 80 m whenever you flew), then "I
   want the game to feel more epic, No Man's Sky has some great intro moments ... an epic
   explore", then "when I zoom in and out with the camera, we need the sound effects to
   go up and down", "once you get into space there would be no sound right?". **Sound**
   (`engine/Sound.ts`, all Web Audio nodes, no files): brown and pink noise through a
   lowpass that opens with the throttle plus a sub tone for hover; two detuned tones for
   cruise; wind by airspeed and air; RCS hiss; rain patter; servo whir and a clunk for the
   gear and the wings; a falling zap per bolt, a crunch on a strike, a bigger one on a
   break, a chime when fuel arrives; a thud on touchdown; a sine altimeter only on the way
   down. The camera is the ear (volume by zoom), a lowpass closes down in vacuum and the
   engine falls to half there. The research report (`research/sound-and-opening-*.md`,
   40 sources) backed the approach: ZzFX for one-shots if we want them, Kenney CC0 as the
   reference to tune against, pink and brown noise through a throttled lowpass as most of
   a spaceship. **Dawn Shift**, the opening the report proposed and Chris chose, on by
   default on a plain start (`?intro=0` skips it): clock at 0, 103 s before the pad's
   sunrise. Black to a cold ship on the pad, no HUD, the camera drifting, one line: PAD 01
   . LOCAL 00:00 . SUNRISE 01:01. Any key: the reactor spins up (a four-second sweep under
   a thump) and the HUD boots element by element with a click each (attitude, altitude,
   fuel, state). Hover only, cruise locked, a drone note under everything. When the sun
   clears the apparent horizon the pad music adds a fifth; forty seconds later the octave,
   the filter opens, the station becomes the target, the marker appears for the first time
   with STATION . 38 KM, and the HUD is whole. To make the night a night, the local sun
   is now a light that sets (a point light has no planet in the way and lit the pad from
   under the horizon) while a second sun on the far bodies' layer keeps the moon's phase;
   the fill's floor is 7%. Also that evening: **fuel lasts four times as long** (Chris ran
   dry at the moon: burn rates quartered, 49 minutes of hover), and **distances to other
   places read at the model's scale**: the factor grows with the log of the distance from 1
   at 500 m to 159 by 100 km (`shownDistance`), so 100 m over the pad reads 100 m, the top
   of the air 4 km, a parked orbit 40 km, and the moon 384,000 km, no seam; speed, ETA and
   anything on the same body stay honest ("scale realism without the actual size"; "would
   it scale better if it was log scale ... begin to expand it when it gets to 500 m"). The cannons deploy with the wings and fire only in cruise; the orbital cloud
   shell is drawn per pixel by noise. **Not yet:** the fall from 40 km as the payoff of the
   first flight out (the report's candidate B), a music cue on first orbit, ZzFX one-shots.
14. ~~**The landing assist.**~~ Done 2026-09-03 (`Craft.assist`, `assistLanding`, flight
   harness 27). Chris: "if I dive head first into it, it should auto brake so I don't crash
   and smooth its way to the surface, it shouldn't be a skill thing if it's that easy to
   need a restart." In hover under 500 m, three rules, in order: **the floor**, whatever
   your hands are doing, never lets you fall faster than 2 + 0.11 × height m/s (it levels
   the ship and burns, boost if it is far over); **low and leaned over** while sinking under
   60 m it takes the attitude and keeps it (a latch, so a held stick cannot re-tilt it
   between touches of the floor), holds height while it kills the drift, and comes down on
   the profile with the lean fading out over the last 25 m so the touch is upright;
   **hands off** and sinking under 400 m it flies the whole landing, down at 1.2 + 0.07 ×
   height m/s, touching at about a metre a second. It cannot burn a dry tank and it cannot
   help where the engine will not lift the ship (the giant). The HUD says ASSIST while it
   has the controls. Harness: hands off at 300 m lands; a 38 m/s head-first dive with hands
   off lands; full pitch held into the ground lands upright; the same dive with the assist
   off is a crash, so the assist is doing the work; and a crash-respawn-take-off lifts
   straight, which it always did in the model, so the "head first into the floor" on
   respawn was most likely a held T or Z aiming the thrust at a target below the horizon
   from the pad: the aim assists now wait until 40 m up in hover. **Found on the way:**
   calling `tilt()` inside the substep overwrote `up`, the substep's scratch, and tipped
   the ship 65° into the ground; and the assist was firing the engine after the dry-tank
   gate. Falling with the assist off is still fatal (harness 3), which is the wreck
   crashes will want.
15. ~~**The outpost.**~~ Done 2026-09-03 (`engine/Base.ts`, `BASE_RADIUS`). Chris: "put a
   base around the starting landing pad, make it look quite densely populated and to
   scale based on the size of the ship." The pad's flat ground is now a 130 m apron with
   a 40 m ramp (the site search asks for flat over 40 m and looks three times further).
   On it, seeded from the body: a ring road and an outer road with six radial paths, two
   hangars with barrel roofs and 12 m doors toward the pad (the dart is 6.6 m across),
   thirty habitat blocks stacked one to three storeys with lit panes, seven domes, four
   fuel tanks on a walkway with orange bands, a 34 m comms mast with a turning dish and a
   blinking red light, lamp masts round both roads, approach lights round the pad, a
   perimeter fence with gaps for the road, pipe runs on trestles, seventy crates. Lamps
   and windows come up at night. Every body with a pad gets one. `?over=home:230` now
   hangs you over the pad, so it is the base from the air.
   Next: crashes with debris and a repair bill, then cargo.

## 9. Deferred

- ~~A button that morphs the ship into a TIE-fighter-like ship~~ Built 2026-09-03 on the
  mode switch, not a key (§8b item 9).

- **Is space flight Newtonian or Elite?** (Chris, 2026-09-01: "ship's behaviour needs to
  change once in space, but let's get more in space first.") Newtonian is what exists:
  no drag, you coast, the retro assist and the thrusters are how you stop. Elite's ships
  had a set speed and stopped when you throttled down, which is not physics but is very
  playable. Decide once there are planets to fly between; possibly a flight-assist you
  can switch off rather than a change of model. **Measured 2026-09-02:** the
  velocity-follows-the-nose assist (`CRUISE_ALIGN_TAU` 1.2 s) already makes it Elite, not
  Newton: the harness kills 863 m/s of escape velocity in 10.7 s with only 2.8 s of retro
  burn, because turning the nose through 180° bleeds the old velocity away. If "realistic"
  is the brief, that assist becomes switchable.

- How interplanetary travel compresses (jump? time accel? both?)
- Combat, or whether there is any
- Whether the radius dial ever gets turned past 20 km
- Exact universe size. 2,000 systems is Elite's 8 × 256 and a sensible default; it sets
  the rarity counts, so it gets fixed before authoring starts.

## 10. The think for 2026-09-03 (Chris's brief, evening of 09-02, my ideas, not yet agreed)

Chris: "more realistic crashes ... what items we need to be picking up for trade ... trade
stations on every planet, and in the solar system, and plans to go light speed to other
systems in the galaxy ... a way of picking up items, but those items make the ship visibly
more bulky, so part of the puzzle will be to work out how much you can carry without making
the ship more difficult to fly ... puzzles a bit like carry the rabbit, the wolf across the
water on a boat but can only carry one at a time."

**Order I'd build in, and why.** Re-entry first (it is one evening and it makes coming home
from the orbit you now park in the hard part). Then crashes and cargo together, because they
are the same physics: mass, inertia and damage on one rigid body. Then the first station,
because trade needs a place before it needs a price. Then the economy. Then jumps, because a
jump needs the roster to become a function of a seed, which is a refactor best done last.

**Crashes.** Today a hard contact is a flag and a two-second respawn. Instead: impact energy
from the contact's vertical and lateral speed against the limits gives damage 0..1. Under a
threshold it is a hard landing: gear bent (stuck down, a limp on the pad), a thrust
vibration, a cracked HUD, the beeper sulking. Over it, a wreck: the hull's own facets (we
already build it as separate triangles) tumble off as little rigid bodies with gravity and
bounce, a fireball, a dust burst, a scorch on the ground, and the camera holds on the debris
before the respawn. Into water: a splash and the hull sinks, bubbles. Gear-up landing: a skid
with sparks and damage. Terrain at cruise speed: crater dust, instant wreck. **The wreck is
persistent and seeded**: it stays where it fell, and you can fly back to it for the cargo,
which is how crashes join trade. Damage is repaired at a station for money, the first money
sink.

**Cargo and bulk.** Goods are pods that clamp visibly onto the hull, Lander style: under the
wings, then on the spine, then hanging off the tail, each a low-poly drum or crate. Every
pod adds mass, and mass is felt three ways with no new numbers invented: thrust-to-weight
drops (the climb you already know gets slower), the moment of inertia grows (pitch and roll
go heavy), and the drag area grows (the air fights you more). The HUD shows TWR for the body
you are on. **The carrying puzzle is then physics, not a slot count**: on the moon you can lift
almost anything; on the giant, 24.8 g, you can barely leave with yourself; home sits between.
Pick-up: gear down, hover within a couple of metres of a pod site, a winch/claw grabs it (two
seconds, the ship dips, the pod swings). Drop: the reverse, on a pad. A pod that falls off in
a crash lies where it fell.

**What the goods are.** Derived from the terrain, because the universe is a function:
timber from forests, water from the sea, salt from the shallows, ore from mountain belts,
crystal from canyons, ice from the airless moon, sulphur from the hot world, gas from a scoop
run through the giant's upper air, helium from the moon's regolith. Every body has a natural
supply and a station whose demand is what its world lacks: the moon wants water and timber,
the hot world wants ice, the giant's station wants anything solid. Price = base × demand /
stock, stock drifting back over time, so a route exists and then softens as you hammer it.
Missions are data over this: deliver, fetch, survey.

**Stations.** One on each body at a seeded site, built the way the pad was: an authored flat
disc with pads (each with lights and a number), a dome, a tower with a beacon that is a HUD
target, a landing that must be on a pad to count. **And one in space**: a rotating
dodecahedron with a letterbox slot, Elite's Coriolis, where docking means matching the
rotation and flying through the slot. That is the single most remembered thing in Elite and
it costs one rigid body and a rotation.

**The galaxy.** The escape-the-system trigger already planned becomes a jump. The galaxy is a
seeded set of systems (Elite had 256 to a galaxy), each system its own seed: number of
planets, kinds, radii, the sun's colour and size, all from it, the way today's roster is
written by hand. Systems get an economy type (agricultural, industrial, mining, refinery,
the Elite set) so what is cheap here is dear there and routes are worth finding. A jump:
charge, countdown, a tunnel, arrive at the new system's edge. Jump fuel is a good you buy,
so distance costs money.

**The puzzles.** The one Chris half-remembers: the wolf, the goat and the cabbage; one seat
in the boat; the wolf eats the goat and the goat eats the cabbage if left together
unwatched. In our terms: **constraints between goods** the ship enforces. Some pairs cannot
share a hull without a special pod (livestock and the predator, ore and the acid, fuel cells
through the hot world's daylight side, ice through Venus's air unless insulated, and the
insulated pod takes two slots). Some sites only let one pod down per visit. Some cargo is
heavier than the body's gravity lets you lift with anything else aboard, so you strip pods
to fetch it. A delivery of three things across a sea with two forbidden pairings is the
classic in a spaceship. **Generate and verify**: the game writes an instance (items,
forbidden pairs, capacity, sites) and a solver proves it is doable in N trips before it is
offered, which is what §5 already promised for puzzles. The three legendaries could be
puzzle chains: the relic on the giant's moon that only a stripped ship can lift, and so on.

**Where I'd push back.** "Trade stations on every planet" is right for the living ones and
the moon; on the hot world and the giant it should be one outpost each and hard to reach,
because a place you cannot easily land is the point of those places. And the light-speed
part should wait until this system is worth leaving: one good station and a working route
here will teach us more than ten empty systems.

### 10b. Progression: the ten-hour ladder (Chris, later the same evening)

Chris: "we have to get the right recipe to get light speed, like antimatter, and you can't
get that until you've been to the furthest planet in the solar system, and that's not
achievable with the fuel you have. We'll need constant progression lined in, early
progression all the way through to a 10 hour game. Maybe there will be grinding, but
that's part of these games."

**Fuel is the gate.** There is no fuel today. Add it: the hover engine and the cruise drive
burn from a tank; the tank, the burn rate and the drive's top speed are the three things
that decide what you can reach, and all three are items you earn. Reach is then a fact of
physics you can read off the HUD (range at this throttle), not a locked door. Refuel at a
station for money, or, later, crack your own from water and ice with an upgrade, which is
what makes the far bodies possible.

**The rule for the ladder:** every half hour you should hold something you did not have:
money, an item, a reach, a place, a good. Roughly twenty rungs.

| Hours | Where you can get to | The loop | What you earn | What it unlocks |
|---|---|---|---|---|
| 0 to ½ | the pad and 30 km round it | hover, scan, one pod of timber or water to the home station | the first money, the first pod | the small tank refill; the orbit lesson |
| ½ to 2 | all of home, low orbit | routes between home's stations; dock at the Coriolis | tank II, the cruise drive (5 km/s) | the moon is now 10 minutes away |
| 2 to 4 | the moon | helium from the regolith, ice; the grind route moon ↔ Coriolis | drive II (100 km/s), the insulated pod, the cage pod | Venus and Mercury in reach on fuel |
| 4 to 6 | Venus, Mercury | Venus needs the heat shield (re-entry); Mercury's day side cooks, its night side has the ice; timing the day is the puzzle | drive III (2,000 km/s), the scoop, the fuel cracker | the giant in reach, and you can make fuel on the way |
| 6 to 8 | the giant and its moons | the scoop run through the giant's upper air for deuterium; the outpost on its moon only exists once you have delivered what builds it | the containment vessel (canyon crystal + belt ore, fabricated at the outpost) | the antimatter trap |
| 8 to 10 | the jump | antimatter is bred in the trap at the outpost from deuterium and time; the drive core is bought at the Coriolis with money that only the far routes make | the jump drive: core + containment + antimatter | the first jump; the galaxy |

**The recipe, spelled out**: jump drive = drive core (bought, dear, Coriolis) + containment
vessel (fabricated at the giant's outpost from canyon crystal and belt ore you carried
there) + antimatter (bred at the outpost's trap from deuterium you scooped from the giant,
over real time, so you fly other things while it breeds). The giant is the furthest body,
and you cannot reach it until the tank, the burn rate and the drive have all been earned,
which is Chris's sentence made of numbers.

**Grind, and the two kinds of it.** The good kind is a route you have learned that pays,
flown with the whole game in it: weather, the landing, the orbit insertion, the dock. The
bad kind is waiting. So: every route pays visibly (a counter, a best time), **skill
compresses the grind** (a cleaner insertion burns less fuel, a faster landing turns more
runs an hour, gear up in cruise saves drag, all of it shows in profit), and the rare finds
already in the design (counts in a fixed universe, §5) are shortcuts up the ladder for the
curious: a crystal seam that pays three runs in one, a wreck with a pod of something you
cannot buy yet. Breeding antimatter over real time is the one deliberate wait, and it is
there so the last hours are spent flying, not standing at a counter.

**What this adds to the build order.** Fuel comes before cargo (it is the first number
that gates anything). The giant's Galilean moons come back (one line each in the roster;
the outpost sits on one). Re-entry's heat shield is a purchasable, which is why re-entry is
still first: it is the gate to Venus.

## 10c. Chris's brief, morning of 2026-09-04, after flying 09-03's build

His verdicts on the four he had not seen: Dawn Shift "was good, I liked the effect, how it
started dark then became light in an epic fashion". Wants it more epic: "you know how No
Man's Sky starts with a very slightly smaller screen then as you take off it expands." The
log-blended distances and the base are "good, I like the base". The assist he has not tried.

His additions: "We need more bases dotted around the globe too, so we can land. I'm thinking
we need some sort of vehicle that comes out the ship after landing that we can roam around
in. I'm also thinking we should be able to get a digger out and dig for stuff after using a
scanner to scan for valuables, this will all be part of the trading ecosystem."

**What I built straight away: the letterbox.** Two black bars, 11% of the frame each, in
through the dark, the boot and the hover, and they open on the climb, not on a clock: 2 m to
60 m above the pad, smoothed. `?intro=0` has no bars. Probe: hold Space from the pad and read
bar height against altitude; it must never grow while climbing and be gone above 80 m.

**Where I stand on the rest.** Bases: yes, seeded from the terrain like the forests, a
handful per living body, so the same world always has the same bases and a planet still feels
empty between them. Scanner and digger: better than the winch in §10. Scan, land, dig, carry
makes the scan the destination and the dig the wait, and it reads straight off the goods
table (ore from belts, crystal from canyons, ice from the moon). It replaces "hover near a
pod site" as the way raw goods leave the ground. The rover: a second vehicle with its own
physics, camera, controls and a deploy, and nothing to drive to yet. It comes after goods
exist, as the thing that lets you dig further from where you put the ship down.

**Built the same morning: the outposts.** Six per living body (home and Marram), each a
pad and a half-density base on its own flattened disc (100 m, ramp 40 m or wider), named
from a short list (Harrow, Kestrel, Fallow, Brine, Tallow, Sable, Moor, Wren). Sites come
from a Fibonacci spiral round the sphere turned by the seed, off the polar caps, each
spiralling out to a dry, level, tree-free spot at least 8 km from the pad, the station and
every outpost before it; on home the nearest pair is 18.6 km apart and the nearest to the
starting pad is 31 km. Drawn and lit only within 40 km of the craft, so the extra bases
cost nothing until you are near one. A `⌂` marker on the HUD names the nearest outpost on
the body you are on, with its distance, once you are 300 m off it. Landing inside its pad
radius refuels like the home pad and the readout says ON THE PAD, then its name.
`?outpost=n` starts you on home's nth outpost, `-n` hangs 300 m over it.

**The ramp rule, found by the harness.** Two of home's six outposts failed the "ramps back
smoothly" check: a 40 m blend bridging a 15 m drop makes the middle of the smoothstep
steeper than 1 in 2. The fix is a rule, not a number: every site's blend widens to three
times the biggest drop round its outer edge, measured twice because widening moves the
edge. The station and the pad were already inside the rule; the outposts' worst step went from 2.12 m to 1.44 m.

**Built the same afternoon: crashes.** Contact damage is the square of how far the touchdown
speed is over the landing limit (vertical or drift, whichever is worse), less one, times a
quarter; a breach of tilt or slope alone costs a tenth. It adds to the same hull damage
re-entry heat uses, so a scarred ship wrecks on a landing a fresh one walks away from. Short
of a whole hull it is a hard landing: the readout says GEAR BENT, the altimeter cracks (red
edge, doubled digits), the hover engine shakes the view while it burns, the touchdown dust and
scuff are bigger, and a station repair straightens it. At a whole hull, or any hard contact
with water, it is a wreck. On ground the hull's six facets leave from their own centroids
with a share of the contact velocity and a kick along their normals, tumble under the body's
gravity, bounce at 0.3, slide at 0.55 and rest; a fireball, dust and a 12 m scorch; the camera
holds and sweeps round the wreck for six game seconds, then the respawn. Into water: a splash
and the hull sinks at 1.4 m/s, no debris. **The wreck stays** in its body's frame after the
respawn, which is the hook cargo will hang on. A burn-through or a rock leaves nothing to
scatter. Numbers: 4 m/s down is the limit, 6 m/s costs a third of the hull, 9 m/s is the wreck.
Harness: flight §28 (damage shape, a 3.5 m drop bends the gear, a 12 m drop wrecks, the
pieces rest inside 20 s within 40 m and never under the ground, the sea sinks a hard contact
and floats a gentle one, a scarred hull wrecks on the small drop); `tools/probe-crash.mjs`
drives the game side. `?assist=0` turns the assist off so a drop is a drop.

Not done: gear-up landings (the gear is automatic today, there is nothing to forget) and
"repair for money" (no money yet).

**Order from here:** letterbox (done), outposts (done), crashes (done), scanner and dig, then
money and the shop, cargo pods, the economy, the Coriolis. Rover after that.

## 10d. "There needs to be more to do, lots more to do, ideas needed" (Chris, 2026-09-04, evening)

The world has places and consequences now and no reason to cross it. So the spine first:
**money and a contract board** at every outpost and the station, and every idea below is a
job type on it. Without the board each toy is tried once.

**On a planet.** Salvage: seeded wrecks of other ships on every body with cargo and a log,
some pinging a beacon (Wreck.ts already tumbles a hull; reuse it). Rescue: a stranded crew
at a random site, a front closing in, a clock; land inside 30 m on a slope in wind. Survey:
scan the tide line at high tide, a front from inside it, a canyon floor, the polar cap.
Scan and dig (Chris's brief): seams from the terrain, ore in belts, crystal in canyons, salt
on the flats, ice at the poles. Canyon runs: timed flights down a canyon floor under a
ceiling. Night freight: cargo that only moves after dark.

**In space.** Rock mining proper: ore rocks worth money, the gun breaks them, a scoop takes
the chunks. A derelict in orbit: match its orbit, dock, loot. The comet: one body on a long
Kepler orbit, mostly ice, reachable a week a year. Satellites: deliver a relay to a given
altitude and inclination; each unlocks a HUD feature (map, beacon, weather ahead). Meteor
showers on the airless moon.

**Threats.** Weather, heat, fuel, rocks; no enemies yet. One hostile type near the belts,
late, once trade is worth defending. Combat is a week; not yet.

**The long game.** Build your own outpost by delivering materials to a site you choose. The
logbook: first landings, records, route times, things you named. The mysteries: seeded ruins
with the constraint puzzles, a signal body to body, the jump recipe at the end.

**Order I'd build:** money and the board, salvage wrecks, rescue with a clock, scan and dig,
the comet. The first three reuse what works today.

## 10e. The economy brief (Chris, 2026-09-04, evening)

Verbatim: "money is going to be key to all of this, so we need to set up an economy, a
bank, other industries, maybe we can set something up like the game Transport Tycoon
where you have to set up trade routes that you have to deliver on from factories on one
planet to another, you can also arrange to do the job yourself or you can sub contract and
the sub contractor goes off, you can see him go do his route. scanning and digging is
something I want to bring in soon and there will be contracts where you have to collect
things for factories/industries etc. This can be expanded on, maybe look up on github
with an opus agent ways trade could work. We should also be able to buy stuff to expand
and improve the ship."

**My read.** Transport Tycoon's shape: industries that produce and accept goods, a chain
(ore to a mill to a factory to goods), production per period that grows if served and
shrinks if not, payment by distance and days in transit, and a company with a loan. Our
twist is that the vehicle is the physics: mass on the hull, the body's gravity, fuel,
weather, re-entry. Subcontracting is the clever bit: a route you have proven pays less but
runs without you, and the carrier is a real ship you can watch, delayed by the same
weather. Research report to come in `research/trade-economy-2026-09-04.md`.

**Later the same evening, Chris:** "Once industries get big enough, we need to see routes on
the planets underway with train lines being connected between them, will add to the trade.
You watch them be built, as the infrastructure on a planet gets bigger because of the extra
trade routes, it expands and grows out to other planets."

**My read of that.** Infrastructure is a function of delivered volume, the Tycoon rule that
a served industry grows. Each industry has a level from what has been delivered to it. At
a threshold a pair of industries you have kept supplied gets a rail line: a great-circle
track laid segment by segment over game time, visible from the air, bridges over water and
cuts through hills, and once it is finished a train runs it, a moving mesh on the arc. A
connected pair then trades on its own at a thin margin, which pushes your money to the
legs rail cannot do: between bodies, through weather, the first delivery to a place with
no line yet. When a body's network is dense enough its station launches its own freighters
on visible transfer orbits to the next body, which is how the world grows out without you,
and the subcontractor in the brief is the first, smallest case of the same idea. Cost: a
track is a line on a sphere with a height sample per segment, a train is a point moving
along it. It is cheap to draw and the harness can check that a track never leaves the
ground and a train never leaves the track.

**Money, built 2026-09-04 evening.** `src/world/economy.ts`, a Bank: balance, loan,
ledger, `spend` (refused when short), `earn`, `accrue` (interest continuous, booked per
whole credit), `borrow` to LOAN_MAX, `repay`. Craft gets `credit` (set by the game each
step) and `bought` counters; a pad sells fuel at FUEL_PRICE a unit while the credit lasts,
the sun trickles free, a station repairs at REPAIR_PRICE a hull and straightens the gear at
zero. The game charges continuously and books one FUEL or REPAIR line when the fill stops.
The panel shows the balance and the loan; the pause menu has a COMPANY block with the last
ten lines; `[` repays 500, `]` borrows 500; saved in localStorage every five seconds and on
every line, `?reset=1` forgets it. Start: 2,000 cash, 2,000 loan, 2% a day, 10,000 cap.
`tools/verify-economy.mjs` (14) and `tools/probe-bank.mjs`. Every number is a guess.

**Build order for the spine:** (1) money (done): a balance, a starting loan and interest,
credits on the HUD, fuel and repair charged, a ledger in the pause menu; (2) industries: one per
outpost and at the station, typed from the terrain, with stock, production and demand;
(3) goods and cargo pods with mass on the hull; (4) the contract board: deliver, fetch,
dig; (5) routes: a recurring contract, a bonus for on-time; (6) subcontractors: a carrier
ship that flies the route visibly for a cut; (7) the shop: tank, drive, heat shield,
pods, scanner, digger, gear; (8) industry levels from delivered volume, rail between
served pairs built over time, trains on them, then freighters between bodies.

## 10f. The economy model (from `research/trade-economy-2026-09-04.md`, with my edits)

The research read OpenTTD, Endless Sky, Naev, Pioneer, Simutrans and the Elite line in
the actual source, licences checked (all copyleft: read the shapes, write our own). What
we take, and where I differ.

**Industries as data, keyed to the ground** (Pioneer's shape). A record with a site rule
(forest, shallows, mountain belt, canyon, regolith, upper air), inputs, outputs per cycle,
and modifiers from the body (airless, hot, high gravity). Seeded, so the world always has
the same industries. One at each outpost and at the station, chosen by what the site's
terrain is. One production cycle per 200 s of game time, about one short flight.

| Good | Per cycle | Base cr/t | From |
|---|---|---|---|
| Water | 12 t | 20 | sea, shallows |
| Timber | 10 t | 35 | forest |
| Ore | 8 t | 60 | mountain belt |
| Ice | 8 t | 45 | poles, the airless moon |
| Salt | 10 t | 30 | flats |
| Helium | 4 t | 220 | regolith |
| Canyon crystal | 2 t | 480 | canyon |
| Deuterium | 3 t | 900 | the giant, a scoop run |

Consumption per station about 60% of the nearest producer's rate, so a route is always a
little short.

**Price from stock** (Endless Sky's error function, our constants):
`price = base × (1 + 0.6 × erf((demand − stock) / K))`, K = 400 t bulk, 40 t rare. Stock
relaxes 11% per cycle toward equilibrium, so a hammered route softens over six cycles and
recovers over the same. That is what §10 promised.

**Payment.** Free trade pays the spread. A contract pays
`base + tonnes × (0.9 + 0.5 × d_km / 1000) × price × f_t`, with a par time T per contract:
f_t is 1 to T, 0.5 at 2T, 0.2 at 3T, floor 0.15 (OpenTTD's four bands with our clock).
Pad to the moon's station should pay about 1,400 at par.

**Standing routes.** A contract done three times becomes a route: same ends and good, a
tonnage per cycle, 15% premium; miss two cycles and it lapses. OpenTTD's subsidy with the
timer inverted.

**Subcontracting.** No open-source game has it; Naev's escort library plus Endless Sky's
crew cost is the nearest. Ours: a real ship spawned at the source with the pod on its hull,
flying our physics on a simple controller, landing on the same pads. It takes 45% and flies
at 0.7 of a good player's pace, so doing it yourself is better per run and worse per hour.
Failure 4% plus 1% per 1,000 km, and a failed run is a wreck you can salvage (Wreck.ts).
One active subcontract early, four late.

**Where I differ.** The research wants a 5,000 loan and a 20,000 ceiling rising with each
drive tier to 200,000, 3% a year monthly, 6% overdrawn. I built 2,000 / 10,000 / 2% a
game day, and a flat insurance excess. Both are guesses; the ceiling rising with the drive
tier is the good idea and I will take it when the shop exists. **Growth** (Chris's rail
brief, §10e) sits on top: an industry's level rises with what is delivered to it
(OpenTTD's 1-in-22 monthly drift with the direction set by the share transported, made
faster), and a served pair at a threshold gets its rail.

**Upgrade ladder** (all invented, to move once a route is flown for real): tank II 4,000,
cruise drive 12,000, insulated pod 8,000, cage pod 6,000, heat shield 30,000, drive II
45,000, scoop 90,000, fuel cracker 120,000, drive III 160,000, drive core 600,000.

**Build next:** a stock number and the erf price at each station and outpost, industries
from the terrain, goods and pods with mass, then contracts, then the standing route, then
the subcontractor.

### 10e-2. The growth rule (Chris, 2026-09-04, late)

Chris: "we're not building the tracks, the tracks will get built slowly once they have the
resourcing to do it, they need different resources to do different things, then their
workers are able to freely get on with it."

So the settlement builds itself and you are its supplier. This replaces my "industry level
from delivered volume" read. The rule:

- Every outpost and station has a **works list**: projects in order, each with a bill of
  materials and a labour cost. A warehouse (timber, salt), a bigger pad (ore, timber), a
  water plant (ore), a rail spur to the nearest neighbour (ore for steel, timber for
  sleepers, a lot of both), a bridge for a spur that crosses water (more ore), a fabricator
  (crystal, helium), a launch pad for freighters (everything).
- Materials arrive by delivery, yours or a subcontractor's, and sit in the outpost's stock.
- **Workers** are the population, which grows with water and food on hand and shrinks
  without. Build rate = workers on site × (materials on hand ÷ materials needed). No
  materials, nothing happens; a full store and a busy town, the rail goes up while you watch.
- The board at each outpost is the works list with what is still missing. That is the
  contract: "Tallow needs 40 t ore and 20 t timber for the rail to Sable." No separate
  mission system.
- A finished project changes the world: the rail draws segment by segment as it is built,
  a train runs it when done and the two outposts trade on their own; the bigger pad takes
  bigger ships; the freighter pad sends the outpost's own ships to the next body.
- The goods table (§10f) is then a list of building materials and worker consumables, which
  is what gives every good a reason.

Every number is a knob. The shape is the point: you never place a track. You feed a town
and it grows.

## 10g. Resources by distance, more planets, a compass, a scanner (Chris, 2026-09-04, late)

Chris: "we do need to make collecting resources easy enough though, there will be simple
resources on our own planet, richer versions of those resources on our closest planets,
and then elite rarer resources on further ones. We'll need more planets in the solar
system I feel. Let's make it anywhere between 8 and 12. Also need an easier way of tabbing
through them, I don't like how the words just appear on screen, we need a little map on
the top showing the direction to it, and on the planet need a way of honing in on
resources, the explore needs to be adventurous and eventful, sometimes difficult."

**Tiers by distance.** Home has the plain goods (water, timber, salt, ore). The near bodies
(the moon, Marram, the red world) have the same goods richer (a seam pays two or three
times) plus their own (ice, helium, sulphur). The far bodies (the giants' moons, the ringed
world, the ice worlds) have the rare ones (crystal, deuterium, the things the fabricator
needs). Reach is fuel and drive, so the tiers are the ladder.

**The system grows to ten planets** plus moons, the real one scaled through the same 1:159:
Cinder (Mercury), Marram (Venus), Vale (Earth) and Vale I, Rust (Mars) and a small moon,
Hollow (Ceres, a dwarf in the belt), Bulwark (Jupiter) with Ember and Rime (Io, Europa),
Halo (Saturn, with rings, and Brine as Titan), Umber (Uranus), Deep (Neptune) with Sable
(Triton), Far (Pluto). Two new kinds for the look: desert (rust bands, no sea, thin air)
and ice (white and blue, a frozen sea). The system harness already checks Hill spheres,
SOI overlap and Kepler for every body, so adding bodies is data.

**The compass.** A strip across the top of the frame: every body, the station, the nearest
outposts on this body and the V cluster as ticks at their bearing from the camera, names
and distances under them, the target lit, anything behind you pinned to the edge with an
arrow. Tab still cycles; the strip is what you cycle through. The nav markers stay for the
planet, prograde and retrograde.

**The scanner.** Every body has seeded seams (a type from its tier and the ground it sits
in, a richness). A key pings: a sweep on the compass, a blip at the bearing of the nearest
seam within range, brighter and faster as you close, range that grows with the scanner
tier you buy. Land inside the seam's radius and the dig (with cargo, next) takes from it.
**Adventurous and sometimes difficult**: seams sit on canyon floors, mountain belts, polar
caps, islands, the night side, inside the storm belt; a rich seam is never on flat ground
by a pad. Events later: meteor showers on the airless bodies, storms that close a site,
a seam that only shows at low tide.

**Built the same night:** the system at fourteen bodies (ten planets and dwarfs, four
moons, §10g's roster; two new kinds, desert and ice, with their own palettes; desert and
ice worlds get pads, a station and outposts like home; a body with a planet parent and
spin 0 is tidally locked whatever its kind). The compass strip across the top: every body
and station, the three nearest outposts on this body, the cluster if it is the target; a
glyph per kind at its bearing from the camera, the target lit, behind you pinned to the
edge; labels by priority (the target, then the nearest) dropping a row when they would
overlap, a bare glyph past the fourth row. The target diamond keeps only its closing
speed, ETA and cleared pad; the name moved to the strip. Known: the ice worlds' frozen
seas are still drawn by the water shader; they want a flat white surface.

**Seams and the scanner, built the same night.** `src/world/seams.ts`: a dozen seeded seams
per body with ground (six on a dwarf), each placed by a rule on the ground itself and
re-tested by the harness: ore on a ridge in a mountain belt, crystal on a gully floor,
salt on the flats by the sea, timber in a forest stand, ice on the caps and the cold
worlds, helium on regolith flats, sulphur on the hot world's crusts. Never within 5 km
of a pad, station or outpost. The goods are placed in turn so a body gets a spread.
Richness is a base per good times the tier (1 at home, 2.5 out to the belt, 6 beyond)
times a seeded 0.6 to 1.4, so ore on Rust averages 249 t against 92 t at home. **G** is the
scanner: a ping, and for twelve seconds the nearest seam within 25 km sits on the compass
as a blip with its good, tonnage and distance, the beeper quickening from every two
seconds at range to four a second on top of it. Nothing in range says so. Digging waits
on cargo. Range and hold are the first scanner upgrade.

**Backlog added 2026-09-04, late (Chris):** a **demo mode**, the computer playing the game
so a new player sees how it works: an attract loop that takes off, scans, digs, flies to a
town, sells, and comes back, on the same controllers the harnesses use, with the HUD live.
A **jet mode**: a second flight model in air, wings and lift, banking turns, a stall, nose
down to get somewhere fast, flicked to and from the hover ship with a key; "current is
quite floaty, takes ages to get to the ground from a height." Until then `/` in hover is
a dive: the top thruster pushes down harder than before and the assist still catches you.

**The first loop, built 2026-09-04 late (items 1 to 3 of the list).** `src/world/town.ts`:
every outpost and station is a town with a population, a stock, a works list (a
warehouse, a water plant, a bigger pad, a workshop, a rail spur; bills in tonnes, labour
in worker-seconds) and a built list. Workers drink water and lick salt from the stock;
watered and salted the town grows 4% a cycle, thirsty it shrinks 6% to a floor of four.
The current job advances by workers × the share of its bill on hand and can never get
further than what has been delivered, drawing materials in as it goes; the workers
eating the salt meant for the job is a real stall, and the harness has it. A town pays
base for a good, up to 60% over when its current job is short of it, half for what it
has no use for. Cargo: three pods of four tonnes on the hull, drawn as drums under the
wings and on the spine; mass divides thrust, RCS and turning and multiplies drag, so a
full ship climbs a third as fast and rolls half as fast. **U** landed on a seam digs a pod
in twenty seconds (the seam remembers, the save keeps it); **U** landed at a town sells
everything aboard. The panel shows ON SEAM, DIGGING, CARGO; the pause menu shows the
town: people, stock, the job and what it is short of, what it has built, what it would
pay for what you carry. Towns run all the time. `tools/verify-town.mjs` (23) and
`tools/probe-loop.mjs`. Also tonight: the wheel no longer zooms the camera (the ear)
while the menu scrolls, the landing lights hold their colour until a reading is a tenth
clear of its limit, the panel lines keep their height, and `/` in hover is a dive.

## 10h. No ceiling on the world, and the story of the build (Chris, 2026-09-04, late)

Chris: "there needs to be no limits on how much the world gets populated, you do what you
need to do, set up the subcontractors, go off to another world for a few days and come
back and it's all gone crazy, things are built, it's wild. Also want a back story being
produced, real words the user can read and it will tell them the story of the build."

**No ceiling.** Tonight's works list is five fixed jobs and then nothing, which is a cap.
It becomes a generator: after the fixed openers a town draws its next job from what it
has and what it lacks, with bills that grow with its size: more housing when the
population presses the floor space, a second warehouse when the stock overflows, a
market, a farm once it has a water plant, a mine at a seam within reach, a rail to the
next town it is not yet joined to, a tower, a freighter pad once the rail net is dense,
each one bigger than the last. Population has no cap either; it is bounded only by
water and food, which is what the subcontractors are for. Towns tick in game time
whether or not you are on their body, so two days on Rust are two days of building at
home, and a town with a standing supply keeps going without you. That is the "come back
and it's gone crazy". Nothing here is expensive: the generator is a table and a rule, and
the tick already runs for every town every frame.

**The chronicle.** Every event that matters writes a line in a town's story: the first
pod delivered and who brought it (you, or a carrier by name), each job started and
finished, the population passing a hundred, the rail reaching the next town, the first
freighter launched, a wreck salvaged, a town that went thirsty and shrank. Lines are
built from templates with the real names, numbers and days, in the plain voice of a
settlement's record, and kept in the save. Read in the pause menu as a page per town
and one for the whole system, newest first, with a date in the game's calendar. Later
the lines can be run through a model for prose; the events and the facts come first,
because they are what the story is made of.

Both backlog. The generator is the cheaper of the two and should come before
subcontractors exist, or the carriers will run out of things to build.

**The demo, built 2026-09-04, late (Chris: "get a demo built so we can watch what's
supposed to happen, play testing is quite boring" and "show the user what to press").**
`src/engine/Demo.ts` is a pilot: given a point on the ground it lifts off, climbs to 140 m
over the ground, leans toward the point against its own drift (a spring on position,
damped on speed, saturating at 0.85 rad which is where the speed comes from), levels over
it, sinks, and hands off for the last 30 m so the assist lands it. It makes Controls, the
same as a keyboard, through the input override the harnesses use. The game's loop on top:
nearest seam, dig until full or the seam is empty, nearest town, sell, refuel past 60%,
again. **P** starts it (or `?demo=1`), any key takes the ship back, a crash ends it. The
caption says what it is doing and why ("flying to Tallow Outpost, 12.3 km: lean toward
it, ease off to slow") and names the keys it is pressing right now, read off the controls
themselves (SPACE thrust, W nose down, A roll left, / dive, or "no keys: hands off").
Flight harness §29: pad to the nearest seam (17.7 km in 452 s, 6 m off) and on to the
nearest outpost's pad (32.6 km in 782 s, 9 m off), no crash. `tools/probe-demo.mjs`. The
legs are long because the hover ship is slow in air; the jet mode will shorten them.

**Later the same night.** The pilot cruises the long legs: up through the air, wings out,
nose on a carrot 5 km ahead along the great circle at 6 km over the ground (a far point
sits below the horizon on a world this small), the cap doing the speed; inside 7 km of
the target it noses down with no thrust and the brake, hover takes it at the floor, and
the hover legs finish. 17.7 km in 180 s and 32.6 km in 187 s, unburned, against 452 and
782 before. The caption says all of it. **The start** (Chris: "a starfield type menu at
the start of the game, which allows you to go to the demo or play or load a save"): a
plain URL shows a starfield with the name and three choices, CONTINUE (with the last
save's time and place, greyed when there is none), NEW GAME (the opening; with a save it
asks by starting over on the next load), DEMO (a sandbox: nothing loaded, nothing
saved). Arrows or W/S, Enter or Space, or click. The game sits frozen behind it.

**2026-09-05, after Chris watched it.** "It took a few minutes to try and land, wasn't sure
what it was doing, then it just floated until it crashed." A 23 m/s wind at the timber
seam. The settle leg's lean was capped at 0.25 rad, which is about what 25 m/s of wind
needs just to hold station, and the spring alone settles downwind of the spot; so it
drifted out past 60 m, went back to 'fly', climbed to 140 m, came back, settled, drifted,
four times, then handed off blown out of the seam to an assist that only saw ground drift
and touched down at 7 m/s sideways on a slope. Two fixes, both the same idea: the pilot
and the assist lean into the wind by its drag over g (the tangent of the lean that holds
station), the spring handling only what is left. The 'fly' height also eases from 140 m to
70 m over the last 400 m so a lost spot is not a climb back to height; never under 70 m,
because the assist's landing latch takes a leaned ship at 60 m. Flight harness §31 flies
the leg in every weather of the day, the storm hour first, and lands the ship hands off in
the storm under the drift limit. Sixteen of sixteen land inside the seam in 163 to 181 s.
One more trap paid for: `atmosphere()` calls `altitude()`, which writes the substep's `up`
scratch vector in the local frame; the assist takes the density as an argument now.
`tools/probe-start.mjs`.

**Small hours, 2026-09-05.** The title sits over the real sky: 30 km over the pad a few
minutes before its dawn, the planet below, the stars, and the sun with a glare, which is
new: an additive sprite on the sun's bearing, full in vacuum, a breath in thick air,
gone under the apparent horizon; it stays for the game. DEMO from the title starts in
place rather than on a fresh page, because a fresh page starts silent until a key is
pressed and the key hands the ship back (Chris: "no sounds in the demo unless I press
buttons, but then it cuts out the demo"); the choice itself is now the gesture that
arms the audio, and a click or tap anywhere does too.

## 10i. The boob (Ben, 2026-09-05, by way of Chris)

Chris: "he wants a big flying boob." Built the same morning. One, on home, 60 m across,
drifting round the world on a great circle at 15 m/s, 500 m over whatever ground is under
it, bobbing twelve metres either side. A circuit takes 4.7 hours real, so on any flight it
is somewhere and you do not know where; it starts on the far side of the world from the
pad. The scanner (G) finds it inside 25 km as an UNKNOWN CONTACT, a pink ring on the
compass. Inside 400 m it names itself, once ("CONTACT · A BIG FLYING BOOB"), and the save
keeps the game time you saw it. Fly into it and it gives: the ship is put back on the skin
and shoved off at just over half its closing speed, the boob wobbles (a squash on a spring,
decaying), and the toast says BOOP, or THAT WOBBLED past 20 m/s. Three flat colours, no
assets. `src/world/boob.ts` is pure (the circuit, the shove, the sighting, the save) and
the flight harness §30 re-tests all of it; `src/engine/Boob.ts` is the mesh;
`tools/probe-boob.mjs` shoots it and drives the scanner and the sighting in the browser.

`Craft.shove(pos, vel)` came with it: the one door for something outside the substep to
move the ship. The heliocentric state is what the substep integrates, so writing `pos`
from outside was lost the next step; the harness has the round trip.

Not yet: a chronicle line when it is first seen (§10h's chronicle does not exist yet), and
it only lives on home. If Ben wants one on every world he can ask for it himself.

## 10j. The dig you can see, modules, weight (Chris, 2026-09-05, after the boob)

Chris: "digging needs to have some sort of animation and be 4 times quicker"; "the timber
is being put under the thrust, which is wrong, need the ship to have modules that load";
"the weight is keeping the ship too low"; "when I crash, I seem to have the timber still."

**The dig** is 5 s (was 20). An auger runs out from under the keel over the first 12%,
spins into the ground while the pod fills (to 80%), and comes home over the last 8%. A
spoil heap the colour of the good grows on the ground beside the ship and stays there
(eight heaps recycled, not saved). The cargo module for this pod fills on the ground beside
the auger, scaling up with the fill, then hops to its slot on the hull between 80% and 92%.
The ship shakes while drilling, dust puffs off the ground, and the sound is a low sawtooth
rising with the fill plus grit. `src/engine/Digger.ts`; the module handling is in main.

**Modules.** The pods were drums under the tail, which is where the engine is. Now three
crates clamped to the top of the hull: one each side of the spine on the top facets, one on
the ridge behind the spine, each with a dark strap, coloured by the good aboard. Slots are
computed from the hull's own planes so they sit on the plate.

**Weight.** SHIP_TONNES was 12; with three 4 t pods the mass factor was 2 and the thrust
9 m/s² against 9.8 of gravity: a full ship could not hover, which is what "too low" was.
Now 36 t: a full load is a factor of 1.33, thrust 13.5. Turning and drag scale with it as
before. Harness §32 holds a third of a g in hand at full load.

**A fresh hull is empty.** `spawnOn` clears the cargo; the save puts it back after. The
wreck took the timber; the insurance did not cover it.

## 10k. Arcade (Chris, 2026-09-05, evening)

Chris: "players are going to get bored with lots of waiting unless there are fun things to
do, this is not flight simulator, it needs to be more arcady ... I think we need to get the
whole of that cycle down to less than a minute ... no we keep the same world shape, we just
need to speed up the ship ... if we can't do less than a minute then do whatever is
realistic, hovering seems to be the slowest ... but we can speed up take off too ... it's
not just the demo, if we don't speed things up it will take ages for everyone to do
anything."

**Where the time went** (the pad-to-seam leg, 17.7 km, before): lift 3, climb 40, cruise
10, dive 31, hover approach 57, settle and land 39. 170 s, of which the travel was 10.
The loop (seam, three pods, town, sale) was about 375 s.

**What changed, for everyone, not the demo:** THRUST_ACCEL 18 → 28 (thrust-to-weight
2.85), DRAG 0.004 → 0.002: hover tops out near 100 m/s (was 45), a full-thrust climb is
2.2 times quicker, a gale shoves a third as hard. The landing assist's descent floor is
3 + 0.16·feet (was 2 + 0.11), and its hands-off profile 2 + 0.14·feet: the ship stops
from 19 m/s in ten metres now, so it can come down harder and still touch under 4 m/s.
The dig is 3 s a pod. A full ship (36 t dry, §10j) climbs to 60 m in 5 s.

**What changed in the pilot:** boost on the climb out (the caption names SHIFT), the dive
key held through the hover descent above 400 m (a hands-off fall is drag-limited to 70 m/s;
the dive nearly doubles it), the dive out of cruise from 6 km at up to 220 m/s.

**After:** pad to seam 108 s (lift 2, climb 13, cruise 11, dive 26, hover 33, settle 15,
land 8), seam to outpost 111 s. The loop is about 230 s. Not a minute. What is left is the
cruise floor at 2.5 km (hover from there down is 30 s at best) and the two long legs; I
tried the floor at 1.5 km and it broke the arrival cap's gentle hand-off and gained nothing,
so it stays. **Under a minute with this world shape needs the jet mode** (wings and lift,
low and fast, no climb to cruise): that is the next build, ahead of the works generator.

The harness moved with it: the 80 m landing test now climbs gently (full thrust coasts to
300 m), the moon lift-off reads THRUST_ACCEL instead of 18, the moon pilot is proportional
(a pulse of full thrust is seventeen moon gravities), and the wind test drops from 120 m.

## 10l. Jet mode (Chris, 2026-09-05, night)

Chris: "I thought we were going to have the ability to fly like a mig or fighter jet rather
than hover over land, be great fun flying around the mountains ... hover is still best way
to land but we need a different mode ... that mode will only work in planets with
atmospheres."

**J flicks it, in air.** The wings come out (the cruise morph), the engine fires along the
nose, and the ship flies like an arcade jet: where you point is where you go (velocity
across the nose bleeds away in JET_ALIGN_TAU 0.7 s), a bank turns you at g·tan(bank)/v
about local up, the way a real wing's tilted lift would, so you roll and it comes round and
roll level and it stops; pitch and yaw have half the hover stick. The wings cancel gravity
along body-up on their own while there is speed for it (auto-trim, nothing to hold), up to
3.5 g; under the stall speed, √(g / (JET_LIFT·air)), 60 m/s in sea-level air, they cannot,
and you sink. Drag is JET_DRAG 0.0005, a quarter of hover's: top speed about 237 m/s, 380
on boost. `/` is a brake. The landing assist is off in jet; the ground is the ground, and a
hillside at 200 m/s is a wreck. J again is hover, which is how you land. Thin air raises the
stall speed by itself; below half JET_MIN_AIR the wings fold to hover on their own; cruise
takes over above the air as before. The hull at 380 m/s in sea-level air heats to a fifth of
its limit, so no re-entry glow low down. Harness §34.

**Tuned the same night from `research/jet-stunts-2026-09-05.md`** (Chris: "needs to be
able to do stunts easily"). The stick is Rocket League's: each axis chases stick × cap in
about 0.16 s, no mass in it: pitch 75°/s (a 4.8 s loop at any speed), roll 240°/s (a 360 in
1.5 s), yaw 30°/s. Velocity follows the nose in 0.2 s (0.7 flew 28° nose-high round a loop);
the grip fades with the square of the lift ratio under the stall, so the stall mushes then
drops. The lift is signed and capped at 4 g, so inverted flight holds (the old guard made
the wings do nothing upside down). Pulling costs 4.5 m/s² of speed per unit of stick. Wings
level themselves slowly (τ 2.5 s, dead band 8°) with the roll stick centred and the ship
upright, so a held bank still turns you and a roll still completes. The camera in jet sits
back 26 and up 5, looks 14 m ahead, rolls 60% with the ship, lags a snap (a flat gain of 7),
and the field of view opens 10° with speed, 4° more on boost. Ground effect is off in jet.
The look: the hull's five points slide to a needle (nose −5.4, tail ±0.9) as a morph target
of the same triangles, and 45° wings, a LERX sliver, twin canted fins, stabilators, a
five-point canopy and a chin intake unfold from the flanks over the same half second; the
nozzles walk to the tail and the flame comes out of them. Split-S at top speed eats 360 m of
sky; worth a HUD tick. Canned Immelmann and split-S on a key: not built.

**Later the same night** (Chris: "wheels for the gear on the jet please, also it should be
able to go a bit faster, 50% at least"; then "remove the left and right and top thrusters on
the jet, speed up another 50% as I want speed, and also need a good way to slow down, flaps
please"). Wheels: in the jet form the three feet are tyres on axles, spun on the runway.
Speed: JET_DRAG 0.0005 → 0.00022 → 0.0001, top 237 → 357 → 529 m/s; boost in the jet is
1.6× (2.6× did 627 m/s and cooked the hull in thirty seconds low down). In thin air the
drag never sees under 0.6 of an atmosphere, so the top speed stops climbing with height
(at a quarter of the air it ran away to 1,000 m/s and burned), and the skin heats on the
sea-level ramp at 0.6 of the rate; boost up high still cooks. No side, top or rear thrusters
in the jet. `/` is flaps and airbrake: drag ×4, lift ×1.5 (stall 60 → 49 m/s), a brake along
the nose, trailing-edge plates swing down over 0.8 s; from 300 m/s three seconds of it take
off 116 m/s.

Not yet: the demo pilot does not use it (its legs still climb to cruise), and there is no
stall buzz or wind-over-wings sound beyond the cruise drive. Both next.

### 10l-2. One ship, two forms (Chris, 2026-09-05, night, while flying the jet)

Chris: "jet needs to look like a jet, not like the ship in space, it's different, needs to
be able to do stunts easily, get an agent to look this up ... the fighter can't carry
stuff though, has to go back to the other ships. Also we need some runways to land on
with the fighter if we want to ... no, we can turn into the lander, otherwise there is no
goal for the fighter ship."

So: **one ship, and J is a transformation.** The lander form (the dart, hover, the dig,
the sale, the modules on the hull) and the jet form (a fighter silhouette, engine on the
nose, stunts, the guns). The modules ride along in either form (they are clamped to the
hull) but only the lander form digs or sells: U in the jet says TAKE THE LANDER FORM, and
the jet's lift has to carry the cargo's mass, so a full ship stalls 15% faster and flies
heavier, which is the reason to stunt empty. Hover is still how you land on a pad.
**Runways:** a long flat strip at home and at each station, lit at the ends, and a landing
in jet form that tolerates speed along the strip: touch inside it within 15° of its
heading, sink under 4 m/s, wings level, and you roll out on the brake instead of crashing
on the drift limit. Off the strip the old limits hold.

Research for the look and the stunt feel: `research/jet-stunts-2026-09-05.md`. Built in
the order: the look and the feel (the jet reads as a jet and loops on a stick), the
no-dig-in-jet rule and cargo in the lift, the runway and the rollout.

Chris, later the same minute: "it's just there to get places faster, later in the game we'll
be able to pick up other ships to morph into, these are the basic ships." So the forms are
a list that grows, J cycles what you have, and the jet carries the modules because getting
places faster is its whole job.

Assumption to flip if wrong: the jet carries the modules. The other reading of "can't
carry stuff" is that J refuses with cargo aboard, which makes every loaded leg a hover
leg; that is a one-line change in toggleJet.

## 10m. Into space in the jet, the warp look, the sun's heat (Chris, 2026-09-05, late)

Chris: "we don't need to turn back into the floater before we go into outer space, there
should be enough momentum to go straight into the space ship. Also when we get to
supersonic speeds in space it should look a bit like star trek when going warp, but not
fully, we're going fast to the sun it needs to look fast basically. Also when you go
towards the sun it should get really warm, hot, and you would likely burn up before you
get there, so we need to have that as part of getting close."

**Jet to cruise.** The jet keeps its form and its speed out of the air; cruise takes over at
the old line (no air, above 3 km) and the wings become the space morph. No hover between.
The jet's drag floor fades out under 0.3 of an atmosphere so the climb-out keeps its
momentum: from 1,200 m at 400 m/s, nose up 35°, full boost, cruise in 7 s at 650 m/s.

**The warp look.** `src/engine/Streaks.ts`: 260 line segments in a tube round the ship,
streaming back along the velocity, longer and brighter with speed, fading in from 1.5 km/s
and full at 30 km/s, vacuum only. Additive, pale blue. Not a tunnel; the stars stay.

**The sun.** The hull temperature has a solar term, SUN_HEAT_HOME (25 of the 1,000 limit) at
home's orbit and the inverse square of distance from there: 167 at Cinder's orbit, the
limit at 0.16 AU. It adds to the air's heating and applies in vacuum, so the hull glows
brighter the closer you fly, the HUD's HULL line carries a SUN share, a toast at 30% says
it is warming and one at 70% says TURN BACK, and parked at 0.14 AU a cold hull burns
through in 18 s. Harness §36.

## 10n. Fun, on my own call (2026-09-05, late; Chris: "we need some more fun, so look at the notes from the agents, all autonomously")

From `research/jet-stunts-2026-09-05.md`, built without asking:

**Canned stunts on one key.** I is an Immelmann: full pull until the heading has reversed
over the top, then roll upright; out higher, going back the way you came (600 → 866 m at
200 m/s, 3.2 s). K is a split-S: roll inverted, pull through the bottom; out lower and
faster (900 → 707 m, 3.0 s). They drive the stick the player would have held, so they read
as flying; any stick input of your own takes it back. Both refuse under 80 m/s and outside
the jet; the split-S refuses without 2.2 loop radii of sky (the radius is v over the pitch
rate: 153 m at 200 m/s) and the toast says how much it wanted. `src/engine/Stunts.ts`,
pure, harness §37.

**Wingtip vapour.** Two ribbons off the wingtips, forty points at thirty a second, that show
when pulling over 40% stick or over 250 m/s in air thicker than half an atmosphere, fading
along their length. `src/engine/Trails.ts`.

**The jet's voice.** The wind noise is louder, higher and saturates at 450 m/s instead of 120
in the jet, and a stall buzz (a low square wave) comes up from a whisper at 90% of the lift
needed to a rattle with none, so you hear the wings let go before you see it. The craft
exposes `liftRatio` for it.

Not built from the report: the split-S height tick on the HUD, an Ace-Combat-style high-g
blur. Both cheap, neither asked for.

## 10o. The graphics pass (2026-09-05, late; Chris: "can you think of ways of improving the graphics? more slick")

Tried and kept off: **ACES filmic tone mapping** (`?tone=aces&exposure=1.1` to see it). It
washes the flat palette to pastel and takes the green out of the grass; the palette was
tuned without it and reads better as it is. The switch stays for a second opinion.

Kept: the **field of view** opening with jet speed (§10l), the **warp streaks** in vacuum
(§10m), **wingtip vapour** under g (§10n), and two new: **contrails** from the nozzles, thirty
seconds long, when the jet is high and fast in thin air (between 0.05 and 0.6 of an
atmosphere, over 150 m/s, thrusting), and a **sonic boom**: a vapour cone flashes round the
nose for half a second as the jet passes 340 m/s in air, with a thump and a crack, and the
toast says MACH 1. `Trails.ts` takes points, rate, tips, fade and colour, so the two ribbons
are the same class.

Not done, and why: bloom and a vignette need a post-processing pass (a render target and a
second draw), which the logarithmic depth buffer and the headless probes both make
awkward; shadows from the sun on the ground would be the single biggest step up in the
look and are a day's work with the LOD; an outline pass is the other one worth a day.

