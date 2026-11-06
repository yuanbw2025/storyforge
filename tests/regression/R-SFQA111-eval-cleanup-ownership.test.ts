import { installEvalWebLocksFixtureV1 } from '../helpers/eval-web-locks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import * as lifecycle from '../../src/lib/registry/lifecycle'
import { createOwnedEvalWorkspaceV1, withEvalWorkspaceRunLeaseV1, cleanupOwnedEvalWorkspaceV1, type EvalWorkspaceRunLeaseV1, type EvalWorkspaceSuiteV1 } from '../../src/lib/evals/workspace-ownership'
import { cleanupStrandedH86WorkspacesV1, createH86BrowserRunDependenciesV1 } from '../../src/lib/evals/agent-harness/story-arc-main-path-browser'
import { cleanupStrandedCreativeReliabilityWorkspacesV1, createCreativeReliabilityBrowserDependenciesV1 } from '../../src/lib/evals/creative-reliability/browser'
import { cleanupRacesGatewayEvalProjectsV1, clearRacesGatewayEvalCheckpointV1, loadRacesGatewayEvalCheckpointV1, runRacesGatewayEvalV1 } from '../../src/lib/evals/races-gateway/runner'
import { RACES_GATEWAY_EVAL_STORAGE_KEY_V21 } from '../../src/lib/evals/races-gateway/types'
import { RACES_GATEWAY_EVAL_FIXTURES_V1 } from '../../src/lib/evals/races-gateway/fixtures'
import * as adoption from '../../src/lib/registry/adopt'
import type { AIConfig } from '../../src/lib/types'
import { H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1 } from '../../src/lib/evals/agent-harness/story-arc-main-path-fixtures'
import { CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1 } from '../../src/lib/evals/creative-reliability/fixtures'
import { H86_GENERATOR_PAIR_VERSION_V1, H86_VERIFIER_PROMPT_VERSION_V1, H86_STORY_ARC_STORAGE_KEY_V1, clearH86CheckpointV1, loadH86CheckpointV1, persistH86CheckpointV1, runH86StoryArcMainPathEvalV1 } from '../../src/lib/evals/agent-harness/story-arc-main-path'
import { CREATIVE_RELIABILITY_CHECKPOINT_STORAGE_KEY_V1, clearCreativeReliabilityEvalCheckpointV1, persistCreativeReliabilityEvalCheckpointV1, runCreativeReliabilityEvalV1 } from '../../src/lib/evals/creative-reliability/runner'
import { H86_HUMAN_REVIEW_STORAGE_KEY_V1, clearH86HumanReviewV1 } from '../../src/lib/evals/agent-harness/story-arc-human-review'

const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('SFQA111 forbids model/network calls') })
let restoreEvalWebLocks: (() => void) | undefined
beforeEach(async () => {
  restoreEvalWebLocks = installEvalWebLocksFixtureV1()
  await db.delete(); await db.open()
  localStorage.clear(); sessionStorage.clear(); fetcher.mockClear(); vi.stubGlobal('fetch', fetcher)

})
afterEach(async () => {
  restoreEvalWebLocks?.()
  expect(fetcher).not.toHaveBeenCalled()
  vi.unstubAllGlobals(); vi.restoreAllMocks(); await db.delete()
})

async function ordinaryManuscript(name: string, description = '') {
  const created = await createWorkspace({ name, genres: ['fantasy'], description,
    status: 'drafting', targetWordCount: 100_000 }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
  const { scope } = created, now = Date.now()
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    projectId: scope.projectId, parentId: null, type: 'chapter', title: '作者第一章', summary: '属于普通作者的完整章纲',
    order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'work' }))
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    projectId: scope.projectId, outlineNodeId, title: '作者第一章', content: '这份作者正文和手写笔记不属于任何评测。\n第二段必须原样保留。',
    wordCount: 37, status: 'draft', order: 0, notes: '作者手写笔记', createdAt: now, updatedAt: now,
  }, { owner: 'work' }))
  return { scope, outlineNodeId, chapterId, project: await db.projects.get(scope.projectId),
    world: await db.worlds.get(scope.worldId), work: await db.works.get(scope.workId),
    chapter: await db.chapters.get(chapterId), outline: await db.outlineNodes.get(outlineNodeId) }
}
async function expectManuscriptPreserved(f: Awaited<ReturnType<typeof ordinaryManuscript>>) {
  expect(await db.chapters.get(f.chapterId)).toEqual(f.chapter)
  expect(await db.outlineNodes.get(f.outlineNodeId)).toEqual(f.outline)
  expect(await db.projects.get(f.scope.projectId)).toEqual(f.project)
  expect(await db.worlds.get(f.scope.worldId)).toEqual(f.world)
  expect(await db.works.get(f.scope.workId)).toEqual(f.work)
}

function ownershipKeys() {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => key != null && key.startsWith('storyforge:eval-workspace-ownership:v1:'))
}
async function ownedWorkspace(suite: EvalWorkspaceSuiteV1, runId: string) {
  return withEvalWorkspaceRunLeaseV1({ suite, runId }, lease => createOwnedEvalWorkspaceV1({ suite, runId, lease,
    workspace: { name: '当前评测临时工作区', genres: ['fantasy'], description: '仅合成夹具', status: 'drafting', targetWordCount: 100_000 },
    options: { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' } }))
}

async function initialPublicCheckpoint(suite: EvalWorkspaceSuiteV1) {
  const runId = `sfqa111-clear-${crypto.randomUUID()}`
  const stop = () => { throw new Error('SFQA111 initial checkpoint only') }
  if (suite === 'h86-story-arc') {
    await expect(runH86StoryArcMainPathEvalV1({ runId, codeRevision: 'sfqa111-synthetic',
      generator: { provider: 'custom', model: 'synthetic-generator', promptVersion: H86_GENERATOR_PAIR_VERSION_V1 },
      verifier: { provider: 'custom', model: 'synthetic-verifier', promptVersion: H86_VERIFIER_PROMPT_VERSION_V1 },
      dependencies: { generate: async () => stop(), verify: async () => stop() },
      onCheckpoint: async checkpoint => { await persistH86CheckpointV1(checkpoint); stop() },
    })).rejects.toThrow('SFQA111 initial checkpoint only')
    return { runId, key: H86_STORY_ARC_STORAGE_KEY_V1, clear: clearH86CheckpointV1 }
  }
  if (suite === 'creative-reliability') {
    await expect(runCreativeReliabilityEvalV1({ runId, codeRevision: 'sfqa111-synthetic', suiteVersion: 'sfqa111-synthetic',
      fixtures: CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1,
      generator: { provider: 'custom', model: 'synthetic-generator', promptVersion: 'synthetic-generator' },
      verifier: { provider: 'custom', model: 'synthetic-verifier', promptVersion: 'synthetic-verifier' },
      parameters: { temperature: 0, maxOutputTokens: 1024 },
      dependencies: { generate: async () => stop(), verify: async () => stop() },
      onCheckpoint: async checkpoint => { await persistCreativeReliabilityEvalCheckpointV1(checkpoint); stop() },
    })).rejects.toThrow('SFQA111 initial checkpoint only')
    return { runId, key: CREATIVE_RELIABILITY_CHECKPOINT_STORAGE_KEY_V1, clear: clearCreativeReliabilityEvalCheckpointV1 }
  }
  await expect(runRacesGatewayEvalV1({
    modelIdentity: { provider: 'custom', model: 'synthetic-generator' },
    generatorConfig: { provider: 'custom', model: 'synthetic-generator', apiKey: 'synthetic-no-network',
      baseUrl: 'https://sfqa111.invalid/v1', temperature: 0, maxTokens: 1024 },
    graderIdentity: { provider: 'nvidia', model: 'synthetic-grader', promptVersion: 'synthetic-grader' },
    graderPreflight: { provider: 'nvidia', model: 'synthetic-grader', promptVersion: 'synthetic-grader',
      inputHash: '1'.repeat(64), outputHash: '2'.repeat(64), inputTokens: 10, outputTokens: 10, finishReason: 'stop', durationMs: 1 },
    fixtures: [RACES_GATEWAY_EVAL_FIXTURES_V1[0]], grade: async () => stop(), onProgress: stop,
  })).rejects.toThrow('SFQA111 initial checkpoint only')
  const actualRunId = loadRacesGatewayEvalCheckpointV1()?.workspaceOwnerId
  if (!actualRunId) throw new Error('Expected actual RACE runner ownership checkpoint')
  return { runId: actualRunId, key: RACES_GATEWAY_EVAL_STORAGE_KEY_V21, clear: clearRacesGatewayEvalCheckpointV1 }
}

describe('SFQA111: evaluation cleanup never derives ownership from editable author text', () => {
  it.each([
    { name: '[H86-EVAL] 普通作者同名作品', cleanup: cleanupStrandedH86WorkspacesV1 },
    { name: '[CREL-EVAL] 普通作者同名作品', cleanup: cleanupStrandedCreativeReliabilityWorkspacesV1 },
  ])('preserves an ordinary workspace named $name through the public cleanup', async ({ name, cleanup }) => {
    const manuscript = await ordinaryManuscript(name, '这是作者填写的正常作品简介。')
    const deleted = await cleanup()
    await expectManuscriptPreserved(manuscript)
    expect(deleted).toBe(0)
  })

  it('preserves an ordinary work whose description matches the RACE marker', async () => {
    const manuscript = await ordinaryManuscript('普通作者作品', '[RACE6-EVAL] isolated transcript/outcome workspace 作者引用的正常简介')
    const deleted = await cleanupRacesGatewayEvalProjectsV1()
    await expectManuscriptPreserved(manuscript)
    expect(deleted).toBe(0)
  })

  it('keeps unmarked ordinary author content and active owner roots intact', async () => {
    const manuscript = await ordinaryManuscript('普通作者作品', '正常简介')
    expect(await cleanupStrandedH86WorkspacesV1()).toBe(0)
    expect(await cleanupStrandedCreativeReliabilityWorkspacesV1()).toBe(0)
    expect(await cleanupRacesGatewayEvalProjectsV1()).toBe(0)
    await expectManuscriptPreserved(manuscript)
  })

  it.each([
    { suite: 'h86-story-arc' as const, cleanup: cleanupStrandedH86WorkspacesV1 },
    { suite: 'creative-reliability' as const, cleanup: cleanupStrandedCreativeReliabilityWorkspacesV1 },
    { suite: 'races-gateway' as const, cleanup: cleanupRacesGatewayEvalProjectsV1 },
  ])('$suite cleans actual run-owned roots after renaming, retaining ordinary manuscripts', async ({ suite, cleanup }) => {
    const manuscript = await ordinaryManuscript('[H86-EVAL] 普通作者', '[RACE6-EVAL] isolated transcript/outcome workspace 正常引用')
    const runId = `sfqa111-${crypto.randomUUID()}`, owned = await ownedWorkspace(suite, runId)
    expect(ownershipKeys()).toHaveLength(1)
    await db.projects.update(owned.scope.projectId, { name: '作者更名不能改变评测所有权' })
    await db.works.update(owned.scope.workId, { description: '不再含任何评测前缀' })
    // A reconstructed caller needs only its persisted run identity, not a
    // live in-memory workspace handle. This is the reload cleanup boundary.
    expect(await cleanup(runId)).toBe(1)
    expect(await db.projects.get(owned.scope.projectId)).toBeUndefined()
    expect(await db.worlds.get(owned.scope.worldId)).toBeUndefined()
    expect(await db.works.get(owned.scope.workId)).toBeUndefined()
    expect(ownershipKeys()).toHaveLength(0)
    expect(await cleanup(runId)).toBe(0)
    await expectManuscriptPreserved(manuscript)
    expect(manuscript.project?.activeWorldId).toBe(manuscript.scope.worldId)
    expect(manuscript.project?.activeWorkId).toBe(manuscript.scope.workId)
  })

  it('concurrent eval runs and different suites cannot delete one another', async () => {
    const a = await ownedWorkspace('h86-story-arc', 'run-a')
    const b = await ownedWorkspace('h86-story-arc', 'run-b')
    const otherSuite = await ownedWorkspace('creative-reliability', 'run-a')
    expect(await cleanupStrandedH86WorkspacesV1('run-a')).toBe(1)
    expect(await db.projects.get(a.scope.projectId)).toBeUndefined()
    expect(await db.projects.get(b.scope.projectId)).toBeDefined()
    expect(await db.projects.get(otherSuite.scope.projectId)).toBeDefined()
    expect(await cleanupStrandedH86WorkspacesV1('run-b')).toBe(1)
    expect(await cleanupStrandedCreativeReliabilityWorkspacesV1('run-a')).toBe(1)
    expect(ownershipKeys()).toHaveLength(0)
  })

  it('a failed registered cascade retains the exact ownership receipt for retry', async () => {
    const owned = await ownedWorkspace('creative-reliability', 'run-failure')
    const key = ownershipKeys()[0], before = localStorage.getItem(key)
    const failure = vi.spyOn(lifecycle, 'cascadeDeleteProject').mockRejectedValueOnce(new Error('Injected registered delete failure'))
    await expect(cleanupStrandedCreativeReliabilityWorkspacesV1('run-failure')).rejects.toThrow('Injected registered delete failure')
    expect(await db.projects.get(owned.scope.projectId)).toBeDefined()
    expect(localStorage.getItem(key)).toBe(before)
    failure.mockRestore()
    expect(await cleanupStrandedCreativeReliabilityWorkspacesV1('run-failure')).toBe(1)
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('a reused numeric ID with a different immutable workspace UID is retained', async () => {
    const owned = await ownedWorkspace('h86-story-arc', 'run-uid')
    await db.projects.update(owned.scope.projectId, { workspaceUid: generateWorkspaceUid() })
    const changed = await db.projects.get(owned.scope.projectId)
    expect(await cleanupStrandedH86WorkspacesV1('run-uid')).toBe(0)
    expect(await db.projects.get(owned.scope.projectId)).toEqual(changed)
    expect(await db.works.get(owned.scope.workId)).toBeDefined()
    expect(ownershipKeys()).toHaveLength(1)
  })

  it('corrupt or unknown ownership data cannot authorize deletion', async () => {
    const owned = await ownedWorkspace('races-gateway', 'run-corrupt')
    const key = ownershipKeys()[0]
    localStorage.setItem(key, '{"version":1,"projectId":' + owned.scope.projectId + '}')
    expect(await cleanupRacesGatewayEvalProjectsV1('run-corrupt')).toBe(0)
    expect(await db.projects.get(owned.scope.projectId)).toBeDefined()
    expect(localStorage.getItem(key)).not.toBeNull()
  })

  it('refuses allocation when the creation receipt cannot be persisted', async () => {
    vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => { throw new DOMException('Synthetic quota', 'QuotaExceededError') })
    await expect(ownedWorkspace('h86-story-arc', 'run-no-receipt')).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(await db.projects.count()).toBe(0)
    expect(ownershipKeys()).toHaveLength(0)
  })

  it('retains preallocation ownership long enough to clean a postallocation receipt-write failure', async () => {
    const setItem = localStorage.setItem.bind(localStorage)
    let writes = 0
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key.startsWith('storyforge:eval-workspace-ownership:v1:') && ++writes === 2) {
        throw new DOMException('Synthetic final receipt quota', 'QuotaExceededError')
      }
      setItem(key, value)
    })
    await expect(ownedWorkspace('creative-reliability', 'run-after-allocation')).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(writes).toBe(2)
    expect(await db.projects.count()).toBe(0)
    expect(await db.worlds.count()).toBe(0)
    expect(await db.works.count()).toBe(0)
    expect(ownershipKeys()).toHaveLength(0)
  })


  it.each(['h86', 'crel'] as const)('%s seed adoption failure cleans only its newly created private workspace before any model', async suite => {
    const manuscript = await ordinaryManuscript('[H86-EVAL] 正常作者', '作者正文的正常简介')
    const config: AIConfig = { provider: 'custom', model: 'sfqa111-no-model', apiKey: 'synthetic-no-network',
      baseUrl: 'https://sfqa111.invalid/v1', temperature: 0, maxTokens: 1024, contextWindow: 128_000 }
    vi.spyOn(adoption, 'adopt').mockRejectedValueOnce(new Error('Injected seed adoption failure'))
    const generating = suite === 'h86'
      ? createH86BrowserRunDependenciesV1({ generatorConfig: config, verifierConfig: config }).generate({
        evalRunId: 'run-h86-seed-failed', fixture: H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1[0],
        variant: 'baseline-direct', generator: { provider: config.provider, model: config.model, promptVersion: 'synthetic' }, attempt: 1,
      })
      : createCreativeReliabilityBrowserDependenciesV1({ generatorConfig: config, verifierConfig: config }).generate({
        evalRunId: 'run-crel-seed-failed', fixture: CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1[0],
        variant: 'baseline-direct', identity: { provider: config.provider, model: config.model, promptVersion: 'synthetic' },
        parameters: { temperature: 0, maxOutputTokens: 1024 },
      })
    await expect(generating).rejects.toThrow('Injected seed adoption failure')
    expect(await db.projects.count()).toBe(1)
    expect(ownershipKeys()).toHaveLength(0)
    await expectManuscriptPreserved(manuscript)
    expect(fetcher).not.toHaveBeenCalled()
  })


  it('a second page resuming the same checkpoint cannot pre-clean a still-active eval workspace', async () => {
    const manuscript = await ordinaryManuscript('普通作者作品', '作者不参与并发评测')
    const config: AIConfig = { provider: 'custom', model: 'sfqa111-no-model', apiKey: 'synthetic-no-network',
      baseUrl: 'https://sfqa111.invalid/v1', temperature: 0, maxTokens: 1024, contextWindow: 128_000 }
    let enter!: () => void, release!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(adoption, 'adopt').mockImplementationOnce(async () => {
      enter(); await gate
      throw new Error('Controlled active seed stopped before AI')
    })
    const active = createH86BrowserRunDependenciesV1({ generatorConfig: config, verifierConfig: config }).generate({
      evalRunId: 'same-checkpoint-run', fixture: H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1[0],
      variant: 'baseline-direct', generator: { provider: config.provider, model: config.model, promptVersion: 'synthetic' }, attempt: 1,
    }).then(() => null, (cause: unknown) => cause)
    try {
      await entered
      const owned = (await db.projects.toArray()).filter(row => row.id !== manuscript.scope.projectId)
      expect(owned).toHaveLength(1)
      // This is the exact public pre-cleanup called by a second eval panel
      // before resuming the same persisted run, while A is still active.
      expect(await cleanupStrandedH86WorkspacesV1('same-checkpoint-run')).toBe(0)
      expect(await db.projects.get(owned[0].id!)).toEqual(owned[0])
      await expectManuscriptPreserved(manuscript)
    } finally {
      release()
      expect(await active).toBeInstanceOf(Error)
    }
    expect(fetcher).not.toHaveBeenCalled()
  })


  it('missing native lock capability preserves existing data and refuses new allocation', async () => {
    const owned = await ownedWorkspace('h86-story-arc', 'run-no-locks')
    const key = ownershipKeys()[0], receipt = localStorage.getItem(key)
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    await expect(cleanupStrandedH86WorkspacesV1('run-no-locks')).rejects.toThrow('无法确认其他页面')
    await expect(ownedWorkspace('h86-story-arc', 'run-no-lock-new')).rejects.toThrow('无法确认其他页面')
    expect(await db.projects.get(owned.scope.projectId)).toBeDefined()
    expect(await db.projects.count()).toBe(1)
    expect(localStorage.getItem(key)).toBe(receipt)
  })

  it('a rejected lock request never deletes a root or discards its receipt', async () => {
    const owned = await ownedWorkspace('creative-reliability', 'run-lock-error')
    const key = ownershipKeys()[0], receipt = localStorage.getItem(key)
    vi.spyOn(navigator.locks, 'request').mockImplementationOnce(async () => { throw new Error('Synthetic native lock request failure') })
    await expect(cleanupStrandedCreativeReliabilityWorkspacesV1('run-lock-error')).rejects.toThrow('Synthetic native lock request failure')
    expect(await db.projects.get(owned.scope.projectId)).toBeDefined()
    expect(localStorage.getItem(key)).toBe(receipt)
    expect(await cleanupStrandedCreativeReliabilityWorkspacesV1('run-lock-error')).toBe(1)
  })

  it('an exceptional holder releases the lock and its callback lease cannot authorize later writes or cleanup', async () => {
    let expired: EvalWorkspaceRunLeaseV1 | null = null
    await expect(withEvalWorkspaceRunLeaseV1({ suite: 'races-gateway', runId: 'run-exception' }, async lease => {
      expired = lease
      await createOwnedEvalWorkspaceV1({ suite: 'races-gateway', runId: 'run-exception', lease,
        workspace: { name: '异常中断的评测夹具', genres: ['fantasy'], description: '', status: 'drafting', targetWordCount: 100_000 },
        options: { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' } })
      throw new Error('Synthetic holder exception')
    })).rejects.toThrow('Synthetic holder exception')
    expect(await db.projects.count()).toBe(1)
    if (!expired) throw new Error('Expected expired callback lease')
    const project = (await db.projects.toArray())[0]
    await expect(cleanupOwnedEvalWorkspaceV1({ suite: 'races-gateway', runId: 'run-exception', workspaceUid: project.workspaceUid! }, expired)).rejects.toThrow('活动持有者已失效')
    expect(await db.projects.count()).toBe(1)
    expect(await cleanupRacesGatewayEvalProjectsV1('run-exception')).toBe(1)
    expect(ownershipKeys()).toHaveLength(0)
  })

  it('public checkpoint clear retains the actual active runner checkpoint and workspace until the run releases its lock', async () => {
    const manuscript = await ordinaryManuscript('普通作者作品', '重置评测不得清除作者正文')
    const runId = 'run-actual-checkpoint-clear'
    let enter!: () => void, release!: () => void
    const entered = new Promise<void>(resolve => { enter = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    const active = runH86StoryArcMainPathEvalV1({
      runId, codeRevision: 'sfqa111-synthetic',
      generator: { provider: 'custom', model: 'synthetic-generator', promptVersion: H86_GENERATOR_PAIR_VERSION_V1 },
      verifier: { provider: 'custom', model: 'synthetic-verifier', promptVersion: H86_VERIFIER_PROMPT_VERSION_V1 },
      onCheckpoint: persistH86CheckpointV1,
      dependencies: {
        generate: async input => {
          if (!input.evalRunLease || input.evalRunId !== runId) throw new Error('Expected actual live runner lease')
          await createOwnedEvalWorkspaceV1({ suite: 'h86-story-arc', runId, lease: input.evalRunLease,
            workspace: { name: '真实运行的合成夹具', genres: ['fantasy'], description: '', status: 'drafting', targetWordCount: 100_000 },
            options: { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' } })
          enter(); await gate
          throw new Error('Controlled runner stop before AI')
        },
        verify: async () => { throw new Error('No model verification allowed') },
      },
    })
    try {
      await entered
      const checkpoint = await loadH86CheckpointV1()
      expect(checkpoint?.runId).toBe(runId)
      const original = localStorage.getItem(H86_STORY_ARC_STORAGE_KEY_V1)
      const cleared = await Promise.resolve().then(() => clearH86CheckpointV1(runId))
        .then(() => null, (cause: unknown) => cause)
      expect(localStorage.getItem(H86_STORY_ARC_STORAGE_KEY_V1)).toBe(original)
      expect(cleared).toBeInstanceOf(Error)
      expect(await db.projects.count()).toBe(2)
      await expectManuscriptPreserved(manuscript)
    } finally {
      release()
      expect((await active).status).toBe('failed')
    }
    await clearH86CheckpointV1(runId)
    expect(await loadH86CheckpointV1()).toBeNull()
    expect(await db.projects.count()).toBe(1)
    expect(ownershipKeys()).toHaveLength(0)
    await expectManuscriptPreserved(manuscript)
  })

  it.each(['h86-story-arc', 'creative-reliability', 'races-gateway'] as const)(
    '%s public reset retains checkpoint on busy/error/mismatched run and clears after a successful held cleanup even with zero roots', async suite => {
      const manuscript = await ordinaryManuscript('普通作者作品', '原正文不得被重置误删')
      const checkpoint = await initialPublicCheckpoint(suite)
      const owned = await ownedWorkspace(suite, checkpoint.runId)
      const raw = localStorage.getItem(checkpoint.key)
      expect(raw).not.toBeNull()
      await withEvalWorkspaceRunLeaseV1({ suite, runId: checkpoint.runId }, async () => {
        await expect(checkpoint.clear(checkpoint.runId)).rejects.toThrow('仍在另一页面执行')
      })
      expect(localStorage.getItem(checkpoint.key)).toBe(raw)
      expect(await db.projects.get(owned.scope.projectId)).toBeDefined()
      vi.spyOn(navigator.locks, 'request').mockImplementationOnce(async () => { throw new Error('SFQA111 reset lock failure') })
      await expect(checkpoint.clear(checkpoint.runId)).rejects.toThrow('SFQA111 reset lock failure')
      expect(localStorage.getItem(checkpoint.key)).toBe(raw)
      expect(await db.projects.get(owned.scope.projectId)).toBeDefined()
      await expect(checkpoint.clear('other-run')).rejects.toThrow('原记录保留')
      expect(localStorage.getItem(checkpoint.key)).toBe(raw)
      expect(await db.projects.get(owned.scope.projectId)).toBeDefined()
      await checkpoint.clear(checkpoint.runId)
      expect(localStorage.getItem(checkpoint.key)).toBeNull()
      expect(await db.projects.get(owned.scope.projectId)).toBeUndefined()
      // A real checkpoint may exist before any workspace is allocated.
      const empty = await initialPublicCheckpoint(suite)
      await empty.clear(empty.runId)
      expect(localStorage.getItem(empty.key)).toBeNull()
      expect(ownershipKeys()).toHaveLength(0)
      await expectManuscriptPreserved(manuscript)
    },
  )

  it('checkpoint reset clears only its matching human review while explicit human-review clear remains available', () => {
    // Storage-only identity fixtures: these are never treated as verified review evidence.
    const raw = JSON.stringify({ checkpointHash: 'review-for-another-checkpoint', authorNotes: '保留的盲评' })
    localStorage.setItem(H86_HUMAN_REVIEW_STORAGE_KEY_V1, raw)
    clearH86HumanReviewV1('checkpoint-being-reset')
    expect(localStorage.getItem(H86_HUMAN_REVIEW_STORAGE_KEY_V1)).toBe(raw)
    clearH86HumanReviewV1('review-for-another-checkpoint')
    expect(localStorage.getItem(H86_HUMAN_REVIEW_STORAGE_KEY_V1)).toBeNull()
    localStorage.setItem(H86_HUMAN_REVIEW_STORAGE_KEY_V1, raw)
    clearH86HumanReviewV1()
    expect(localStorage.getItem(H86_HUMAN_REVIEW_STORAGE_KEY_V1)).toBeNull()
  })

})
