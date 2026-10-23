import {
  canonicalProductProductionJsonV2,
  isSha256Hash,
} from './hash'
import {
  createProductBuildRootTerminalReceiptV1,
  type ProductBuildRootTerminalReceiptInputV1,
} from './receipts'

type JsonRecord = Record<string, unknown>

export interface ProductBuildRootBudgetEvidenceV1 {
  schema: 'storyforge.product-build-root-budget-evidence'
  version: 1
  rootTerminalReceiptHash: string
  /** Exact historical hash preimage. Its numbers are never used as DB locators. */
  budgetLedgerJson: string
}

export interface ProductBuildBudgetRunReferenceV1 {
  runId: number
  taskKey: string
  controlEpoch: number
}

function fail(message: string): never {
  throw new Error(`[product-build-root-evidence] ${message}`)
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须为对象`)
  return value as JsonRecord
}

function parseLedger(value: string): JsonRecord {
  if (typeof value !== 'string' || value.length > 32 * 1024 * 1024) fail('预算证据超出边界')
  let raw: unknown
  try { raw = JSON.parse(value) } catch { fail('预算证据 JSON 损坏') }
  const parsed = record(raw, '预算账本')
  const expected = ['schema', 'version', 'rootRunId', 'rootClaim', 'tasks', 'attempts'].sort()
  if (JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(expected)
    || parsed.schema !== 'storyforge.product-production-budget-ledger' || parsed.version !== 2
    || !Array.isArray(parsed.attempts) || parsed.attempts.length > 20_000) {
    fail('只接受完整 v2 预算账本证据')
  }
  record(parsed.tasks, 'tasks')
  return parsed
}

/**
 * Label Run identities by first appearance in a deterministic traversal.
 * Only the registered v2 locator positions are replaced. All usage, unknown
 * holds, claim data, task receipts, attempts, ordering and repeated references
 * remain in the comparison. This is a graph isomorphism check, not a summary.
 */
function normalizeLedger(value: string, controlEpoch: number) {
  const ledger = parseLedger(value)
  const identities = new Map<number, number>()
  const referenceByRun = new Map<number, ProductBuildBudgetRunReferenceV1>()
  const references: ProductBuildBudgetRunReferenceV1[] = []
  const bind = (value: unknown, taskKey: string, epoch: number): number => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1
      || !Number.isSafeInteger(epoch) || epoch < 0) fail('Run 引用或轮次无效')
    const prior = referenceByRun.get(value)
    if (prior && (prior.taskKey !== taskKey || prior.controlEpoch !== epoch)) {
      fail('同一 Run 被不同任务或轮次冒用')
    }
    if (prior) return identities.get(value)!
    const index = identities.size + 1
    identities.set(value, index)
    const reference = { runId: value, taskKey, controlEpoch: epoch }
    references.push(reference)
    referenceByRun.set(value, reference)
    return index
  }
  ledger.rootRunId = bind(ledger.rootRunId, '$root', controlEpoch)
  const tasks = record(ledger.tasks, 'tasks')
  for (const key of Object.keys(tasks).sort()) {
    const task = record(tasks[key], `tasks.${key}`)
    task.runId = bind(task.runId, key, controlEpoch)
  }
  for (const raw of ledger.attempts as unknown[]) {
    const attempt = record(raw, 'attempt')
    if (typeof attempt.taskKey !== 'string' || !attempt.taskKey) fail('attempt taskKey 无效')
    attempt.runId = bind(attempt.runId, attempt.taskKey, Number(attempt.controlEpoch))
  }
  return { json: canonicalProductProductionJsonV2(ledger), references }
}

/** Only current, registered locator positions may expand a verifier's read set. */
export function productBuildBudgetRunReferencesV1(
  budgetLedgerJson: string,
  controlEpoch: number,
): ProductBuildBudgetRunReferenceV1[] {
  return normalizeLedger(budgetLedgerJson, controlEpoch).references
}

export function parseProductBuildRootBudgetEvidenceV1(value: string): ProductBuildRootBudgetEvidenceV1 {
  if (typeof value !== 'string' || value.length > 64 * 1024 * 1024) fail('封存证据超出边界')
  let raw: unknown
  try { raw = JSON.parse(value) } catch { fail('封存证据 JSON 损坏') }
  const evidence = record(raw, '封存证据')
  if (JSON.stringify(Object.keys(evidence).sort()) !== JSON.stringify([
    'budgetLedgerJson', 'rootTerminalReceiptHash', 'schema', 'version',
  ]) || evidence.schema !== 'storyforge.product-build-root-budget-evidence'
    || evidence.version !== 1 || !isSha256Hash(evidence.rootTerminalReceiptHash)
    || typeof evidence.budgetLedgerJson !== 'string'
    || canonicalProductProductionJsonV2(evidence) !== value) fail('封存证据合同无效')
  parseLedger(evidence.budgetLedgerJson)
  return evidence as unknown as ProductBuildRootBudgetEvidenceV1
}

export async function createProductBuildRootBudgetEvidenceV1(
  input: ProductBuildRootTerminalReceiptInputV1 & { expectedReceiptHash: string },
): Promise<string> {
  normalizeLedger(input.budgetLedgerJson, input.controlEpoch)
  if (!isSha256Hash(input.expectedReceiptHash)
    || await createProductBuildRootTerminalReceiptV1(input) !== input.expectedReceiptHash) {
    fail('原始完整 v2 root seal 不匹配，不能补造证据')
  }
  return canonicalProductProductionJsonV2({
    schema: 'storyforge.product-build-root-budget-evidence',
    version: 1,
    rootTerminalReceiptHash: input.expectedReceiptHash,
    budgetLedgerJson: canonicalProductProductionJsonV2(JSON.parse(input.budgetLedgerJson)),
  } satisfies ProductBuildRootBudgetEvidenceV1)
}

/**
 * The caller must verify these current-scope Run references before using the
 * returned root authority. Historical numbers stay confined to the preimage.
 */
export async function verifyProductBuildRootBudgetEvidenceV1(
  input: ProductBuildRootTerminalReceiptInputV1 & {
    expectedReceiptHash: string
    evidenceJson: string
    verifyCurrentRun: (reference: ProductBuildBudgetRunReferenceV1) => Promise<void>
  },
): Promise<void> {
  const evidence = parseProductBuildRootBudgetEvidenceV1(input.evidenceJson)
  if (evidence.rootTerminalReceiptHash !== input.expectedReceiptHash
    || await createProductBuildRootTerminalReceiptV1({
      ...input, budgetLedgerJson: evidence.budgetLedgerJson,
    }) !== input.expectedReceiptHash) fail('原始 root seal 与完整 Artifact 包络不闭合')
  const original = normalizeLedger(evidence.budgetLedgerJson, input.controlEpoch)
  const current = normalizeLedger(input.budgetLedgerJson, input.controlEpoch)
  if (original.json !== current.json) fail('预算账本除本地 Run 定位外发生变化')
  for (const reference of current.references) await input.verifyCurrentRun(reference)
}
