// Radar altimeter. A blip that quickens as the ground comes up. Browsers need a
// gesture before audio, so arm() runs on the first keydown; M toggles it.
export class Beeper {
  muted = false
  private ctx: AudioContext | null = null
  private next = 0

  arm(): void {
    if (!this.ctx) this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /** `now` in seconds. Blips only while `active` and under 80 m. */
  update(now: number, altitude: number, active: boolean): void {
    if (!this.ctx || this.muted || !active || altitude > 80 || now < this.next) return
    this.next = now + Math.min(1.2, Math.max(0.07, altitude / 25))
    const o = this.ctx.createOscillator(), g = this.ctx.createGain()
    o.type = 'square'
    o.frequency.value = altitude < 15 ? 1180 : 880
    g.gain.value = 0.04
    o.connect(g).connect(this.ctx.destination)
    const t = this.ctx.currentTime
    o.start(t); o.stop(t + 0.045)
  }
}
