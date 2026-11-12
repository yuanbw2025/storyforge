import { parseLegacyModelJsonV1 } from '../ai/legacy-model-json'

export function parseScreenplayModelJsonV1(raw: string): unknown {
  return parseLegacyModelJsonV1(raw, '[screenplay-run]')
}
