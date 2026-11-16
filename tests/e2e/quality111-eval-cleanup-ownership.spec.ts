import { expect, test } from '@playwright/test'

test('eval cleanup survives an actual interrupted runner reload without deleting ordinary author data', async ({ browser, baseURL }, info) => {
  if (!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) throw new Error('Private loopback workspace required')
  const origin = new URL(baseURL).origin
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  let modelRequests = 0
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (/\/chat\/completions|\/(?:responses|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)/.test(url.pathname)) {
      modelRequests += 1; return route.abort()
    }
    return url.origin === origin && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort()
  })
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'sfqa111-isolated'))
  const page = await context.newPage()
  try {
    await page.goto('./')
    const seeded = await page.evaluate(async () => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const [{ db }, { createWorkspace }, { stampNewRecord }, owned, h86] = await Promise.all([
        load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
        load<typeof import('../../src/lib/workspace/create-workspace')>('/storyforge/src/lib/workspace/create-workspace.ts'),
        load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts'),
        load<typeof import('../../src/lib/evals/workspace-ownership')>('/storyforge/src/lib/evals/workspace-ownership.ts'),
        load<typeof import('../../src/lib/evals/agent-harness/story-arc-main-path')>('/storyforge/src/lib/evals/agent-harness/story-arc-main-path.ts'),
      ])
      if (await db.projects.count()) throw new Error('Expected empty private IndexedDB')
      const author = await createWorkspace({ name: '[H86-EVAL] 普通作者同名作品', genres: ['fantasy'],
        description: '[RACE6-EVAL] isolated transcript/outcome workspace 这只是作者的引用', status: 'drafting', targetWordCount: 100_000 },
      { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
      const now = Date.now(), scope = author.scope
      const outlineId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
        projectId: scope.projectId, parentId: null, type: 'chapter', title: '作者原章纲', summary: '原有章纲不能被清理', order: 0, createdAt: now, updatedAt: now,
      }, { owner: 'work' }))
      const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
        projectId: scope.projectId, outlineNodeId: outlineId, title: '作者第一章', content: '普通作者正文\n必须精确保留第二段。',
        wordCount: 19, status: 'draft', order: 0, notes: '作者笔记', createdAt: now, updatedAt: now,
      }, { owner: 'work' }))
      const authorBefore = JSON.stringify({ project: await db.projects.get(scope.projectId), world: await db.worlds.get(scope.worldId),
        work: await db.works.get(scope.workId), outline: await db.outlineNodes.get(outlineId), chapter: await db.chapters.get(chapterId) })
      const runA = `h86-native111-${crypto.randomUUID()}`, runB = `h86-other111-${crypto.randomUUID()}`
      const create = (suite: Parameters<typeof owned.createOwnedEvalWorkspaceV1>[0]['suite'], runId: string,
        existingLease?: Parameters<typeof owned.withEvalWorkspaceRunLeaseV1>[0]['lease']) => owned.withEvalWorkspaceRunLeaseV1({ suite, runId, lease: existingLease }, lease => owned.createOwnedEvalWorkspaceV1({
        suite, runId, lease, workspace: { name: '真实隔离评测数据', genres: ['fantasy'], description: '仅评测所有', status: 'drafting', targetWordCount: 100_000 },
        options: { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' },
      }))
      type Created = Awaited<ReturnType<typeof create>>
      let reached!: (workspace: Created) => void, failed!: (reason: unknown) => void
      const createdA = new Promise<Created>((resolve, reject) => { reached = resolve; failed = reject })
      // The real runner persists its checkpoint and hands its actual runId to
      // the dependency before allocation. Reload interrupts here, before any AI.
      void h86.runH86StoryArcMainPathEvalV1({ runId: runA, codeRevision: 'sfqa111-private-native',
        generator: { provider: 'custom', model: 'synthetic-generator', promptVersion: h86.H86_GENERATOR_PAIR_VERSION_V1 },
        verifier: { provider: 'openai', model: 'synthetic-verifier', promptVersion: h86.H86_VERIFIER_PROMPT_VERSION_V1 },
        dependencies: {
          generate: async call => {
            if (call.evalRunId !== runA) throw new Error('Runner lost its actual ownership identity')
            const workspace = await create('h86-story-arc', call.evalRunId, call.evalRunLease)
            reached(workspace)
            return new Promise<never>(() => {})
          },
          verify: async () => { throw new Error('No model/verifier may run') },
        },
        onCheckpoint: value => h86.persistH86CheckpointV1(value),
      }).then(() => failed(new Error('Expected interrupted eval')), failed)
      const a = await createdA
      const b = await create('h86-story-arc', runB), c = await create('creative-reliability', runA), d = await create('races-gateway', runA)
      await db.projects.update(a.scope.projectId, { name: '重命名后仍属于原评测' })
      return { scope, outlineId, chapterId, authorBefore, runA, runB,
        evalIds: [a.scope.projectId, b.scope.projectId, c.scope.projectId, d.scope.projectId] }
    })
    const second = await context.newPage()
    await second.goto('./')
    const activeProof = await second.evaluate(async seed => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const [{ db }, browser, h86] = await Promise.all([
        load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
        load<typeof import('../../src/lib/evals/agent-harness/story-arc-main-path-browser')>('/storyforge/src/lib/evals/agent-harness/story-arc-main-path-browser.ts'),
        load<typeof import('../../src/lib/evals/agent-harness/story-arc-main-path')>('/storyforge/src/lib/evals/agent-harness/story-arc-main-path.ts'),
      ])
      const checkpoint = await h86.loadH86CheckpointV1()
      if (!checkpoint) throw new Error('Missing current actual run')
      const rawBefore = JSON.stringify(checkpoint)
      const deleted = await browser.cleanupStrandedH86WorkspacesV1(seed.runA)
      let blocked = false, clearBlocked = false, checkpointWrites = 0
      try { await h86.clearH86CheckpointV1(checkpoint.runId) }
      catch (cause) { clearBlocked = cause instanceof Error && cause.message.includes('仍在另一页面执行') }
      try {
        await h86.runH86StoryArcMainPathEvalV1({ runId: checkpoint.runId, codeRevision: checkpoint.codeRevision,
          generator: checkpoint.generator, verifier: checkpoint.verifier, resumeFrom: checkpoint,
          dependencies: { generate: async () => { throw new Error('A second generation must not start') }, verify: async () => { throw new Error('A verifier must not start') } },
          onCheckpoint: async value => { checkpointWrites += 1; await h86.persistH86CheckpointV1(value) },
        })
      } catch (cause) { blocked = cause instanceof Error && cause.message.includes('仍在另一页面执行') }
      return { deleted, activeRootPreserved: !!await db.projects.get(seed.evalIds[0]), blocked, clearBlocked, checkpointWrites,
        checkpointUnchanged: JSON.stringify(await h86.loadH86CheckpointV1()) === rawBefore }
    }, seeded)
    expect(activeProof).toEqual({ deleted: 0, activeRootPreserved: true, blocked: true, clearBlocked: true, checkpointWrites: 0, checkpointUnchanged: true })
    await second.close()
    await page.reload()
    const proof = await page.evaluate(async seed => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const [{ db }, h86, crel, race, checkpointApi, projectStore] = await Promise.all([
        load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
        load<typeof import('../../src/lib/evals/agent-harness/story-arc-main-path-browser')>('/storyforge/src/lib/evals/agent-harness/story-arc-main-path-browser.ts'),
        load<typeof import('../../src/lib/evals/creative-reliability/browser')>('/storyforge/src/lib/evals/creative-reliability/browser.ts'),
        load<typeof import('../../src/lib/evals/races-gateway/runner')>('/storyforge/src/lib/evals/races-gateway/runner.ts'),
        load<typeof import('../../src/lib/evals/agent-harness/story-arc-main-path')>('/storyforge/src/lib/evals/agent-harness/story-arc-main-path.ts'),
        load<typeof import('../../src/stores/project')>('/storyforge/src/stores/project.ts'),
      ])
      const checkpoint = await checkpointApi.loadH86CheckpointV1()
      if (checkpoint?.runId !== seed.runA) throw new Error('Actual interrupted checkpoint was not restored')
      projectStore.useProjectStore.getState().setCurrentProject(seed.scope.projectId)
      const first = await h86.cleanupStrandedH86WorkspacesV1(checkpoint.runId)
      const remainingAfterA = await Promise.all(seed.evalIds.slice(1).map(id => db.projects.get(id)))
      const others = [await h86.cleanupStrandedH86WorkspacesV1(seed.runB),
        await crel.cleanupStrandedCreativeReliabilityWorkspacesV1(seed.runA),
        await race.cleanupRacesGatewayEvalProjectsV1(seed.runA)]
      const idempotent = await h86.cleanupStrandedH86WorkspacesV1(seed.runA)
      const authorAfter = JSON.stringify({ project: await db.projects.get(seed.scope.projectId), world: await db.worlds.get(seed.scope.worldId),
        work: await db.works.get(seed.scope.workId), outline: await db.outlineNodes.get(seed.outlineId), chapter: await db.chapters.get(seed.chapterId) })
      const ownershipKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter(key => key?.startsWith('storyforge:eval-workspace-ownership:v1:'))
      return { restoredActualRun: checkpoint.runId === seed.runA, first, others, idempotent,
        unrelatedRunsInitiallyPreserved: remainingAfterA.every(Boolean), authorExact: authorAfter === seed.authorBefore,
        authorCurrent: projectStore.useProjectStore.getState().currentProjectId === seed.scope.projectId,
        remainingProjects: await db.projects.count(), ownedRemaining: (await db.projects.bulkGet(seed.evalIds)).filter(Boolean).length,
        remainingOwnershipReceipts: ownershipKeys.length, state: checkpoint.status }
    }, seeded)
    expect(proof).toMatchObject({ restoredActualRun: true, first: 1, others: [1, 1, 1], idempotent: 0,
      unrelatedRunsInitiallyPreserved: true, authorExact: true, authorCurrent: true, remainingProjects: 1, ownedRemaining: 0, remainingOwnershipReceipts: 0, state: 'running' })
    const forgery = await page.evaluate(async seed => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const [{ db }, owned, browser] = await Promise.all([
        load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
        load<typeof import('../../src/lib/evals/workspace-ownership')>('/storyforge/src/lib/evals/workspace-ownership.ts'),
        load<typeof import('../../src/lib/evals/agent-harness/story-arc-main-path-browser')>('/storyforge/src/lib/evals/agent-harness/story-arc-main-path-browser.ts'),
      ])
      const author = await db.projects.get(seed.scope.projectId)
      if (!author) throw new Error('The real author fixture must remain present')
      const runId = 'native-forged-' + crypto.randomUUID()
      const allocated = await owned.withEvalWorkspaceRunLeaseV1({ suite: 'h86-story-arc', runId }, lease =>
        owned.createOwnedEvalWorkspaceV1({ suite: 'h86-story-arc', runId, lease,
          workspace: { name: '本机评测签发夹具', genres: [], description: '', status: 'drafting', targetWordCount: 1000 } }))
      const key = 'storyforge:eval-workspace-ownership:v1:' + allocated.project.workspaceUid
      const copied = JSON.parse(localStorage.getItem(key)!)
      const authorKey = 'storyforge:eval-workspace-ownership:v1:' + author.workspaceUid
      const forged = JSON.stringify({ ...copied, projectId: author.id, workspaceUid: author.workspaceUid, projectCreatedAt: author.createdAt })
      localStorage.setItem(authorKey, forged)
      const nonOwner = await browser.cleanupStrandedH86WorkspacesV1('different-' + runId)
      const owner = await browser.cleanupStrandedH86WorkspacesV1(runId)
      return { nonOwner, owner, ownedRemoved: !await db.projects.get(allocated.scope.projectId),
        authorUnchanged: JSON.stringify(await db.projects.get(author.id!)) === JSON.stringify(author),
        forgedRetained: localStorage.getItem(authorKey) === forged,
        manuscript: await db.chapters.get(seed.chapterId) }
    }, seeded)
    expect(forgery).toMatchObject({ nonOwner: 0, owner: 1, ownedRemoved: true, authorUnchanged: true, forgedRetained: true })
    expect(forgery.manuscript?.content).toBe('普通作者正文\n必须精确保留第二段。')
    expect(modelRequests).toBe(0)
    await info.attach('eval-run-ownership-cleanup', { body: Buffer.from(JSON.stringify({ proof, activeProof, forgery, modelRequests }, null, 2)), contentType: 'application/json' })
  } finally { await context.close() }
})
