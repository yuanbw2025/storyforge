export function formatHistoricalYear(year: number | null): string {
  if (year === null || !Number.isFinite(year)) return '年份未指定'
  if (year === 0) return '纪年原点'
  return year > 0 ? `公元 ${year} 年` : `公元前 ${Math.abs(year)} 年`
}

/** Author text may be a relative date. Blank numeric input is not year zero. */
export function parseHistoricalYearInputV1(value: string): number | null {
  if (!value.trim()) return null
  const year = Number(value)
  if (!/^[+-]?\d+$/.test(value.trim()) || !Number.isSafeInteger(year)) throw new Error('请填写整数年份，或留空保留相对时间。')
  return year
}

/** Numeric dates keep their established order. Unplaced dates retain insertion
 * order at the end; this does not infer chronology from their free text. */
export function compareHistoricalDatesV1(left: { year: number | null; createdAt: number; id?: number }, right: { year: number | null; createdAt: number; id?: number }): number {
  const a = typeof left.year === 'number' && Number.isFinite(left.year) ? left.year : null
  const b = typeof right.year === 'number' && Number.isFinite(right.year) ? right.year : null
  if (a !== null && b !== null) return a - b
  if (a !== null) return -1
  if (b !== null) return 1
  return left.createdAt - right.createdAt || (left.id ?? 0) - (right.id ?? 0)
}
