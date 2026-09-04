import { normalizeProductRuntimeCommandIdV1 } from '../product/runtime-command-id'

export function adventureNarrativeActionCommandIdV1(sessionId: number, choiceKey: string): string {
  return normalizeProductRuntimeCommandIdV1(`choice-action:${sessionId}:${choiceKey}`)
}
