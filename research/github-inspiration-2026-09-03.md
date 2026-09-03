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

### Ian Bell's `txtelite.c` — the whole Elite economy in 1,000 lines of C

- <https://github.com/fragglet/txtelite> — cleaned-up C of Ian Bell's own conversion of the 6502 sources. Last push 2021-10-04, 12 stars, **no licence**.
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

### Mark Moxon's annotated BBC Micro Elite — read this to understand, do not copy

- <https://github.com/markmoxon/elite-source-code-bbc-micro-cassette> — last push 2026-09-03, 487 stars, **explicitly no licence**.
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

### Oolite — the best economy model on the list for what noelite actually wants

- <https://github.com/OoliteProject/oolite> — the maintained Elite-in-spirit game, Objective-C. Last push 2026-08-31, 655 stars, licence reported as NOASSERTION (it is GPL-2 with an exception, check `LICENSE`).

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

### Pioneer — supply and demand as an industry graph derived from planet facts

- <https://github.com/pioneerspacesim/pioneer> — Frontier-inspired, real orbits, C++ and Lua. Last push 2026-09-02, 1,906 stars, licence reported NONE by the API but the repo is GPL-3 (`licenses/` directory).

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

### Endless Sky — the smallest dynamic economy that works

- <https://github.com/endless-sky/endless-sky> — GPL-3.0, last push 2026-09-02, 7,531 stars. Very much alive.

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

### Naev — prices as sine waves, which is a genuinely good idea for us

- <https://codeberg.org/naev/naev> — moved off GitHub, the GitHub repo `naev/naev` is now a mirror. Codeberg last update 2026-09-03, GPL-3. Alive.

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

### Elite: The New Kind — skip it

- <https://github.com/fesh0r/newkind> — Christian Pinder's C reimplementation of BBC Elite. Last push 2015-10-05, 145 stars, no licence.

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

### Oolite's `DockEntity` — the production version of the same thing, with a forgiveness margin

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

### Pioneer — approach paths authored as matrices in the station model

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

### Pioneer — the modern version, and the bit noelite should copy today

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

