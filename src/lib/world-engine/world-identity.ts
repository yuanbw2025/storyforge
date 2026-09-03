import type { World } from '../types'

export function isPublicWorldCode(value: unknown): value is string {
  return typeof value === 'string' && /^W-[A-Z0-9]{4,}-[A-Z0-9]{4,}$/.test(value)
}

export function isShareableWorld(world: Pick<World, 'identityKind' | 'code'>): boolean {
  return world.identityKind === 'world-draft' && isPublicWorldCode(world.code)
}
