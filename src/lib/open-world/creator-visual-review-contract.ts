import { canonicalProductProductionJsonV2, hashProductProductionValueV2, isSha256Hash } from '../product-production/hash'
import { parseTextOpenWorldCreatorBuildBindingV1, type TextOpenWorldCreatorBuildBindingV1 } from './creator-quality-contract'

export const TEXT_OPEN_WORLD_VISUAL_REVIEW_GATE_V1 = 'text-open-world.media.human-review'
export const TEXT_OPEN_WORLD_VISUAL_REVIEW_POLICY_V1 = 'storyforge.text-open-world-visual-review.v1'
export interface TextOpenWorldVisualReviewAssetV1 {
  artifactKey: string
  contentHash: string
  subjectKey: string
  characterKey: string | null
  alt: string
  width: number
  height: number
  mimeType: string
  source: string
  license: string
}
export interface TextOpenWorldVisualDecisionV1 {
  artifactKey: string
  decision: 'approved' | 'rejected'
  note: string
}
export interface TextOpenWorldVisualReviewEvidenceV1 {
  schema: 'storyforge.text-open-world-visual-review'
  version: 1
  build: TextOpenWorldCreatorBuildBindingV1
  assetsHash: string
  decisions: TextOpenWorldVisualDecisionV1[]
  characterConsistencyConfirmed: true
  imagesActuallyViewed: true
  noAutomationProxy: true
  passed: boolean
  confirmedAt: number
}

function fail(message: string): never { throw new Error(`[text-open-world-visual-review] ${message}`) }

export function parseTextOpenWorldVisualReviewEvidenceV1(raw: unknown): TextOpenWorldVisualReviewEvidenceV1 {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('证据不是对象')
  const row = raw as TextOpenWorldVisualReviewEvidenceV1
  if (row.schema !== 'storyforge.text-open-world-visual-review' || row.version !== 1
    || !isSha256Hash(row.assetsHash) || !Array.isArray(row.decisions)
    || row.decisions.length < 1 || row.decisions.length > 500
    || row.characterConsistencyConfirmed !== true || row.imagesActuallyViewed !== true || row.noAutomationProxy !== true
    || !Number.isSafeInteger(row.confirmedAt) || row.confirmedAt < 1) fail('逐图判断或人工声明不完整')
  const decisions = row.decisions.map(value => {
    if (!value || !/^text-open-world\.media\.visual\.\d{3}$/.test(value.artifactKey)
      || !['approved', 'rejected'].includes(value.decision) || typeof value.note !== 'string'
      || value.note.length > 2000 || (value.decision === 'rejected' && value.note.trim().length < 5)) {
      fail('逐图判断无效；退回须说明至少五字原因')
    }
    return { artifactKey: value.artifactKey, decision: value.decision, note: value.note.trim() }
  }).sort((a, b) => a.artifactKey.localeCompare(b.artifactKey))
  if (new Set(decisions.map(value => value.artifactKey)).size !== decisions.length
    || row.passed !== decisions.every(value => value.decision === 'approved')) fail('逐图判断重复或通过结论不符')
  const parsed: TextOpenWorldVisualReviewEvidenceV1 = {
    schema: row.schema, version: 1, build: parseTextOpenWorldCreatorBuildBindingV1(row.build),
    assetsHash: row.assetsHash, decisions, characterConsistencyConfirmed: true,
    imagesActuallyViewed: true, noAutomationProxy: true, passed: row.passed, confirmedAt: row.confirmedAt,
  }
  if (canonicalProductProductionJsonV2(parsed) !== canonicalProductProductionJsonV2(raw)) fail('逐图证据字段或顺序不规范')
  return parsed
}

/** Checks identity/binding metadata only; visual similarity is a human check. */
export async function inspectTextOpenWorldVisualConsistencyV1(assets: TextOpenWorldVisualReviewAssetV1[]) {
  if (new Set(assets.map(asset => asset.artifactKey)).size !== assets.length) fail('图片集合重复')
  const issues: string[] = []
  for (const asset of assets) {
    if (!isSha256Hash(asset.contentHash) || !asset.subjectKey || !asset.alt.trim()
      || !Number.isSafeInteger(asset.width) || asset.width < 1
      || !Number.isSafeInteger(asset.height) || asset.height < 1
      || !['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(asset.mimeType)
      || !asset.source.trim() || !asset.license.trim()) issues.push(`${asset.artifactKey}：图片身份、尺寸或权利信息不完整`)
  }
  const characterKeys = [...new Set(assets.flatMap(asset => asset.characterKey ? [asset.characterKey] : []))].sort()
  return {
    assetsHash: await hashProductProductionValueV2(assets),
    issues,
    characterGroups: characterKeys.map(characterKey => ({
      characterKey, artifactKeys: assets.filter(asset => asset.characterKey === characterKey).map(asset => asset.artifactKey),
    })),
    visualSimilarity: 'requires-human-review' as const,
  }
}
