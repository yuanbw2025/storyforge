import { create } from 'zustand'
import { db } from '../lib/db/schema'
import type { NodeFlow, NodeRunRecord } from '../lib/types'
import { parseAuthoringGraph } from '../lib/node-authoring/graph-codec'
import { emptyAuthoringGraph, safeAuthoringGraphJson } from '../lib/node-authoring/contracts'
import type { AuthoringNodeGraph } from '../lib/node-authoring/contracts'
import {
  assertRecordInScope,
  readOwnedRows,
  resolveReadScopeLike,
  resolveScopeLike,
  stampNewRecord,
  type WorkspaceScopeLike,
} from '../lib/workspace/scope'

interface NodeFlowStore {
  projectId: number | null
  flows: NodeFlow[]
  runs: NodeRunRecord[]
  loading: boolean
  load(scope: WorkspaceScopeLike): Promise<void>
  createFlow(projectId: number, worldGroupId: number | null, options?: { name?: string; description?: string; graph?: AuthoringNodeGraph }): Promise<number>
  saveFlow(flow: NodeFlow): Promise<number>
  removeFlow(flowId: number): Promise<void>
  loadRuns(scope: WorkspaceScopeLike, flowId?: number): Promise<void>
}

export const useNodeFlowStore = create<NodeFlowStore>((set, get) => ({
  projectId: null,
  flows: [],
  runs: [],
  loading: false,

  load: async scopeInput => {
    set({ loading: true })
    const scope = await resolveReadScopeLike(scopeInput)
    const flows = await readOwnedRows<NodeFlow>(scope, 'nodeFlows', { owner: 'work' })
    flows.sort((left, right) => right.updatedAt - left.updatedAt)
    set({ projectId: scope.projectId, flows, loading: false })
  },

  createFlow: async (projectId, worldGroupId, options) => {
    const scope = await resolveScopeLike(projectId)
    const now = Date.now()
    const row = stampNewRecord(scope, 'nodeFlows', {
      projectId,
      worldGroupId,
      name: options?.name ?? '未命名节点图',
      description: options?.description ?? '',
      graphJson: JSON.stringify(options?.graph ?? emptyAuthoringGraph()),
      createdAt: now,
      updatedAt: now,
    } as NodeFlow, { owner: 'work' }) as NodeFlow
    const id = await db.nodeFlows.add(row) as number
    await get().load(scope)
    return id
  },

  saveFlow: async flow => {
    // 草稿阶段允许缺少连线、必需输入或暂时存在循环；运行前会进行完整图校验。
    // 这里只验证 JSON 外壳，避免作者尚未完成的节点图无法被持久化。
    parseAuthoringGraph(flow.graphJson)
    const scope = await resolveScopeLike(flow.projectId)
    if (flow.id != null) {
      const current = await db.nodeFlows.get(flow.id)
      if (!current || !await assertRecordInScope(scope, 'nodeFlows', current, { owner: 'work' })) {
        throw new Error('节点图不存在或不属于当前作品')
      }
    }
    const now = Date.now()
    const row = stampNewRecord(scope, 'nodeFlows', {
      ...flow,
      graphJson: safeAuthoringGraphJson(flow.graphJson),
      updatedAt: now,
    }, { owner: 'work' })
    const id = await db.nodeFlows.put(row) as number
    await get().load(scope)
    return id
  },

  removeFlow: async flowId => {
    const existingRecord = await db.nodeFlows.get(flowId)
    if (!existingRecord) return
    const scope = await resolveScopeLike(existingRecord.projectId)
    const flow = await db.nodeFlows.get(flowId)
    if (!flow || !await assertRecordInScope(scope, 'nodeFlows', flow, { owner: 'work' })) return
    await db.transaction('rw', db.nodeFlows, db.nodeRuns, async () => {
      await db.nodeRuns.where('flowId').equals(flowId).delete()
      await db.nodeFlows.delete(flowId)
    })
    await get().load(scope)
  },

  loadRuns: async (scopeInput, flowId) => {
    const scope = await resolveReadScopeLike(scopeInput)
    const rows = (await readOwnedRows<NodeRunRecord>(scope, 'nodeRuns', { owner: 'work' }))
      .filter(row => flowId == null || row.flowId === flowId)
    rows.sort((left, right) => right.startedAt - left.startedAt)
    set({ runs: rows })
  },
}))
