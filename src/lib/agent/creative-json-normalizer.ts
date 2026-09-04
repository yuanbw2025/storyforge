import type { CreativeArtifactIssueV1 } from './creative-reliability'
import {
  evaluateStructuredOutputV1,
  StructuredOutputPipelineErrorV1,
  type StructuredOutputNormalizationStepV1,
} from './structured-output-pipeline'

export type CreativeJsonNormalizationStepV1 = StructuredOutputNormalizationStepV1

export interface CreativeJsonEnvelopeResultV1 {
  version: 1
  originalText: string
  normalizedText: string
  value: Record<string, unknown> | null
  steps: CreativeJsonNormalizationStepV1[]
  issues: CreativeArtifactIssueV1[]
}

function creativeCode(code: string): string {
  if (code === 'structured-output-invalid-json') return 'creative-json-invalid'
  if (code === 'structured-output-root-mismatch') return 'creative-json-not-single-object'
  return 'creative-json-not-single-object'
}

function creativeIssue(error: StructuredOutputPipelineErrorV1): CreativeArtifactIssueV1[] {
  return error.evidence.issues.map(item => ({
    version: 1,
    code: creativeCode(item.code),
    severity: 'error',
    disposition: item.repairable ? 'repairable' : 'blocking',
    path: item.path,
    message: item.message,
    suggestedAction: item.repairable ? 'repair-once' : 'replan',
    evidenceRefs: [],
    deterministic: true,
  }))
}

/**
 * CreativeArtifact facade over the single WEH-0E structured
 * output pipeline. It accepts only deterministic envelope salvage and never
 * invents fields or creative content.
 */
export function normalizeCreativeJsonEnvelopeV1(raw: string): CreativeJsonEnvelopeResultV1 {
  try {
    const result = evaluateStructuredOutputV1({
      raw,
      contract: {
        version: 1,
        schemaId: 'creative-json-object-envelope.v1',
        target: 'creative-candidate',
        root: 'object',
        maxChars: 120_000,
      },
      parse: value => value as Record<string, unknown>,
    })
    return {
      version: 1,
      originalText: raw,
      normalizedText: result.evidence.normalizedText,
      value: result.output,
      steps: result.evidence.normalizationSteps,
      issues: [],
    }
  } catch (error) {
    if (!(error instanceof StructuredOutputPipelineErrorV1)) throw error
    return {
      version: 1,
      originalText: raw,
      normalizedText: error.evidence.normalizedText,
      value: null,
      steps: error.evidence.normalizationSteps,
      issues: creativeIssue(error),
    }
  }
}
