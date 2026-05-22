/**
 * Azgaar Fantasy Map Generator 桥接层
 * 通过同源 iframe 的 contentWindow 访问 FMG 内部数据和功能
 */

import type { WorldMapData, MapMarker } from '../types/world-map'

/** FMG 内部的 burg（城镇）类型 */
interface FMGBurg {
  i: number
  name: string
  cell: number
  x: number
  y: number
  state: number
  capital: number // 0 or 1
  port: number
  population: number
  removed?: boolean
}

/** FMG 内部的 state（国家）类型 */
interface FMGState {
  i: number
  name: string
  color: string
  removed?: boolean
}

/** FMG 内部的 river 类型 */
interface FMGRiver {
  i: number
  name: string
  mouth: number
  source: number
  removed?: boolean
}

/** 桥接器：连接 StoryForge 和 Azgaar FMG iframe */
export class AzgaarBridge {
  private iframe: HTMLIFrameElement | null = null
  private _ready = false
  private _readyPromise: Promise<void> | null = null
  private _readyResolve: (() => void) | null = null

  /** 绑定到 iframe 元素（监听 load 事件后轮询） */
  attach(iframe: HTMLIFrameElement) {
    this.iframe = iframe
    this._ready = false
    this._readyPromise = new Promise((resolve) => {
      this._readyResolve = resolve
    })

    // 监听 FMG 加载完成
    iframe.addEventListener('load', () => {
      this._pollForReady()
    })
  }

  /** 直接绑定（FMG 已确认就绪时调用） */
  attachDirect(iframe: HTMLIFrameElement) {
    this.iframe = iframe
    this._ready = true
    this._readyPromise = Promise.resolve()
  }

  /** 轮询检测 FMG 是否初始化完毕 */
  private _pollForReady() {
    let attempts = 0
    const maxAttempts = 60 // 最多等 30 秒

    const check = () => {
      attempts++
      const win = this._getWindow()
      if (!win) return

      try {
        // FMG 在初始化完成后会设置 pack 对象
        const pack = (win as any).pack
        if (pack && pack.cells && pack.states) {
          this._ready = true
          this._readyResolve?.()
          console.log('[AzgaarBridge] FMG 初始化完成')
          // 确保图层被绘制（修复 defer 脚本顺序问题）
          this._ensureLayersDrawn()
          return
        }
      } catch {
        // 跨域或未加载，继续等待
      }

      if (attempts < maxAttempts) {
        setTimeout(check, 500)
      } else {
        console.warn('[AzgaarBridge] FMG 初始化超时')
      }
    }

    check()
  }

  /** 等待 FMG 准备就绪 */
  async waitReady(): Promise<boolean> {
    if (this._ready) return true
    if (!this._readyPromise) return false

    // 带超时的等待
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 30000)
    )

    try {
      await Promise.race([this._readyPromise, timeout])
      return true
    } catch {
      return false
    }
  }

  /** 获取 iframe 的 window 对象 */
  private _getWindow(): Window | null {
    try {
      return this.iframe?.contentWindow || null
    } catch {
      return null
    }
  }

  /** 检查 FMG 是否已加载并可用 */
  get isReady(): boolean {
    return this._ready
  }

  /** 确保 FMG 图层被正确绘制 */
  private _ensureLayersDrawn() {
    const win = this._getWindow()
    if (!win) return
    try {
      // 逐个调用安全的图层渲染函数（跳过可能出错的 drawFeatures）
      const safeDrawFns = [
        'drawRivers', 'drawReliefIcons', 'drawStates', 'drawBorders',
        'drawRoutes', 'drawLabels', 'drawBurgIcons', 'drawMarkers',
        'drawBiomes', 'drawIce',
      ]
      for (const fn of safeDrawFns) {
        if (typeof (win as any)[fn] === 'function') {
          try { (win as any)[fn]() } catch { /* 跳过 */ }
        }
      }
      // drawFeatures 可能因为 let 变量作用域问题出错，单独 try
      try { (win as any).drawFeatures?.() } catch { /* 忽略 */ }
    } catch { /* 忽略 */ }
  }

  // ──────────────────────── 读取 FMG 数据 ────────────────────────

  /** 获取所有国家/势力 */
  getStates(): FMGState[] {
    const win = this._getWindow()
    if (!win) return []
    try {
      const states = (win as any).pack?.states as FMGState[] | undefined
      return states?.filter(s => s.i !== 0 && !s.removed) || [] // index 0 是 "Neutrals"
    } catch {
      return []
    }
  }

  /** 获取所有城镇 */
  getBurgs(): FMGBurg[] {
    const win = this._getWindow()
    if (!win) return []
    try {
      const burgs = (win as any).pack?.burgs as FMGBurg[] | undefined
      return burgs?.filter(b => b.i !== 0 && !b.removed) || [] // index 0 是占位
    } catch {
      return []
    }
  }

  /** 获取所有河流 */
  getRivers(): FMGRiver[] {
    const win = this._getWindow()
    if (!win) return []
    try {
      const rivers = (win as any).pack?.rivers as FMGRiver[] | undefined
      return rivers?.filter(r => r.i !== 0 && !r.removed) || []
    } catch {
      return []
    }
  }

  /** 获取当前地图的 seed */
  getSeed(): string | null {
    const win = this._getWindow()
    if (!win) return null
    try {
      return String((win as any).seed || '')
    } catch {
      return null
    }
  }

  /** 获取地图画布尺寸 */
  getMapSize(): { width: number; height: number } | null {
    const win = this._getWindow()
    if (!win) return null
    try {
      const graphWidth = (win as any).graphWidth
      const graphHeight = (win as any).graphHeight
      if (graphWidth && graphHeight) {
        return { width: graphWidth, height: graphHeight }
      }
    } catch { /* ignore */ }
    return null
  }

  // ──────────────────────── 修改 FMG 数据 ────────────────────────

  /** 重命名一个国家 */
  renameState(stateIndex: number, newName: string): boolean {
    const win = this._getWindow()
    if (!win) return false
    try {
      const states = (win as any).pack?.states
      if (states && states[stateIndex]) {
        states[stateIndex].name = newName
        // 触发 FMG 的 UI 更新
        this._refreshLabels()
        return true
      }
    } catch { /* ignore */ }
    return false
  }

  /** 重命名一个城镇 */
  renameBurg(burgIndex: number, newName: string): boolean {
    const win = this._getWindow()
    if (!win) return false
    try {
      const burgs = (win as any).pack?.burgs
      if (burgs && burgs[burgIndex]) {
        burgs[burgIndex].name = newName
        this._refreshLabels()
        return true
      }
    } catch { /* ignore */ }
    return false
  }

  /** 重命名一条河流 */
  renameRiver(riverIndex: number, newName: string): boolean {
    const win = this._getWindow()
    if (!win) return false
    try {
      const rivers = (win as any).pack?.rivers
      if (rivers && rivers[riverIndex]) {
        rivers[riverIndex].name = newName
        this._refreshLabels()
        return true
      }
    } catch { /* ignore */ }
    return false
  }

  /** 触发 FMG 重绘标签 */
  private _refreshLabels() {
    const win = this._getWindow()
    if (!win) return
    try {
      // FMG 的内部函数：drawLabels / drawBurgLabels
      const doc = win.document
      // 刷新国家标签
      const stateLabels = doc.getElementById('labels')
      if (stateLabels) {
        const drawLabels = (win as any).drawLabels
        if (typeof drawLabels === 'function') drawLabels()
      }
      // 刷新城镇标签
      const burgLabels = doc.getElementById('burgLabels')
      if (burgLabels) {
        const drawBurgLabels = (win as any).drawBurgLabels
        if (typeof drawBurgLabels === 'function') drawBurgLabels()
      }
    } catch {
      console.warn('[AzgaarBridge] 刷新标签失败，可能需要手动刷新地图')
    }
  }

  // ──────────────────────── 同步：WorldMapData → FMG ────────────

  /**
   * 将 StoryForge 的 WorldMapData 同步到 FMG
   * 策略：按名称匹配 + 按位置最近匹配，然后重命名
   */
  syncFromWorldMapData(data: WorldMapData): {
    statesRenamed: number
    burgsRenamed: number
    riversRenamed: number
  } {
    const result = { statesRenamed: 0, burgsRenamed: 0, riversRenamed: 0 }

    // 1. 同步国家名 — 从 markers 中提取势力名
    const factions = new Set<string>()
    for (const m of data.markers) {
      if (m.faction) factions.add(m.faction)
    }
    const factionNames = [...factions]
    const fmgStates = this.getStates()
    for (let i = 0; i < Math.min(factionNames.length, fmgStates.length); i++) {
      if (this.renameState(fmgStates[i].i, factionNames[i])) {
        result.statesRenamed++
      }
    }

    // 2. 同步城市名 — 按重要度排序后依次匹配
    const sortedMarkers = [...data.markers].sort((a, b) => b.importance - a.importance)
    const fmgBurgs = this.getBurgs()
    // 按人口排序 FMG 城镇
    const sortedBurgs = [...fmgBurgs].sort((a, b) => b.population - a.population)
    for (let i = 0; i < Math.min(sortedMarkers.length, sortedBurgs.length); i++) {
      if (this.renameBurg(sortedBurgs[i].i, sortedMarkers[i].name)) {
        result.burgsRenamed++
      }
    }

    // 3. 同步河流名
    const fmgRivers = this.getRivers()
    for (let i = 0; i < Math.min(data.rivers.length, fmgRivers.length); i++) {
      if (this.renameRiver(fmgRivers[i].i, data.rivers[i].name)) {
        result.riversRenamed++
      }
    }

    return result
  }

  // ──────────────────────── FMG → WorldMapData（反向同步）────────

  /**
   * 从 FMG 提取标记点数据，合并到 WorldMapData
   */
  extractMarkers(): MapMarker[] {
    const burgs = this.getBurgs()
    const states = this.getStates()
    const stateMap = new Map<number, string>()
    for (const s of states) {
      stateMap.set(s.i, s.name)
    }

    return burgs.map(b => ({
      id: `fmg-burg-${b.i}`,
      name: b.name,
      x: b.x,
      y: b.y,
      type: b.capital ? 'capital' as const : b.port ? 'port' as const : 'city' as const,
      faction: stateMap.get(b.state),
      importance: b.capital ? 5 : b.population > 50 ? 4 : b.population > 20 ? 3 : 2,
      userAdded: false,
    }))
  }

  // ──────────────────────── 生成新地图 ────────────────────────

  /** 用指定 seed 重新生成地图 */
  regenerate(seed?: string): boolean {
    const win = this._getWindow()
    if (!win) return false
    try {
      if (seed) {
        (win as any).seed = seed
      }
      const generate = (win as any).generate
      if (typeof generate === 'function') {
        this._ready = false
        this._readyPromise = new Promise((resolve) => {
          this._readyResolve = resolve
        })
        generate()
        // 重新等待初始化
        this._pollForReady()
        return true
      }
    } catch { /* ignore */ }
    return false
  }

  /** 导出地图为 SVG 字符串 */
  exportSVG(): string | null {
    const win = this._getWindow()
    if (!win) return null
    try {
      const svg = win.document.getElementById('map')
      if (svg) {
        return svg.outerHTML
      }
    } catch { /* ignore */ }
    return null
  }

  /** 断开连接 */
  detach() {
    this.iframe = null
    this._ready = false
    this._readyPromise = null
    this._readyResolve = null
  }
}
