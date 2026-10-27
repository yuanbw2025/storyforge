/** V2 exact method selection. Returns frozen identifiers only, never inferred effects or permissions. */
import type { RulePackV2 } from './open-contract'

type Method = { kind: 'action' | 'check' | 'oracle' | 'interaction'; key: string }
const normalized = (value: string) => value.normalize('NFC').toLocaleLowerCase()
export function selectTtrpgOpenExactMethodV2(rulePack: RulePackV2, method: string | null): Method[] {
  if (method === null) return []
  const rows: Array<Method & { label: string }> = [
    ...rulePack.actions.map(row => ({ kind: 'action' as const, key: row.key, label: row.name })),
    ...rulePack.genericChecks.map(row => ({ kind: 'check' as const, key: row.checkKey, label: row.title })),
    ...rulePack.oracles.map(row => ({ kind: 'oracle' as const, key: row.oracleKey, label: row.title })),
    ...(rulePack.interactionBindings ?? []).map(row => ({ kind: 'interaction' as const, key: row.interactionKey, label: row.title })),
  ]
  const value = normalized(method), keys = rows.filter(row => normalized(row.key) === value)
  // A canonical identifier is stronger than a label in another namespace.
  return (keys.length ? keys : rows.filter(row => normalized(row.label) === value)).map(({ kind, key }) => ({ kind, key }))
}
