import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createAphelionScene } from '../../src/lib/aphelion/scene'
import { createTidemarkScene } from '../../src/lib/tidemark/scene'
import { walkable as stationWalkable } from '../../src/lib/aphelion/navigation'

// Only the GPU boundary is replaced. The actual scene callbacks, input events,
// Three.js transforms, authored obstacles and navigation run unchanged.
const rendering = vi.hoisted(() => ({ scene: null as THREE.Scene | null }))
vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>()
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas')
      shadowMap = { enabled: false, type: actual.PCFSoftShadowMap }
      setPixelRatio() {}
      setSize() {}
      render(scene: THREE.Scene) { rendering.scene = scene }
      dispose() {}
    },
  }
})

const games = [
  { name: 'aphelion', speed: 6.5, angle: .54, start: { x: 0, z: 2 },
    create: (host: HTMLDivElement, preview: boolean, onArrive: () => void) => createAphelionScene(host, {
      initialPlace: 'hub', preview, reducedMotion: true, onArrive,
      onNearby: () => {}, onInteract: () => {}, onFailure: message => { throw new Error(message) },
    }) },
  { name: 'tidemark', speed: 5.8, angle: .62, start: { x: 0, z: 10 },
    create: (host: HTMLDivElement, preview: boolean, onArrive: () => void) => createTidemarkScene(host, {
      initialPlace: 'square', preview, reducedMotion: true, onArrive,
      onNearby: () => {}, onInteract: () => {}, onFailure: message => { throw new Error(message) },
    }) },
] as const

type Game = typeof games[number]
type Controls = ReturnType<Game['create']>
let now = 1000
let callbacks = new Map<number, FrameRequestCallback>()
let nextFrameId = 0
const disposals: (() => void)[] = []

beforeEach(() => {
  now = 1000
  nextFrameId = 0
  callbacks = new Map()
  rendering.scene = null
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrameId
    callbacks.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  disposals.splice(0).forEach(dispose => dispose())
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function frame(elapsedMs: number) {
  now += elapsedMs
  const pending = [...callbacks.values()]
  callbacks.clear()
  expect(pending).toHaveLength(1)
  pending[0](now)
}

function mount(game: Game, preview = false) {
  const host = document.createElement('div')
  document.body.append(host)
  const onArrive = vi.fn()
  const controls = game.create(host, preview, onArrive)
  disposals.push(() => controls.dispose())
  frame(0)
  const player = rendering.scene?.children.find(object => object instanceof THREE.Group
    && object.position.x === game.start.x && object.position.z === game.start.z)
  expect(player, 'the real player group at the authored start').toBeDefined()
  if (!player) throw new Error('Player was not rendered')
  return { controls, player, onArrive }
}

function key(key: string, type: 'keydown' | 'keyup' = 'keydown') {
  document.querySelector('canvas')!.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }))
}

function runSecond(fps: number) {
  // The tiny epsilon avoids floating-point equality at the scene's 30 Hz
  // rendering threshold; every sample still measures its actual elapsed time.
  const start = now
  for (let i = 0; i < fps; i++) frame(1000 / fps + 0.000001)
  return (now - start) / 1000
}

const inputs: { name: string; strength: number; fast?: boolean; apply(controls: Controls): void }[] = [
  { name: 'keyboard', strength: 1, apply: () => key('a') },
  { name: 'diagonal keyboard', strength: 1, apply: () => { key('a'); key('w') } },
  { name: 'fast keyboard', strength: 1, fast: true, apply: () => { key('a'); key('Shift') } },
  { name: 'touch', strength: 1, apply: controls => controls.setInput(-1, 0) },
  { name: 'diagonal touch', strength: 1, apply: controls => controls.setInput(-1, -1) },
  { name: 'partial touch', strength: .5, apply: controls => controls.setInput(-.5, 0) },
  { name: 'low quality', strength: 1, apply: controls => { controls.setQuality(true); key('a') } },
]

for (const game of games) {
  describe(`${game.name} actual scene RAF movement`, () => {
    for (const input of inputs) {
      it.each([30, 15, 7, 4, 2])(`${input.name} spends one second of movement at %i FPS`, fps => {
        const { controls, player } = mount(game)
        const start = player.position.clone()
        input.apply(controls)
        const seconds = runSecond(fps)
        const distance = Math.hypot(player.position.x - start.x, player.position.z - start.z)
        expect(distance).toBeCloseTo((input.fast ? 9 : game.speed) * input.strength * seconds, 6)
      })
    }

    it('bounds a stalled frame to one second and stops on input release', () => {
      const { controls, player } = mount(game)
      const start = player.position.clone()
      controls.setInput(-1, 0)
      frame(30_000)
      expect(player.position.distanceTo(start)).toBeCloseTo(game.speed, 6)
      controls.setInput(0, 0)
      const stopped = player.position.clone()
      frame(500)
      expect(player.position.equals(stopped)).toBe(true)
    })

    it('does not accumulate paused or hidden time and clears input on blur', () => {
      const { controls, player } = mount(game)
      const start = player.position.clone()
      key('a')
      controls.setPaused(true)
      frame(30_000)
      expect(player.position.equals(start)).toBe(true)
      now += 30_000
      controls.setPaused(false)
      key('a')
      frame(100)
      expect(player.position.distanceTo(start)).toBeCloseTo(game.speed * .1, 6)
      const resumed = player.position.clone()
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
      frame(30_000)
      expect(player.position.equals(resumed)).toBe(true)
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
      frame(100)
      expect(player.position.distanceTo(resumed)).toBeCloseTo(game.speed * .1, 6)
      window.dispatchEvent(new Event('blur'))
      const blurred = player.position.clone()
      frame(30_000)
      expect(player.position.equals(blurred)).toBe(true)
    })

    it('keeps preview stationary with keyboard and touch input', () => {
      const { controls, player } = mount(game, true)
      const start = player.position.clone()
      key('a')
      controls.setInput(-1, 0)
      frame(500)
      expect(player.position.equals(start)).toBe(true)
      expect(player.visible).toBe(false)
    })

    it('keeps a long direct frame on the near side of an authored obstacle', () => {
      const { controls, player } = mount(game)
      // Approach the real console / house, with enough budget to cross its
      // entire collision footprint if the existing substeps were removed.
      const start = game.name === 'aphelion' ? { x: 5, z: 0 } : { x: -5, z: 18 }
      player.position.set(start.x, 0, start.z)
      const worldZ = game.name === 'aphelion' ? -1 : 1
      controls.setInput(-Math.sin(game.angle) * worldZ, Math.cos(game.angle) * worldZ)
      key('Shift')
      frame(1000)
      expect(player.position.x).toBeCloseTo(start.x, 6)
      if (game.name === 'aphelion') {
        expect(player.position.z).toBeLessThan(0)
        expect(player.position.z).toBeGreaterThanOrEqual(-1)
        expect(stationWalkable(player.position)).toBe(true)
      } else {
        expect(player.position.z).toBeGreaterThan(18)
        expect(player.position.z).toBeLessThanOrEqual(19.3)
      }
    })
  })
}

it('the actual station scene consumes travel corners and emits arrival once', () => {
  const { controls, player, onArrive } = mount(games[0])
  controls.travel('archive')
  for (let i = 0; i < 6; i++) {
    frame(1000)
    expect(stationWalkable(player.position)).toBe(true)
  }
  expect(player.position.x).toBeCloseTo(24, 6)
  expect(player.position.z).toBeCloseTo(0, 6)
  expect(onArrive.mock.calls).toEqual([['archive']])
  frame(1000)
  expect(onArrive).toHaveBeenCalledTimes(1)
})
