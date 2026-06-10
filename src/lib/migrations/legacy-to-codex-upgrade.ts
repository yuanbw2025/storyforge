/**
 * DB v29 升级迁移 — 旧 `itemSystems` / `factions` 表彻底并入词条后删除
 * ------------------------------------------------------------
 * 在 Dexie 版本升级事务内运行(schema v29 的 .upgrade()):
 *   · 道具(itemSystems) → 「人工器物」(artifact)词条 + 体系总述并入 worldview.itemDesign
 *   · 势力(factions)    → 「势力」(faction)词条(含 mapRegion/color 地图绑定字段)
 * 迁移完成后,v29 的 stores 把这两张表置 null 删除。
 *
 * 关键:在同一升级事务内"先迁移后删",即便用户从未在 C1/C2 上线后打开过 app
 * (数据仍躺在旧表),升级时也会先搬进词条再删表,零丢失。
 *
 * 纯事务实现(只用 tx.table(...),不依赖 store / 全局 db),可在 Dexie upgrade 与单测中复用。
 */
import { BUILTIN_CATEGORIES, stringifyFieldSchema } from '../types/codex'

/** 最小化的旧数据形状(只取迁移需要的字段) */
interface LegacyItem {
  name?: string; type?: string; rank?: string; description?: string
  abilities?: string; origin?: string; owner?: string; significance?: string
}
interface LegacyFaction {
  id?: number; projectId: number; name?: string; description?: string
  leader?: string; members?: string; goals?: string; resources?: string
  relationships?: string; mapRegion?: string; color?: string
}

const ITEM_TYPE_LABEL: Record<string, string> = {
  weapon: '武器', armor: '防具', artifact: '法器', pill: '丹药',
  material: '材料', manual: '功法秘籍', formation: '阵法', special: '其他', other: '其他',
}

/** 在事务内找到(或按内置 seed 创建)某项目的指定内置分类,返回其 id */
async function ensureCategory(tx: any, projectId: number, builtInKey: string): Promise<number | null> {
  const cats = await tx.table('codexCategories').where('projectId').equals(projectId).toArray()
  const found = cats.filter((c: any) => c.builtInKey === builtInKey).sort((a: any, b: any) => (a.id ?? 0) - (b.id ?? 0))[0]
  if (found) return found.id
  const seed = BUILTIN_CATEGORIES.find(s => s.builtInKey === builtInKey)
  if (!seed) return null
  const ts = Date.now()
  const id = await tx.table('codexCategories').add({
    projectId, domain: seed.domain, parentId: null, name: seed.name, icon: seed.icon,
    builtInKey: seed.builtInKey, fieldSchema: stringifyFieldSchema(seed.fields),
    hidden: false, order: cats.length, worldGroupId: null, createdAt: ts, updatedAt: ts,
  })
  return id as number
}

async function existingEntryNames(tx: any, projectId: number, categoryId: number): Promise<Set<string>> {
  const entries = await tx.table('codexEntries').where('projectId').equals(projectId).toArray()
  return new Set(entries.filter((e: any) => e.categoryId === categoryId).map((e: any) => e.name))
}

/** 把一组道具写入某项目的「人工器物」词条(幂等·按名去重) */
async function addArtifactItems(api: any, projectId: number, items: LegacyItem[]): Promise<void> {
  if (!items.length) return
  const catId = await ensureCategory(api, projectId, 'artifact')
  if (catId == null) return
  const names = await existingEntryNames(api, projectId, catId)
  let order = names.size
  const ts = Date.now()
  for (const it of items) {
    const name = (it.name || '').trim()
    if (!name || names.has(name)) continue
    await api.table('codexEntries').add({
      projectId, categoryId: catId, name,
      summary: it.significance || '', description: it.description || '',
      fields: JSON.stringify({
        type: ITEM_TYPE_LABEL[it.type || ''] ?? '其他', rank: it.rank || '',
        effect: it.abilities || '', origin: it.origin || '', owner: it.owner || '',
      }),
      order: order++, worldGroupId: null, createdAt: ts, updatedAt: ts,
    })
    names.add(name)
  }
}

/** 把体系总述并入某项目世界观的 itemDesign(包含判断防重复追加) */
async function appendItemDesign(api: any, projectId: number, overview: string): Promise<void> {
  if (!overview) return
  const wv = (await api.table('worldviews').where('projectId').equals(projectId).toArray())[0]
  if (!wv) return
  const cur = wv.itemDesign || ''
  if (cur.includes(overview)) return
  await api.table('worldviews').update(wv.id, { itemDesign: cur ? `${cur}\n\n${overview}` : overview, updatedAt: Date.now() })
}

/** 把一组势力写入某项目的「势力」词条(幂等·按名去重) */
async function addFactionItems(api: any, projectId: number, factions: LegacyFaction[]): Promise<void> {
  if (!factions.length) return
  const catId = await ensureCategory(api, projectId, 'faction')
  if (catId == null) return
  const names = await existingEntryNames(api, projectId, catId)
  let order = names.size
  const ts = Date.now()
  for (const f of factions) {
    const name = (f.name || '').trim()
    if (!name || names.has(name)) continue
    await api.table('codexEntries').add({
      projectId, categoryId: catId, name, summary: '', description: f.description || '',
      fields: JSON.stringify({
        leader: f.leader || '', coreMembers: f.members || '', goal: f.goals || '',
        relations: f.relationships || '', power: f.resources || '',
        mapRegion: f.mapRegion || '', color: f.color || '',
      }),
      order: order++, worldGroupId: null, createdAt: ts, updatedAt: ts,
    })
    names.add(name)
  }
}

/** DB v29 升级钩子:读旧表 → 并入词条(随后 v29 stores 删表) */
export async function migrateLegacyTablesToCodex(tx: any): Promise<void> {
  const itemSystems: any[] = await tx.table('itemSystems').toArray().catch(() => [])
  for (const sys of itemSystems) {
    let items: LegacyItem[] = []
    try { items = JSON.parse(sys.items || '[]') } catch { items = [] }
    await addArtifactItems(tx, sys.projectId, items)
    await appendItemDesign(tx, sys.projectId, (sys.overview || '').trim())
  }

  const factions: LegacyFaction[] = await tx.table('factions').toArray().catch(() => [])
  const byProject = new Map<number, LegacyFaction[]>()
  for (const f of factions) {
    const arr = byProject.get(f.projectId) ?? []
    arr.push(f); byProject.set(f.projectId, arr)
  }
  for (const [projectId, list] of byProject) {
    await addFactionItems(tx, projectId, list)
  }
}

/**
 * 导入路径复用:把旧版备份 JSON 里的 itemSystems / factions 数组并入新项目的词条。
 * 用全局 db 作为 api(其 .table(name) 与升级事务 tx 同接口)。
 */
export async function importLegacyArraysToCodex(
  db: any,
  projectId: number,
  legacy: { itemSystems?: any[]; factions?: LegacyFaction[] },
): Promise<void> {
  for (const sys of legacy.itemSystems ?? []) {
    let items: LegacyItem[] = []
    try { items = JSON.parse(sys.items || '[]') } catch { items = [] }
    await addArtifactItems(db, projectId, items)
    await appendItemDesign(db, projectId, (sys.overview || '').trim())
  }
  if (legacy.factions?.length) {
    await addFactionItems(db, projectId, legacy.factions)
  }
}
