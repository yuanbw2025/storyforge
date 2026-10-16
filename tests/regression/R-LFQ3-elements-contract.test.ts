import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { readOwnedRows, resolveScopeLike } from '../../src/lib/workspace/scope'
import { adopt } from '../../src/lib/registry/adopt'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { createSystemFictionElementsV1, formatSystemFictionElementsV1, parseSystemFictionElementsV1 } from '../../src/lib/prose/system-fiction-contract'
import { adoptRestoredCreativeRulesCandidateV1, formatCreativeRulesGenerationRequestV1, parseCreativeRulesCandidateDraftV1, prepareCreativeRulesCopilotV1 } from '../../src/lib/agent/creative-rules-copilot'
import { adoptGenerationNodeOutput, runGenerationNode } from '../../src/lib/generation/generation-node'
import { useCreativeRulesStore } from '../../src/stores/project-singletons'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

const elements = () => ({ ...createSystemFictionElementsV1(), enabled: true, protagonistIntent: '保住小店', systemMechanism: '每日免费签到', rewardGrowth: '明天计划得到茶具', limitsCosts: '不追加惩罚', oppositionRelations: '邻居有自己的诉求' })

describe('LFQ3 · 系统文元素字段与生命周期', () => {
  beforeEach(async () => {
    resetPendingEditCoordinatorForTestsV1()
    await db.delete()
    await db.open()
    useCreativeRulesStore.setState({ creativeRules: null, loading: false, activeWorldGroupId: null })
  })

  it('可留白与停用，规划奖励不被格式化成已发生事实', () => {
    expect(formatSystemFictionElementsV1(undefined)).toBe('')
    expect(formatSystemFictionElementsV1(createSystemFictionElementsV1())).toBe('')
    expect(formatSystemFictionElementsV1(elements())).toContain('成长回报属于规划，不代表已兑现')
    expect(parseSystemFictionElementsV1({ ...elements(), systemMechanism: '  原文\n保留  ' }).systemMechanism).toBe('  原文\n保留  ')
    for (const bad of [{ ...elements(), version: 2 }, { ...elements(), workId: 42 }, { ...elements(), enabled: 'yes' }, { ...elements(), rewardGrowth: [] }]) {
      expect(() => parseSystemFictionElementsV1(bad)).toThrow()
    }
  })

  it('正式候选支持原文本字段与严格的元素对象，不允许把其它字段偷渡进元素', () => {
    expect(parseCreativeRulesCandidateDraftV1('{"field":"writingStyle","value":"保留轻松语气"}')).toEqual({ field: 'writingStyle', value: '保留轻松语气' })
    expect(parseCreativeRulesCandidateDraftV1(JSON.stringify({ field: 'systemFictionElements', value: elements() }))).toEqual({ field: 'systemFictionElements', value: elements() })
    expect(() => parseCreativeRulesCandidateDraftV1(JSON.stringify({ field: 'systemFictionElements', value: { ...elements(), projectId: 4 } }))).toThrow('未登记字段')
  })

  it('登记字段由 adopt 写入同一 Work，非法嵌套结构整次拒绝且原值不变', async () => {
    const made = await seedCurrentWorkspace('元素写作', { genres: ['系统流'] })
    const result = await adopt({ projectId: made.scope.projectId, scope: made.scope, target: 'creativeRules', mode: 'replace', data: { systemFictionElements: elements(), specialRequirements: '原要求' } })
    expect(result.written).toHaveLength(1)
    const before = (await readOwnedRows(made.scope, 'creativeRules', { owner: 'work' }))[0]
    const rejected = await adopt({ projectId: made.scope.projectId, scope: made.scope, target: 'creativeRules', mode: 'replace', data: { systemFictionElements: { ...elements(), version: 2 }, specialRequirements: '不能部分写入' } })
    expect(rejected.typeErrors).toHaveLength(1)
    expect(rejected.written).toHaveLength(0)
    expect((await readOwnedRows(made.scope, 'creativeRules', { owner: 'work' }))[0]).toEqual(before)
  })

  it('新设置往返完整保留；损坏版本在导入前拒绝，数据库和原备份都不变', async () => {
    const made = await seedCurrentWorkspace('往返元素')
    await adopt({ projectId: made.scope.projectId, scope: made.scope, target: 'creativeRules', mode: 'replace', data: { systemFictionElements: elements(), writingStyle: '保留原文风' } })
    const backup = await exportProjectJSON(made.scope.projectId)
    const imported = await resolveScopeLike(await importProjectJSON(backup))
    expect((await readOwnedRows(imported, 'creativeRules', { owner: 'work' }))[0]).toMatchObject({ systemFictionElements: elements(), writingStyle: '保留原文风' })
    const damaged = JSON.parse(JSON.stringify(backup))
    damaged.creativeRules[0].systemFictionElements.version = 2
    const count = await db.projects.count()
    await expect(importProjectJSON(damaged)).rejects.toThrow('版本不受支持')
    expect(await db.projects.count()).toBe(count)
    expect(damaged.creativeRules[0].systemFictionElements.version).toBe(2)
    expect(backup.creativeRules[0].systemFictionElements?.version).toBe(1)
  })

  it('旧备份缺少新字段仍往返，元素开关不会被后台补写', async () => {
    const made = await seedCurrentWorkspace('旧创作规则')
    await useCreativeRulesStore.getState().save({ projectId: made.scope.projectId, writingStyle: '旧作品文风' }, made.scope)
    const backup = await exportProjectJSON(made.scope.projectId)
    const imported = await resolveScopeLike(await importProjectJSON(backup))
    const row = (await readOwnedRows(imported, 'creativeRules', { owner: 'work' }))[0]
    expect(row.writingStyle).toBe('旧作品文风')
    expect('systemFictionElements' in row).toBe(false)
  })

  it('复用正式节点：生成不写入，错投拒绝，恢复编辑后采纳，规则变动使候选过期', async () => {
    const made = await seedCurrentWorkspace('元素候选', { genres: ['系统流'] })
    await useCreativeRulesStore.getState().save({ projectId: made.scope.projectId, writingStyle: '自定义文风' }, made.scope)
    const input = { projectId: made.scope.projectId, scope: made.scope, worldGroupId: null, authorRequest: formatCreativeRulesGenerationRequestV1({ field: 'systemFictionElements' }) }
    let prompt = ''
    const prepared = await prepareCreativeRulesCopilotV1(input, { runAI: async messages => {
      prompt = messages.map(message => message.content).join('\n')
      return JSON.stringify({ field: 'systemFictionElements', value: elements() })
    } })
    const generated = await runGenerationNode(prepared.node, prepared.prepared)
    expect(generated.gate?.status).toBe('pass')
    expect(prompt).toContain('目标字段是 systemFictionElements')
    expect((await readOwnedRows(made.scope, 'creativeRules', { owner: 'work' }))[0].systemFictionElements).toBeUndefined()
    const wrong = await adoptGenerationNodeOutput(prepared.node, { field: 'writingStyle', value: '不可错投' })
    expect(wrong.adopted).toBe(false)
    const revised = { ...elements(), systemMechanism: '作者修改：每天首次签到免费' }
    await adoptRestoredCreativeRulesCandidateV1({ ...input, snapshot: prepared.snapshot, targetField: 'systemFictionElements', draft: JSON.stringify({ field: 'systemFictionElements', value: revised }) })
    expect((await readOwnedRows(made.scope, 'creativeRules', { owner: 'work' }))[0]).toMatchObject({ writingStyle: '自定义文风', systemFictionElements: revised })
    const next = await prepareCreativeRulesCopilotV1(input)
    await useCreativeRulesStore.getState().save({ projectId: made.scope.projectId, writingStyle: '作者最新改动' }, made.scope)
    await expect(adoptRestoredCreativeRulesCandidateV1({ ...input, snapshot: next.snapshot, targetField: 'systemFictionElements', draft: JSON.stringify({ field: 'systemFictionElements', value: elements() }) })).rejects.toThrow('发生变化')
  })
})
