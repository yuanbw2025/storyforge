import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import type {
  TextOpenWorldCrimeAuthorizationV1,
  TextOpenWorldEffectStateV1,
  TextOpenWorldParsedModulesV1,
  TextOpenWorldRuntimePackageV1,
} from '../types'
import { parseTextOpenWorldModulesV1 } from './modules'

function fail(message: string): never { throw new Error(`[text-open-world-crime] ${message}`) }

type ConditionResults = Record<string, { satisfied: boolean } | boolean>

function satisfied(results: ConditionResults, conditionKey: string): boolean {
  const result = results[conditionKey]
  if (typeof result === 'boolean') return result
  if (!result || typeof result.satisfied !== 'boolean') fail(`犯罪结果条件尚未完成校验:${conditionKey}`)
  return result.satisfied
}

export interface TextOpenWorldCrimeResolutionV1 {
  authorization: TextOpenWorldCrimeAuthorizationV1
  outcome: 'success' | 'failure'
  failureReason: { code: 'crime-attempt-failed'; message: string } | null
}

export function createTextOpenWorldCrimeCatalogV1(
  value: TextOpenWorldRuntimePackageV1 | string | unknown,
  parsedModules?: TextOpenWorldParsedModulesV1,
) {
  const modules = parsedModules ?? parseTextOpenWorldModulesV1(value)

  const prepare = (input: {
    actionKey: string
    targetActorKey: string
    state: TextOpenWorldEffectStateV1
    conditionResults: ConditionResults
  }): TextOpenWorldCrimeResolutionV1 => {
    const crime = modules.relationships.crimeActions.find(item => item.actionKey === input.actionKey)
      ?? fail(`Action没有犯罪定义:${input.actionKey}`)
    if (crime.targetActorKey !== input.targetActorKey) fail('犯罪目标与冻结定义不一致')
    if (input.state.map.currentLocationKey !== crime.locationKey) fail('犯罪行动不在冻结地点')
    const target = input.state.actors[crime.targetActorKey] ?? fail('犯罪目标没有运行状态')
    if (!target.alive || !target.present || target.locationKey !== crime.locationKey) fail('犯罪目标当前不在场或不可交互')
    const successConditionResults = crime.successConditionKeys.map(conditionKey => ({
      conditionKey,
      satisfied: satisfied(input.conditionResults, conditionKey),
    }))
    const outcome = successConditionResults.every(result => result.satisfied) ? 'success' : 'failure'
    const configuredWitnessKeys = outcome === 'success' ? crime.witnessActorKeysOnSuccess : crime.witnessActorKeysOnFailure
    const witnessActorKeys = configuredWitnessKeys.filter(actorKey => {
      const actor = input.state.actors[actorKey]
      return actor?.alive === true && actor.present === true && actor.locationKey === crime.locationKey
    })
    const action = modules.actions.actions.find(item => item.key === crime.actionKey) ?? fail(`犯罪Action不存在:${crime.actionKey}`)
    const branchEffectKeys = outcome === 'success' ? action.successEffectKeys : action.failureEffectKeys
    const effectKeys = [...action.costEffectKeys, ...branchEffectKeys, ...(witnessActorKeys.length ? crime.witnessedEffectKeys : [])]
    if (new Set(effectKeys).size !== effectKeys.length) fail(`犯罪Effect重复:${crime.key}`)
    const authorization: TextOpenWorldCrimeAuthorizationV1 = {
      kind: 'crime', crimeKey: crime.key, actionKey: action.key, crimeKind: crime.kind,
      targetActorKey: crime.targetActorKey, locationKey: crime.locationKey,
      worldMinute: input.state.time.worldMinute, outcome, successConditionResults,
      witnessActorKeys, effectKeys,
    }
    return {
      authorization,
      outcome,
      failureReason: outcome === 'failure' ? { code: 'crime-attempt-failed', message: crime.failureMessage } : null,
    }
  }

  const assertAuthorization = (input: {
    authorization: TextOpenWorldCrimeAuthorizationV1
    state: TextOpenWorldEffectStateV1
    conditionResults?: ConditionResults
  }) => {
    const conditionResults = input.conditionResults ?? Object.fromEntries(
      input.authorization.successConditionResults.map(result => [result.conditionKey, result.satisfied]),
    )
    const expected = prepare({
      actionKey: input.authorization.actionKey,
      targetActorKey: input.authorization.targetActorKey,
      state: input.state,
      conditionResults,
    }).authorization
    if (canonicalProductProductionJsonV2(expected) !== canonicalProductProductionJsonV2(input.authorization)) {
      fail('犯罪授权与当前确定性状态不一致')
    }
  }

  return { prepare, assertAuthorization }
}
