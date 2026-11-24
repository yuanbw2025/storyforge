import { describe, expect, it } from 'vitest'
import { contentText } from '../../src/lib/ttrpg/open-contract-parse'
import { parseTtrpgOpenIntentSelectionV1 } from '../../src/lib/ttrpg/open-intent-clarification-contract'
import { parseTtrpgOpenIntentV1 } from '../../src/lib/ttrpg/open-intent'

const HASH = 'a'.repeat(64)
const long = '完整行动说明'.repeat(500) + '【尾部条件】'

describe('B35 · 跑团意图内容不设固定文字帽（B39 runtime）', () => {
  it('contentText 保留非空/NFC 校验，但只拒绝空串，不截断长度', () => {
    expect(contentText(long, 'goal')).toBe(long.normalize('NFC'))
    expect(() => contentText('   ', 'goal')).toThrow('为空或过长')
  })

  it('澄清选择与意图解析：长 goal/method/outcome 与超长引用/声明完整保留且可往返', () => {
    const references = Array.from({ length: 17 }, (_, index) => `known.${index}`)
    const selection = parseTtrpgOpenIntentSelectionV1({
      goal: long, method: null, targetRefs: [references[0]], requestedOutcome: long,
    })
    expect(selection.goal).toBe(long)
    expect(selection.requestedOutcome).toBe(long)

    const value = {
      intentKey: 'intent.large', clarificationThreadKey: 'intent.large', actorKey: 'hero',
      goal: long, method: long, requestedOutcome: long,
      targetRefs: references, declaredResources: references,
      declaredAssumptions: Array.from({ length: 101 }, (_, index) => `${index}:${long}`),
      source: 'player', inputRevision: HASH,
    }
    const parsed = parseTtrpgOpenIntentV1(value)
    expect(parsed).toEqual(value)
    expect(parseTtrpgOpenIntentV1(JSON.stringify(parsed))).toEqual(value)
    // 真实结构守卫仍在：重复引用、非字符串、未知字段继续拒绝。
    expect(() => parseTtrpgOpenIntentV1({ ...value, targetRefs: [...references, references[0]] })).toThrow('重复')
    expect(() => parseTtrpgOpenIntentV1({ ...value, unexpected: true })).toThrow('字段不精确')
    expect(() => parseTtrpgOpenIntentV1({ ...value, requestedOutcome: 123 })).toThrow('必须是字符串')
  })
})
