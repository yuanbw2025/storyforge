import { chat, type ChatResult } from '../../ai/client'
import { computeKnownCostUsd } from '../../ai/usage-log'
import { supportsVerifiedJsonObjectResponseV1 } from '../../ai/provider-capabilities'
import { validateDomainCandidateCanon } from '../../agent/canon-validator'
import { hashCanonicalValue } from '../../agent/run/hash'
import {
  prepareStoryArcCopilot,
  runStoryArcCreativeReliabilityV1,
} from '../../agent/story-arc-copilot'
import { AgentTeamBudgetTracker } from '../../agent/team-budget'
import { db } from '../../db/schema'
import { adopt } from '../../registry/adopt'
import { assembleContext } from '../../registry/assemble-context'
import { cascadeDeleteProject } from '../../registry/lifecycle'
import type { AIConfig, ChatMessage, Project, WorkspaceScope } from '../../types'
import type { CreativeReliabilityFixtureV1 } from './fixtures'
import {
  CREATIVE_RELIABILITY_GENERATOR_PROMPT_VERSION_V1,
  CREATIVE_RELIABILITY_LEGACY_PROMPT_VERSION_V1,
  CREATIVE_RELIABILITY_REPAIR_PROMPT_VERSION_V1,
  CREATIVE_RELIABILITY_VERIFIER_PROMPT_VERSION_V1,
  buildCreativeReliabilityLegacyMessagesV1,
  buildCreativeReliabilityVerifierMessagesV1,
  parseCreativeReliabilityLegacyOutputV1,
  parseCreativeReliabilityVerifierAssessmentV1,
} from './protocol'
import type { CreativeReliabilityEvalRunDependenciesV1 } from './runner'
import type {
  CreativeReliabilityEvalCallV1,
  CreativeReliabilityEvalGenerationV1,
  CreativeReliabilityEvalIdentityV1,
  CreativeReliabilityEvalUsageV1,
  CreativeReliabilityEvalVariantV1,
  CreativeReliabilityEvalVerificationV1,
} from './types'

const CREL_PROJECT_PREFIX = '[CREL-EVAL] '
const CALL_TIMEOUT_MS = 180_000

interface CreativeReliabilityWorkspaceV1 {
  project: Project
  scope: WorkspaceScope
}

interface ModelCallResultV1 {
  output: string
  call: CreativeReliabilityEvalCallV1
}

class CreativeReliabilityCallFailure extends Error {
  constructor(
    readonly call: CreativeReliabilityEvalCallV1,
    message: string,
  ) {
    super(message)
    this.name = 'CreativeReliabilityCallFailure'
  }
}

function safeFailureMessage(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/(?:sk|ak|key)-[A-Za-z0-9_-]{8,}/gi, '[credential]')
    .slice(0, 500)
}

function isProviderFailure(value: unknown): boolean {
  if (typeof value === 'object' && value && 'status' in value) return true
  const name = value instanceof Error ? value.name : ''
  return name === 'AbortError' || name === 'AIError' || /network|fetch|timeout/i.test(safeFailureMessage(value))
}

async function callModel(input: {
  messages: ChatMessage[]
  config: AIConfig
  identity: CreativeReliabilityEvalIdentityV1
  stage: CreativeReliabilityEvalCallV1['stage']
  purpose: CreativeReliabilityEvalCallV1['purpose']
  callIndex: number
  promptVersion: string
  category: string
}): Promise<ModelCallResultV1> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)
  const startedAt = performance.now()
  const result: ChatResult = {}
  let output: string | null = null
  try {
    output = await chat(input.messages, input.config, {
      category: input.category,
      contextOverflowPolicy: 'reject',
    }, controller.signal, result, supportsVerifiedJsonObjectResponseV1(input.config.provider)
      ? { responseFormat: 'json_object' }
      : undefined)
    const finishReason = result.finishReason?.trim().toLowerCase() ?? ''
    const truncated = finishReason === 'length' || finishReason === 'max_tokens'
    const status = result.usage && !truncated ? 'succeeded' as const : 'protocol-failed' as const
    const usage: CreativeReliabilityEvalUsageV1 | null = result.usage ? {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
      costUsd: computeKnownCostUsd(
        input.identity.model,
        result.usage.inputTokens,
        result.usage.outputTokens,
      ),
      usageSource: 'provider',
    } : null
    return {
      output,
      call: {
        callIndex: input.callIndex,
        stage: input.stage,
        purpose: input.purpose,
        provider: input.identity.provider,
        model: input.identity.model,
        promptVersion: input.promptVersion,
        inputHash: await hashCanonicalValue(input.messages),
        outputHash: await hashCanonicalValue(output),
        status,
        usage,
        ...(truncated
          ? { failureCode: `finish_reason_${finishReason}` }
          : usage ? {} : { failureCode: 'provider_usage_missing' }),
      },
    }
  } catch (error) {
    const status = isProviderFailure(error) ? 'provider-failed' as const : 'protocol-failed' as const
    const message = safeFailureMessage(error)
    const usage: CreativeReliabilityEvalUsageV1 | null = result.usage ? {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
      costUsd: computeKnownCostUsd(
        input.identity.model,
        result.usage.inputTokens,
        result.usage.outputTokens,
      ),
      usageSource: 'provider',
    } : null
    throw new CreativeReliabilityCallFailure({
      callIndex: input.callIndex,
      stage: input.stage,
      purpose: input.purpose,
      provider: input.identity.provider,
      model: input.identity.model,
      promptVersion: input.promptVersion,
      inputHash: await hashCanonicalValue(input.messages),
      outputHash: output == null ? null : await hashCanonicalValue(output),
      status,
      usage,
      failureCode: status === 'provider-failed' ? 'provider_error' : 'call_error',
    }, message)
  } finally {
    clearTimeout(timeout)
  }
}

function aggregateUsage(calls: readonly CreativeReliabilityEvalCallV1[]): CreativeReliabilityEvalUsageV1 {
  const metered = calls.map(call => call.usage).filter((usage): usage is CreativeReliabilityEvalUsageV1 => usage != null)
  const allMetered = metered.length === calls.length
  const allCostsKnown = allMetered && metered.every(usage => usage.costUsd != null)
  return {
    inputTokens: metered.reduce((sum, usage) => sum + usage.inputTokens, 0),
    outputTokens: metered.reduce((sum, usage) => sum + usage.outputTokens, 0),
    latencyMs: metered.reduce((sum, usage) => sum + usage.latencyMs, 0),
    costUsd: allCostsKnown
      ? metered.reduce((sum, usage) => sum + (usage.costUsd ?? 0), 0)
      : null,
    usageSource: allMetered && metered.every(usage => usage.usageSource === 'provider')
      ? 'provider'
      : 'estimated',
  }
}

function assertSeedAdoption(
  target: string,
  result: Awaited<ReturnType<typeof adopt>>,
  expectedWrites: number,
): void {
  if (
    result.written.length !== expectedWrites
    || result.unknown.length
    || result.typeErrors.length
    || result.fkErrors.length
    || result.skipped.length
  ) throw new Error(`CREL ${target} 夹具未通过正式采纳入口`)
}

async function seedWorkspace(fixture: CreativeReliabilityFixtureV1): Promise<CreativeReliabilityWorkspaceV1> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: `${CREL_PROJECT_PREFIX}${fixture.id} ${fixture.projectName}`,
    genre: fixture.genre,
    genres: [fixture.genre],
    description: 'CREL 隔离评测项目；运行后按 PROJECT_TABLES 生命周期清理。',
    status: 'drafting',
    targetWordCount: 100_000,
    worldCode: `crel-${fixture.id}`,
    worldVersion: 1,
    createdAt: now,
    updatedAt: now,
  } as Project) as number
  const worldId = await db.worlds.add({
    projectId,
    code: `crel-${fixture.id}`,
    name: fixture.worldName,
    description: fixture.worldOrigin,
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId,
    worldId,
    title: fixture.projectName,
    description: fixture.logline,
    genres: [fixture.genre],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  await db.projects.update(projectId, {
    activeWorldId: worldId,
    activeWorkId: workId,
    ownershipSchemaVersion: 1,
  })
  const scope = { projectId, worldId, workId }
  if (fixture.worldOrigin || fixture.worldRules) {
    assertSeedAdoption('worldviews', await adopt({
      projectId,
      scope,
      target: 'worldviews',
      mode: 'replace',
      data: { rules: fixture.worldRules, worldOrigin: fixture.worldOrigin },
    }), 1)
  }
  if (fixture.theme || fixture.centralConflict || fixture.logline || fixture.mainPlot) {
    assertSeedAdoption('storyCores', await adopt({
      projectId,
      scope,
      target: 'storyCores',
      mode: 'replace',
      data: {
        theme: fixture.theme,
        centralConflict: fixture.centralConflict,
        logline: fixture.logline,
        mainPlot: fixture.mainPlot,
      },
    }), 1)
  }
  if (fixture.characters.length) {
    assertSeedAdoption('characters', await adopt({
      projectId,
      scope,
      target: 'characters',
      mode: 'add-many',
      data: fixture.characters.map(character => ({
        name: character.name,
        role: character.role,
        roleWeight: character.role === 'supporting' ? 'secondary' : 'main',
        moralAxis: 'neutral',
        orderAxis: 'neutral',
        shortDescription: character.background,
        appearance: '',
        personality: character.personality,
        background: character.background,
        motivation: character.motivation,
        abilities: '',
        relationships: '[]',
        arc: '',
      })),
    }), fixture.characters.length)
  }
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('CREL 隔离项目创建失败')
  return { project, scope }
}

async function cleanupWorkspace(projectId: number): Promise<void> {
  const project = await db.projects.get(projectId)
  if (!project) return
  if (!project.name.startsWith(CREL_PROJECT_PREFIX)) throw new Error('拒绝清理非 CREL 评测项目')
  await cascadeDeleteProject(projectId)
}

export async function cleanupStrandedCreativeReliabilityWorkspacesV1(): Promise<number> {
  const projects = await db.projects.filter(project => project.name.startsWith(CREL_PROJECT_PREFIX)).toArray()
  for (const project of projects) if (project.id != null) await cleanupWorkspace(project.id)
  return projects.length
}

async function legacyGeneration(input: {
  fixture: CreativeReliabilityFixtureV1
  identity: CreativeReliabilityEvalIdentityV1
  config: AIConfig
  workspace: CreativeReliabilityWorkspaceV1
  parameters: { temperature: number; maxOutputTokens: number }
}): Promise<CreativeReliabilityEvalGenerationV1> {
  const assembled = await assembleContext({
    projectId: input.workspace.scope.projectId,
    scope: input.workspace.scope,
    worldGroupId: null,
    provider: input.config.provider,
    model: input.config.model,
    sourceKeys: [
      'canonAssertions', 'worldview', 'storyCore', 'powerSystem', 'cultivationProgress',
      'codex', 'characters', 'creativeRules', 'worldRules', 'historical', 'locations',
    ],
  })
  const messages = buildCreativeReliabilityLegacyMessagesV1({
    fixture: input.fixture,
    assembledContext: assembled.text,
  })
  let response: ModelCallResultV1
  try {
    response = await callModel({
      messages,
      config: { ...input.config, temperature: input.parameters.temperature, maxTokens: input.parameters.maxOutputTokens },
      identity: input.identity,
      stage: 'generation',
      purpose: 'generate',
      callIndex: 1,
      promptVersion: CREATIVE_RELIABILITY_LEGACY_PROMPT_VERSION_V1,
      category: 'eval.crel.legacy-generator',
    })
  } catch (error) {
    if (!(error instanceof CreativeReliabilityCallFailure)) throw error
    const calls = [error.call]
    return {
      variant: 'legacy-direct',
      status: error.call.status === 'provider-failed' ? 'provider-failed' : 'legacy-protocol-failed',
      presentedText: '',
      outputHash: null,
      editableArtifact: false,
      adoptable: false,
      artifactModelCalls: 1,
      calls,
      usage: aggregateUsage(calls),
      issueCodes: [error.call.failureCode ?? 'legacy_provider_failed'],
      repairTargetIssueCodes: [],
    }
  }
  try {
    const presentedText = parseCreativeReliabilityLegacyOutputV1(response.output)
    const calls = [response.call]
    return {
      variant: 'legacy-direct',
      status: 'legacy-ready',
      presentedText,
      outputHash: await hashCanonicalValue(presentedText),
      editableArtifact: true,
      adoptable: true,
      artifactModelCalls: 1,
      calls,
      usage: aggregateUsage(calls),
      issueCodes: response.call.usage ? [] : ['provider-usage-missing'],
      repairTargetIssueCodes: [],
    }
  } catch {
    const calls = [response.call]
    return {
      variant: 'legacy-direct',
      status: 'legacy-protocol-failed',
      presentedText: '',
      outputHash: null,
      editableArtifact: false,
      adoptable: false,
      artifactModelCalls: 1,
      calls,
      usage: aggregateUsage(calls),
      issueCodes: ['legacy-parse-failed'],
      repairTargetIssueCodes: [],
    }
  }
}

async function creativeGeneration(input: {
  fixture: CreativeReliabilityFixtureV1
  identity: CreativeReliabilityEvalIdentityV1
  config: AIConfig
  workspace: CreativeReliabilityWorkspaceV1
  parameters: { temperature: number; maxOutputTokens: number }
}): Promise<CreativeReliabilityEvalGenerationV1> {
  const calls: CreativeReliabilityEvalCallV1[] = []
  try {
    const prepared = await prepareStoryArcCopilot({
      projectId: input.workspace.scope.projectId,
      scope: input.workspace.scope,
      worldGroupId: null,
      authorRequest: input.fixture.authorRequest,
      skillId: 'outline.story-arcs',
      creativeReliabilityEnabled: true,
      configOverride: input.config,
      generationOverrides: {
        temperature: input.parameters.temperature,
        maxTokens: input.parameters.maxOutputTokens,
      },
    }, {
      runAI: async messages => {
        const callIndex = calls.length + 1
        try {
          const response = await callModel({
            messages,
            config: {
              ...input.config,
              temperature: input.parameters.temperature,
              maxTokens: input.parameters.maxOutputTokens,
            },
            identity: input.identity,
            stage: 'generation',
            purpose: callIndex === 1 ? 'generate' : 'repair',
            callIndex,
            promptVersion: callIndex === 1
              ? CREATIVE_RELIABILITY_GENERATOR_PROMPT_VERSION_V1
              : CREATIVE_RELIABILITY_REPAIR_PROMPT_VERSION_V1,
            category: callIndex === 1
              ? 'eval.crel.generator'
              : 'eval.crel.repair',
          })
          calls.push(response.call)
          return response.output
        } catch (error) {
          if (error instanceof CreativeReliabilityCallFailure) calls.push(error.call)
          throw error
        }
      },
    })
    const result = await runStoryArcCreativeReliabilityV1({
      prepared,
      budget: new AgentTeamBudgetTracker('balanced'),
      qualityMode: 'balanced',
      validate: output => validateDomainCandidateCanon({
        agentId: 'outline',
        projectId: input.workspace.scope.projectId,
        worldGroupId: null,
        outputText: JSON.stringify(output),
      }),
    })
    const presentedText = result.artifact.editableText
    const editableArtifact = Boolean(presentedText.trim()) && presentedText.trim() !== '[]'
    const adoptable = editableArtifact
      && (result.artifact.status === 'ready' || result.artifact.status === 'usable-with-warnings')
    return {
      variant: 'creative-reliability',
      status: result.artifact.status,
      presentedText,
      outputHash: editableArtifact ? await hashCanonicalValue(presentedText) : null,
      editableArtifact,
      adoptable,
      artifactModelCalls: calls.length,
      calls,
      usage: aggregateUsage(calls),
      issueCodes: [...new Set(result.artifact.issues.map(issue => issue.code))],
      repairTargetIssueCodes: result.artifact.repair?.targetIssueCodes ?? [],
    }
  } catch (error) {
    if (
      error instanceof CreativeReliabilityCallFailure
      && !calls.some(call => call.callIndex === error.call.callIndex)
    ) calls.push(error.call)
    if (!calls.length) throw error
    const providerFailed = calls.some(call => call.status === 'provider-failed')
    return {
      variant: 'creative-reliability',
      status: providerFailed ? 'provider-failed' : 'manual-repair',
      presentedText: '',
      outputHash: null,
      editableArtifact: false,
      adoptable: false,
      artifactModelCalls: calls.length,
      calls,
      usage: aggregateUsage(calls),
      issueCodes: [providerFailed ? 'provider-error' : 'creative-run-failed'],
      repairTargetIssueCodes: [],
    }
  }
}

async function verification(input: {
  fixture: CreativeReliabilityFixtureV1
  variant: CreativeReliabilityEvalVariantV1
  generation: CreativeReliabilityEvalGenerationV1
  identity: CreativeReliabilityEvalIdentityV1
  config: AIConfig
}): Promise<CreativeReliabilityEvalVerificationV1> {
  const messages = buildCreativeReliabilityVerifierMessagesV1({
    fixture: input.fixture,
    output: input.generation.presentedText,
  })
  let response: ModelCallResultV1
  try {
    response = await callModel({
      messages,
      config: { ...input.config, temperature: 0, maxTokens: 3_000 },
      identity: input.identity,
      stage: 'verification',
      purpose: 'verify',
      callIndex: 1,
      promptVersion: CREATIVE_RELIABILITY_VERIFIER_PROMPT_VERSION_V1,
      category: 'eval.crel.verifier',
    })
  } catch (error) {
    if (!(error instanceof CreativeReliabilityCallFailure)) throw error
    return {
      status: error.call.status,
      semanticScore: null,
      causalCoherence: null,
      specificity: null,
      matchedRequiredFactIds: [],
      missingRequiredFactIds: [],
      safetyPassed: null,
      narrativeProgressed: null,
      infodumpOnly: null,
      calls: [error.call],
      usage: error.call.usage,
      assessmentHash: null,
    }
  }
  try {
    const assessment = parseCreativeReliabilityVerifierAssessmentV1(response.output, input.fixture)
    const assessmentBody = { status: 'succeeded' as const, ...assessment }
    return {
      ...assessmentBody,
      calls: [response.call],
      usage: response.call.usage,
      assessmentHash: await hashCanonicalValue(assessmentBody),
    }
  } catch (error) {
    const failureCode = response.call.failureCode ?? (
      error instanceof Error && /^[a-z0-9_-]{1,80}$/i.test(error.message)
        ? error.message
        : 'verifier-parse-failed'
    )
    return {
      status: 'protocol-failed',
      semanticScore: null,
      causalCoherence: null,
      specificity: null,
      matchedRequiredFactIds: [],
      missingRequiredFactIds: [],
      safetyPassed: null,
      narrativeProgressed: null,
      infodumpOnly: null,
      calls: [{ ...response.call, status: 'protocol-failed', failureCode }],
      usage: response.call.usage,
      assessmentHash: null,
    }
  }
}

export function createCreativeReliabilityBrowserDependenciesV1(input: {
  generatorConfig: AIConfig
  verifierConfig: AIConfig
}): CreativeReliabilityEvalRunDependenciesV1 {
  return {
    generate: async request => {
      const workspace = await seedWorkspace(request.fixture)
      try {
        return request.variant === 'legacy-direct'
          ? await legacyGeneration({
              ...request,
              config: input.generatorConfig,
              workspace,
            })
          : await creativeGeneration({
              ...request,
              config: input.generatorConfig,
              workspace,
            })
      } finally {
        await cleanupWorkspace(workspace.scope.projectId)
      }
    },
    verify: request => verification({
      ...request,
      config: input.verifierConfig,
    }),
  }
}
