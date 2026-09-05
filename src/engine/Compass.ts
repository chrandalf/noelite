// The compass strip (Chris, 2026-09-04: "a little map on the top showing the direction to
// it"): a bar across the top of the frame with a tick for every place, at its bearing
// from the camera. Ahead is the middle; ±90° reaches the ends; behind you is pinned to
// the nearer end with an arrow. The target is lit. DOM only.
import * as THREE from 'three'

export type CompassItem = { key: string; name: string; dist: string; d: number; dir: THREE.Vector3; kind: 'body' | 'station' | 'outpost' | 'field' | 'seam' | 'contact' | 'runway'; selected: boolean }

const GLYPH: Record<CompassItem['kind'], string> = { body: '●', station: '◆', outpost: '⌂', field: '⁘', seam: '◈', contact: '◯', runway: '▬' }

export class Compass {
  readonly root: HTMLElement
  private readonly els = new Map<string, HTMLElement>()
  /** Last frame's row per tick, so a label keeps its row while it can: rows reassigned every frame flickered. */
  private readonly rowOf = new Map<string, number>()
  private readonly v = new THREE.Vector3()
  private readonly qInv = new THREE.Quaternion()

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.id = 'compass'
    this.root.innerHTML = '<div class="line"></div><div class="centre"></div>'
    parent.appendChild(this.root)
  }

  /** `dir` is a unit direction in scene space (camera at the origin). */
  update(items: CompassItem[], camera: THREE.PerspectiveCamera, show: boolean): void {
    this.root.hidden = !show
    if (!show) return
    this.qInv.copy(camera.quaternion).invert()
    const seen = new Set<string>()
    // Bearings first, then rows: a tick whose label would sit on another's goes a row down,
    // the selected one always on the top row. Planets bunch in one direction from home.
    const placed: { it: CompassItem; x: number; up: number; behind: boolean; bearing: number; row: number }[] = []
    for (const it of items) {
      this.v.copy(it.dir).applyQuaternion(this.qInv)
      const bearing = Math.atan2(this.v.x, -this.v.z)
      placed.push({ it, x: Math.max(-1, Math.min(1, bearing / (Math.PI / 2))), up: Math.max(-1, Math.min(1, this.v.y)), behind: Math.abs(bearing) > Math.PI / 2, bearing, row: 0 })
    }
    // Labels by priority: the target, then the nearest; a label that would sit on a
    // higher one drops a row, and past the last row it is a glyph alone.
    placed.sort((a, b) => (a.it.selected ? -1 : b.it.selected ? 1 : a.it.d - b.it.d))
    const rows: number[][] = [[], [], [], []]
    const GAP = 0.16   // of the half-width: about 8% of the strip
    const free = (r: number, x: number) => r >= 0 && r < rows.length && !rows[r].some((y) => Math.abs(y - x) < GAP)
    for (const p of placed) {
      if (p.behind) { p.row = 0; continue }
      const last = this.rowOf.get(p.it.key)
      let r = last !== undefined && free(last, p.x) ? last : 0
      if (r === 0 && !free(0, p.x)) { r = 0; while (r < rows.length && !free(r, p.x)) r++ }
      if (r < rows.length) { p.row = r; rows[r].push(p.x) } else p.row = -1
      this.rowOf.set(p.it.key, p.row)
    }
    for (const p of placed) {
      const it = p.it
      seen.add(it.key)
      let el = this.els.get(it.key)
      if (!el) { el = document.createElement('div'); el.className = 'tick'; el.innerHTML = '<span class="g"></span><span class="n"></span><span class="d"></span>'; this.root.appendChild(el); this.els.set(it.key, el) }
      el.style.left = `${50 + p.x * 48}%`
      el.style.top = `${Math.max(0, p.row) * 30}px`
      el.className = `tick ${it.kind}${it.selected ? ' on' : ''}${p.behind ? ' behind' : ''}${p.row > 0 ? ' down' : ''}${p.row < 0 ? ' bare' : ''}`
      const g = el.children[0] as HTMLElement, n = el.children[1] as HTMLElement, d = el.children[2] as HTMLElement
      g.textContent = p.behind ? (p.bearing > 0 ? '▸' : '◂') : GLYPH[it.kind]
      n.textContent = it.name
      d.textContent = it.dist
      // Above or below the horizon: nudge the glyph so a planet under you reads as under.
      g.style.transform = `translateY(${(-p.up * 6).toFixed(1)}px)`
    }
    for (const [k, el] of this.els) if (!seen.has(k)) { el.remove(); this.els.delete(k) }
  }
}
