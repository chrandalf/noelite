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
| Planet radius | **2 km to start.** A config number, not an architectural one. |
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
altimeter you get. Frontier's structure. Scale is gameplay, not astronomy: small planets,
a sun of tens of km, orbits of hundreds of km, so a transfer is minutes at boost.

**The roster (Chris, 2026-09-01):** the home world plus five: one tiny, one gas giant, one
super-hot, two more like home. Moons on each, many on the giant. Gravity from all of it.

| Body | Radius | Air | Surface g | Notes |
|---|---|---|---|---|
| sun | 25 km | | | emissive; a point light with no decay, so every body is lit from the right side |
| hot | 1.5 km | thin, none | 6 | closest in; lava palette; a heat mechanic later |
| home | 2 km | 700 m | 7 | the one you are on now |
| terrestrial ×2 | 1.8 / 2.4 km | yes | 6.5 / 8 | different seeds, different palettes |
| tiny | 400 m | none | 1.2 | you can jump off it |
| gas giant | 10 km | deep | 20 | no surface: below a pressure line you are crushed |
| moons | 200–800 m | none | 0.5–2 | 1–2 per terrestrial, 4–6 on the giant, none on tiny |

**Physics-law-abiding means:** every body has `GM = g·R²`; every orbit's period comes from
Kepler III, `T = 2π√(a³/GM_parent)`; moons sit inside a third of their planet's Hill
radius so the craft feels the planet, not the sun, near them; nothing overlaps. The sun's
GM is tuned down from "realistic" so the inner planets have Hill spheres big enough to
hold moons at sensible distances. `verify-system` asserts all of it.

**Stages:** A, the system model and its instrument, pure and headless. B, render every
body with a floating origin, LOD on the near ones, plain spheres far off, the sun as a
mesh and a point light; a free-camera tour. C, the craft in the heliocentric frame with
summed gravity, per-body atmosphere, landed-rides-the-planet; `verify-flight` ported. D,
body targeting on the HUD (Tab cycles), distance and closing speed, sphere-of-influence
readout, a lock-view camera that keeps the ship in the foreground and the target framed,
and the escape-the-system trigger for the Elite half.

## 5c. Lakes and forests (asked for 2026-09-01, not yet built)

On the living worlds: a sea level per body, so basins fill; a flat-shaded water sphere
whose facets move on a time term and whose colour turns with the view angle, which is
what "great water" means in this look; and forests as seeded low-poly cones on facets
whose height band and slope allow. All derived, no assets, and both are new height and
placement terms on the same interface everything else already uses.

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

- **LOD seams show under grazing light.** At dawn and dusk the facet normals on either
  side of a level boundary differ enough that a whole chunk reads a shade brighter. Not
  visible at any other hour. Options if it ever matters: higher `SPLIT_K` so the boundary
  is further away, or blend normals across the boundary row.

## 9. Deferred

- **Is space flight Newtonian or Elite?** (Chris, 2026-09-01: "ship's behaviour needs to
  change once in space, but let's get more in space first.") Newtonian is what exists:
  no drag, you coast, the retro assist and the thrusters are how you stop. Elite's ships
  had a set speed and stopped when you throttled down, which is not physics but is very
  playable. Decide once there are planets to fly between; possibly a flight-assist you
  can switch off rather than a change of model.

- How interplanetary travel compresses (jump? time accel? both?)
- Combat, or whether there is any
- Whether the radius dial ever gets turned past 20 km
- Exact universe size. 2,000 systems is Elite's 8 × 256 and a sensible default; it sets
  the rarity counts, so it gets fixed before authoring starts.
