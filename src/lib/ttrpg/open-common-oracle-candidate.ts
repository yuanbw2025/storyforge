/** Independent common candidate kind; old GM candidates cannot be relabelled as common output. */
import type { TtrpgOpenOracleCandidateV1 } from './open-oracle-candidate'
import { parseTtrpgOpenOracleSemanticFieldsV1 } from './open-oracle-candidate'
import { parseStructuredOutputV1 } from '../agent/structured-output-pipeline'
import { readTtrpgOpenRuntimeCandidateV1, type TtrpgOpenCandidateReadV1 } from './open-runtime-candidate'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import type { reviewTtrpgOpenCommonOracleDeliveryV1 } from './open-common-oracle-delivery'
import { canonicalStringify as stable } from '../agent/run/hash'
import * as p from './open-contract-parse'

export interface TtrpgOpenCommonOracleCandidateV1 extends Omit<TtrpgOpenOracleCandidateV1, 'schema' | 'normalizationOf'> {
  schema: 'storyforge.ttrpg-open-common-oracle-candidate'; basisHash: string; normalizationOf?: never;
}
export function parseTtrpgOpenCommonOracleSemanticCandidateV1(output: string, delivered: Awaited<ReturnType<typeof reviewTtrpgOpenCommonOracleDeliveryV1>>) {
  const { contract, packet } = delivered
  p.literal(contract.schema, 'storyforge.ttrpg-open-common-oracle-contract', 'common Oracle contract schema')
  p.literal(packet.schema, 'storyforge.ttrpg-open-common-oracle-input', 'common Oracle packet schema')
  p.oneOf(packet.audience, ['public', 'party'], 'common Oracle candidate audience')
  const root = parseStructuredOutputV1({ raw: output, contract: { version: 1, schemaId: 'storyforge.ttrpg-open-common-oracle-interpretation',
    target: 'runtime-candidate', root: 'object', maxChars: 120000, allowedRootFields: ['interpretation', 'facts'], requiredRootFields: ['interpretation', 'facts'] },
    parse: value => p.record(value, ['interpretation', 'facts'], 'common Oracle output') })
  const result = parseTtrpgOpenOracleSemanticFieldsV1(root, { contract: { factPolicy: contract.factPolicy, selectedActorKeys: contract.recipientActorKeys },
    packet, runtimePolicy: delivered.runtimeIdentityScope ?? undefined })
  if (result.facts.some(fact => fact.audience !== packet.audience)) p.fail('共同事实候选必须保持本次原咨询的准确共同范围，不能创造私域事实')
  return result
}

/** Current original human identity only; reading is still allowed while paused, with no renewed model permission. */
export async function assertTtrpgOpenCommonOracleCandidateReaderV1(input: TtrpgOpenCandidateReadV1) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const seat = assertTtrpgOpenHumanHostV1(loaded.authorization, input.viewerKey)
  const grant = loaded.runtime.openRun!.coordination.epochs.find(row => row.commonOracle?.requestKey === input.requestKey)?.commonOracle
  if (!grant || grant.run.runId !== input.runId || grant.basis.requester.viewerKey !== input.viewerKey || grant.basis.requester.seatKey !== seat.seatKey
    || grant.basis.requester.seatRevision !== seat.revision || grant.basis.authorizationRevision !== loaded.authorization.revision
    || stable(grant.basis.recipientActorKeys) !== stable([...loaded.authorization.selectedActorKeys].sort())) throw new Error('此共同事实候选不属于当前本人及原准确接收者')
  await loaded.assertCurrent()
}
export async function readTtrpgOpenCommonOracleCandidateV1(input: TtrpgOpenCandidateReadV1): Promise<TtrpgOpenCommonOracleCandidateV1 | null> {
  try {
    const candidate = await readTtrpgOpenRuntimeCandidateV1(input, 'common-oracle-interpret')
    return candidate?.schema === 'storyforge.ttrpg-open-common-oracle-candidate' ? candidate : null
  } catch { throw new Error('当前不能读取本人的原共同事实候选；请核对准确身份与原请求。') }
}
