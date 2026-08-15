import { describe, expect, it } from 'vitest'
import {
  creativeArtifactCanAdoptV1,
  parseCreativeArtifactV1,
  type CreativeArtifactIssueV1,
  type CreativeArtifactV1,
} from '../../src/lib/agent/creative-reliability'
import { normalizeCreativeJsonEnvelopeV1 } from '../../src/lib/agent/creative-json-normalizer'

const HASH = 'a'.repeat(64)

function warningIssue(overrides: Partial<CreativeArtifactIssueV1> = {}): CreativeArtifactIssueV1 {
  return {
    version: 1,
    code: 'story-progression-weak',
    severity: 'warning',
    disposition: 'advisory',
    path: '$.storyArcs[0].stages[1]',
    message: '第二阶段的状态变化较弱，建议作者检查。',
    suggestedAction: 'edit',
    evidenceRefs: [],
    deterministic: false,
    ...overrides,
  }
}

function artifact(overrides: Partial<CreativeArtifactV1> = {}): CreativeArtifactV1 {
  return {
    version: 1,
    policyVersion: 'creative-reliability-v1',
    status: 'ready',
    qualityMode: 'balanced',
    originalText: '{"storyArcs":[]}',
    editableText: '[]',
    validFragments: [],
    rejectedFragments: [],
    issues: [],
    assumptions: [],
    canonEvidenceRefs: [],
    callEvidence: [{
      version: 1,
      callIndex: 1,
      purpose: 'generate',
      status: 'succeeded',
      provider: 'fixture',
      model: 'generator-v1',
      usageSource: 'provider',
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      latencyMs: 20,
      estimatedCostUsd: 0.001,
      outputHash: HASH,
    }],
    repair: null,
    ...overrides,
  }
}

describe('R-CREL1 · creative artifact contract', () => {
  it('accepts ready and warning artifacts while keeping manual repair non-adoptable', () => {
    expect(parseCreativeArtifactV1(artifact()).status).toBe('ready')
    expect(creativeArtifactCanAdoptV1(artifact())).toBe(true)

    const warned = parseCreativeArtifactV1(artifact({
      status: 'usable-with-warnings',
      issues: [warningIssue()],
    }))
    expect(creativeArtifactCanAdoptV1(warned)).toBe(true)

    const manual = parseCreativeArtifactV1(artifact({
      status: 'manual-repair',
      issues: [warningIssue({
        code: 'creative-json-invalid',
        severity: 'error',
        disposition: 'repairable',
        suggestedAction: 'edit',
      })],
    }))
    expect(creativeArtifactCanAdoptV1(manual)).toBe(false)
  })

  it('requires blocking evidence for blocked results and forbids blocking warnings', () => {
    expect(() => parseCreativeArtifactV1(artifact({
      status: 'blocked',
      issues: [warningIssue()],
    }))).toThrow('blocked 必须有 blocking')

    expect(() => parseCreativeArtifactV1(artifact({
      status: 'usable-with-warnings',
      issues: [warningIssue({ disposition: 'blocking', suggestedAction: 'replan' })],
    }))).toThrow('不能有 blocking')

    expect(parseCreativeArtifactV1(artifact({
      status: 'blocked',
      issues: [warningIssue({
        code: 'workspace-scope-mismatch',
        severity: 'error',
        disposition: 'blocking',
        suggestedAction: 'replan',
        deterministic: true,
      })],
    })).status).toBe('blocked')
  })

  it('binds exactly one repair to the second and final physical call', () => {
    const repaired = artifact({
      callEvidence: [
        artifact().callEvidence[0],
        {
          ...artifact().callEvidence[0],
          callIndex: 2,
          purpose: 'repair',
          outputHash: 'b'.repeat(64),
        },
      ],
      repair: {
        version: 1,
        sourceTextHash: HASH,
        targetIssueCodes: ['creative-json-invalid'],
        callIndex: 2,
        result: 'repaired',
      },
    })
    expect(parseCreativeArtifactV1(repaired).callEvidence).toHaveLength(2)

    expect(() => parseCreativeArtifactV1(artifact({
      callEvidence: repaired.callEvidence,
      repair: null,
    }))).toThrow('repair 必须与第二次调用同时存在')

    const thirdCall = {
      ...repaired.callEvidence[1],
      callIndex: 3,
    }
    expect(() => parseCreativeArtifactV1({
      ...repaired,
      callEvidence: [...repaired.callEvidence, thirdCall],
    })).toThrow('1-2 次物理模型调用')
  })

  it('rejects token evidence that is internally inconsistent or falsely marked unknown', () => {
    const inconsistent = structuredClone(artifact())
    inconsistent.callEvidence[0].totalTokens = 16
    expect(() => parseCreativeArtifactV1(inconsistent)).toThrow('输入输出之和不一致')

    const unknown = structuredClone(artifact())
    unknown.callEvidence[0].usageSource = 'unknown'
    expect(() => parseCreativeArtifactV1(unknown)).toThrow('token 必须为 null')
  })

  it('rejects duplicate fragment and assumption identities', () => {
    const fragment = {
      version: 1 as const,
      id: 'arc:1',
      path: '$.storyArcs[0]',
      text: '{}',
      status: 'valid' as const,
      issueCodes: [],
    }
    expect(() => parseCreativeArtifactV1(artifact({
      validFragments: [fragment, { ...fragment }],
    }))).toThrow('fragments 包含重复身份')

    const assumption = {
      version: 1 as const,
      id: 'assumption:1',
      text: '主角暂时需要在天亮前离开港口。',
      derivedFrom: ['author-request'],
      confidence: 'medium' as const,
      conflictsWith: [],
      status: 'provisional' as const,
    }
    expect(() => parseCreativeArtifactV1(artifact({
      assumptions: [assumption, { ...assumption }],
    }))).toThrow('assumptions 包含重复身份')
  })
})

describe('R-CREL1 · lossless JSON envelope normalization', () => {
  it('removes only a whole-response JSON fence and outer whitespace', () => {
    const result = normalizeCreativeJsonEnvelopeV1('  ```json\n{"storyArcs":[]}\n```  ')
    expect(result.value).toEqual({ storyArcs: [] })
    expect(result.steps).toEqual(['trim-outer-whitespace', 'remove-single-json-fence'])
    expect(result.issues).toEqual([])
  })

  it('does not guess an object from prose or multiple objects', () => {
    const prose = normalizeCreativeJsonEnvelopeV1('结果如下：{"storyArcs":[]}')
    expect(prose.value).toBeNull()
    expect(prose.issues[0]).toMatchObject({
      code: 'creative-json-not-single-object',
      disposition: 'repairable',
      path: '$',
    })

    const multiple = normalizeCreativeJsonEnvelopeV1('{"a":1}\n{"b":2}')
    expect(multiple.value).toBeNull()
    expect(multiple.issues[0].code).toBe('creative-json-invalid')
  })

  it('does not accept arrays as the root contract', () => {
    const result = normalizeCreativeJsonEnvelopeV1('[{"storyArcs":[]}]')
    expect(result.value).toBeNull()
    expect(result.issues[0].code).toBe('creative-json-not-single-object')
  })
})

