import { afterEach, describe, expect, it } from 'vitest'
import {
  CREATIVE_RELIABILITY_FEEDBACK_MAX_RECORDS_V1,
  CREATIVE_RELIABILITY_FEEDBACK_STORAGE_KEY_V1,
  clearCreativeReliabilityFeedbackV1,
  loadCreativeReliabilityFeedbackV1,
  parseCreativeReliabilityFeedbackBundleV1,
  saveCreativeReliabilityFeedbackV1,
  serializeCreativeReliabilityFeedbackV1,
} from '../../src/lib/feedback/creative-reliability'

afterEach(() => localStorage.clear())

describe('R-CREL14 · 社区体验反馈证据', () => {
  it('只保存结构化体验指标并声明不含项目、正文、模型输出和密钥', () => {
    saveCreativeReliabilityFeedbackV1({
      stage: 'prose',
      outcome: 'edited',
      rating: 4,
      editMinutes: 18,
      tags: ['continuity', 'latency'],
    }, {
      now: 1_786_800_000_000,
      id: 'feedback-1',
      appBuildId: 'test-build',
    })

    const raw = serializeCreativeReliabilityFeedbackV1(localStorage, 1_786_800_000_100)
    const bundle = parseCreativeReliabilityFeedbackBundleV1(JSON.parse(raw))
    expect(bundle?.privacy).toEqual({
      includesProjectIdentity: false,
      includesManuscript: false,
      includesPromptOrModelOutput: false,
      includesApiKeys: false,
      automaticallyUploaded: false,
    })
    expect(bundle?.records).toEqual([{
      id: 'feedback-1',
      createdAt: 1_786_800_000_000,
      appBuildId: 'test-build',
      policyVersion: 'crel-v1',
      stage: 'prose',
      outcome: 'edited',
      rating: 4,
      editMinutes: 18,
      tags: ['continuity', 'latency'],
    }])
    expect(raw).not.toContain('projectId')
    expect(raw).not.toContain('manuscript')
    expect(raw).not.toContain('prompt')
    expect(raw).not.toContain('apiKey')
  })

  it('拒绝额外字段、伪造隐私声明、非法分钟数和重复问题标签', () => {
    const valid = JSON.parse(serializeCreativeReliabilityFeedbackV1(localStorage, 100))
    expect(parseCreativeReliabilityFeedbackBundleV1({ ...valid, projectName: '不可导出' })).toBeNull()
    expect(parseCreativeReliabilityFeedbackBundleV1({
      ...valid,
      privacy: { ...valid.privacy, includesManuscript: true },
    })).toBeNull()

    expect(() => saveCreativeReliabilityFeedbackV1({
      stage: 'prose',
      outcome: 'discarded',
      rating: 2,
      editMinutes: 10_081,
      tags: [],
    })).toThrow('反馈字段不合法')
    expect(() => saveCreativeReliabilityFeedbackV1({
      stage: 'story-arc',
      outcome: 'kept',
      rating: 5,
      editMinutes: 0,
      tags: ['stalled', 'stalled'],
    })).toThrow('反馈字段不合法')
  })

  it('本机最多保留最近 50 条，损坏记录安全降级为空并可清空', () => {
    for (let index = 0; index <= CREATIVE_RELIABILITY_FEEDBACK_MAX_RECORDS_V1; index += 1) {
      saveCreativeReliabilityFeedbackV1({
        stage: 'long-form',
        outcome: 'edited',
        rating: 3,
        editMinutes: index,
        tags: [],
      }, { now: index + 1, id: `feedback-${index}`, appBuildId: 'test-build' })
    }
    const records = loadCreativeReliabilityFeedbackV1()
    expect(records).toHaveLength(CREATIVE_RELIABILITY_FEEDBACK_MAX_RECORDS_V1)
    expect(records[0].id).toBe('feedback-50')
    expect(records.at(-1)?.id).toBe('feedback-1')

    localStorage.setItem(CREATIVE_RELIABILITY_FEEDBACK_STORAGE_KEY_V1, '{broken')
    expect(loadCreativeReliabilityFeedbackV1()).toEqual([])
    clearCreativeReliabilityFeedbackV1()
    expect(localStorage.getItem(CREATIVE_RELIABILITY_FEEDBACK_STORAGE_KEY_V1)).toBeNull()
  })
})
