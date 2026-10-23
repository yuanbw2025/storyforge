import { describe, expect, it, vi } from 'vitest'
import {
  hashTextOpenWorldCreatorEditPatchV1,
  type TextOpenWorldCreatorEditPatchV1,
} from '../../src/lib/open-world/creator-artifact-edit-contract'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'
import * as progressionCompiler from '../../src/lib/open-world/progression-catalogs-production'

vi.mock('../../src/lib/open-world/progression-catalogs-production', () => ({
  projectTextOpenWorldProgressionCatalogsAuthorEditableDraftV1: async (input: {
    artifact: {
      skills: Array<{ key: string; order: number; title: string; description: string; tags: string[] }>
    }
  }) => ({
    schema: 'storyforge.text-open-world-progression-catalogs-draft',
    version: 1,
    skills: input.artifact.skills.map(skill => ({
      demandNumber: skill.order,
      title: skill.title,
      description: skill.description,
      tags: skill.tags,
    })),
  }),
  rebuildTextOpenWorldProgressionCatalogsFromAuthorEditableDraftV1: async (input: {
    baseArtifact: {
      schema: string
      version: number
      skills: Array<{ key: string; order: number; title: string; description: string; tags: string[] }>
    }
    draft: unknown
  }) => {
    const draft = input.draft as {
      skills: Array<{ demandNumber: number; title: string; description: string; tags: string[] }>
    }
    const { skills: baseSkills, ...rest } = input.baseArtifact
    return {
      skills: draft.skills.map(skill => ({
        ...baseSkills[skill.demandNumber - 1],
        title: skill.title,
        description: skill.description,
        tags: skill.tags,
      })),
      ...rest,
    }
  },
}))

import {
  applyTextOpenWorldCreatorEditPatchToAuthorEditableDraftV1,
  projectTextOpenWorldCreatorAuthorEditableDraftV1,
  rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1,
} from '../../src/lib/open-world/creator-artifact-edit-dispatch'

const ARTIFACT_KEY = 'text-open-world.progression-catalogs'

function artifacts() {
  return [{
    artifactKey: ARTIFACT_KEY,
    payload: {
      schema: 'storyforge.text-open-world-progression-catalogs',
      version: 1,
      productInstanceKey: 'text-open-world.instance',
      skills: [
        { key: 'skill.one', order: 1, title: '旧标题一', description: '旧描述一', tags: ['近战'], fulfilledRequirementKeys: ['requirement.one', 'requirement.two'] },
        { key: 'skill.two', order: 2, title: '旧标题二', description: '旧描述二', tags: ['远程'] },
      ],
    },
  }]
}

describe('G5-06 Creator Artifact edit dispatch', () => {
  it('keeps persisted canonical evidence when the compiler reconstructs object keys in another order', async () => {
    const persisted = JSON.parse(canonicalProductProductionJsonV2(artifacts())) as ReturnType<typeof artifacts>
    const projection = await projectTextOpenWorldCreatorAuthorEditableDraftV1({
      taskKey: 'p8.catalog.progression', artifacts: persisted, context: '{}',
      target: { artifactKey: ARTIFACT_KEY, entityIdentity: 'skill:skill.one' },
    })
    const edited = structuredClone(projection.draft) as { skills: Array<{ description: string }> }
    edited.skills[0].description = '作者修订后的公开简介'
    const rebuilt = await rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1({
      taskKey: projection.taskKey, baseArtifacts: persisted, context: '{}', draft: edited,
    })
    expect(Object.keys(rebuilt.artifacts[0].payload as object)).not.toEqual(Object.keys(persisted[0].payload))
    expect(rebuilt.identitySequenceHash).toBe(projection.identitySequenceHash)
    expect(rebuilt.referenceSlots).toEqual(projection.referenceSlots)
    expect(rebuilt.referenceHash).toBe(projection.referenceHash)
    expect(rebuilt.stableStructureHash).toBe(projection.stableStructureHash)
    expect((rebuilt.artifacts[0].payload as { skills: Array<{ description: string }> }).skills[0].description)
      .toBe('作者修订后的公开简介')
  })

  it.each(['target', 'reference-order', 'structure'] as const)('still rejects genuine %s changes after canonical persistence', async mutation => {
    const persisted = JSON.parse(canonicalProductProductionJsonV2(artifacts())) as ReturnType<typeof artifacts>
    const projection = await projectTextOpenWorldCreatorAuthorEditableDraftV1({
      taskKey: 'p8.catalog.progression', artifacts: persisted, context: '{}',
      target: { artifactKey: ARTIFACT_KEY, entityIdentity: 'skill:skill.one' },
    })
    const compile = progressionCompiler.rebuildTextOpenWorldProgressionCatalogsFromAuthorEditableDraftV1
    const spy = vi.spyOn(progressionCompiler, 'rebuildTextOpenWorldProgressionCatalogsFromAuthorEditableDraftV1')
      .mockImplementationOnce(async input => {
        const result = await compile(input)
        if (mutation === 'target') result.productInstanceKey = 'text-open-world.foreign'
        if (mutation === 'reference-order') result.skills[0].fulfilledRequirementKeys.reverse()
        if (mutation === 'structure') result.skills[0].order += 1
        return result
      })
    try {
      await expect(rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1({
        taskKey: projection.taskKey, baseArtifacts: persisted, context: '{}', draft: projection.draft,
      })).rejects.toThrow(mutation === 'structure' ? 'owner sibling 结构' : '稳定引用')
    } finally { spy.mockRestore() }
  })

  it('projects one exact target, applies an allowlisted patch and atomically rebuilds without identity drift', async () => {
    const projection = await projectTextOpenWorldCreatorAuthorEditableDraftV1({
      taskKey: 'p8.catalog.progression',
      artifacts: artifacts(),
      context: '{}',
      target: { artifactKey: ARTIFACT_KEY, entityIdentity: 'skill:skill.one' },
    })

    expect(projection.outputArtifactKeys).toEqual([ARTIFACT_KEY])
    expect(projection.identitySequence).toEqual(['skill:skill.one', 'skill:skill.two'])
    expect(projection.editableFields.map(field => field.jsonPointer)).toEqual([
      '/skills/0/description', '/skills/0/tags', '/skills/0/title',
    ])
    expect(projection.editableFields.every(field => field.artifactKey === ARTIFACT_KEY
      && field.entityIdentity === 'skill:skill.one')).toBe(true)
    expect(projection.editableFields.some(field => field.jsonPointer.endsWith('/demandNumber'))).toBe(false)

    const titleField = projection.editableFields.find(field => field.jsonPointer === '/skills/0/title')!
    const patchBody = {
      schema: 'storyforge.text-open-world-creator-edit-patch' as const,
      version: 1 as const,
      baseDraftHash: projection.draftHash,
      operations: [{
        op: 'replace' as const,
        fieldId: titleField.fieldId,
        baseValueHash: titleField.baseValueHash,
        value: '新标题一',
      }],
    }
    const patch: TextOpenWorldCreatorEditPatchV1 = {
      ...patchBody,
      patchHash: await hashTextOpenWorldCreatorEditPatchV1(patchBody),
    }
    const applied = await applyTextOpenWorldCreatorEditPatchToAuthorEditableDraftV1({
      draft: projection.draft,
      draftHash: projection.draftHash,
      editableFields: projection.editableFields,
      patch,
    })
    expect((applied.draft as { skills: Array<{ title: string }> }).skills[0].title).toBe('新标题一')

    const rebuilt = await rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1({
      taskKey: projection.taskKey,
      baseArtifacts: artifacts(),
      context: '{}',
      draft: applied.draft,
    })
    expect(rebuilt.identitySequence).toEqual(projection.identitySequence)
    expect(rebuilt.stableStructureHash).toBe(projection.stableStructureHash)
    expect(rebuilt.referenceHash).toBe(projection.referenceHash)
    expect(rebuilt.requiredGateIds).toEqual(rebuilt.passedGateIds)
    expect((rebuilt.artifacts[0].payload as { skills: Array<{ title: string }> }).skills[0].title).toBe('新标题一')
  })

  it('rejects partial sibling groups and any rebuild that changes entity order', async () => {
    await expect(projectTextOpenWorldCreatorAuthorEditableDraftV1({
      taskKey: 'p3.story-architecture',
      artifacts: [{ artifactKey: 'text-open-world.story-arc', payload: {} }],
      context: '{}',
      target: { artifactKey: 'text-open-world.story-arc', entityIdentity: null },
    })).rejects.toThrow('必须完整提供 owner sibling group')

    const projection = await projectTextOpenWorldCreatorAuthorEditableDraftV1({
      taskKey: 'p8.catalog.progression',
      artifacts: artifacts(),
      context: '{}',
      target: { artifactKey: ARTIFACT_KEY, entityIdentity: 'skill:skill.one' },
    })
    const reordered = structuredClone(projection.draft) as { skills: unknown[] }
    reordered.skills.reverse()
    await expect(rebuildTextOpenWorldCreatorArtifactsFromAuthorEditableDraftV1({
      taskKey: projection.taskKey,
      baseArtifacts: artifacts(),
      context: '{}',
      draft: reordered,
    })).rejects.toThrow('稳定 ID、实体集合或实体顺序')
  })

  it('rejects stale field evidence before mutating the full draft', async () => {
    const projection = await projectTextOpenWorldCreatorAuthorEditableDraftV1({
      taskKey: 'p8.catalog.progression',
      artifacts: artifacts(),
      context: '{}',
      target: { artifactKey: ARTIFACT_KEY, entityIdentity: 'skill:skill.one' },
    })
    const titleField = projection.editableFields.find(field => field.jsonPointer === '/skills/0/title')!
    const patchBody = {
      schema: 'storyforge.text-open-world-creator-edit-patch' as const,
      version: 1 as const,
      baseDraftHash: projection.draftHash,
      operations: [{
        op: 'replace' as const,
        fieldId: titleField.fieldId,
        baseValueHash: 'f'.repeat(64),
        value: '不应写入',
      }],
    }
    await expect(applyTextOpenWorldCreatorEditPatchToAuthorEditableDraftV1({
      draft: projection.draft,
      draftHash: projection.draftHash,
      editableFields: projection.editableFields,
      patch: { ...patchBody, patchHash: await hashTextOpenWorldCreatorEditPatchV1(patchBody) },
    })).rejects.toThrow('patch baseValueHash 不一致')
  })
})
