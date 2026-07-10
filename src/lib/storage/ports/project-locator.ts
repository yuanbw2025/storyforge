export type ProjectLocator =
  | { backend: 'dexie'; projectId: number }
  | { backend: 'local-folder'; projectUuid: string; projectPath: string }

export function projectLocatorKey(locator: ProjectLocator): string {
  if (locator.backend === 'dexie') {
    return `dexie:${locator.projectId}`
  }

  return `local-folder:${locator.projectUuid}`
}

export function sameProjectLocator(left: ProjectLocator, right: ProjectLocator): boolean {
  return projectLocatorKey(left) === projectLocatorKey(right)
}
