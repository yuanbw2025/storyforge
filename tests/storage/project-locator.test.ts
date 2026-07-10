import { describe, expect, it } from 'vitest'
import {
  projectLocatorKey,
  sameProjectLocator,
  type ProjectLocator,
} from '../../src/lib/storage/ports/project-locator'

describe('project locator', () => {
  it('为 Dexie 项目生成由后端与 projectId 组成的 key', () => {
    expect(projectLocatorKey({ backend: 'dexie', projectId: 12 })).toBe('dexie:12')
  })

  it('为本地目录项目生成由后端与 projectUuid 组成的 key', () => {
    expect(projectLocatorKey({
      backend: 'local-folder',
      projectUuid: 'book-uuid',
      projectPath: 'F:/books/demo',
    })).toBe('local-folder:book-uuid')
  })

  it('将 projectPath 不同但 projectUuid 相同的本地目录视为同一逻辑项目', () => {
    const left: ProjectLocator = {
      backend: 'local-folder',
      projectUuid: 'book-uuid',
      projectPath: 'F:/books/demo',
    }
    const right: ProjectLocator = {
      backend: 'local-folder',
      projectUuid: 'book-uuid',
      projectPath: 'G:/archive/demo',
    }

    expect(sameProjectLocator(left, right)).toBe(true)
  })

  it('不会将 local-folder 与 dexie 定位器视为同一项目', () => {
    const localFolder: ProjectLocator = {
      backend: 'local-folder',
      projectUuid: '12',
      projectPath: 'F:/books/demo',
    }
    const dexie: ProjectLocator = { backend: 'dexie', projectId: 12 }

    expect(sameProjectLocator(localFolder, dexie)).toBe(false)
  })
})
