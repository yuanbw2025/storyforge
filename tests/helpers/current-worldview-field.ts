import type {
  WorldviewFieldCopilotCandidate,
  WorldviewFieldCopilotSnapshot,
} from '../../src/lib/agent/worldview-field-copilot'

export function currentWorldviewFieldValuesV1() {
  return {
    worldOrigin: '',
    powerHierarchy: '',
    divineDesign: { hasDivinity: false, divineRank: '', divineNames: '', divineRules: '' },
    worldStructure: '',
    worldDimensions: '',
    continentLayout: '',
    mountainsRivers: '',
    climateByRegion: '',
    naturalResourceOverview: '',
    naturalResources: { rareCreatures: '', herbs: '', minerals: '', others: '' },
    races: '',
    factionLayout: '',
    regionDimensions: '',
    politicsOverview: '',
    economyOverview: '',
    cultureOverview: '',
    internalConflicts: '',
    itemDesign: '',
  } satisfies WorldviewFieldCopilotSnapshot['values']
}

export function currentWorldOriginSnapshotV1(input: {
  id?: number | null
  ragDocumentId?: string | null
  updatedAt?: number | null
  worldOrigin?: string
} = {}): WorldviewFieldCopilotSnapshot {
  const values = {
    ...currentWorldviewFieldValuesV1(),
    worldOrigin: input.worldOrigin ?? '',
  }
  const body = {
    id: input.id ?? null,
    ragDocumentId: input.ragDocumentId ?? null,
    updatedAt: input.updatedAt ?? null,
    values,
  }
  return {
    ...body,
    serialized: JSON.stringify(body),
    foundationState: values.worldOrigin.trim() ? 'partial' : 'empty',
  }
}

export function currentWorldOriginCandidateV1(value: string): WorldviewFieldCopilotCandidate {
  return { field: 'worldOrigin', value }
}

export function currentWorldOriginDraftV1(value: string): string {
  return JSON.stringify(currentWorldOriginCandidateV1(value))
}

export function currentWorldOriginCandidateFixtureV1(
  value: string,
  snapshotInput: Parameters<typeof currentWorldOriginSnapshotV1>[0] = {},
) {
  const runtimeOutput = currentWorldOriginCandidateV1(value)
  return {
    payload: {
      worldviewField: 'worldOrigin' as const,
      worldviewFieldOperation: (snapshotInput.worldOrigin?.trim() ? 'expand' : 'create') as const,
      worldviewFieldOutputBudget: {
        version: 1 as const,
        source: 'default' as const,
        requestedTokens: 6_000,
        effectiveMaxTokens: 6_000,
        effectiveCapTokens: 6_000,
        modelCapTokens: 6_000,
        authorConfigCapTokens: 6_000,
        schemaCapTokens: 6_000,
        skillCapTokens: 6_000,
        longOutputMode: 'disabled' as const,
      },
      baseSnapshot: currentWorldOriginSnapshotV1(snapshotInput),
    },
    draft: JSON.stringify(runtimeOutput),
    runtimeOutput,
  }
}
