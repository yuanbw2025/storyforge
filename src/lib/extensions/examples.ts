import { createWorkspace } from '../workspace/create-workspace'
import { createHistory } from './domain'
import { readCatalog, installFromCatalog } from './catalog'
import { activePackages, enablePackage, extensionScope, putExtensionRecord } from './store'
import type { ExtensionOwner, ExtensionPackage } from './types'

/** Called only after explicit host confirmation; creates new isolated example content. */
export async function createWorkshopExample(owner: ExtensionOwner): Promise<number> {
  const catalog = await readCatalog()
  const ids = owner === 'world' ? ['storyforge.world-timeline'] : ['storyforge.writer-kit', 'storyforge.story-board', 'storyforge.plot-flow', 'storyforge.research-desk']
  const packages: ExtensionPackage[] = []
  for (const id of ids) {
    const entry = catalog.entries.find(entry => entry.id === id)
    if (!entry) throw new Error(`官方参考目录缺少 ${id}`)
    const installed = await installFromCatalog(entry, catalog)
    packages.push(installed.find(pkg => pkg.pluginId === id)!)
  }
  const created = await createWorkspace({ name: owner === 'world' ? '工坊体验 · 灯塔世界' : '工坊体验 · 灯塔来信', description: '', genres: [], status: 'drafting', targetWordCount: 30000 }, {purpose: owner === 'world' ? 'world-engine' : 'independent-work', kind:'novel', novelProfile:'long'})
  const scope = await extensionScope(created.project.id!, owner)
  for (const pkg of packages) await enablePackage(pkg,scope)
  const active = await activePackages(scope)
  if (owner === 'world') {
    const profile = active.find(row=>row.pkg.pluginId === 'storyforge.world-timeline')!.profile
    await createHistory(profile,{title:'第一座灯塔建成',time:'1',description:'沿岸居民共同修建灯塔，约定每年轮流守望。'})
    await createHistory(profile,{title:'雾海中的来信',time:'125',description:'守塔人在没有船只靠岸的清晨，收到一封来自旧城的信。'})
  } else {
    const notes = active.find(row=>row.pkg.pluginId === 'storyforge.writing-notes')!
    await putExtensionRecord(notes.profile, notes.pkg.manifest, {key:'main',schemaId:'note',expectedRevision:null,payload:{text:'欢迎体验独立插件。\n\n故事种子：守塔人收到一封尚未写出的来信。\n你可以修改这张便笺、试试情节流程，再停用或重装插件，检查内容是否仍在。'}})
    const board = active.find(row=>row.pkg.pluginId === 'storyforge.story-board')!.profile
    await createHistory(board,{title:'收到来信',time:'第一天',description:'主角发现信上的笔迹和自己一模一样。'})
  }
  return created.project.id!
}
