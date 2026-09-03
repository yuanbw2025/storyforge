import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { StoryForgeDB } from '../../../src/lib/db/schema'

const databaseNames: string[] = []

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(name => Dexie.delete(name)))
})

describe('CURRENT-CONTENT-1 · v94 one-way canonical content migration', () => {
  it('preserves author text, creates canonical homes and leaves no retired writable fields', async () => {
    const name = `storyforge-current-content-${crypto.randomUUID()}`
    databaseNames.push(name)
    const previous = new Dexie(name)
    previous.version(93).stores({
      projects: '++id, name',
      worldviews: '++id, projectId, worldGroupId',
      geographies: '++id, projectId, worldGroupId',
      histories: '++id, projectId, worldGroupId',
      worldRulesProfiles: '++id, projectId, worldGroupId',
      storyCores: '++id, projectId',
      promptWorkflows: '++id, scope',
      importSessions: '++id, projectId',
      references: '++id, projectId',
      inspirationWorkspaces: '++id, projectId',
      referenceAnalysisRuns: '++id, projectId, referenceId',
      referenceChunkAnalysis: '++id, referenceId, analysisRunId, chunkIndex',
    })
    await previous.open()
    await previous.table('projects').add({ id: 1, name: '迁移作品' })
    await previous.table('worldviews').add({
      id: 10, projectId: 1, worldGroupId: 5, summary: '世界摘要',
      geography: '旧群岛地理', history: '旧历史总述', historyLine: '旧王朝年表',
      worldEvents: '旧纪元大事', society: '议会社会', politicsEconomyCulture: '城邦政治',
      economy: '潮币贸易', culture: '灯塔祭典', rules: '满月开启潮门',
      politicsOverview: '作者现有政治', createdAt: 1, updatedAt: 1,
    })
    await previous.table('geographies').add({
      id: 20, projectId: 1, worldGroupId: 5, overview: '作者现有地理',
      locations: '[]', createdAt: 1, updatedAt: 1,
    })
    await previous.table('histories').add({
      id: 30, projectId: 1, worldGroupId: 5, overview: '作者现有历史',
      eraSystem: '', events: '[]', createdAt: 1, updatedAt: 1,
    })
    await previous.table('storyCores').add({
      id: 40, projectId: 1, mainPlot: '作者现有主线', storyLines: '待归并主线',
      createdAt: 1, updatedAt: 1,
    })
    await previous.table('promptWorkflows').add({
      id: 50, scope: 'user', name: '显式化流程', description: '',
      steps: [
        { stepId: 'a', label: 'A', promptModuleKey: 'story.brief' },
        { stepId: 'b', label: 'B', promptModuleKey: 'story.core', inputMapping: { previousOutput: 'worldContext' } },
      ],
      createdAt: 1, updatedAt: 1,
    })
    await previous.table('importSessions').add({
      id: 60, projectId: 1,
      merged: { worldview: { geography: '导入地理', historyLine: '导入历史', society: '导入社会' } },
    })
    await previous.table('references').add({
      id: 70, projectId: 1, title: '参考作品', analysisStatus: 'done', analysisDepth: 'quick',
      importedData: { worldview: { rules: '参考规则', economy: '参考经济' } },
      createdAt: 1, updatedAt: 1,
    })
    await previous.table('referenceChunkAnalysis').add({
      id: 71, projectId: 1, referenceId: 70, chunkIndex: 0,
      openingTechnique: '开篇方法', createdAt: 1,
    })
    await previous.table('inspirationWorkspaces').add({
      id: 80, projectId: 1, fragments: '[{"text":"作者灵感"}]', versions: '[{"old":true}]',
      createdAt: 1, updatedAt: 1,
    })
    previous.close()

    const current = new StoryForgeDB(name)
    try {
      await current.open()
      expect(current.verno).toBe(94)

      const foundation = await current.worldviews.get(10) as unknown as Record<string, unknown>
      expect(foundation).toMatchObject({
        politicsOverview: '作者现有政治\n\n议会社会\n\n城邦政治',
        economyOverview: '潮币贸易',
        cultureOverview: '灯塔祭典',
      })
      for (const field of [
        'geography', 'history', 'historyLine', 'worldEvents', 'society',
        'politicsEconomyCulture', 'economy', 'culture', 'rules',
      ]) expect(foundation).not.toHaveProperty(field)

      expect((await current.geographies.get(20))?.overview).toBe('作者现有地理\n\n旧群岛地理')
      expect((await current.histories.get(30))?.overview)
        .toBe('作者现有历史\n\n旧历史总述\n\n旧王朝年表\n\n旧纪元大事')
      expect((await current.worldRulesProfiles.where('projectId').equals(1).first())?.globalNote)
        .toBe('满月开启潮门')

      const story = await current.storyCores.get(40) as unknown as Record<string, unknown>
      expect(story.mainPlot).toBe('作者现有主线\n\n待归并主线')
      expect(story).not.toHaveProperty('storyLines')

      const workflow = await current.promptWorkflows.get(50)
      expect(workflow?.graph.nodes.map(node => node.stepId)).toEqual(['a', 'b'])
      expect(workflow?.graph.edges).toMatchObject([{
        sourceStepId: 'a', targetStepId: 'b', targetVariable: 'worldContext',
      }])

      const imported = (await current.importSessions.get(60))?.merged as Record<string, any>
      expect(imported.geography.overview).toBe('导入地理')
      expect(imported.history.overview).toBe('导入历史')
      expect(imported.worldview.politicsOverview).toBe('导入社会')
      expect(imported.worldview).not.toHaveProperty('geography')

      const reference = await current.references.get(70)
      expect(reference?.importedData?.worldview).toMatchObject({ economyOverview: '参考经济' })
      expect(reference?.importedData?.worldview).not.toHaveProperty('rules')
      const run = await current.referenceAnalysisRuns.where('referenceId').equals(70).first()
      expect(run).toMatchObject({ version: 1, status: 'active', rightsConfirmed: false })
      expect((await current.referenceChunkAnalysis.get(71))?.analysisRunId).toBe(run?.id)

      expect((await current.inspirationWorkspaces.get(80))?.fragments).toContain('作者灵感')
      expect((await current.inspirationWorkspaces.get(80))?.versions).toBe('[]')
    } finally {
      current.close()
    }
  })
})
