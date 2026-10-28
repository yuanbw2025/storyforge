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
    || !Number.isSafeInteger(parentThroughSequence) || parentThroughSequence < 0
    || parentThroughSequence > (parent.runtimeHeadSequence ?? 0)) {
    throw new Error("正式产品分支的父会话或序列不属于当前作用域。");
  }
  session.parentSessionId = parentSessionId;
  session.parentThroughSequence = parentThroughSequence;
}
