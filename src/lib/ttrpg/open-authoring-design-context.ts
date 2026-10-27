/** Registered S2 reader: caller supplies a saved revision, never source bodies. */
import type { AssembleContextInput } from '../registry/types'
import { resolveScope } from '../workspace/scope'
import { prepareTtrpgOpenAuthoringDesignSourceV1 } from './open-authoring-design-source'

export async function readTtrpgOpenAuthoringDesignContextV1(input: AssembleContextInput): Promise<string> {
  if (!input.scope || !Number.isSafeInteger(input.ttrpgAuthoringDesignRevision) || input.ttrpgAuthoringDesignRevision! < 0) {
    throw new Error('[ttrpg-authoring-design] 登记来源需要明确作品与已保存草稿版本')
  }
  const scope = await resolveScope(input)
  const prepared = await prepareTtrpgOpenAuthoringDesignSourceV1({ scope, revision: input.ttrpgAuthoringDesignRevision! })
  return JSON.stringify(prepared.source)
}
