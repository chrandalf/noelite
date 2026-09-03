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
  private nextBlip = 0
  private wasLanded = true

  arm(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return }
    const ctx = (this.ctx = new AudioContext())
    const master = (this.master = ctx.createGain())
    master.gain.value = 0.8
    master.connect(ctx.destination)
    const noise = brownNoise(ctx)
    const src = (kind: 'hover' | 'wind' | 'rcs') => {
      const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true
      const f = ctx.createBiquadFilter(); f.type = kind === 'wind' ? 'bandpass' : 'lowpass'
      const g = ctx.createGain(); g.gain.value = 0
      s.connect(f).connect(g).connect(master); s.start()
      return { f, g }
    }
    // Hover engine: brown noise through a lowpass that opens with the throttle, and a sub tone that rises with it.
    { const { f, g } = src('hover'); this.hoverFilter = f; this.hoverGain = g; f.frequency.value = 180; f.Q.value = 0.7 }
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
  }

  /** Every frame. `rho` is the air at the craft, 0 in vacuum. */
  update(now: number, craft: Craft, c: Controls, rho: number): void {
    if (!this.ctx || !this.master) return
    const t = this.ctx.currentTime
    const on = !this.muted && craft.state === 'flying'
    const ramp = (p: AudioParam, v: number, tau = 0.12) => p.setTargetAtTime(v, t, tau)
    const throttle = on ? c.thrust * (1 + 0.6 * c.boost) : 0
    // Hover engine only while hovering; cruise drive only in cruise. Both idle quietly when flying.
    const hover = on && !craft.cruise, cruise = on && craft.cruise
    ramp(this.hoverGain!.gain, hover ? 0.05 + 0.32 * throttle : 0)
    ramp(this.hoverFilter!.frequency, 180 + 700 * throttle, 0.2)
    ramp(this.subGain!.gain, hover ? 0.05 + 0.14 * throttle : 0)
    ramp(this.sub!.frequency, 48 + 26 * throttle, 0.3)
    ramp(this.cruiseGain!.gain, cruise ? 0.03 + 0.09 * throttle : 0, 0.25)
    ramp(this.cruiseA!.frequency, 82 + 30 * throttle, 0.4)
    ramp(this.cruiseB!.frequency, 123.5 + 45 * throttle, 0.4)
    // Wind: airspeed through air, in a slow band. Nothing in vacuum.
    const air = on ? Math.min(1, (craft.speed() / 120) * Math.sqrt(rho)) : 0
    ramp(this.windGain!.gain, 0.25 * air * air, 0.2)
    ramp(this.windFilter!.frequency, 300 + 900 * air, 0.3)
    // RCS hiss.
    const rcs = on && (c.lateral !== 0 || c.fore !== 0 || (c.vertical !== 0 && !craft.cruise)) ? 0.06 : 0
    ramp(this.rcsGain!.gain, rcs, 0.03)
    // The altimeter: a soft sine blip, only descending, under 60 m, quickening as the ground comes up.
    const descending = on && craft.vUp() < -1 && !craft.cruise
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

  private blip(freq: number, gain: number, len: number): void {
    if (!this.ctx || !this.master) return
    const o = this.ctx.createOscillator(), g = this.ctx.createGain()
    o.type = 'sine'; o.frequency.value = freq
    const t = this.ctx.currentTime
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0005, t + len)
    o.connect(g).connect(this.master)
    o.start(t); o.stop(t + len + 0.02)
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
