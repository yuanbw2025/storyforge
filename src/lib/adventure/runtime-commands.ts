/** Product-owned deterministic runtime commands: adventure. */
import { availableAdventureActions, applyAdventureEffects, adventureNarrativeProjection } from "./runtime";
import { db } from "../db/schema";
import { applyProductRuntimeEvent, assertFormalRuntimeSourceUnchangedV1, commitNarrativeChoice, hashStateJson, normalizeCommandId, parseEventPayload, parseProductRuntimeState, readProductRuntimeState, readSessionEvents, replayProductRuntimeEvents, verifyFormalRuntimeSourceV1 } from "../product/runtime-core";
import { buildProductRuntimeDiceResolutionV1, parseProductRuntimeDiceExpressionV1 } from "../product/runtime-dice";
import { adventureNarrativeActionCommandIdV1 } from "./command-identity";
import type { ProductRuntimeEvent, ProductRuntimeSession, ProductRuntimeEventType, ProductRuntimeState } from "../types";
export function adventureNarrativeActionCommandId(
  sessionId: number,
  choiceKey: string,
): string {
  return adventureNarrativeActionCommandIdV1(sessionId, choiceKey);
}

function adventureNarrativeChoiceCommandId(
  sessionId: number,
  choiceKey: string,
): string {
  return normalizeCommandId(`choice-commit:${sessionId}:${choiceKey}`);
}

/**
 * Executes the deliberately small Narrative -> Adventure public-action bridge.
 * Both phases use stable command ids, so a crash between the action and the
 * choice is recoverable by calling this function again without duplicating an
 * item, quest effect, or ending transition.
 */
export async function commitAdventureNarrativeChoice(input: {
  sessionId: number;
  choiceKey: string;
  commandId?: string;
}): Promise<ProductRuntimeEvent> {
  const choiceKey = input.choiceKey.trim();
  if (!choiceKey)
    throw new Error("[adventure] Narrative Choice key 不能为空。");
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (
    !session ||
    (session.kind !== "text-adventure" && session.kind !== "text-open-world") ||
    (session.productReleaseId == null && session.productBuildId == null)
  ) {
    throw new Error("[adventure] 正式文字冒险实例不存在。");
  }
  const frozen = await verifyFormalRuntimeSourceV1(session, [
    "text-adventure",
    "text-open-world",
  ]);
  if (!frozen.runtimePackage.adventure) {
    throw new Error("[adventure] 冻结 Product RuntimePackage 缺少冒险模块。");
  }
  const bridgeChoiceCommandId = adventureNarrativeChoiceCommandId(
    session.id!,
    choiceKey,
  );
  const existingEvents = await readSessionEvents(session);
  let state = replayProductRuntimeEvents(
    parseProductRuntimeState(session.initialStateJson),
    existingEvents,
  );
  const choice = state.narrative?.choices?.find(
    (item) => item.choiceKey === choiceKey,
  );
  if (!choice || choice.sourceNodeKey !== state.narrative?.currentNodeKey) {
    const prior = existingEvents.find((event) => {
      if (event.type !== "narrative.choice.committed") return false;
      const payload = parseEventPayload(event);
      return (
        payload.choiceKey === choiceKey &&
        (event.commandId === bridgeChoiceCommandId ||
          (input.commandId != null &&
            event.commandId === normalizeCommandId(input.commandId)))
      );
    });
    if (prior) return prior;
    throw new Error("[adventure] Narrative Choice 不属于当前节点。");
  }
  const actionTags = choice.tags.filter((tag) =>
    tag.startsWith("adventure-action:"),
  );
  if (actionTags.length > 1)
    throw new Error("[adventure] Narrative Choice 只能绑定一个公共行动。");
  const choiceCommandId =
    actionTags.length === 1
      ? bridgeChoiceCommandId
      : normalizeCommandId(input.commandId ?? "");
  const priorChoice = existingEvents.find(
    (event) => event.commandId === choiceCommandId,
  );
  if (priorChoice) {
    const payload = parseEventPayload(priorChoice);
    if (
      priorChoice.type !== "narrative.choice.committed" ||
      payload.choiceKey !== choiceKey
    ) {
      throw new Error(
        "[adventure] Narrative Choice commandId 已被不同命令使用。",
      );
    }
    return priorChoice;
  }
  if (actionTags.length === 1) {
    const actionKey = actionTags[0].slice("adventure-action:".length);
    const action = frozen.runtimePackage.adventure.actions.find(
      (item) => item.key === actionKey,
    );
    if (!action || action.narrativeChoiceKey !== choiceKey) {
      throw new Error(
        "[adventure] Narrative Choice 没有有效的冻结公共行动绑定。",
      );
    }
    const actionCommandId = adventureNarrativeActionCommandId(
      session.id!,
      choiceKey,
    );
    if (
      !state.adventure?.actionHistory.some(
        (item) =>
          item.actionKey === actionKey && item.commandId === actionCommandId,
      )
    ) {
      const baseStateHash = await hashStateJson(JSON.stringify(state));
      await commitAdventureAction({
        sessionId: session.id!,
        actionKey,
        commandId: actionCommandId,
        baseSequence: state.lastSequence,
        baseStateHash,
      });
      state = await readProductRuntimeState(session.id!);
    }
  }
  const baseStateHash = await hashStateJson(JSON.stringify(state));
  return commitNarrativeChoice({
    sessionId: session.id!,
    choiceKey,
    commandId: choiceCommandId,
    baseSequence: state.lastSequence,
    baseStateHash,
  });
}

export interface AdventureCommandEnvelope {
  sessionId: number;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
  actionKey: string;
}

function adventureEvent(
  session: ProductRuntimeSession,
  sequence: number,
  type: ProductRuntimeEventType,
  payload: Record<string, unknown>,
  envelope?: Pick<
    AdventureCommandEnvelope,
    "commandId" | "baseSequence" | "baseStateHash"
  >,
): ProductRuntimeEvent {
  return {
    projectId: session.projectId,
    worldGroupId: session.worldGroupId ?? null,
    sessionId: session.id!,
    sequence,
    type,
    actorKey: "player",
    targetKey: null,
    commandId: envelope?.commandId ?? null,
    baseSequence: envelope?.baseSequence ?? null,
    baseStateHash: envelope?.baseStateHash ?? null,
    payloadJson: JSON.stringify(payload),
    createdAt: Date.now(),
  };
}

function adventureEffectsForOutcome(
  action: import("../types").AdventureActionDefinition,
  outcome: import("../types").AdventureCheckOutcome,
) {
  return outcome === "success"
    ? action.successEffects
    : outcome === "costly-success"
      ? action.costlySuccessEffects
      : action.failureEffects;
}

function adventureTextForOutcome(
  action: import("../types").AdventureActionDefinition,
  outcome: import("../types").AdventureCheckOutcome,
): string {
  return outcome === "success"
    ? action.successText
    : outcome === "costly-success"
      ? action.costlySuccessText
      : action.failureText;
}

async function buildAdventureInteractionStateHashes(input: {
  state: ProductRuntimeState;
  session: ProductRuntimeSession;
  action: import("../types").AdventureActionDefinition;
  commandId: string;
}): Promise<string[]> {
  if (input.action.kind !== "talk") return [];
  const binding = input.action.interaction;
  const interaction = input.state.interaction;
  if (!binding || !interaction)
    throw new Error("[adventure] talk 行动缺少共享角色互动状态。");
  const scene = interaction.sceneTemplates.find(
    (item) => item.sceneKey === binding.sceneKey,
  );
  const rule = scene?.relationshipRules.find(
    (item) => item.ruleKey === binding.ruleKey,
  );
  if (!scene || !rule)
    throw new Error("[adventure] talk 行动的冻结互动绑定无效。");
  let projected = structuredClone(input.state);
  const sceneId = `scene:${binding.sceneKey}:${projected.lastSequence + 1}`;
  const descriptors: Array<{
    type: ProductRuntimeEventType;
    payload: Record<string, unknown>;
  }> = [
    {
      type: "interaction.scene.started",
      payload: { sceneId, sceneKey: binding.sceneKey },
    },
    {
      type: "interaction.player.message.committed",
      payload: {
        messageId: `message:${binding.ruleKey}:${projected.lastSequence + 2}`,
        text: rule.playerText,
        audienceKeys: null,
      },
    },
    {
      type: "interaction.relationship.changed",
      payload: {
        fromParticipantKey: rule.fromParticipantKey,
        toParticipantKey: rule.toParticipantKey,
        dimensionKey: rule.dimensionKey,
        delta: rule.delta,
        reason: rule.reason,
        ruleKey: rule.ruleKey,
        sourceEventSequence: projected.lastSequence + 2,
        significantEventKey: rule.significantEventKey,
      },
    },
    {
      type: "interaction.scene.ended",
      payload: { sceneId, reason: `adventure-action:${input.action.key}` },
    },
  ];
  const hashes: string[] = [];
  for (const descriptor of descriptors) {
    const baseStateHash = await hashStateJson(JSON.stringify(projected));
    hashes.push(baseStateHash);
    const sequence = projected.lastSequence + 1;
    const envelope = {
      commandId: `${input.commandId.slice(0, 150)}:interaction:${sequence}`,
      baseSequence: projected.lastSequence,
      baseStateHash,
    };
    projected = applyProductRuntimeEvent(
      projected,
      adventureEvent(
        input.session,
        sequence,
        descriptor.type,
        { ...descriptor.payload, ...envelope },
        envelope,
      ),
    );
  }
  return hashes;
}

/**
 * TEXTADV-1 authoritative write path. A command expands into small domain
 * events inside one Dexie transaction; no UI or Harness candidate may submit
 * those events directly.
 */
export async function commitAdventureAction(
  input: AdventureCommandEnvelope,
): Promise<ProductRuntimeEvent> {
  const commandId = normalizeCommandId(input.commandId);
  const actionKey = input.actionKey.trim();
  if (!actionKey || actionKey.length > 160)
    throw new Error("[adventure] 行动 key 无效。");
  if (!Number.isInteger(input.baseSequence) || input.baseSequence < 0)
    throw new Error("[adventure] baseSequence 无效。");
  if (!/^[a-f0-9]{64}$/.test(input.baseStateHash))
    throw new Error("[adventure] baseStateHash 无效。");
  const previewSession = await db.productRuntimeSessions.get(input.sessionId);
  if (
    !previewSession ||
    (previewSession.kind !== "text-adventure" &&
      previewSession.kind !== "text-open-world") ||
    (previewSession.productReleaseId == null && previewSession.productBuildId == null)
  ) {
    throw new Error("[adventure] 正式文字冒险实例不存在。");
  }
  const [previewEvents, frozen] = await Promise.all([
    readSessionEvents(previewSession),
    verifyFormalRuntimeSourceV1(previewSession, [
      "text-adventure",
      "text-open-world",
    ]),
  ]);
  const adventureContent = frozen.runtimePackage.adventure;
  if (!adventureContent) {
    throw new Error("[adventure] 冻结 Product RuntimePackage 缺少冒险模块。");
  }
  const previewPrior = previewEvents.find(
    (event) => event.commandId === commandId,
  );
  if (previewPrior) {
    const body = parseEventPayload(previewPrior);
    if (
      previewPrior.type !== "adventure.action.committed" ||
      body.actionKey !== actionKey ||
      previewPrior.baseSequence !== input.baseSequence ||
      previewPrior.baseStateHash !== input.baseStateHash
    ) {
      throw new Error("[adventure] commandId 已被不同命令使用。");
    }
    return previewPrior;
  }
  const previewState = replayProductRuntimeEvents(
    parseProductRuntimeState(previewSession.initialStateJson),
    previewEvents,
  );
  const previewStateHash = await hashStateJson(JSON.stringify(previewState));
  if (
    !previewState.adventure ||
    previewState.adventure.contentHash !== frozen.packageHash
  ) {
    throw new Error("[adventure] 实例 Product Release/Build 绑定无效。");
  }
  const previewAvailable = availableAdventureActions(
    adventureContent,
    previewState.adventure,
    previewState.narrative?.variables,
  ).find((item) => item.action.key === actionKey);
  if (!previewAvailable?.available) {
    throw new Error(
      previewAvailable?.reason ||
        "[adventure] 行动不在当前位置或前置条件未满足。",
    );
  }
  if (
    previewSession.kind === "text-open-world" &&
    previewAvailable.action.kind === "move"
  ) {
    throw new Error("[text-open-world] 区域移动只能通过开放世界交通命令提交。");
  }
  const interactionStateHashes = await buildAdventureInteractionStateHashes({
    state: previewState,
    session: previewSession,
    action: previewAvailable.action,
    commandId,
  });
  return db.transaction(
    "rw",
    [
      db.productRuntimeSessions,
      db.productRuntimeEvents,
      db.productReleases,
      db.productBuilds,
      db.productProductions,
      db.productProductionBriefs,
    ],
    async () => {
      const session = await db.productRuntimeSessions.get(input.sessionId);
      if (
        !session ||
        (session.kind !== "text-adventure" && session.kind !== "text-open-world") ||
        (session.productReleaseId == null && session.productBuildId == null)
      )
        throw new Error("[adventure] 正式文字冒险实例不存在。");
      await assertFormalRuntimeSourceUnchangedV1({
        previewSession,
        session,
        frozen,
      });
      const events = await readSessionEvents(session);
      const prior = events.find((event) => event.commandId === commandId);
      if (prior) {
        const body = parseEventPayload(prior);
        if (
          prior.type !== "adventure.action.committed" ||
          body.actionKey !== actionKey ||
          prior.baseSequence !== input.baseSequence ||
          prior.baseStateHash !== input.baseStateHash
        ) {
          throw new Error("[adventure] commandId 已被不同命令使用。");
        }
        return prior;
      }
      if (session.status !== "active")
        throw new Error("[adventure] 只有 active 实例可以行动。");
      let projected = replayProductRuntimeEvents(
        parseProductRuntimeState(session.initialStateJson),
        events,
      );
      if (projected.lastSequence !== input.baseSequence)
        throw new Error("[adventure] 冒险状态已变化，请刷新后重试。");
      if (
        previewState.lastSequence !== projected.lastSequence ||
        previewStateHash !== input.baseStateHash
      )
        throw new Error("[adventure] 冒险状态哈希已变化。");
      if (
        !projected.adventure ||
        projected.adventure.contentHash !== frozen.packageHash
      ) {
        throw new Error("[adventure] 实例 Product Release/Build 绑定无效。");
      }
      const available = availableAdventureActions(
        adventureContent,
        projected.adventure,
        projected.narrative?.variables,
      ).find((item) => item.action.key === actionKey);
      if (!available?.available)
        throw new Error(
          available?.reason || "[adventure] 行动不在当前位置或前置条件未满足。",
        );
      const action = available.action;
      if (session.kind === "text-open-world" && action.kind === "move") {
        throw new Error("[text-open-world] 区域移动只能通过开放世界交通命令提交。");
      }
      if (action.kind === "talk") {
        const binding = action.interaction;
        if (!binding || !projected.interaction)
          throw new Error("[adventure] talk 行动缺少共享角色互动状态。");
        const scene = projected.interaction.sceneTemplates.find(
          (item) => item.sceneKey === binding.sceneKey,
        );
        const rule = scene?.relationshipRules.find(
          (item) => item.ruleKey === binding.ruleKey,
        );
        if (
          !scene ||
          !scene.participantKeys.includes(binding.participantKey) ||
          !rule ||
          rule.fromParticipantKey !== binding.participantKey
        ) {
          throw new Error("[adventure] talk 行动的冻结互动绑定无效。");
        }
        if (projected.interaction.activeScene)
          throw new Error("[adventure] 请先结束当前角色互动场景。");
      }
      let outcome: import("../types").AdventureCheckOutcome = "success";
      let evidence: import("../types").AdventureCheckEvidence | null = null;
      const remainingInteractionStateHashes = [...interactionStateHashes];
      const nextSequence = () => projected.lastSequence + 1;
      const append = async (
        type: ProductRuntimeEventType,
        payload: Record<string, unknown>,
        envelope?: boolean,
      ) => {
        const interactionEnvelope = type.startsWith("interaction.")
          ? {
              commandId: `${commandId.slice(0, 150)}:interaction:${nextSequence()}`,
              baseSequence: projected.lastSequence,
              baseStateHash:
                remainingInteractionStateHashes.shift() ??
                (() => {
                  throw new Error("[adventure] 互动状态哈希预算不足。");
                })(),
            }
          : null;
        const selectedEnvelope =
          interactionEnvelope ??
          (envelope
            ? {
                commandId,
                baseSequence: input.baseSequence,
                baseStateHash: input.baseStateHash,
              }
            : undefined);
        const event = adventureEvent(
          session,
          nextSequence(),
          type,
          interactionEnvelope
            ? { ...payload, ...interactionEnvelope }
            : payload,
          selectedEnvelope,
        );
        projected = applyProductRuntimeEvent(projected, event);
        event.id = (await db.productRuntimeEvents.add(event)) as number;
        return event;
      };
      if (action.kind === "talk") {
        const binding = action.interaction!;
        const scene = projected.interaction!.sceneTemplates.find(
          (item) => item.sceneKey === binding.sceneKey,
        )!;
        const rule = scene.relationshipRules.find(
          (item) => item.ruleKey === binding.ruleKey,
        )!;
        const sceneId = `scene:${binding.sceneKey}:${nextSequence()}`;
        await append("interaction.scene.started", {
          sceneId,
          sceneKey: binding.sceneKey,
        });
        const message = await append("interaction.player.message.committed", {
          messageId: `message:${binding.ruleKey}:${nextSequence()}`,
          text: rule.playerText,
          audienceKeys: null,
        });
        await append("interaction.relationship.changed", {
          fromParticipantKey: rule.fromParticipantKey,
          toParticipantKey: rule.toParticipantKey,
          dimensionKey: rule.dimensionKey,
          delta: rule.delta,
          reason: rule.reason,
          ruleKey: rule.ruleKey,
          sourceEventSequence: message.sequence,
          significantEventKey: rule.significantEventKey,
        });
        await append("interaction.scene.ended", {
          sceneId,
          reason: `adventure-action:${action.key}`,
        });
      }
      if (action.rule.kind === "threshold") {
        const total = projected.adventure.abilities[action.rule.abilityKey];
        outcome = total >= action.rule.difficulty ? "success" : "failure";
        evidence = {
          eventSequence: nextSequence(),
          actionKey,
          abilityKey: action.rule.abilityKey,
          mode: "threshold",
          expression: null,
          dice: [],
          modifier: total,
          total,
          difficulty: action.rule.difficulty,
          outcome,
        };
      } else if (action.rule.kind === "random") {
        const expression = parseProductRuntimeDiceExpressionV1(action.rule.expression);
        const ability = projected.adventure.abilities[action.rule.abilityKey];
        if (ability == null)
          throw new Error(`[adventure] 能力不存在:${action.rule.abilityKey}`);
        const dice = buildProductRuntimeDiceResolutionV1({
          seed: session.seed,
          sequence: nextSequence(),
          expression,
          nonce: `adventure:${commandId}:${actionKey}`,
        });
        const total = dice.total + ability;
        outcome =
          total >= action.rule.difficulty
            ? "success"
            : action.rule.costlySuccessFloor != null &&
                total >= action.rule.costlySuccessFloor
              ? "costly-success"
              : "failure";
        evidence = {
          eventSequence: nextSequence(),
          actionKey,
          abilityKey: action.rule.abilityKey,
          mode: "random",
          expression: dice.expression,
          dice: dice.dice,
          modifier: dice.modifier + ability,
          total,
          difficulty: action.rule.difficulty,
          outcome,
        };
      } else if (action.rule.kind === "resource-payment") {
        const total = projected.adventure.resources[action.rule.resourceKey];
        outcome = total >= action.rule.amount ? "success" : "not-attempted";
        evidence = {
          eventSequence: nextSequence(),
          actionKey,
          abilityKey: null,
          mode: "resource-payment",
          expression: null,
          dice: [],
          modifier: 0,
          total,
          difficulty: action.rule.amount,
          outcome,
        };
      }
      if (evidence) await append("adventure.check.resolved", { evidence });
      const effects =
        outcome === "not-attempted"
          ? []
          : [
              ...(action.rule.kind === "resource-payment"
                ? [
                    {
                      op: "change-resource" as const,
                      resourceKey: action.rule.resourceKey,
                      delta: -action.rule.amount,
                    },
                  ]
                : []),
              ...adventureEffectsForOutcome(action, outcome),
            ];
      // Preflight all effects against a pure clone before the first mutating event.
      applyAdventureEffects(
        adventureContent,
        projected.adventure,
        effects,
        nextSequence(),
      );
      for (const effect of effects) {
        if (effect.op === "enter-location") {
          await append("adventure.location.left", {
            locationKey: projected.adventure!.currentLocationKey,
          });
          await append("adventure.location.entered", {
            locationKey: effect.locationKey,
          });
        } else if (effect.op === "gain-item")
          await append("adventure.item.gained", effect);
        else if (effect.op === "remove-item")
          await append("adventure.item.used", effect);
        else if (effect.op === "transfer-item")
          await append("adventure.item.transferred", effect);
        else if (effect.op === "change-item-state")
          await append("adventure.item.state-changed", effect);
        else if (effect.op === "change-resource") {
          const definition = adventureContent.resources.find(
            (item) => item.key === effect.resourceKey,
          )!;
          const before = projected.adventure!.resources[effect.resourceKey];
          const after = Math.max(
            definition.minimum,
            Math.min(definition.maximum, before + effect.delta),
          );
          if (after !== before + effect.delta)
            throw new Error(`[adventure] 资源越界:${effect.resourceKey}`);
          await append("adventure.resource.changed", {
            resourceKey: effect.resourceKey,
            before,
            after,
            delta: effect.delta,
          });
        } else if (effect.op === "change-ability") {
          const definition = adventureContent.abilities.find(
            (item) => item.key === effect.abilityKey,
          )!;
          const before = projected.adventure!.abilities[effect.abilityKey];
          const after = before + effect.delta;
          if (after < definition.minimum || after > definition.maximum)
            throw new Error(`[adventure] 能力越界:${effect.abilityKey}`);
          await append("adventure.ability.changed", {
            abilityKey: effect.abilityKey,
            before,
            after,
            delta: effect.delta,
          });
        } else if (effect.op === "apply-condition")
          await append("adventure.condition.applied", effect);
        else if (effect.op === "remove-condition")
          await append("adventure.condition.removed", effect);
        else if (effect.op === "accept-quest")
          await append("adventure.quest.accepted", effect);
        else if (effect.op === "fail-quest")
          await append("adventure.quest.failed", effect);
        else {
          await append("adventure.quest.objective-updated", effect);
          const quest = projected.adventure!.quests.find(
            (item) => item.questKey === effect.questKey,
          )!;
          if (
            quest.status === "active" &&
            quest.objectives
              .filter((item) => !item.optional)
              .every((item) => item.completed)
          ) {
            await append("adventure.quest.completed", {
              questKey: effect.questKey,
            });
            const reward = adventureContent.quests.find(
              (item) => item.key === effect.questKey,
            )!.rewardEffects;
            for (const rewardEffect of reward) {
              if (
                rewardEffect.op !== "gain-item" &&
                rewardEffect.op !== "change-resource" &&
                rewardEffect.op !== "change-ability" &&
                rewardEffect.op !== "apply-condition"
              ) {
                throw new Error(
                  "[adventure] 首期任务奖励只支持物品、资源、能力或状态。",
                );
              }
              if (rewardEffect.op === "gain-item")
                await append("adventure.item.gained", rewardEffect);
              else if (rewardEffect.op === "apply-condition")
                await append("adventure.condition.applied", rewardEffect);
              else if (rewardEffect.op === "change-ability") {
                const definition = adventureContent.abilities.find(
                  (item) => item.key === rewardEffect.abilityKey,
                )!;
                const before =
                  projected.adventure!.abilities[rewardEffect.abilityKey];
                const after = before + rewardEffect.delta;
                if (after < definition.minimum || after > definition.maximum)
                  throw new Error(
                    `[adventure] 奖励能力越界:${rewardEffect.abilityKey}`,
                  );
                await append("adventure.ability.changed", {
                  abilityKey: rewardEffect.abilityKey,
                  before,
                  after,
                  delta: rewardEffect.delta,
                });
              } else {
                const definition = adventureContent.resources.find(
                  (item) => item.key === rewardEffect.resourceKey,
                )!;
                const before =
                  projected.adventure!.resources[rewardEffect.resourceKey];
                const after = before + rewardEffect.delta;
                if (after < definition.minimum || after > definition.maximum)
                  throw new Error(
                    `[adventure] 奖励资源越界:${rewardEffect.resourceKey}`,
                  );
                await append("adventure.resource.changed", {
                  resourceKey: rewardEffect.resourceKey,
                  before,
                  after,
                  delta: rewardEffect.delta,
                });
              }
            }
          }
        }
      }
      await append("adventure.narrative.synced", {
        projection: adventureNarrativeProjection(projected.adventure!),
      });
      const narrative =
        outcome === "not-attempted"
          ? action.unavailableText
          : adventureTextForOutcome(action, outcome);
      const committed = await append(
        "adventure.action.committed",
        {
          commandId,
          actionKey,
          kind: action.kind,
          outcome,
          narrative,
          repeatable: action.repeatable,
        },
        true,
      );
      await db.productRuntimeSessions.update(session.id!, {
        updatedAt: Date.now(),
      });
      return committed;
    },
  );
}
