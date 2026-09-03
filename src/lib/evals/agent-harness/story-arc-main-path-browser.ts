import { chat, type ChatResult } from '../../ai/client'
import { estimateTokens } from '../../ai/context-budget'
import { supportsVerifiedJsonObjectResponseV1 } from '../../ai/provider-capabilities'
import { validateDomainCandidateCanon } from '../../agent/canon-validator'
import { getOrCreateAgentConversation } from '../../agent/conversations'
import type { ExecutedMasterCandidate, MasterAgentPlan } from '../../agent/orchestrator'
import { readAgentRunV1 } from '../../agent/run/event-store'
import { hashCanonicalValue } from '../../agent/run/hash'
import {
  runDurableMasterAgentPlanV1,
  type MasterAgentDurableDependenciesV1,
} from '../../agent/run/master-durable'
import { getAgentSkillV1 } from '../../agent/skill-registry'
import { prepareStoryArcCopilot } from '../../agent/story-arc-copilot'
import { AgentTeamBudgetTracker } from '../../agent/team-budget'
import { runBudgetedGenerationNode } from '../../agent/team-execution'
import { db } from '../../db/schema'
import { adopt } from '../../registry/adopt'
import { assembleContext } from '../../registry/assemble-context'
import { cascadeDeleteProject } from '../../registry/lifecycle'
import type { AIConfig, Project, WorkspaceScope } from '../../types'
import { stringifyStages } from '../../types/story-arc'
import {
  H86_AGENT_PROMPT_VERSION_V1,
  H86_BASELINE_PROMPT_VERSION_V1,
  H86_VERIFIER_PROMPT_VERSION_V1,
  buildH86BaselineStoryArcMessagesV1,
  buildH86VerifierMessagesV1,
  createH86CallEvidenceV1,
  parseH86BaselineStoryArcOutputV1,
  parseH86VerifierAssessmentV1,
  type H86CallEvidenceV1,
  type H86GenerationAttemptV1,
  type H86GenerationCallInputV1,
  type H86ModelIdentityV1,
  type H86VerificationAttemptV1,
  type H86VerificationCallInputV1,
} from './story-arc-main-path'
import type { H86StoryArcFixtureV1 } from './story-arc-main-path-fixtures'
import { generateWorkCode, generateWorkspaceUid } from '../../memory/identity'
import { backfillResourceUidsV1 } from '../../context-gateway/resource-identity'

const H86_PROJECT_PREFIX = '[H86-EVAL] '
const CALL_TIMEOUT_MS = 180_000

interface H86WorkspaceV1 {
  project: Project
  scope: WorkspaceScope
}

interface ModelCallResultV1 {
  output: string
  call: H86CallEvidenceV1
}

function assertSeedAdoption(
  target: string,
  result: Awaited<ReturnType<typeof adopt>>,
  expectedWrites: number,
): void {
  if (
    result.written.length !== expectedWrites
    || result.unknown.length > 0
    || result.typeErrors.length > 0
    || result.fkErrors.length > 0
    || result.skipped.length > 0
  ) {
    throw new Error(`H86 ${target} 合成夹具未通过正式采纳入口（${result.written.length}/${expectedWrites}）。`)
  }
}

function failureMessage(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/(?:sk|ak|key)-[A-Za-z0-9_-]{8,}/gi, '[credential]')
    .slice(0, 500)
}

function providerFailure(value: unknown): boolean {
  if (typeof value === 'object' && value && 'status' in value) return true
  const name = value instanceof Error ? value.name : ''
  return name === 'AbortError' || name === 'AIError' || /network|fetch|timeout/i.test(failureMessage(value))
}

async function callModel(input: {
  messages: Parameters<typeof chat>[0]
  config: AIConfig
  identity: H86ModelIdentityV1
  promptVersion: string
  stage: H86CallEvidenceV1['stage']
  variant: H86CallEvidenceV1['variant']
  responseFormat?: 'json_object'
}): Promise<ModelCallResultV1> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS)
  const startedAt = performance.now()
  const result: ChatResult = {}
  let output: string | null = null
  try {
    output = await chat(
      input.messages,
      input.config,
      {
        category: input.stage === 'generation' ? 'eval.h86.generator' : 'eval.h86.verifier',
        contextOverflowPolicy: 'reject',
      },
      controller.signal,
      result,
      input.responseFormat ? { responseFormat: input.responseFormat } : undefined,
    )
    if (!result.usage) {
      const call = await createH86CallEvidenceV1({
        stage: input.stage,
        variant: input.variant,
        identity: { ...input.identity, promptVersion: input.promptVersion },
        messages: input.messages,
        output,
        usage: null,
        status: 'protocol-failed',
        failureCode: 'usage_missing',
        failureMessage: 'provider 响应缺少 token usage',
      })
      throw new H86CallFailure('usage_missing', 'provider 响应缺少 token usage', call)
    }
    return {
      output,
      call: await createH86CallEvidenceV1({
        stage: input.stage,
        variant: input.variant,
        identity: { ...input.identity, promptVersion: input.promptVersion },
        messages: input.messages,
        output,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
        },
        status: 'succeeded',
      }),
    }
  } catch (error) {
    if (error instanceof H86CallFailure) throw error
    const message = failureMessage(error)
    const status = providerFailure(error) ? 'provider-failed' : 'protocol-failed'
    const call = await createH86CallEvidenceV1({
      stage: input.stage,
      variant: input.variant,
      identity: { ...input.identity, promptVersion: input.promptVersion },
      messages: input.messages,
      output,
      usage: result.usage ? {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        durationMs: Math.max(1, Math.round(performance.now() - startedAt)),
      } : null,
      status,
      failureCode: status === 'provider-failed' ? 'provider_error' : 'call_error',
      failureMessage: message,
    })
    throw new H86CallFailure(call.failureCode ?? 'call_error', message, call)
  } finally {
    clearTimeout(timeout)
  }
}

class H86CallFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly call: H86CallEvidenceV1,
  ) {
    super(message)
    this.name = 'H86CallFailure'
  }
}

async function seedWorkspace(fixture: H86StoryArcFixtureV1): Promise<H86WorkspaceV1> {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(),
    name: `${H86_PROJECT_PREFIX}${fixture.id} ${fixture.projectName}`,
    genre: fixture.genre,
    genres: [fixture.genre],
    description: 'HARNESS-86 隔离评测项目；运行后由 PROJECT_TABLES 生命周期清理。',
    status: 'drafting',
    targetWordCount: 100_000,


    createdAt: now,
    updatedAt: now,
  } as Project) as number
  const worldId = await db.worlds.add({
    projectId,
    code: `h86-${fixture.id}`,
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
    code: generateWorkCode(),
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
  assertSeedAdoption('worldviews', await adopt({
    projectId,
    scope,
    target: 'worldviews',
    mode: 'replace',
    data: {
      worldOrigin: fixture.worldOrigin,
    },
  }), 1)
  assertSeedAdoption('worldRulesProfiles', await adopt({
    projectId,
    scope,
    target: 'worldRulesProfiles',
    mode: 'replace',
    data: {
      entries: {},
      customNodes: [],
      globalNote: fixture.worldRules,
    },
  }), 1)
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
  assertSeedAdoption('characters', await adopt({
    projectId,
    scope,
    target: 'characters',
    mode: 'add-many',
    data: fixture.characters.map(item => ({
      name: item.name,
      role: item.role,
      roleWeight: item.role === 'protagonist' || item.role === 'antagonist' ? 'main' : 'secondary',
      moralAxis: 'neutral',
      orderAxis: 'neutral',
      shortDescription: item.background,
      appearance: '',
      personality: item.personality,
      background: item.background,
      motivation: item.motivation,
      abilities: '',
      relationships: '[]',
      arc: '',
    })),
  }), fixture.characters.length)
  if (fixture.existingArc) {
    assertSeedAdoption('storyArcs', await adopt({
      projectId,
      scope,
      target: 'storyArcs',
      mode: 'add',
      data: {
        name: fixture.existingArc.name,
        type: fixture.existingArc.type,
        description: fixture.existingArc.description,
        stages: stringifyStages([]),
      },
    }), 1)
  }
  await backfillResourceUidsV1(projectId)
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('H86 评测项目创建失败')
  return { project, scope }
}

async function cleanupWorkspace(projectId: number): Promise<void> {
  const project = await db.projects.get(projectId)
  if (!project) return
  if (!project.name.startsWith(H86_PROJECT_PREFIX)) throw new Error('拒绝清理非 H86 评测项目')
  await cascadeDeleteProject(projectId)
}

/** Cleans only stranded workspaces created by this evaluator. */
export async function cleanupStrandedH86WorkspacesV1(): Promise<number> {
  const projects = await db.projects.filter(project => project.name.startsWith(H86_PROJECT_PREFIX)).toArray()
  for (const project of projects) {
    if (project.id != null) await cleanupWorkspace(project.id)
  }
  return projects.length
}

function directPlan(fixture: H86StoryArcFixtureV1): MasterAgentPlan {
  return {
    summary: fixture.authorRequest,
    tasks: [{
      id: 'story-arcs-1',
      agentId: 'outline',
      skillId: 'outline.story-arcs',
      instruction: fixture.authorRequest,
      dependsOn: [],
    }],
    workflow: {
      version: 1,
      workflowId: 'single-domain-direct',
      reasonCodes: ['single-explicit-domain'],
    },
  }
}

async function baselineGeneration(
  input: H86GenerationCallInputV1,
  config: AIConfig,
  workspace: H86WorkspaceV1,
): Promise<H86GenerationAttemptV1> {
  const assembled = await assembleContext({
    projectId: workspace.scope.projectId,
    scope: workspace.scope,
    worldGroupId: null,
    provider: config.provider,
    model: config.model,
    sourceKeys: [
      'canonAssertions',
      'worldview',
      'storyCore',
      'powerSystem',
      'cultivationProgress',
      'codex',
      'characters',
      'creativeRules',
      'worldRules',
      'historical',
      'locations',
    ],
  })
  const messages = buildH86BaselineStoryArcMessagesV1(input.fixture, assembled.text)
  let modelCall: ModelCallResultV1
  try {
    modelCall = await callModel({
      messages,
      config: { ...config, temperature: 0.55, maxTokens: 6_000 },
      identity: input.generator,
      promptVersion: H86_BASELINE_PROMPT_VERSION_V1,
      stage: 'generation',
      variant: input.variant,
    })
  } catch (error) {
    if (!(error instanceof H86CallFailure)) throw error
    return {
      attempt: input.attempt,
      status: error.call.status,
      output: '',
      outputHash: null,
      parserPassed: false,
      calls: [error.call],
      failureCode: error.code,
      failureMessage: error.message,
    }
  }
  try {
    const output = parseH86BaselineStoryArcOutputV1(modelCall.output, input.fixture)
    return {
      attempt: input.attempt,
      status: 'succeeded',
      output,
      outputHash: await hashCanonicalValue(output),
      parserPassed: true,
      calls: [modelCall.call],
    }
  } catch (error) {
    return {
      attempt: input.attempt,
      status: 'protocol-failed',
      output: '',
      outputHash: null,
      parserPassed: false,
      calls: [modelCall.call],
      failureCode: 'baseline_parse_failed',
      failureMessage: failureMessage(error),
    }
  }
}

async function agentHarnessGeneration(
  input: H86GenerationCallInputV1,
  config: AIConfig,
  workspace: H86WorkspaceV1,
): Promise<H86GenerationAttemptV1> {
  const calls: H86CallEvidenceV1[] = []
  const budget = new AgentTeamBudgetTracker('balanced')
  let durableRunId: number | undefined
  try {
    const conversation = await getOrCreateAgentConversation({
      projectId: workspace.scope.projectId,
      scope: workspace.scope,
      worldGroupId: null,
    })
    const plan = directPlan(input.fixture)
    const execute: NonNullable<MasterAgentDurableDependenciesV1['execute']> = async options => {
      const task = options.plan.tasks[0]
      const taskBudget = options.budget ?? budget
      await options.executionTrace?.taskStarted?.(task)
      const prepared = await prepareStoryArcCopilot({
        projectId: workspace.scope.projectId,
        scope: workspace.scope,
        worldGroupId: null,
        authorRequest: task.instruction,
        skillId: task.skillId,
        configOverride: config,
        generationOverrides: { temperature: 0.55, maxTokens: 6_000 },
      }, {
        runAI: async messages => {
          try {
            const response = await callModel({
              messages,
              config: { ...config, temperature: 0.55, maxTokens: 6_000 },
              identity: input.generator,
              promptVersion: H86_AGENT_PROMPT_VERSION_V1,
              stage: 'generation',
              variant: input.variant,
              responseFormat: supportsVerifiedJsonObjectResponseV1(config.provider)
                ? 'json_object'
                : undefined,
            })
            calls.push(response.call)
            return response.output
          } catch (error) {
            if (error instanceof H86CallFailure) calls.push(error.call)
            throw error
          }
        },
      })
      if (prepared.contextGatewayExecution) {
        await options.executionTrace?.contextGatewayPrepared?.(task, {
          execution: prepared.contextGatewayExecution,
          assembled: prepared.input.assembled,
          renderedRequest: prepared.prepared.messages,
        })
      }
      const skill = getAgentSkillV1('outline.story-arcs')
      const generated = await runBudgetedGenerationNode({
        node: prepared.node,
        prepared: prepared.prepared,
        budget: taskBudget,
        callLabel: 'H86 故事线编排 Skill',
        maxOutputTokens: skill.maxOutputTokens,
        validate: output => validateDomainCandidateCanon({
          agentId: 'outline',
          projectId: workspace.scope.projectId,
          worldGroupId: null,
          outputText: JSON.stringify(output),
        }),
      })
      const candidate: ExecutedMasterCandidate = {
        payload: {
          version: 1,
          taskId: task.id,
          agentId: 'outline',
          skillId: 'outline.story-arcs',
          label: prepared.label,
          contextSources: prepared.contextSources,
          contextEvidence: prepared.contextEvidence,
          baseSnapshot: prepared.snapshot,
          storyArcKind: prepared.kind,
          workspaceScope: workspace.scope,
          dependsOnTaskIds: [],
          teamBudgetEvidence: taskBudget.snapshot(),
        },
        draft: JSON.stringify(generated.output, null, 2),
        runtimeNode: prepared.node,
        runtimeOutput: generated.output,
        ...(prepared.contextGatewayExecution ? {
          contextGatewayRuntime: {
            execution: prepared.contextGatewayExecution,
            assembled: prepared.input.assembled,
            renderedRequest: prepared.prepared.messages,
            rawResponse: generated.structuredOutputEvidence ?? generated.output,
          },
        } : {}),
      }
      await options.executionTrace?.candidateReady?.(task, candidate)
      return [candidate]
    }
    const onDurableBoundary = (boundary: { runId: number }) => { durableRunId = boundary.runId }
    let run
    try {
      run = await runDurableMasterAgentPlanV1({
        scope: workspace.scope,
        worldGroupId: null,
        conversationId: conversation.id!,
        plan,
        budget,
        onDurableBoundary,
      }, { execute })
    } catch (firstError) {
      if (durableRunId == null) throw firstError
      // The production durable contract permits one identical retry for a transient/protocol
      // failure. Exercise that exact recovery boundary here; a repeated fingerprint is then
      // stopped by the durable failure policy instead of looping.
      run = await runDurableMasterAgentPlanV1({
        scope: workspace.scope,
        worldGroupId: null,
        runId: durableRunId,
        onDurableBoundary,
      }, { execute })
    }
    const candidate = run.candidates[0]
    if (!candidate?.draft.trim() || !candidate.payload.candidateHash) throw new Error('durable_candidate_missing')
    const snapshot = await readAgentRunV1(workspace.scope, run.runId)
    const durableEvidence = {
      runEvidenceHash: await hashCanonicalValue({
        contract: snapshot.contract,
        projection: snapshot.projection,
      }),
      candidateHash: candidate.payload.candidateHash,
      contextSources: [...candidate.payload.contextSources],
      projectionState: run.projection.state,
      modelCalls: run.budgetEvidence.calls,
      candidatePersisted: run.projection.state === 'awaiting_confirmation',
    }
    return {
      attempt: input.attempt,
      status: 'succeeded',
      output: candidate.draft,
      outputHash: await hashCanonicalValue(candidate.draft),
      parserPassed: true,
      calls,
      durableEvidence,
    }
  } catch (error) {
    const lastCall = calls[calls.length - 1]
    const status = lastCall?.status === 'provider-failed' ? 'provider-failed' : 'protocol-failed'
    return {
      attempt: input.attempt,
      status,
      output: '',
      outputHash: null,
      parserPassed: false,
      calls: calls.length ? calls : [await createH86CallEvidenceV1({
        stage: 'generation',
        variant: input.variant,
        identity: { ...input.generator, promptVersion: H86_AGENT_PROMPT_VERSION_V1 },
        messages: [{ role: 'user', content: `fixture:${input.fixture.id}` }],
        output: null,
        usage: null,
        status: 'protocol-failed',
        failureCode: 'durable_execution_failed_before_model',
        failureMessage: failureMessage(error),
      })],
      failureCode: status === 'provider-failed' ? 'provider_error' : 'agent_harness_execution_failed',
      failureMessage: failureMessage(error),
    }
  }
}

export function createH86BrowserRunDependenciesV1(input: {
  generatorConfig: AIConfig
  verifierConfig: AIConfig
}) {
  return {
    generate: async (call: H86GenerationCallInputV1): Promise<H86GenerationAttemptV1> => {
      const workspace = await seedWorkspace(call.fixture)
      try {
        return call.variant === 'baseline-direct'
          ? await baselineGeneration(call, input.generatorConfig, workspace)
          : await agentHarnessGeneration(call, input.generatorConfig, workspace)
      } finally {
        await cleanupWorkspace(workspace.scope.projectId)
      }
    },
    verify: async (call: H86VerificationCallInputV1): Promise<H86VerificationAttemptV1> => {
      const messages = buildH86VerifierMessagesV1({
        fixture: call.fixture,
        variant: call.variant,
        output: call.output,
      })
      let response: ModelCallResultV1
      try {
        response = await callModel({
          messages,
          config: { ...input.verifierConfig, temperature: 0, maxTokens: 2_000 },
          identity: call.verifier,
          promptVersion: H86_VERIFIER_PROMPT_VERSION_V1,
          stage: 'verification',
          variant: call.variant,
          responseFormat: supportsVerifiedJsonObjectResponseV1(input.verifierConfig.provider)
            ? 'json_object'
            : undefined,
        })
      } catch (error) {
        if (!(error instanceof H86CallFailure)) throw error
        return {
          attempt: call.attempt,
          status: error.call.status,
          assessment: null,
          calls: [error.call],
          failureCode: error.code,
          failureMessage: error.message,
        }
      }
      try {
        return {
          attempt: call.attempt,
          status: 'succeeded',
          assessment: parseH86VerifierAssessmentV1(response.output, call.fixture),
          calls: [response.call],
        }
      } catch (error) {
        return {
          attempt: call.attempt,
          status: 'protocol-failed',
          assessment: null,
          calls: [response.call],
          failureCode: 'verifier_protocol_failed',
          failureMessage: failureMessage(error),
        }
      }
    },
  }
}

export function estimatedMessagesTokensV1(messages: Parameters<typeof chat>[0]): number {
  return messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
}
