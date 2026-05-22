import Dexie from 'dexie'

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
 *   3. 若缺表 → 删库（保证下一次 Dexie 打开时按当前代码定义的最新版本全新创建）
 *      然后返回 true 通知调用方"已重置，需要重新初始化"
 *
 * 删库失败（被其他 tab 占住）会抛错，由调用方决定怎么提示用户。
 */
export async function ensureSchema(expectedTables: string[]): Promise<{ reset: boolean; missing: string[] }> {
  const dbName = 'storyforge'

  // 1. 检查 DB 是否存在 + 当前 schema
  const info = await probeDatabase(dbName)
  if (info === null) {
    // DB 还不存在，让 Dexie 后续按最新定义创建
    return { reset: false, missing: [] }
  }

  const missing = expectedTables.filter(t => !info.stores.includes(t))
  if (missing.length === 0) {
    // 全部期望表都在
    return { reset: false, missing: [] }
  }

  console.warn(
    `[schema] DB v${info.version} 缺少表 [${missing.join(', ')}]，自动删库重建（开发期无真实用户）`,
  )

  // 2. 删库
  await Dexie.delete(dbName)
  console.info('[schema] DB 已重置，下次打开时会按最新 schema 全新创建')

  return { reset: true, missing }
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
