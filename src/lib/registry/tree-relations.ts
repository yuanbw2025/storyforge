import Dexie from 'dexie'
import type { TableSpec } from './types'
import type { WorkspaceScope } from '../types/world-ownership'
import { assertRecordInScope } from '../workspace/scope'

export class RegisteredTreeRelationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RegisteredTreeRelationError'
  }
}

/** Validate a proposed edge against the same native write snapshot. Metadata
 * selects the parent field and scope; no component or model grants an edge. */
export async function assertRegisteredTreeParentV1(input: {
  spec: TableSpec
  scope: WorkspaceScope
  recordId?: number
  parentId: unknown
}): Promise<void> {
  if (!input.spec.tree) return
  if (!Dexie.currentTransaction || Dexie.currentTransaction.mode !== 'readwrite') {
    throw new Error('[tree] 父级校验必须与写入处于同一原生事务')
  }
  if (input.parentId == null) return
  if (typeof input.parentId !== 'number' || !Number.isSafeInteger(input.parentId) || input.parentId < 1) {
    throw new RegisteredTreeRelationError('父级必须是有效的地点或节点编号。')
  }
  const seen = new Set<number>()
  let parent: unknown = input.parentId
  while (parent != null) {
    if (typeof parent !== 'number' || !Number.isSafeInteger(parent) || parent < 1) {
      throw new RegisteredTreeRelationError('父链含无效编号，请先修复层级。')
    }
    if (parent === input.recordId) {
      throw new RegisteredTreeRelationError('层级不能指向自身或子地点，请选择其他上级。')
    }
    if (seen.has(parent)) {
      throw new RegisteredTreeRelationError('父链已有循环，请先修复层级。')
    }
    seen.add(parent)
    const row = await input.spec.table.get(parent) as Record<string, unknown> | undefined
    if (!row || !await assertRecordInScope(input.scope, input.spec.name, row)) {
      throw new RegisteredTreeRelationError('父级不存在或不属于当前作品或世界。')
    }
    parent = row[input.spec.tree.parentField]
  }
}
