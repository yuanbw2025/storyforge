import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import {
  parseWorldviewFieldOutputBudgetV1,
  parseWorldviewFieldCandidateDraft,
  parseWorldviewFieldCandidateDraftV2,
  prepareWorldviewFieldCopilot,
  resolveWorldviewFieldOperationV1,
  resolveWorldviewFieldOutputBudgetV1,
} from '../../src/lib/agent/worldview-field-copilot'
import { runGenerationNode } from '../../src/lib/generation/generation-node'
import { seedCurrentProject } from '../helpers/current-workspace'

const NOW = 1_788_200_000_000

async function seedWorkspace() {
  const projectId = await seedCurrentProject({
    workspaceUid: generateWorkspaceUid(), name: '雾港迁徙史', genres: ['fantasy'],
    description: '', status: 'drafting', targetWordCount: 300_000, createdAt: NOW, updatedAt: NOW,
  } as never) as number
  return { projectId, scope: (await resolveWorkspaceOwnership(projectId)).scope }
}

function request(mode: 'expand' | 'rewrite' | 'polish') {
  return `生成世界基座字段。目标字段=races；生成模式=${mode}。\n作者要求：补充可进入剧情的群体关系。`
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await db.delete()
})

describe.sequential('RACE-2 · races mode and finite output contract', () => {
  it('空字段自动执行 create；有原文时保留 expand/rewrite/polish 的作者选择', () => {
    expect(resolveWorldviewFieldOperationV1({ requestedMode: 'polish', currentValue: '' })).toBe('create')
    expect(resolveWorldviewFieldOperationV1({ requestedMode: 'expand', currentValue: '旧设定' })).toBe('expand')
    expect(resolveWorldviewFieldOperationV1({ requestedMode: 'rewrite', currentValue: '旧设定' })).toBe('rewrite')
    expect(resolveWorldviewFieldOperationV1({ requestedMode: 'polish', currentValue: '旧设定' })).toBe('polish')
  })

  it('“不限”只采用模型有限上限；default/custom 与四类 cap 可复算', () => {
    const agnes = { ...useAIConfigStore.getState().config, provider: 'agnes' as const, model: 'agnes-2.5-flash', baseUrl: 'https://apihub.agnes-ai.com/v1', maxTokens: 0 }
    const defaultBudget = resolveWorldviewFieldOutputBudgetV1({
      config: agnes, targetField: 'races', skillMaxOutputTokens: 6_000,
    })
    expect(defaultBudget).toMatchObject({
      source: 'default', requestedTokens: 6_000, effectiveMaxTokens: 6_000,
      effectiveCapTokens: 6_000, modelCapTokens: 65_500,
      authorConfigCapTokens: 65_500, longOutputMode: 'disabled',
    })
    expect(parseWorldviewFieldOutputBudgetV1(defaultBudget)).toEqual(defaultBudget)

    const custom = resolveWorldviewFieldOutputBudgetV1({
      config: agnes, targetField: 'races', skillMaxOutputTokens: 6_000, requestedMaxTokens: 4_800,
    })
    expect(custom).toMatchObject({ source: 'author-custom', effectiveMaxTokens: 4_800 })

    const kimi = resolveWorldviewFieldOutputBudgetV1({
      config: { ...agnes, provider: 'kimi', model: 'moonshot-v1-8k' },
      targetField: 'races', skillMaxOutputTokens: 6_000,
    })
    expect(kimi).toMatchObject({ effectiveCapTokens: 4_000, effectiveMaxTokens: 4_000 })
    expect(() => resolveWorldviewFieldOutputBudgetV1({
      config: agnes, targetField: 'races', skillMaxOutputTokens: 6_000, requestedMaxTokens: 6_001,
    })).toThrow('LONGOUT-1 尚未启用')
    expect(() => parseWorldviewFieldOutputBudgetV1({ ...custom, effectiveCapTokens: 99_999 }))
      .toThrow('派生不一致')
  })

  it('实际 prepare 冻结有效模式、补充说明与有限输出值，超限在模型前拒绝', async () => {
    const fixture = await seedWorkspace()
    const config = {
      ...useAIConfigStore.getState().config,
      provider: 'agnes' as const,
      model: 'agnes-2.5-flash',
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      maxTokens: 0,
    }
    const empty = await prepareWorldviewFieldCopilot({
      ...fixture,
      worldGroupId: null,
      authorRequest: request('rewrite'),
      supplementalContext: '尚未采纳的上游候选只作为本轮补充。',
      configOverride: config,
      generationOverrides: { maxTokens: 4_500 },
    })
    expect(empty.input.mode).toBe('create')
    expect(empty.input.outputBudget).toMatchObject({
      source: 'author-custom', effectiveMaxTokens: 4_500, longOutputMode: 'disabled',
    })
    expect(empty.prepared.messages.map(item => item.content).join('\n')).toContain('尚未采纳的上游候选')

    await db.worldviews.add(stampNewRecord(fixture.scope, 'worldviews', {
      projectId: fixture.projectId,
      races: '雾港人按潮痕结成家族。',
      createdAt: NOW,
      updatedAt: NOW,
    }, { owner: 'world' }) as never)
    for (const mode of ['expand', 'rewrite', 'polish'] as const) {
      const prepared = await prepareWorldviewFieldCopilot({
        ...fixture,
        worldGroupId: null,
        authorRequest: request(mode),
        configOverride: config,
      })
      expect(prepared.input.mode).toBe(mode)
      expect(prepared.input.outputBudget?.effectiveMaxTokens).toBe(6_000)
    }

    await expect(prepareWorldviewFieldCopilot({
      ...fixture,
      worldGroupId: null,
      authorRequest: request('expand'),
      configOverride: config,
      generationOverrides: { maxTokens: 6_001 },
    })).rejects.toThrow('模型调用前明确拒绝')
  })

  it('新普通入口的 V2 接受长字段；旧 V1 预算与解析只保历史语义', () => {
    // The real controls→host intent interaction is covered by R-WORLDVIEW-FIELD-V2-ui.
    const value = '种族条款。'.repeat(7000) + '完整尾标'
    const raw = JSON.stringify({ field: 'races', value })
    expect(parseWorldviewFieldCandidateDraftV2(raw).value).toBe(value)
    expect(() => parseWorldviewFieldCandidateDraft(raw)).toThrow()
  })

  it('provider 以 finish_reason=length 停止时，即使正文可解析也不能冒充完整候选', async () => {
    const fixture = await seedWorkspace()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: 'length',
        message: { content: JSON.stringify({ field: 'races', value: '看似完整但实际触顶的候选正文。' }) },
      }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    }), { status: 200 })))
    const prepared = await prepareWorldviewFieldCopilot({
      ...fixture,
      worldGroupId: null,
      authorRequest: request('expand'),
      configOverride: {
        ...useAIConfigStore.getState().config,
        provider: 'agnes',
        model: 'agnes-2.5-flash',
        apiKey: 'test-only',
      },
    })
    await expect(runGenerationNode(prepared.node, prepared.prepared))
      .rejects.toThrow(/候选不完整/)
  })
})
