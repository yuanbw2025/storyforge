import { afterEach, describe, expect, it } from 'vitest'
import { usePromptStore } from '../../src/stores/prompt'
import { CORE_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-core'
import { buildChapterContentRequestV1, buildContinueRequestV1 } from '../../src/lib/ai/adapters/chapter-adapter'
import { observeProseLengthV1, parseProseLengthObservationV1, proseLengthExpectationV1 } from '../../src/lib/prose/length-observation'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'

const original = usePromptStore.getState()
const seed = (key: 'chapter.content' | 'chapter.continue') => ({ ...CORE_PROMPT_SEEDS.find(item => item.moduleKey === key)!, createdAt: 1, updatedAt: 1 })
const wire = (request: { messages: { content: string }[] }) => request.messages.map(item => item.content).join('\n').replace(/\s/g, '')

describe('LFQ6 · 作者明确篇幅与实际模板一致', () => {
  afterEach(() => usePromptStore.setState(original, true))

  it.each(['chapter.content', 'chapter.continue'] as const)('作者模板不含 userHint 时 %s 仍交付本轮完整要求，不改模板或参数', key => {
    const template = { ...seed(key), continuityMode: 'off' as const, systemPrompt: '作者保留的系统模板。', userPromptTemplate: '作者保留的任务模板。', modelOverride: { temperature: 0, maxTokens: 1900 } }
    const saved = JSON.stringify(template)
    usePromptStore.setState({ getActive: () => template })
    const hint = '只写600字。\n先问同行者意愿，签收后停笔。'
    const request = key === 'chapter.content'
      ? buildChapterContentRequestV1('收店', '', '', '', '', '', hint)
      : buildContinueRequestV1('开始清点。', '', '', hint)
    const content = request.messages.map(item => item.content).join('\n')
    expect(content).toContain(hint)
    expect(content.split(hint)).toHaveLength(2)
    expect(content).toContain('作者保留的任务模板。')
    expect(JSON.stringify(template)).toBe(saved)
    expect(request.modelOverride).toEqual({ temperature: 0, maxTokens: 1900 })
  })

  it('模板已交付的本轮要求不重复，空提示不添加空块', () => {
    const template = { ...seed('chapter.content'), continuityMode: 'off' as const, userPromptTemplate: '{{userHint}}' }
    usePromptStore.setState({ getActive: () => template })
    const hint = '不要增加敌人，签收后停笔。'
    const request = buildChapterContentRequestV1('收店', '', '', '', '', '', hint)
    expect(request.messages.map(item => item.content).join('\n').split(hint)).toHaveLength(2)
    expect(wire(buildChapterContentRequestV1('收店', '', '', '', '', '', '  '))).not.toContain('【本轮作者补充要求】')
  })

  it('600～900 字替代本轮默认 2500，其它默认基调和节奏保留，模板未改写', () => {
    const template = seed('chapter.content')
    usePromptStore.setState({ getActive: () => template })
    const request = buildChapterContentRequestV1('收店', '签收后停笔', '完整资料', '', '', '', '写600至900字。签收后停笔。')
    expect(wire(request)).toContain('字数约600～900字/章')
    expect(wire(request)).not.toContain('字数约2500字/章')
    expect(wire(request)).toContain('严肃风格')
    expect(wire(request)).toContain('节奏中')
    expect(template.parameters!.find(item => item.key === 'chapterLength')!.default).toBe(2500)
  })

  it('显式关闭可选长度保持关闭，不会因作者有范围而重新开启；已有参数对象不变', () => {
    const template = seed('chapter.content')
    usePromptStore.setState({ getActive: () => template })
    const parameterValues = { tone: '轻松', chapterLength: '' }
    const request = buildChapterContentRequestV1('收店', '关灯', '', '', '', '', '写600至900字。', { parameterValues })
    expect(wire(request)).not.toContain('字数约')
    expect(wire(request)).toContain('轻松风格')
    expect(wire(request)).not.toContain('节奏中')
    expect(parameterValues).toEqual({ tone: '轻松', chapterLength: '' })
  })

  it('上下限保留单边语义，自有模板的字面内容和模型参数保留', () => {
    const template = { ...seed('chapter.content'), scope: 'user' as const, systemPrompt: '自有模板：角色回忆2500字的旧信。{{#if usesChapterLength}}篇幅{{chapterLength}}字{{/if}}', userPromptTemplate: '{{userHint}}', modelOverride: { temperature: 0, maxTokens: 4000 } }
    usePromptStore.setState({ getActive: () => template })
    const cap = buildChapterContentRequestV1('收店', '', '', '', '', '', '不要超过600字。')
    expect(wire(cap)).toContain('篇幅≤600字')
    expect(wire(cap)).toContain('角色回忆2500字的旧信')
    expect(cap.modelOverride).toEqual({ temperature: 0, maxTokens: 4000 })
    const floor = buildChapterContentRequestV1('收店', '', '', '', '', '', '至少600字。')
    expect(wire(floor)).toContain('篇幅≥600字')
  })

  it('续写实际采用 continueLength，不再与硬编码 1000～2000 字并存，可明确关闭', () => {
    const template = seed('chapter.continue')
    usePromptStore.setState({ getActive: () => template })
    const request = buildContinueRequestV1('两人开始清点工具。', '关灯即停笔', '完整资料', '续写500字。')
    expect(wire(request)).toContain('续写篇幅500字')
    expect(wire(request)).not.toContain('1000-2000')
    const closed = buildContinueRequestV1('旧稿', '关灯', '', '续写500字。', { parameterValues: {} })
    expect(wire(closed)).not.toContain('续写篇幅')
    expect(template.parameters!.find(item => item.key === 'continueLength')!.default).toBe(1500)
  })

  it('旧章计数、引用与角色写信不变成篇幅控制，明确声明与单独范围可识别', () => {
    for (const narrative of ['上章写了600字，本章顺其自然', '主角写600字的信，放在门口', '写给母亲600字的信', '他说：“最多600字”。', '账单要求600～900字，人物拒绝']) expect(proseLengthExpectationV1(narrative)).toBeNull()
    expect(proseLengthExpectationV1('写600字的信，主角读完关灯')).toBeNull()
    expect(proseLengthExpectationV1('只写400字，主角写600字的信')).toMatchObject({ target: 400 })
    expect(proseLengthExpectationV1('本章字数：600～900字')).toMatchObject({ min: 600, max: 900 })
    expect(proseLengthExpectationV1('600～900字，关灯停笔')).toMatchObject({ min: 600, max: 900 })
    expect(proseLengthExpectationV1('续写正文，篇幅控制在600至900字')).toMatchObject({ min: 600, max: 900 })
  })

  it.each([
    { label: '作者目标', request: '只写250001字。', parameter: undefined, count: 250_001,
      expected: { version: 1, source: 'author', min: 200_000, max: 300_002, target: 250_001 } },
    { label: '作者区间', request: '写300001至400001字。', parameter: undefined, count: 350_001,
      expected: { version: 1, source: 'author', min: 300_001, max: 400_001, target: null } },
    { label: '作者下限', request: '至少300000字。', parameter: undefined, count: 300_001,
      expected: { version: 1, source: 'author', min: 300_000, max: null, target: null } },
    { label: '作者上限', request: '最多500000字。', parameter: undefined, count: 300_001,
      expected: { version: 1, source: 'author', min: null, max: 500_000, target: null } },
    { label: '参数目标', request: '', parameter: 300_001, count: 300_001,
      expected: { version: 1, source: 'parameter', min: 240_000, max: 360_002, target: 300_001 } },
  ])('$label超过20万仍完整观察并往返读取', ({ request, parameter, count, expected }) => {
    const expectation = proseLengthExpectationV1(request, parameter)
    expect(expectation).toEqual(expected)
    const observation = observeProseLengthV1('字'.repeat(count), expectation, 'stop')
    expect(observation).toMatchObject({ wordCount: count, status: 'within', message: null, expectation: expected })
    expect(parseProseLengthObservationV1(JSON.parse(JSON.stringify(observation)))).toEqual(observation)
  })

  it('18万目标派生21.6万提示上限仍可往返，未改变20%语义', () => {
    const expectation = proseLengthExpectationV1('只写180000字。')
    expect(expectation).toEqual({ version: 1, source: 'author', min: 144_000, max: 216_000, target: 180_000 })
    const within = observeProseLengthV1('字'.repeat(180_000), expectation)
    expect(parseProseLengthObservationV1(within)).toEqual(within)
    const short = observeProseLengthV1('字'.repeat(100_000), expectation)
    expect(short.status).toBe('short')
    expect(short.message).toContain('提示范围 144000～216000')
    expect(parseProseLengthObservationV1(short)).toEqual(short)
  })

  it('可表示的极大范围与单边要求仍有效，20%派生越出安全整数时显式拒绝', () => {
    for (const request of [
      '不少于9007199254740991字。',
      '不超过9007199254740991字。',
      '9007199254740990至9007199254740991字。',
    ]) {
      const expectation = proseLengthExpectationV1(request)
      expect(expectation).not.toBeNull()
      const observation = observeProseLengthV1('字', expectation)
      expect(parseProseLengthObservationV1(observation)).toEqual(observation)
    }
    expect(proseLengthExpectationV1('', 7_505_999_378_950_825)).toEqual({
      version: 1, source: 'parameter', min: 6_004_799_503_160_660,
      max: 9_007_199_254_740_990, target: 7_505_999_378_950_825,
    })
    expect(() => proseLengthExpectationV1('', 7_505_999_378_950_826)).toThrow('安全整数')
    expect(() => proseLengthExpectationV1(`只写${Number.MAX_SAFE_INTEGER}字。`)).toThrow('安全整数')
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    '观察记录仍拒绝非正或非安全整数目标%s', target => {
      const observation = observeProseLengthV1('字', proseLengthExpectationV1('只写600字。'))
      expect(() => parseProseLengthObservationV1({
        ...observation, expectation: { ...observation.expectation, target },
      })).toThrow('篇幅要求无效')
    },
  )

  it('伪造状态或文案、未知字段及非法范围仍不能通过记录校验', () => {
    const observation = observeProseLengthV1('字', proseLengthExpectationV1('只写600字。'))
    const expectation = observation.expectation
    if (!expectation) throw new Error('测试要求必须存在')
    const invalid = [
      { ...observation, status: 'within' },
      { ...observation, message: '伪造提示' },
      { ...observation, extra: true },
      { ...observation, wordCount: -1 },
      { ...observation, wordCount: Number.MAX_SAFE_INTEGER + 1 },
      { ...observation, expectation: { ...expectation, extra: true } },
      { ...observation, expectation: { ...expectation, source: 'forged' } },
      { ...observation, expectation: { ...expectation, min: 721, max: 720 } },
      { ...observation, expectation: { ...expectation, min: null, max: null } },
      { ...observation, expectation: { ...expectation, min: -1 } },
      { ...observation, expectation: { ...expectation, max: Number.POSITIVE_INFINITY } },
    ]
    for (const value of invalid) expect(() => parseProseLengthObservationV1(value)).toThrow()
  })

  it('旧合法观察的数值、文案及固定哈希保持兼容', async () => {
    const legacy = {
      version: 1, wordCount: 200, status: 'short', finishReason: null,
      expectation: { version: 1, source: 'author', min: 480, max: 720, target: 600 },
      message: '目标约 600 字（提示范围 480～720），当前 200 字，篇幅不足。这是篇幅提示，不能据此判断文学质量；请检查场景任务，再决定采用或修改。',
    }
    const parsed = parseProseLengthObservationV1(legacy)
    expect(parsed).toEqual(legacy)
    expect(await hashCanonicalValue(parsed)).toBe('d2d44fcd9d6bb401ca8f91613c394fe0310c71674e264c59ab970a2509362a47')
  })
})
