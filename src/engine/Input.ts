// Keyboard and controller to Controls. Keys: W/S or up/down pitch, A/D or left/right roll,
// Q/E yaw, space thrusts, shift boosts, , . side thrusters, / top thruster (pushes down),
// ' rear thruster (pushes forward). A controller (Chris, 2026-09-05: "would it be possible
// to make the game work on my xbox controller?") is analogue on top: left stick pitch and
// roll, right stick yaw and the camera, right trigger thrust, left trigger the brake (flaps
// and airbrake in the jet), bumpers the side thrusters, and the buttons press the same keys
// the keyboard would, so main's key handler needs no second copy: A is J (the jet), B is B
// (flaps), X is G (scan), Y is U (dig or sell), left stick click boosts, right stick click
// is I (the Immelmann), Start is Escape, Back is P (the demo), the d-pad is the arrows (the
// menus). The standard mapping is what Chrome and Firefox give an Xbox pad. The browser only
// lets sound start on a real key or click, so press one key once; the pad cannot do that.
import type { Controls } from './Craft.ts'

const DEAD = 0.15
/** Xbox standard mapping: button index to the key it presses on the rising edge. */
const BUTTON_KEYS: Record<number, string> = { 0: 'KeyJ', 1: 'KeyB', 2: 'KeyG', 3: 'KeyU', 8: 'KeyP', 9: 'Escape', 11: 'KeyI', 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight' }
const axis = (v: number) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * ((Math.abs(v) - DEAD) / (1 - DEAD)))

const CODES = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'KeyX', 'KeyZ', 'KeyT', 'Comma', 'Period', 'Slash', 'KeyB', 'Quote', 'KeyF', 'KeyV']

export class KeyInput {
  private readonly down = new Set<string>()
  /** When set, replaces the keyboard entirely. Harness hook. */
  override: Controls | null = null
  /** The controller, if one has spoken; its buttons last frame, for edges; and the right stick's camera share for main. */
  pad: Gamepad | null = null
  private readonly padWas: boolean[] = []
  /** Right stick, for the chase camera's orbit when it is not yawing (main reads it). */
  camX = 0
  camY = 0
  /** True once a controller has been used, for the HUD. */
  padSeen = false

  constructor() {
    addEventListener('gamepadconnected', (e) => console.log('controller:', (e as GamepadEvent).gamepad.id, 'mapping', (e as GamepadEvent).gamepad.mapping))
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

  /** Poll the controller: analogue axes and triggers, and each button's rising edge as a key press. Call once a frame before read(). */
  poll(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []
    let pad: Gamepad | null = null
    for (const p of pads) if (p && p.connected) { pad = p; break }
    this.pad = pad
    if (!pad) { this.camX = 0; this.camY = 0; return }
    for (let b = 0; b < pad.buttons.length; b++) {
      const now = pad.buttons[b].pressed
      if (now && !this.padWas[b]) {
        this.padSeen = true
        const code = BUTTON_KEYS[b]
        if (code) { const init = { code, key: code.replace('Key', '').toLowerCase(), bubbles: true }; dispatchEvent(new KeyboardEvent('keydown', init)); dispatchEvent(new KeyboardEvent('keyup', init)) }   // and the key-up, or a pitch key would stick
      }
      this.padWas[b] = now
    }
    const ax = pad.axes
    this.camX = axis(ax[2] ?? 0); this.camY = axis(ax[3] ?? 0)
    if (Math.abs(ax[0] ?? 0) > DEAD || Math.abs(ax[1] ?? 0) > DEAD || (pad.buttons[7]?.value ?? 0) > DEAD) this.padSeen = true
  }

  read(): Controls {
    if (this.override) return this.override
    const d = this.down
    const on = (...codes: string[]) => codes.some((c) => d.has(c)) ? 1 : 0
    const k = {
      pitch: on('KeyW', 'ArrowUp') - on('KeyS', 'ArrowDown'),
      roll: on('KeyD', 'ArrowRight') - on('KeyA', 'ArrowLeft'),
      yaw: on('KeyE') - on('KeyQ'),
      thrust: on('Space'),
      boost: on('ShiftLeft', 'ShiftRight'),
      lateral: on('Period') - on('Comma'),
      vertical: -on('Slash'),   // the top thruster, the brake, the jet's airbrake; B toggles the flaps (main)
      fore: on('Quote'),
    }
    const p = this.pad
    if (!p) return k
    // The controller adds to the keys: left stick pitch (push forward is nose down, like the keys) and roll,
    // right stick yaw, right trigger thrust, left trigger the brake, bumpers the side thrusters, left stick click boost.
    const lx = axis(p.axes[0] ?? 0), ly = axis(p.axes[1] ?? 0), rx = axis(p.axes[2] ?? 0)
    const rt = p.buttons[7]?.value ?? 0, lt = p.buttons[6]?.value ?? 0
    const clamp = (v: number) => Math.max(-1, Math.min(1, v))
    return {
      pitch: clamp(k.pitch + -ly),
      roll: clamp(k.roll + lx),
      yaw: clamp(k.yaw + rx),
      thrust: Math.max(k.thrust, rt > DEAD ? rt : 0),
      boost: Math.max(k.boost, p.buttons[10]?.pressed ? 1 : 0),
      lateral: clamp(k.lateral + (p.buttons[5]?.pressed ? 1 : 0) - (p.buttons[4]?.pressed ? 1 : 0)),
      vertical: Math.min(k.vertical, lt > DEAD ? -lt : 0),
      fore: k.fore,
    }
  }

  /** A short buzz, if the pad can: bounces, hard landings, the boom. */
  rumble(strong = 0.6, weak = 0.3, ms = 120): void {
    const act = (this.pad as unknown as { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } } | null)?.vibrationActuator
    if (act?.playEffect) void act.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => undefined)
  }
}
