// Keyboard to Controls. W/S or up/down pitch, A/D or left/right roll, Q/E yaw,
// space thrusts, shift boosts. Nothing analogue yet; that is the honest Zarch version.
import type { Controls } from './Craft.ts'

const CODES = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'KeyX', 'KeyZ']

export class KeyInput {
  private readonly down = new Set<string>()
  /** When set, replaces the keyboard entirely. Harness hook. */
  override: Controls | null = null

  constructor() {
    addEventListener('keydown', (e) => { if (CODES.includes(e.code)) { this.down.add(e.code); e.preventDefault() } })
    addEventListener('keyup', (e) => this.down.delete(e.code))
    addEventListener('blur', () => this.down.clear())
  }

  /** X: point thrust against velocity. Z: point thrust at the planet. */
  assist(): 'retro' | 'nadir' | null {
    return this.down.has('KeyX') ? 'retro' : this.down.has('KeyZ') ? 'nadir' : null
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
    }
  }
}
