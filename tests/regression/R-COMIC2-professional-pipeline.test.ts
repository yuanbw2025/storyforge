import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createAdaptation, listActiveSourceUnits, saveAdaptationBriefDraft, confirmAdaptationBrief } from '../../src/lib/adaptation/source-manifest'
import { adoptAdaptationCausalEdgesV1, adoptAdaptationDecisionsV1 } from '../../src/lib/adaptation/analysis'
import type { AdaptationBriefV1, ComicTargetSpecV1, MediaRightsV1, ScreenplayTargetSpecV1 } from '../../src/lib/types'
import { adoptComicProfessionalCandidateV1, comicProfessionalInstructionV1, generateComicProfessionalCandidateV1, parseComicProfessionalPayloadV1 } from '../../src/lib/comic/durable-production'
import { adoptComicImageRequestV1, adoptComicPagePlansV1, adoptComicReviewIssuesV1, adoptComicScriptBeatsV1, adoptComicVisualBibleV1, createComicPanelScaffoldFromConfirmedPlanV1, startComicProductionV1 } from '../../src/lib/comic/production'
import { commitUploadedComicAssetV1, removeComicMediaAssetV1, selectComicMediaAssetV1 } from '../../src/lib/comic/media-service'
import { inspectComicQualityV1 } from '../../src/lib/comic/qa'
import { listComicReleasesV1, publishComicReleaseV1, readComicReleaseManifestV1 } from '../../src/lib/comic/release'
import { reopenAdaptationProductionV1 } from '../../src/lib/adaptation/completion'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { assembleContext } from '../../src/lib/registry/assemble-context'

const targetSpec: ComicTargetSpecV1 = { format: 'page-comic', audience: '青少年及以上', readingDirection: 'ltr', chapterCount: 1, targetPagesPerChapter: 1, pageSize: { width: 1200, height: 1700, unit: 'px', bleed: 0 }, colorMode: 'color', artStyleBrief: '冷蓝电影感页漫', renderCandidatesPerPanel: 2, imageCapabilityRequirement: { referenceImage: false, deterministicSeed: false, inpainting: false, commercialUseRequired: true, minimumWidth: 512, minimumHeight: 512 } }
const screenplayTargetSpec: ScreenplayTargetSpecV1 = { format: 'film', language: 'zh-CN', episodeCount: null, targetMinutesPerEpisode: 2, rating: 'PG-13', dialogueDensity: 'balanced', productionScale: 'contained', preserveVoiceOver: false, titlePage: { creditLine: '改编', authorDisplayName: '测试作者', contactText: '', copyrightNotice: '', draftLabel: '测试稿' }, exportDefaults: ['fountain'] }
const brief: AdaptationBriefV1 = { version: 1, coreTheme: '选择与代价', dominantEmotion: '克制', mustKeep: ['黎明前的选择'], mayCut: [], mayMerge: [], mayReorder: [], allowedAdditions: ['可视化时钟意象'], audience: '青少年及以上', rating: 'PG-13', targetScale: '一章一页', narrativePerspective: '林岚', timeBudget: '', costLimit: '', deviationNotes: '', unresolvedQuestions: [], assumptions: [] }
function pngBytes(): ArrayBuffer { const bytes = new Uint8Array(32); bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); const view = new DataView(bytes.buffer); view.setUint32(16, 1024); view.setUint32(20, 1536); return bytes.buffer }
function rights(): MediaRightsV1 { return { version: 1, source: 'author-upload', commercialUse: 'allowed', redistribution: 'allowed', attribution: '', declaration: '作者确认拥有测试图片完整使用与再分发权利。', declaredAt: Date.now() } }
async function fixture() {
  const source = await createWorkspace({ name: '漫画专业来源', genres: ['other'], status: 'drafting', description: '暴雨旧站', targetWordCount: 10_000, enableMultiWorld: false }, { kind: 'novel', novelProfile: 'short' })
  const chapter = await db.chapters.where('projectId').equals(source.scope.projectId).filter(row => row.workId === source.scope.workId).first(); await db.chapters.update(chapter!.id!, { content: '<p>暴雨中，林岚走进旧车站。停摆的时钟在黎明前重新走动，她决定留下。</p>', summary: '旧站抉择', updatedAt: Date.now() })
  const created = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '旧站页漫', sourceSelection: { mode: 'entire-work' }, medium: 'comic', targetSpec })
  const unit = (await listActiveSourceUnits(created.adaptation.id!)).find(row => row.sourceKind === 'chapter')!
  return { ...created, source, unit }
}

describe('COMIC-2 · professional novel-to-comic pipeline', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('候选确认前零写入，formal.written 中断后幂等恢复', async () => {
    const item = await fixture(); const payload = [{ stableKey: 'fact_arrival', kind: 'event', statement: '林岚在暴雨中走进旧车站。', subjectKeys: ['hero'], sourceUnitKeys: [item.unit.sourceUnitKey], confidence: 1 }, { stableKey: 'fact_choice', kind: 'character-state', statement: '林岚在黎明前决定留下。', subjectKeys: ['hero'], sourceUnitKeys: [item.unit.sourceUnitKey], confidence: 1 }]
    expect(() => parseComicProfessionalPayloadV1('source-analysis', [{ ...payload[0], subjectKeys: ['林岚'] }])).toThrow('SourceFact.subjectKeys[0] 非法')
    let sourceRepairCalls = 0
    await expect(generateComicProfessionalCandidateV1({ scope: item.scope, adaptationProjectId: item.adaptation.id!, stage: 'source-analysis', sourceUnitKeys: [item.unit.sourceUnitKey], runAI: async () => { sourceRepairCalls += 1; return JSON.stringify([{ ...payload[0], sourceUnitKeys: ['asu_other'] }]) } })).rejects.toThrow('SourceFact 引用了未选择的来源单元')
    expect(sourceRepairCalls).toBe(2)
    const generated = await generateComicProfessionalCandidateV1({ scope: item.scope, adaptationProjectId: item.adaptation.id!, stage: 'source-analysis', sourceUnitKeys: [item.unit.sourceUnitKey], runAI: async messages => {
      expect(messages[0].content).toContain('候选自身新建的 stableKey 必须全批次唯一')
      expect(messages[0].content).toContain(`唯一来源单元：${item.unit.sourceUnitKey}`)
      expect(messages[0].content).toContain('可空定位字段必须显式写 null')
      expect(messages[1].content).toContain('kind 只能是 event/character-state/relationship/location/object/motif')
      expect(messages[1].content).toContain('不要输出 certainty、timeAnchor、database id 或其它字段')
      return JSON.stringify(payload)
    } })
    expect(await db.adaptationSourceFacts.count()).toBe(0)
    await expect(adoptComicProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id, onDurableBoundary: boundary => { if (boundary === 'formal.written') throw new Error('simulated comic crash') } })).rejects.toThrow('simulated comic crash')
    expect(await db.adaptationSourceFacts.count()).toBe(2)
    const resumed = await adoptComicProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })
    expect(resumed.snapshot.projection.state).toBe('completed'); expect(await db.adaptationSourceFacts.count()).toBe(2)
    let causalCalls = 0
    const causalPayload = { stableKey: 'edge_choice', fromFactKey: 'fact_arrival', toFactKey: 'fact_choice', relation: 'enables', rationale: '到站使选择成为可能。', sourceUnitKeys: [item.unit.sourceUnitKey] }
    const causal = await generateComicProfessionalCandidateV1({ scope: item.scope, adaptationProjectId: item.adaptation.id!, stage: 'causal-graph', runAI: async messages => {
      causalCalls += 1
      if (causalCalls === 1) { expect(messages[0].content).toContain('允许 fact stableKey 闭集：fact_arrival, fact_choice'); return JSON.stringify([{ ...causalPayload, explanation: '闭集外字段' }]) }
      expect(messages[0].content).toContain('JSON 协议修复器'); expect(messages[1].content).toContain('未知：explanation')
      return JSON.stringify([causalPayload])
    } })
    expect(causalCalls).toBe(2); expect(causal.snapshot.contract.budget.maxModelCalls).toBe(2); expect(causal.candidate.payload).toHaveLength(1)
    const adoptedAfterRepair = await adoptComicProfessionalCandidateV1({ scope: item.scope, runId: causal.snapshot.run.id })
    expect(adoptedAfterRepair.snapshot.projection.state).toBe('completed'); expect(await db.adaptationCausalEdges.count()).toBe(1)
  })

  it('十二个岗位各自声明闭集 JSON 协议与漫画专业约束', () => {
    expect(comicProfessionalInstructionV1('causal-graph')).toContain('relation 必须逐字取 cause/enables/motivates/reveals/prevents')
    expect(comicProfessionalInstructionV1('adaptation-brief')).toContain('version 必须是 JSON 数字 1')
    expect(comicProfessionalInstructionV1('decision-pass')).toContain('只有 action=add 时可为空')
    expect(comicProfessionalInstructionV1('script-adaptation')).toContain('order 从 0 全局连续')
    expect(comicProfessionalInstructionV1('page-rhythm')).toContain('数组长度必须等于 chapterCount × targetPagesPerChapter')
    expect(comicProfessionalInstructionV1('panel-plan')).toContain('末格必须为 null')
    expect(comicProfessionalInstructionV1('panel-plan')).toContain('每格只冻结一个可画瞬间')
    expect(comicProfessionalInstructionV1('visual-bible')).toContain('必须覆盖所有 panel subjectStates 和 continuityRefs 引用')
    expect(comicProfessionalInstructionV1('image-request')).toContain('no speech balloons')
    expect(comicProfessionalInstructionV1('visual-continuity-review')).toContain('不得声称看见了人物外观')
    expect(comicProfessionalInstructionV1('targeted-repair')).toContain('repairMode 必须是 full-regenerate')
    expect(comicProfessionalInstructionV1('page-review')).toContain('subjectKey/assetKey 必须为 null')
  })

  it('十二步正式数据闭合，分镜/视觉双层发布冻结 Blob，并完成 v14 往返', async () => {
    const item = await fixture(); const facts = [{ stableKey: 'fact_arrival', kind: 'event' as const, statement: '林岚走进旧车站。', subjectKeys: ['hero'], sourceUnitKeys: [item.unit.sourceUnitKey], confidence: 1 }, { stableKey: 'fact_choice', kind: 'character-state' as const, statement: '林岚决定留下。', subjectKeys: ['hero'], sourceUnitKeys: [item.unit.sourceUnitKey], confidence: 1 }]
    const emptyComicContext = await assembleContext({ projectId: item.scope.projectId, scope: item.scope, sourceKeys: ['comic.scriptBeats', 'comic.pagePlans', 'comic.selectedMedia', 'comic.reviewIssues'], adaptationProjectId: item.adaptation.id!, adaptationSourceManifestVersion: 1 })
    expect(emptyComicContext.text).not.toContain('【已确认漫画脚本节拍】')
    const wrongMedium = await createAdaptation({ sourceScope: item.source.scope, sourceWorkId: item.source.scope.workId, title: '错误媒介上下文隔离', sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec: screenplayTargetSpec })
    const isolated = await assembleContext({ projectId: wrongMedium.scope.projectId, scope: wrongMedium.scope, sourceKeys: ['comic.scriptBeats', 'comic.pagePlans', 'comic.visualBible', 'comic.selectedMedia', 'comic.reviewIssues'], adaptationProjectId: wrongMedium.adaptation.id!, adaptationSourceManifestVersion: 1 })
    expect(isolated.text).not.toContain('漫画')
    const generated = await generateComicProfessionalCandidateV1({ scope: item.scope, adaptationProjectId: item.adaptation.id!, stage: 'source-analysis', runAI: async () => JSON.stringify(facts) }); await adoptComicProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })
    let root = (await db.adaptationProjects.get(item.adaptation.id!))!
    await adoptAdaptationCausalEdgesV1({ scope: item.scope, adaptationProjectId: root.id!, expectedAdaptationRevision: root.revision, sourceManifestVersion: 1, items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'edge_choice', fromFactKey: 'fact_arrival', toFactKey: 'fact_choice', relation: 'enables', rationale: '进入车站使抉择发生。', sourceUnitKeys: [item.unit.sourceUnitKey] } }] })
    root = (await db.adaptationProjects.get(root.id!))!; root = await saveAdaptationBriefDraft({ adaptationProjectId: root.id!, expectedRevision: root.revision, brief }); root = await confirmAdaptationBrief({ adaptationProjectId: root.id!, expectedRevision: root.revision })
    await adoptAdaptationDecisionsV1({ scope: item.scope, adaptationProjectId: root.id!, expectedAdaptationRevision: root.revision, sourceManifestVersion: 1, items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'decision_keep', action: 'keep', sourceFactKeys: ['fact_arrival', 'fact_choice'], targetKeys: ['beat_choice'], rationale: '保留进入与选择的因果链。' } }] })
    root = (await db.adaptationProjects.get(root.id!))!; await adoptComicScriptBeatsV1({ scope: item.scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: 1, candidates: [{ stableKey: 'beat_choice', sectionKey: 'chapter_1', chapterNumber: 1, order: 0, narrativeFunction: 'turn', visualAction: '林岚推开车站门，看见停摆时钟重新走动，随后放下车票。', dialogueIntent: '不用对白，以动作完成选择。', emotion: '迟疑转为坚定', causalFactKeys: ['fact_arrival', 'fact_choice'], decisionKeys: ['decision_keep'], sourceUnitKeys: [item.unit.sourceUnitKey], estimatedPanels: 1 }] })
    root = (await db.adaptationProjects.get(root.id!))!; await adoptComicPagePlansV1({ scope: item.scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: 1, candidates: [{ stableKey: 'page_plan_1', chapterNumber: 1, pageNumber: 1, order: 0, goal: '用一个翻页前完整页呈现选择。', beatKeys: ['beat_choice'], endReveal: '时钟重新走动。', pageTurn: 'cliffhanger', expectedPanelCount: 1, textBudget: 30 }] })
    root = (await db.adaptationProjects.get(root.id!))!; const scaffold = await createComicPanelScaffoldFromConfirmedPlanV1({ scope: item.scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: 1 }); expect(scaffold[0].panels[0].moment).toContain('林岚推开车站门'); expect(scaffold[0].panels[0].subjectStates?.map(row => row.subjectKey)).toEqual(['hero'])
    root = (await db.adaptationProjects.get(root.id!))!; await adoptComicVisualBibleV1({ scope: item.scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: 1, candidate: { global: { version: 1, artDirection: '冷蓝电影感页漫', linework: '有重量的墨线', palette: ['炭黑', '冷蓝'], lighting: '高反差逆光', periodAndMaterials: '当代旧车站与湿润混凝土', cameraLanguage: ['建立镜头后用道具完成选择'], prohibitedDepictions: ['成图文字', '水印'] }, subjects: [{ stableKey: 'hero', kind: 'character', label: '林岚', design: { description: '二十多岁，短发，克制神情', silhouette: '窄肩长风衣', facialFeatures: '细长眼与直眉', hairAndCostume: '黑色短发、深色风衣', palette: ['炭黑', '冷蓝'], materials: ['湿呢料'], distinguishingMarks: ['银色旧车票夹'], prohibitedChanges: ['发型', '风衣长度'] }, sourceUnitKeys: [item.unit.sourceUnitKey] }] } })
    root = (await db.adaptationProjects.get(root.id!))!; const plannedPage = (await db.comicPages.where('adaptationProjectId').equals(root.id!).first())!; const plannedPanel = (await db.comicPanels.where('pageId').equals(plannedPage.id!).first())!
    await expect(adoptComicImageRequestV1({ scope: item.scope, expectedAdaptationRevision: root.revision, candidate: { panelKey: plannedPanel.stableKey, expectedPanelRevision: plannedPanel.revision, visualPrompt: '林岚站在旧车站，no text, no speech balloons, no watermark', negativePrompt: 'no text, no speech balloons, no watermark', referenceSubjectKeys: ['hero'], protectedAreas: [{ x: 0, y: 0, width: 1, height: 1 }] } })).rejects.toThrow('不得改写目标格 protectedAreas')
    let pageReviewRepairCalls = 0; const repairedReview = await generateComicProfessionalCandidateV1({ scope: item.scope, adaptationProjectId: root.id!, stage: 'page-review', targetPageKeys: [plannedPage.stableKey], runAI: async () => { pageReviewRepairCalls += 1; return pageReviewRepairCalls === 1 ? JSON.stringify([{ stableKey: 'issue_wrong_page', category: 'narrative', severity: 'major', pageKey: 'page_wrong', panelKey: plannedPanel.stableKey, subjectKey: null, assetKey: null, evidence: '目标键错误。', problem: '页面定位错误。', suggestion: '改用目标页。', sourceUnitKeys: [item.unit.sourceUnitKey] }]) : '[]' } }); expect(pageReviewRepairCalls).toBe(2); await adoptComicProfessionalCandidateV1({ scope: item.scope, runId: repairedReview.snapshot.run.id })
    root = (await db.adaptationProjects.get(root.id!))!; root = await startComicProductionV1({ scope: item.scope, expectedAdaptationRevision: root.revision })
    const page = (await db.comicPages.where('adaptationProjectId').equals(root.id!).first())!; let panel = (await db.comicPanels.where('pageId').equals(page.id!).first())!
    await adoptComicReviewIssuesV1({ scope: item.scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: 1, reviewKind: 'page', targetPageKeys: [page.stableKey], expectedPanelRevisions: { [panel.stableKey]: panel.revision }, candidates: [{ stableKey: 'issue_lettering_minor', category: 'lettering', severity: 'minor', pageKey: page.stableKey, panelKey: panel.stableKey, subjectKey: null, assetKey: null, evidence: '当前旁白框接近安全区上限。', problem: '小屏阅读时可能略显拥挤。', suggestion: '视觉发布前由作者复核字号。', sourceUnitKeys: [item.unit.sourceUnitKey] }] })
    const issueContext = await assembleContext({ projectId: item.scope.projectId, scope: item.scope, sourceKeys: ['comic.reviewIssues'], adaptationProjectId: root.id!, adaptationSourceManifestVersion: 1 })
    expect(issueContext.text).toContain('issue_lettering_minor')
    let quality = await inspectComicQualityV1(item.scope); expect(quality.canStoryboardRelease).toBe(true); expect(quality.canVisualRelease).toBe(false)
    root = (await db.adaptationProjects.get(root.id!))!; const storyboard = await publishComicReleaseV1({ scope: item.scope, expectedAdaptationRevision: root.revision, tier: 'storyboard' }); expect((await readComicReleaseManifestV1(item.scope, storyboard.id)).assets).toEqual([])
    root = await reopenAdaptationProductionV1({ scope: item.scope, expectedRevision: (await db.adaptationProjects.get(root.id!))!.revision })
    const asset = await commitUploadedComicAssetV1({ scope: item.scope, data: pngBytes(), panelId: panel.id!, rights: rights() }); panel = await selectComicMediaAssetV1({ scope: item.scope, assetKey: asset.stableKey, panelId: panel.id!, expectedRevision: panel.revision }) as typeof panel
    const visualIssue = { stableKey: 'issue_visual_minor', category: 'continuity' as const, severity: 'minor' as const, pageKey: page.stableKey, panelKey: panel.stableKey, subjectKey: 'hero', assetKey: asset.stableKey, evidence: '作者上传图已选定；机器仅能确认媒资键、权利和完整性元数据。', problem: '光线连续性需由作者目视复核。', suggestion: '对照上一格确认冷蓝逆光方向。', sourceUnitKeys: [item.unit.sourceUnitKey] }
    const visualReview = await generateComicProfessionalCandidateV1({ scope: item.scope, adaptationProjectId: root.id!, stage: 'visual-continuity-review', targetPageKeys: [page.stableKey], runAI: async messages => { expect(messages[1].content).toContain('不传图片像素'); return JSON.stringify([visualIssue]) } })
    await expect(adoptComicProfessionalCandidateV1({ scope: item.scope, runId: visualReview.snapshot.run.id })).rejects.toThrow('查看目标页实际成图')
    await adoptComicProfessionalCandidateV1({ scope: item.scope, runId: visualReview.snapshot.run.id, authorVisualInspectionConfirmed: true })
    panel = (await db.comicPanels.get(panel.id!))!; expect(panel.visualReviewBasis).toBe('author-visual'); expect(panel.visualReviewedAt).toBeTypeOf('number')
    const visualIssueContext = await assembleContext({ projectId: item.scope.projectId, scope: item.scope, sourceKeys: ['comic.reviewIssues'], adaptationProjectId: root.id!, adaptationSourceManifestVersion: 1 })
    expect(visualIssueContext.text).toContain(asset.stableKey)
    quality = await inspectComicQualityV1(item.scope); expect(quality.canVisualRelease).toBe(true)
    root = (await db.adaptationProjects.get(root.id!))!; const visual = await publishComicReleaseV1({ scope: item.scope, expectedAdaptationRevision: root.revision, tier: 'visual' }); const visualManifest = await readComicReleaseManifestV1(item.scope, visual.id); expect(visualManifest.assets).toHaveLength(1); expect(await db.creationReleaseAssets.count()).toBe(1); expect((await listComicReleasesV1(item.scope)).map(row => row.version)).toEqual([1, 2])
    await reopenAdaptationProductionV1({ scope: item.scope, expectedRevision: (await db.adaptationProjects.get(root.id!))!.revision }); await removeComicMediaAssetV1({ scope: item.scope, assetKey: asset.stableKey, clearReferences: true }); expect(await db.comicMediaAssets.get(asset.id!)).toBeUndefined(); expect(await db.mediaBlobObjects.count()).toBe(1); expect((await readComicReleaseManifestV1(item.scope, visual.id)).assets[0].contentHash).toBe(visualManifest.assets[0].contentHash)
    const backup = await exportProjectJSON(item.scope.projectId); expect(backup.version).toBe(14); expect(backup.creationReleaseAssets).toHaveLength(1); const imported = await importProjectJSON(structuredClone(backup)); expect(await db.creationReleaseAssets.where('projectId').equals(imported).count()).toBe(1); expect(await db.mediaBlobObjects.where('projectId').equals(imported).count()).toBe(1)
  })
})
