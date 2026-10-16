import type { ChatMessage } from '../types'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { previewQualityRevisionHTMLV1 } from './quality-revision-html'
import { normalizeRichEditorHTMLV1 } from '../editor/rich-editor-schema'
import type { QualityRevisionPlanV1 } from './quality-revision'
import { verifyQualityRecheckV1, type QualityRecheckArtifactV1 } from './quality-recheck'

export const QUALITY_RECHECK_STEP_V1 = 'quality-revision-recheck'
export interface QualityRevisionEvidenceV1 {
  version: 1
  plan: QualityRevisionPlanV1
  sourceHtml: string
  sourceHtmlHash: string
  rawPatches: string
  contentHtml: string
  recheck: QualityRecheckArtifactV1
  recheckMessages: ChatMessage[]
  recheckManifestHash: string
}

export async function verifyQualityRevisionEvidenceV1(evidence: QualityRevisionEvidenceV1, outputText: string): Promise<boolean> {
  try {
    if (!evidence || evidence.version !== 1 || Object.keys(evidence).sort().join('|') !== 'contentHtml|plan|rawPatches|recheck|recheckManifestHash|recheckMessages|sourceHtml|sourceHtmlHash|version'
      || !/^[a-f0-9]{64}$/.test(evidence.recheckManifestHash) || evidence.sourceHtmlHash !== await sha256Text(evidence.sourceHtml)) return false
    const rebuilt = await previewQualityRevisionHTMLV1({ sourceHtml: evidence.sourceHtml, plan: evidence.plan, raw: evidence.rawPatches, normalize: normalizeRichEditorHTMLV1 })
    return rebuilt.contentHtml === evidence.contentHtml && rebuilt.outputText === outputText
      && await verifyQualityRecheckV1(evidence.recheck, evidence.plan, outputText, evidence.recheckMessages)
  } catch { return false }
}
