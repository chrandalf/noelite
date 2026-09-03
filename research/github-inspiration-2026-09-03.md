# Prior art for §10 and §10b

Research pass, 2026-09-03. Every repository below was checked against the GitHub API
for licence and last push date, and every file path was fetched and read. Nothing here
is remembered, it is all confirmed.

Two warnings before the list.

**Licences matter here more than usual.** The two best Elite references, Mark Moxon's
annotated source and Ian Bell's `txtelite.c`, are both deliberately unlicensed. Moxon's
README says it plainly: "you have the right to read and fork this repository... but that's
it. No other use is permitted." So they are reading material. The algorithms are
documented in prose and cannot be copyrighted, the base price table for Radioactives can.
Read them, understand the shape, then write our own numbers. That is also better design:
noelite's goods are timber and helium and canyon crystal, not Slaves and Narcotics.

**Half of these projects are dead and that is fine.** A 2015 repo that answers a question
correctly is worth more than a 2026 repo that does not. Where something is dead I say so,
and I say whether to bother.

---

## 1. Elite-likes, space trading, and what their economies actually are

### Ian Bell's `txtelite.c`, the whole Elite economy in 1,000 lines of C

- <https://github.com/fragglet/txtelite>, cleaned-up C of Ian Bell's own conversion of the 6502 sources. Last push 2021-10-04, 12 stars, **no licence**.
- Also <https://github.com/johnsonjh/txtelite> (2024-05-21, bug fixes) and a Go port at <https://github.com/andrewsjg/GoElite>.

This is the single most useful file in the whole list for §10's economy, because it is the
entire thing with none of the 6502 in the way. Three functions:

- `tweakseed()` (line 310): `temp = w0+w1+w2; w0=w1; w1=w2; w2=temp;` in 16-bit. That is the
  Fibonacci-ish shift register the brief asks about, and it is four lines.
- `makesystem()` (line 487): pulls economy, government, tech level, population, productivity,
  x/y position and the name out of the seed by masking bits.
- `genmarket(fluct, plansys)` (line 449) is the price and quantity model in ten lines:

```c
int32_t product  = p.economy * commodities[i].gradient;
int32_t changing = fluct & commodities[i].maskbyte;
q = commodities[i].basequant + changing - product;   /* quantity */
q &= 0xFF; if (q & 0x80) q = 0;                      /* clip negative to zero */
market.quantity[i] = q & 0x3F;                       /* 6 bits, so 0..63 */
q = commodities[i].baseprice + changing + product;   /* price */
market.price[i] = (q & 0xFF) * 4;
```

Note what that means. `fluct` is **one random byte per system visit**, and each good's mask
selects how many bits of it that good sees. Food's mask is `%00000001`, so food moves by at
most 1. Narcotics' mask is `%01111000`, so narcotics swing by up to 120. One byte of entropy
produces seventeen correlated but differently volatile prices. Price and quantity use the
same `changing` and opposite signs on `product`, so an economy that is rich in a good has
lots of it and it is cheap, for free, with no supply model at all.

**What to take:** the mask idea. noelite already hashes sites to tiers; hash a station-visit
byte the same way and give each good a volatility mask. It gives us "ice is steady, crystal
is a gamble" without storing any state.

### Mark Moxon's annotated BBC Micro Elite, read this to understand, do not copy

- <https://github.com/markmoxon/elite-source-code-bbc-micro-cassette>, last push 2026-09-03, 487 stars, **explicitly no licence**.
- Companion site: <https://elite.bbcelite.com/deep_dives/market_item_prices_and_availability.html>, <https://elite.bbcelite.com/deep_dives/galaxy_and_system_seeds.html>, <https://elite.bbcelite.com/deep_dives/generating_system_data.html>.

Same algorithms as txtelite but with a paragraph of English next to every instruction. The
files to read are all in `1-source-files/main-sources/elite-source.asm`:

- `TT151` (line 20407), print name/price/availability. The formula stated outright:
  `price = base_price + (random AND mask) ± (economy × |economic_factor|)`, then `× 4`.
- `GVL` (line 20884), availability on arrival: same shape, sign flipped,
  `base_quantity + (random AND mask) ∓ (economy × |economic_factor|)`.
- `QQ23` (line 32484), the actual table, four bytes a good: base price, economic factor with
  sign in bit 7 and unit in bits 5-6, base quantity, fluctuation mask.
- `TT24` (line 18066), **the one worth stealing wholesale as a pattern**: five system
  properties out of three bytes of seed, with one deliberate correction baked in.

```
economy     = s0_hi & 0b111
government  = (s1_lo >> 3) & 0b111
if government is anarchy or feudal: economy |= 0b10   ; anarchies can't be rich
tech_level  = (economy XOR 0b111) + (s1_hi & 0b11) + (government / 2)
population  = tech_level*4 + economy + government + 1
productivity= (economy XOR 0b111 + 3) * (government + 4) * population * 8
```

That is the whole "derived economy" idea in six lines. Note the third line: the generator has
a hand-written rule that overrides the seed to stop a result the designer did not want. We
will need the same kind of clamp, and it is worth knowing Braben needed one too.

- `Ghy` (line 20080) is the galactic jump: rotate every seed byte left by one within itself,
  `01234567 -> 12345670`, so eight jumps return you to galaxy one. Initial seeds for galaxy
  one are `&5A4A, &0248, &B753` at line 6946.

### Oolite, the best economy model on the list for what noelite actually wants

- <https://github.com/OoliteProject/oolite>, the maintained Elite-in-spirit game, Objective-C. Last push 2026-08-31, 655 stars, licence reported as NOASSERTION (it is GPL-2 with an exception, check `LICENSE`).

Oolite threw away Elite's single signed `economic_factor` and replaced it with a **position
between two poles**, which is exactly the shape of "the moon wants water, the giant wants
anything solid".

`src/Core/OOCommodities.m`, `- (float) economicBiasForGood:inEconomy:` (line 478): every good
declares `peak_export` and `peak_import` as economy IDs, and the bias is a signed 0..1
normalised distance between them:

```objc
int exDiff = abs(economy - exporter) * 2;
int imDiff = abs(economy - importer) * 2;
int distance = (exDiff + imDiff) / 2;
// closer to exporter: +(1 - exDiff/distance); closer to importer: -(1 - imDiff/distance)
```

Then `generatePriceForGood:` (line 436) and `generateQuantityForGood:` (line 417):

```objc
price    = avg + avg*price_economic*(-bias)    + avg*price_random*(randf()-randf());
quantity = avg + avg*quantity_economic*(bias)  + avg*quantity_random*(randf()-randf());
```

The data lives in `Resources/Config/trade-goods.plist`, and it is legible:

```
"food" = { peak_export = 7;  peak_import = 0;
           price_average = 50; price_economic = 0.55; price_random = 0.04;
           quantity_average = 13.5; quantity_economic = 0.52; quantity_random = 0.04; };
```

`randf() - randf()` gives a triangular distribution centred on zero, which is a nicer noise
than uniform and costs nothing. Three tunable numbers per good per axis, and `price_economic`
is the whole personality of a good: food at 0.55 swings hard with the economy, textiles at
0.18 barely notices.

**What to take:** this data shape, more or less verbatim into a `goods.ts` table. Substitute
noelite's economy axis (say airless ↔ industrial ↔ agricultural) for Oolite's 0..7 and the
model works unchanged.

### Pioneer, supply and demand as an industry graph derived from planet facts

- <https://github.com/pioneerspacesim/pioneer>, Frontier-inspired, real orbits, C++ and Lua. Last push 2026-09-02, 1,906 stars, licence reported NONE by the API but the repo is GPL-3 (`licenses/` directory).

This is the most directly relevant thing in the whole report for §10's "what the goods are,
derived from the terrain, because the universe is a function". Pioneer does not roll dice for
what a planet produces. It evaluates conditions against the planet's physical properties, and
those conditions gate industries, and industries have inputs and outputs, and supply and
demand fall out of the graph.

`data/economy/conditions/basic.json` is the whole idea in one file:

```json
"atmos_airless":    { "context": "planet", "required": [ "atmosDensity < 0.1" ] },
"ice_abundant":     { "context": "planet", "required": [ "volatileIces > 0.6" ] },
"metal_abundant":   { "context": "planet", "required": [ "metallicity > 0.7" ] },
"carbon_ores_rich": { "context": "planet", "required": [ "metallicity < 0.4", "volatileIces < 0.3", "random > 0.3" ] }
```

`data/economy/industries/mining.json` then hangs industries off them:

```json
"ore_mine": {
  "context": "surface", "conditions": [ "metal_moderate" ],
  "inputs":  { "mining_machinery": 3, "air_processors": 2, "narcotics": 4 },
  "outputs": { "metal_ore": 6, "carbon_ore": 4 },
  "modifiers": { "metal_abundant": ["i:mining_machinery+1","o:metal_ore+1"],
                 "atmos_airless":  ["i:air_processors+2"] },
  "build_next": [ { "if": ["rare_metals"], "id": "telluric_ore_refinery", "chance": 0.9 },
                  { "id": "ore_refinery" } ] }
```

`atmos_airless` adding two air processors to the input list is the exact texture noelite
wants: the moon needs things brought to it because it is airless, and that is a fact about the
moon, not a table entry someone typed.

The code is `data/libs/Economy/Industry.lua`: `Industry.GenerateIndustries(sbody, tags, sizeClass, rand, supply, demand)` (line 206), `Industry.ComputeSupplyDemand` (line 288), and `sumIndustryVal` (line 184), whose comment is the neat trick: an output of N satisfies one input of N, or infinitely many inputs of N-1. That stops the graph exploding while keeping scarcity meaningful.

Prices in `data/libs/Economy.lua`, with three concrete formulas worth writing down:

```lua
Economy.GetMaxStockForPrice(price) = 290000 / price^1.217   -- expensive goods stock thinner
Economy.GetMaxFlowForPrice(price)  = 30 / math.log(math.abs(price) + 7.38)
Economy.GetMarketPrice(price, pricemod) = price * (1 + pricemod * 0.01)
-- pricemod = pricemod + variance * (ln(supply) - supply_flow), clamped to kMaxCommodityVariance
```

`Economy.GetCommodityPriceMod` (line 500) also folds in the player's own trade history and
what is available at *nearby* stations, so hammering one route visibly softens it. That is
§10's "stock drifting back over time, so a route exists and then softens" already solved.

**Verdict:** Pioneer's economy is the design to copy. It is more machinery than noelite needs
on day one, but the conditions-to-industries-to-goods chain is the right skeleton and the JSON
shape can be lifted straight into TypeScript.

### Endless Sky, the smallest dynamic economy that works

- <https://github.com/endless-sky/endless-sky>, GPL-3.0, last push 2026-09-02, 7,531 stars. Very much alive.

Four constants and two functions, in `source/System.cpp`:

```cpp
const double KEEP = .89;     // fraction of production a system keeps each day
const double EXPORT = .10;   // fraction it exports
const double VOLUME = 2000.; // sd of daily production, in tons
const double LIMIT = 20000.; // above this supply, price differences taper off

void System::StepEconomy() {                       // line 1101
    for (auto &it : trade) {
        it.second.exports = EXPORT * it.second.supply;
        it.second.supply *= KEEP;
        it.second.supply += Random::Normal() * VOLUME;
    }
}
void System::Price::Update() {                     // line 1305
    price = base + static_cast<int>(-100. * erf(supply / LIMIT));
}
```

That is the entire dynamic economy of a 7.5k-star game. `erf` is doing real work: it saturates,
so no amount of dumping can push a price below `base - 100`, and there is no clamp needed
anywhere. Commodity ranges are one line each in `data/commodities.txt`: `commodity "Food" 100 600`
followed by a list of flavour names for cargo descriptions.

**What to take:** the `erf` saturation and the three-line stock decay. If we want stock that
drifts back without a simulation tick that can run away, this is it, and it is smaller than
anything else here.

### Naev, prices as sine waves, which is a genuinely good idea for us

- <https://codeberg.org/naev/naev>, moved off GitHub, the GitHub repo `naev/naev` is now a mirror. Codeberg last update 2026-09-03, GPL-3. Alive.

`src/economy.c`, `economy_getPriceAtTime()` (line 91):

```c
price = commPrice->price
      + commPrice->sysVariation  * sin(2*M_PI*t / commPrice->sysPeriod)
      + commPrice->spobVariation * sin(2*M_PI*t / commPrice->spobPeriod);
```

Two superposed sines per good per station, periods and amplitudes fixed at galaxy generation.
No state, no ticking, no save data. Price at any time is a pure function of (good, station,
clock), which is precisely noelite's philosophy: the universe is a function of a seed. A player
can learn that ice at the moon bottoms out every so often, and that knowledge is stable
forever, which is §5's "knowledge is the progression" applied to trade.

The generation in `economy_calcPrice` (around line 665) modulates base price by planet class,
faction, and `tanh((log(population) - log(1e8)) * 0.5)`. The `tanh` on a log is a nice trick
for turning an unbounded quantity into a -1..+1 modifier. Ignore the bit where the variation
period is derived from characters in the graphics filename. That is a hack and the comment
admits it: "No rhyme or reason, just gives some variability."

**Verdict:** take the two-sine price model, leave the rest. It is the cheapest thing on this
page and the most compatible with how noelite already thinks.

### Elite: The New Kind, skip it

- <https://github.com/fesh0r/newkind>, Christian Pinder's C reimplementation of BBC Elite. Last push 2015-10-05, 145 stars, no licence.

A mirror of a mirror, dead for a decade, and everything in it is better documented in Moxon's
repo. Named only so nobody wastes an afternoon on it. Note that despite the "Elite: TNK"
description it is Elite, not Frontier. I found no open reverse-engineering of Frontier or
First Encounters worth citing; the Frontier work that exists is scattered forum disassembly,
not a repository.

---

## 2. Coriolis docking: rotating station, a slot, and rotation matching

### Original Elite's docking test is five comparisons, and it is more forgiving than you remember

`elite-source.asm`, routine `ISDK`, line 4098. Deep dive at
<https://elite.bbcelite.com/deep_dives/docking_checks.html>.

Once you are close enough to the station, docking succeeds if all of:

1. the station is not hostile
2. `nosev_z_hi >= 214`, so **your approach direction is within 26° of the slot's axis**
3. the vector to the station has positive z, so you are facing it
4. that vector's z `>= 89`, so you are **inside a 22.0° cone of approach**
5. `|roofv_x_hi| >= 80`, so **the slot is within 36.6° of your horizontal**

Check 5 is the famous roll match, and the tolerance is 36.6 degrees. Over 70 degrees of
allowed roll error. Elite felt precise because the station rotated and the slot was thin on
screen, not because the maths was tight. That is the lesson: make the *presentation* demanding
and the *tolerance* generous. Also note there is no velocity check at all, so nothing stops you
docking at full speed.

**What to take:** three dot products with those constants as the first implementation of
noelite's slot, and the discipline of a HUD that shows the roll error so the player thinks it
is hard.

### Oolite's `DockEntity`, the production version of the same thing, with a forgiveness margin

`src/Core/Entities/DockEntity.m` in <https://github.com/OoliteProject/oolite>.

`- (BOOL) shipIsInDockingCorridor:(ShipEntity *)ship` (line 672) is the manual-docking check,
and it does something smarter than an angle test. It transforms the ship's bounding box into
the port's rotating frame (`quaternion_multiply(orientation, [station orientation])`), then:

- decides whether ship and port are both wider-than-tall, `rotationsMatch`, and if the ship's
  long axis does not match the slot's, it swaps which port dimension the ship's width is
  measured against. That is the roll check, expressed as "does it fit", not as an angle.
- **grows the port until the ship fits**: `while (shipbb.max.x - shipbb.min.x > ww * 0.90) ww *= 1.25;`
  A small ship gets a tight slot, a big ship gets a slot that was quietly enlarged for it.
- outside the exact lane but within `safety = 1.5×`, it applies scrape damage proportional to
  speed, **nudges the ship back toward the centre** by `delta * correction_factor` where
  `correction_factor = -arbb.min.z / (arbb.max.z - arbb.min.z)` is how far in the nose is, and
  lets you through. Only clipping both opposite edges at once is fatal.

That corridor-with-a-nudge is why Oolite docking feels good and Elite's felt binary. It is
maybe forty lines and I would implement it before I implemented anything clever.

The docking computer is `- (void) addShipToShipsOnApproach:` (line 445), and it is a waypoint
table, not a controller:

```objc
int corridor_distance[] = { -1,  1,  3,  5,  7,  9, 11, 12, 12};  // in port depths
int corridor_offset[]   = {  0,  0,  0,  0,  0,  0,  1,  3, 12};  // lateral, in port depths
int corridor_speed[]    = { 96, 96,128,128, 96,128,128,256,512};
int corridor_range[]    = { 24, 12,  6,  4,  4,  6, 15, 38, 96};  // arrival tolerance
int corridor_rotate[]   = {  1,  1,  1,  1,  0,  0,  0,  0,  0};  // match station rotation?
```

Read right to left: come in from twelve port-depths out and twelve to the side, curve onto the
axis by stage five, and **only start matching the station's rotation in the last four stages**.
Speeds go 512 down to 96 as you close. Approach from the wrong side and you are first sent to a
point 5 km off to the side (`OOMakeDockingInstructions(... collisionRadius + 5000 ..., @"APPROACH")`).
Sixteen ships get sixteen different lanes chosen from `entityPersonalityInt & 0xf` so traffic
does not collide.

`- (NSDictionary *) dockingInstructionsForShip:` (line 282) consumes the stack, with
`max_allowed_range = 2 × rangeAdvised + collision_radius` deciding when a waypoint counts as
reached, and `id_lock[]` claiming stages three ahead so two ships never occupy the same one.
The AI state machine on top is `Resources/AIs/dockingAI.plist`.

**What to take:** the whole nine-waypoint table, scaled by our slot depth, as noelite's docking
computer. It is data, it is testable in the headless harness, and it is far less work than a
controller. The `corridor_rotate` column is the answer to "when do I start matching rotation":
late, not early.

### Pioneer, approach paths authored as matrices in the station model

<https://github.com/pioneerspacesim/pioneer>, `src/SpaceStationType.h` and `src/SpaceStation.cpp`.

Pioneer's orbital stations rotate (`float angVel` in `SpaceStationType`) and their docking
geometry is data baked into the 3D model as named tags. `enum class DockStage` runs
`CLEARANCE_GRANTED, DOCK_ANIMATION_1..3, TOUCHDOWN, LEVELING, REPOSITION, JUST_DOCK, DOCKED`
plus `APPROACH1, APPROACH2`, and `struct BayPath { std::map<DockStage, matrix4x4f> m_docking, m_leaving; }`
is literally a keyframe list. `SPort` carries `minShipSize`/`maxShipSize` so a big ship is
refused a small bay. `SpaceStation::PositionDockedShip` (line 708) is where the docked ship gets
carried by the station's rotation, via `matrix3x3d::RotateY(-len)`.

**What to take:** the idea that the approach is authored alongside the model rather than
computed. If we build the Coriolis as an authored shape the way `padOf()` authored the pad,
then five matrices in the same file define the approach and the harness can fly them. Also
`minShipSize`/`maxShipSize` is a free lever: a fully-laden ship with pods on the spine might not
fit the slot, which turns §10's cargo bulk into a docking constraint for nothing.

Skip `KeithTheDev/elite-js` (2 stars, 2025, a sketch). There is no good open-source three.js
rotating-station docking implementation. We are writing the first one.

---

## 3. Procedural planet renderers that solved something we have not

### Cosmos Journeyer, the closest thing to noelite that exists

- <https://github.com/BarthPaleologue/CosmosJourneyer>, browser space exploration, TypeScript + Vite, cube-face quadtree LOD, unbroken orbit to ground, worker-pool terrain. **AGPL-3.0**, last push 2026-09-03, 51 stars. Alive and being worked on.

BabylonJS rather than three, but the architecture is ours. AGPL means read it, do not paste it.
Three specific things:

- **Split and merge use different thresholds.** `packages/game/src/ts/frontend/universe/planets/telluricPlanet/terrain/chunks/terrainFaceQuadTree.ts`: `splitScreenSpaceErrorThreshold = 32`, `mergeScreenSpaceErrorThreshold = 16`. One threshold makes chunks flip every frame when the camera sits on the boundary. Two gives hysteresis. We already use 5% hysteresis for the sphere-of-influence choice, so the idea is familiar; it belongs in the LOD too.
- **`computeScreenSpaceError()`** in `.../chunks/terrainChunkMesh.ts` line 243 divides by distance to the chunk's *bounding sphere surface*, not its centre. Subtracting the radius is what stops a big chunk seen from high up from over-subdividing.
- **Skirts are conditional.** `.../chunks/createChunkBuffers.ts` line 36: `SKIRT_GENERATION_VERTEX_SPACING_THRESHOLD = 512`. No skirt when vertex spacing is over 512 m, because the seam is sub-pixel anyway. Our peak was 203 chunks on the orbit-to-deck descent; skipping skirts on the top half of that is free.

They also test atmospheric scattering with Playwright PNG baselines (`tests/e2e/atmosphereScattering.spec.ts`). Same instinct as our harnesses, applied to pixels.

### Cesium, the answer to log-depth precision, and one bug we will hit

- <https://github.com/CesiumGS/cesium>, Apache-2.0, last push 2026-09-03, 15,649 stars. Extremely alive.

We turned on `logarithmicDepthBuffer` early and it worked. Cesium knows what breaks next.

- **`packages/engine/Source/Shaders/Builtin/Functions/vertexLogDepth.glsl`, `czm_updatePositionDepth()`.** With a huge far/near ratio, float rounding pushes `gl_Position.z` past the far plane and the whole primitive is clipped before the fragment shader ever gets to write the correct log depth. The fix is one line: `coords.z = clamp(coords.z / coords.w, -1.0, 1.0) * coords.w;`. This is the bug where a distant planet vanishes entirely at certain camera distances rather than z-fighting.
- **`writeLogDepth.glsl`**: `gl_FragDepth = log2(depth) * czm_oneOverLog2FarDepthFromNearPlusOne;` plus an explicit `discard` outside the range, because writing `gl_FragDepth` disables hardware clipping. Also a manual polygon-offset emulation with `dFdx/dFdy` applied before the log, because GL polygon offset works on the linear depth you have stopped writing.
- **`Core/EncodedCartesian3.js`, `EncodedCartesian3.encode()`** with `Shaders/Builtin/Functions/translateRelativeToEye.glsl`: split each double at 65536 into high and low floats, do `(high - camHigh) + (low - camLow)` in the shader. That is GPU double emulation, and it is the alternative to per-frame camera-relative rebasing. We rebase, which is simpler and fine, but if the giant at 4.9 million km ever shimmers this is the fix that does not need a rebase point.
- **`Core/HeightmapTessellator.js`**: `skirtOffsetPercentage = 0.00001` nudges skirt verts inward so they do not z-fight the neighbour, and there is a branch that explicitly does not generate skirts at tile corners because they come out degenerate. We fought skirts for a day on 2026-09-01; both of these are worth knowing.

**And a specific warning list for three.js with log depth on**, all real open or recent issues in `mrdoob/three.js`: #18807 `polygonOffset` stops working, #29841 transparent draw order goes wrong on some devices, #25515 and #25688 `ShadowMaterial`/`ShaderMaterial` render order, #30039 render-target multisampling, #32686 sprites cut in v181 (fine in v180). Any custom `ShaderMaterial` we write must include three's `logdepthbuf_pars_vertex` / `logdepthbuf_vertex` / `logdepthbuf_fragment` chunks or it renders at the wrong depth against the terrain. Worth pinning in DESIGN §8.

### OpenSpace, geomorphing, which actually removes cracks instead of hiding them

- <https://github.com/OpenSpace/OpenSpace>, NASA/AMNH astro-visualisation with a production chunked-LOD globe. Licence NOASSERTION but MIT text in the headers, last push 2026-09-03, 1,244 stars. Alive.

The `globebrowsing` module is the best-documented chunked-LOD-on-a-sphere source I have seen.

- **Skirts for free.** `modules/globebrowsing/shaders/tilevertexskirt.glsl`: `tileVertexIsSkirtVertex()` works out whether a vertex is a skirt vertex purely from `gl_VertexID` against `xSegments + 3`, so **one shared grid VBO serves every chunk in the world** and the skirt is a `- skirtLength` in the vertex shader. Grid in `src/skirtedgrid.cpp`, skirt width half a cell. We build skirts into every chunk's geometry; this is strictly less memory and less CPU.
- **Geomorphing.** `shaders/globalrenderer_vs.glsl` lines 113 to 120: per-vertex `desiredLevel = log2(distanceScaleFactor / distToVertex)`, `levelInterp = chunkLevel - desiredLevel`, then a `vec3` of weights blending heights across three tile levels. Skirts hide cracks. This makes the height field continuous across the LOD boundary so there is no crack to hide, and no pop either. It is the answer to LOD popping that does not rely on hard facets, and we might want it once the terrain gets more detailed than the palette can disguise.
- **Horizon culling.** `src/renderableglobe.cpp` line 2572, `isCullableByHorizon()`: distance-to-horizon against the chunk's closest point, checked against all four corners because closest-in-latlon is not closest-in-cartesian, inflated by `maxHeight`. On a 40 km planet the horizon is 30 km away and half the sphere's chunks are behind it. This is probably a real frame-time win for us and it is maybe fifty lines.
- Two selectable LOD metrics side by side: `desiredLevelByDistance()` (line 2407) and `desiredLevelByProjectedArea()` (line 2441), plus `desiredLevelByAvailableTileData()` to clamp against what has actually loaded.

### Scatterer, the orbit-to-ground handoff, shipped and tuned

- <https://github.com/LGhassen/Scatterer>, KSP atmosphere and ocean, Proland/Bruneton lineage, C#/Unity. Licence NOASSERTION, last push 2026-08-29, 224 stars. Alive.

The best open answer to "what do you actually do at the boundary between the orbital view and the ground view", which is a question noelite has already half-answered for clouds (the shell fades out below 3.5 km) and will have to answer again for the sea.

Scatterer keeps parallel containers and crossfades: `Effects/Proland/Atmosphere/Utils/ScaledScatteringContainer.cs` for orbit against `ScreenSpaceScatteringContainer.cs` and `GenericLocalAtmosphereContainer.cs` for the ground, driven from `Atmosphere/SkyNode.cs`.

For water, `Effects/Proland/Ocean/OceanNode.cs`, `CreateProjectedGridMeshes()` (line 265) builds a screen-space projected grid sized in pixels, `NX = screenWidth / resolution`, with `offScreenVertexStretch = 1.25f` to cover the frustum edges and `alphaRadius = 3000f` to fade out. `Ocean/Utils/FakeOceanPQS.cs` is the plain sphere it hands off to at distance. Projected grid near, sphere far, alpha crossfade. That pairing is directly portable and it is what we will need when the sea has to be visible from orbit as well as have a tide underfoot.

### The atmosphere shortlist

- **<https://github.com/wwwtyro/glsl-atmosphere>**, Unlicense, last push 2020-05-20, 635 stars. Dead, and completely fine, because it is one finished file. `index.glsl` is a single `atmosphere()` function with `iSteps = 16`, `jSteps = 8`, ray-sphere `rsi()`, Rayleigh `3/(16π)(1+μ²)` and Henyey-Greenstein Mie. Parameterised on `rPlanet`, `rAtmos`, `shRlh`, `shMie`, so a 40 km planet with 2 km of air works without modification. **Start here.** It is an evening.
- **<https://github.com/ebruneton/precomputed_atmospheric_scattering>**, BSD-3-Clause, last push 2025-10-05, 1,063 stars. The reference implementation, and importantly `atmosphere/demo/webgl/` is an emscripten path that precomputes the LUTs and runs them in a browser. So multiple scattering is reachable without reimplementing the precompute. Go here only if the single-pass version looks wrong.
- **<https://github.com/SebLague/Solar-System>**, MIT, last push 2024-02-03, 1,380 stars. Dormant. No LOD at all, so ignore the terrain. The one file worth taking is `Assets/Scripts/Celestial/Shaders/PostProcessing/OceanEffect.shader`: **ocean as a full-screen ray-sphere intersection against the depth buffer, with no water geometry at all.** `raySphere(oceanCentre, oceanRadius, rayPos, rayDir)`, `oceanViewDepth = min(dstThroughOcean, sceneDepth - dstToOcean)`, then Beer-Lambert `1 - exp(-oceanViewDepth / planetScale * k)` for colour and alpha. For a flat-shaded, textureless look on a small planet that is cheaper than a shell and it gives depth-graded colour for free. We already carry per-vertex depth on the water, so we could keep the vertex sea for the tide and swell near the craft and use this for the sea seen from altitude.
- **<https://github.com/SebLague/Geographical-Adventures>**, MIT, last push 2024-08-14, 3,665 stars. Dormant but finished. Look here rather than at Solar-System for `Assets/Post Processing/Effects/Atmosphere/LUT Compute/AerialPerspective.compute` and `TransmittanceDepthLUT.compute`. Aerial perspective, distance-dependent in-scattering on the terrain itself, is what stops a ground-level view of flat-shaded polygons looking like clean flat-shaded polygons. Our fog is standing in for this. A LUT is cheap and better.

### Verified dead ends, so nobody chases them

`Fyrestar/THREE.Planet` does not exist. `oframe/planet` 404s. Proland has no live GitHub home and every mirror is stale (`csbrandt/proland-4.0` 2013, `LarsFlaeten/Proland_dev` 2017); take Proland's ideas via Scatterer, which is the same lineage and maintained. The Ysaneya "Infinity" journals are gamedev.net prose with no repo, good reading and nothing to steal at file level. There is no open SpaceEngine-alike.

---

## 4. Re-entry and hull heating

DESIGN §8b item 4 already says heat flux is density × speed³ and that the harness caught a
full-boost dive being handed to hover at 1,590 m doing 1,168 m/s. Everything below is aimed at
that.

### XRVessels, twenty years of tuning a playable entry corridor, and the numbers are all there

- <https://github.com/dbeachy1/XRVessels>, the XR-series add-on vessels for Orbiter. **GPL-3.0**, last push 2025-02-02, 23 stars. Twenty-three stars and it is the best thing on this page. GPL, so read and reimplement.

`XRVessels/DeltaGliderXR1/XR1Lib/XR1PostStepsHullTemps.cpp`, `SetHullTempsPostStep::AddHeat(simdt)`:

```cpp
tweakedAtmPressure = atmPressure / 2;    // stands in for density
tweakedAirspeed    = v*v*v;
degreesK = (tweakedAirspeed * tweakedAtmPressure) * (HULL_HEATING_FACTOR * 0.642);
```

`HULL_HEATING_FACTOR = 3.1034e-10` (`DeltaGliderXR1/XR1Globals.cpp` line 481). One scalar maps
`p·v³` to kelvin. And read the comment: it computes an **absolute equilibrium temperature and
deliberately does not scale by `simdt`**. Heat is a target you rise toward, not a quantity you
integrate. That is a game decision, not a physics one, and it is the reason the model is stable
at any frame rate.

The part I would take first is the **conductive cooling ramp**, same file around line 91:

```
minHeatConductionPressure = 7000 Pa    (~18 km on Earth; below this, no conductive cooling)
maxHeatConductionPressure = 97700 Pa   (~1000 ft)
minHeatConductionFraction = 0.0949622
heatConductionFraction = 1 - (1 - 0.0949622) * clamp((p - 7000) / (97700 - 7000), 0, 1)
degreesK *= heatConductionFraction
```

This is what stops v³ from cooking you during ordinary fast low flight, which is exactly the
failure mode a naive ρv³ has and exactly the case our harness already flagged. Tuned so that
just-subsonic at sea level sits about 40 °C above ambient.

Cooling in `RemoveSurfaceHeat()` (line 245) is **not** Stefan-Boltzmann:
`heatDropped = max(delta * 0.02, 0.1) * simdt`, where `delta` is the excess over ambient. Two
percent of the excess a second, floor 0.1 K/s. Cruder than σT⁴, stable at large timesteps, and it
cannot overshoot ambient.

Damage in `XR1Lib/DeltaGliderXR1_DMGCheck.cpp` line 642, `CheckTemperature(tempK, limitK, doorOpen)`,
and this is the model I would copy for §10's damage 0..1:

```cpp
exceededLimitMult  = pow(tempK / limitK, 2);          // 10% over the limit -> 1.21
failureProbability = (dt / 8.0) * exceededLimitMult;  // 8 s mean time to failure at the limit
if (rand() <= failureProbability) damage = exceededLimitMult - 1.0;
```

Stochastic, correct in dt, and it degrades instead of cliff-edging. Limits from
`XR1StartupCallbacks.cpp` line 284: nose cone 2840 °C, wings 2380, cockpit 1490, top hull 1210,
warning at 0.80 of the limit and critical at 0.90, and an open door drops the limit to 480 °C
(which is a lovely detail: gear down in re-entry should hurt). Per-surface distribution is nose
at full, wings ×0.75, cockpit ×0.73, modulated by angle of attack and applied as
`max(newTemp, currentTemp)`. The plasma glow is keyed to the same numbers
(`XR1PostStepsHullTemps.cpp` line 270): fades in at 0.387 of the nose limit, saturates at 0.80.
So the visual and the gauge cannot disagree, which is the same rule as our atmosphere being one
number.

**On scale:** at 1:159 orbital speeds are about 12× lower than Earth's, so v³ is about 2,000×
smaller. A single tunable scalar in exactly this shape is what we want, because it means one
number to retune and the corridor's *shape* survives the rescale.

### Orbiter's DeltaGlider thermal subsystem, the honest version, in readable Lua

- <https://github.com/orbitersim/orbiter>, MIT, last push 2026-08-10, 1,979 stars. Alive.

`Orbitersdk/samples/Lua/DeltaGlider/Src/ThermalSubsystem.lua`, about 500 lines of Lua, is the
physically-honest counterpart: thirteen compartments (six surfaces, interior, avionics, cabin,
three tanks, radiator), each with a mass and a specific heat. Constants at the top:
`sigma = 5.670e-8`, `c_metal = 0.6e3`, `c_ceramic = 0.85e3`, `k_convect = 5e-4`,
`eps_radiator = 0.95`.

The integrator in `clbkPostStep` is the pattern: accumulate `dQ[]` from every source, then one
explicit Euler step, `T = T + dQ * simdt / (mass * cp)`. Sources are separate functions:
`SolarRadiation()`, `PlanetRadiation()`, `AddAlbedoReflection()`,
**`SubtractBlackbodyRadiation()` (line 383, `dQ -= A * eps * sigma * T^4`, the literal radiative
cooling term)**, **`AtmosphericConvection()` (line 401, `dq = (T_surface - T_atm) * k_convect * p * A`,
Newtonian convection linear in static pressure)**, and `HeatConduction()` between compartments.
State serialises as thirteen numbers.

Worth noting the solar and albedo terms are as relevant to the *orbital* half of noelite as the
entry: a hull that runs cold on the night side and warm in the sun gives the parked orbit
something to feel like, for free, using a term we are adding anyway.

**How I would combine the two:** XRVessels' equilibrium-temperature model and its pressure ramp
for the gameplay, Orbiter's `dQ` accumulate-then-Euler-step structure so the harness can assert
on individual terms. One hull temperature to start, not thirteen.

### SpaceAMPL, Sutton-Graves, and the corridor as constraints rather than special cases

- <https://github.com/esa/SpaceAMPL>, ESA Advanced Concepts Team optimal-control models. GPL-2.0, last push 2021-03-06, 20 stars. Dormant but complete.

`reentry/atmo_entry.mod`, 287 lines of declarative maths. Read it as a spec.

```ampl
param heatflux_C := 1.7415e-4;                                   # Sutton-Graves, line 49
var heatflux{i in I} = heatflux_C * sqrt(rho[i]/RN) * V[i]^3;    # line 122
var rho{i in I}      = SLdensity * exp(-h[i]/H);                 # line 110
var q{i in I}        = 0.5*rho[i]*V[i]^2;                        # dynamic pressure
```

Note the real Sutton-Graves is `k·√(ρ/R_nose)·v³`, so it goes as the **square root** of density,
not linearly. DESIGN §8b says density × v³. The square root matters: it makes the thin-air part of
the entry hurt more than a linear model does, which is precisely the "shallow bleeds speed in thin
air" half of the corridor. Worth one experiment.

Entry state in the model is 100 km at 8 km/s with a −5° flight path angle, Cd and Cl are polynomials
in angle of attack (lines 113 to 117), and the corridor emerges from path constraints in the
`subject to` blocks (lines 137 to 206): angle of attack and bank limited, and their **rates**
limited, `max_alpharate = 10°/s`, `max_sigmarate = 30°/s`, minimising aerodynamic load. Nothing
special-cases "too steep" or "too shallow". That is the right way to build it, and it is the same
argument as our one flight model with altitude-varying air.

### DeadlyReentry, the damage model, not the physics

- <https://github.com/Starwaster/DeadlyReentry>, the KSP mod. Licence NOASSERTION, last push 2025-01-10, 32 stars.

Manage expectations: since KSP 1.0 the convective physics lives in stock KSP and this is a damage
and tuning layer. `Source/DREFlightIntegrator/DREFlightIntegrator.cs` on master is a 62-line stub;
the famous pre-1.0 shockwave formula is only in old branches. Three things in `Source/DeadlyReentry.cs`
are still worth reading:

- **The `DamageCube`** (line 287): per-face directional damage rather than a scalar,
  `AddCubeDamageFacing(dir, dmg)` versus `AddCubeDamageAll(dmg)`, and damage then scales
  `breakingForce`, `breakingTorque` and `crashTolerance` (lines 543 to 545). A shield burned through
  only on the windward face is a much better game object than one hull-integrity number, and it costs
  six floats. This also feeds §10's crashes: a hull already damaged on one face should come apart
  there.
- **Burn-through**, line 699: `convectiveFluxLeak = convectionFlux * (1 - temperature/postShockExtTemp) * damage`.
  Damage lets heat past the shield into the interior in proportion to the damage. That is what makes
  a bad entry lethal rather than just expensive, and it is one multiply.
- **Integrated G-dose**, line 481: `gExperienced += pow(min(|gForce|, crewGClamp), crewGPower) * dt`.
  A short 12 g pulse survives, a long 6 g soak does not. Free extra pressure on the corridor if we
  ever want it.

### The rest

- **<https://github.com/neuoy/KSPTrajectories>**, GPL-3.0, last push 2023-05-15, 148 stars. Dormant but feature-complete. Relevant only if we want to *draw* the corridor. `src/Plugin/AeroDynamicModels/AeroForceCache.cs` is a 3D lookup cache over (velocity, altitude, angle of attack) so the forward integrator never re-evaluates the aero model per step, which is directly what a headless harness sweeping a thousand entry angles wants. `src/Plugin/Predictor/Trajectory.cs` is the integrator, `DescentProfile.cs` the control input.
- **<https://github.com/backlundtransform/CSharpNumerics>**, MIT, last push 2026-09-03, 7 stars. Thin, but `Numerics/Physics/FluidDynamics/Aerodynamics/HeatFlux.cs` is a correct, unit-documented, MIT-licensed Sutton-Graves with the citation (NASA TR R-376, 1971) and `K_Air = 1.7415e-4`. Copy-paste-and-verify reference, not a system to study.
- **<https://github.com/BrendanLuke15/Earth-Entry-Sim>**, MIT, 2024-05-21, 1 star, MATLAB. Only if we ever want an ablative shield that visibly recedes: `stagwallthick.m` is a 1-D transient conduction solve through PICA with a receding front, `AblationRateCurveFit.m` fits ablation to 18 measured NASA points. Probably never. Noted so it is not re-found.

**Verified not useful for heating:** Principia has no atmospheric model at all (pure n-body, and it
deliberately leaves atmosphere to stock KSP). FAR is aerodynamics with no thermal model. Kerbalism is
life support. Poliastro is archived. Orbiter's own core has no vessel thermal model, which is why
both good entries above are add-ons.
---

## 5. Cargo mass, inertia and drag composed from attached parts

§10 says a pod is felt three ways: thrust-to-weight drops, moment of inertia grows, drag area
grows. That is three separate composition problems and each has a right answer.

### parry, the maths, in Apache-2.0, with the subtraction we will actually need

- <https://github.com/dimforge/parry>, the collision library under Rapier, Rust. **Apache-2.0**, last push 2026-08-08, 863 stars. Alive.

`src/mass_properties/mass_properties.rs` is the API shape to copy into TypeScript:

- `construct_shifted_inertia_matrix(&self, shift: Vector)` (line 306) is the parallel axis kernel.
- `impl Add<MassProperties>` (line 441): attaching a pod computes the new combined centre of mass, shifts *both* tensors to it, adds.
- **`impl Sub<MassProperties>` (line 371): detaching a pod, exactly.** This is the one nobody else provides and the one that matters, because a pod that falls off in a crash must leave the craft in exactly the state it would have been in had the pod never been fitted. Add-only accumulation drifts. Having both means the harness can assert that `(hull + pod) - pod == hull` to a tolerance, which is precisely the kind of check our harnesses already do.
- `MassProperties::from_compound` (line 320) with an explicit `// NOTE: we don't apply the parallel axis theorem here` comment worth reading before you assume it is a bug.
- Closed forms per shape in sibling files: `mass_properties_cuboid.rs`, `mass_properties_cylinder.rs`, `mass_properties_convex_polyhedron.rs`.

Apache-2.0 means we can port it directly. This is the code to write.

### JSBSim, the ordering of the pipeline, and the bug we would otherwise ship

- <https://github.com/JSBSim-Team/jsbsim>, NASA-lineage 6-DoF flight dynamics. LGPL-2.1, last push 2026-08-27, 2,225 stars. Alive.

`src/models/FGMassBalance.h`, `GetPointmassInertia(double mass_sl, const FGColumnVector3& r)` is twelve lines of parallel axis. `src/models/FGMassBalance.cpp`, `FGMassBalance::Run()` around lines 195 to 235, is the whole composition in the correct order:

1. `Weight = EmptyWeight + TanksWeight + GetTotalPointMassWeight() + ...`
2. `vXYZcg = (EmptyWeight*vbaseXYZcg + GetPointMassMoment() + TanksMoment) / Weight`
3. `mJ = baseJ;` then `mJ += GetPointmassInertia(lbtoslug*EmptyWeight, vbaseXYZcg);`. Note the **hull itself gets a parallel axis term**, because `baseJ` is about the hull's own centre of mass and `mJ` has to be about the whole vessel's
4. `mJ += CalculatePMInertias();`
5. an explicit cofactor inverse into `mJinv`, cached, so torque application does not invert a matrix per frame

And the bug we would otherwise ship, in the same function: **`vDeltaXYZcg` and `NudgeBodyLocation`.** When the centre of mass moves because a pod was dropped, JSBSim translates the tracked body origin by the delta so the craft does not visibly jump. Drop a pod off the tail without this and the ship teleports.

Also `struct PointMass::CalculateShapeInertia()` (around line 243 of the header) has closed forms for tube, cylinder, sphere and ball. A cargo pod is a cylinder, so `Ixx = 0.5·m·r²`, `Iyy = Izz = m(3r² + L²)/12`, and we never integrate a pod mesh.

One more thing worth copying as a habit: `FGMassBalance::bind()` exposes `inertia/mass-slugs`, `inertia/cg-x-in`, `inertia/ixx-slugs_ft2` as named scalars. Harnesses should assert on named numbers, not on a matrix blob.

### OpenRocket's `RigidBody.java`, the smallest correct class

- <https://github.com/openrocket/openrocket>, model rocketry simulation, Java. GPL-3 with a packaging exception, last push 2026-09-01, 3,081 stars. Alive.

`core/src/main/java/info/openrocket/core/masscalc/RigidBody.java` is about 160 lines and is the cleanest statement of the idea I have seen: immutable, `RigidBody(CoordinateIF cm, double Ixx, double Iyy, double Izz)` with mass carried in the coordinate's weight, `rebase(newLocation)` doing the parallel axis, `add(that)` computing the new centre of mass, rebasing both and summing in four lines, and a `RigidBody.EMPTY` identity so composing N pods is a fold. Model our `VesselMassProperties` on this file and take the maths from parry.

### FAR, the only open answer to "does a pod hidden behind the hull add drag"

- <https://github.com/ferram4/Ferram-Aerospace-Research>, GPL-3, last push 2020-08-03, 253 stars. **Dead.** The maintained fork <https://github.com/KSPModStewards/Ferram-Aerospace-Research> (2023-09-18, 93 stars) is also stale. Read it, do not depend on it, do not copy it.

The mechanism is worth understanding even though we will not implement it. `FARPartGeometry/VehicleVoxel.cs` voxelises the assembled craft into a shared grid with each voxel tagged by owning part. `FARPartGeometry/VoxelCrossSection.cs` carries per-part `SideAreaValues { iP, iN, jP, jN, kP, kN, exposedAreaCount, crossSectionalAreaCount }`, which is exposed voxel-face counts per axis direction. Then in `FARAeroComponents/VehicleAerodynamics.cs`, `CalculateVesselAeroProperties()` (line 1059) distributes each cross-section's drag to the parts in it weighted by `exposedAreaCount`. **A pod buried inside the hull has no exposed faces and gets no drag, with no shielding rule written anywhere.** `GaussianSmoothCrossSections()` (line 579) and the `secondAreaDeriv` field give area-rule wave drag from the smoothed cross-section curve.

For noelite this is enormous overkill. The cheap version that reproduces the behaviour that matters: precompute for each pod a projected area along each of ±x, ±y, ±z in hull-local space, and at attach time zero the components the hull's own bounding box blocks. Thirty lines. Clamping a pod into a recess costs nothing; hanging one off the tail costs drag. Which is exactly §10's "part of the puzzle is working out how much you can carry".

### Principia, how to sum tensors when pods sit at odd angles

- <https://github.com/mockingbirdnest/Principia>, n-body gravitation for KSP, C++. **MIT**, last push 2026-09-01, 932 stars. Very alive.

`physics/mechanical_system_body.hpp`, `MechanicalSystem::AddRigidBody(...)` accumulates `centre_of_mass_.Add(dof, mass)` and `sum_of_inertia_tensors_ += inertia_tensor_in_inertial_axes`, then rotates the *total* into the system frame once at the end. The discipline is: sum in one common basis, rotate once. Mixing per-part frames is the thing that goes subtly wrong when pods are attached at arbitrary orientations.

Two smaller steals: `ksp_plugin/part.hpp` has `MakeWaterSphereInertiaTensor(Mass)`, which fabricates a plausible tensor for a part whose real one is unknown by assuming a sphere of water at that mass. Perfect default for a procedurally generated pod. And `ksp_plugin/pile_up.cpp` is how a set of parts becomes one integrated body and back again, which is the clamp and jettison lifecycle.

`physics/euler_solver.hpp` is free rigid-body rotation with a non-diagonal inertia tensor, which is also the crash topic: a tumbling wreck with off-axis inertia does not spin about a fixed axis, and that looks right in a way a constant angular velocity never does.

### Orbiter's ShuttleA, the attach and release state machine

- <https://github.com/orbitersim/orbiter>, MIT, 2026-08-10.

`Src/Vessel/ShuttleA/ShuttleA.cpp` is a literal cargo-pod craft. `ComputePayloadMass()` (line 678) walks the attachment slots and sums. `Grapple()` (around line 616) does `AttachChild` / `DetachChild` and then immediately recomputes. `ActivateCargo(int status)` with `cargo_arm_status` and per-slot `cargo_open[i]` is the arm state machine that stops pods being dropped by accident. `Src/Vessel/ShuttleA/ShuttleA_PL/ShuttleA_pl.cpp` is the pod as an independent vessel once released, which is §10's "a pod that falls off in a crash lies where it fell".

**But do not take Orbiter's inertia maths.** `VESSEL::SetPMI(const VECTOR3&)` in `Orbitersdk/include/VesselAPI.h` is three diagonal principal moments per unit mass with no products of inertia and no recomputation on attach, so every vessel hard-codes a guess. That shortcut is exactly what would stop an asymmetric load producing the coupled tumble we want. Orbiter's lifecycle, parry's tensors.

### The warning that matters most

**cannon-es cannot compose inertia and will silently give the wrong answer.** `src/objects/Body.ts`, `Body.updateMassProperties()` (line 895) approximates the entire body's inertia as a single AABB box via `this.updateAABB()` then `Box.calculateInertia(halfExtents, mass, I)`. It ignores compound shape offsets completely. There is no parallel axis theorem anywhere in the file. Bolt a heavy pod to one wingtip and the roll response will not change. If we use cannon-es we must set `body.inertia` and `body.invInertia` from our own composition and never call `updateMassProperties()` again. Which is an argument for Rapier, see below.

RigsOfRods was checked and is the wrong model: `source/main/physics/Actor.cpp`, `recalculateNodeMasses()` distributes mass across nodes by beam length and has no inertia tensor at all, because inertia emerges from a node-beam lattice. Fine for a lorry, wrong for one rigid body. I found no open-source SimpleRockets clone or Lander clone with a real inertia tensor. Do not go looking.

---

## 6. Persistent wrecks and debris on a budget

### The cheapest thing that would work, and I think it is also the best

§10 already says it: "the hull's own facets (we already build it as separate triangles) tumble
off as little rigid bodies". Do exactly that. Iterate the hull's index buffer, and for each
triangle or small pre-authored group emit a body whose collider is that triangle extruded a
little, with initial velocity `hullVelocity + ω × r + seededUnitVector * scatter`. No fracture
library, no convex hull computation, perfectly deterministic from the wreck's seed, and the
debris is visibly *made of the ship* in a way Voronoi chunks never are. The livery already splits
every hull face into sixteen panels, so the pieces are pre-authored and the right size.

Reach for a fracture library only if triangle debris turns out too fine.

### three-pinata, if it does turn out too fine

- <https://github.com/dgreenheck/three-pinata>, real-time mesh fracturing and slicing for three.js, TypeScript. GitHub reports no repo-level licence but `lib/LICENSE` is **MIT, Copyright 2023 Daniel Greenheck**. Last push 2026-05-12, 419 stars. Alive.

It is the only thing that hits all four of our requirements at once.

- `lib/src/fracture/VoronoiFracture.ts` line 27: `const rng = new SeededRandom(options.seed);`, and the seed is written back into options if it was auto-generated. **Store one 32-bit seed per wreck, regenerate the identical fragment set on revisit, store nothing else.** That is §10's "the wreck is persistent and seeded" with no save format at all.
- `lib/src/entities/FractureOptions.ts`: `VoronoiOptions` carries `impactPoint` and `impactRadius`, so fragment density concentrates at the impact site. Fine shrapnel where you hit, big intact panels at the far end. And `mode: '2.5D'` projects a 2D pattern through the mesh, which is faster and looks correct for flat panels.
- `useApproximation` with `approximationNeighborCount = 12`: exact Voronoi is O(n²) and non-overlapping, kNN is faster but fragments may interpenetrate. Keep exact under about 30 seeds, which is a fine budget for a wreck.
- The demo at `demo/src/physics/PhysicsWorld.ts` is a working three + Rapier integration, and `demo/src/scenes/ProgressiveDestructionScene.ts` refractures fragments on a second impact.

The same author's Unity original is <https://github.com/dgreenheck/OpenFracture> (MIT, 2024-07-17, 1,138 stars) if the algorithm needs reading in a less terse form.

The zero-dependency fallback is in three itself: `examples/jsm/misc/ConvexObjectBreaker.js`
(`prepareBreakableObject`, `subdivideByImpact`, `cutByPlane`) with a complete worked example in
`examples/physics_ammo_break.html`. Recursive plane cutting, cheaper and uglier than Voronoi, and
it is already in the dependency tree.

### Rapier, not cannon-es

- <https://github.com/dimforge/rapier>, Apache-2.0, last push 2026-08-28, 5,712 stars. Alive.
- **<https://github.com/dimforge/rapier.js> is ARCHIVED.** The TypeScript bindings moved into the main repo at `typescript/src.ts/`. Do not read the archived docs.

Three reasons over cannon-es: cannon-es has not been touched since 2024-01-06, it is meaningfully slower for hundreds of bodies, and its `updateMassProperties()` will actively fight the cargo-pod work in §5. One engine for both problems.

- `typescript/src.ts/pipeline/world.ts`: `takeSnapshot(): Uint8Array` (line 210) and `static restoreSnapshot(data): World` (line 229). Far too heavy to persist per wreck, but **exactly what the harness needs**: re-simulate a wreck from its seed and assert the snapshot matches. That is the determinism test, and it is the same discipline as everything else in the project.
- `RigidBody.setBodyType(RigidBodyType.Fixed, false)` promotes settled debris to static without destroying and recreating it, which is the cheap freeze.
- Sleeping is automatic via `isSleeping()`, `sleep()`, `wakeUp()`.

cannon-es' sleeping *parameters* are still worth reading as tuning guidance whichever engine we
pick: `src/objects/Body.ts` has `sleepSpeedLimit = 0.1` and `sleepTimeLimit = 1` second by
default. For debris, push the speed limit up and the time limit down hard. We want it settled and
frozen, not accurate.

### three-mesh-bvh, collide against the terrain we already have, then bake

- <https://github.com/gkjohnson/three-mesh-bvh>, MIT, last push 2026-09-03, 3,471 stars. Very alive.

Two separate wins.

**Collision.** `src/core/MeshBVH.js` plus `MeshBVH.shapecast()` and the raycast extensions in `src/utils/ExtensionUtilities.js` (`acceleratedRaycast`, `computeBoundsTree`) resolve debris against our existing terrain triangles directly. No trimesh collider upload to the physics engine, no duplicated terrain, and it works with chunks that stream in and out. For a hundred pieces settling on ground we already own this is dramatically cheaper than handing the terrain to Rapier.

**Freezing.** `src/utils/StaticGeometryGenerator.js` bakes a set of transformed meshes into one static merged geometry. Once the debris sleeps, run it once and the persistent wreck is a single draw call with a single BVH, which is then also raycastable for the landing gear when the player flies back to it. The plainer alternative is `BufferGeometryUtils.mergeGeometries()`, or `InstancedMesh` if every piece shares a material.

**The pipeline:** spawn N seeded bodies, simulate, poll `isSleeping()`, on all-asleep or an eight-second timeout read back the transforms, bake to `InstancedMesh`, destroy every rigid body, store the seed. Re-entering the region replays the seeded simulation or reads the cached transforms.

### One idea worth taking from Bullet, and nothing else

<https://github.com/bulletphysics/bullet3> (zlib, 2025-10-22, 14,712 stars) has
`examples/FractureDemo/btFractureDynamicsWorld.cpp`. It is a demo, unchanged for years, and it
models fracture as compound shapes that split when a constraint's impulse exceeds a strength
threshold. **The threshold model is the idea:** debris should not shatter on any contact, it
should shatter when accumulated contact impulse over a step exceeds a per-piece strength. One
number gives "graze the ground and skid" against "hit at 200 m/s and disintegrate", which is
exactly the hard-landing versus wreck split §10 asks for. Everything else, take from three-pinata.

`nayrrod/voronoi-fracture` (MIT, 2017-06-23, 25 stars) is 2D only and dead. The Voronoi fracture
search results are otherwise all Unity, Godot, Maya and Houdini plugins. There is no maintained
standalone npm alternative to three-pinata.
---

## 7. River-crossing puzzles: generate, then prove, then offer

### Simon Tatham's puzzles, the generate-then-solve-then-reject loop, done properly for 25 years

- Upstream git, verified by `git ls-remote`: `https://git.tartarus.org/simon/puzzles.git` (HEAD on `refs/heads/main`). There is no official GitHub repo; the gitweb browse UI 403s bots but the clone works.
- Readable mirrors: <https://github.com/ghewgill/puzzles> (223 stars, snapshot to 2024-08-01) and <https://github.com/chrisboyle/sgtpuzzles> (737 stars, 2025-10-21, Android port with upstream C under `app/src/main/jni/`).
- **MIT** (upstream `LICENCE`), so this is safe to copy from.

There is no shared helper. Each puzzle implements a contract, and the contract is documented in
`devel.but` under `\S{backend-new-desc}`: "This is the function whose job is to randomly generate
a new puzzle, **ensuring solubility and uniqueness as appropriate**." The signature is
`char *(*new_desc)(const game_params *params, random_state *rs, char **aux, int interactive);` and
note `**aux`, which smuggles the *known solution* out of the generator so the game's own solve
button never has to search.

The canonical loop is `new_game_desc()` in `solo.c` (line 3552 in the ghewgill snapshot):

1. generate a complete valid grid
2. run `solver(...)` on it, stash the solution in `*aux`
3. shuffle a list of removable clues
4. for each, tentatively remove it, **re-run the solver, and keep the removal only if it is still solvable at or below the target difficulty**
5. and the reject step:

```c
solver(cr, blocks, kblocks, params->xtype, grid2, kgrid, &dlev);
if (dlev.diff == dlev.maxdiff && (!params->killer || dlev.kdiff == dlev.maxkdiff))
    break;                /* found one! */
```

If it does not hit *exactly* the requested difficulty, throw the whole grid away and start over.
The solver returns a **difficulty grade, not a boolean**, and that is the bit worth copying: it is
what turns "solvable" into "solvable in N trips", which is what §10 actually asks for.

There is a second, harder pattern worth knowing about for later. `new_mine_layout()` in `mines.c`
(line 1882) cannot afford to reject and retry, so instead of rejecting it **repairs**: the solver
gets a `mineperturb` callback, is allowed to rewrite the instance when it gets stuck, and is re-run.
The anti-livelock guard is `if (solveret < 0 || (prevret >= 0 && solveret >= prevret)) { success = FALSE; break; }`,
which gives up when the number of repairs stops decreasing, plus `ctx->allow_big_perturbs = (ntries > 100);`
to escalate after repeated failure. If we ever go from rejecting bad cargo manifests to nudging
them into solvability, that is the shape.

Ignore `latin.c`'s `latin_generate()` despite the name. It just makes a random Latin square.

### FlorinTulba/RiverCrossing, the only project that solves *generic* river crossings

- <https://github.com/FlorinTulba/RiverCrossing>, C++23, clang-tidy, unit tests, 23 worked scenarios. Last push 2026-03-21, 4 stars. **No licence declared, which legally means all rights reserved.** Copy the design, not a line of the source.

Four stars and it is a serious project. Every other river-crossing repo on GitHub is one undergraduate BFS over one hardcoded puzzle.

**The scenario schema is the thing.** `Scenarios/wolfGoatCabbage.json`:

```json
"CrossingConstraints": { "RaftCapacity": 2 },
"BanksConstraints":    { "DisallowedBankConfigurations": "2 !0 * ..." }
```

and `Scenarios/merchantsAndRobbers.json`, which types entities and writes constraints over counts
of types rather than named individuals:

```json
"BanksConstraints": { "DisallowedBankConfigurations": "2+ x robber + merchant ; 3 x robber + 2 x merchant" }
```

Entities carry `Id`, `Name`, `Type`, `StartsFromRightBank` and `CanRow` as a **tribool**: yes, no,
or conditionally. That tribool maps straight onto "which cargo can be left unattended". Twenty-three
scenario files (`bridgeAndTorch.json`, `weights.json`, `catchingTheTrain.json`) show the same schema
stretched to capacity, weight and duration variants, which is reassuring if we want a puzzle family
rather than one puzzle.

`src/solverDetail.hpp` has two ideas worth taking:

- `class MovingConfigsManager` (line 183) precomputes **every legal raft configuration once, up front**, looping `for (unsigned cap = 1; cap <= capacity; ++cap)` and partitioning entities into always-row, sometimes-row and never-row. That is the move generator, it is the hot loop of any BFS, and precomputing it is right.
- `AbsStateExt::isNotBetterThan(const IState& s2)` in `src/solver.cpp` line 99 is the **dominance check**, and it is what naive implementations get wrong. The question is not "have I seen this exact state", it is "have I seen a state at least as good". The moment fuel or time enters the state, equality-based visited-sets stop pruning anything.
- `Scenario::solution(bool usingBFS, ...)` at line 157 caches BFS and DFS results separately. BFS gives the minimum trip count, which is our "solvable in N trips"; DFS just finds *a* solution faster.

### The Alcuin number, the theory, and it changes how we should generate

The theory the brief half-remembers is real, and it is more useful than expected.

- Csorba, Hurkens, Woeginger, "The Alcuin Number of a Graph", ESA 2008: <https://link.springer.com/chapter/10.1007/978-3-540-87744-8_27>
- Journal version, SIAM Review 54(1) 2012, doi 10.1137/110848840. Green OA copy: <https://research.tue.nl/en/publications/the-alcuin-number-of-a-graph-and-its-connections-to-the-vertex-co>
- Free follow-up with constructions, arXiv:1409.6949: <https://arxiv.org/pdf/1409.6949>

The result: for a conflict graph `G` with vertex cover number `τ(G)`, the Alcuin number satisfies
`τ(G) ≤ Alcuin(G) ≤ τ(G) + 1`. **The minimum hold capacity is the minimum vertex cover of the
forbidden-pair graph, give or take one.**

That means we should **generate backwards**. Pick the hold capacity the puzzle should demand, then
construct a conflict graph whose vertex cover number is that capacity or one less. Far better than
rolling random forbidden pairs and rejecting. It also flags a real boundary: the theory is only
defined for *pairwise* conflicts. The moment we want "these three cannot share a hold", we are
outside the paper and back to search.

The only implementation I could find is <https://github.com/tuesdaybornwhale/Graph-Alcuin-Number>
(no licence, last push 2025-10-09, 0 stars, a Brussels ULB coursework project in Python with
networkx and pysat). Zero stars, but the SAT encoding in `project.py` is correct and directly
portable. `generate_Q2_cnf(G, k)` builds five constraint families over `(step, vertex)` variables:
everyone starts on bank 0; everyone ends on bank 1; no conflicting edge on the bank opposite the
boatman; a vertex only changes bank when the boatman moves with it; and at most `k` move per step,
encoded by forbidding every `(k+1)`-subset. `find_alcuin_number(G, lower, upper)` binary-searches
on `k`. **`generate_Q5_cnf(G, k, c)` extends it to `c` separate compartments with per-compartment
membership variables, which is exactly §10's "cannot share a hull without a special pod" as
distinct from "cannot be left together".** That distinction is already worked out here.

The horizon is hardcoded to `2n+2` steps, which is fine for correctness because the paper bounds
it. For "solvable in exactly N trips", set the horizon to N and drop the search.

### logic-solver, dead since 2016, and I would still use it

- <https://github.com/meteor/logic-solver>, **MIT**, last push 2019-10-08, 148 stars, npm last published 2016-05-16.

A pure-JS MiniSat port in four files, zero dependencies, no wasm, no build step, identical in
browser and Node. Nothing has broken because nothing has changed.

The reason it beats hand-rolling: **native cardinality constraints**. `Logic.sum(...)` and
`Logic.weightedSum(formulas, weights)` return `Logic.Bits`, and `Logic.lessThanOrEqual(bits1, bits2)`
compares them. So hold capacity is literally:

```js
solver.require(Logic.lessThanOrEqual(Logic.sum(...itemsMovedThisTrip), Logic.constantBits(capacity)))
```

with none of the `(k+1)`-subset blowup the Python encoding above needs. `Logic.atMostOne(...)` and
`exactlyOne(...)` handle compartment assignment. `solver.solveAssuming(assumption)` is incremental,
so the binary search on trip count builds the formula once and re-solves under a bound rather than
rebuilding. And `solver.minimizeWeightedSum(...)` minimises trips directly, so no binary search at all.

Z3's official wasm bindings (<https://github.com/Z3Prover/z3>, `src/api/js`, MIT, npm `z3-solver`,
very alive) are the fallback if the puzzle ever grows arithmetic: fuel cost per trip, weights,
durations. Multi-megabyte wasm and an async API, so disproportionate for boolean forbidden pairs.
Ignore `cpitclaudel/z3.wasm`, it is superseded.

### Checked and not worth ten minutes

The GitHub river-crossing corpus is worthless apart from FlorinTulba. `donovan-prehn/missionaries-and-cannibals`,
`GDLMadushanka/RiverCrossingProbSolver`, `eckucukoglu/river-crossing-puzzle-solver` and the rest are
all single-file undergraduate BFS over one hardcoded puzzle, none generalise, none generate.
**PuzzleScript ships no solver at all** (`increpare/PuzzleScript`, MIT, 1,092 stars, has `compiler.js`,
`engine.js`, `parser.js`, `bitvec.js` and no state-space search; the solvers people mention are
third-party forks). Every Sokoban generator on GitHub is a toy under 10 stars. Tatham does all of it
better with 25 years of hardening.

---

## 8. Progression ladders and gating by reach

### Endless Sky, the closest existing implementation of exactly our mechanic

- <https://github.com/endless-sky/endless-sky>, GPL-3.0, last push 2026-09-02, 7,531 stars. Copy the data design, not the code.

Endless Sky has two drive tiers that gate reach in *different* ways, which is the shape of the
§10b ladder. `data/human/outfits.txt`, verified fields:

```
outfit "Hyperdrive"    cost 50000    "mass" 20  "jump speed" .2  "jump fuel" 100  "hyperdrive" 1
outfit "Scram Drive"   cost 90000                "scram drive" .2 "jump fuel" 150  "hyperdrive" 1
outfit "Jump Drive"    cost 1000000  "mass" 20  "jump speed" .3  "jump fuel" 200  "jump drive" 1
outfit "Fuel Pod"      cost 20000    "mass" 8                    "fuel capacity" 100
```

A hyperdrive can only follow authored links between systems. A jump drive crosses the empty space
between them, bounded by a range, and costs twenty times as much. **That is the map turning from a
graph into a metric space, as a purchase.** And look at the numbers: `jump fuel 100` against a Fuel
Pod's `fuel capacity 100`. One pod is exactly one extra jump, and the flavour text says so. Every
upgrade has an integer meaning the player can state in a sentence. That legibility is the thing to
copy and it is what our §10b table needs at each rung.

`source/ShipJumpNavigation.h` is a dedicated class whose only job is "given this ship's outfits,
where can it go":

```cpp
void Calibrate(const Ship &ship);
double JumpFuel(const System *destination = nullptr) const;
double JumpRange() const;
std::pair<JumpType, double> GetCheapestJumpType(const System *from, const System *to) const;
bool CanJump(const System *from, const System *to) const;
```

Three things to lift. Reachability is a **pure function of ship attributes in one class**, so we can
ask "what would be reachable if the player had drive III" without mutating anything, which is exactly
what a ladder-validation harness needs. `jumpDriveCosts` is a `map<distance, cost>`, so range and
cost scale together as data and `jumpDriveCosts.rbegin()->first` is the max range. And `Calibrate`,
`Recalibrate` and `RecalibrateJumpSpeed` are separate calls because full recalibration is expensive.

`source/DistanceMap.h` turns per-edge `CanJump` into a reachable set, and its `HasBetter(const System &to, const RouteEdge &edge)`
is a **dominance check, not equality**, same as the river-crossing solver's `isNotBetterThan`.

### Puzzle Dependency Charts, the one design document that gives a falsifiable test

- Ron Gilbert's own writeup: <https://grumpygamer.com/puzzle_dependency_charts/>
- More formal primer: <https://www.gamedeveloper.com/design/puzzle-dependency-graph-primer>
- Real published charts: <https://blog.thimbleweedpark.com/act_123_puzzles.html> and <https://grumpygamer.com/rtmi_pdc/>

Gilbert built this for *Indiana Jones and the Last Crusade* and leaned on it for *Monkey Island*.
The reason to read it rather than a Metroidvania video essay is that it gives a **shape test you can
apply to a graph**: a healthy chart shows repeated sub-diamonds, where solving one node opens two or
three, which reconverge on a single bottleneck that opens more. A straight line is a corridor. A fan
that never reconverges is where players get lost. He names *Maniac Mansion*, built without one, as
the counterexample.

The §10b ladder **is** a puzzle dependency chart:
`tank II → the moon → helium route → drive II → Venus → heat shield → ... → jump drive`. Draw it,
look for the diamonds, and note where it is a straight line. Hours 4 to 6 look like a diamond
(Venus and Mercury in parallel, reconverging on drive III). Hours 6 to 8 look like a corridor. That
is worth knowing before we build it.

**And then, for free: we already have the solver from §7.** Run reachability over the ladder graph to
prove the jump drive is obtainable from a cold start, that no rung is orphaned, and that no rung is
reachable earlier than intended. That is ladder validation using the same dominance-pruned BFS as
the cargo puzzle.

### FactorioLab, the recipe schema to copy outright

- <https://github.com/factoriolab/factoriolab>, **MIT**, last push 2026-09-02, 862 stars. Alive. MIT, so we can vendor it.

`src/data/schema/recipe.ts`:

```ts
export interface RecipeJson {
  id: string; name: string; category: string; row: number;
  time: number | string;
  producers?: string[];
  in:  Record<string, number | string>;
  out: Record<string, number | string>;
  catalyst?: Record<string, number | string>;
  cost?: number | string;
  flags?: RecipeFlag[];   // 'mining' | 'technology' | 'burn' | 'locked' | ...
}
```

Three specific things. **`in` and `out` as maps rather than arrays**, so dedup is free and diffs are
trivial. **`number | string` on every numeric**, because the strings are parsed into exact rationals,
not floats, and FactorioLab refuses to accumulate float error in rate maths. Our fuel-per-kilometre
sums will want that. And **technology is just another recipe** with `flags: ['technology']` plus a
separate `prerequisites` / `recipeUnlock` layer in `src/data/schema/technology.ts`, so the tech tree
is a view over the recipe graph rather than a parallel structure. Our
`core + containment vessel + antimatter → jump drive` is one `RecipeJson` with no special case.

Live data at `public/data/1.1/data.json`, 399 recipes, about 198 KB, keys
`version, categories, icons, items, recipes, limitations, defaults, flags`.

### Mindustry, gating on *objectives*, not just on items

- <https://github.com/Anuken/Mindustry>, GPL-3.0, last push 2026-09-03, 28,825 stars. Very alive. Design, not code.

`core/src/mindustry/content/TechTree.java` builds the tree with a mutable `context` pointer and
`Runnable` children, so the **source file's indentation is the tree**:

```java
public static TechNode node(UnlockableContent content, ItemStack[] requirements,
                            Seq<Objective> objectives, Runnable children){
    TechNode node = new TechNode(context, content, requirements);
    if(objectives != null) node.objectives.addAll(objectives);
    TechNode prev = context; context = node; children.run(); context = prev;
    return node;
}
```

Unreadable as data, lovely as source, and it cannot express a cycle or a dangling parent because the
language enforces the structure. For a hand-authored twenty-rung ladder that is the better trade
than FactorioLab's flat `prerequisites: string[]`.

The part to actually steal is `core/src/mindustry/game/Objectives.java`. A node's gate is a
`Seq<Objective>`, with `Produce` (you have made this), `SectorComplete` (you have been there),
`Research`. For noelite that becomes `HasVisited(body)`, `HasFuelCapacity(n)`, `HasLanded(site)`, so
"you may not buy the containment recipe until you have actually been to the giant" is one line
rather than a special case. There is even automatic dependency repair that inserts a missing
`SectorComplete` parent if the author forgot it. And `researchCostMultipliers` **inherits from the
parent node**, which is how you get an exponential cost curve without typing forty numbers.

### Unciv, the validator pattern, with an honest caveat

- <https://github.com/yairm210/Unciv>, **MPL-2.0**, last push 2026-09-03, 11,216 stars. Alive. MPL is the friendliest licence here, file-level copyleft, safe to vendor individual files.

`android/assets/jsons/Civ V - Vanilla/Techs.json` groups techs into columns, and **the column carries
the cost**, so the cost curve is one number per tier rather than one per node:

```json
{ "columnNumber": 1, "era": "Ancient era", "techCost": 35, "buildingCost": 60,
  "techs": [ { "name": "Pottery", "row": 2, "prerequisites": ["Agriculture"] } ] }
```

`row` is pure layout, `columnNumber` is layout and economy. Copy that separation.

`core/src/com/unciv/models/ruleset/validation/RulesetValidator.kt`, `getErrorList()` runs about
twenty checks over a whole mod and produces a structured `RulesetErrorList` with a `sourceObject` on
each entry, and no mod loads until it passes. **But be warned: `addTechErrors` is shallower than the
name suggests.** It mostly checks `tech.row < 1` and that buildings have costs. It does not prove the
tree is completable and does not detect prerequisite cycles at the ruleset level. Take the
architecture, a standalone validator every data file must pass before loading, and write the
reachability proof ourselves with the §7 solver.

### shapez.io, the cost curve as one constant

- <https://github.com/tobspr-games/shapez.io>, GPL-3.0, last push 2026-04-28, 6,954 stars. Feature-frozen (the studio moved to shapez 2) but the file is stable.

`src/js/game/modes/regular.js`, `generateUpgrades(limitedVersion = false, difficulty = 1)`. The whole
progression curve is `const tierGrowth = 2.5;` plus a hand-authored requirements table, e.g. belts at
`30 → 500 → 1000 → 6000 → 25000` and miners at `300 → 800 → 3500 → 23000`. Each entry is
`{ required: [{ shape, amount }] }`, and **the shape itself gets more compound each tier**, so one
field encodes both a quantity wall and a capability wall.

The bit worth stealing is that `difficulty` is threaded into the generator and the result is cached
per variant, so **the entire progression curve is a pure function you can regenerate and A/B**
rather than two hundred magic numbers in a spreadsheet. Given §10b wants roughly twenty rungs over
ten hours, generating the curve from a growth constant and tuning that one number beats hand-typing
it. And note the ratio: 2.5× to 7× between tiers, roughly flat within a tier. That is what produces
"one more upgrade and I can reach the next planet".

### Oolite, and the argument for doing much less

- <https://github.com/OoliteProject/oolite>, `Resources/Config/equipment.plist`.

Each entry is a positional array of `(techlevel, price, name, key, description, {extra})`:

```
0,  2,    "Fuel",                        "EQ_FUEL",           "...", { requires_non_full_fuel = true; }
5,  5250, "Fuel Scoops",                 "EQ_FUEL_SCOOPS",    "...", { provides = ("EQ_CARGO_SCOOPS"); }
10, 6000, "Witchdrive Fuel Injectors",   "EQ_FUEL_INJECTION", "..."
```

Two gates in one list. **`techlevel` gates where you can buy a thing**, so geography gates equipment
and equipment gates geography, which is a deliberate loop and a good one. **`requires` and `provides`**
gate items on other items without inheritance.

But the real lesson is the original Elite rule that Oolite keeps: **the tank holds 7.0 light years and
a jump costs exactly its distance in light years.** One number. No burn rate, no efficiency curve, no
modules. Every player knows their range instantly and can read it straight off the map. §10b proposes
three gating numbers (tank, burn rate, top speed) and that may be two too many. Endless Sky, thirty
years later and with far more design iteration, landed on integer jumps per tank as its legibility
anchor too. I would start with tank size alone, get the ladder working, and add burn rate only when
7.0-light-years-equivalent proves too coarse.

### Outer Wilds, read it last

- GDC 2021 slides, free PDF: <https://media.gdcvault.com/GDC+2021/beachum_gdc_2021(1).pdf>, Alex Beachum, "Sparking Curiosity-Driven Exploration Through Narrative in Outer Wilds". The more design-centric GDC 2020 talk is vault-gated.

Outer Wilds gates on what the player *knows* and has no item ladder at all, so it is the philosophical
opposite of a fuel-capacity gate and most of it does not transfer. The one portable artefact is the
**Ship Log rumour graph**: a player-facing, auto-generated diagram of known facts and the links
between them. §5's "the funnel is the game" needs a UI eventually, and that is the model. Read Gilbert
first.

### Checked and rejected

OpenTTD has no tech tree at all, vehicle availability is date-driven. Naev's
`src/shipstats.h` is a genuinely nice enum-driven stat-modifier system (`SS_TYPE_D_FUEL_MOD`,
`SS_TYPE_D_JUMP_DISTANCE`, `SS_TYPE_A_FUEL_REGEN`) worth a look if we want stacking multiplicative
upgrades, but **Naev's jumps cost a flat amount regardless of distance, so it gates the number of
jumps and not range**, which is not what we are building. "OpenFactorio" and "Factorio-Data" do not
exist as maintained projects; FactorioLab is the route to Factorio recipe data, and also the only
legitimate route to Dyson Sphere Program's (`public/data/dsp/`).

---

## 9. Seeded galaxy generation

### Elite: three 16-bit words, one addition, 256 systems

Covered in §1. Restating the mechanism because it is the point:

```
s0' = s1 ;  s1' = s2 ;  s2' = s0 + s1 + s2      (16-bit, wrapping)
```

Four twists per system (`TT20`, line 17499; `TT54`, line 17528), start from the galaxy seed,
run 256 times, and you have a galaxy. Each system's own three words then answer every question
about it. Galaxy N+1 is galaxy N with every seed byte rotated left one bit within itself
(`Ghy`, line 20080), so there are exactly eight galaxies and the eighth wraps to the first.

There is one thing here that is not just nostalgia: **the generator is a stream, not a hash**.
System 100 is defined as "the state of the register after 400 twists". That is elegant and it is
also a trap: you cannot ask about system 100 without generating 0 to 99, and you cannot insert a
system without moving everything after it. noelite should use a hash of (masterSeed, systemIndex)
instead, which gives the same determinism with random access. Take the *idea* that a galaxy is a
pure function; do not take the shift register.

### Pioneer, the modern version, and the bit noelite should copy today

`src/galaxy/GalaxyGenerator.cpp`, `GalaxyGenerator::GenerateSector` (line 173):

```cpp
const Uint32 _init[4] = { Uint32(path.sectorX), Uint32(path.sectorY), Uint32(path.sectorZ), UNIVERSE_SEED };
Random rng(_init, 4);
for (SectorGeneratorStage *secgen : m_sectorStage)
    if (!secgen->Apply(rng, galaxy, sector, &config)) break;
```

Seed the RNG from the *coordinates plus a universe seed*, so any sector in an effectively
infinite galaxy is generated on demand with no ordering dependency. That is the random-access
fix for Elite's stream.

`src/galaxy/SectorGenerator.cpp`, `SectorRandomSystemsGenerator::Apply` (line 135):
`numSystems = (rng.Int32(4,20) * galaxy->GetSectorDensity(sx,sy,sz)) >> 8`, where the density
comes from a bitmap of the Milky Way (`data/galaxy_dense.bmp`). Star types come from a long
cascade on `rng.Int32(1000000)` (line 188 onward): black holes under 1 in a million, Wolf-Rayets
at 3 to 12, hypergiants in the tens, ordinary main-sequence stars filling the rest. **That is
noelite's rarity table from §5 in exactly the same form**, a count out of a fixed draw rather
than a per-look probability. Good to see the same conclusion reached independently.

The other thing worth copying immediately: `GalaxyGenerator` carries a `name` and a `Version`,
save games record both, and `Create()` refuses to load a save made by a different generator
version (`GalaxyGenerator.cpp` lines 45 to 96, with an explicit `galaxyGenObj["version"] = 1;
// Promote savegame` migration path). noelite is on SEED_VERSION 3 already and DESIGN §5 says
the seed "gets a version number and never moves once authoring has started against it". Pioneer
shows what that costs to enforce properly: a version in the save, a refusal to load, and a
named promotion path when you decide a bump is compatible. Worth building before there are saves
rather than after.

---

## What I'd actually take

Ranked against the §10b build order: fuel, re-entry, crashes and cargo, the station, the economy,
the jump.

**1. Endless Sky's `ShipJumpNavigation` and `data/human/outfits.txt`.** Bookends the whole ladder,
which is why it is first even though re-entry is the next thing we build. The fuel rung and the
jump rung are the same mechanism at two scales, and Endless Sky already has both: a cheap drive
that follows authored links, an expensive one that crosses open space, and a fuel pod that buys
exactly one more jump. One class answers "where can this ship go" as a pure function of its
outfits, which is what our ladder-validation harness needs before it needs anything else. Take the
data shape and the class boundary; it is GPL so write the code ourselves. And take Oolite's older
lesson with it: Elite gated reach with one number, a 7.0 light year tank, and §10b's three numbers
may be two too many.

**2. XRVessels' `XR1PostStepsHullTemps.cpp` and `DeltaGliderXR1_DMGCheck.cpp`.** Re-entry is the
next evening's work and this is twenty years of somebody tuning exactly this until it was fun. The
three pieces: heat as an equilibrium temperature you rise toward rather than an integral, so it is
frame-rate stable; the pressure-ramped conductive cooling that stops v³ from cooking you during
ordinary fast low flight, which is the failure our harness already found at 1,590 m and 1,168 m/s;
and `failureProbability = (dt / 8.0) * (T/limit)²` as the damage model, which is stochastic, correct
in dt, and degrades instead of cliff-edging. Pair it with SpaceAMPL's Sutton-Graves, because the
real thing goes as **√ρ · v³** and not ρ · v³, and the square root is what makes the shallow half of
the corridor bite.

**3. Oolite's `DockEntity.m`.** The single most remembered thing in Elite, and two functions do all
of it. `shipIsInDockingCorridor:` is the slot check done as "does the ship's bounding box fit the
port's, in the port's rotating frame", with the port quietly grown until a big ship fits, a 50%
safety margin that costs scrape damage and nudges you back to centre instead of killing you, and
only the both-opposite-edges case fatal. `addShipToShipsOnApproach:` is the docking computer as a
nine-row table of distance, offset, speed, tolerance and a match-rotation flag, where rotation
matching only switches on for the last four stages. Both are data-shaped and both are testable
headless. Read the original Elite `ISDK` check alongside it for the tolerances: 26° approach, a 22°
cone, and **36.6° of allowed roll error**. Elite felt precise because the presentation was
demanding, not because the maths was tight.

**4. parry's `src/mass_properties/mass_properties.rs`, with JSBSim's `FGMassBalance::Run()` for the
order.** Cargo pods that change the flight are three composition problems and this is the correct,
Apache-2.0, portable answer to two of them. The reason it beats everything else on the list is
`impl Sub`: detaching a pod exactly, so a pod that falls off in a crash leaves the craft in the
state it would have been in had the pod never been fitted, and the harness can assert
`(hull + pod) - pod == hull`. Take JSBSim's pipeline ordering and specifically its `vDeltaXYZcg`
nudge, which is the difference between a ship that settles when you drop a pod and a ship that
teleports. And know that **cannon-es cannot do this and will silently give the wrong answer**,
because `updateMassProperties()` approximates the whole body as one AABB, which is the strongest
argument on this page for Rapier.

**5. Pioneer's `data/economy/`.** §10 says the goods should be derived from the terrain because the
universe is a function, and Pioneer is the only project that actually does it. Conditions are
declarative predicates over physical facts (`atmosDensity < 0.1`, `volatileIces > 0.6`,
`metallicity > 0.7`), conditions gate industries, industries have inputs and outputs, and supply and
demand fall out of the graph. `atmos_airless` adding two air processors to a mine's input list is
the exact texture we want: the moon needs things brought to it *because it is airless*, and that is
a fact about the moon rather than a table entry someone typed. Lift the JSON shape. For the prices
on top, take Oolite's `peak_export` / `peak_import` bias, because "the giant's station wants
anything solid" is a position between two poles and not a signed factor, and take Endless Sky's
four-line stock decay with `price = base - 100·erf(supply/20000)`, because `erf` saturates and
needs no clamp anywhere.

**And one more, because it pays twice.** Simon Tatham's `new_game_desc()` in `solo.c` is the
generate-then-solve-then-reject loop done properly for 25 years, and the detail that matters is that
the solver returns a *difficulty grade* rather than a boolean, which is how "solvable" becomes
"solvable in N trips". Then the Alcuin number result says the minimum hold capacity is the minimum
vertex cover of the forbidden-pair graph give or take one, so we should generate the conflict graph
*backwards* from the capacity we want rather than rolling pairs and rejecting. And the search that
verifies a cargo puzzle is the same dominance-pruned BFS as Endless Sky's `DistanceMap`, which means
**one graph search validates the puzzle, answers "which planets can I reach right now", and proves
the jump drive is obtainable from a cold start.** Write it once.

### Licence summary, because it will matter

Safe to vendor or port directly: **parry** (Apache-2.0), **Rapier** (Apache-2.0), **three-mesh-bvh**
(MIT), **three-pinata** (MIT), **glsl-atmosphere** (Unlicense), **precomputed_atmospheric_scattering**
(BSD-3), **Cesium** (Apache-2.0), **FactorioLab** (MIT), **Unciv** (MPL-2.0), **logic-solver** (MIT),
**Tatham's puzzles** (MIT), **Orbiter** (MIT), **Principia** (MIT).

Read and reimplement, do not copy: **Endless Sky**, **Mindustry**, **shapez.io**, **XRVessels**,
**KSPTrajectories**, **OpenRocket**, **FAR** (all GPL), **Oolite** (GPL-2 with an exception),
**Pioneer** (GPL-3), **Naev** (GPL-3), **Cosmos Journeyer** (AGPL-3).

Read only, no licence granted at all: **Moxon's Elite source** (explicitly so), **Ian Bell's
txtelite**, **FlorinTulba/RiverCrossing**, **Graph-Alcuin-Number**. For the Elite ones the algorithms
are documented in prose and prose is not copyrightable, but the base price tables are Acornsoft's.
Write our own numbers, which is better design anyway: noelite trades timber, helium and canyon
crystal, not Slaves and Narcotics.
