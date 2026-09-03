// Keyboard to Controls. W/S or up/down pitch, A/D or left/right roll, Q/E yaw,
// space thrusts, shift boosts. , . side thrusters, / top thruster (pushes down), ' rear
// thruster (pushes forward). Nothing analogue yet; that is the honest Zarch version.
import type { Controls } from './Craft.ts'

const CODES = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'KeyX', 'KeyZ', 'KeyT', 'Comma', 'Period', 'Slash', 'Quote', 'KeyF', 'KeyV']

export class KeyInput {
  private readonly down = new Set<string>()
  /** When set, replaces the keyboard entirely. Harness hook. */
  override: Controls | null = null

  constructor() {
    addEventListener('keydown', (e) => { if (CODES.includes(e.code)) { this.down.add(e.code); e.preventDefault() } })
    addEventListener('keyup', (e) => this.down.delete(e.code))
    addEventListener('blur', () => this.down.clear())
  }

  /** F: the gun. Held down it fires as fast as the cooldown allows. */
  fire(): boolean { return this.down.has('KeyF') }

  /** X: point against velocity. Z: point at the planet. T: point at the target. (Thrust axis in hover, nose in cruise.) */
  assist(): 'retro' | 'nadir' | 'target' | null {
    return this.down.has('KeyX') ? 'retro' : this.down.has('KeyZ') ? 'nadir' : this.down.has('KeyT') ? 'target' : null
  }

  read(): Controls {
    if (this.override) return this.override
    const d = this.down
    const on = (...codes: string[]) => codes.some((c) => d.has(c)) ? 1 : 0
    return {
      pitch: on('KeyW', 'ArrowUp') - on('KeyS', 'ArrowDown'),
      roll: on('KeyD', 'ArrowRight') - on('KeyA', 'ArrowLeft'),
      yaw: on('KeyE') - on('KeyQ'),
      thrust: on('Space'),
      boost: on('ShiftLeft', 'ShiftRight'),
      lateral: on('Period') - on('Comma'),
      vertical: -on('Slash'),
      fore: on('Quote'),
    }
  }
}
