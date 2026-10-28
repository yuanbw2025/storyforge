// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { avgRegionProcessedFixture } from '../helpers/avg-region-processed-fixture'
import { parseAvgImageProcessingPlanV1, parseAvgImageProcessingPlanV2, parseAvgImageProcessingPlanV3,
  parseAvgImageProcessingRecipeV1, parseAvgProcessedImagePayloadV1 } from '../../src/lib/avg/image-processing-contract'
import { parseAvgProcessedImagePayloadV2, parseAvgProcessedImagePayload } from '../../src/lib/avg/image-processing-contract-v2'
import { parseAvgProcessedImagePayloadV3 } from '../../src/lib/avg/image-processing-contract-v3'
import { readAvgRegionRecipeReferenceV1 } from '../../src/lib/avg/image-region-composite-binding'
import { parseAvgGeneratedReferenceSourceV9 } from '../../src/lib/avg/visual-region-source-contract'
import { parseAvgGeneratedReferenceSourceV6, parseAvgGeneratedReferenceSourceV8, parseAvgGeneratedImageSource } from '../../src/lib/avg/media-generated-reference-contract'

describe('AVG composition V3 contracts and V9 portable source — scalar evidence is not admission', () => {
  it('admits an explicit mixed V3 plan while strict V1/V2 reject the new recipe', async () => {
    const { payload } = await avgRegionProcessedFixture(), entries = [{ requirementKey: payload.requirementKey, recipe: payload.recipe }]
    const old = parseAvgImageProcessingRecipeV1({ schema: 'storyforge.avg.image-processing-recipe', version: 1,
      width: 64, height: 64, crop: null, fit: 'contain', anchor: { x: 5000, y: 5000 }, background: null, declaration: 'synthetic old recipe' })
    expect(parseAvgImageProcessingPlanV3({ schema: 'storyforge.avg.image-processing-plan', version: 3, entries: [...entries, { requirementKey: 'other', recipe: old }] }).entries).toHaveLength(2)
    expect(() => parseAvgImageProcessingPlanV1({ schema: 'storyforge.avg.image-processing-plan', version: 1, entries })).toThrow()
    expect(() => parseAvgImageProcessingPlanV2({ schema: 'storyforge.avg.image-processing-plan', version: 2, entries })).toThrow()
    expect(() => parseAvgImageProcessingPlanV3({ schema: 'storyforge.avg.image-processing-plan', version: 3, entries: [{ requirementKey: 'old', recipe: old }] })).toThrow()
  })
  it('requires an exact allowed identity reference before generation; pose/style/missing source cannot stand in', async () => {
    const { payload, reference } = await avgRegionProcessedFixture()
    expect(readAvgRegionRecipeReferenceV1(payload.recipe, { mediaKind: 'character-expression', references: [reference] })).toEqual(reference)
    expect(() => readAvgRegionRecipeReferenceV1(payload.recipe, { mediaKind: 'character-pose', references: [reference] })).toThrow()
    expect(() => readAvgRegionRecipeReferenceV1(payload.recipe, { mediaKind: 'character-expression', references: [{ ...reference, purpose: 'style' }] })).toThrow()
    expect(() => readAvgRegionRecipeReferenceV1(payload.recipe, { mediaKind: 'character-expression', references: [{ ...reference, assetVersion: reference.assetVersion + 1 }] })).toThrow()
    const { generatedSource: _source, ...missing } = reference
    expect(() => readAvgRegionRecipeReferenceV1(payload.recipe, { mediaKind: 'character-expression', references: [missing] })).toThrow()
  })
  it('binds full two-input metadata/permissions, never relabels the payload as legacy V1/V2', async () => {
    const { payload } = await avgRegionProcessedFixture()
    await expect(parseAvgProcessedImagePayload(payload)).resolves.toEqual(payload)
    await expect(parseAvgProcessedImagePayloadV1(payload)).rejects.toThrow()
    await expect(parseAvgProcessedImagePayloadV2(payload)).rejects.toThrow()
    const changed = structuredClone(payload); changed.inputEvidence.base.reference.contentPolicy.permittedFeatures.push('another-permission')
    await expect(parseAvgProcessedImagePayloadV3(changed)).rejects.toThrow(/两来源|回执/)
    const producer = structuredClone(payload); producer.inputEvidence.raw.producerReceiptHash = 'f'.repeat(64)
    await expect(parseAvgProcessedImagePayloadV3(producer)).rejects.toThrow()
  })
  it('uses a distinct source9 packet with actual composition hashes and keeps old source parsers strict', async () => {
    const { payload } = await avgRegionProcessedFixture(), h = 'a'.repeat(64), requirementKey = payload.requirementKey
    const common = { buildNumber: 2, briefHash: 'b'.repeat(64), planHash: 'c'.repeat(64), controlEpoch: 0,
      artifactVersion: 1, inputHash: h, producerReceiptHash: h, candidateHash: h, proofHash: h }
    const value = { schema: 'storyforge.avg.generated-reference-source', version: 9, productionKey: 'synthetic.current', requirementKey,
      raw: { schema: 'storyforge.avg.visual-image-producer-proof', version: 5, ...common, taskKey: `avg.media.generate.${requirementKey}`,
        artifactKey: `avg.media.raw.${requirementKey}`, contentHash: payload.raw.contentHash, responseEvidenceHash: h }, original: null,
      processing: { schema: 'storyforge.avg.image-processing-producer-proof', version: 1, noProviderRequest: true, ...common,
        taskKey: `avg.media.process.${requirementKey}`, artifactKey: `avg.media.processed.${requirementKey}`, contentHash: payload.receipt.output.contentHash, processingEvidenceHash: h },
      compilation: { artifactKey: 'avg.media.compiled-visual-requirements', version: 1, contentHash: h },
      choice: { artifactKey: `avg.media.choice.${requirementKey}`, version: 1, contentHash: h, authorReceiptHash: h },
      review: { artifactKey: `avg.review.visual.${requirementKey}`, version: 1, contentHash: h, authorReceiptHash: h },
      composition: { recipeHash: payload.receipt.recipeHash, processingReceiptHash: payload.receipt.receiptHash,
        baseReferenceHash: payload.receipt.inputProof.baseReferenceHash, baseGeneratedSourceHash: payload.receipt.inputProof.baseGeneratedSourceHash, inputProofHash: payload.receipt.inputProof.inputProofHash } }
    expect(parseAvgGeneratedImageSource(value)).toEqual(parseAvgGeneratedReferenceSourceV9(value))
    expect(() => parseAvgGeneratedReferenceSourceV9({ ...value, review: { ...value.review, artifactKey: `avg.media.visual-review.${requirementKey}` } })).toThrow()
    expect(() => parseAvgGeneratedReferenceSourceV6(value)).toThrow(); expect(() => parseAvgGeneratedReferenceSourceV8(value)).toThrow()
    expect(() => parseAvgGeneratedReferenceSourceV9({ ...value, composition: { ...value.composition, inferred: true } })).toThrow()
    expect(() => parseAvgGeneratedReferenceSourceV9({ ...value, processing: { ...value.processing, buildNumber: 1 } })).toThrow()
  })
})
