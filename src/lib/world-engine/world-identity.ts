import type { World } from '../types'
import { isPublicWorldCode } from '../workspace/identity'

export { isPublicWorldCode } from '../workspace/identity'

export function isShareableWorld(world: Pick<World, 'identityKind' | 'code'>): boolean {
  return world.identityKind === 'world-draft' && isPublicWorldCode(world.code)
}
