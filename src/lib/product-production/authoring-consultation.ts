import { chat, resolveRequestConfig } from "../ai/client";
import { assertCurrentProductEntryV1, type StoryForgeProductIdV1 } from '../product/product-catalog'
import { assembleContext } from "../registry/assemble-context";
import { getAgentSkillV1 } from "../agent/skill-registry";
import { createAgentSkillExecutionBindingV1 } from "../agent/execution-binding";
import { appendAgentRunEventV1, createAgentRunV1, } from "../agent/run/event-store";
import { createContextManifestFromAssemblyV1 } from "../agent/run/context-manifest";
import { createAgentRunCheckpointV1 } from "../agent/run/checkpoint";
import { createVerificationReceiptV1 } from "../agent/run/verification-receipt";
import { hashCanonicalValue } from "../agent/run/hash";
import type { WorkspaceScope, AIConfig, ChatMessage } from "../types";
export interface AuthoringConversationTurn<S> {
    id: string;
    question: string;
    answer: string;
    settings: S | null;
    runId: number | null;
    error: string;
    createdAt: number;
    archived?: boolean;
}
export interface AuthoringConsultationInput {
    scope: WorkspaceScope;
    question: string;
    config?: AIConfig;
    signal?: AbortSignal;
    runAI?: (messages: ChatMessage[]) => Promise<string>;
}
export async function consultAuthoringV1<S>(input: AuthoringConsultationInput, port: {
    productId: StoryForgeProductIdV1;
    skillId: Parameters<typeof getAgentSkillV1>[0];
    step: string;
    verifier: string;
    category: string;
    prompt: string;
    read: (scope: WorkspaceScope) => Promise<{
        revision: number;
    }>;
    save: (scope: WorkspaceScope, revision: number, turn: AuthoringConversationTurn<S>) => Promise<{
        revision: number;
    }>;
    parse: (value: unknown) => S;
}) {
    const productId = port.productId;
    assertCurrentProductEntryV1(productId);
    const STEP = port.step, VERIFIER = port.verifier;
    const readDraft = port.read, saveConversation = port.save, parseSettings = port.parse;
    const question = input.question.trim();
    if (!question || question.length > 5000)
        throw new Error("请填写 1～5000 字的问题");
    const initial = await readDraft(input.scope);
    const skill = getAgentSkillV1(port.skillId);
    const assembled = await assembleContext({
        projectId: input.scope.projectId,
        scope: input.scope,
        sourceKeys: [...skill.contextSourceKeys],
        inputBudgetMaxTokens: 20000,
    });
    if (assembled.overBudgetAfterTrim)
        throw new Error("会谈超过上下文容量，请先保存当前方案并开始新会谈");
    const binding = createAgentSkillExecutionBindingV1(skill);
    const resolved = input.config
        ? resolveRequestConfig({ ...input.config, maxTokens: 8000 }, {
            category: port.category,
            projectId: input.scope.projectId,
            contextOverflowPolicy: "reject",
        })
        : null;
    if (!input.runAI && !resolved)
        throw new Error("请先配置全局 AI");
    const messages: ChatMessage[] = [
        {
            role: "system",
            content: port.prompt,
        },
        {
            role: "user",
            content: `登记上下文：\n${assembled.text}\n作者本轮问题：\n${question}`,
        },
    ];
    let snapshot = await createAgentRunV1({
        scope: input.scope,
        worldGroupId: null,
        contract: {
            version: 1,
            objective: question.slice(0, 4000),
            failurePolicy: {
                onProtocolError: "fail",
                onVerificationFailure: "fail",
                onStaleInput: "pause-for-author",
            },
            workflowKind: "direct-generation",
            scope: { projectId: input.scope.projectId, worldGroupId: null },
            permissions: {
                contextSourceKeys: skill.contextSourceKeys,
                writeTargets: [],
            },
            runtimeBindingHash: await hashCanonicalValue({
                binding,
                revision: initial.revision,
                messages,
                model: resolved?.config.model ?? "test",
            }),
            executionBindings: [{ stepId: STEP, ...binding }],
            budget: {
                maxModelCalls: 1,
                maxToolCalls: 0,
                maxInputTokens: 24000,
                maxOutputTokens: 8000,
                maxAttemptsPerStep: 1,
            },
            acceptance: [
                {
                    id: `${STEP}.settings.valid`,
                    kind: "deterministic-check",
                    required: true,
                },
            ],
            verificationPlan: [
                {
                    id: `${STEP}.terminal`,
                    kind: "terminal",
                    verifier: VERIFIER,
                    criterionIds: [`${STEP}.settings.valid`],
                },
            ],
        },
    });
    const append = async (type: Parameters<typeof appendAgentRunEventV1>[0]["type"], payload: unknown) => {
        snapshot = await appendAgentRunEventV1({
            scope: input.scope,
            runId: snapshot.run.id,
            type,
            payload,
            expectedLastSequence: snapshot.projection.lastSequence,
        } as Parameters<typeof appendAgentRunEventV1>[0]);
    };
    const turn: AuthoringConversationTurn<S> = {
        id: crypto.randomUUID(),
        question,
        answer: "",
        settings: null,
        runId: snapshot.run.id,
        error: "",
        createdAt: Date.now(),
    };
    const saved = await saveConversation(input.scope, initial.revision, turn);
    try {
        await append("step.scheduled", { stepId: STEP });
        await append("step.started", { stepId: STEP, attempt: 1 });
        const manifest = await createContextManifestFromAssemblyV1({
            runId: snapshot.run.id,
            stepId: STEP,
            attempt: 1,
            projectId: input.scope.projectId,
            worldGroupId: null,
            declaredSourceKeys: skill.contextSourceKeys,
            assembled,
            readerVersion: VERIFIER,
        });
        await append("context.assembled", {
            stepId: STEP,
            attempt: 1,
            manifestHash: manifest.manifestHash,
        });
        assertCurrentProductEntryV1(productId);
        await append("model.requested", {
            stepId: STEP,
            attempt: 1,
            bindingHash: await hashCanonicalValue(messages),
        });
        assertCurrentProductEntryV1(productId);
        const output = input.runAI
            ? await input.runAI(messages)
            : await chat(messages, input.config!, {
                category: port.category,
                projectId: input.scope.projectId,
                contextOverflowPolicy: "reject",
            }, input.signal, undefined, undefined, resolved!);
        await append("model.responded", {
            stepId: STEP,
            attempt: 1,
            outputHash: await hashCanonicalValue(output),
        });
        const parsed = JSON.parse(output);
        if (Object.keys(parsed).some((key) => !["answer", "settings"].includes(key)) ||
            typeof parsed.answer !== "string" ||
            !parsed.answer.trim() ||
            parsed.answer.length > 12000)
            throw new Error("Agent 回复格式无效，未应用任何方案变更");
        const candidate = {
            ...turn,
            answer: parsed.answer,
            settings: parseSettings(parsed.settings),
        };
        const hash = await hashCanonicalValue(candidate);
        await append("candidate.persisted", {
            stepId: STEP,
            attempt: 1,
            candidateHash: hash,
            requiresConfirmation: false,
        });
        snapshot = (await createAgentRunCheckpointV1({
            scope: input.scope,
            runId: snapshot.run.id,
            resumePayload: candidate,
            expectedLastSequence: snapshot.projection.lastSequence,
        })).snapshot;
        await append("step.succeeded", {
            stepId: STEP,
            attempt: 1,
            outputHash: hash,
        });
        await append("verification.started", { verifierSetVersion: VERIFIER });
        const receipt = await createVerificationReceiptV1({
            version: 1,
            runId: snapshot.run.id,
            generation: snapshot.projection.generation,
            contractHash: snapshot.run.contractHash,
            contextManifestHashes: [manifest.manifestHash],
            candidateHashes: [hash],
            adoptionEventIds: [],
            postStateHash: hash,
            verifierSetVersion: VERIFIER,
            criteria: [
                {
                    id: `${STEP}.settings.valid`,
                    status: "passed",
                    evidenceRefs: [`candidate:${hash}`],
                },
            ],
            acceptedAt: Date.now(),
        });
        await append("verification.accepted", { receiptHash: receipt.receiptHash });
        await saveConversation(input.scope, saved.revision, candidate);
        return candidate;
    }
    catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        if (snapshot.projection.steps[STEP]?.status === "running") {
            await append("step.failed", {
                stepId: STEP,
                attempt: 1,
                code: `${STEP}.failed`,
                retryable: false,
                category: "protocol",
                action: "fail",
            });
            await append("run.failed", {
                code: `${STEP}.failed`,
                retryable: false,
            });
        }
        await saveConversation(input.scope, saved.revision, {
            ...turn,
            error,
        }).catch(() => { });
        throw cause;
    }
}
