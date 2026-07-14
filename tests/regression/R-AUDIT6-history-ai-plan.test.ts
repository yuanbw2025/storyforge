import { describe, expect, it } from 'vitest'
import {
  buildHistoryAIMessages,
  buildHistoryManualContext,
  decodeHistoryAIOperation,
  encodeHistoryAIOperation,
} from '../../src/lib/history/ai-plan'
import { formatHistoricalYear } from '../../src/lib/history/year'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'
import type { HistoricalKeyword, HistoricalTimelineEvent, PromptTemplate } from '../../src/lib/types'

const now = 1
const event: HistoricalTimelineEvent = {
  id: 7,
  projectId: 1,
  era: 'sui-tang',
  year: 712,
  date: '开元元年',
  title: '改元开元',
  description: '朝廷改元，地方开始换用新年号。',
  conceptNote: '允许适度架空地方反应',
  consultPrompt: '重点核对诏书传递速度',
  stormPrompt: '多给市井画面',
  source: '《旧唐书》',
  isHistorical: true,
  createdAt: now,
  updatedAt: now,
}

const keyword: HistoricalKeyword = {
  id: 8,
  projectId: 1,
  keyword: '飞钱',
  category: 'economy',
  era: 'sui-tang',
  description: '商旅使用的汇兑凭证。',
  conceptNote: '用于商战剧情',
  createdAt: now,
  updatedAt: now,
}

function template(key: 'history.consult' | 'history.storm'): PromptTemplate {
  const seed = SYSTEM_PROMPT_SEEDS.find(item => item.moduleKey === key)!
  return { ...seed, createdAt: now, updatedAt: now }
}

describe('AUDIT-6 · 历史双 agent 纯计划', () => {
  it('历史年份区分公元前、公元与纪年原点，不显示公元前 0 年', () => {
    expect(formatHistoricalYear(-221)).toBe('公元前 221 年')
    expect(formatHistoricalYear(0)).toBe('纪年原点')
    expect(formatHistoricalYear(-0)).toBe('纪年原点')
    expect(formatHistoricalYear(712)).toBe('公元 712 年')
  })

  it('operation 对事件和关键词可逆，非法值安全拒绝', () => {
    expect(encodeHistoryAIOperation({ kind: 'event', item: event })).toBe('event:7')
    expect(encodeHistoryAIOperation({ kind: 'keyword', item: keyword })).toBe('keyword:8')
    expect(decodeHistoryAIOperation('event:7')).toEqual({ kind: 'event', id: 7 })
    expect(decodeHistoryAIOperation('keyword:8')).toEqual({ kind: 'keyword', id: 8 })
    expect(decodeHistoryAIOperation('event:nope')).toBeNull()
    expect(decodeHistoryAIOperation('chapter:1')).toBeNull()
  })

  it('历史总述与纪年作为 manualText 完整进入注册表输入，不做字符硬截断', () => {
    const overview = `王朝沿革${'甲'.repeat(260)}`
    const eraSystem = `星历纪年${'乙'.repeat(180)}`
    const manual = buildHistoryManualContext(overview, eraSystem)
    expect(manual).toContain(overview)
    expect(manual).toContain(eraSystem)
  })

  it('事件考据保留史实元信息、定稿与作者边界，并注入装配后的世界上下文', () => {
    const messages = buildHistoryAIMessages({
      mode: 'consult',
      target: { kind: 'event', item: event },
      worldContext: '【世界观】长安与虚构镜城并存',
      template: template('history.consult'),
    })
    const prompt = messages.map(message => message.content).join('\n')
    expect(prompt).toContain('改元开元')
    expect(prompt).toContain('开元元年')
    expect(prompt).toContain('《旧唐书》')
    expect(prompt).toContain(event.description)
    expect(prompt).toContain(event.conceptNote)
    expect(prompt).toContain(event.consultPrompt)
    expect(prompt).toContain('【世界观】长安与虚构镜城并存')
    expect(prompt).not.toContain(event.stormPrompt!)
  })

  it('纪年原点进入事件 prompt 时不伪装成公元前 0 年', () => {
    const messages = buildHistoryAIMessages({
      mode: 'consult',
      target: { kind: 'event', item: { ...event, year: 0 } },
      worldContext: '',
      template: template('history.consult'),
    })
    const prompt = messages.map(message => message.content).join('\n')
    expect(prompt).toContain('数字化年份：0 (纪年原点)')
    expect(prompt).not.toContain('公元前 0 年')
  })

  it('关键词风暴使用分类/时期与风暴指令，不串入考据指令', () => {
    const target = { ...keyword, stormPrompt: '强调票号冲突', consultPrompt: '只核制度沿革' }
    const messages = buildHistoryAIMessages({
      mode: 'storm',
      target: { kind: 'keyword', item: target },
      worldContext: '【历史总述】商路兴盛',
      template: template('history.storm'),
    })
    const prompt = messages.map(message => message.content).join('\n')
    expect(prompt).toContain('飞钱')
    expect(prompt).toContain('社会与经济')
    expect(prompt).toContain('隋唐五代')
    expect(prompt).toContain('强调票号冲突')
    expect(prompt).not.toContain('只核制度沿革')
  })
})
