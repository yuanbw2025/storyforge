export function formatHistoricalYear(year: number): string {
  if (!Number.isFinite(year)) return '年份未指定'
  if (year === 0) return '纪年原点'
  return year > 0 ? `公元 ${year} 年` : `公元前 ${Math.abs(year)} 年`
}
