import Dexie from 'dexie'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { readOwnedRows } from '../../src/lib/workspace/scope'
import * as source from '../../src/lib/adaptation/source-manifest'
import { adoptAdaptationCausalEdgesV1, adoptAdaptationSourceFactsV1 } from '../../src/lib/adaptation/analysis'
import { defaultComicTargetSpec } from '../../src/lib/comic/authoring'
import * as comic from '../../src/lib/comic/durable-production'
import * as screenplay from '../../src/lib/screenplay/durable-production'
import * as checkpoints from '../../src/lib/agent/run/checkpoint'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { flushCandidateDraftsV1 } from '../../src/lib/agent/candidate-draft-coordinator'
import { flushPendingEditsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import ComicPipelinePanel from '../../src/components/comic/ComicPipelinePanel'
import ScreenplayPipelinePanel from '../../src/components/screenplay/ScreenplayPipelinePanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import type { AdaptationBriefV1, Chapter, ScreenplayTargetSpecV1 } from '../../src/lib/types'

const MODEL: AdaptationBriefV1 = {
  version: 1, coreTheme: '保留证据', dominantEmotion: '警觉', mustKeep: ['车票'], mayCut: [], mayMerge: [], mayReorder: [],
  allowedAdditions: [], audience: '大众', rating: 'PG-13', targetScale: '一部作品', narrativePerspective: '检票员',
  timeBudget: '', costLimit: '', deviationNotes: '', unresolvedQuestions: [], assumptions: [],
}
const AUTHOR: AdaptationBriefV1 = { ...MODEL, coreTheme: '036 作者逐字修订：保留车票，绝不替换为模型原案。', mustKeep: ['作者保留的车票'] }
const TARGET: ScreenplayTargetSpecV1 = {
  format: 'film', language: 'zh-CN', episodeCount: null, targetMinutesPerEpisode: 2, rating: 'PG-13', dialogueDensity: 'balanced',
  productionScale: 'contained', preserveVoiceOver: false, titlePage: { creditLine: '改编', authorDisplayName: '合成作者',
    contactText: '', copyrightNotice: '合成夹具', draftLabel: '初稿' }, exportDefaults: ['fountain'],
}
type Medium = 'comic' | 'screenplay'
type Boundary = 'adoption.started' | 'formal.written' | 'adoption.committed' | 'verification.accepted'

async function fixture(medium: Medium) {
  const original = await createWorkspace({ name: '036 原作', description: '', genres: ['other'], status: 'drafting', targetWordCount: 8000 },
    { kind: 'novel', novelProfile: 'short' })
  const chapter = (await readOwnedRows<Chapter>(original.scope, 'chapters', { owner: 'work' }))[0]
  if (!chapter?.id) throw new Error('Synthetic source chapter missing')
  await db.chapters.update(chapter.id, { content: '<p>检票员收到车票，保存它并拨打电话。</p>', summary: '合成原作', updatedAt: Date.now() })
  const common = { sourceScope: original.scope, sourceWorkId: original.scope.workId, title: '036 合成改编',
    sourceSelection: { mode: 'entire-work' as const } }
  const item = medium === 'comic'
    ? await source.createAdaptation({ ...common, medium: 'comic', targetSpec: defaultComicTargetSpec() })
    : await source.createAdaptation({ ...common, medium: 'screenplay', targetSpec: TARGET })
  const units = await source.listActiveSourceUnits(item.adaptation.id!)
  const unit = units.find(row => row.sourceKind === 'chapter')
  if (!unit) throw new Error('Synthetic frozen source unit missing')
  await adoptAdaptationSourceFactsV1({ scope: item.scope, adaptationProjectId: item.adaptation.id!,
    expectedAdaptationRevision: item.adaptation.revision, sourceManifestVersion: item.adaptation.activeSourceManifestVersion,
    items: ['receive', 'keep'].map(key => ({ candidate: { stableKey: `fact.${key}`, kind: 'event' as const,
      statement: key === 'receive' ? '收到车票' : '保存车票', subjectKeys: [], sourceUnitKeys: [unit.sourceUnitKey], confidence: 1 },
      authorStatus: 'confirmed' as const })) })
  // Capture the real root revision after the public fact adoption.
  const afterFacts = await db.adaptationProjects.get(item.adaptation.id!)
  if (!afterFacts) throw new Error('Synthetic adaptation missing')
  await adoptAdaptationCausalEdgesV1({ scope: item.scope, adaptationProjectId: item.adaptation.id!,
    expectedAdaptationRevision: afterFacts.revision, sourceManifestVersion: afterFacts.activeSourceManifestVersion,
    items: [{ candidate: { stableKey: 'edge.keep', fromFactKey: 'fact.receive', toFactKey: 'fact.keep', relation: 'cause',
      rationale: '收到后才能保存', sourceUnitKeys: [unit.sourceUnitKey] }, authorStatus: 'confirmed' }] })
  const runAI = vi.fn(async () => JSON.stringify(MODEL))
  const input = { scope: item.scope, adaptationProjectId: item.adaptation.id!, stage: 'adaptation-brief' as const, runAI }
  const generated = medium === 'comic'
    ? await comic.generateComicProfessionalCandidateV1(input)
    : await screenplay.generateScreenplayProfessionalCandidateV1(input)
  const before = await db.adaptationProjects.get(item.adaptation.id!)
  if (!before) throw new Error('Synthetic adaptation disappeared')
  return { ...item, medium, original, chapter, units, generated, before, runAI }
}
type Fixture = Awaited<ReturnType<typeof fixture>>

function adopt(item: Fixture, options: { authorPayload?: AdaptationBriefV1; allowReplaceDownstream?: boolean;
  onDurableBoundary?: (boundary: Boundary) => void | Promise<void> } = {}) {
  const input = { scope: item.scope, runId: item.generated.snapshot.run.id, ...options }
  return item.medium === 'comic' ? comic.adoptComicProfessionalCandidateV1(input) : screenplay.adoptScreenplayProfessionalCandidateV1(input)
}
function pending(item: Fixture) {
  return item.medium === 'comic'
    ? comic.readPendingComicProfessionalCandidateV1(item.scope) : screenplay.readPendingScreenplayProfessionalCandidateV1(item.scope)
}
async function intent(item: Fixture) {
  const checkpoint = await checkpoints.readLatestVerifiedAgentRunCheckpointV1(item.scope, item.generated.snapshot.run.id)
  expect(checkpoint?.resumePayload).toMatchObject({ authorPayload: AUTHOR })
  return checkpoint?.resumePayload
}
function faultEvent(type: string) {
  const original = db.agentRunEvents.add.bind(db.agentRunEvents)
  let armed = true
  return vi.spyOn(db.agentRunEvents, 'add').mockImplementation((record, key) => {
    if (armed && record.type === type) {
      armed = false
      return Dexie.Promise.reject(new Error(`036 storage fault: ${type}`))
    }
    return original(record, key)
  })
}
async function freezeWithoutWriting(item: Fixture) {
  const fault = faultEvent('confirmation.recorded')
  await expect(adopt(item, { authorPayload: AUTHOR, allowReplaceDownstream: true })).rejects.toThrow('036 storage fault')
  fault.mockRestore()
  expect(await db.adaptationProjects.get(item.adaptation.id!)).toEqual(item.before)
  return intent(item)
}
async function completedOnce(item: Fixture) {
  const root = await db.adaptationProjects.get(item.adaptation.id!)
  expect(root?.brief).toEqual(AUTHOR)
  expect(root?.revision).toBe(item.generated.candidate.adaptationRevision + 2)
  expect(root?.briefSourceManifestVersion).toBe(root?.activeSourceManifestVersion)
  const run = await readAgentRunV1(item.scope, item.generated.snapshot.run.id)
  expect(run.projection.state).toBe('completed')
  for (const type of ['confirmation.recorded', 'adoption.started', 'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted']) {
    expect(run.events.filter(event => event.type === type)).toHaveLength(1)
  }
  expect(item.runAI).toHaveBeenCalledTimes(1)
  return run.projection.terminalReceiptHash
}

let mounted: Root | undefined
let host: HTMLDivElement | undefined
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  await db.delete(); await db.open()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network in Brief recovery regression') }))
})
afterEach(async () => {
  vi.restoreAllMocks()
  if (mounted) {
    await act(async () => { await flushPendingEditsV1(); mounted?.unmount() })
    await flushCandidateDraftsV1()
  }
  mounted = undefined; host?.remove(); host = undefined
  vi.unstubAllGlobals(); await db.delete()
})

describe.each(['comic', 'screenplay'] as const)('SFQA-036 %s Brief', medium => {
  it('commits the actual Brief and its evidence in one native transaction and replays without another write', async () => {
    const item = await fixture(medium)
    const transactions = new Set<IDBTransaction | undefined>()
    const put = db.adaptationProjects.put.bind(db.adaptationProjects)
    const add = db.agentRunEvents.add.bind(db.agentRunEvents)
    vi.spyOn(db.adaptationProjects, 'put').mockImplementation((row, key) => {
      transactions.add(Dexie.currentTransaction?.idbtrans)
      return put(row, key)
    })
    vi.spyOn(db.agentRunEvents, 'add').mockImplementation((row, key) => {
      if (['adoption.committed', 'verification.accepted'].includes(row.type)) transactions.add(Dexie.currentTransaction?.idbtrans)
      return add(row, key)
    })
    const first = await adopt(item, { authorPayload: AUTHOR })
    expect(await completedOnce(item)).toBe(first.receiptHash)
    expect(transactions.size).toBe(1)
    expect(transactions.has(undefined)).toBe(false)
    const root = await db.adaptationProjects.get(item.adaptation.id!)
    const replay = await adopt(item)
    expect(replay.receiptHash).toBe(first.receiptHash)
    expect(await db.adaptationProjects.get(item.adaptation.id!)).toEqual(root)
    await completedOnce(item)
  })

  it('rolls the actual draft-save back when the original confirmation API fails, then resumes the frozen author Brief', async () => {
    const item = await fixture(medium)
    const fault = vi.spyOn(source, 'confirmAdaptationBrief').mockRejectedValueOnce(new Error('036 after save, before confirm'))
    await expect(adopt(item, { authorPayload: AUTHOR })).rejects.toThrow('036 after save')
    fault.mockRestore()
    expect(await db.adaptationProjects.get(item.adaptation.id!)).toEqual(item.before)
    expect((await pending(item))?.authorPayload).toEqual(AUTHOR)
    const frozen = await intent(item)
    await adopt(item)
    expect(await intent(item)).toEqual(frozen)
    await completedOnce(item)
  })

  it.each(['confirmation.recorded', 'adoption.started', 'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted'])(
    'native event storage failure at %s rolls back both domain and completion evidence', async type => {
      const item = await fixture(medium)
      const fault = faultEvent(type)
      await expect(adopt(item, { authorPayload: AUTHOR })).rejects.toThrow('036 storage fault')
      fault.mockRestore()
      expect(await db.adaptationProjects.get(item.adaptation.id!)).toEqual(item.before)
      const run = await readAgentRunV1(item.scope, item.generated.snapshot.run.id)
      expect(run.projection.state).toBe('awaiting_confirmation')
      expect(run.events.some(event => event.type === 'adoption.committed' || event.type === 'verification.accepted')).toBe(false)
      expect((await pending(item))?.authorPayload).toEqual(AUTHOR)
      await adopt(item)
      await completedOnce(item)
    },
  )

  it.each(['formal.written', 'adoption.committed'] as const)('host interruption at %s cannot leave a +1/+2 partial mutation', async boundary => {
    const item = await fixture(medium)
    await expect(adopt(item, { authorPayload: AUTHOR, onDurableBoundary: current => {
      if (current === boundary) throw new Error('036 interrupted host')
    } })).rejects.toThrow('036 interrupted host')
    expect(await db.adaptationProjects.get(item.adaptation.id!)).toEqual(item.before)
    await adopt(item)
    await completedOnce(item)
  })

  it('a failure after the terminal commit keeps the completed receipt available without a second adoption', async () => {
    const item = await fixture(medium)
    await expect(adopt(item, { authorPayload: AUTHOR, onDurableBoundary: boundary => {
      if (boundary === 'verification.accepted') throw new Error('036 lost terminal acknowledgement')
    } })).rejects.toThrow('036 lost terminal acknowledgement')
    const receiptHash = await completedOnce(item)
    expect((await adopt(item)).receiptHash).toBe(receiptHash)
    await completedOnce(item)
  })

  it.each(['author-root', 'source', 'payload', 'owner', 'intent'] as const)('refuses changed %s without a formal write or model resend', async change => {
    const item = await fixture(medium)
    await freezeWithoutWriting(item)
    if (change === 'author-root') await source.saveAdaptationBriefDraft({ adaptationProjectId: item.adaptation.id!,
      expectedRevision: item.before.revision, brief: { ...AUTHOR, coreTheme: '另一位作者的新 Brief' } })
    if (change === 'source') await db.chapters.update(item.chapter.id!, { content: '<p>后来作者改写了原作。</p>', updatedAt: Date.now() })
    if (change === 'intent') {
      const frozen = await intent(item)
      if (!frozen || typeof frozen !== 'object') throw new Error('Frozen test intent missing')
      await checkpoints.createAgentRunCheckpointV1({ scope: item.scope, runId: item.generated.snapshot.run.id,
        resumePayload: { ...frozen, authorPayloadHash: '0'.repeat(64) } })
    }
    const root = await db.adaptationProjects.get(item.adaptation.id!)
    if (change === 'owner') {
      const foreign = await createWorkspace({ name: '036 foreign', description: '', genres: [], status: 'drafting', targetWordCount: 1000 })
      const command = { scope: foreign.scope, runId: item.generated.snapshot.run.id }
      await expect(medium === 'comic' ? comic.adoptComicProfessionalCandidateV1(command) : screenplay.adoptScreenplayProfessionalCandidateV1(command)).rejects.toThrow()
    } else await expect(adopt(item, change === 'payload' ? { authorPayload: MODEL } : {})).rejects.toThrow()
    expect(await db.adaptationProjects.get(item.adaptation.id!)).toEqual(root)
    expect(item.runAI).toHaveBeenCalledTimes(1)
    expect((await readAgentRunV1(item.scope, item.generated.snapshot.run.id)).projection.terminalReceiptHash).toBeFalsy()
  })

  it.each([1, 2])('does not mistake an unrelated equal Brief at legacy +%s for this Run adoption', async revisions => {
    const item = await fixture(medium)
    await freezeWithoutWriting(item)
    const saved = await source.saveAdaptationBriefDraft({ adaptationProjectId: item.adaptation.id!,
      expectedRevision: item.before.revision, brief: AUTHOR })
    if (revisions === 2) await source.confirmAdaptationBrief({ adaptationProjectId: saved.id!, expectedRevision: saved.revision })
    const root = await db.adaptationProjects.get(item.adaptation.id!)
    await expect(adopt(item)).rejects.toThrow('stale')
    expect(await db.adaptationProjects.get(item.adaptation.id!)).toEqual(root)
    expect((await pending(item))?.authorPayload).toEqual(AUTHOR)
  })

  it('the real panel remount shows the frozen author text read-only and its recovery action completes the same Run', async () => {
    const item = await fixture(medium)
    await freezeWithoutWriting(item)
    const container = document.createElement('div'); document.body.append(container)
    host = container; const root = createRoot(container); mounted = root
    const onChanged = vi.fn(async () => undefined)
    await act(async () => {
      root.render(<DialogProvider>{medium === 'comic'
        ? <ComicPipelinePanel scope={item.scope} adaptation={item.before} sourceUnits={item.units}
          pages={[]} panels={[]} subjectCount={0} onChanged={onChanged} stages={['adaptation-brief']} />
        : <ScreenplayPipelinePanel scope={item.scope} adaptation={item.before} sourceUnits={item.units}
          scenes={[]} onChanged={onChanged} allowedStages={['adaptation-brief']} />}</DialogProvider>)
    })
    await vi.waitFor(() => {
      const shown = container.querySelector(`div.${medium}-professional-candidate`)
      expect(shown?.textContent + (shown?.querySelector('textarea')?.value ?? '')).toContain(AUTHOR.coreTheme)
    })
    const candidate = container.querySelector(`div.${medium}-professional-candidate`)
    expect(candidate?.querySelector('fieldset')?.disabled).toBe(true)
    const button = [...(candidate?.querySelectorAll('button') ?? [])].find(node => node.textContent?.includes('继续完成已确认的采纳'))
    if (!button) throw new Error('Actual frozen Brief recovery action missing')
    await act(async () => { button.click() })
    await vi.waitFor(async () => { expect((await readAgentRunV1(item.scope, item.generated.snapshot.run.id)).projection.state).toBe('completed') })
    await completedOnce(item)
    expect(onChanged).toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
