import { OPEN_FACT_PREDICATES } from './open-contract'
import type { TtrpgPredicateV1, TtrpgOpenFrozenFactV1, TtrpgOpenSourceFieldRef } from './open-contract'
import * as p from './open-contract-parse'

export function parsePredicate(value: unknown, label: string, depth = 1): TtrpgPredicateV1 {
  if (depth > 8) return p.fail(`${label}: 谓词深度超过8`)
  const r = p.object(value, label)
  const op = r.op
  if (op === 'all' || op === 'any' || op === 'not') {
    p.exact(r, ['op', 'of'], label)
    if (op === 'not') return { op, of: parsePredicate(r.of, `${label}.of`, depth + 1) }
    return { op, of: p.list(r.of, `${label}.of`, (v, l) => parsePredicate(v, l, depth + 1), 32, 1) }
  }
  if (op === 'world-fact' || op === 'session-fact') {
    const hasValue = Object.prototype.hasOwnProperty.call(r, 'value')
    p.exact(r, ['op', 'subjectRef', 'predicateKey', 'objectRef', ...(hasValue ? ['value'] : [])], label)
    return { op, subjectRef: p.key(r.subjectRef, label), predicateKey: p.oneOf(r.predicateKey, OPEN_FACT_PREDICATES, label),
      objectRef: p.nullable(r.objectRef, p.key, label), ...(hasValue ? { value: p.scalar(r.value, label) } : {}) }
  }
  switch (op) {
    case 'evidence-known-by':
      p.exact(r, ['op', 'clueRef', 'actorKey'], label)
      return { op, clueRef: p.key(r.clueRef, label), actorKey: p.key(r.actorKey, label) }
    case 'clock-at-least':
      p.exact(r, ['op', 'clockKey', 'value'], label)
      return { op, clockKey: p.key(r.clockKey, label), value: p.integer(r.value, label, 0, 100) }
    case 'story-fact':
      p.exact(r, ['op', 'factKey', 'expected'], label)
      return { op, factKey: p.key(r.factKey, label), expected: p.nullable(r.expected, p.scalar, label) }
    case 'actor-at':
      p.exact(r, ['op', 'actorKey', 'locationRef'], label)
      return { op, actorKey: p.key(r.actorKey, label), locationRef: p.key(r.locationRef, label) }
    case 'item-held':
      p.exact(r, ['op', 'actorKey', 'itemKey'], label)
      return { op, actorKey: p.key(r.actorKey, label), itemKey: p.key(r.itemKey, label) }
    case 'ability-available':
      p.exact(r, ['op', 'actorKey', 'abilityKey'], label)
      return { op, actorKey: p.key(r.actorKey, label), abilityKey: p.key(r.abilityKey, label) }
    case 'resource-at-least':
      p.exact(r, ['op', 'actorKey', 'resourceKey', 'value'], label)
      return { op, actorKey: p.key(r.actorKey, label), resourceKey: p.key(r.resourceKey, label), value: p.number(r.value, label) }
    case 'social-balance-at-least':
      p.exact(r, ['op', 'balanceKey', 'value'], label)
      return { op, balanceKey: p.key(r.balanceKey, label), value: p.number(r.value, label) }
    case 'chaos-at-least':
    case 'world-turn-at-least':
      p.exact(r, ['op', 'value'], label)
      return { op, value: p.integer(r.value, label, op === 'chaos-at-least' ? 1 : 0, op === 'chaos-at-least' ? 9 : 1000) }
    case 'situation-active':
      p.exact(r, ['op', 'templateKey'], label)
      return { op, templateKey: p.key(r.templateKey, label) }
    case 'front-stage-at-least':
      p.exact(r, ['op', 'frontKey', 'stageKey'], label)
      return { op, frontKey: p.key(r.frontKey, label), stageKey: p.key(r.stageKey, label) }
    default: return p.fail(`${label}: predicate-unresolvable`)
  }
}
export function sourceField(value: unknown, label: string): TtrpgOpenSourceFieldRef {
  const r = p.record(value, ['resourceKey', 'fieldPath', 'contentHash'], label)
  const fieldPath = p.text(r.fieldPath, label, 500)
  if (!/^[A-Za-z][A-Za-z0-9_.[\]-]*$/.test(fieldPath)) p.fail(`${label}: 字段路径无效`)
  return { resourceKey: p.key(r.resourceKey, label), fieldPath, contentHash: p.hash(r.contentHash, label) }
}
export function frozenFact(value: unknown, label: string): TtrpgOpenFrozenFactV1 {
  const r = p.record(value, ['factKey', 'subjectRef', 'predicateKey', 'objectRef', 'canonicalValue', 'authority', 'owner', 'audience', 'knownByActorKeys', 'sourceResourceRefs', 'sourceFieldRefs'], label)
  const result: TtrpgOpenFrozenFactV1 = {
    factKey: p.key(r.factKey, label), subjectRef: p.key(r.subjectRef, label),
    predicateKey: p.oneOf(r.predicateKey, OPEN_FACT_PREDICATES, label), objectRef: p.nullable(r.objectRef, p.key, label),
    canonicalValue: p.scalar(r.canonicalValue, label), authority: p.oneOf(r.authority, ['invariant', 'initial-state'], label),
    owner: p.oneOf(r.owner, ['semantic-fact', 'entity', 'inventory', 'social-ledger'], label),
    audience: p.oneOf(r.audience, p.AUDIENCES, label), knownByActorKeys: p.keys(r.knownByActorKeys, label),
    sourceResourceRefs: p.keys(r.sourceResourceRefs, label), sourceFieldRefs: p.list(r.sourceFieldRefs, label, sourceField),
  }
  p.recipients(result.audience, result.knownByActorKeys, label)
  for (const field of result.sourceFieldRefs) p.known(field.resourceKey, result.sourceResourceRefs, `${label}.sourceFieldRefs`)
  if (result.sourceResourceRefs.some(k => !result.sourceFieldRefs.some(f => f.resourceKey === k))) p.fail(`${label}: 缺具体字段来源`)
  if (result.authority === 'invariant' && result.owner !== 'semantic-fact') p.fail(`${label}: 机械初值不能成为不变量`)
  return result
}
