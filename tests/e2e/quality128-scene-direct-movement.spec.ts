import { expect, test } from '@playwright/test'

type Measurement = { x: number; z: number; distance: number; seconds: number; renders: number }
type SceneHarness = {
  reset(): void
  run(fps: number): Measurement
  input(x: number, z: number): void
  lowQuality(value: boolean): void
  screenPoint(x: number, z: number): { x: number; y: number }
  dispose(): void
}

test.use({ serviceWorkers: 'block' })

for (const game of ['aphelion', 'tidemark'] as const) {
  test(`${game}: native WebGL scene keeps keyboard/touch speed and ground-click navigation`, async ({ page, context }, info) => {
    const baseURL = info.project.use.baseURL
    if (!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) throw new Error('isolated loopback app required')
    const origin = new URL(baseURL).origin
    const blocked: string[] = [], errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
        blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
        await route.abort('blockedbyclient')
      } else if (url.pathname === '/storyforge/quality128-scene') {
        // A new browser context with no author app, project, saves or providers.
        await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated scene movement</title><div id="scene" style="width:480px;height:360px"></div>' })
      } else await route.continue()
    })
    await page.goto('quality128-scene')
    const setup = await page.evaluate(async game => {
      const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
      const path = `/storyforge/src/lib/${game}/scene.ts`
      const module = await importer(path)
      // Resolve the exact Three.js module used by the real Vite-served scene.
      // Observing onBeforeRender leaves the native renderer and all math intact.
      const source = await fetch(path).then(response => response.text())
      const threePath = /import\s*\*\s*as\s*THREE\s*from\s*["']([^"']+)["']/.exec(source)?.[1]
      if (!threePath) throw new Error('The scene Three.js import was not found')
      const THREE = await importer(threePath) as typeof import('three')
      const host = document.querySelector<HTMLDivElement>('#scene')!
      const originalRaf = window.requestAnimationFrame, originalCancel = window.cancelAnimationFrame
      const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now')
      const renderDescriptor = Object.getOwnPropertyDescriptor(THREE.Scene.prototype, 'onBeforeRender')
      const originalBeforeRender = THREE.Scene.prototype.onBeforeRender
      let now = 1000, nextId = 0, renders = 0
      const frames = new Map<number, FrameRequestCallback>()
      let captured: { scene: import('three').Scene; camera: import('three').Camera } | null = null
      Object.defineProperty(performance, 'now', { configurable: true, value: () => now })
      window.requestAnimationFrame = callback => { frames.set(++nextId, callback); return nextId }
      window.cancelAnimationFrame = id => { frames.delete(id) }
      THREE.Scene.prototype.onBeforeRender = function (...args) {
        captured = { scene: this, camera: args[2] }
        renders++
        originalBeforeRender.apply(this, args)
      }
      const common = { preview: false, reducedMotion: true, onArrive() {}, onNearby() {}, onInteract() {}, onFailure(message: string) { throw new Error(message) } }
      const controls = game === 'aphelion'
        ? (module as typeof import('../../src/lib/aphelion/scene')).createAphelionScene(host, { ...common, initialPlace: 'hub' })
        : (module as typeof import('../../src/lib/tidemark/scene')).createTidemarkScene(host, { ...common, initialPlace: 'square' })
      const tick = (elapsedMs: number) => {
        now += elapsedMs
        const pending = [...frames.values()]
        frames.clear()
        if (pending.length !== 1) throw new Error(`Expected one actual scene RAF callback; got ${pending.length}`)
        pending[0](now)
      }
      tick(0)
      // The callback owns this assignment; TypeScript cannot infer it from tick().
      const observed = captured as { scene: import('three').Scene; camera: import('three').Camera } | null
      if (!observed) throw new Error('The native renderer did not render the scene')
      const startZ = game === 'aphelion' ? 2 : 10
      const player = observed.scene.children.find(object => object instanceof THREE.Group && object.position.x === 0 && object.position.z === startZ)
      if (!player) throw new Error('The authored player start was not rendered')
      const start = player.position.clone()
      const canvas = host.querySelector('canvas')!
      const gl = canvas.getContext('webgl2');
      (window as typeof window & { quality128Scene: SceneHarness }).quality128Scene = {
        reset() { controls.setInput(0, 0); player.position.copy(start); tick(1000) },
        run(fps) {
          const began = now, before = player.position.clone(), priorRenders = renders
          for (let i = 0; i < fps; i++) tick(1000 / fps + 0.000001)
          return { x: player.position.x, z: player.position.z, distance: player.position.distanceTo(before), seconds: (now - began) / 1000, renders: renders - priorRenders }
        },
        input(x, z) { controls.setInput(x, z) },
        lowQuality(value) { controls.setQuality(value) },
        screenPoint(x, z) {
          const point = new THREE.Vector3(x, game === 'aphelion' ? -.1 : 0, z).project(observed.camera)
          const rect = canvas.getBoundingClientRect()
          return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 }
        },
        dispose() {
          controls.dispose()
          window.requestAnimationFrame = originalRaf
          window.cancelAnimationFrame = originalCancel
          if (nowDescriptor) Object.defineProperty(performance, 'now', nowDescriptor)
          else Reflect.deleteProperty(performance, 'now')
          if (renderDescriptor) Object.defineProperty(THREE.Scene.prototype, 'onBeforeRender', renderDescriptor)
          else Reflect.deleteProperty(THREE.Scene.prototype, 'onBeforeRender')
        },
      }
      return { nativeWebGL: gl instanceof WebGL2RenderingContext && !gl.isContextLost(), canvasCount: host.querySelectorAll('canvas').length }
    }, game)
    expect(setup).toEqual({ nativeWebGL: true, canvasCount: 1 })
    const speed = game === 'aphelion' ? 6.5 : 5.8
    const measurements: { input: string; fps: number; result: Measurement }[] = []
    const canvas = page.locator('canvas')
    await canvas.focus()
    for (const fps of [30, 15, 7, 4, 2]) {
      await page.evaluate(() => (window as typeof window & { quality128Scene: SceneHarness }).quality128Scene.reset())
      await page.keyboard.down('a')
      const keyboard = await page.evaluate(fps => (window as typeof window & { quality128Scene: SceneHarness }).quality128Scene.run(fps), fps)
      await page.keyboard.up('a')
      expect(keyboard.renders).toBe(fps)
      expect(keyboard.distance).toBeCloseTo(speed * keyboard.seconds, 6)
      measurements.push({ input: 'native keyboard', fps, result: keyboard })
      await page.evaluate(() => { (window as typeof window & { quality128Scene: SceneHarness }).quality128Scene.reset(); (window as typeof window & { quality128Scene: SceneHarness }).quality128Scene.input(-1, -1) })
      const touch = await page.evaluate(fps => (window as typeof window & { quality128Scene: SceneHarness }).quality128Scene.run(fps), fps)
      expect(touch.renders).toBe(fps)
      expect(touch.distance).toBeCloseTo(speed * touch.seconds, 6)
      measurements.push({ input: 'diagonal touch API', fps, result: touch })
    }
    await page.evaluate(() => { (window as typeof window & { quality128Scene: SceneHarness }).quality128Scene.reset(); (window as typeof window & { quality128Scene: SceneHarness }).quality128Scene.lowQuality(true) })
    await page.keyboard.down('Shift')
    await page.keyboard.down('a')
    const fast = await page.evaluate(() => (window as typeof window & { quality128Scene: SceneHarness }).quality128Scene.run(2))
    await page.keyboard.up('a')
    await page.keyboard.up('Shift')
    expect(fast.distance).toBeCloseTo(9 * fast.seconds, 6)
    measurements.push({ input: 'native fast keyboard, low quality', fps: 2, result: fast })
    await page.evaluate(() => (window as typeof window & { quality128Scene: SceneHarness }).quality128Scene.reset())
    const destination = { x: 4, z: game === 'aphelion' ? 4 : 12 }
    const screen = await page.evaluate(point => (window as typeof window & { quality128Scene: SceneHarness }).quality128Scene.screenPoint(point.x, point.z), destination)
    await page.mouse.click(screen.x, screen.y)
    await page.evaluate(() => (window as typeof window & { quality128Scene: SceneHarness }).quality128Scene.run(2))
    const arrived = await page.evaluate(() => (window as typeof window & { quality128Scene: SceneHarness }).quality128Scene.run(2))
    expect(arrived.x).toBeCloseTo(destination.x, 1)
    expect(arrived.z).toBeCloseTo(destination.z, 1)
    await page.screenshot({ path: info.outputPath(`${game}-native-scene.png`) })
    await info.attach('actual-scene-movement', { contentType: 'application/json', body: JSON.stringify({ setup, measurements, arrived, blocked, errors }) })
    const storage = await page.evaluate(async () => ({ databases: (await indexedDB.databases()).length, local: localStorage.length }))
    expect(storage).toEqual({ databases: 0, local: 0 })
    await page.evaluate(() => (window as typeof window & { quality128Scene: SceneHarness }).quality128Scene.dispose())
    expect(blocked).toEqual([])
    expect(errors).toEqual([])
  })
}
