import { vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { avgV5FrozenPrototypeFixtureV1 } from './avg-v5-prototype-fixture'
import { avgSoundPlanningFixtureV1 } from './avg-sound-planning-fixture'
import { avgSoundWireFixtureV1 } from './avg-sound-provider-fixture'
import { avgSoundPublisherFixtureV2 } from './avg-sound-publisher-fixture'
import { avgSoundAuthorReviewFixtureV3 } from './avg-sound-review-fixture'
import { avgReadingAudioFixture } from './avg-reading-fixture'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { saveAvgAuthorWorkspaceV1 } from '../../src/lib/avg/editor-service'
import { parseAvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import { prepareAvgAssemblyBriefV1, startAvgAssemblyV1, runAvgAssemblyV1, stageAvgWorkspaceInputV1,
  confirmAvgWorkspaceInputV1, configureAvgChosenSoundDraftV1, keepAvgGeneratedSoundStageDraftV1,
  readAvgRawVoiceCandidateV3, stageAvgAudioReviewV3, stageAvgVoiceChoiceV3, configureAvgChosenVoiceDraftV3 } from '../../src/lib/avg/assembly-service'
import { saveAvgSoundProductionDraftV1 } from '../../src/lib/avg/sound-draft-service'
import { stageAvgSoundPlanV1, stageAvgSoundReviewV1, stageAvgSoundChoiceV1 } from '../../src/lib/avg/sound-workbench-service'
import { readProductProductionDetailsV1 } from '../../src/lib/product-production/service'
import { saveAvgVoiceProductionDraftV1 } from '../../src/lib/avg/voice-draft-service'
import { avgLocalVoiceProtocolV1, AVG_LOCAL_VOICE_REVISION_V1, AVG_LOCAL_VOICE_RIGHTS_REFERENCE_V1 } from '../../src/lib/avg/voice-local-profile'
import { hashAvgSpeechProtocolV1, AVG_NATURAL_VOICE_INTENT_V1 } from '../../src/lib/avg/voice-request-contract'
import type { WorkspaceScope } from '../../src/lib/types'
import type { AvgReviewIssuesV1 } from '../../src/lib/avg/artifact-contract'
import type { AvgSoundTemplateV1 } from '../../src/lib/avg/sound-scope-contract'

type Owner = { scope: WorkspaceScope; productionId: number }
const declaration = 'ENGINEERING isolated combined pipeline; controlled HTTP/decoder/author observations are not real art, speech or hearing acceptance'
export const combinedDetails = (s: Owner) => readProductProductionDetailsV1(s.scope, s.productionId, ['avg'])
export async function confirmCombinedCandidate(s: Owner, candidate: { artifactKey: string; version: number; metadataJson: string }) {
  const result = await confirmAvgWorkspaceInputV1({ ...s, artifactKey: candidate.artifactKey,
    candidateVersion: candidate.version, candidateHash: JSON.parse(candidate.metadataJson).candidateHash })
  if (!result.ok) throw new Error(JSON.stringify(result))
}
export async function confirmCombinedSavedInput(s: Owner, artifactKey: string) {
  const draft = await readAvgDraftV1(s.scope)
  await confirmCombinedCandidate(s, await stageAvgWorkspaceInputV1({ ...s, expectedDraftRevision: draft.revision, artifactKey, declaration }))
}
async function confirmSources(s: Owner) {
  const workspace = parseAvgAuthorWorkspaceV1((await readAvgDraftV1(s.scope)).editorJson)
  for (const key of ['avg.system.plan', ...workspace.scripts.map(script => `avg.content.scene-script.${script.sceneKey}`)]) {
    await confirmCombinedSavedInput(s, key)
  }
}
async function frozen(s: Owner) {
  await confirmCombinedSavedInput(s, 'avg.author.stage')
  await runAvgAssemblyV1(s)
  const details = await combinedDetails(s)
  if (details.build?.status !== 'preview-ready') throw new Error(`Combined phase did not freeze an actual Preview: ${details.build?.status}: ${details.build?.failureJson}`)
  return details.build
}
async function baseline(s: Owner) {
  const details = await combinedDetails(s), draft = await readAvgDraftV1(s.scope)
  if (!details.build?.previewHash) throw new Error('An exact frozen Preview is required before the explicit next phase')
  const workspace = parseAvgAuthorWorkspaceV1(draft.editorJson)
  workspace.basePreviewHash = details.build.previewHash
  return saveAvgAuthorWorkspaceV1(s.scope, draft.revision, workspace)
}

/** Starts with the actual original V5 five-image command chain. Every later
 * phase uses this same owner and public draft/preparation/start/author entry.
 * No accepted rows, sources, Runs, QA or Release authority are transplanted. */
export async function avgCombinedVisualSourceFixtureV1() {
  const s = await avgV5FrozenPrototypeFixtureV1()
  return { ...s, originalVisualBuild: s.build }
}

export async function addCombinedSoundFixtureV1(s: Awaited<ReturnType<typeof avgCombinedVisualSourceFixtureV1>>) {
  const original = (await combinedDetails(s)).build!, initialDraft = await baseline(s)
  const continued = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: initialDraft.revision,
    visualStageContinuation: { expectedBuildId: original.id!, expectedBuildRevision: original.stateRevision } })
  if (!continued.brief) throw new Error('Visual retention did not prepare a reviewable Brief')
  const retained = await startAvgAssemblyV1({ ...s, expectedBriefHash: continued.brief.briefHash })
  await runAvgAssemblyV1(s); await confirmSources(s)
  const retainedBuild = await frozen(s)
  if (retainedBuild.id !== retained.build?.id) throw new Error('Visual continuation switched the active Build')

  const semantic = await avgSoundPlanningFixtureV1(), wire = await avgSoundWireFixtureV1(semantic.compiled.requirements.find(r => r.dispatch.operation === 'generate-music')!)
  const publisher = avgSoundPublisherFixtureV2(), plan = structuredClone(semantic.plan)
  plan.entries.push({ requirementKey: 'desk.ambience', designIntent: 'ENGINEERING exact original publisher rain; not real listening',
    prompt: null, librarySourceKey: publisher.source.sourceKey, acceptanceNotes: ['ENGINEERING preserve exact publisher grant/result2 and original bytes'] })
  const counts = { text: 0, music: 0, library: 0, publisherLibrary: 0, musicCapability: 0, voice: 0, voiceCapability: 0 }
  const soundFetch = vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
    const url = String(target)
    if (url === 'https://v5-proposal.fixture.invalid/v1/chat/completions' && init?.method === 'POST') {
      counts.text++
      return Response.json({ choices: [{ message: { role: 'assistant', content: JSON.stringify(plan) } }], usage: { prompt_tokens: 200, completion_tokens: 200 } })
    }
    if (url === 'http://127.0.0.1:5298/v1/capabilities') counts.musicCapability++
    else if (url === 'http://127.0.0.1:5298/v1/audio/music' && init?.method === 'POST') counts.music++
    else if (url === `http://127.0.0.1:5298/v1/library/audio/${wire.library.source.archiveHash}/${wire.library.source.memberHash}` && init?.method === 'GET') counts.library++
    else if (url === `http://127.0.0.1:5298/v1/library/audio/${publisher.source.archiveHash}/${publisher.source.memberHash}` && init?.method === 'GET') {
      counts.library++; counts.publisherLibrary++
      return new Response(publisher.data.slice(0), { headers: { 'content-type': 'audio/ogg', 'x-storyforge-library-result': JSON.stringify(publisher.result) } })
    }
    else throw new Error('Unexpected combined sound request; old image/text/voice generation is forbidden')
    return wire.fetcher(target, init)
  })
  vi.stubGlobal('fetch', soundFetch)
  const { sourceInputHash: _hash, ...planning } = semantic.scope
  const ambience: AvgSoundTemplateV1 = { requirementKey: 'desk.ambience', assetKey: 'sound.desk.ambience', channel: 'ambience',
    purpose: 'ENGINEERING original publisher ambience in the same Work, no hearing/loop claim', constraints: ['Do not mask dialogue'],
    consumer: { consumerKey: 'consumer.desk.ambience', domain: 'stage', slot: 'ambience', subjectKey: 'desk', sceneKey: 'desk', lineKey: null, required: true, fallback: 'none' },
    cue: { cueKey: 'cue.desk.ambience', beatKey: 'line.desk', phase: 'before', order: 12, volume: .25, loop: false },
    source: { kind: 'licensed-library', allowedSourceKeys: [publisher.source.sourceKey] } }
  planning.templates = [...planning.templates, ambience]
  planning.librarySources = [wire.library.source, publisher.source]
  const draft = await baseline(s), saved = await saveAvgSoundProductionDraftV1({ scope: s.scope, expectedDraftRevision: draft.revision, planning })
  const prepared = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: saved.revision })
  if (!prepared.brief) throw new Error('Combined Sound did not prepare a reviewable Brief')
  const started = await startAvgAssemblyV1({ ...s, expectedBriefHash: prepared.brief.briefHash }), soundBuildId = started.build!.id!
  await runAvgAssemblyV1(s); await confirmSources(s); await runAvgAssemblyV1(s)
  const proposal = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([soundBuildId, 'avg.proposal.sound-plan']).filter(r => r.status === 'accepted').first())!
  if (!proposal) throw new Error((await combinedDetails(s)).build!.failureJson)
  await confirmCombinedCandidate(s, await stageAvgSoundPlanV1({ ...s, proposal, payload: plan, declaration }))
  useAIConfigStore.getState().setConfig({ apiKey: '' })
  await runAvgAssemblyV1(s)
  for (const key of ['desk.bgm', 'desk.sfx', 'desk.ambience']) {
    const raw = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([soundBuildId, `avg.sound.raw.${key}`]).filter(r => r.status === 'accepted').first())!
    if (!raw) throw new Error((await combinedDetails(s)).build!.failureJson)
    await confirmCombinedCandidate(s, await stageAvgSoundReviewV1({ ...s, raw, report: avgSoundAuthorReviewFixtureV3(JSON.parse(raw.payloadJson)), declaration }))
    await confirmCombinedCandidate(s, await stageAvgSoundChoiceV1({ ...s, raw, declaration }))
  }
  await configureAvgChosenSoundDraftV1({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
  const soundBuild = await frozen(s)
  return { ...s, retainedBuild, soundBuild, soundFetch, soundCounts: counts, wire, publisher }
}

export async function addCombinedLocalVoiceFixtureV1(s: Awaited<ReturnType<typeof addCombinedSoundFixtureV1>>) {
  const draft = await baseline(s)
  await keepAvgGeneratedSoundStageDraftV1({ ...s, expectedDraftRevision: draft.revision, expectedBuildId: s.soundBuild.id! })
  const current = await readAvgDraftV1(s.scope), workspace = parseAvgAuthorWorkspaceV1(current.editorJson)
  workspace.presentation.reading ??= { schema: 'storyforge.avg.reading-plan', version: 1, manualVoice: 'wait', voiceFailure: 'pause', maximumVoiceWaitMs: 30000, autoDelayMs: 800, voices: [] }
  const withReading = await saveAvgAuthorWorkspaceV1(s.scope, current.revision, workspace)
  const protocol = await avgLocalVoiceProtocolV1(), capabilityHash = await hashAvgSpeechProtocolV1(protocol), audio = await avgReadingAudioFixture(500)
  const voiceFetch = vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
    const url = String(target)
    if (url === 'http://127.0.0.1:5297/v1/capabilities') {
      s.soundCounts.voiceCapability++
      return Response.json({ schema: 'storyforge.avg.local-speech-capability', version: 1, provider: protocol.provider, model: protocol.model,
        modelRevision: AVG_LOCAL_VOICE_REVISION_V1, voices: protocol.voices.map(v => v.voiceId), locale: 'zh-CN', outputFormat: 'wav',
        maximumInputCharacters: 256, supportsInstructions: true, maximumInstructionsCharacters: 2048, speedRange: null, license: 'Apache-2.0', voiceMode: 'fixed-preset' })
    }
    if (url !== 'http://127.0.0.1:5297/v1/audio/speech' || init?.method !== 'POST') throw new Error('Combined voice phase cannot regenerate images, music or text')
    s.soundCounts.voice++
    return new Response(audio.data.slice(0), { headers: { 'content-type': 'audio/wav', 'x-request-id': 'controlled-combined-local-voice', 'x-storyforge-cost-usd': '0' } })
  })
  vi.stubGlobal('fetch', voiceFetch)
  const saved = await saveAvgVoiceProductionDraftV1({ scope: s.scope, expectedDraftRevision: withReading.revision, protocol,
    presets: [{ presetKey: 'combined.keeper', revision: 1, adapterId: protocol.adapterId, provider: protocol.provider, model: protocol.model, voiceId: 'Dylan',
      locale: 'zh-CN', endpointRouteHash: protocol.endpointRouteHash, capabilityHash,
      rights: { basis: 'provider-preset', declaration, reference: AVG_LOCAL_VOICE_RIGHTS_REFERENCE_V1 } }],
    lines: [{ requirementKey: 'combined.keeper.line', assetKey: 'combined.voice.desk', sceneKey: 'desk', lineKey: 'line.desk', presetKey: 'combined.keeper',
      maximumDurationMs: 1000, performance: { revision: 1, intent: AVG_NATURAL_VOICE_INTENT_V1, pronunciations: [], instructions: null, speed: null } }] })
  const prepared = await prepareAvgAssemblyBriefV1({ scope: s.scope, expectedDraftRevision: saved.revision })
  if (!prepared.brief) throw new Error('Combined voice did not prepare a reviewable Brief')
  const started = await startAvgAssemblyV1({ ...s, expectedBriefHash: prepared.brief.briefHash }), voiceBuildId = started.build!.id!
  await runAvgAssemblyV1(s); await confirmSources(s); await runAvgAssemblyV1(s)
  const raw = (await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([voiceBuildId, 'avg.voice.raw.combined.keeper.line']).filter(r => r.status === 'accepted').first())!
  if (!raw) throw new Error((await combinedDetails(s)).build!.failureJson)
  const selected = await readAvgRawVoiceCandidateV3({ ...s, requirementKey: 'combined.keeper.line', version: raw.version, contentHash: raw.contentHash })
  const report: AvgReviewIssuesV1 = { schema: 'storyforge.avg.review-issues', version: 1, targetKey: 'combined.keeper.line', observations: ['audio'], unobserved: [], issues: [],
    audioEvidence: { audioHash: raw.contentHash, requestIdentityHash: selected.payload.request.identityHash,
      audition: { generation: 'audition.combined.engineering', outcome: 'ended', durationMs: 500, playedMs: 500, muted: false, volume: 1, playbackRate: 1, seeked: false },
      checks: (['text-match', 'pronunciation', 'delivery', 'clip-boundaries', 'noise'] as const).map(criterion => ({ criterion, result: 'pass' as const, note: declaration })), note: declaration } }
  await confirmCombinedCandidate(s, await stageAvgAudioReviewV3({ ...s, requirementKey: 'combined.keeper.line', rawVersion: raw.version, rawContentHash: raw.contentHash, report, declaration }))
  await confirmCombinedCandidate(s, await stageAvgVoiceChoiceV3({ ...s, requirementKey: 'combined.keeper.line', rawVersion: raw.version, rawContentHash: raw.contentHash, declaration }))
  await configureAvgChosenVoiceDraftV3({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
  const voiceBuild = await frozen(s)
  return { ...s, voiceBuild, voiceFetch, originalVoice: audio, protocol }
}
