import Dexie from 'dexie'
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { assertProductProductionBudgetLedgerV1 } from '../product-production/scheduler'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { avgHash } from './protocol-validation'
import { assertAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import type { AvgVoiceSpeechRequestV1 } from './voice-request-contract'

interface VoiceClaim {
  buildId: number; controlEpoch: number; taskKey: string; runId: number; attempt: number; idempotencyKey: string
}
interface LedgerProjection {
  version: 2
  tasks: Record<string, { runId: number; attempt: number; status: 'claimed' | 'settled' | 'failed';
    idempotencyKey: string; errorCode: string | null }>
  attempts: Array<{ taskKey: string; runId: number; attempt: number; usageKnown: boolean; errorCode: string | null; resolution?: string }>
}

function fail(detail: string): never { throw new Error(`[avg-voice] ${detail}`) }
const wireKey = (request: AvgVoiceSpeechRequestV1) => `${request.endpointRouteHash}:${request.requestBodyHash}`
const isUnknownResult = (code: string | null) => code?.includes('result-unknown') === true || code?.includes('unknown-result') === true

/** A bounded lease around pure hashing/decoding only. Database reads below
 * remain in a command caller's original transaction when one exists. */
function pure<T>(read: () => Promise<T>): PromiseLike<T> {
  return Dexie.currentTransaction ? Dexie.waitFor(Dexie.ignoreTransaction(read), 20_000) : read()
}

/** Read-only deny guard, never a dispatch, retry, charge or adoption grant.
 * Match actual request bytes and endpoint route across every AVG Build owned
 * by this Work, including other production roots and imported histories.
 * Cost reconciliation alone cannot establish a previously unknown result.
 */
export async function assertAvgNoUnresolvedVoiceRequestsV1(input: {
  scope: WorkspaceScope; requests: readonly AvgVoiceSpeechRequestV1[]; ownClaim?: VoiceClaim
}): Promise<void> {
  const requested = await pure(async () => {
    if (input.requests.length < 1 || input.requests.length > 8) fail('防重发校验缺少准确的有限配音请求')
    for (const request of input.requests) {
      avgHash(request.endpointRouteHash, 'voice safety route')
      avgHash(request.requestBodyHash, 'voice safety body')
      if (await sha256Text(request.requestBodyJson) !== request.requestBodyHash) fail('防重发校验的准确请求字节已变化')
    }
    return new Set(input.requests.map(wireKey))
  })
  const productions = await db.productProductions.where('workId').equals(input.scope.workId).toArray()
  const productionIds = new Set(productions.map(production => production.id))
  const avgIds = new Set<number>()
  for (const production of productions) if (production.productType === 'avg') {
    if (!production.id || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) fail('历史配音制作记录跨作品或损坏')
    avgIds.add(production.id)
  }
  const builds = await db.productBuilds.where('workId').equals(input.scope.workId).toArray()
  for (const build of builds) {
    if (!productionIds.has(build.productionId)) fail('历史制作版本缺少所属制作根，不能忽略原调用记录')
    if (!avgIds.has(build.productionId)) continue
    if (!build.id || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })) fail('历史配音制作版本跨作品或损坏')
    const row = await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first()
    if (!row || !await assertRecordInScope(input.scope, 'productProductionBriefs', row, { owner: 'work' })
      || !['authorized', 'superseded'].includes(row.status) || row.briefHash !== build.briefHash) fail('历史配音缺少准确的已授权方案，不能推断可以重发')
    const brief = parseProductProductionBriefV3(row.briefJson)
    if (brief.avgAssembly?.version !== 3) continue
    const stored = brief.avgAssembly
    const history = await pure(async () => {
      if (await hashProductProductionValueV2(brief) !== build.briefHash) fail('历史配音方案 hash 已损坏，不能忽略调用记录')
      return assertAvgStoredAssemblyBriefV3(stored)
    })
    if (build.budgetLedgerJson === '{}' && build.planRevision === 0 && build.startedAt === null) continue
    assertProductProductionBudgetLedgerV1(build.budgetLedgerJson)
    const ledger = JSON.parse(build.budgetLedgerJson) as LedgerProjection
    if (ledger.version !== 2) fail('历史配音调用账本缺失或版本不可验证')
    const requests = new Map(history.requests.map(request => [`avg.voice.generate.${request.requirementKey}`, request]))
    const blocked = (taskKey: string): never => fail(`制作版本 ${build.buildNumber} 的相同配音请求仍有未知结果或未完成领取；请先对账或恢复原结果，不能改名或新建版本重发（${taskKey}）`)
    const matches = (taskKey: string) => {
      const request = requests.get(taskKey)
      if (!request) fail('历史配音调用无法对应准确请求，不能推断可以重发')
      return requested.has(wireKey(request))
    }
    for (const attempt of ledger.attempts) {
      if (attempt.taskKey.startsWith('avg.voice.generate.')
        && (!attempt.usageKnown || isUnknownResult(attempt.errorCode) || attempt.resolution?.startsWith('author-'))
        && matches(attempt.taskKey)) blocked(attempt.taskKey)
    }
    for (const [taskKey, task] of Object.entries(ledger.tasks)) {
      if (!taskKey.startsWith('avg.voice.generate.') || !matches(taskKey)) continue
      const own = input.ownClaim
      if (task.status === 'claimed' && own && own.buildId === build.id && own.controlEpoch === build.controlEpoch
        && own.taskKey === taskKey && own.runId === task.runId && own.attempt === task.attempt
        && own.idempotencyKey === task.idempotencyKey) continue
      if (task.status === 'claimed' || isUnknownResult(task.errorCode)) blocked(taskKey)
      if (!ledger.attempts.some(attempt => attempt.taskKey === taskKey && attempt.runId === task.runId && attempt.attempt === task.attempt)) {
        fail('历史配音缺少准确的终态调用记账，不能推断可以重发')
      }
    }
  }
}
