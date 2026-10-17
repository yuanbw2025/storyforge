/** Budgeted open envelope for the existing ProductProduction lifecycle. The detached V3 handoff remains unchanged. */
import type { ProductProductionBriefV3 } from '../types'
import type { TtrpgProductionBriefContentV3 } from './production-brief-v3'
import { validateTtrpgProductionBriefContentV3 } from './production-brief-v3'
import { parseProductProductionBriefV3 } from '../product-production/contracts'

export async function createTtrpgOpenProductionBriefV3(input: {
  common: Omit<ProductProductionBriefV3, 'ttrpg' | 'ttrpgOpen'>
  content: TtrpgProductionBriefContentV3
}): Promise<ProductProductionBriefV3> {
  if (Object.prototype.hasOwnProperty.call(input.common, 'ttrpg') || Object.prototype.hasOwnProperty.call(input.common, 'ttrpgOpen')) {
    throw new Error('[ttrpg-open-production-brief] 共同制作合同不能夹带另一份跑团契约')
  }
  const snapshot = structuredClone(input)
  const content = await validateTtrpgProductionBriefContentV3(snapshot.content)
  return parseProductProductionBriefV3({ ...snapshot.common, ttrpgOpen: content })
}
