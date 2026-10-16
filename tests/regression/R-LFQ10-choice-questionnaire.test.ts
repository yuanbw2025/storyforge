import { describe, expect, it } from 'vitest'
import { makeQuestionnairePackets, readChoiceReviewHtml, renderQuestionnaire, validateChoiceReview } from '../../scripts/quality-evals/longform-choice-questionnaire.mjs'

const input = () => ({ studyId: 'Q10-preview', mode: 'preview', sourceVersions: { baseline: 'old-private-version', improved: 'new-private-version' }, participants: ['R01', 'R02', 'R03'], samples: [1, 2].map(chapter => ({ pairId: `urban-${chapter}`, workId: 'urban', chapter, genre: '都市系统文', baseline: '第一段\n第二段', improved: '另一版第一段\n另一版第二段' })) })
function blank(packet: any) {
  const side = () => ({ readTo: null, continuation: null, scores: Object.fromEntries(packet.dimensions.map(([id]: [string]) => [id, null])) })
  return { schema: 'storyforge.longform-choice-review', version: 1, studyId: packet.studyId, packetId: packet.packetId, participantCode: packet.participantCode, mode: packet.mode, role: null, familiarity: null, independence: null, openedAt: '2026-10-14T06:00:00Z', updatedAt: '2026-10-14T06:00:00Z', answers: packet.samples.map((sample: any) => ({ pairId: sample.pairId, hashA: sample.a.hash, hashB: sample.b.hash, a: side(), b: side(), preference: null, reasons: [] })) }
}

describe('LFQ10 · 无需打字的独立选择问卷', () => {
  it('一人一包，同一作品连续章节身份固定；参与者 HTML 不包含组织者映射', () => {
    const { packets, organizerKey } = makeQuestionnairePackets(input(), 'frozen-seed')
    expect(new Set(packets.map((packet: any) => packet.packetId)).size).toBe(3)
    for (const code of input().participants) expect(new Set(organizerKey.mapping.filter((row: any) => row.participantCode === code).map((row: any) => row.a)).size).toBe(1)
    const html = renderQuestionnaire(packets[0])
    expect(html).not.toContain('old-private-version')
    expect(html).not.toContain('new-private-version')
    expect(html).not.toContain('baseline')
    expect(html).not.toContain('improved')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('type="text"')
    expect(html).toContain('流程预览')
    expect(html).toContain('connect-src \'none\'')
  })

  it('文字作为数据转义，原样 hash 保留，不能通过样稿注入脚本', () => {
    const source = input()
    source.samples[0].baseline = '</script><script>window.injection=true</script>'
    const { packets } = makeQuestionnairePackets(source, 'seed')
    const html = renderQuestionnaire(packets[0])
    expect(html).not.toContain(source.samples[0].baseline)
    expect(html).toContain('\\u003c/script\\u003e')
    expect(Object.values(packets[0].samples[0]).some((row: any) => row?.text === source.samples[0].baseline)).toBe(true)
  })

  it('未填与无法判断区别保存，完整性不由输入自行声明，跨人或不同稿件进度拒绝', () => {
    const { packets } = makeQuestionnairePackets(input(), 'seed')
    const packet = packets[0]
    const result = blank(packet)
    expect(validateChoiceReview(packet, result)).toEqual({ completedPairs: 0, complete: false })
    expect(() => validateChoiceReview(packets[1], result)).toThrow('不属于这份问卷')
    for (const answer of result.answers) {
      answer.preference = 'unknown'
      answer.reasons = ['unknown']
      for (const side of ['a', 'b']) answer[side] = { readTo: 'end', continuation: 'unknown', scores: Object.fromEntries(packet.dimensions.map(([id]: [string]) => [id, 'unknown'])) }
    }
    result.role = 'reader'; result.familiarity = 'often'; result.independence = 'yes'
    expect(validateChoiceReview(packet, result)).toEqual({ completedPairs: 2, complete: true })
    expect(() => validateChoiceReview(packet, { ...result, complete: true })).toThrow('结构无效')
    result.answers[0].hashA = 'different-version'
    expect(() => validateChoiceReview(packet, result)).toThrow('样稿版本不匹配')
  })

  it('错误评分、超界位置、冲突的无差别原因与重复章节都拒绝', () => {
    const { packets } = makeQuestionnairePackets(input(), 'seed')
    const packet = packets[0]
    let value = blank(packet); value.answers[0].a.scores.immersion = 6
    expect(() => validateChoiceReview(packet, value)).toThrow('评分无效')
    value = blank(packet); value.answers[0].a.readTo = 3
    expect(() => validateChoiceReview(packet, value)).toThrow('段落位置无效')
    value = blank(packet); value.answers[0].reasons = ['no-difference', 'pace']
    expect(() => validateChoiceReview(packet, value)).toThrow('不能与其它原因')
    value = blank(packet); value.answers[1] = value.answers[0]
    expect(() => validateChoiceReview(packet, value)).toThrow('样稿版本不匹配')
    expect(() => makeQuestionnairePackets({ ...input(), participants: ['R01', 'R01'] })).toThrow('参与者代号')
  })

  it('答案随 HTML 保存，可直接读回；读取回传文件不执行脚本，并拒绝跨人、改稿或重复数据块', () => {
    const { packets } = makeQuestionnairePackets(input(), 'seed')
    const packet = packets[0]
    const value = blank(packet)
    value.answers[0].preference = 'B'
    value.answers[0].reasons = ['prose']
    const html = renderQuestionnaire(packet, value)
    const parsed = readChoiceReviewHtml(packet, html + '<script>throw new Error("never execute this")</script>')
    expect(parsed.review).toEqual(value)
    expect(parsed.validation).toEqual({ completedPairs: 0, complete: false })
    expect(() => readChoiceReviewHtml(packets[1], html)).toThrow('参与者或样稿已变化')
    expect(() => readChoiceReviewHtml(packet, html.replace('第一段', '被改写的正文'))).toThrow('参与者或样稿已变化')
    expect(() => readChoiceReviewHtml(packet, html + '<script id="saved-review" type="application/json">{}</script>')).toThrow('唯一')
    expect(() => readChoiceReviewHtml(packet, renderQuestionnaire(packet))).toThrow('saved-review')
    expect(() => renderQuestionnaire(packet, { ...value, participantCode: 'someone-else' })).toThrow('不属于这份问卷')
  })
})
