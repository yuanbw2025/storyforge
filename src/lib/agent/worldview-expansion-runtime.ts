import { freezeWorldviewExpansionBaseV1, freezeWorldviewExpansionAuthorizationV1,
  materializeWorldviewExpansionV1 } from './worldview-expansion-contract'
import { parseWorldviewFieldCandidateDraftV2, type WorldviewFieldCopilotSnapshot } from './worldview-field-copilot'
import type { WorldviewFieldRootV2 } from './worldview-field-v2-contract'
import { sha256Text } from '../ai/chapter-memory/text-normalization'

/** Only new expand runs opt in. Older frozen roots keep their original codec. */
export function readWorldviewCandidateV2(root: WorldviewFieldRootV2, draft: string) {
  return parseWorldviewFieldCandidateDraftV2(draft, { preserveText: root.expansionPolicy === 'retain-original-v1' })
}

export async function freezeWorldviewExpansionRuntimeV1(root: WorldviewFieldRootV2, snapshot: WorldviewFieldCopilotSnapshot) {
  if (root.expansionPolicy !== 'retain-original-v1' || root.operation !== 'expand' || snapshot.id == null) {
    throw new Error('扩写增补缺少原运行与已冻结原文。')
  }
  // Pure protocol bounds only. Actual complete messages, anchors and output
  // go through the existing routed-model preflight; no character/token cap,
  // truncation, baseline compression or extra model call is introduced here.
  const bound = Number.MAX_SAFE_INTEGER
  const base = freezeWorldviewExpansionBaseV1({
    scope: { ...root.scope, worldGroupId: root.worldGroupId },
    source: { recordId: snapshot.id, serializedSnapshotHash: await sha256Text(snapshot.serialized) },
    field: root.task.targetField, value: snapshot.values[root.task.targetField],
    limits: { maxRawUtf16: bound, maxOperations: bound, maxResultUtf16: bound, maxLeafUtf16: bound },
  })
  const authorization = freezeWorldviewExpansionAuthorizationV1(base, {
    mode: 'insert-only', leaves: base.leaves.map(leaf => leaf.leaf), ranges: [],
    // Protocol nonempty-addition metric only, never the author's word goal.
    // The original TaskLengthPlan/observation remains the sole length policy.
    goal: { metric: 'non-whitespace-utf16-v1', scope: 'added', distribution: 'aggregate-selected-leaves', quantity: 1 },
  })
  return { base, authorization }
}

export async function worldviewExpansionOutputContractV1(root: WorldviewFieldRootV2, snapshot: WorldviewFieldCopilotSnapshot) {
  const { base, authorization } = await freezeWorldviewExpansionRuntimeV1(root, snapshot)
  const anchors = base.leaves.map(({ leaf, segments }) => ({ leaf,
    segments: segments.map(({ id, index, from, to }) => ({ id, index, from, to })) }))
  return `本轮是保留原文的增补，不返回整段重写稿。原文仅在正式完整来源中出现，以下是各文本叶按物理行（含换行）的 UTF-16 源码位置与稳定锚点，不是字符删改许可。
只生成新段落，插在锚点 before/after；按需要在 text 内带上换行，不能复制原文、改动旧数字/禁忌、否定原事实或修改非文本开关。局部改写由作者在候选源码中明确编辑，或另选“重写”。
${JSON.stringify({ version: base.version, field: base.field, baseHash: base.baseHash, authorizationHash: authorization.authorizationHash, anchors })}
只输出严格 JSON，字段固定如下；edits 可有多个，id 唯一，同一位置用 order 指定顺序。leaf/segmentId 必须来自上面的锚点。没有 value 字段，不允许 replace/delete；必要的临时假设可另放入 temporaryAssumptions 文本数组，不属于正式设定：
${JSON.stringify({ version: base.version, field: base.field, baseHash: base.baseHash,
    authorizationHash: authorization.authorizationHash, edits: [{ id: 'addition-1', kind: 'insert',
      leaf: base.leaves[0].leaf, segmentId: base.leaves[0].segments[base.leaves[0].segments.length - 1].id, side: 'after', order: 0, text: '\n新补充的段落。' }] })}`
}

export async function parseWorldviewResponseV2(root: WorldviewFieldRootV2, snapshot: WorldviewFieldCopilotSnapshot, raw: string) {
  if (root.expansionPolicy !== 'retain-original-v1') return { candidate: parseWorldviewFieldCandidateDraftV2(raw), expansion: null }
  const { base, authorization } = await freezeWorldviewExpansionRuntimeV1(root, snapshot)
  const expansion = materializeWorldviewExpansionV1(base, authorization, raw)
  // Same registered whole-field admission after deterministic derivation.
  const candidate = readWorldviewCandidateV2(root, JSON.stringify(expansion.candidate))
  return { candidate, expansion }
}
