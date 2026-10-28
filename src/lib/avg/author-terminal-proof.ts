import { db } from '../db/schema';
import { readAgentRunV1 } from '../agent/run/event-store';
import { canonicalProductProductionJsonV2 as json, hashProductProductionValueV2 as hash } from '../product-production/hash';
import { hashProductProductionCarriedCandidateV1, type ProductProductionPortableTaskLedgerEntryV1 } from '../product-production/task-evidence';
import type { ProductBuildArtifactRecordV1, ProductBuildRecordV1, ProductProductionPlanTaskV3, WorkspaceScope } from '../types';
/** A zero-provider scheduler Run attests to consumption of author-adopted
 * bytes. The original author provenance remains on the Artifact. */
export async function verifyAvgAuthorTaskTerminalV1(input: {
    scope: WorkspaceScope;
    build: ProductBuildRecordV1 & {
        id: number;
    };
    rootRunId: number;
    task: ProductProductionPlanTaskV3;
    siblings: ProductBuildArtifactRecordV1[];
    ledger: ProductProductionPortableTaskLedgerEntryV1;
    ledgerRunId: number;
    dependencies: Array<{
        taskKey: string;
        receiptHash: string;
    }>;
    authorReceiptHash: string;
}) {
    const { task, build, ledger } = input;
    const fail = () => { throw new Error(`[avg] 作者任务消费回执不闭合:${task.taskKey}`); };
    if (task.executionMode !== 'human-import' || task.skillId !== null || task.reuse !== null
        || task.capabilityRequirementKeys.length || input.siblings.length !== 1
        || input.siblings.some(row => row.status !== 'accepted' || row.producerRunId !== null || row.producerReceiptHash !== null || row.carriedFrom !== null)
        || ledger.attempt !== 1 || Object.values(ledger.usage).some(value => value !== 0)
        || json(ledger.passedGateIds) !== json(task.acceptanceGateIds))
        fail();
    const candidateHash = await hashProductProductionCarriedCandidateV1(input.siblings);
    const executionIdentityHash = await hash({ schema: 'storyforge.product-production-task-execution-identity', version: 1,
        taskKey: task.taskKey, taskKind: task.kind, executionMode: task.executionMode, executionBindings: [] });
    const inputHash = await hash({ schema: 'storyforge.product-production-carried-task-input', version: 1,
        planHash: build.planHash, taskKey: task.taskKey, controlEpoch: build.controlEpoch, dependencies: input.dependencies,
        candidateHash, executionIdentityHash, capabilityBindings: [] });
    const receiptHash = await hash({ schema: 'storyforge.product-production-carried-task-receipt', version: 1,
        taskKey: task.taskKey, inputHash, candidateHash, dependencies: input.dependencies, executionIdentityHash,
        passedGateIds: task.acceptanceGateIds, controlEpoch: build.controlEpoch });
    const snapshot = await readAgentRunV1(input.scope, input.ledgerRunId);
    const boundary = snapshot.contract.scope.productProduction;
    const children = await db.agentRuns.where('[parentRunId+parentRelation]').equals([input.rootRunId, `task:${task.taskKey}`]).toArray();
    const step = snapshot.projection.steps[task.taskKey];
    const checkpoints = await db.agentRunCheckpoints.where('runId').equals(input.ledgerRunId).count();
    if (candidateHash !== ledger.candidateHash || inputHash !== ledger.idempotencyKey || receiptHash !== ledger.terminalReceiptHash
        || children.length !== 1 || children[0].id !== input.ledgerRunId || checkpoints !== 0
        || snapshot.run.parentRunId !== input.rootRunId || snapshot.run.parentRelation !== `task:${task.taskKey}`
        || snapshot.run.productBuildId !== build.id || snapshot.run.projectId !== input.scope.projectId || snapshot.run.workId !== input.scope.workId
        || snapshot.run.status !== 'completed' || snapshot.projection.state !== 'completed'
        || snapshot.run.terminalReceiptHash !== receiptHash || snapshot.projection.terminalReceiptHash !== receiptHash
        || (snapshot.contract.executionBindings?.length ?? 0) !== 0
        || step?.status !== 'succeeded' || step.attempt !== 1 || step.candidateHash != null || step.outputHash !== candidateHash
        || !boundary || boundary.productBuildId !== build.id || boundary.buildNumber !== build.buildNumber
        || boundary.controlEpoch !== build.controlEpoch || boundary.planHash !== build.planHash || boundary.taskKey !== task.taskKey)
        fail();
    return { taskKey: task.taskKey, status: 'author-import', consumptionRunId: input.ledgerRunId,
        inputHash, candidateHash, receiptHash, authorReceiptHash: input.authorReceiptHash };
}
