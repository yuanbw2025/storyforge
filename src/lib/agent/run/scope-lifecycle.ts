import { db } from '../../db/schema'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from '../../registry/project-tables'
import { parseAgentRunContract } from './contract'

const retained = '无法删除：选中内容仍被运行历史引用。已保留全部内容和运行记录，请先导出完整备份；当前不支持解除该历史引用。'
const unverifiable = '无法核验运行历史引用，删除未执行。原内容和运行记录已保留，请先核对备份与运行记录。'

/** Caller-owned deletion transaction also locks the registered run/event tables.
 * Inspect the whole batch once; never rewrite contracts, erase events, or weaken
 * the backup mapper to make a dangling reference appear portable. */
export async function assertRetainedRunScopeTargetsV1(
  targets: ReadonlyMap<string, readonly number[]>,
): Promise<void> {
  for (const spec of PROJECT_TABLES) {
    const portable = spec.portableData
    if (portable?.kind !== 'agent-run-root') continue
    const refs = (portable.retainedScopeTargets ?? [])
      .filter(ref => (targets.get(ref.table)?.length ?? 0) > 0)
    if (!refs.length) continue
    const projects = new Set<number>()
    for (const ref of refs) {
      const source = REGISTRY_BY_NAME.get(ref.table)
      if (!source || !portable.dependencies.includes(ref.table)) throw new Error(unverifiable)
      for (const row of await source.table.bulkGet([...targets.get(ref.table)!])) {
        if (!row) continue
        if (!Number.isSafeInteger(row.projectId)) throw new Error(unverifiable)
        projects.add(row.projectId)
      }
    }
    if (!projects.size) continue
    const runs = await spec.table.where('projectId').anyOf([...projects]).toArray()
    if (!runs.length) continue
    const idSets = refs.map(ref => ({ ...ref, ids: new Set(targets.get(ref.table)) }))
    const inspected = new Set<string>()
    const inspect = (value: unknown) => {
      if (typeof value !== 'string') throw new Error(unverifiable)
      if (inspected.has(value)) return
      let contract
      try { contract = parseAgentRunContract(JSON.parse(value)) }
      catch { throw new Error(unverifiable) }
      if (idSets.some(ref => contract.scope[ref.scopeField]?.some(id => ref.ids.has(id)))) {
        throw new Error(retained)
      }
      inspected.add(value)
    }
    const byId = new Map(runs.map(run => [run.id, run]))
    for (const run of runs) inspect(run[portable.contractField])
    // A revised run's latest scope may no longer contain an earlier target.
    // The exporter still maps every accepted/revised generation, so retain all.
    for (const event of await db.agentRunEvents.where('runId').anyOf([...byId.keys()]).toArray()) {
      if (event.type !== 'contract.accepted' && event.type !== 'contract.revised') continue
      let payload
      try { payload = JSON.parse(event.payloadJson) }
      catch { throw new Error(unverifiable) }
      const run = byId.get(event.runId)!
      inspect(payload?.contractJson
        ?? (event.type === 'contract.accepted' && run.generation === 1 ? run[portable.contractField] : null))
    }
  }
}
