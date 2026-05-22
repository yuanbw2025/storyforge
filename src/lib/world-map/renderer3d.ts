/**
 * 世界地图 3D 渲染引擎 — Inkarnate 风格
 * 高度图地形 + 羊皮纸纹理 + 河流道路 + 城市标记 + 后处理滤镜
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import type {
  WorldMapData,
  MapMarker, Point2D,
} from '../types/world-map'

// ── 地形配色（等高线 / 地形图风格） ────────────────────────────
// 按海拔分层：深蓝海 → 浅蓝近海 → 沙滩黄 → 绿色平原 → 黄绿丘陵
//   → 棕色高地 → 灰白雪山，volcanic 用暗红

const TERRAIN_COLOR3: Record<string, THREE.Color> = {
  deepocean:        new THREE.Color(0x1a3860),
  ocean:            new THREE.Color(0x2a5888),
  coast:            new THREE.Color(0x5a9ab8),
  plains:           new THREE.Color(0x88b858),
  grassland:        new THREE.Color(0x7aaa48),
  forest:           new THREE.Color(0x5a8a32),
  'dense-forest':   new THREE.Color(0x3a6a22),
  hills:            new THREE.Color(0xb8a050),
  'mountain-region': new THREE.Color(0x9a8060),
  desert:           new THREE.Color(0xd0b860),
  tundra:           new THREE.Color(0xb8b0a0),
  swamp:            new THREE.Color(0x607848),
  volcanic:         new THREE.Color(0x8a4030),
  ice:              new THREE.Color(0xe0e0f0),
}
const DEFAULT_COLOR = new THREE.Color(0x1a3860) // 默认深海

/**
 * 等高线渐变色带（从低到高）
 * 用于在顶点着色时按实际高度做颜色混合，而非纯粹按 type
 */
const HYPSOMETRIC_STOPS: { h: number; color: THREE.Color }[] = [
  { h: -20, color: new THREE.Color(0x122848) },  // 深渊
  { h: -12, color: new THREE.Color(0x1a3860) },  // 深海
  { h: -6,  color: new THREE.Color(0x2a5888) },  // 浅海
  { h: -1,  color: new THREE.Color(0x5a9ab8) },  // 近岸
  { h:  0,  color: new THREE.Color(0xa0c8a0) },  // 海岸线 / 沙滩
  { h:  4,  color: new THREE.Color(0x88b858) },  // 低地
  { h:  8,  color: new THREE.Color(0x6aa038) },  // 平原
  { h: 14,  color: new THREE.Color(0x88a040) },  // 森林
  { h: 22,  color: new THREE.Color(0xb8a048) },  // 丘陵
  { h: 32,  color: new THREE.Color(0xa08050) },  // 高原
  { h: 42,  color: new THREE.Color(0x8a7060) },  // 高山
  { h: 55,  color: new THREE.Color(0xc8c0b0) },  // 雪线
  { h: 70,  color: new THREE.Color(0xf0eee8) },  // 永久积雪
]

/** 地形高度 */
const TERRAIN_HEIGHT: Record<string, number> = {
  deepocean: -18, ocean: -10, coast: -2,
  plains: 5, grassland: 7, forest: 12,
  'dense-forest': 16, hills: 25, 'mountain-region': 38,
  desert: 4, tundra: 6, swamp: 1, volcanic: 32, ice: 10,
}

const WATER_TYPES = new Set(['ocean', 'deepocean', 'coast'])
/** 按高度在等高线色带中插值 */
function hypsometricColor(height: number): THREE.Color {
  const stops = HYPSOMETRIC_STOPS
  if (height <= stops[0].h) return stops[0].color.clone()
  if (height >= stops[stops.length - 1].h) return stops[stops.length - 1].color.clone()
  for (let i = 1; i < stops.length; i++) {
    if (height <= stops[i].h) {
      const t = (height - stops[i - 1].h) / (stops[i].h - stops[i - 1].h)
      return stops[i - 1].color.clone().lerp(stops[i].color, t)
    }
  }
  return stops[stops.length - 1].color.clone()
}

// ── 后处理着色器：暗角 + 暖色调 ─────────────────────────────

const VignetteWarmShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignetteAmount: { value: 0.45 },
    warmth: { value: 0.12 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float vignetteAmount;
    uniform float warmth;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      // 暗角
      vec2 center = vUv - 0.5;
      float dist = length(center);
      float vignette = smoothstep(0.5, 0.2, dist * vignetteAmount * 2.0);
      color.rgb *= mix(0.3, 1.0, vignette);
      // 暖色调 — 红/黄微增，蓝微减
      color.r += warmth * 0.08;
      color.g += warmth * 0.04;
      color.b -= warmth * 0.05;
      // 轻微复古降饱和
      float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      color.rgb = mix(vec3(gray), color.rgb, 0.88);
      gl_FragColor = color;
    }
  `,
}

// ── 主类 ────────────────────────────────────────────────────

export interface Map3DOptions {
  selectedMarkerId?: string | null
  hoveredMarkerId?: string | null
  onSelectMarker?: (marker: MapMarker | null) => void
  onHoverMarker?: (markerId: string | null) => void
}

export class WorldMap3DRenderer {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private controls: OrbitControls
  private composer: EffectComposer
  private container: HTMLElement
  private data: WorldMapData | null = null
  private animFrameId: number | null = null

  // 高度图缓存
  private heightGrid: Float32Array | null = null
  private gridCols = 0
  private gridRows = 0
  private gridStepX = 0
  private gridStepZ = 0

  // 交互
  private raycaster = new THREE.Raycaster()
  private mouse = new THREE.Vector2()
  private markerMeshes: Map<string, THREE.Object3D> = new Map()
  private markerData: Map<string, MapMarker> = new Map()
  private options: Map3DOptions = {}

  private labelSprites: THREE.Sprite[] = []
  private selectionRing: THREE.Mesh | null = null

  constructor(container: HTMLElement) {
    this.container = container
    const w = container.clientWidth
    const h = container.clientHeight

    // Scene
    this.scene = new THREE.Scene()
    // 背景色匹配深海，让地形边缘与背景自然融合
    this.scene.background = new THREE.Color(0x101828)
    this.scene.fog = new THREE.FogExp2(0x101828, 0.00035)

    // Camera
    this.camera = new THREE.PerspectiveCamera(50, w / h, 1, 5000)
    this.camera.position.set(600, 500, 600)

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(w, h)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    container.appendChild(this.renderer.domElement)

    // Post-processing
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.25,  // strength — 柔和泛光
      0.8,   // radius
      0.7,   // threshold
    )
    this.composer.addPass(bloomPass)

    const vignettePass = new ShaderPass(VignetteWarmShader)
    this.composer.addPass(vignettePass)

    const outputPass = new OutputPass()
    this.composer.addPass(outputPass)

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 100
    this.controls.maxDistance = 2500
    this.controls.maxPolarAngle = Math.PI * 0.85
    this.controls.minPolarAngle = 0.05
    this.controls.target.set(600, 0, 400)

    // Lights — 暖色主光 + 冷色补光，模拟古卷感
    const ambientLight = new THREE.AmbientLight(0x9a8870, 0.5)
    this.scene.add(ambientLight)

    const dirLight = new THREE.DirectionalLight(0xffe0b0, 1.3)
    dirLight.position.set(400, 600, -200)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.set(2048, 2048)
    dirLight.shadow.camera.left = -800
    dirLight.shadow.camera.right = 800
    dirLight.shadow.camera.top = 800
    dirLight.shadow.camera.bottom = -800
    this.scene.add(dirLight)

    const fillLight = new THREE.DirectionalLight(0x6090b0, 0.25)
    fillLight.position.set(-300, 200, 400)
    this.scene.add(fillLight)

    // Events
    this._onResize = this._onResize.bind(this)
    this._onClick = this._onClick.bind(this)
    this._onMouseMove = this._onMouseMove.bind(this)
    window.addEventListener('resize', this._onResize)
    this.renderer.domElement.addEventListener('click', this._onClick)
    this.renderer.domElement.addEventListener('mousemove', this._onMouseMove)

    this._animate()
  }

  // ── 公开接口 ─────────────────────────────────────────────

  setData(data: WorldMapData, options: Map3DOptions = {}) {
    this.data = data
    this.options = options
    this._clearScene()

    this._buildHeightmapTerrain(data)
    this._buildRivers(data)
    this._buildRoads(data)
    this._buildMarkers(data)
    this._buildLabels(data)

    this.controls.target.set(data.width / 2, 0, data.height / 2)
    this.camera.position.set(data.width / 2, data.height * 0.7, data.height * 1.2)
    this.controls.update()
  }

  updateOptions(options: Map3DOptions) {
    this.options = { ...this.options, ...options }
    this._updateSelection()
  }

  dispose() {
    if (this.animFrameId !== null) cancelAnimationFrame(this.animFrameId)
    window.removeEventListener('resize', this._onResize)
    this.renderer.domElement.removeEventListener('click', this._onClick)
    this.renderer.domElement.removeEventListener('mousemove', this._onMouseMove)
    this.controls.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private _clearScene() {
    const toRemove: THREE.Object3D[] = []
    this.scene.traverse(obj => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Sprite) {
        toRemove.push(obj)
      }
    })
    toRemove.forEach(obj => {
      obj.removeFromParent()
      if ('geometry' in obj && obj.geometry) (obj.geometry as THREE.BufferGeometry).dispose()
      if ('material' in obj && obj.material) {
        const mat = obj.material as THREE.Material | THREE.Material[]
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else mat.dispose()
      }
    })
    this.markerMeshes.clear()
    this.markerData.clear()
    this.labelSprites = []
    this.selectionRing = null
  }

  // ── 动画循环 ─────────────────────────────────────────────

  private _animate() {
    this.animFrameId = requestAnimationFrame(() => this._animate())
    this.controls.update()

    // 标签面向相机
    for (const sprite of this.labelSprites) {
      sprite.lookAt(this.camera.position)
    }

    // 用后处理管线渲染
    this.composer.render()
  }

  // ══════════════════════════════════════════════════════════
  // ① 高度图地形 + 羊皮纸纹理
  // ══════════════════════════════════════════════════════════

  private _buildHeightmapTerrain(data: WorldMapData) {
    const CELL = 5
    const cols = Math.ceil(data.width / CELL)
    const rows = Math.ceil(data.height / CELL)
    this.gridCols = cols
    this.gridRows = rows
    this.gridStepX = data.width / cols
    this.gridStepZ = data.height / rows

    const total = (cols + 1) * (rows + 1)
    const heightMap = new Float32Array(total)
    const colorMap: THREE.Color[] = new Array(total)
    const typeMap: string[] = new Array(total)

    // 默认深海
    for (let i = 0; i < total; i++) {
      heightMap[i] = TERRAIN_HEIGHT['deepocean']
      colorMap[i] = TERRAIN_COLOR3['deepocean'].clone()
      typeMap[i] = 'deepocean'
    }

    // 按 zIndex 覆盖
    const sorted = [...data.regions].sort((a, b) => a.zIndex - b.zIndex)
    for (const region of sorted) {
      if (region.polygon.length < 3) continue
      const h = TERRAIN_HEIGHT[region.type] ?? 4
      const c = region.color
        ? new THREE.Color(region.color)
        : (TERRAIN_COLOR3[region.type] ?? DEFAULT_COLOR)

      // AABB 加速
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const pt of region.polygon) {
        if (pt[0] < minX) minX = pt[0]; if (pt[0] > maxX) maxX = pt[0]
        if (pt[1] < minY) minY = pt[1]; if (pt[1] > maxY) maxY = pt[1]
      }
      const c0 = Math.max(0, Math.floor(minX / this.gridStepX) - 1)
      const c1 = Math.min(cols, Math.ceil(maxX / this.gridStepX) + 1)
      const r0 = Math.max(0, Math.floor(minY / this.gridStepZ) - 1)
      const r1 = Math.min(rows, Math.ceil(maxY / this.gridStepZ) + 1)

      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const wx = col * this.gridStepX
          const wz = row * this.gridStepZ
          if (this._pointInPolygon(wx, wz, region.polygon)) {
            const idx = row * (cols + 1) + col
            heightMap[idx] = h
            colorMap[idx] = c.clone()
            typeMap[idx] = region.type
          }
        }
      }
    }

    this._smoothHeightMap(heightMap, typeMap, cols + 1, rows + 1, 3)
    this.heightGrid = heightMap

    // 构建 PlaneGeometry
    const geo = new THREE.PlaneGeometry(data.width, data.height, cols, rows)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position as THREE.BufferAttribute
    const vertColors = new Float32Array(pos.count * 3)

    for (let i = 0; i < pos.count; i++) {
      const h = heightMap[i]
      pos.setY(i, h)

      // 等高线渐变着色：按平滑后的实际高度插值色带
      // 特殊地形（沙漠、火山、沼泽、冰原）保留原色，其他用等高线色
      const type = typeMap[i]
      const specialTypes = new Set(['desert', 'volcanic', 'swamp', 'ice', 'tundra'])
      const c = specialTypes.has(type)
        ? (colorMap[i] ?? hypsometricColor(h))
        : hypsometricColor(h)
      vertColors[i * 3] = c.r
      vertColors[i * 3 + 1] = c.g
      vertColors[i * 3 + 2] = c.b
    }
    pos.needsUpdate = true
    geo.setAttribute('color', new THREE.BufferAttribute(vertColors, 3))
    geo.computeVertexNormals()

    // 羊皮纸纹理
    const parchTex = this._createParchmentTexture(1024, 1024)
    parchTex.wrapS = THREE.RepeatWrapping
    parchTex.wrapT = THREE.RepeatWrapping
    parchTex.repeat.set(4, 4)

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: parchTex,
      roughness: 0.9,
      metalness: 0.02,
      flatShading: false,
    })

    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(data.width / 2, 0, data.height / 2)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.scene.add(mesh)
  }

  /** 程序化生成羊皮纸纹理 */
  private _createParchmentTexture(w: number, h: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!

    // 基底暖黄色
    ctx.fillStyle = '#e8dcc8'
    ctx.fillRect(0, 0, w, h)

    // 像素级噪点 — 模拟纸张颗粒
    const imgData = ctx.getImageData(0, 0, w, h)
    const d = imgData.data
    for (let i = 0; i < d.length; i += 4) {
      const noise = (Math.random() - 0.5) * 35
      d[i] = Math.min(255, Math.max(0, d[i] + noise))
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + noise))
      d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + noise * 0.6))
    }
    ctx.putImageData(imgData, 0, 0)

    // 纤维线条
    ctx.globalAlpha = 0.04
    ctx.strokeStyle = '#6a5a40'
    for (let i = 0; i < 80; i++) {
      ctx.beginPath()
      const y = Math.random() * h
      ctx.moveTo(0, y + Math.random() * 20)
      ctx.bezierCurveTo(
        w * 0.3, y + (Math.random() - 0.5) * 15,
        w * 0.7, y + (Math.random() - 0.5) * 15,
        w, y + Math.random() * 20,
      )
      ctx.lineWidth = Math.random() * 1.5 + 0.5
      ctx.stroke()
    }
    ctx.globalAlpha = 1.0

    // 水渍/污迹
    ctx.globalAlpha = 0.03
    for (let i = 0; i < 12; i++) {
      const cx = Math.random() * w
      const cy = Math.random() * h
      const r = 40 + Math.random() * 120
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
      grad.addColorStop(0, '#8a7050')
      grad.addColorStop(1, 'transparent')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1.0

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  /** 高斯模糊平滑（水陆边界保持锐利） */
  private _smoothHeightMap(
    hm: Float32Array, types: string[],
    w: number, h: number, passes: number,
  ) {
    const tmp = new Float32Array(hm.length)
    for (let pass = 0; pass < passes; pass++) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x
          const isW = WATER_TYPES.has(types[idx])
          let sum = hm[idx] * 4
          let wt = 4
          for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const ni = ny * w + nx
              const nW = WATER_TYPES.has(types[ni])
              const s = isW === nW ? 2 : 0.3
              sum += hm[ni] * s; wt += s
            }
          }
          for (const [nx, ny] of [[x-1,y-1],[x+1,y-1],[x-1,y+1],[x+1,y+1]]) {
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const ni = ny * w + nx
              const nW = WATER_TYPES.has(types[ni])
              if (isW === nW) { sum += hm[ni]; wt += 1 }
            }
          }
          tmp[idx] = sum / wt
        }
      }
      hm.set(tmp)
    }
  }

  // ── 河流 ─────────────────────────────────────────────────

  private _buildRivers(data: WorldMapData) {
    for (const river of data.rivers) {
      // 主河流用更大宽度
      this._buildRiverLine(river.path, Math.max(river.width || 3, 3), true)
      if (river.tributaries) {
        for (const trib of river.tributaries) {
          this._buildRiverLine(trib.path, Math.max(trib.width || 2, 2), false)
        }
      }
    }
  }

  private _buildRiverLine(path: Point2D[], width: number, isMain: boolean) {
    if (path.length < 2) return
    const points = path.map(p => {
      const y = Math.max(this._sampleHeight(p[0], p[1]) + 2, 1)
      return new THREE.Vector3(p[0], y, p[1])
    })
    const curve = new THREE.CatmullRomCurve3(points)
    // 河流加粗：主河 ×2.5，支流 ×1.5
    const radius = width * (isMain ? 2.5 : 1.5)
    const geo = new THREE.TubeGeometry(curve, path.length * 5, radius, 8, false)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3888c0,
      emissive: 0x102840,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.85,
      roughness: 0.1,
      metalness: 0.2,
    })
    const mesh = new THREE.Mesh(geo, mat)
    this.scene.add(mesh)
  }

  // ── 道路 ─────────────────────────────────────────────────

  private _buildRoads(data: WorldMapData) {
    for (const road of data.roads) {
      if (road.path.length < 2) continue
      const points = road.path.map(p => {
        const y = this._sampleHeight(p[0], p[1]) + 2
        return new THREE.Vector3(p[0], y, p[1])
      })
      const geo = new THREE.BufferGeometry().setFromPoints(points)
      const color = road.type === 'trade' ? 0xc9a84c : road.type === 'major' ? 0x8a7a60 : 0x6a5a4a
      const mat = new THREE.LineDashedMaterial({
        color, dashSize: 5, gapSize: 3, linewidth: 1,
      })
      const line = new THREE.Line(geo, mat)
      line.computeLineDistances()
      this.scene.add(line)
    }
  }

  // ── 城市标记 ─────────────────────────────────────────────

  private _buildMarkers(data: WorldMapData) {
    for (const marker of data.markers) {
      const isCapital = marker.type === 'capital'
      const size = isCapital ? 8 : 4 + marker.importance
      const baseH = Math.max(this._sampleHeight(marker.x, marker.y), 0)

      // 标记柱
      const geo = new THREE.CylinderGeometry(size * 0.3, size * 0.5, size, 8)
      const color = isCapital ? 0xc9a84c : 0xb08060
      const mat = new THREE.MeshStandardMaterial({
        color, roughness: 0.4, metalness: 0.3,
        emissive: isCapital ? 0x332200 : 0x000000,
        emissiveIntensity: isCapital ? 0.3 : 0,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(marker.x, baseH + size / 2, marker.y)
      mesh.castShadow = true
      mesh.userData = { markerId: marker.id }
      this.scene.add(mesh)
      this.markerMeshes.set(marker.id, mesh)
      this.markerData.set(marker.id, marker)

      // 顶部球
      const sGeo = new THREE.SphereGeometry(size * 0.4, 8, 8)
      const sMat = new THREE.MeshStandardMaterial({
        color: isCapital ? 0xffe0a0 : 0xe0c0a0,
        emissive: isCapital ? 0x553300 : 0x000000,
        emissiveIntensity: isCapital ? 0.5 : 0,
        roughness: 0.3,
      })
      const sphere = new THREE.Mesh(sGeo, sMat)
      sphere.position.set(marker.x, baseH + size + size * 0.3, marker.y)
      sphere.userData = { markerId: marker.id }
      this.scene.add(sphere)

      // 标签
      const label = this._createTextSprite(marker.name, {
        fontSize: isCapital ? 16 : 12,
        color: isCapital ? '#d4a84c' : '#c0b090',
        bgColor: 'rgba(30,28,20,0.75)',
      })
      label.position.set(marker.x, baseH + size + size * 0.8 + 6, marker.y)
      label.scale.set(marker.name.length * (isCapital ? 9 : 7), isCapital ? 16 : 12, 1)
      this.scene.add(label)
      this.labelSprites.push(label)
    }
  }

  // ── 文字标注 ─────────────────────────────────────────────

  private _buildLabels(data: WorldMapData) {
    for (const label of data.labels) {
      const sprite = this._createTextSprite(label.text, {
        fontSize: label.fontSize || 14,
        color: label.color || '#a09070',
        bgColor: 'transparent',
      })
      const h = Math.max(this._sampleHeight(label.x, label.y), 0)
      sprite.position.set(label.x, h + 15, label.y)
      sprite.scale.set(
        label.text.length * (label.fontSize || 14) * 0.7,
        (label.fontSize || 14) * 1.2, 1,
      )
      this.scene.add(sprite)
      this.labelSprites.push(sprite)
    }
  }

  // ── 选中高亮 ─────────────────────────────────────────────

  private _updateSelection() {
    if (this.selectionRing) {
      this.scene.remove(this.selectionRing)
      this.selectionRing.geometry.dispose()
      ;(this.selectionRing.material as THREE.Material).dispose()
      this.selectionRing = null
    }
    const id = this.options.selectedMarkerId
    if (!id) return
    const mesh = this.markerMeshes.get(id)
    if (!mesh) return

    const ringGeo = new THREE.RingGeometry(10, 13, 24)
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x3b82f6, transparent: true, opacity: 0.6, side: THREE.DoubleSide,
    })
    this.selectionRing = new THREE.Mesh(ringGeo, ringMat)
    this.selectionRing.rotation.x = -Math.PI / 2
    this.selectionRing.position.set(mesh.position.x, mesh.position.y - 3, mesh.position.z)
    this.scene.add(this.selectionRing)
  }

  // ── 事件 ─────────────────────────────────────────────────

  private _onResize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
  }

  private _onClick(e: MouseEvent) {
    if (!this.data) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.mouse, this.camera)
    const meshes = Array.from(this.markerMeshes.values())
    const intersects = this.raycaster.intersectObjects(meshes, true)
    if (intersects.length > 0) {
      let obj: THREE.Object3D | null = intersects[0].object
      while (obj && !obj.userData?.markerId) obj = obj.parent
      if (obj?.userData?.markerId) {
        this.options.onSelectMarker?.(this.markerData.get(obj.userData.markerId) || null)
        return
      }
    }
    this.options.onSelectMarker?.(null)
  }

  private _onMouseMove(e: MouseEvent) {
    if (!this.data) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    this.raycaster.setFromCamera(this.mouse, this.camera)
    const meshes = Array.from(this.markerMeshes.values())
    const intersects = this.raycaster.intersectObjects(meshes, true)
    if (intersects.length > 0) {
      this.renderer.domElement.style.cursor = 'pointer'
      let obj: THREE.Object3D | null = intersects[0].object
      while (obj && !obj.userData?.markerId) obj = obj.parent
      this.options.onHoverMarker?.(obj?.userData?.markerId || null)
    } else {
      this.renderer.domElement.style.cursor = 'default'
      this.options.onHoverMarker?.(null)
    }
  }

  // ── 工具方法 ─────────────────────────────────────────────

  private _sampleHeight(wx: number, wz: number): number {
    if (!this.heightGrid) return 0
    const cols = this.gridCols + 1
    const rows = this.gridRows + 1
    const gx = wx / this.gridStepX
    const gz = wz / this.gridStepZ
    const x0 = Math.max(0, Math.min(cols - 2, Math.floor(gx)))
    const z0 = Math.max(0, Math.min(rows - 2, Math.floor(gz)))
    const fx = gx - x0, fz = gz - z0
    const h00 = this.heightGrid[z0 * cols + x0]
    const h10 = this.heightGrid[z0 * cols + x0 + 1]
    const h01 = this.heightGrid[(z0 + 1) * cols + x0]
    const h11 = this.heightGrid[(z0 + 1) * cols + x0 + 1]
    return h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz
  }

  private _pointInPolygon(px: number, py: number, poly: Point2D[]): boolean {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j]
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }

  private _createTextSprite(text: string, opts: {
    fontSize: number; color: string; bgColor: string
  }): THREE.Sprite {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const fs = opts.fontSize * 2
    ctx.font = `bold ${fs}px "serif"`
    const tw = ctx.measureText(text).width + 16
    const th = fs * 1.5
    canvas.width = Math.ceil(tw)
    canvas.height = Math.ceil(th)

    if (opts.bgColor !== 'transparent') {
      ctx.fillStyle = opts.bgColor
      ctx.beginPath()
      ctx.roundRect(0, 0, canvas.width, canvas.height, 6)
      ctx.fill()
    }
    ctx.font = `bold ${fs}px "serif"`
    ctx.fillStyle = opts.color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // 文字描边增加可读性
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.lineWidth = 3
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2)
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)

    const tex = new THREE.CanvasTexture(canvas)
    tex.minFilter = THREE.LinearFilter
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false })
    return new THREE.Sprite(mat)
  }

}
