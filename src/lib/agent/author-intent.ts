/** Routing sees affirmative actions only. The model still receives the original
 * request, including every negative constraint; this is not a prompt rewrite. */
export function affirmativeAuthorActionsV1(request: string): string {
  return request
    .split(
      /[，。；！？\n,;!?]|(?=但是|但不要|并且不要|并不要|而是|只(?:想|要|需要)?(?:写|生成|创建|修改|设计|规划))|(?:就|再)(?=写|生成)/,
    )
    .filter(
      (clause) => {
        const negative = /(?:不要|不用|无需|不必|不需要|别(?=再|先|写|生成|创建|修改|设计|规划|补|完善|续|扩|润|改|讨论|提|动|加|开始)|暂不|先不|不想|不做|不写|跳过|略过|不生成|不创建|不修改|不补全|不完善)/.exec(clause)
        if (!negative) return true
        // Negation inside the subject is not a command: "设计一位不需要睡眠
        // 的角色" and "写一个离别场景" still request creation.
        return /写|生成|创建|修改|设计|规划|补全|完善|润色|构思|描述/.test(clause.slice(0, negative.index))
      },
    )
    .join('，')
}

export function parseAuthorOrdinalV1(value: string): number | null {
  if (/^\d+$/.test(value)) return Number.isSafeInteger(Number(value)) ? Number(value) : null
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }
  let total = 0
  let digit = 0
  let lastUnit = 10000
  for (const character of value) {
    if (character in digits) {
      digit = digits[character]
      continue
    }
    const unit = units[character]
    if (!unit || unit >= lastUnit) return null
    total += (digit || 1) * unit
    digit = 0
    lastUnit = unit
  }
  return value ? total + digit : null
}
