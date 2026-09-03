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

export function effectiveWorkspacePurpose(project: Project): WorkspacePurpose {
  return project.workspacePurpose ?? 'independent-work'
}
