import Dexie from 'dexie'

export const REQUIRED_TABLES_V26 = [
  'aiUsageLog',
  'chapters',
  'characterRelations',
  'characters',
  'codexCategories',
  'codexEntries',
  'creativeRules',
  'detailedOutlines',
  'emotionBeatCards',
  'foreshadows',
  'geographies',
  'historicalKeywords',
  'historicalTimelineEvents',
  'histories',
  'importFiles',
  'importJobs',
  'importLogs',
  'importSessions',
  'importantLocations',
  'itemLedger',
  'masterChapterBeats',
  'masterChunkAnalysis',
  'masterInsights',
  'masterStyleMetrics',
  'masterWorks',
  'notes',
  'outlineNodes',
  'powerSystems',
  'projects',
  'promptTemplates',
  'promptWorkflows',
  'referenceChunkAnalysis',
  'references',
  'snapshots',
  'stateCards',
  'storyArcs',
  'storyCores',
  'storyTimelineEvents',
  'worldGroupLinks',
  'worldGroups',
  'worldNodes',
  'worldRulesProfiles',
  'worldviews',
] as const

export interface EnsureSchemaOptions {
  /** Production must keep this false. Development may pass import.meta.env.DEV. */
  allowReset?: boolean
  /** Tests can disable browser alert while still asserting non-destructive behavior. */
  notifyUser?: boolean
}

/**
 * Schema 健康自检 + 自动恢复。
 *
 * 背景：开发期常出现"旧 session 的代码把 DB 升到一个奇怪的高版本，
 *      新代码的版本号比它低，Dexie 增量升级不会触发，新表就建不出来"
 *      的尴尬。HANDOFF §决议 7 明确：开发期无真实用户，schema 不一致时直接清库。
 *
 * 本函数在 App 启动最早期跑：
 *   1. 用原生 IndexedDB API 探测 storyforge DB 当前版本和表列表
 *   2. 若期望表全在 → 直接放行
 *   3. 若缺表 → 开发环境可删库重建;生产环境只提示,绝不自动删库
 *
 * 删库失败（被其他 tab 占住）会抛错，由调用方决定怎么提示用户。
 */
export async function ensureSchema(
  expectedTables: readonly string[],
  options: EnsureSchemaOptions = {},
): Promise<{ reset: boolean; missing: string[]; blocked: boolean }> {
  const dbName = 'storyforge'
  const { allowReset = false, notifyUser = true } = options

  // 1. 检查 DB 是否存在 + 当前 schema
  const info = await probeDatabase(dbName)
  if (info === null) {
    // DB 还不存在，让 Dexie 后续按最新定义创建
    return { reset: false, missing: [], blocked: false }
  }

  const missing = expectedTables.filter(t => !info.stores.includes(t))
  if (missing.length === 0) {
    // 全部期望表都在
    return { reset: false, missing: [], blocked: false }
  }

  if (!allowReset) {
    console.error(
      `[schema] DB v${info.version} 缺少表 [${missing.join(', ')}]。生产环境已阻止自动删库,请先导出备份后再处理。`,
    )
    if (notifyUser) notifySchemaMismatch(missing)
    return { reset: false, missing, blocked: true }
  }

  console.warn(
    `[schema] DB v${info.version} 缺少表 [${missing.join(', ')}]，开发环境自动删库重建`,
  )

  // 2. 删库
  await Dexie.delete(dbName)
  console.info('[schema] DB 已重置，下次打开时会按最新 schema 全新创建')

  return { reset: true, missing, blocked: false }
}

function notifySchemaMismatch(missing: string[]) {
  try {
    if (typeof window === 'undefined' || typeof window.alert !== 'function') return
    window.alert(
      'StoryForge 检测到本地数据库结构不完整,为保护你的小说数据,系统不会自动清空数据库。\\n\\n' +
      `缺失表:${missing.join(', ')}\\n\\n` +
      '请先导出备份,然后刷新页面或联系维护者处理。',
    )
  } catch {
    // 提示失败不能影响数据保护路径。
  }
}

/** 探测 DB：不存在返回 null，存在返回 { version, stores }。 */
function probeDatabase(name: string): Promise<{ version: number; stores: string[] } | null> {
  return new Promise((resolve, reject) => {
    let upgradeNeededFired = false
    const req = indexedDB.open(name)
    req.onsuccess = () => {
      const db = req.result
      // 如果触发了 onupgradeneeded 但版本仍是 1，说明 DB 此前不存在
      if (upgradeNeededFired) {
        const version = db.version
        const stores = [...db.objectStoreNames]
        db.close()
        // DB 是被这次 open 创建出来的，stores 必然为空 — 视为"不存在"
        if (version === 1 && stores.length === 0) {
          // 立刻清掉这个空库，让 Dexie 后面按真实 schema 创建
          indexedDB.deleteDatabase(name)
          resolve(null)
          return
        }
        resolve({ version, stores })
      } else {
        const result = { version: db.version, stores: [...db.objectStoreNames] }
        db.close()
        resolve(result)
      }
    }
    req.onerror = () => reject(req.error)
    req.onupgradeneeded = () => {
      upgradeNeededFired = true
    }
    req.onblocked = () => reject(new Error('IndexedDB 打开被阻塞，请关闭其他 storyforge tab'))
  })
}
