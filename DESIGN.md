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
4. **Re-entry.** Heat flux is density × speed³, which the atmosphere stack can already
   supply; hull temperature integrates it minus radiation, over the limit is damage, a
   gauge on the HUD. The entry corridor emerges: steep and fast cooks you, shallow bleeds
   speed in thin air. Hover mode does not engage until you are below a speed and above a
   density, so you have to flip like Starship, and that flip is the TIE-fighter morph with
   a reason to exist. The harness already shows the problem: a full-boost dive is handed
   back to hover at 1,590 m doing 1,168 m/s, into air whose drag would pull 16,000 m/s².
   DRAG (terminal velocity 29 m/s, a feather) gets reconsidered here too.
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
   rocks stay broken for the session. Fields are Tab targets after the bodies. **Three
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
   Next: **re-entry** (item 4), then Stage D's remainder: the lock-view camera, the
   escape-the-system trigger.

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
