import type { TtrpgRuntimeRuleActionResultV1 } from "../types";

/**
 * Public room events are a separate privacy boundary from viewer projections.
 * ActionContext contains GM truth and private inventory snapshots, so it must
 * never be copied wholesale onto the room broadcast stream.
 */
export function createPublicTtrpgActionEventV1(
  result: TtrpgRuntimeRuleActionResultV1,
): Record<string, unknown> {
  const hidden = result.check?.visibility === "gm-only";
  return {
    eventSequence: result.eventSequence,
    actionKey: result.actionKey,
    actionName: result.actionName,
    actorKey: result.actorKey,
    targetKey: result.targetKey,
    actionPhase: result.actionPhase,
    outcome: hidden ? "hidden" : result.outcome,
    check:
      result.check == null
        ? null
        : hidden
          ? { visibility: "gm-only", resolved: true }
          : {
              expression: result.check.expression,
              dice: [...result.check.dice],
              modifier: result.check.modifier,
              total: result.check.total,
              dc: result.check.dc,
              success: result.check.success,
              visibility: result.check.visibility ?? "public",
              degree: result.check.rule?.degree ?? null,
              proofHash: result.check.rule?.proofHash ?? null,
              rule:
                result.check.rule == null
                  ? null
                  : {
                      actionKey: result.check.rule.actionKey,
                      checkKey: result.check.rule.checkKey,
                      attributeKey: result.check.rule.attributeKey,
                      skillKey: result.check.rule.skillKey ?? null,
                      skillValue: result.check.rule.skillValue ?? null,
                      diceModelKey: result.check.rule.diceModelKey,
                      degree: result.check.rule.degree,
                      mode: result.check.rule.mode ?? "total-vs-target",
                      proofHash: result.check.rule.proofHash,
                      rulePackContentHash:
                        result.check.rule.rulePackContentHash,
                    },
            },
    resourceChanges: result.resourceChanges.map((change) => ({
      entityKey: change.entityKey,
      resourceKey: change.resourceKey,
      before: change.before,
      after: change.after,
    })),
    conditionChanges: result.conditionChanges.map((change) => ({
      entityKey: change.entityKey,
      conditionKey: change.conditionKey,
      stacks: change.stacks,
      duration: change.duration,
    })),
    receipt:
      result.receipt == null
        ? null
        : {
            receiptKey: result.receipt.receiptKey,
            terminalStatus: result.receipt.terminalStatus,
            mechanicalSummary: hidden
              ? "暗骰结果仅 KP 可见，等待主持反馈。"
              : result.receipt.mechanicalSummary,
            actorConsequence: hidden
              ? "等待 KP 描述行动反馈。"
              : result.receipt.actorConsequence,
            sceneConsequence: hidden
              ? "等待 KP 确认场景变化。"
              : result.receipt.sceneConsequence,
            worldConsequence: hidden
              ? "等待 KP 确认长期影响。"
              : result.receipt.worldConsequence,
            failForwardAvailable: hidden
              ? false
              : result.receipt.failForwardAvailable,
            changedEntityKeys: [...result.receipt.changedEntityKeys],
            suggestedNextActionKeys: [
              ...result.receipt.suggestedNextActionKeys,
            ],
            nextActorKey: result.receipt.nextActorKey,
            nextRound: result.receipt.nextRound,
          },
    nextActorKey: result.nextActorKey,
    nextRound: result.nextRound,
  };
}

/**
 * Actor-private delivery adds only that actor's own declaration. It must not
 * copy ActionContext, because the context also freezes GM truth, private NPC
 * motives and other viewer-scoped inventory evidence.
 */
export function createPrivateTtrpgActorActionEventV1(
  result: TtrpgRuntimeRuleActionResultV1,
): Record<string, unknown> {
  return {
    ...createPublicTtrpgActionEventV1(result),
    declaredIntent:
      result.receipt?.context.declaredIntent == null
        ? null
        : structuredClone(result.receipt.context.declaredIntent),
  };
}
