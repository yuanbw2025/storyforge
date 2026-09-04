import type { Project, WorkspacePurpose } from '../types'

/** Public identifier primitive used only when a workspace creates/promotes a shareable World. */
export function generateWorldCode(now = Date.now(), entropy = Math.random()): string {
  const timePart = now.toString(36).toUpperCase().slice(-5).padStart(5, '0')
  const randomPart = entropy.toString(36).slice(2, 6).toUpperCase().padEnd(4, '0')
  return `W-${timePart}-${randomPart}`
}

/** Internal scope identity for an independent product workspace; never a public World code. */
export function generateWorkspaceScopeCode(now = Date.now(), entropy = Math.random()): string {
  const timePart = now.toString(36).toUpperCase().slice(-6).padStart(6, '0')
  const randomPart = entropy.toString(36).slice(2, 8).toUpperCase().padEnd(6, '0')
  return `S-${timePart}-${randomPart}`
}

/** Exact stable identity for the internal scope root of an independent work. */
export function isWorkspaceScopeCode(value: unknown): value is string {
  return typeof value === 'string' && /^S-[A-Z0-9]{6}-[A-Z0-9]{6}$/.test(value)
}

/** Exact stable identity for a shareable world root. */
export function isPublicWorldCode(value: unknown): value is string {
  return typeof value === 'string' && /^W-[A-Z0-9]{5}-[A-Z0-9]{4}$/.test(value)
}

export function isCurrentWorldCode(
  identityKind: 'workspace-scope' | 'world-draft',
  value: unknown,
): value is string {
  return identityKind === 'workspace-scope'
    ? isWorkspaceScopeCode(value)
    : isPublicWorldCode(value)
}

export function effectiveWorkspacePurpose(project: Project): WorkspacePurpose {
  if (project.workspacePurpose === 'independent-work' || project.workspacePurpose === 'world-engine') {
    return project.workspacePurpose
  }
  throw new Error('本地工作区缺少明确产品用途')
}
