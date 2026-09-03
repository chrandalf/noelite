# Sound sources and the epic opening

Research note, 3 September 2026. Every URL below was fetched and checked. Where a link
turned out to be dead I have said so instead of quietly dropping it.

Constraint that shaped all of this: noelite has no art assets by rule, and the game may be
sold. So the licence bar is CC0, MIT, Apache, Unlicense, zlib, or CC-BY with the credit kept.
CC-BY-NC and GPL-for-assets are out.

---

# Part 1a. Procedural sound in the browser

This is the section that actually fits noelite. Everything here builds sound in code, which
is the same rule the polygons live under.

## ZzFX (Frank Force)

https://github.com/KilledByAPixel/ZzFX

- Licence: MIT
- Repo size: 1,116 KB. `ZzFXMicro.min.js` is 1,222 bytes of raw source, which is the "under
  1 KB compressed" claim. The full `ZzFX.js` is 10,159 bytes.
- Stars: 779. Created April 2019.
- Last commit: 3 September 2026, "Fix master volume being applied twice and loud fade-out on
  library click". Before that, five commits on 11 July 2026. This is a live project, not a
  jam artefact.

**Can it do a continuous engine that varies with throttle? Yes, but only the full version, and
only sideways.** The micro build is one-shot only. `ZzFX.js` has this:

```js
playSamples: function(sampleChannels, volumeScale=1, rate=1, pan=0, loop=false)
{
    ...
    source.playbackRate.value = rate;
    source.loop = loop;
    ...
    source.gainNode = gainNode; // expose so callers can adjust or fade
    ...
}
```

and `ZzFXSound.play(volume=1, pitch=1, randomnessScale=1, pan=0, loop=false)` on top of it.
So the recipe is: call `buildSamples()` once with heavy `noise` and a low `filter` cutoff to
get about two seconds of engine texture, play it with `loop=true`, keep the returned
`AudioBufferSourceNode`, and drive `source.playbackRate.value` and
`source.gainNode.gain` from your throttle every frame. The author deliberately exposed the
gain node for exactly that.

The catch: `playbackRate` shifts the entire buffer, noise character included. Push past about
0.7 to 1.4 and your engine sounds like a wasp. Two buffers crossfaded, or a hand-built graph,
is the real answer. Use ZzFX for the transients and build the hum yourself.

**The 21 parameters**, verbatim from `buildSamples`:

```
volume=1, randomness=.05, frequency=220, attack=0, sustain=0, release=.1,
shape=0, shapeCurve=1, slide=0, deltaSlide=0, pitchJump=0, pitchJumpTime=0,
repeatTime=0, noise=0, modulation=0, bitCrush=0, delay=0, sustainVolume=1,
decay=0, tremolo=0, filter=0
```

**Documented recipes.** The generator page ships real parameter ranges per sound class. Pulled
verbatim out of `index.html`, where `R(a,b)` is a random in range:

```js
case 'Shoot':
    sound.frequency = R(50,500);
    sound.shape = R()<.2 ? 5 : R(2)|0;
    sound.attack = R(.03);   sound.decay = R(.05,.1);
    sound.sustain = R(.2);   sound.sustainVolume = R(.5, 1);
    sound.release = R(.05,.1);
    sound.slide = R(-1,1)*20;  sound.deltaSlide = R(-1,1)*50;
    sound.bitCrush = R()<.5 ? 0 : R(.5);

case 'Explosion':
    sound.frequency = R(30,99);
    sound.attack = R(.1);    sound.decay = R(.05,.2);
    sound.sustain = R(.3);   sound.sustainVolume = R(.3, .5);
    sound.release = R(.2, .6);
    sound.noise = R(2);
    sound.bitCrush = R(1,.1);
    sound.filter = R()<.5 ? 0 : R()<.5 ? 99+R()**2*2e3 : R()**2*2e3-3500;

case 'Hit':
    sound.frequency = R(30,500);
    sound.attack = R(.03);   sound.decay = R(.1);
    sound.sustain = R(.1);   sound.release = R(.2);
    sound.noise = R(2);      sound.bitCrush = R(.5);

case 'Blip':   // built on a random sound, then clamped short
    sound.attack = R(.03); sound.decay = R(.03);
    sound.sustain = R(.04); sound.release = R(.04);
```

There is no engine preset, because ZzFX has no concept of a sustained sound. That gap is
yours to fill.

## jsfxr (chr15m)

https://github.com/chr15m/jsfxr

- Licence: The Unlicense. Public domain. Cleanest licence in this whole document.
- Size: 564 KB. Stars: 443. Last push: 5 May 2026. Created 2015. Runs at sfxr.me.
- Descended from Dr Petter's sfxr via Eric Fredricksen's port.

One-shots only, no loop path, no throttle. Its value is as a design tool: mash the Laser and
Explosion buttons until something is right, then either export the wav or copy the parameter
string and synthesise it at runtime. For a game with a no-assets rule, use it to find the
sound and then translate it into ZzFX parameters or your own graph.

Older ports exist at github.com/grumdrig/jsfxr and github.com/mneubrand/jsfxr. Use chr15m's.

## Tone.js

https://github.com/Tonejs/Tone.js

- Licence: MIT. Stars: 14,718. Repo 31 MB. Last push 3 September 2026.
- Has `Tone.Noise` (white, pink, brown), `Tone.Filter`, `Tone.LFO`, `Tone.AutoFilter`.

It will absolutely do a continuous throttled hum: `Noise -> Filter` with an `LFO` on the
filter frequency and a `Signal` ramp on cutoff and gain. It is also an enormous dependency for
a game that needs maybe nine audio nodes. I would not pull it in for the hum. I would pull it
in only if you decide to write a real generative music layer and want its transport and
scheduling. Check the bundle size against your build before committing to it.

## engine-sound-generator (Antonio-R1)

https://github.com/Antonio-R1/engine-sound-generator

- Licence: MIT. Stars: 47. Size: 842 KB. Last push: 6 November 2022. Stale but complete.
- Live demos: antonio-r1.github.io/engine-sound-generator/src/engine_sound_generator/sounds_worklet.htm
  and the WASM build at `sounds_worklet_wasm.htm`.

Waveguide physical modelling of intake, exhaust and muffler, with configurable waveguide
lengths and reflection factors, running in an AudioWorklet. Doppler via DelayNodes. Continuous
and parameter-driven:

```js
let rpmParam = soundCarEngine.worklet.parameters.get('rpm');
rpmParam.value = someValue;
```

It models a four-stroke car, so out of the box it sounds like a car. What is worth taking is
the architecture: one AudioWorklet, one AudioParam you write every frame, synthesis on the
audio thread so it never glitches when the render thread hitches. That is the correct shape
for a ship engine that has to track throttle at 60 Hz.

## noise.js (zacharydenton)

https://github.com/zacharydenton/noise.js

- Licence: MIT. Stars: 114. Size: 54 KB. Last push: 28 October 2017.

Tiny, and it hands you the Voss-McCartney pink noise coefficients on a plate:

```js
b0 = 0.99886 * b0 + white * 0.0555179;
b1 = 0.99332 * b1 + white * 0.0750759;
b2 = 0.96900 * b2 + white * 0.1538520;
b3 = 0.86650 * b3 + white * 0.3104856;
b4 = 0.55000 * b4 + white * 0.5329522;
b5 = -0.7616 * b5 - white * 0.0168980;
output[i] = b0+b1+b2+b3+b4+b5+b6 + white * 0.5362;
output[i] *= 0.11;
b6 = white * 0.115926;
```

It uses `createScriptProcessor`, which is deprecated and runs on the main thread. Do not ship
the file. Copy those eight lines into a one-off buffer fill or an AudioWorklet.

## procedural-sounds (m1ckc3s)

https://github.com/m1ckc3s/procedural-sounds

- Licence: MIT. Stars: 177. Size: 1,271 KB. Last push: 18 August 2026.
- Live at procedural-sounds.vercel.app

TypeScript, generates UI sounds live in the browser from recipes and exports either a WAV or
a few lines of JavaScript. The README states "There are no audio files anywhere in the
product", which is noelite's rule applied to sound. Early beta, no npm package yet, so today
you paste the exported JS. For the HUD blips and the beacon chirp this is the fastest way to
get something with taste on it.

## Trackers and tiny synths, for completeness

- **sonant-x**, https://github.com/nicolas-van/sonant-x. Licence zlib, 249 stars, last push
  18 June 2025. Companion tracker at github.com/nicolas-van/sonant-x-live.
- **SoundBox**, https://github.com/mbitsnbites/soundbox. 445 stars, last push 31 August 2023.
  Licence is split, and the split matters. README: "The SoundBox editor is licensed under the
  GNU General Public License version 3. However, the minimal player routine, player-small.js,
  is released under the zlib/libpng license. This makes it suitable for inclusion in your own
  software." Ship `player-small.js` only. Never ship the editor.
- **LittleJS**, https://github.com/KilledByAPixel/LittleJS, MIT, 4,173 stars, pushed 3 September
  2026. Same author as ZzFX and it embeds ZzFX. Only relevant if you ever want a second engine.

## The hum recipe I would actually write

None of the above ships a spaceship hum, so here is the graph, built from Web Audio
primitives, no dependency:

1. **Body.** One `AudioBufferSourceNode`, `loop = true`, holding two seconds of brown noise
   generated once at load (integrate white noise, scale by 0.02, DC-block). Into a
   `BiquadFilterNode` type `lowpass`, `Q` about 1.
2. **Tone.** One `OscillatorNode`, sawtooth, at 45 to 70 Hz, into its own lowpass at 200 Hz
   and its own gain. This is the part you feel rather than hear.
3. **Throttle.** Map throttle 0..1 to lowpass cutoff 120..900 Hz and to the master gain. Use
   `setTargetAtTime(target, now, 0.15)` on both, never `setValueAtTime`, or it zips.
4. **Chest.** A `peaking` biquad at 60 to 90 Hz, gain +4 dB. Cheap weight.
5. **Life.** An `OscillatorNode` at 0.2 to 0.7 Hz with a gain of about 40, connected into
   `lowpass.frequency`. The hum breathes and stops being a drone.
6. **Air.** A second noise voice through a `bandpass` at 400 to 2000 Hz, gain driven by
   dynamic pressure `q = 0.5 * rho * v * v`. You already compute rho for drag, so re-entry
   roar and atmospheric wind fall out of the flight model for free, and in vacuum this layer
   goes to zero on its own with no special case.
7. **Ceiling.** Keep the whole hum bus under about -22 dBFS and sidechain-duck it 4 to 6 dB
   for 300 ms whenever anything else fires.

That is roughly nine nodes and maybe 80 lines. Cheaper than any library on this list.

---

# Part 1b. Sample packs with usable licences

Even under a no-assets rule these are worth having on disk as reference. You cannot tune a
synthesised thruster without something to A/B against.

## Kenney, CC0, all of it

Kenney's packs are the best-licensed game audio on the internet. The licence text inside the
zip is explicit:

```
License: (Creative Commons Zero, CC0)
http://creativecommons.org/publicdomain/zero/1.0/
This content is free to use in personal, educational and commercial projects.
Support us by crediting Kenney or www.kenney.nl (this is not mandatory)
```

### Sci-fi Sounds, 70 files, ogg, 5.9 MB

https://kenney.nl/assets/sci-fi-sounds
Direct zip: https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip
Also mirrored on OpenGameArt: https://opengameart.org/content/sci-fi-sounds

I downloaded it and listed it. Exact file names, all under `Audio/`:

**Engine and thruster, every one exactly 5.000 seconds:**
`spaceEngineLow_000..004`, `spaceEngineSmall_000..004`, `spaceEngineLarge_000..004`,
`spaceEngine_000..003`, `engineCircular_000..004`, `thrusterFire_000..004`

I measured RMS at the head, middle and tail of the best candidates, because a five second file
is not automatically a loop:

| File | head | mid | tail | verdict |
|---|---|---|---|---|
| `spaceEngineLarge_000.ogg` | -5.25 dB | -5.10 dB | -4.97 dB | flat, loops with a 40 ms crossfade |
| `spaceEngineLow_000.ogg` | -7.35 dB | -8.11 dB | -7.64 dB | flat, loops with a crossfade |
| `thrusterFire_000.ogg` | -21.79 dB | -19.14 dB | -16.93 dB | ramps up, one-shot |
| `engineCircular_000.ogg` | -11.33 dB | -19.85 dB | -16.90 dB | a swell, not a loop |

So `spaceEngineLow_000` and `spaceEngineLarge_000` are your two crossfade layers if you ever
want a sampled fallback. `thrusterFire_*` is a burst, use it for the reactor light-up.

**Lasers:** `laserSmall_000..004` (0.24 s), `laserRetro_000..004`, `laserLarge_000..004`
**Rock break and explosion:** `explosionCrunch_000..004` (0.78 s), `lowFrequency_explosion_000/001` (2.0 s), `impactMetal_000..004` (0.63 s)
**Beacon, computer, HUD:** `computerNoise_000..003` (5 s loops), `forceField_000..004` (0.95 s)
**Docking clunk:** `doorClose_000..002`, `doorOpen_000..002`

### Impact Sounds, 130 files, CC0

https://kenney.nl/assets/impact-sounds
Direct zip: https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip

The one that matters for noelite is `impactMining_000..004`. That is the asteroid-shooting
sound, already made. Also `impactMetal_heavy_000..004` and `impactPlate_heavy_000..004` for
the docking clunk, and `impactTin_medium_000..004` for cheap hull pings. There are twenty five
footstep files in here you will never use, because noelite is never on foot.

### Digital Audio, 60 files, CC0

https://kenney.nl/assets/digital-audio
Direct zip: https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip

Full listing: `laser1..laser9`, `zap1`, `zap2`, `zapTwoTone`, `zapTwoTone2`,
`zapThreeToneUp`, `zapThreeToneDown`, `phaseJump1..5`, `phaserUp1..7`, `phaserDown1..3`,
`powerUp1..12`, `threeTone1`, `threeTone2`, `twoTone1`, `twoTone2`, `tone1`, `highUp`,
`highDown`, `lowDown`, `lowRandom`, `lowThreeTone`, `pepSound1..5`, `spaceTrash1..5`.

`lowThreeTone` and `threeTone1` are the obvious replacement for the current altimeter beep,
because three tones with different pitches read as information instead of as an alarm clock.

### UI Audio, 50 files, CC0

https://kenney.nl/assets/ui-audio
Direct zip: https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip

Full listing: `click1..5`, `mouseclick1`, `mouserelease1`, `rollover1..6`, `switch1..switch38`.
Thirty-eight switch variations is more than any game needs, which makes it a good source of
non-repeating variation for a HUD that boots element by element.

### Interface Sounds, 100 files, CC0

https://kenney.nl/assets/interface-sounds
Direct zip: https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip

## GitHub mirrors of Kenney

- **Calinou/kenney-interface-sounds**, https://github.com/Calinou/kenney-interface-sounds.
  25 stars, last push 6 December 2020. GitHub's licence detector says NOASSERTION but the
  repo carries Kenney's CC0 LICENSE.txt. Files converted from ogg to wav for Godot, under
  `addons/kenney_interface_sounds/`. Verified names include `back_001..004`, `bong_001`,
  `click_001..005`, `close_001..004`, `confirmation_001..004`, `drop_001..004`,
  `error_001..008`, `glass_001..006`, `glitch_001..003`.
- **Calinou/kenney-ui-audio**, https://github.com/Calinou/kenney-ui-audio. 24 stars, same date,
  same shape.
- **ETdoFresh/kenney.nl**, https://github.com/ETdoFresh/kenney.nl. "A Mirror of Kenney's
  Assets", 3 stars, 280 MB, last push 17 July 2020, **no licence file at the repo root**. It
  works as a CDN for a prototype. I would not build a shipping game on an unlicensed
  third-party mirror when kenney.nl serves the same zips directly.
- **Dead link warning:** the Godot Asset Library entry
  https://godotengine.org/asset-library/asset/1834 ("Kenney's Sci-Fi Sounds 1.0.2") points at
  github.com/Loppansson/kenney-sci-fi-sounds-for-godot, which returns 404. The asset library
  entry is stale.

## lavenderdotpet/CC0-Public-Domain-Sounds

https://github.com/lavenderdotpet/CC0-Public-Domain-Sounds

- Licence: CC0-1.0 at the repo root. 47 stars, 1.19 GB, last push 22 February 2024.

A personal aggregation, and that is both its value and its risk. Verified directories:

- `50-cc0-sci-fi-sfx/`: `loop_ambient_01.ogg`, `loop_ambient_weird.ogg`,
  `loop_machine_01..03.ogg`, `rocket_01.ogg`, `terminal_01..09.ogg`, `retro_beep_01..06.ogg`,
  `retro_laser_01/02.ogg`, `explosion_01/02.ogg`, `teleport_01/02.ogg`
- `30-cc0-sfx-loops/`: `ambient_01..03.ogg`, `machine_01..11.ogg`, `noise_01..03.ogg`,
  `pump_01/02.ogg`, `alarm_01..03.ogg`
- `bb - Fans and Drones (Jul 2021)/`: `Air Vent.wav`, `Computer Fan.wav`, `Furnace Fan.wav`,
  `Large Fan.wav`, `Small Fan.wav`, `Outdoor AC Unit.wav`, `Dehumidifier.wav`,
  `Refridgerator.wav`

That fans-and-drones folder is genuinely the right raw material for a ship interior bed. A
furnace fan through a lowpass is what a lot of sci-fi ship ambience actually is.

Caveat, and take it seriously: this is one person's collection with one CC0 file at the top.
Per-folder provenance is whatever the collector says it is. Fine for prototyping. Before you
ship anything from here in a game you sell, trace each folder back to its original pack.

## OpenGameArt

- **Space Winds**, https://opengameart.org/content/space-winds, by aquinn, CC0,
  `space-wind.mp3`, 778.2 KB. Described as "Space winds, and lonely background noises". This is
  the atmosphere and wind bed if you want one off the shelf.
- **CC0 Background Ambience**, https://opengameart.org/content/cc0-background-ambience, by
  FGResources, CC0. Nature-leaning, less use here.

Standing warning about OGA: the licence is **per submission**, and plenty of it is CC-BY-SA,
which is copyleft and a trap for a commercial game. Read every single page. The site's
auto-generated credits file is a convenience, not a legal shield.

---

# Part 1c. Ambient music

## Anamnesis

https://efilheim.itch.io/anamnesis

"Released into the Public Domain / CC0. Free to access, study, remix and reuse in any kind of
project. Attribution is appreciated, but not required." Ambient, sci-fi, dreamy. Available as
OGG (68 MB) or WAV (284 MB), 44.1 kHz 16-bit. This is the closest free-and-actually-CC0 thing
I found to the pad wash you are describing. Start here.

## Kevin MacLeod / incompetech

https://incompetech.com/music/royalty-free/faq.html

CC-BY 4.0. The FAQ gives the exact required credit:

```
Title  Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0
https://creativecommons.org/licenses/by/4.0/
```

A paid Standard License exists for cases where attribution is impractical, such as broadcast.
For a game you sell, CC-BY is fine as long as the credit survives into the shipped build. The
genre browser is JavaScript-driven so I could not scrape a track list, and I am not going to
name tracks I have not verified.

## ZzFXM (Keith Clark)

https://github.com/keithclark/ZzFXM

- Licence: MIT. Stars: 473. Size: 1,325 KB. Last push: 25 December 2023.
- Browser tracker: https://keithclark.github.io/ZzFXM/tracker/
- CLI converts ProTracker MOD (M.K.) files, with the caveat that "only the volume and pattern
  break effects are 100% supported".

It runs on a modified ZzFX with variable-length patterns and flexible channel counts, and it
renders the whole song to a buffer rather than playing live. You can get a pad out of it: a
ZzFX instrument with a long attack, long release and a low `filter` cutoff, held across many
rows. It will sound like a very good chiptune pad. It will not sound like 65daysofstatic.

## What NMS actually does, and the lesson

Per https://en.wikipedia.org/wiki/Development_of_No_Man%27s_Sky, No Man's Sky uses a generative system called **Pulse**,
built by audio director **Paul Weir**, running over a large library of loops, textures and
melodies written by **65daysofstatic**, reacting to terrain and getting more or less menacing
depending on danger. Weir built a matching generative system for ambience, plus a tool called
VocAlien for procedural creature calls. 65daysofstatic wrote a normal album first, then took
it apart with Weir.

The lesson for noelite is the structure, not the budget. A library of loops plus rules for
combining them beats one long linear track, and the rules can be tiny. Four or five stems that
fade in and out on altitude, speed and proximity to a body will read as adaptive.

## My honest recommendation for the pad

Do not use a tracker for this. For a No Man's Sky style pad wash, in code, with no assets:

- Three to five `OscillatorNode`s, sawtooth, detuned by 4 to 9 cents around a root and a fifth
- Each through its own slow `lowpass` with an `LFO` on cutoff at 0.05 to 0.15 Hz
- The whole thing into a `ConvolverNode` fed a **procedurally generated** impulse response
  (three seconds of decaying noise, `exp(-t * 1.2)`, stereo-decorrelated), which keeps the
  no-assets rule intact
- Master gain on a slow ramp driven by altitude, so the pad opens as you climb

That is maybe 40 lines and it will get you closer to the reference than any MOD player.

---

# Part 1d. Making the ship sound not annoying

The current radar-altimeter beep is the textbook mistake, and the fix is well understood.

**What is wrong with a beeper.** A periodic transient at a fixed pitch that never stops is
about the most fatiguing thing you can put in a game. The ear adapts to steady sound and
refuses to adapt to a repeating onset, so it stays salient forever, and salient-forever
becomes irritating in about ninety seconds. Worse, most naive beeps sit between 2 and 4 kHz,
which is precisely where human hearing is most sensitive.

**The fix is rate coding, not pitch.** Make the interval between beeps proportional to
altitude, so at 200 m it ticks once a second and at 5 m it is a near-continuous rattle. Then
**stop it entirely** above the altitude where the information is useless. A real radar
altimeter is only interesting in the last few hundred metres. Lander works this way. So does
the Apollo LM. The beep becomes a landing instrument instead of a metronome.

**What Elite Dangerous actually is.** Matthew Florianz, Frontier's audio lead, gave the design
talk at Control Conference 2015 (announced at https://www.asoundeffect.com/elite-dangerous-sound-design/ ,
and discussed at https://elitedangerous2016.wordpress.com/2017/11/02/elite-dangerous-sound-in-space-2/ ).
His own project page, https://www.matthewflorianz.com/audio/matthewflorianz_projects_elitedangerous.html , states the principles: a "robust technology" premise, on the reasoning
that a spacefaring ship prioritises reliability over sophistication, built from "analogue gear,
recordings of mechanisms and fm synthesis", drawing on Blade Runner, Alien, 2001 and Space
1999. Radio is used throughout "as a reflection of how the universe can be observed", and it
ties UI, ambience and environment into one voice. And critically, the team chose **not** to use
real silence in space, going with what feels right over what is physically correct.

Two things transfer directly. First, the cockpit sound is a **bed**, not an engine note: layers
of low mechanical texture that sit under everything and never demand attention. Second, sonic
branding: scanning, planet scanning and selling data all share a family resemblance, so the
player learns the game's grammar without being told. noelite could do the same across scan,
scoop and sell.

**What Outer Wilds does.** Andrew Prahlow deliberately kept music **out** of ordinary
exploration so that it lands when it arrives. Per the Game Developer piece, he crafted the
music to "follow the player's sense of exploration" rather than become wallpaper. Location
themes carry identity (the banjo of Timber Hearth against the echoing song of Dark Bramble),
and a lot of what people assume is synth is washed-out guitar through a long pedal chain. The
end-of-loop track ticks like a clock. Silence is the default state and music is an event.

**What NMS does.** Pulse reacts to terrain and to danger. The engine sound is filtered noise
that opens up as you push the throttle, and the atmospheric layer is the thing that actually
sells altitude.

**Rules I would hold noelite to:**

1. Ship hum under -22 dBFS. If you ever need to turn other things up to hear over it, it is
   too loud.
2. Two crossfaded layers, never one buffer stretched across the whole throttle range.
3. Ramp every parameter with `setTargetAtTime` and a 0.1 to 0.2 s time constant.
4. Give the hum slow low-frequency movement so it never sits perfectly still.
5. Duck the hum 4 to 6 dB for about 300 ms whenever anything else plays. One gain node, one
   ramp, done.
6. Gate the wind layer on air pressure, which you already compute. In vacuum it vanishes and
   the mix opens up, and that contrast is the free drama of leaving atmosphere.
7. Nothing repeats at a fixed interval unless the interval itself carries information.

---

# Part 2. The epic opening

## What the reference openings actually do

### No Man's Sky, "Awakenings"

Beat order, per https://www.nomansskyresources.com/story-missions/awakenings :

1. Wake on an unknown planet. Hazard protection and life support are already draining.
2. Gather ferrite dust, repair the multi-tool scanner.
3. Scan for sodium, recharge hazard protection.
4. Scanner locates the starship. The wreck is visible on the horizon.
5. Reach the crash site, interact with the distress beacon, board and claim the ship.
6. Repair the pulse engine: metal plating from 50 ferrite dust, then a hermetic seal found via
   a planetary chart.
7. Repair the analysis visor: carbon nanotubes from 50 carbon.
8. Finish the pulse engine.
9. Repair the launch thruster: build a portable refiner, refine the material.
10. Launch. Then "Test Thrust", "Test Boost", "Test Pulse Engine" in orbit.
11. Track the mysterious signal, terrain manipulator, copper, base computer.
12. Warp cell, first hyperdrive jump.

What works: you wake with no explanation and a draining meter, so there is pressure from the
first frame, and the goal is a physical object visible on the skyline rather than a waypoint in
a menu. What does not work: it is well over an hour of crafting checklist. The bit everybody
actually remembers is roughly twenty seconds long, the first launch, when the ground drops
away, the sky thins from blue to black and the music comes up. Everything before it is
homework you tolerate to get to the twenty seconds.

**Steal the twenty seconds. Do not steal the hour.**

### Outer Wilds

Beat order, per outerwilds.fandom.com and https://en.wikipedia.org/wiki/Outer_Wilds :

1. Wake at a campfire on Timber Hearth, marshmallow on a stick.
2. Slate is next to you, roasting marshmallows by the launch tower.
3. Wander the village. Nothing is urgent.
4. Enter the observatory. The ground floor is a museum curated by Hornfels, and the exhibits
   are the last of the tutorial, delivered as things you choose to touch.
5. Hornfels, upstairs, asks if you are ready and gives you the launch codes. They spell MDN in
   morse.
6. The Nomai statue's eyes open. Cutscene, flashes of the last twenty minutes.
7. Walk back down the hill, punch the codes into the lift, ride up to the ship.
8. Launch.
9. The sun goes supernova at 22 minutes regardless.

What works: there is not a single tutorial pop-up. Every piece of instruction is an object in
the world you decided to look at. The pace is deliberately slow, and the slowness is load
bearing, because the loop is 22 minutes and the game needs you to have a body-feel for how long
that is. The statue turning is the only scripted shock in the whole opening, and it lands
precisely because everything before it was mundane.

**Steal the diegetic tutorial and the willingness to be slow.**

### Elite Dangerous, first undock

Docking is a two-stage contract: request permission within 7.5 km, receive a pad number and a
ten minute timer. Undocking runs it in reverse and nobody helps you. The pad lift raises the
ship, the lights change, and you have to hold station inside a **rotating** frame while you
thread the mailslot. New pilots routinely plough into the wall.

What works: the first undock is a small, legible skill test with a visible clock on it. The
rotation forces you to solve orientation before you can solve translation, which is a good
teaching order. That is the same lesson the 1984 game taught.

### Elite (1984)

You start docked at Lave Station with 100 credits and a Cobra Mk III. Press f0. You are
outside. That is the entire opening. No cutscene, no character, no tutorial, no name.

The design is ruthless: the Coriolis rotates, so within four seconds of the game starting it
has shown you the exact problem you will spend the next hour failing at. Nothing is explained
and nothing needs to be.

And the music: only some ports have any. The Amiga, Atari ST, C64 and NES versions play The
Blue Danube during docking (Wally Beben arranged the Amiga and ST, David Whittaker the NES).
The BBC Micro original is effectively silent. A game with almost no music put the one piece it
had on the single most tense manoeuvre in it, and forty years later that is still the most
quoted thing about it.

**Sound in exactly the right place beats sound everywhere.** Write that on the wall.

### Kerbal Space Program, first launch

Build in the VAB, roll to the pad, hit space. The in-game tutorials walk through every step of
the first two rockets, and the classic first hard lesson is staging, where decoupling too
eagerly ends the flight on the pad. The standing criticism is that the tutorial teaches the how
and cannot teach the why, so new players end up wandering the sandbox with no goal.

Caveat on sourcing: wiki.kerbalspaceprogram.com is behind Anubis anti-bot protection and
returned an access-denied page, so this section rests on secondary coverage rather than a
first-party page I could read.

The useful lesson here is negative. A first launch that **can** fail teaches far more than one
that cannot, but only when the failure is legible and the retry is instant. KSP gets the
failure right and the retry loop wrong.

## Three candidate openings for noelite

Working only with what exists: a pad, a station 38 km out, a moon, a ring of rocks at 620 km,
a 2400 s day with dawn at t=103 s, hover then cruise then the TIE wing-morph on leaving air, a
fuel tank, a beacon.

### Candidate A: "Dawn Shift"

Cold open on the pad, in the dark, 103 seconds before sunrise.

**Beats**

| t | What happens |
|---|---|
| 0:00 | Black. One sound: a slow tick at about 0.8 Hz, which is the ship's own standby power. Fade up to the cockpit view. Ship cold. **No HUD at all.** Stars, the moon, and the ring as a thin bright line across the sky. |
| 0:00 to 0:20 | Nothing to do. The camera drifts a degree or two on its own. One line, small, bottom left: `PAD 01 . LOCAL 0403 . SUNRISE 0143`. That is the only text in the sequence. |
| 0:20 | Player presses anything. Reactor spin-up: filtered noise rising over four seconds with the lowpass sweeping 120 Hz to 700 Hz, a 70 Hz body thump underneath. The HUD boots **element by element in the order the ship powers them**: attitude, then altitude, then fuel, then the beacon marker. Six seconds, staggered, each with its own switch click. |
| 0:26 to 1:00 | Hover only. Gravity on, throttle live, wings locked. The player finds the tilt-to-move body by drifting a metre off the pad and back. No objective text. If they idle twenty seconds, one line appears: `HOLD 20 M`. |
| 1:00 to 1:43 | Free flight under 500 m. The terminator sweeps across the terrain as dawn hits at t=103 s. The pad music, one held drone note until now, adds a fifth and a slow rising pad as the sun clears the horizon. |
| 1:43 | The station beacon lights on the HUD for the first time. One line: `STATION . 38 KM`. |

**Sound and music.** Standby tick (ZzFX one-shot, very quiet). Reactor spin-up (procedural
sweep). Hover hum (looped brown noise plus lowpass, gain and cutoff on throttle). Wind bed
gated by air pressure. One low sustained pad note that gains a fifth and an octave at dawn.
**No beeps at all until the HUD boots**, and the altimeter beep only exists below 200 m.

**HUD.** Everything hidden at 0:00. Boots in four staggered stages. The beacon marker is
withheld until 1:43, so its arrival is an event.

**Told versus shown.** Told almost nothing. `SUNRISE 0143` is a fact, not an order, and it does
the work of an objective without being one.

**Runs:** about two minutes to the beacon. Then the player leaves whenever they want.

### Candidate B: "The Long Fall"

Start 40 km up, engine dead, falling.

**Beats**

| t | What happens |
|---|---|
| 0:00 | The ship tumbles slowly at 40 km. Silence except a thin electrostatic hiss. The tumble shows the planet as a full ball, then the moon, then the ring. HUD shows one thing: `ALT` and a number going down. |
| 0:00 to 0:08 | No control. This is the establishing shot and it costs you nothing to build, because it is the flight model with the input disconnected. |
| 0:08 | Control returns with a hard clunk and the reactor kick. You are now falling at 300 m/s with 2 km of air below you. |
| 0:08 to 0:50 | Re-entry. Air pressure climbs, the wind layer opens, the hull glow starts, the wings morph in as the air thickens. You have to arrest a fall you did not start. The hum builds under the wind. |
| 0:50 to 1:20 | Terminal approach. The pad beacon strobes. Land or crash. |
| 1:20 | Down. Everything ducks 5 dB and releases over two seconds, leaving only the atmosphere bed. Fuel reads low. `STATION . 38 KM` appears. |

**Sound and music.** The silence-to-roar ramp is the whole trick, and it comes free from
`q = 0.5 * rho * v * v`. One sub-bass swell under peak heating. Music enters only on touchdown,
which makes landing feel like an arrival rather than a survival.

**HUD.** Altitude only for the first eight seconds. Attitude and velocity vector appear when
control returns. Fuel and beacon appear only after landing.

**Told versus shown.** Told nothing at all. Shown the entire solar system in eight seconds, and
taught landing by making it the price of continuing. Crash restarts instantly at 0:00.

**Runs:** 80 to 100 seconds.

### Candidate C: "Cold Start at the Rocks"

Start 620 km out, adrift in the ring, out of fuel.

**Beats**

| t | What happens |
|---|---|
| 0:00 | Drifting among the rocks. They tumble past close enough to read the facets. Ship dead. HUD dead except one red line: `FUEL 000`. |
| 0:00 to 0:15 | Nothing works except the view. The planet is a small blue disc. The station beacon is a dot beside it. |
| 0:15 | Emergency power. Guns work, engines do not. |
| 0:15 to 1:30 | You learn to shoot and scoop because you have no alternative. Every hit is a rock crunch, every scoop a rising three-tone, and the fuel number climbs. |
| 1:30 | Enough fuel to burn. Engines light. The cruise ramp opens and the planet grows for a full minute. |
| 2:30 | Atmosphere. Wings morph in. Wind starts. Land at the pad, or dock at the station. |

**Sound and music.** Vacuum for the first 90 seconds means almost nothing but hull creak and
the gun. Then the engine, then the cruise drone, then wind. Music is a single low pad that
gains a layer per fuel milestone.

**Told versus shown.** One number. Everything else is inferred.

**Runs:** three to four minutes.

## Which I would build, and why

**Candidate A, "Dawn Shift"**, with the last twenty seconds of B stapled on as the payoff of
the first cruise out to the station.

The reasons, in order of how much they matter:

**It costs almost nothing.** Every ingredient already exists. The 2400 s day clock, the pad,
the hover model, the beacon, the station at 38 km. The only new work is a staggered HUD boot
and one music cue on the terminator crossing. That is a day or two, not a fortnight.

**It uses the one thing noelite has that nothing else does.** A 40 minute day with a known
dawn at t=103 s. Elite has no day. NMS has a day you never watch. Making the player's first two
minutes a wait for sunrise turns a config number into an event, and the terminator sweeping
across flat-shaded facets is going to be the best-looking thing in the build.

**103 seconds is exactly the right length.** Long enough that the player fills it themselves,
which is what makes an opening feel like exploration rather than a corridor. Short enough that
nobody puts the controller down. Outer Wilds spends far longer on its opening and gets away
with it because it has a village full of characters. noelite has a pad and a sky, so two
minutes is the honest ceiling.

**B is a better cinematic and a worse first minute.** It front-loads the hardest skill in the
game onto a player who has not yet learned that the ship has no brakes. It also needs a
re-entry that survives being the very first thing anyone touches, plus a crash-restart flow.
Build it as mission two, or as the payoff at the end of A.

**C gives the whole game away.** Shooting, scooping, fuel economy and the cruise ramp all in
the first four minutes, all needing to be tuned against each other before the opening works at
all. And if the player has done the entire loop before minute five, the second hour has nothing
left to reveal. Scarcity is the design, per DESIGN.md, and that has to include scarcity of
revelation.

The one thing all three share, and the thing I would hold to whichever you pick: **the HUD
starts empty and earns its way on**. That single decision does more for the feeling of an epic
start than any amount of music.

---

# What I'd actually take

Five, ranked.

**1. ZzFX.** https://github.com/KilledByAPixel/ZzFX . MIT, 1,222 bytes for the micro build,
last commit 3 September 2026, so it is alive. Twenty-one parameters, documented preset ranges
for shoot / explosion / hit / blip, and the full build has both a `loop` flag on
`playSamples()` and an exposed `gainNode` on the returned source, which is exactly what a
throttle needs. It obeys noelite's no-assets rule by construction. This is the foundation for
every transient in the game and it costs you a kilobyte.

**2. Kenney Sci-fi Sounds.** https://kenney.nl/assets/sci-fi-sounds . CC0, no attribution
required, 70 ogg files. I measured them: `spaceEngineLarge_000.ogg` runs -5.25 / -5.10 / -4.97
dB head to tail and `spaceEngineLow_000.ogg` runs -7.35 / -8.11 / -7.64, so both crossfade into
real loops, while `thrusterFire_*` and `engineCircular_*` are ramps and will not. Even if you
never ship one byte of it, you cannot tune a synthesised thruster without something to A/B
against, and this is the best-licensed reference on the internet. Pair it with Impact Sounds
for `impactMining_000..004`, which is your asteroid-shooting sound already made.

**3. Antonio-R1/engine-sound-generator.** https://github.com/Antonio-R1/engine-sound-generator .
MIT, stale since November 2022, and the only working example I found of a continuous
throttle-driven engine in the browser done properly. Take the architecture (one AudioWorklet,
one `rpm` AudioParam written every frame, synthesis off the render thread), throw away the
four-stroke waveguide model, and you have the right skeleton for the ship hum in an afternoon.

**4. zacharydenton/noise.js.** https://github.com/zacharydenton/noise.js . MIT, 54 KB, dead
since 2017, and worth exactly eight lines: the Voss-McCartney pink noise coefficients. Do not
ship the file, it uses the deprecated `ScriptProcessorNode`. Copy the coefficients into a
one-off buffer fill. Pink and brown noise through a throttled lowpass is 80% of a spaceship.

**5. Anamnesis by efilheim.** https://efilheim.itch.io/anamnesis . Explicitly public domain /
CC0, ambient sci-fi, ogg and wav at 44.1 kHz 16-bit. The only genuinely free pad wash I could
verify that actually sounds like the reference. Use it as a placeholder while you build the
procedural pad, and keep it as the fallback if the procedural version never gets there.

**Runners-up worth a look:** m1ckc3s/procedural-sounds (MIT, live-generated UI sounds from
recipes, no audio files, which is philosophically identical to what noelite is doing with
geometry) and Kenney's Digital Audio pack, whose `lowThreeTone` and `threeTone1` are the
obvious replacement for the current altimeter beep.

**Verified dead, do not chase:** github.com/Loppansson/kenney-sci-fi-sounds-for-godot (404,
still linked from the Godot Asset Library) and github.com/xem/GameAudioBundleMP3 (404, still
linked from the js13kGames resources list).
