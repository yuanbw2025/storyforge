import { afterEach, describe, expect, it } from 'vitest'
import {
  isMemoryEngineeringRuntimeEnabledV1,
  MEMORY_ENGINEERING_RUNTIME_STORAGE_KEY_V1,
  setMemoryEngineeringRuntimeEnabledV1,
} from '../../src/lib/memory/runtime'
import {
  WORKSPACE_DOCUMENT_CHANGE_KINDS_V1,
  WORKSPACE_DOCUMENT_CODECS_V1,
  WORKSPACE_DOCUMENT_EDIT_POLICIES_V1,
} from '../../src/lib/types/memory-engineering'

describe('MEMORY-0 · workspace safety foundation', () => {
  afterEach(() => localStorage.removeItem(MEMORY_ENGINEERING_RUNTIME_STORAGE_KEY_V1))

  it('keeps the closed MEMORY-4 runtime enabled with a local rollback switch', () => {
    expect(isMemoryEngineeringRuntimeEnabledV1()).toBe(true)
    setMemoryEngineeringRuntimeEnabledV1(false)
    expect(isMemoryEngineeringRuntimeEnabledV1()).toBe(false)
    setMemoryEngineeringRuntimeEnabledV1(true)
    expect(isMemoryEngineeringRuntimeEnabledV1()).toBe(true)
  })

  it('freezes the closed document and three-way change vocabularies', () => {
    expect(WORKSPACE_DOCUMENT_CODECS_V1).toEqual([
      'markdown-frontmatter', 'yaml', 'json', 'jsonl',
    ])
    expect(WORKSPACE_DOCUMENT_EDIT_POLICIES_V1).toEqual([
      'author-editable', 'candidate-editable', 'machine-readonly',
    ])
    expect(WORKSPACE_DOCUMENT_CHANGE_KINDS_V1).toEqual([
      'clean', 'project-changed', 'file-changed', 'same-change',
      'conflict', 'file-missing', 'file-extra', 'invalid',
    ])
  })
})
