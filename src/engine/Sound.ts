// The ship's voice. Everything here is synthesised from Web Audio nodes, no files,
// the same rule as the shapes. Chris, 2026-09-03: "the noise of the ship is annoying."
// What was annoying was a square-wave altimeter blip that never stopped; the answer is
// a low engine hum that follows the throttle, wind that follows the air, short quiet
// one-shots for the gun and for rocks, and a beeper that only speaks on the way down.
// Browsers need a gesture before audio: arm() runs on the first keydown; M mutes.
import type { Craft, Controls } from './Craft.ts'

/** Brown noise: white noise integrated with leak, so it is all low end. Two seconds, looped. */
function brownNoise(ctx: AudioContext): AudioBuffer {
  const n = ctx.sampleRate * 2
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    d[i] = last * 3.5
  }
  return buf
}

/** Pink noise, Voss-McCartney with the classic coefficients (after zacharydenton/noise.js, MIT). Two seconds, looped. */
function pinkNoise(ctx: AudioContext): AudioBuffer {
  const n = ctx.sampleRate * 2
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.96900 * b2 + w * 0.1538520
    b3 = 0.86650 * b3 + w * 0.3104856
    b4 = 0.55000 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.0168980
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
    b6 = w * 0.115926
  }
  return buf
}

export class Sound {
  muted = false
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private hoverGain: GainNode | null = null
  private hoverFilter: BiquadFilterNode | null = null
  private sub: OscillatorNode | null = null
  private subGain: GainNode | null = null
  private cruiseA: OscillatorNode | null = null
  private cruiseB: OscillatorNode | null = null
  private cruiseGain: GainNode | null = null
  private windGain: GainNode | null = null
  private windFilter: BiquadFilterNode | null = null
  private rcsGain: GainNode | null = null
  private rainGain: GainNode | null = null
  private servoGain: GainNode | null = null
  private digOsc: OscillatorNode | null = null
  private buzzOsc: OscillatorNode | null = null
  private buzzGain: GainNode | null = null
  private digGain: GainNode | null = null
  private digGrit: GainNode | null = null
  private muffle: BiquadFilterNode | null = null
  private pinkGain: GainNode | null = null
  private padGain: GainNode | null = null
  private padFilter: BiquadFilterNode | null = null
  private padVoices: { osc: OscillatorNode; gain: GainNode; ratio: number }[] = []
  private padLevel = 0
  /** Standby: the ship asleep on the pad, one quiet tick a second and a quarter. */
  standby = false
  private nextTick = 0
  private nextBlip = 0
  private wasLanded = true
  private lastGear = 1
  private lastMorph = 0

  arm(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return }
    const ctx = (this.ctx = new AudioContext())
    const master = (this.master = ctx.createGain())
    master.gain.value = 0.8
    // Everything goes through one lowpass: wide open in air, closed down in vacuum, where
    // what you hear is what the hull carries to the cockpit.
    const muffle = (this.muffle = ctx.createBiquadFilter())
    muffle.type = 'lowpass'; muffle.frequency.value = 18000; muffle.Q.value = 0.5
    master.connect(muffle).connect(ctx.destination)
    const noise = brownNoise(ctx)
    const src = (kind: 'hover' | 'wind' | 'rcs') => {
      const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true
      const f = ctx.createBiquadFilter(); f.type = kind === 'wind' ? 'bandpass' : 'lowpass'
      const g = ctx.createGain(); g.gain.value = 0
      s.connect(f).connect(g).connect(master); s.start()
      return { f, g }
    }
    // Hover engine: brown noise through a lowpass that opens with the throttle, a pink layer
    // for the mid-band grain (the research report: pink and brown through a throttled
    // lowpass is most of a spaceship), and a sub tone that rises with it.
    { const { f, g } = src('hover'); this.hoverFilter = f; this.hoverGain = g; f.frequency.value = 180; f.Q.value = 0.7 }
    {
      const s = ctx.createBufferSource(); s.buffer = pinkNoise(ctx); s.loop = true
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 520; f.Q.value = 0.6
      const g = (this.pinkGain = ctx.createGain()); g.gain.value = 0
      s.connect(f).connect(g).connect(master); s.start()
    }
    // The pad: six detuned voices through a slow lowpass. Level 0 silent, 1 a drone, 2 adds
    // the fifth, 3 the octave and an opening filter. The music of Dawn Shift.
    this.padFilter = ctx.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 240; this.padFilter.Q.value = 0.4
    this.padGain = ctx.createGain(); this.padGain.gain.value = 0
    this.padFilter.connect(this.padGain).connect(master)
    for (const [ratio, type, detune] of [[1, 'sawtooth', -6], [1, 'triangle', 5], [1.5, 'sawtooth', 4], [1.5, 'triangle', -7], [2, 'triangle', 3], [2, 'sine', 0]] as [number, OscillatorType, number][]) {
      const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = 55 * ratio; osc.detune.value = detune
      const gain = ctx.createGain(); gain.gain.value = 0
      osc.connect(gain).connect(this.padFilter); osc.start()
      this.padVoices.push({ osc, gain, ratio })
    }
    if (this.padLevel > 0) this.pad(this.padLevel)
    this.sub = ctx.createOscillator(); this.sub.type = 'sine'; this.sub.frequency.value = 50
    this.subGain = ctx.createGain(); this.subGain.gain.value = 0
    this.sub.connect(this.subGain).connect(master); this.sub.start()
    // Cruise drive: two detuned tones, a smoother voice for space.
    this.cruiseA = ctx.createOscillator(); this.cruiseA.type = 'triangle'; this.cruiseA.frequency.value = 82
    this.cruiseB = ctx.createOscillator(); this.cruiseB.type = 'sine'; this.cruiseB.frequency.value = 123.5
    this.cruiseGain = ctx.createGain(); this.cruiseGain.gain.value = 0
    this.cruiseA.connect(this.cruiseGain); this.cruiseB.connect(this.cruiseGain); this.cruiseGain.connect(master)
    this.cruiseA.start(); this.cruiseB.start()
    // Wind: bandpassed noise, louder and higher with airspeed in air.
    { const { f, g } = src('wind'); this.windFilter = f; this.windGain = g; f.frequency.value = 400; f.Q.value = 0.5 }
    // RCS: a hiss while a thruster is held.
    { const { f, g } = src('rcs'); this.rcsGain = g; f.frequency.value = 2400; f.Q.value = 0.3 }
    // Rain on the hull: high, hissy, only under the clouds.
    { const { f, g } = src('wind'); this.rainGain = g; f.frequency.value = 3200; f.Q.value = 0.4 }
    // Servos: the gear and the wing morph, a filtered whir while they move.
    { const { f, g } = src('hover'); this.servoGain = g; f.frequency.value = 900; f.Q.value = 2.5 }
    // The auger: a low sawtooth through a lowpass, rising as the pod fills, and grit from the noise.
    this.digOsc = ctx.createOscillator(); this.digOsc.type = 'sawtooth'; this.digOsc.frequency.value = 58
    const digF = ctx.createBiquadFilter(); digF.type = 'lowpass'; digF.frequency.value = 420; digF.Q.value = 1.2
    this.digGain = ctx.createGain(); this.digGain.gain.value = 0
    this.digOsc.connect(digF).connect(this.digGain).connect(master); this.digOsc.start()
    { const { f, g } = src('hover'); this.digGrit = g; f.frequency.value = 1300; f.Q.value = 1.6 }
    // The stall buzz: a low square wave that comes up as the wings lose their grip.
    this.buzzOsc = ctx.createOscillator(); this.buzzOsc.type = 'square'; this.buzzOsc.frequency.value = 70
    const buzzF = ctx.createBiquadFilter(); buzzF.type = 'lowpass'; buzzF.frequency.value = 600
    this.buzzGain = ctx.createGain(); this.buzzGain.gain.value = 0
    this.buzzOsc.connect(buzzF).connect(this.buzzGain).connect(master); this.buzzOsc.start()
  }

  /** The auger, every frame: `level` 0 off to 1 drilling, `p` the dig's progress for the pitch. */
  dig(level: number, p: number): void {
    if (!this.ctx || !this.digGain || !this.digGrit || !this.digOsc) return
    const t = this.ctx.currentTime, on = this.muted ? 0 : level
    this.digGain.gain.setTargetAtTime(0.09 * on, t, 0.08)
    this.digGrit.gain.setTargetAtTime(0.05 * on, t, 0.08)
    this.digOsc.frequency.setTargetAtTime(58 + 44 * p, t, 0.1)
  }

  /** Every frame. `rho` is the air at the craft, 0 in vacuum; `zoom` the chase camera's distance factor (1 default); `rain` 0..1; `gear` 1 down; `morph` 0 dart, 1 TIE. */
  update(now: number, craft: Craft, c: Controls, rho: number, zoom = 1, rain = 0, gear = 1, morph = 0): void {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const on = !this.muted && craft.state === 'flying'
    const ramp = (p: AudioParam, v: number, tau = 0.12) => p.setTargetAtTime(v, t, tau)
    // The camera is the ear: pull back and the ship gets quieter. Chris, 2026-09-03.
    ramp(this.master.gain, this.muted ? 0 : 0.8 / Math.pow(Math.max(0.4, zoom), 0.9), 0.15)
    // Vacuum closes the filter: the cockpit hears the hull, not the air.
    ramp(this.muffle!.frequency, 700 + 17300 * Math.min(1, rho * 4), 0.4)
    // Rain patter, when under it and in air (landed counts: it rains on a parked ship too).
    ramp(this.rainGain!.gain, !this.muted && craft.state !== 'crashed' ? 0.12 * rain * Math.min(1, rho * 2) : 0, 0.3)
    // Servos: whir while the gear or the wings move; a clunk when the gear seats.
    const moving = Math.abs(gear - this.lastGear) > 0.002 || Math.abs(morph - this.lastMorph) > 0.002
    ramp(this.servoGain!.gain, !this.muted && moving ? 0.05 : 0, 0.05)
    if (!this.muted && ((this.lastGear < 0.97 && gear >= 0.97) || (this.lastGear > 0.06 && gear <= 0.06))) this.clunk()
    this.lastGear = gear; this.lastMorph = morph
    const throttle = on ? c.thrust * (1 + 0.6 * c.boost) : 0
    // No air, no sound outside: as you climb, the engine drops toward what the hull alone
    // carries into the cockpit, about half, and the filter above takes its top end.
    // Chris, 2026-09-03: "once you get into space there would be no sound right?"
    const airK = 0.45 + 0.55 * Math.min(1, rho * 3)
    // Hover engine only while hovering; cruise drive only in cruise. Both idle quietly when flying.
    const hover = on && !craft.cruise && !craft.jet, cruise = on && (craft.cruise || craft.jet)
    ramp(this.hoverGain!.gain, hover ? (0.05 + 0.32 * throttle) * airK : 0)
    ramp(this.pinkGain!.gain, hover ? (0.02 + 0.16 * throttle) * airK : cruise ? 0.03 * throttle * airK : 0)
    // Standby tick.
    if (this.standby && !this.muted && now >= this.nextTick) { this.nextTick = now + 1.25; this.blip(1800, 0.012, 0.02) }
    ramp(this.hoverFilter!.frequency, 180 + 700 * throttle, 0.2)
    ramp(this.subGain!.gain, hover ? (0.05 + 0.14 * throttle) * airK : 0)
    ramp(this.sub!.frequency, 48 + 26 * throttle, 0.3)
    ramp(this.cruiseGain!.gain, cruise ? (0.03 + 0.09 * throttle) * airK : 0, 0.25)
    ramp(this.cruiseA!.frequency, 82 + 30 * throttle, 0.4)
    ramp(this.cruiseB!.frequency, 123.5 + 45 * throttle, 0.4)
    // Wind: airspeed through air, in a slow band. Nothing in vacuum.
    // In the jet the wind is the voice: it saturates at 450 m/s instead of 120 and is louder and higher.
    const air = on ? Math.min(1, (craft.speed() / (craft.jet ? 450 : 120)) * Math.sqrt(rho)) : 0
    ramp(this.windGain!.gain, (craft.jet ? 0.45 : 0.25) * air * air, 0.2)
    ramp(this.windFilter!.frequency, 300 + (craft.jet ? 1500 : 900) * air, 0.3)
    // The stall buzz, jet only: from a whisper at 90% of the lift needed to a rattle with none.
    const stall = on && craft.jet ? Math.min(1, Math.max(0, (0.9 - craft.liftRatio) / 0.9)) : 0
    ramp(this.buzzGain!.gain, 0.07 * stall, 0.1)
    ramp(this.buzzOsc!.frequency, 60 + 40 * stall, 0.1)
    // RCS hiss.
    const rcs = on && (c.lateral !== 0 || c.fore !== 0 || (c.vertical !== 0 && !craft.cruise && !craft.jet)) ? 0.06 * airK : 0
    ramp(this.rcsGain!.gain, rcs, 0.03)
    // The altimeter: a soft sine blip, only descending, under 60 m, quickening as the ground comes up.
    const descending = on && craft.vUp() < -1 && !craft.cruise && !craft.jet
    if (descending && craft.altitude() < 60 && now >= this.nextBlip) {
      const alt = craft.altitude()
      this.nextBlip = now + Math.min(1.5, Math.max(0.15, alt / 30))
      this.blip(alt < 12 ? 990 : 740, 0.03, 0.05)
    }
    // Touchdown: a soft thud once.
    const landed = craft.state === 'landed'
    if (landed && !this.wasLanded && !this.muted) this.thud()
    this.wasLanded = landed || craft.state === 'crashed'
  }

  /** The pad's level: 0 silent, 1 drone, 2 drone and fifth, 3 the octave too with the filter opening. Slow ramps. */
  pad(level: number): void {
    this.padLevel = level
    if (!this.ctx || !this.padGain || !this.padFilter) return
    const t = this.ctx.currentTime
    this.padGain.gain.setTargetAtTime(level > 0 ? 0.11 : 0, t, level > 0 ? 3 : 6)
    for (const v of this.padVoices) {
      const on = level >= (v.ratio === 1 ? 1 : v.ratio === 1.5 ? 2 : 3)
      v.gain.gain.setTargetAtTime(on ? (v.ratio === 1 ? 0.5 : 0.35) : 0, t, on ? 4 : 5)
    }
    this.padFilter.frequency.setTargetAtTime(level >= 3 ? 1400 : level >= 2 ? 520 : 240, t, 8)
  }

  /**
   * The arrival notes: four rising notes, D A D F#, each two detuned voices with an octave
   * under, a slow attack and a long tail, a filter opening as they stack into the chord.
   * Chris, 2026-09-04: "an epic set of notes at the start", the No Man's Sky sting.
   */
  fanfare(): void {
    if (!this.ctx || !this.master || this.muted) return
    const t0 = this.ctx.currentTime
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 0.7
    f.frequency.setValueAtTime(500, t0); f.frequency.linearRampToValueAtTime(2600, t0 + 6)
    const bus = this.ctx.createGain(); bus.gain.value = 0.9
    f.connect(bus).connect(this.master)
    const notes: [number, number][] = [[146.83, 0], [220, 1.6], [293.66, 3.2], [369.99, 4.8]]
    for (const [hz, at] of notes) {
      const t = t0 + at, end = t + 8
      for (const [ratio, type, level, detune] of [[1, 'triangle', 0.16, 4], [1, 'sine', 0.12, -4], [0.5, 'sine', 0.1, 0]] as [number, OscillatorType, number, number][]) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain()
        o.type = type; o.frequency.value = hz * ratio; o.detune.value = detune
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + 1.3); g.gain.setTargetAtTime(0.0001, t + 3.5, 1.6)
        o.connect(g).connect(f); o.start(t); o.stop(end)
      }
    }
  }

  /** Reactor spin-up: four seconds of noise sweeping up under a body thump. Dawn Shift's first sound. */
  reactor(): void {
    if (!this.ctx || !this.master || this.muted) return
    const t = this.ctx.currentTime
    const s = this.ctx.createBufferSource(); s.buffer = brownNoise(this.ctx); s.loop = true
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.2
    f.frequency.setValueAtTime(120, t); f.frequency.exponentialRampToValueAtTime(700, t + 4)
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 3.2); g.gain.exponentialRampToValueAtTime(0.001, t + 5.5)
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + 5.6)
    const o = this.ctx.createOscillator(), og = this.ctx.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(40, t); o.frequency.exponentialRampToValueAtTime(70, t + 4)
    og.gain.setValueAtTime(0.001, t); og.gain.exponentialRampToValueAtTime(0.2, t + 3); og.gain.exponentialRampToValueAtTime(0.001, t + 5.5)
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 5.6)
  }

  /** A switch click, for each HUD element as it boots. */
  click(): void {
    if (!this.ctx || !this.master || this.muted) return
    const t = this.ctx.currentTime
    const o = this.ctx.createOscillator(), g = this.ctx.createGain()
    o.type = 'square'; o.frequency.value = 2400
    g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03)
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.035)
    const s = this.ctx.createBufferSource(); s.buffer = brownNoise(this.ctx)
    const sg = this.ctx.createGain(); sg.gain.setValueAtTime(0.08, t); sg.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
    s.connect(sg).connect(this.master); s.start(t); s.stop(t + 0.06)
  }

  private blip(freq: number, gain: number, len: number): void {
    if (!this.ctx || !this.master) return
    const o = this.ctx.createOscillator(), g = this.ctx.createGain()
    o.type = 'sine'; o.frequency.value = freq
    const t = this.ctx.currentTime
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0005, t + len)
    o.connect(g).connect(this.master)
    o.start(t); o.stop(t + len + 0.02)
  }

  /** The gear seating, or unseating. */
  private clunk(): void {
    if (!this.ctx || !this.master) return
    const o = this.ctx.createOscillator(), g = this.ctx.createGain()
    o.type = 'triangle'
    const t = this.ctx.currentTime
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.08)
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
    o.connect(g).connect(this.master)
    o.start(t); o.stop(t + 0.12)
  }

  /** Fuel arriving from a broken ice rock: a rising two-note chime. */
  chime(): void {
    if (!this.ctx || !this.master || this.muted) return
    const t = this.ctx.currentTime
    for (const [f, at] of [[660, 0], [990, 0.11]] as [number, number][]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain()
      o.type = 'sine'; o.frequency.value = f
      g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(0.06, t + at + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.35)
      o.connect(g).connect(this.master)
      o.start(t + at); o.stop(t + at + 0.4)
    }
  }

  private thud(): void {
    if (!this.ctx || !this.master) return
    const o = this.ctx.createOscillator(), g = this.ctx.createGain()
    o.type = 'sine'
    const t = this.ctx.currentTime
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.25)
    g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
    o.connect(g).connect(this.master)
    o.start(t); o.stop(t + 0.32)
  }

  /** The gun: a short falling zap. */
  shot(): void {
    if (!this.ctx || !this.master || this.muted) return
    const o = this.ctx.createOscillator(), g = this.ctx.createGain()
    o.type = 'sawtooth'
    const t = this.ctx.currentTime
    o.frequency.setValueAtTime(1400, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.14)
    g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16)
    o.connect(g).connect(this.master)
    o.start(t); o.stop(t + 0.18)
  }

  /** A strike on a rock, and a bigger, lower crunch when it breaks. */
  /** The sonic boom: a hard low thump with a crack on top. */
  boom(): void {
    if (!this.ctx || !this.master || this.muted) return
    const t = this.ctx.currentTime
    const s = this.ctx.createBufferSource(); s.buffer = brownNoise(this.ctx)
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'
    const g = this.ctx.createGain()
    f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(60, t + 0.5)
    g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6)
    s.connect(f).connect(g).connect(this.master); s.start(t); s.stop(t + 0.7)
    const o = this.ctx.createOscillator(), og = this.ctx.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.4)
    og.gain.setValueAtTime(0.4, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.45)
    o.connect(og).connect(this.master); o.start(t); o.stop(t + 0.5)
  }

  hit(broke: boolean): void {
    if (!this.ctx || !this.master || this.muted) return
    const s = this.ctx.createBufferSource(); s.buffer = brownNoise(this.ctx)
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'
    const g = this.ctx.createGain()
    const t = this.ctx.currentTime
    const len = broke ? 0.7 : 0.12
    f.frequency.setValueAtTime(broke ? 900 : 2200, t); f.frequency.exponentialRampToValueAtTime(80, t + len)
    g.gain.setValueAtTime(broke ? 0.5 : 0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + len)
    s.connect(f).connect(g).connect(this.master)
    s.start(t); s.stop(t + len + 0.05)
  }
}
