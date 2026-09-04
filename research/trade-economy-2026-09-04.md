# How open-source games actually pay for a delivery

Research pass, 2026-09-04, for §10, §10b and §10d. Every formula below came out of the
file named beside it, today, with `curl` against `raw.githubusercontent.com`. Licences were
read from each repository's own licence file or the GitHub API. Where a number is invented
by me it says so in the last section, and nowhere else.

## Licences, before anything else

| Project | Licence, as verified |
|---|---|
| OpenTTD | GPL v2, `COPYING.md` |
| Endless Sky | GPL-3.0 per the API, and every data file carries a GPLv3 header |
| Naev | GPL v3 for source and Lua per `LICENSE`; art varies, so the API says `NOASSERTION` |
| Pioneer | GPL v3 (`licenses/GPL-3.txt`, README badge); no top-level file, so the API says none |
| Simutrans | Artistic Licence, per `simutrans/license.txt` |
| Oolite | GPL v2, `LICENSE.md` |
| `txtelite.c` | **no licence at all**, as last time |

The rule is unchanged from the 09-03 pass. Everything here except txtelite is copyleft, so
we read the algorithm, take the shape, and write our own numbers and our own code. A
formula cannot be copyrighted. A table of base prices can. Nothing below should be pasted.

## OpenTTD: the payment formula worth stealing the shape of

`src/economy.cpp`, lines 1474 to 1533, `GetTransportedGoodsIncome`. Income for one
delivery, in pounds, with `dist` in map tiles and `num_pieces` in cargo units:

```
income = dist * time_factor * num_pieces * current_payment  >>  21
```

`current_payment` is the cargo's `initial_payment` scaled by inflation. The design lives in
`time_factor`, a piecewise function of `transit_periods`, the time the cargo spent aboard.
Each cargo carries two thresholds. With `over1 = max(t - p0, 0)` and
`over2 = max(over1 - p1, 0)`:

```
time_factor = clamp(255 - over1 - over2, min 31)
```

It is flat at 255 inside the first threshold, then falls with slope 1, then slope 2, then
floors at 31. Past the floor a fourth branch decays towards 1 as
`2*31*16*16 / (periods_over_max + 32)`, with the shift raised to 25. The comment in the
file spells the bands out.

From `src/table/cargo_const.h` (weight is in sixteenths of a tonne, so 16 means one tonne
per unit):

| Cargo | `initial_payment` | weight | `transit_periods` |
|---|---|---|---|
| Passengers | 3185 | 1 | 0 / 24 |
| Coal | 5916 | 16 | 7 / 255 |
| Wood | 5005 | 16 | 15 / 255 |
| Goods | 6144 | 8 | 5 / 28 |
| Food | 5688 | 16 | 0 / 30 |
| Valuables | 7509 | 2 | 1 / 32 |
| Water | 4664 | 16 | 20 / 80 |

Work one through. A hundred tonnes of coal, a hundred tiles, twenty periods in transit:
`over1` is 13, `time_factor` is 242, and the income is `100 * 242 * 100 * 5916 >> 21`,
which is £6,827. Raw bulk pays badly per unit and forgives slowness for 255 periods, while
valuables pay half again as much and start losing value after one period. Speed matters
where the design wants it to.

**Industries.** `src/table/build_industry.h` gives each industry a production rate per
cargo. Coal mine 15 units of coal, forest 13 of wood, iron mine 10 of ore, farm 10 grain
and 10 livestock, oil rig 15 oil and 2 passengers. Processing industries such as the
sawmill have rate 0 and instead accept an input at a 256/256 multiplier, converting one for
one. Each declares which industries it wants nearby and which climates it may appear in.

Production runs every `INDUSTRY_PRODUCE_TICKS = 256` ticks, a day being 74 ticks, so
roughly every three and a half days. `src/industry_cmd.cpp` line 2599 scales the rate by
`prod_level`, default 0x10, minimum 0x04, maximum 0x80, so an industry runs anywhere from a
quarter to eight times its book rate. The drift, in `ChangeIndustryProduction` around line
2940, is the part worth copying. Once a month there is a 1 in 22 chance per cargo of a
change, and the direction depends on how much you moved last month: at or below 60%
transported the chance of a rise is 1 in 3, at or below 80% it is 2 in 3, and above that
5 in 6. The step is `max((rand(0..49) + 10) * old_rate / 256, 1)`, between about 4% and 23%
of the current rate. Serve a mine well and it grows; ignore it and it closes.

**Station rating**, `src/station_cmd.cpp`, `UpdateStationRating`. Speed above 85 adds
`(speed - 85) / 4`, then a bracket ladder on time since the last pickup adds 25 points
within 21 periods, another 25 within 12, another 45 within 6 and another 35 within 3. A
flat minus 90 follows, clawed back by having little cargo piled up. The rating moves
towards its target by at most two points per period, and a low rating with cargo waiting
starts randomly deleting that cargo. It is a lagging average of service quality that feeds
back into how much stock the industry hands you.

**The bank.** `src/economy_type.h`: `INITIAL_LOAN` 100,000, `LOAN_INTERVAL` 10,000,
`MAX_LOAN_LIMIT` two billion. `src/company_cmd.cpp` line 648 starts a company with
`money = current_loan = INITIAL_LOAN`, so you begin fully borrowed. The default maximum
loan in `difficulty_settings.ini` is 300,000 and `initial_interest` defaults to 2, with a
range of 2 to 4. `CompaniesPayInterest` (economy.cpp, line 1308) charges
`yearly_fee = current_loan * interest_rate / 100`, apportioned by month, and charges the
same rate again on any negative balance.

**Subsidies** are the closest thing OpenTTD has to a contract board.
`difficulty_settings.ini` gives `subsidy_multiplier` a default of 2 with a range of 0 to 3,
and `subsidy_duration` one year. `src/subsidy.cpp` line 434 onwards generates them monthly,
with a 1 in 8 chance of a passenger subsidy and a 1 in 16 chance each of a cargo subsidy
sourced at a town or at an industry. Take the offer and that route pays double for a year.

## Endless Sky: price as a function of stock, in one line

`source/System.cpp`, line 1305:

```cpp
price = base + static_cast<int>(-100. * erf(supply / LIMIT));
```

with `LIMIT = 20000` tons. The error function is the whole trick. It saturates, so no
matter how much you dump on a system the price falls by at most 100 credits and no matter
how much you strip out it rises by at most 100. Trading moves the price and cannot break
it. `StepEconomy`, line 1101, runs each day:

```cpp
exports = 0.10 * supply;
supply *= 0.89;
supply += Random::Normal() * 2000.;
```

Eleven per cent of the surplus decays every day, so a price you moved recovers with a
half-life of about six days, and a normal random walk of standard deviation 2,000 tons
keeps it from being predictable.

Base prices are static per system in `data/map systems.txt`, as lines like
`trade "Heavy Metals" 1241`. The bands are declared once in `data/commodities.txt`:
Food 100 to 600, Clothing 140 to 440, Metal 190 to 590, Plastic
240 to 540, Equipment 330 to 730, Medical 430 to 930, Industrial 520 to 920, Electronics
590 to 890, Heavy Metals 610 to 1310, Luxury Goods 920 to 1520, all credits per ton.

**Mission payment**, `source/GameAction.cpp`. Line 185 parses it and line 550 computes it:

```cpp
result.payment = payment + (jumps + 1) * payload * paymentMultiplier;
```

A bare `payment` keyword with no arguments sets the multiplier to 150. So the default job
board pays 150 credits per ton per jump, plus one, plus any flat base. That is distance
times mass, and it is about a quarter of the value of the cargo itself per jump. Deadlines
work the same way, line 1621: `deadline = today + deadlineBase + deadlineMultiplier * jumps`.

**Running costs.** `PlayerInfo::Salaries`, line 1075, charges 100 credits a day for every
crew member except the player, across every ship not parked. That is how owning a fleet
that flies your routes for you is made to cost something.

**Borrowing.** `source/Mortgage.cpp` line 40 sets
`interest = (600 - creditScore / 2) * .00001` per day, so credit score drives the rate.
The maximum you may borrow is your revenue divided by the standard amortisation multiplier
at that rate over the term.

## Naev: price as a function of time, and a library that flies NPC convoys

`src/economy.c`, lines 148 to 155:

```c
price = commPrice->price
      + commPrice->sysVariation  * sin( 2.*M_PI*t / commPrice->sysPeriod )
      + commPrice->spobVariation * sin( 2.*M_PI*t / commPrice->spobPeriod );
```

`t` is in game periods; the comment at line 112 says a single jump is about three periods.
Two sine waves of different wavelength, one for the system and one for the planet, so
prices breathe on a schedule a player can learn without being able to crash them.

Commodity data lives in `dat/commodities/*.xml`. Food is priced 210 with a period of 80,
Ore 210 with 100, Gold 550 with 40, Luxury Goods 630 with 50. Each carries `spob_modifier`
entries keyed by planet class plus a `population_modifier`; food is 0.4 on an M-class world
and 0.7 on an H-class one. That is Elite's "economy type sets the price" done as data.

**Cargo mission reward**, `dat/missions/neutral/cargo.lua`, lines 76 to 80:

```lua
mem.amount   = rnd.rnd(5 + 25*tier^1.9, 20 + 60*tier^2.15)
local price  = commodity.get( mem.cargo ):price()
local jumpreward = price*1.5
local distreward = math.log(100*price)/80
mem.reward = 1.55^tier * (avgrisk*riskreward + numjumps*jumpreward + traveldist*distreward)
             * (1.2 + 0.07*rnd.twosigma())
```

with `riskreward` at 0, 10, 25 or 50 for the four danger bands. Jumps pay in proportion to
the cargo's own value, while raw distance inside a system pays only logarithmically, so
crossing a border is what pays. The tier exponent means a tier 3 job carries roughly ten
times the tonnage of a tier 1.

**The visible NPC hauler.** `dat/scripts/escort.lua` is a reusable library, 650 lines, whose
whole job is to spawn a fleet of NPC ships that fly a route on their own.
`escort.init(ships, params)` creates them, `escort.setDest(spob, "success_fn")` gives them a
destination, and the internals at lines 254 and 259 order the leader to `land()` on the
target or `hyperspace()` towards the next system on the route. Hooks fire when each one
lands. `dat/missions/trader/trader_escort.lua` uses it for convoys of one to five haulers,
paying `2.0 * (avgrisk*jumps*jumpreward + dist*distreward)` where `jumpreward` runs from
6 to 10 times the commodity price with convoy size.

This is the nearest thing in open source to the brief's subcontracting. Nothing I found
lets you hand a contract to an NPC and take a cut. Naev has the machinery for an NPC that
visibly flies a route and reports on arrival; Endless Sky has the cost model for a fleet
you own and do not pilot. Ours is those two joined.

## Pioneer: industries as data, keyed to what the ground is like

`data/economy/industries/mining.json` is the file the noelite design has been circling.

```json
"ore_mine": {
  "context": "surface",
  "conditions": [ "metal_moderate" ],
  "inputs":  { "mining_machinery": 3, "air_processors": 2, "narcotics": 4 },
  "outputs": { "metal_ore": 6, "carbon_ore": 4 },
  "modifiers": {
    "metal_abundant": [ "i:mining_machinery+1", "o:metal_ore+1" ],
    "atmos_airless":  [ "i:air_processors+2" ]
  },
  "build_next": [ { "if": ["rare_metals"], "id": "telluric_ore_refinery", "chance": 0.9 } ]
}
```

An industry exists on a body only if the body satisfies its conditions, and the terms of
its recipe are then bent by further properties of that body. An airless world needs two
more air processors; a gas giant runs `gas_giant_extraction` instead, producing hydrogen 9
and liquid oxygen 5. `build_next` lets an industry pull its own customer into existence.
`data/economy/commodities/mining.json` prices the goods: hydrogen 5, water 13.5, liquid
oxygen 19.8, carbon ore 21, metal ore 43, precious metals 2180, each with an `inputs` list
naming what it is made from.

## Simutrans and the Elite line: what each adds

Simutrans (`src/simutrans/simfab.cc`) adds one idea OpenTTD does not have. A factory's
output is multiplied by boosts earned from services delivered to it, `prodfactor_electric`
and `prodfactor_pax` among them, computed at lines 453 and 479 as `arrived * boost / demand`
with demand scaled from base production. Power a factory and it makes more. Input goods
also have real storage limits, computed at line 591 from `prodbase`, so a plant starves
when its inputs dry up. Given the fabrication step at the giant's outpost in §10b, "deliver
power or the trap breeds slowly" is a rule worth having.

The Elite line was covered in the 09-03 pass; I re-read it for one thing. `txtelite.c`
`genmarket`, line 525, is `q = basequant + (fluct & maskbyte) - economy*gradient` for
quantity and `price = (baseprice + (fluct & maskbyte) + economy*gradient) * 4`, both
truncated to a byte. Oolite generalises that into floats in `src/Core/OOCommodities.m`,
lines 417 to 450:

```
econ   = base * price_economic * -bias
random = base * price_random * (randf() - randf())
price  = base + econ + random
```

where `bias` comes from `economicBiasForGood` at line 478 and runs from +1 at the economy
that most exports the good to -1 at the one that most imports it.
`Resources/Config/trade-goods.plist` holds the numbers as data: food has `price_average` 50
decicredits, `price_economic` 0.55, `price_random` 0.04, `peak_export` 7 and `peak_import`
0. That is the version to imitate, being Elite's curve with the bit twiddling replaced by
readable floats in a data file.

## A model for noelite

Two things settle the shape. The universe is a function of a seed, so every price must be
derivable from it. And the ladder in §10b is ten hours long, so the money curve has to span
roughly three orders of magnitude.

**Industries per body.** Copy Pioneer's file format and write our own contents. An
industry is a record with a `site` rule (the terrain predicate the outpost spawner already
evaluates: forest, shallows, mountain belt, canyon, regolith, upper air), an `inputs` map,
an `outputs` map per production cycle, and modifiers keyed on the body's own properties
such as airless, hot or high gravity. Home and Marram get sawmills at forests,
desalination on the shallows and smelters at mountain belts; the moon gets a regolith
cracker and an ice mine, and the giant's outpost gets the fabricator. All seeded, so a
world always has the same industries.

**Rates.** One production cycle per 200 seconds of game time, which is about the length of
one short flight. All numbers in this section are mine unless the source is named.

| Good | Produced per cycle | Base price, credits per tonne | Where it comes from |
|---|---|---|---|
| Water | 12 t | 20 | sea, shallows |
| Timber | 10 t | 35 | forest |
| Ore | 8 t | 60 | mountain belt |
| Ice | 8 t | 45 | poles, airless moon |
| Salt | 10 t | 30 | flats |
| Helium | 4 t | 220 | regolith |
| Canyon crystal | 2 t | 480 | canyon |
| Deuterium | 3 t | 900 | giant, scoop run |

Consumption is a rate per station, in tonnes per cycle, set to about 60% of what the
nearest producer makes, so a route is always slightly short.

**Price.** Endless Sky's error function, with our own constants:

```
price = base * (1 + 0.6 * erf((demand - stock) / K))
```

with `K = 400 t` for bulk goods and `K = 40 t` for the rare ones. The band is a proportion
of base rather than Endless Sky's flat 100 credits, because our base prices span 20 to 900
and a flat offset would be meaningless at both ends. Stock relaxes towards equilibrium at
11% per cycle, taken from Endless Sky's `KEEP = .89`, so a route you hammer softens over
about six cycles and recovers over about the same. That is the behaviour §10 promised.

**Payment for a delivery.** Two terms, following Endless Sky's mission formula rather than
OpenTTD's, because ours is a real-space game where distance is metres and time is seconds:

```
pay = tonnes * (sell_price - buy_price)                       [free trade]
pay = base + tonnes * (0.9 + 0.5 * d_km / 1000) * price * f_t [contract]
```

where `d_km` is the great-circle or interplanetary distance and `f_t` is the time factor.
Take OpenTTD's four-band shape and give each contract a par time `T`: `f_t` is 1.0 up to
`T`, falls linearly to 0.5 at `2T`, then to 0.2 at `3T`, then floors at 0.15. A run from
home's pad to the moon's station should pay around 1,400 credits at par, which is one rung
of the ladder per four or five runs early on.

**Recurring routes.** A contract completed three times converts into a standing route with
the same endpoints and good, a fixed tonnage per cycle, and a 15% premium for reliability.
Miss two cycles and it lapses. That is OpenTTD's subsidy with the timer inverted.

**Subcontracting.** The carrier is a real ship in the world, spawned at the source with a
pod visible on its hull, flying the same physics on a simplified controller and landing on
the same pads. Naev's escort library is proof this reads well. The subcontractor takes 45%
of the contract value and flies it at roughly 0.7 of a good player's pace, so doing it
yourself is better per run and worse per hour. Failure rises with distance, say 4% plus 1%
per 1,000 km, and a failed run leaves a wreck you can fly to and salvage, reusing
`Wreck.ts`. Cap active subcontracts at one early, four late.

**The bank.** OpenTTD's shape with our numbers. Start with a 5,000 credit loan already
drawn and 5,000 in the account, so the first hour is spent owing money. The ceiling starts
at 20,000 and rises by 20,000 each time you buy a drive tier, to a maximum of 200,000.
Interest is 3% a year charged monthly, and 6% on a negative balance. Repayment in 1,000
credit blocks. The purpose is to let a player buy tank II an hour early and pay for it, and
to make the first hull repair frightening.

**Upgrades.** Price the ladder off the payment curve so each rung is eight to twelve good
runs: tank II 4,000, cruise drive 12,000, insulated pod 8,000, cage pod 6,000, heat shield
30,000, drive II 45,000, scoop 90,000, fuel cracker 120,000, drive III 160,000, drive core
600,000. All invented, and all should move once a route is flown for real.

**What to build first.** Money, a stock number per station and the error-function price.
Contracts on top, then the standing route, then the subcontractor, the only part needing
new flight code.
