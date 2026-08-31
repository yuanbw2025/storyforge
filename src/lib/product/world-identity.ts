import type { Project, WorkspacePurpose, World } from '../types'

export function generateWorldCode(now = Date.now(), entropy = Math.random()): string {
  const timePart = now.toString(36).toUpperCase().slice(-5).padStart(5, '0')
  const randomPart = entropy.toString(36).slice(2, 6).toUpperCase().padEnd(4, '0')
  return `W-${timePart}-${randomPart}`
}

export function generateWorkspaceScopeCode(now = Date.now(), entropy = Math.random()): string {
  const timePart = now.toString(36).toUpperCase().slice(-6).padStart(6, '0')
  const randomPart = entropy.toString(36).slice(2, 8).toUpperCase().padEnd(6, '0')
  return `S-${timePart}-${randomPart}`
}

export function isPublicWorldCode(value: unknown): value is string {
  return typeof value === 'string' && /^W-[A-Z0-9]{4,}-[A-Z0-9]{4,}$/.test(value)
}

export function effectiveWorkspacePurpose(project: Project): WorkspacePurpose {
  return project.workspacePurpose ?? 'independent-work'
}

export function isShareableWorld(world: Pick<World, 'identityKind' | 'code'>): boolean {
  return world.identityKind === 'world-draft' && isPublicWorldCode(world.code)
}

export function hasShareableWorldIdentity(project: Project): boolean {
  return effectiveWorkspacePurpose(project) === 'world-engine'
    && Number.isInteger(project.worldVersion)
    && Number(project.worldVersion) >= 0
    && isPublicWorldCode(project.worldCode)
}

/** @deprecated Compatibility helper for explicitly classified world workspaces only. */
export function withWorldIdentity(project: Project): Project {
  if (hasShareableWorldIdentity(project)) return project
  const worldCode = project.worldCode && !/^W-[A-Z0-9]{5}$/.test(project.worldCode)
    ? project.worldCode
    : generateWorldCode()
  return {
    ...project,
    workspacePurpose: 'world-engine',
    workspacePurposeDecision: project.workspacePurposeDecision ?? 'explicit',
    worldCode,
    worldVersion: project.worldVersion ?? 1,
  }
}
