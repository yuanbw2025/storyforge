import { db } from '../db/schema'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from './scope'
import { assertReleaseUnchanged } from './releases'
import { createSimulationSession, type CreateSimulationSessionInput } from '../simulation/runtime'
import type { NarrativeModule, SimulationRuntimeState, SimulationSession, SimulationSessionKind, WorkspaceScope } from '../types'

export interface CreateWorldInstanceInput {
  scope: WorkspaceScope
  kind: SimulationSessionKind
  title: string
  releaseId?: number | null
  draftSnapshotHash?: string | null
  narrativeModuleId?: number | null
  canonSnapshot?: unknown
  initialState?: SimulationRuntimeState
  worldGroupId?: number | null
  seed?: string
}

export async function createWorldInstance(input: CreateWorldInstanceInput): Promise<SimulationSession> {
  const initialScope = await resolveScope({ scope: input.scope })
  if (input.releaseId == null && !input.draftSnapshotHash) {
    throw new Error('[instance] 必须绑定不可变发布版本或显式草稿快照哈希')
  }
  let release = null
  if (input.releaseId != null) {
    release = await db.worldReleases.get(input.releaseId)
    if (!release || release.projectId !== initialScope.projectId || release.worldId !== initialScope.worldId) {
      throw new Error('[instance] 发布版本不属于当前 World')
    }
    await assertReleaseUnchanged(input.releaseId)
  }
  let module: NarrativeModule | null = null
  if (input.narrativeModuleId != null) {
    module = await db.narrativeModules.get(input.narrativeModuleId) ?? null
    if (!module || !await assertRecordInScope(initialScope, 'narrativeModules', module)) {
      throw new Error('[instance] 叙事模块不属于当前 scope')
    }
  }
  const sessionInput: CreateSimulationSessionInput = {
    projectId: initialScope.projectId,
    worldGroupId: input.worldGroupId ?? null,
    kind: input.kind,
    title: input.title,
    seed: input.seed,
    canonSnapshot: input.canonSnapshot ?? (release ? JSON.parse(release.manifestJson) : { version: 2, sources: [] }),
    initialState: input.initialState,
  }
  return db.transaction('rw', scopeTransactionTables(
    db.worldGroups,
    db.simulationSessions,
    db.worldReleases,
    db.narrativeModules,
  ), async () => {
    const scope = await resolveScope({ scope: initialScope })
    if (release) {
      const current = await db.worldReleases.get(release.id!)
      if (!current || current.manifestJson !== release.manifestJson || current.contentHash !== release.contentHash) {
        throw new Error('[instance] 发布版本在实例创建过程中发生变化')
      }
    }
    if (module) {
      const current = await db.narrativeModules.get(module.id!)
      if (!current || !await assertRecordInScope(scope, 'narrativeModules', current)) {
        throw new Error('[instance] 叙事模块在实例创建过程中发生变化')
      }
    }
    const session = await createSimulationSession(sessionInput)
    const binding = {
      worldId: scope.worldId,
      workId: scope.workId,
      worldReleaseId: input.releaseId ?? null,
      narrativeModuleId: module?.id ?? null,
      draftSnapshotHash: input.draftSnapshotHash ?? null,
    }
    await db.simulationSessions.update(session.id!, binding)
    return { ...session, ...binding }
  })
}

export async function readBoundInstances(scope: WorkspaceScope): Promise<SimulationSession[]> {
  const resolved = await resolveScope({ scope })
  const rows = await db.simulationSessions.where('projectId').equals(resolved.projectId).toArray()
  return rows.filter(row => row.worldId === resolved.worldId && row.workId === resolved.workId)
}

export async function assertInstanceBinding(instanceId: number, scope: WorkspaceScope): Promise<SimulationSession> {
  const resolved = await resolveScope({ scope })
  const session = await db.simulationSessions.get(instanceId)
  if (!session || session.projectId !== resolved.projectId || session.worldId !== resolved.worldId || session.workId !== resolved.workId) {
    throw new Error('[instance] 实例不属于当前 World/Work')
  }
  if (session.worldReleaseId != null) await assertReleaseUnchanged(session.worldReleaseId)
  if (session.narrativeModuleId != null) {
    const module = await db.narrativeModules.get(session.narrativeModuleId)
    if (!module || !await assertRecordInScope(resolved, 'narrativeModules', module)) throw new Error('[instance] 实例叙事来源越界')
  }
  return session
}
