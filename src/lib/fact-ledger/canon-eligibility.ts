import type { TemporalFact } from '../types/temporal-fact'

/**
 * Eligibility for Canon interval projection, including bounded historical Canon.
 * This does not establish currentness, ownership, source freshness or a valid chapter range.
 * Consumers must still validate those boundaries; Gateway authority is a separate contract.
 * Superseded records without an end remain audit evidence, never an open current interval.
 */
export function isCanonFactV1(fact: Pick<TemporalFact, 'status' | 'validToChapterId'>): boolean {
  return fact.status === 'confirmed' || (fact.status === 'superseded' && fact.validToChapterId != null)
}
