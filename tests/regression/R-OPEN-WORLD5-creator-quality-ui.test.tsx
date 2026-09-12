import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceScope } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  recordGraybox: vi.fn(),
  recordIssue: vi.fn(),
  waiveIssue: vi.fn(),
  finalize: vi.fn(),
  portable: vi.fn(() => '{"portable":true}'),
  download: vi.fn(),
}))

vi.mock('../../src/lib/open-world/creator-quality', () => ({
  readTextOpenWorldCreatorQualityWorkspaceV1: mocks.read,
  recordTextOpenWorldCreatorGrayboxV1: mocks.recordGraybox,
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

function workspace(input: { graybox?: boolean; issueWaived?: boolean } = {}) {
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
    grayboxCandidates: [{
      sessionId: 901, title: '完整核心循环', createdAt: 1, updatedAt: 2, completed: true,
      endingKey: 'ending.fixture',
      coverageKeys: ['checkpoint-replay', 'combat', 'governed-action', 'growth-or-economy', 'mainline-ending', 'world-exploration'],
      missingCoverageKeys: [], eventCount: 24, checkpointCount: 2,
      witness: {},
    }],
    grayboxReceipt: input.graybox ? receipt('text-open-world.creator.graybox', '4'.repeat(64), {
      sessions: [{ sessionWitnessKey: 'session.fixture' }],
    }) : null,
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

  it('逐项软豁免问题和模型finding后才允许冻结最终质量结论', async () => {
    mocks.read
      .mockResolvedValueOnce(workspace({ graybox: true }))
      .mockResolvedValue(workspace({ graybox: true, issueWaived: true }))
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
})
