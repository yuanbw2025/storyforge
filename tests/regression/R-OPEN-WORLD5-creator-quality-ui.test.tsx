import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceScope } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  recordGraybox: vi.fn(),
  recordFullPlaytest: vi.fn(),
  recordUpdateVerification: vi.fn(),
  recordCalibration: vi.fn(),
  recordIssue: vi.fn(),
  waiveIssue: vi.fn(),
  finalize: vi.fn(),
  portable: vi.fn(() => '{"portable":true}'),
  download: vi.fn(),
}))

vi.mock('../../src/lib/open-world/creator-quality', () => ({
  readTextOpenWorldCreatorQualityWorkspaceV1: mocks.read,
  recordTextOpenWorldCreatorGrayboxV1: mocks.recordGraybox,
  recordTextOpenWorldCreatorFullPlaytestV1: mocks.recordFullPlaytest,
  recordTextOpenWorldCreatorUpdateVerificationV1: mocks.recordUpdateVerification,
  recordTextOpenWorldCreatorCalibrationV1: mocks.recordCalibration,
  recordTextOpenWorldCreatorIssueV1: mocks.recordIssue,
  waiveTextOpenWorldCreatorAdvisoryIssueV1: mocks.waiveIssue,
  finalizeTextOpenWorldCreatorQualityV1: mocks.finalize,
  portableTextOpenWorldCreatorIssueJsonV1: mocks.portable,
}))

vi.mock('../../src/lib/export/text-export', () => ({ downloadTextFile: mocks.download }))

import TextOpenWorldCreatorQualityStudio from '../../src/components/text-game/TextOpenWorldCreatorQualityStudio'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SCOPE: WorkspaceScope = { projectId: 501, worldId: 502, workId: 503 }
const HASH = 'a'.repeat(64)
const FINDING_KEY = 'semantic:semantic.finding.1'
const ISSUE_RECEIPT_HASH = 'b'.repeat(64)

function receipt<T>(gateId: string, receiptHash: string, evidence: T, status = 'passed') {
  return { rowId: 1, gateId, status, receiptHash, evidence, createdAt: 1 }
}

function workspace(input: { graybox?: boolean; issueWaived?: boolean; calibration?: boolean; twoEndings?: boolean } = {}) {
  const build = {
    productionKey: 'text-open-world.quality-ui', buildNumber: 4,
    packageHash: HASH, previewHash: 'c'.repeat(64), manifestHash: 'd'.repeat(64),
    qualityReportHash: 'e'.repeat(64), rootTerminalReceiptHash: 'f'.repeat(64),
  }
  const issueEvidence = {
    schema: 'storyforge.text-open-world-creator-issue-evidence', version: 1,
    build, issueKey: 'issue.fixture', issueFingerprint: '1'.repeat(64),
    severity: 'advisory', category: 'ui-accessibility', summary: '窄屏按钮对比度偏低',
    preconditions: [], reproductionSteps: ['打开任务页'], expected: '按钮清晰', actual: '对比度偏低',
    affectedStableKeys: ['ui.quest.primary'], runtimeWitness: null,
    sourceTextExcluded: true, reportedAt: 1,
  }
  const issueReceipt = receipt('text-open-world.creator.issue.111', ISSUE_RECEIPT_HASH, issueEvidence, 'needs-human')
  const issueWaiver = input.issueWaived ? receipt('text-open-world.creator.issue-waiver.111', '2'.repeat(64), {
    schema: 'storyforge.text-open-world-creator-issue-waiver-evidence', version: 1,
    build, issueKey: 'issue.fixture', issueReceiptHash: ISSUE_RECEIPT_HASH,
    reason: '文字标签仍然清晰可用，本轮接受风险并在下一Build修复视觉对比度。', confirmedAt: 2,
  }, 'waived') : null
  return {
    schema: 'storyforge.text-open-world-creator-quality-workspace', version: 1,
    productionId: 71, buildId: 81, build, buildStatus: 'release-ready',
    governanceSnapshotHash: '3'.repeat(64),
    hardChecks: [{ gateKey: 'qa.schema.valid', label: '生产QA Schema有效', passed: true, evidenceHashes: [HASH] }],
    hardGatesPassed: true,
    reviews: [
      { reviewKind: 'balance', artifactHash: HASH, reviewHash: HASH, minimumScore: 91, threshold: 70, verdict: 'pass', scores: [{ metricKey: 'progression', score: 91, rationale: '成长曲线闭合' }], findings: [] },
      { reviewKind: 'semantic', artifactHash: HASH, reviewHash: HASH, minimumScore: 80, threshold: 70, verdict: 'pass', scores: [{ metricKey: 'mainline-arc', score: 80, rationale: '主线可完成' }], findings: [] },
    ],
    modelFindings: [{
      findingKey: FINDING_KEY, reviewKind: 'semantic', metricKey: 'mainline-arc',
      severity: 'advisory', score: 80, summary: '终章转折仍可增加铺垫', evidence: '结局前一段',
      targetArtifactKey: 'text-open-world.story-arc', targetEntityKeys: ['ending.fixture'],
      repairTaskKey: 'p3.story-arc',
    }],
    calibrationReadiness: {
      generator: { provider: 'deepseek', model: 'deepseek-v4-pro' },
      grader: { provider: 'claude', model: 'claude-sonnet-4-20250514' },
      credentialReady: true, independentIdentity: true, ready: true, issue: null,
    },
    calibrationReceipt: input.calibration ? receipt('text-open-world.creator.release-calibration', '9'.repeat(64), {
      independentReview: { scores: [
        { metricKey: 'mainline-quality', score: 90 },
        { metricKey: 'significant-stories', score: 88 },
        { metricKey: 'template-differentiation', score: 86 },
      ], findings: [] },
      templateDifferentiation: { templateCount: 5, variantCount: 15 },
      contentDuration: { mainlineMinutes: 105, optionalInventoryMinutes: 220 },
      productionUsage: { modelCalls: 187, averageCallDurationMs: 1200, p95CallDurationMs: 2400, estimatedTextCostUsd: 2.5 },
    }) : null,
    grayboxCandidates: [{
      sessionId: 901, title: '完整核心循环', createdAt: 1, updatedAt: 2, completed: true,
      endingKey: 'ending.fixture',
      coverageKeys: ['checkpoint-replay', 'combat', 'governed-action', 'growth-or-economy', 'mainline-ending', 'world-exploration'],
      missingCoverageKeys: [], eventCount: 24, checkpointCount: 2, source: 'build-preview',
      witness: {},
    }, ...(input.twoEndings ? [{
      sessionId: 902, title: '第二结局路线', createdAt: 3, updatedAt: 4, completed: true,
      endingKey: 'ending.second',
      coverageKeys: ['checkpoint-replay', 'combat', 'governed-action', 'growth-or-economy', 'mainline-ending', 'world-exploration'],
      missingCoverageKeys: [], eventCount: 28, checkpointCount: 2, source: 'build-preview', witness: {},
    }] : [])],
    grayboxReceipt: input.graybox ? receipt('text-open-world.creator.graybox', '4'.repeat(64), {
      sessions: [{ sessionWitnessKey: 'session.fixture' }],
    }) : null,
    fullPlaytestReceipt: null,
    updateVerificationReadiness: {
      required: false, ready: false, issue: null,
      sourceReleaseVersion: null, targetReleaseVersion: null, compatibility: null,
      sourceIssues: [], sourceLowScores: [], sourceSessionCandidates: [],
      migratedSessionCandidates: [], targetRouteWitnessKeys: [],
    },
    updateVerificationReceipt: null,
    issues: [{ receipt: issueReceipt, waiver: issueWaiver, blocksRelease: !issueWaiver, portableJson: '{}' }],
    semanticDecisionReceipt: null, releaseQualityReceipt: null,
    releaseQualityReady: false,
    blockers: input.graybox ? ['作者最终质量抽检尚未冻结'] : ['尚无当前Build的完整隔离灰盒试玩回执'],
  }
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const result = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  if (!result) throw new Error(`button not found:${label}`)
  return result
}

function setValue(element: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Text Open World G5-09 · Creator quality studio UI', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    for (const mock of Object.values(mocks)) if ('mockReset' in mock) mock.mockReset()
    mocks.portable.mockReturnValue('{"portable":true}')
    mocks.recordGraybox.mockResolvedValue({})
    mocks.recordFullPlaytest.mockResolvedValue({})
    mocks.recordUpdateVerification.mockResolvedValue({})
    mocks.recordCalibration.mockResolvedValue({})
    mocks.recordIssue.mockResolvedValue({ receipt: { evidence: { issueKey: 'issue.created' } } })
    mocks.waiveIssue.mockResolvedValue({})
    mocks.finalize.mockResolvedValue({})
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('展示硬门和双评审，并以完整覆盖及五项人工确认冻结灰盒回执', async () => {
    mocks.read.mockResolvedValue(workspace())
    const onPreview = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldCreatorQualityStudio, {
      scope: SCOPE, productionId: 71, buildId: 81, refreshToken: '1',
      onPreview, onChanged: vi.fn(),
    })))
    await vi.waitFor(() => expect(host.textContent).toContain('完整核心循环'))
    expect(host.textContent).toContain('生产QA Schema有效')
    expect(host.textContent).toContain('终章转折仍可增加铺垫')
    expect(host.textContent).toContain('已验证 · 完成一条主线结局')

    await act(async () => button(host, '试玩当前Build').click())
    expect(onPreview).toHaveBeenCalledOnce()
    const graybox = host.querySelector<HTMLElement>('section[aria-labelledby="creator-graybox-title"]')!
    const confirmations = [...graybox.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')]
    expect(confirmations).toHaveLength(5)
    for (const checkbox of confirmations) await act(async () => checkbox.click())
    const confirm = button(graybox, '确认试玩并冻结回执')
    expect(confirm.disabled).toBe(false)
    await act(async () => confirm.click())
    await vi.waitFor(() => expect(mocks.recordGraybox).toHaveBeenCalledOnce())
    expect(mocks.recordGraybox).toHaveBeenCalledWith(expect.objectContaining({
      scope: SCOPE, productionId: 71, buildId: 81, sessionIds: [901],
      humanChecks: {
        refreshedAndRecovered: true, guidanceWasUnderstandable: true,
        narrativeExperienceReviewed: true, mediaAndFallbacksReviewed: true,
        allObservedProblemsReported: true,
      },
    }))
  })

  it('独立校准必须由作者显式触发，调用完成后展示质量、库存、延迟和费用证据', async () => {
    mocks.read
      .mockResolvedValueOnce(workspace({ graybox: true }))
      .mockResolvedValue(workspace({ graybox: true, calibration: true }))
    await act(async () => root.render(createElement(TextOpenWorldCreatorQualityStudio, {
      scope: SCOPE, productionId: 71, buildId: 81, refreshToken: '1',
      onPreview: vi.fn(), onChanged: vi.fn(),
    })))
    await vi.waitFor(() => expect(host.textContent).toContain('生产生成器：deepseek/deepseek-v4-pro'))
    await act(async () => button(host, '运行一次独立校准并冻结回执').click())
    await vi.waitFor(() => expect(mocks.recordCalibration).toHaveBeenCalledOnce())
    expect(mocks.recordCalibration).toHaveBeenCalledWith({
      scope: SCOPE, productionId: 71, buildId: 81,
    })
    await vi.waitFor(() => expect(host.textContent).toContain('校准通过'))
    expect(host.textContent).toContain('模板 5 个 / 变体 15 个')
    expect(host.textContent).toContain('P95 2400ms')
    expect(host.textContent).toContain('冻结价格估算 $2.5000')
  })

  it('只有两条不同结局、十项说明、时长、费用观察与真人声明齐全时才可冻结完整试玩', async () => {
    mocks.read.mockResolvedValue(workspace({ calibration: true, twoEndings: true }))
    await act(async () => root.render(createElement(TextOpenWorldCreatorQualityStudio, {
      scope: SCOPE, productionId: 71, buildId: 81, refreshToken: '1',
      onPreview: vi.fn(), onChanged: vi.fn(),
    })))
    await vi.waitFor(() => expect(host.textContent).toContain('2 个不同结局'))
    const section = host.querySelector<HTMLElement>('[data-testid="text-open-world-creator-full-playtest"]')!
    const firstMinutes = section.querySelector<HTMLInputElement>('input[aria-label="试玩时长 完整核心循环"]')!
    const secondMinutes = section.querySelector<HTMLInputElement>('input[aria-label="试玩时长 第二结局路线"]')!
    await act(async () => {
      setValue(firstMinutes, '95')
      setValue(secondMinutes, '110')
    })
    const assessmentNotes = [...section.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label^="试玩说明 "]')]
    expect(assessmentNotes).toHaveLength(10)
    for (const note of assessmentNotes) {
      await act(async () => setValue(note, '这项体验已经在两条完整路线中由本人实际检查并记录。'))
    }
    const costNote = section.querySelector<HTMLTextAreaElement>('textarea[aria-label="费用与等待说明"]')!
    await act(async () => setValue(costNote, '服务商无法拆分本次费用，实际等待时间在可接受范围。'))
    const checks = [...section.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')]
    expect(checks).toHaveLength(4)
    for (const checkbox of checks) await act(async () => checkbox.click())
    const confirm = button(section, '复验双路线并冻结真人完整试玩回执')
    expect(confirm.disabled).toBe(false)
    await act(async () => confirm.click())
    await vi.waitFor(() => expect(mocks.recordFullPlaytest).toHaveBeenCalledOnce())
    expect(mocks.recordFullPlaytest).toHaveBeenCalledWith(expect.objectContaining({
      routes: [
        { sessionId: 901, reportedActiveMinutes: 95 },
        { sessionId: 902, reportedActiveMinutes: 110 },
      ],
      humanChecks: {
        personallyPlayedAllRoutes: true, noAutomationOrModelProxy: true,
        freeInputActuallyTested: true, allObservedProblemsReported: true,
      },
      costObservation: expect.objectContaining({ source: 'not-available', runtimeCostUsd: null }),
    }))
  })

  it('逐项软豁免问题和模型finding后才允许冻结最终质量结论', async () => {
    mocks.read
      .mockResolvedValueOnce(workspace({ graybox: true }))
      .mockResolvedValue(workspace({ graybox: true, issueWaived: true, calibration: true }))
    await act(async () => root.render(createElement(TextOpenWorldCreatorQualityStudio, {
      scope: SCOPE, productionId: 71, buildId: 81, refreshToken: '1',
      onPreview: vi.fn(), onChanged: vi.fn(),
    })))
    await vi.waitFor(() => expect(host.textContent).toContain('窄屏按钮对比度偏低'))
    const issueReason = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="问题软豁免理由 issue.fixture"]')!
    await act(async () => setValue(issueReason, '文字标签仍然清晰可用，本轮接受风险并在下一Build修复视觉对比度。'))
    const waive = button(host, '确认软豁免')
    expect(waive.disabled).toBe(false)
    await act(async () => waive.click())
    await vi.waitFor(() => expect(mocks.waiveIssue).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(host.textContent).toContain('已绑定软豁免'))

    const findingReason = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="软豁免理由 ${FINDING_KEY}"]`)!
    await act(async () => setValue(findingReason, '首轮真人试玩已经覆盖结局路径，本建议进入下一Build补充更多铺垫。'))
    const finalSection = host.querySelector<HTMLElement>('section[aria-labelledby="creator-final-quality-title"]')!
    const checks = [...finalSection.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')]
    expect(checks).toHaveLength(5)
    for (const checkbox of checks) await act(async () => checkbox.click())
    const finalize = button(finalSection, '复验全部证据并冻结质量结论')
    expect(finalize.disabled).toBe(false)
    await act(async () => finalize.click())
    await vi.waitFor(() => expect(mocks.finalize).toHaveBeenCalledOnce())
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({
      semanticWaivers: [{
        findingKey: FINDING_KEY,
        reason: '首轮真人试玩已经覆盖结局路径，本建议进入下一Build补充更多铺垫。',
      }],
      humanChecks: {
        narrativeAndGuidanceReviewed: true, regionalAndQuestVarietyReviewed: true,
        dialogueAndKnowledgeReviewed: true, mediaAndAccessibilityReviewed: true,
        issueListComplete: true,
      },
    }))
  })

  it('正式修复Release逐项绑定原问题、真人路线和旧档策略后才能冻结更新回执', async () => {
    const value = workspace({ calibration: true, twoEndings: true }) as ReturnType<typeof workspace> & Record<string, any>
    value.buildStatus = 'released'
    value.releaseQualityReady = true
    value.updateVerificationReadiness = {
      required: true, ready: true, issue: null,
      sourceReleaseVersion: 1, targetReleaseVersion: 2,
      compatibility: { level: 'compatible', migrationPolicy: 'additive', reportHash: '7'.repeat(64) },
      sourceIssues: [{
        sourceIssueReceiptHash: ISSUE_RECEIPT_HASH,
        issueKey: 'issue.fixture', category: 'ui-accessibility', severity: 'advisory',
        affectedStableKeys: ['ui.quest.primary'],
      }],
      sourceLowScores: [{ criterionKey: 'quest-variety', sourceRating: 2, targetRating: 4 }],
      sourceSessionCandidates: [{ sessionId: 701, title: '旧版正式存档', status: 'active' }],
      migratedSessionCandidates: [{ sessionId: 702, title: '新版迁移子档', parentSessionId: 701 }],
      targetRouteWitnessKeys: ['session.route.one', 'session.route.two'],
    }
    mocks.read.mockResolvedValue(value)
    await act(async () => root.render(createElement(TextOpenWorldCreatorQualityStudio, {
      scope: SCOPE, productionId: 71, buildId: 81, refreshToken: '1',
      onPreview: vi.fn(), onChanged: vi.fn(),
    })))
    await vi.waitFor(() => expect(host.textContent).toContain('修复版真人更新验证'))
    const section = host.querySelector<HTMLElement>('[data-testid="text-open-world-creator-update-verification"]')!
    const issueNote = section.querySelector<HTMLTextAreaElement>('textarea[aria-label="更新问题复测说明 issue.fixture"]')!
    const lowNote = section.querySelector<HTMLTextAreaElement>('textarea[aria-label="更新低分复测说明 quest-variety"]')!
    await act(async () => {
      setValue(issueNote, '已在新版本的两条完整路线中复现并确认按钮对比度恢复。')
      setValue(lowNote, '新版任务目标和包装差异已经在两条路线中由本人重新检查。')
    })
    const checks = [...section.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')]
      .filter(input => input.type === 'checkbox')
    expect(checks).toHaveLength(4)
    for (const checkbox of checks) await act(async () => checkbox.click())
    const confirm = button(section, '复验修复、Release与旧档并冻结更新回执')
    expect(confirm.disabled).toBe(false)
    await act(async () => confirm.click())
    await vi.waitFor(() => expect(mocks.recordUpdateVerification).toHaveBeenCalledOnce())
    expect(mocks.recordUpdateVerification).toHaveBeenCalledWith(expect.objectContaining({
      sourceSessionId: 701,
      saveMode: 'continued-on-source-release',
      migratedSessionId: null,
      issueResolutions: [{
        sourceIssueReceiptHash: ISSUE_RECEIPT_HASH,
        targetRouteWitnessKeys: ['session.route.one', 'session.route.two'],
        verificationNote: '已在新版本的两条完整路线中复现并确认按钮对比度恢复。',
      }],
      lowScoreResolutions: [{
        criterionKey: 'quest-variety',
        targetRouteWitnessKeys: ['session.route.one', 'session.route.two'],
        verificationNote: '新版任务目标和包装差异已经在两条路线中由本人重新检查。',
      }],
      humanChecks: {
        repairedBehaviorRetested: true, oldVersionStillAvailable: true,
        savePolicyActuallyVerified: true, noAutomationOrModelProxy: true,
      },
    }))
  })
})
