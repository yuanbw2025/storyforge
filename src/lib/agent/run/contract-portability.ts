import type { AgentRunContractV1 } from '../../types'
import { parseAgentRunContractV1 } from './contract'
import { canonicalStringify, hashCanonicalValue } from './hash'

export interface PortableContractResultV1 {
  contract: AgentRunContractV1
  contractJson: string
  contractHash: string
}

type IdMaps = ReadonlyMap<string, ReadonlyMap<number, number>>

function fail(message: string): never {
  throw new Error(`[agent-run-portability] ${message}`)
}

function parseContractJson(contractJson: unknown): AgentRunContractV1 {
  if (typeof contractJson !== 'string') fail('contractJson 不是字符串')
  try {
    return parseAgentRunContractV1(JSON.parse(contractJson))
  } catch (error) {
    fail(error instanceof Error ? error.message : 'contractJson 无法解析')
  }
}

function portableId(
  value: number,
  table: string,
  idMaps: IdMaps,
): number {
  const mapped = idMaps.get(table)?.get(value)
  if (mapped == null) fail(`${table} 本地主键 ${value} 不在项目导出快照中`)
  return mapped + 1
}

function reboundId(
  value: number,
  table: string,
  idMaps: IdMaps,
): number {
  const mapped = idMaps.get(table)?.get(value - 1)
  if (mapped == null) fail(`${table} 便携编号 ${value} 无法映射到导入项目`)
  return mapped
}

async function assertHash(contract: AgentRunContractV1, expectedHash: unknown): Promise<void> {
  if (typeof expectedHash !== 'string' || await hashCanonicalValue(contract) !== expectedHash) {
    fail('contractHash 与 contractJson 不一致')
  }
}

export async function portableizeAgentRunContractV1(input: {
  contractJson: unknown
  contractHash: unknown
  idMaps: IdMaps
}): Promise<PortableContractResultV1> {
  const source = parseContractJson(input.contractJson)
  await assertHash(source, input.contractHash)
  const contract = parseAgentRunContractV1({
    ...source,
    ...(source.lineage ? {
      lineage: {
        parent: {
          ...source.lineage.parent,
          runId: portableId(source.lineage.parent.runId, 'agentRuns', input.idMaps),
        },
      },
    } : {}),
    scope: {
      ...source.scope,
      // Portable contract IDs are one-based so the strict V1 schema remains
      // valid inside the backup while never exposing a local database key.
      projectId: 1,
      worldGroupId: source.scope.worldGroupId == null
        ? null
        : portableId(source.scope.worldGroupId, 'worldGroups', input.idMaps),
      chapterIds: source.scope.chapterIds?.map(id => portableId(id, 'chapters', input.idMaps)),
      outlineNodeIds: source.scope.outlineNodeIds?.map(id => portableId(id, 'outlineNodes', input.idMaps)),
      ...(source.scope.runtime ? {
        runtime: {
          ...source.scope.runtime,
          simulationSessionId: portableId(
            source.scope.runtime.simulationSessionId,
            'simulationSessions',
            input.idMaps,
          ),
        },
      } : {}),
    },
  })
  const contractHash = await hashCanonicalValue(contract)
  return { contract, contractJson: canonicalStringify(contract), contractHash }
}

export async function rebindPortableAgentRunContractV1(input: {
  contractJson: unknown
  contractHash: unknown
  projectId: number
  idMaps: IdMaps
}): Promise<PortableContractResultV1> {
  const portable = parseContractJson(input.contractJson)
  await assertHash(portable, input.contractHash)
  if (portable.scope.projectId !== 1) fail('便携 RunContract.projectId 必须为逻辑根 1')
  const contract = parseAgentRunContractV1({
    ...portable,
    ...(portable.lineage ? {
      lineage: {
        parent: {
          ...portable.lineage.parent,
          runId: reboundId(portable.lineage.parent.runId, 'agentRuns', input.idMaps),
        },
      },
    } : {}),
    scope: {
      ...portable.scope,
      projectId: input.projectId,
      worldGroupId: portable.scope.worldGroupId == null
        ? null
        : reboundId(portable.scope.worldGroupId, 'worldGroups', input.idMaps),
      chapterIds: portable.scope.chapterIds?.map(id => reboundId(id, 'chapters', input.idMaps)),
      outlineNodeIds: portable.scope.outlineNodeIds?.map(id => reboundId(id, 'outlineNodes', input.idMaps)),
      ...(portable.scope.runtime ? {
        runtime: {
          ...portable.scope.runtime,
          simulationSessionId: reboundId(
            portable.scope.runtime.simulationSessionId,
            'simulationSessions',
            input.idMaps,
          ),
        },
      } : {}),
    },
  })
  const contractHash = await hashCanonicalValue(contract)
  return { contract, contractJson: canonicalStringify(contract), contractHash }
}
