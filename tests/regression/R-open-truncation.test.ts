/**
 * R-open-truncation · 放开内部截断(社区反馈:核心设定被静默硬截、想生成更多不支持)
 *
 * ① context-builder 不再把核心设定字段砍成短截断(.slice 放开)。
 * ② assembleContext 的输入预算随所选模型窗口放大,不再固定 24K 提前裁。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { formatWorldviewBlock } from '../../src/lib/ai/context-builder'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

describe('R-open-truncation · 放开内部截断', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('formatWorldviewBlock 完整注入核心字段,不再 slice(0,300) 砍残', () => {
    const longSummary = '这是一段很长的世界观摘要,用来验证不再被硬截断。'.repeat(40) // ≈ 1000 字 > 旧上限 300
    const block = formatWorldviewBlock({ summary: longSummary } as any)
    expect(block).toContain(longSummary) // 完整包含,未被截
    expect(block).not.toContain('…') // 没有截断省略号
  })

  it('assembleContext 输入预算随模型窗口放大(大窗口模型远超旧固定 24K)', async () => {
    const projectId = (await seedCurrentWorkspace('Large context')).scope.projectId
    const r = await assembleContext({
      projectId,
      provider: 'deepseek',
      model: 'deepseek-v4-pro', // maxContext 128000
      sourceKeys: [],
    } as any)
    expect(r.inputBudget).toBeGreaterThan(48000)
  })

  it('显式传 inputBudgetTokens 时仍尊重该值(覆盖优先)', async () => {
    const projectId = (await seedCurrentWorkspace('Explicit context budget')).scope.projectId
    const r = await assembleContext({
      projectId,
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      inputBudgetTokens: 60,
      sourceKeys: [],
    } as any)
    expect(r.inputBudget).toBe(60)
  })
})
