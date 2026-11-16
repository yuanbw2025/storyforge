import { db } from '../db/schema'
import type { ProductRuntimeSession } from '../types'

/** Bind only a verified same-owner parent prefix to a prepared session. */
export async function bindPreparedProductRuntimeBranchLineageV1(
  session: ProductRuntimeSession, origin: "release" | "preview" | "branch",
  lineage?: { parentSessionId: number; parentThroughSequence: number },
): Promise<void> {
  if (!lineage) return;
  const { parentSessionId, parentThroughSequence } = lineage;
  const parent = Number.isSafeInteger(parentSessionId) && parentSessionId > 0
    ? await db.productRuntimeSessions.get(parentSessionId) : null;
  if (origin !== "branch" || !parent || parent.projectId !== session.projectId
    || parent.worldId !== session.worldId || parent.workId !== session.workId || parent.kind !== session.kind
    || !Number.isSafeInteger(parentThroughSequence) || parentThroughSequence < 0) {
    throw new Error("正式产品分支的父会话或序列不属于当前作用域。");
  }
  // A missing, stale, or oversized head cache cannot authorize a branch cut.
  // Only this parent's actual indexed events establish its sequence boundary.
  const latest = (await db.productRuntimeEvents
    .where('[sessionId+sequence]')
    .between([parentSessionId, 0], [parentSessionId, Number.MAX_SAFE_INTEGER], true, true)
    .last())?.sequence ?? 0;
  if (!Number.isSafeInteger(latest) || latest < 0 || parentThroughSequence > latest) {
    throw new Error("正式产品分支的父会话或序列不属于当前作用域。");
  }
  session.parentSessionId = parentSessionId;
  session.parentThroughSequence = parentThroughSequence;
}
