/** Bounded product runners must not reinterpret a service-managed null as zero. */
export function requireFixedBudgetValueV1(value: number | null): number {
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('此执行器要求固定预算；服务容量任务须使用对应执行器。')
  }
  return value
}
