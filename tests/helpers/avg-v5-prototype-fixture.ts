import { db } from '../../src/lib/db/schema'
import { avgV5MediaReviewFixture, avgV5ReviewReport } from './avg-v5-media-review-fixture'
import { confirmAvgV5PendingCandidate } from './avg-v5-registered-proposals-fixture'
import { stageAvgVisualReviewV2, stageAvgMediaChoiceV5 } from '../../src/lib/avg/visual-review-service-v5'
import { configureAvgChosenMediaDraftV2, stageAvgWorkspaceInputV1, confirmAvgWorkspaceInputV1, runAvgAssemblyV1 } from '../../src/lib/avg/assembly-service'
import { readAvgDraftV1 } from '../../src/lib/avg/draft-service'

/** Actual existing registered model/raw/author/Stage commands. The caller
 * explicitly controls unavailable DOM decoding, and engineering review
 * answers below are not real art/identity/reference or human acceptance. */
export async function avgV5FrozenPrototypeFixtureV1() {
  const s = await avgV5MediaReviewFixture()
  for (const raw of s.rows) {
    const r = JSON.parse(raw.payloadJson).requirement
    await confirmAvgV5PendingCandidate(s, await stageAvgVisualReviewV2({ ...s, requirementKey: r.requirementKey,
      rawVersion: raw.version, rawContentHash: raw.contentHash, report: await avgV5ReviewReport(r, raw.contentHash, 'pass'),
      declaration: 'ENGINEERING controlled reference-policy observations, not actual art acceptance' }))
    await confirmAvgV5PendingCandidate(s, await stageAvgMediaChoiceV5({ ...s, requirementKey: r.requirementKey,
      rawVersion: raw.version, rawContentHash: raw.contentHash, declaration: 'ENGINEERING independent exact image selection' }))
  }
  const saved = await configureAvgChosenMediaDraftV2({ ...s, expectedDraftRevision: (await readAvgDraftV1(s.scope)).revision })
  const candidate = await stageAvgWorkspaceInputV1({ ...s, expectedDraftRevision: saved.revision, artifactKey: 'avg.author.stage',
    declaration: 'ENGINEERING independent five-consumer Stage; actual pixels/route/publication separately verified' })
  await confirmAvgWorkspaceInputV1({ ...s, artifactKey: candidate.artifactKey, candidateVersion: candidate.version,
    candidateHash: JSON.parse(candidate.metadataJson).candidateHash })
  const result = await runAvgAssemblyV1(s), build = (await db.productBuilds.get(s.buildId))!
  if (result.buildStatus !== 'preview-ready') throw new Error(`Actual V5 did not freeze Preview: ${build.status}: ${build.failureJson}`)
  return { ...s, build }
}
