import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { FIELD_BY_TARGET } from '../../src/lib/registry/field-registry'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import {
  parseReferenceDerivedResultStrictV1,
} from '../../src/lib/reference-analysis/derived-agent-plan'
import { readReferenceDerivedBaselineV1 } from '../../src/lib/reference-analysis/derived-agent-baseline'
import {
  abandonReferenceDerivedRunV1,
  adoptReferenceDerivedCandidateV1,
  generateReferenceDerivedCandidateV1,
  readPendingReferenceDerivedCandidateV1,
  readRecoverableReferenceDerivedRunV1,
  rejectReferenceDerivedCandidateV1,
  type ReferenceDerivedAdoptionBoundaryV1,
  type ReferenceDerivedBoundaryV1,
} from '../../src/lib/agent/run/reference-derived-durable'

async function seed(suffix = '', status: 'active' | 'ready' = 'active') {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: `参考分析${suffix}`, genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 80_000,
    createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `ref-${now}-${suffix}`, name: '参考世界', description: '', currentVersion: 1,
    createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: `分析作品${suffix}`, description: '', genres: ['fantasy'],
    status: 'drafting', targetWordCount: 80_000, createdAt: now, updatedAt: now,
  } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const referenceId = await db.references.add({
    projectId, workId, title: '镜海叙事样本', author: '作者甲', type: 'story', note: '', url: '',
    createdAt: now, updatedAt: now,
  } as any) as number
  const analysisRunId = await db.referenceAnalysisRuns.add({
    projectId, workId, referenceId, version: 1, status, depth: 'deep', sourceFilename: 'mirror.md',
    fileHash: 'a'.repeat(64), totalChars: 12_000, sourceKind: 'authorized',
    usageScope: 'creative-reference', rightsNote: '作者已获分析授权', rightsConfirmed: true,
    rightsDeclaredAt: now, expectedChunks: 2, completedChunks: 2, progress: 100,
    completedAt: now, ...(status === 'active' ? { activatedAt: now } : {}), createdAt: now, updatedAt: now,
  } as any) as number
  await db.referenceChunkAnalysis.bulkAdd([
    {
      projectId, workId, referenceId, analysisRunId, chunkIndex: 0, label: '开篇',
      narrativeStyle: '限知视角通过潮声与盐晶气味控制信息，只展示主角能感知的线索。',
      characterCraft: '镜商阿澄以拒绝登记和暗中记账的反差建立谨慎而反抗的性格。',
      createdAt: now,
    },
    {
      projectId, workId, referenceId, analysisRunId, chunkIndex: 1, label: '中段',
      narrativeStyle: '审讯段落切换短句与留白，让读者和主角同步发现账簿缺页。',
      characterCraft: '阿澄在行会中被称作小掌柜；她保护学徒时暴露承担责任的一面。',
      createdAt: now + 1,
    },
  ] as any)
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, referenceId, analysisRunId,
  }
}

function summaryResult(tag = '可核查') {
  return JSON.stringify({
    narrativeStyle: `${tag}：以限知视角、感官线索和短句留白控制信息释放。`,
    characterCraft: `${tag}：以拒绝登记、暗中记账和保护学徒的反差塑造阿澄。`,
  })
}

function characterResult(tag = '阿澄') {
  return JSON.stringify({
    characters: [{
      name: tag,
      role: '主角',
      summary: '谨慎而有责任感的镜商',
      analysis: '拒绝登记与暗中记账构成性格反差；保护学徒的行动补足其责任感。',
    }],
  })
}

describe.sequential('R-HARNESS74 · 参考分析派生 durable 候选与双投影采纳', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })

  it('三注册表闭合，版本化分块 baseline 实际进入一次模型调用，确认前双表零写入', async () => {
    expect(CONTEXT_SOURCE_BY_KEY.get('referenceDerivedBaseline')).toMatchObject({ ownerFrom: 'work', protectedFromTrim: true })
    expect(PROJECT_TABLES.find(item => item.name === 'referenceAnalysisRuns')).toMatchObject({ exportable: true })
    expect(PROJECT_TABLES.find(item => item.name === 'referenceChunkAnalysis')).toMatchObject({ exportable: true })
    expect(FIELD_BY_TARGET.get('referenceAnalysisRuns')?.map(field => field.field)).toContain('analysisSummary')
    expect(FIELD_BY_TARGET.get('references')?.map(field => field.field)).toContain('mergedCharacters')
    expect(getAgentSkillV1('inspiration.reference-summary')).toMatchObject({
      agentId: 'inspiration', executionMode: 'reference-summary',
    })
    const fixture = await seed()
    await expect(generateReferenceDerivedCandidateV1({
      scope: fixture.scope,
      mode: 'summary',
      runId: fixture.analysisRunId,
      aiConfig: { provider: 'openai', apiKey: '', model: '' } as any,
    })).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(0)
    let calls = 0
    const generated = await generateReferenceDerivedCandidateV1({
      scope: fixture.scope,
      mode: 'summary',
      runId: fixture.analysisRunId,
      runAI: async messages => {
        calls++
        const prompt = messages.map(message => message.content).join('\n')
        expect(prompt).toContain('镜海叙事样本')
        expect(prompt).toContain('限知视角')
        expect(prompt).toContain('作者已获分析授权')
        expect(prompt).toContain('【HARNESS-74 严格输出协议】')
        expect(prompt.split('【参考分析派生 Agent 正式输入基线】')).toHaveLength(2)
        return summaryResult()
      },
    })
    expect(calls).toBe(1)
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect((await db.referenceAnalysisRuns.get(fixture.analysisRunId))?.analysisSummary).toBeUndefined()
    expect((await db.references.get(fixture.referenceId))?.analysisSummary).toBeUndefined()
  })

  it('严格协议拒绝围栏、键缺失/乱序、额外字段与重复角色', async () => {
    const fixture = await seed('strict')
    const summaryBaseline = await readReferenceDerivedBaselineV1({
      scope: fixture.scope, runId: fixture.analysisRunId, mode: 'summary',
    })
    expect(parseReferenceDerivedResultStrictV1('summary', summaryResult(), summaryBaseline).resultJson)
      .toBe(summaryResult())
    expect(() => parseReferenceDerivedResultStrictV1('summary', `\`\`\`json\n${summaryResult()}\n\`\`\``, summaryBaseline))
      .toThrow('纯 JSON')
    expect(() => parseReferenceDerivedResultStrictV1('summary', JSON.stringify({ characterCraft: '先错序', narrativeStyle: '后错序' }), summaryBaseline))
      .toThrow('顺序')
    const characterBaseline = await readReferenceDerivedBaselineV1({
      scope: fixture.scope, runId: fixture.analysisRunId, mode: 'characters',
    })
    const duplicate = JSON.stringify({
      characters: [
        { name: '阿 澄', role: '主角', summary: '一', analysis: '分析一' },
        { name: '阿澄', role: '主角', summary: '二', analysis: '分析二' },
      ],
    })
    expect(() => parseReferenceDerivedResultStrictV1('characters', duplicate, characterBaseline)).toThrow('重复角色')
  })

  it('候选 checkpoint 后可恢复；模型请求或响应未知窗口不会自动重试', async () => {
    for (const boundary of ['model.requested', 'model.responded'] satisfies ReferenceDerivedBoundaryV1[]) {
      const fixture = await seed(boundary)
      let calls = 0
      await expect(generateReferenceDerivedCandidateV1({
        scope: fixture.scope, mode: 'summary', runId: fixture.analysisRunId,
        runAI: async () => { calls++; return summaryResult(boundary) },
        onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${boundary}`) },
      })).rejects.toThrow(`interrupt:${boundary}`)
      expect(calls).toBe(boundary === 'model.requested' ? 0 : 1)
      expect((await readRecoverableReferenceDerivedRunV1({
        scope: fixture.scope, mode: 'summary', analysisRunId: fixture.analysisRunId,
      }))?.safeToResume).toBe(false)
    }
    const fixture = await seed('checkpoint')
    await expect(generateReferenceDerivedCandidateV1({
      scope: fixture.scope, mode: 'characters', runId: fixture.analysisRunId,
      runAI: async () => characterResult(),
      onDurableBoundary: boundary => { if (boundary === 'candidate.checkpoint') throw new Error('interrupt:checkpoint') },
    })).rejects.toThrow('interrupt:checkpoint')
    const pending = await readPendingReferenceDerivedCandidateV1({
      scope: fixture.scope, mode: 'characters', analysisRunId: fixture.analysisRunId,
    })
    expect(JSON.parse(pending!.candidate.resultJson)[0].name).toBe('阿澄')
  })

  it('active 版本确认后原子语义收敛到 run 与兼容投影；ready 版本只写 run', async () => {
    const active = await seed('active')
    const summary = await generateReferenceDerivedCandidateV1({
      scope: active.scope, mode: 'summary', runId: active.analysisRunId, runAI: async () => summaryResult(),
    })
    const accepted = await adoptReferenceDerivedCandidateV1({ scope: active.scope, runId: summary.snapshot.run.id })
    expect(accepted.snapshot.projection.state).toBe('completed')
    expect((await db.referenceAnalysisRuns.get(active.analysisRunId))?.analysisSummary).toBe(summaryResult())
    expect((await db.references.get(active.referenceId))?.analysisSummary).toBe(summaryResult())

    const ready = await seed('ready', 'ready')
    const characters = await generateReferenceDerivedCandidateV1({
      scope: ready.scope, mode: 'characters', runId: ready.analysisRunId, runAI: async () => characterResult(),
    })
    await adoptReferenceDerivedCandidateV1({ scope: ready.scope, runId: characters.snapshot.run.id })
    expect(JSON.parse((await db.referenceAnalysisRuns.get(ready.analysisRunId))!.mergedCharacters!)[0].name).toBe('阿澄')
    expect((await db.references.get(ready.referenceId))?.mergedCharacters).toBeUndefined()
  })

  it.each([
    ['分块分析', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      const chunk = await db.referenceChunkAnalysis.where('analysisRunId').equals(fixture.analysisRunId).first()
      await db.referenceChunkAnalysis.update(chunk!.id!, { narrativeStyle: '作者重跑后得到新分析' })
    }],
    ['参考标题', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.references.update(fixture.referenceId, { title: '作者更名后的参考作品' })
    }],
    ['版本结果字段', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.referenceAnalysisRuns.update(fixture.analysisRunId, { analysisSummary: '{"author":"new"}' })
    }],
    ['active 兼容投影', async (fixture: Awaited<ReturnType<typeof seed>>) => {
      await db.references.update(fixture.referenceId, { analysisSummary: '{"author":"projection"}' })
    }],
  ] as const)('%s 漂移使候选 stale，作者内容不被覆盖', async (_label, mutate) => {
    const fixture = await seed(_label)
    const generated = await generateReferenceDerivedCandidateV1({
      scope: fixture.scope, mode: 'summary', runId: fixture.analysisRunId, runAI: async () => summaryResult(),
    })
    await mutate(fixture)
    await expect(adoptReferenceDerivedCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id }))
      .rejects.toThrow('已变化')
    expect((await db.referenceAnalysisRuns.get(fixture.analysisRunId))?.analysisSummary).not.toBe(summaryResult())
  })

  it.each<ReferenceDerivedAdoptionBoundaryV1>([
    'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.run-written',
    'formal.projection-written', 'formal.written', 'adoption.committed', 'step.succeeded',
    'verification.started', 'verification.accepted',
  ])('采纳在 %s 中断后沿冻结意图和双投影幂等收敛', async boundary => {
    const fixture = await seed(boundary)
    const generated = await generateReferenceDerivedCandidateV1({
      scope: fixture.scope, mode: 'summary', runId: fixture.analysisRunId,
      runAI: async () => summaryResult(boundary),
    })
    await expect(adoptReferenceDerivedCandidateV1({
      scope: fixture.scope,
      runId: generated.snapshot.run.id,
      onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${boundary}`) },
    })).rejects.toThrow(`interrupt:${boundary}`)
    const completed = await adoptReferenceDerivedCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect((await db.referenceAnalysisRuns.get(fixture.analysisRunId))?.analysisSummary).toBe(summaryResult(boundary))
    expect((await db.references.get(fixture.referenceId))?.analysisSummary).toBe(summaryResult(boundary))
    expect(completed.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
  })

  it('拒绝、来源删除、导入取消、Work 隔离、终态过期与旧旁路下线均 fail-closed', async () => {
    const rejected = await seed('reject')
    const rejectedRun = await generateReferenceDerivedCandidateV1({
      scope: rejected.scope, mode: 'characters', runId: rejected.analysisRunId, runAI: async () => characterResult(),
    })
    expect((await rejectReferenceDerivedCandidateV1({
      scope: rejected.scope, runId: rejectedRun.snapshot.run.id,
    })).projection.state).toBe('cancelled')

    const deleted = await seed('deleted')
    const deletedRun = await generateReferenceDerivedCandidateV1({
      scope: deleted.scope, mode: 'summary', runId: deleted.analysisRunId, runAI: async () => summaryResult(),
    })
    await db.referenceAnalysisRuns.delete(deleted.analysisRunId)
    await expect(adoptReferenceDerivedCandidateV1({ scope: deleted.scope, runId: deletedRun.snapshot.run.id })).rejects.toThrow()

    const terminal = await seed('terminal')
    const terminalRun = await generateReferenceDerivedCandidateV1({
      scope: terminal.scope, mode: 'summary', runId: terminal.analysisRunId, runAI: async () => summaryResult(),
    })
    await adoptReferenceDerivedCandidateV1({ scope: terminal.scope, runId: terminalRun.snapshot.run.id })
    await db.references.update(terminal.referenceId, { analysisSummary: '{"author":"override"}' })
    await expect(adoptReferenceDerivedCandidateV1({ scope: terminal.scope, runId: terminalRun.snapshot.run.id }))
      .rejects.toThrow('完成回执已过期')

    const pending = await seed('import')
    await generateReferenceDerivedCandidateV1({
      scope: pending.scope, mode: 'characters', runId: pending.analysisRunId, runAI: async () => characterResult(),
    })
    const importedId = await importProjectJSON(await exportProjectJSON(pending.projectId))
    expect((await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(run => run.contractJson.includes('inspiration.reference-characters'))?.status).toBe('cancelled')

    const otherWorkId = await db.works.add({
      projectId: pending.projectId, worldId: pending.worldId, title: '另一作品', description: '',
      genres: ['fantasy'], status: 'drafting', targetWordCount: 1_000, createdAt: Date.now(), updatedAt: Date.now(),
    } as any) as number
    expect(await readPendingReferenceDerivedCandidateV1({
      scope: { ...pending.scope, workId: otherWorkId }, mode: 'characters', analysisRunId: pending.analysisRunId,
    })).toBeNull()

    const viewer = readFileSync('src/components/project/AnalysisReportViewer.tsx', 'utf8')
    const hook = readFileSync('src/components/project/useReferenceDerivedAI.ts', 'utf8')
    expect(viewer).not.toContain("from '../../lib/ai/client'")
    expect(viewer).not.toContain('updateReferenceAnalysisDerived(')
    expect(viewer).not.toContain('buildSummaryPrompt(')
    expect(hook).not.toContain("target: 'referenceAnalysisRuns'")
    expect(hook).toContain('generateReferenceDerivedCandidateV1')
    expect(hook).toContain('adoptReferenceDerivedCandidateV1')
  })

  it('结果不可判定运行可显式放弃，但冻结采纳意图后不可取消', async () => {
    const unsafe = await seed('unsafe')
    await expect(generateReferenceDerivedCandidateV1({
      scope: unsafe.scope, mode: 'summary', runId: unsafe.analysisRunId, runAI: async () => summaryResult(),
      onDurableBoundary: boundary => { if (boundary === 'model.requested') throw new Error('interrupt') },
    })).rejects.toThrow('interrupt')
    const recoverable = await readRecoverableReferenceDerivedRunV1({
      scope: unsafe.scope, mode: 'summary', analysisRunId: unsafe.analysisRunId,
    })
    expect((await abandonReferenceDerivedRunV1({ scope: unsafe.scope, runId: recoverable!.snapshot.run.id })).projection.state)
      .toBe('cancelled')

    const frozen = await seed('frozen')
    const generated = await generateReferenceDerivedCandidateV1({
      scope: frozen.scope, mode: 'summary', runId: frozen.analysisRunId, runAI: async () => summaryResult(),
    })
    await expect(adoptReferenceDerivedCandidateV1({
      scope: frozen.scope, runId: generated.snapshot.run.id,
      onDurableBoundary: boundary => { if (boundary === 'intent.checkpoint') throw new Error('interrupt:intent') },
    })).rejects.toThrow('interrupt:intent')
    await expect(abandonReferenceDerivedRunV1({ scope: frozen.scope, runId: generated.snapshot.run.id }))
      .rejects.toThrow('意图已冻结')
  })
})
