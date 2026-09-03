import type {
  RuleActionDefinitionV1,
  RulePackV1,
  ProductRuntimeState,
  TtrpgRuntimeActionContextV2,
  TtrpgRuntimeActionObserverV2,
  TtrpgRuntimeActionReceiptV2,
  TtrpgRuntimeActorControllerV2,
  TtrpgRuntimeCheck,
  TtrpgRuntimeGmSynthesisFrameV2,
  TtrpgRuntimeReactionCandidateV2,
  TtrpgRuntimeRuleActionResultV1,
  TtrpgCampaignContentV1,
  TtrpgCharacterTemplateV1,
} from "../types";

function fail(message: string): never {
  throw new Error(`[ttrpg-action-feedback] ${message}`);
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label}必须是对象`);
  return value as Record<string, unknown>;
}
function exact(
  row: Record<string, unknown>,
  fields: readonly string[],
  label: string,
): void {
  if (
    Object.keys(row).length !== fields.length ||
    Object.keys(row).some((key) => !fields.includes(key))
  ) {
    fail(`${label}字段不在允许闭集`);
  }
}
function text(value: unknown, label: string, maximum = 4_000): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maximum
  )
    fail(`${label}无效`);
  return value.trim().normalize("NFC");
}
function key(value: unknown, label: string): string {
  const parsed = text(value, label, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(parsed))
    fail(`${label}不是稳定 key`);
  return parsed;
}
function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    fail(`${label}无效`);
  return Number(value);
}
function finite(value: unknown, label: string): number {
  if (!Number.isFinite(value)) fail(`${label}无效`);
  return Number(value);
}
function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T))
    fail(`${label}无效`);
  return value as T;
}
function keyArray(value: unknown, label: string, maximum = 256): string[] {
  if (!Array.isArray(value) || value.length > maximum)
    fail(`${label}必须是有界数组`);
  const parsed = value.map((item, index) => key(item, `${label}[${index}]`));
  if (new Set(parsed).size !== parsed.length) fail(`${label}不得重复`);
  return parsed;
}
function textArray(value: unknown, label: string, maximum = 64): string[] {
  if (!Array.isArray(value) || value.length > maximum)
    fail(`${label}必须是有界数组`);
  return value.map((item, index) => text(item, `${label}[${index}]`, 1_000));
}

export function resolveTtrpgCharacterControllerV2(
  template: Pick<TtrpgCharacterTemplateV1, "role" | "controller">,
  participantController?: "human" | "ai" | "hybrid" | "vacant" | null,
): TtrpgRuntimeActorControllerV2 {
  if (participantController) return participantController;
  if (template.controller === "open") return "vacant";
  if (template.controller) return template.controller;
  return template.role === "npc" ? "gm" : "human";
}

function responsePolicy(input: {
  actorKey: string;
  actingActorKey: string;
  controller: TtrpgRuntimeActorControllerV2;
}): TtrpgRuntimeActionObserverV2["responsePolicy"] {
  if (input.actorKey === input.actingActorKey) return "actor-owned";
  if (input.controller === "human" || input.controller === "hybrid")
    return "prompt-human";
  if (input.controller === "vacant") return "observe-only";
  if (input.controller === "ai") return "ai-eligible";
  if (input.controller === "gm") return "gm-eligible";
  return "observe-only";
}

function ownedItems(state: ProductRuntimeState, actorKey: string) {
  return Object.values(state.ttrpg?.product?.inventory?.items ?? {}).filter(
    (item) => item.ownerRef === actorKey && !item.stateTags.includes("broken"),
  );
}

function grantedActions(input: {
  state: ProductRuntimeState;
  template: TtrpgCharacterTemplateV1;
  rulePack: RulePackV1;
}): Set<string> {
  return new Set([
    ...input.template.actionKeys,
    ...ownedItems(input.state, input.template.characterKey).flatMap(
      (item) =>
        input.rulePack.items.find(
          (definition) => definition.key === item.definitionRef,
        )?.grantedActionKeys ?? [],
    ),
  ]);
}

function degreeLabel(
  outcome: TtrpgRuntimeRuleActionResultV1["outcome"],
): string {
  return (
    {
      automatic: "自动生效",
      "critical-failure": "大失败",
      failure: "失败",
      "partial-success": "部分成功",
      success: "成功",
      "hard-success": "困难成功",
      "extreme-success": "极难成功",
      "critical-success": "大成功",
    } as const
  )[outcome];
}

/** Reject explicit prose claims that invert the already committed degree. */
export function assertTtrpgFeedbackOutcomeConsistentV2(
  feedback: string,
  outcome: TtrpgRuntimeRuleActionResultV1["outcome"],
): void {
  const normalized = feedback.normalize("NFC").toLocaleLowerCase();
  const claimsFailure =
    /(?:检定|行动|尝试|结果).{0,6}(?:失败|未成功)|未能(?:完成|做到|成功)|(?:check|action|attempt)\s+(?:failed|did not succeed)/iu.test(
      normalized,
    );
  const claimsSuccess =
    /(?:检定|行动|尝试|结果).{0,6}(?:成功|顺利完成)|成功(?:完成|做到|通过)|(?:check|action|attempt)\s+succeeded/iu.test(
      normalized,
    );
  const erasesPartialCost =
    /(?:顺利|完全|彻底)(?:成功|完成)|毫无(?:代价|损失|波折)|没有(?:任何)?(?:代价|损失|波折)|(?:fully|completely)\s+succeeded|without\s+(?:cost|complication)/iu.test(
      normalized,
    );
  if (
    [
      "partial-success",
      "success",
      "hard-success",
      "extreme-success",
      "critical-success",
    ].includes(outcome) &&
    claimsFailure
  ) {
    fail("反馈与已提交的成功结果矛盾");
  }
  if (
    (outcome === "failure" || outcome === "critical-failure") &&
    claimsSuccess
  ) {
    fail("反馈与已提交的失败结果矛盾");
  }
  if (outcome === "partial-success" && erasesPartialCost) {
    fail("反馈把部分成功错误描述成无代价的完整成功，结果矛盾");
  }
}

export function createTtrpgActionReceiptV2(input: {
  state: ProductRuntimeState;
  campaign: TtrpgCampaignContentV1;
  rulePack: RulePackV1;
  sequence: number;
  sceneKey: string;
  action: RuleActionDefinitionV1;
  actorKey: string;
  targetKey: string | null;
  check: TtrpgRuntimeCheck | null;
  outcome: TtrpgRuntimeRuleActionResultV1["outcome"];
  resourceChanges: TtrpgRuntimeRuleActionResultV1["resourceChanges"];
  conditionChanges: TtrpgRuntimeRuleActionResultV1["conditionChanges"];
  abilityChange: NonNullable<
    TtrpgRuntimeRuleActionResultV1["abilityChange"]
  >;
  nextActorKey: string | null;
  nextRound: number;
  declaredIntent?: {
    intentKey: string;
    rawInput: string;
    goal: string | null;
    method: string | null;
  } | null;
  participantControllers?: Record<string, "human" | "ai" | "hybrid" | "vacant">;
}): TtrpgRuntimeActionReceiptV2 {
  const runtime = input.state.ttrpg ?? fail("运行时缺少 TTRPG 状态");
  const product = runtime.product ?? fail("运行时缺少正式 TTRPG 产品状态");
  const scene =
    input.campaign.scenes.find((item) => item.sceneKey === input.sceneKey) ??
    fail("当前场景不在 CampaignPack");
  const actor =
    input.campaign.characterTemplates.find(
      (item) => item.characterKey === input.actorKey,
    ) ?? fail("行动者不在 CampaignPack");
  const participantKeys = runtime.turnOrder;
  const affectedKeys = new Set([
    ...input.resourceChanges.map((change) => change.entityKey),
    ...input.conditionChanges.map((change) => change.entityKey),
  ]);
  const clueRelevant = input.campaign.clues.some((clue) =>
    clue.discoveryPaths.some(
      (path) =>
        path.sceneKey === scene.sceneKey && path.actionKey === input.action.key,
    ),
  );
  const criticalityReasons: string[] = [];
  if (
    input.action.target === "single-enemy" ||
    input.action.effects.some((effect) => effect.kind === "damage")
  ) {
    criticalityReasons.push("行动可能直接改变另一角色的生存资源");
  }
  if (input.action.effects.some((effect) => effect.kind === "condition"))
    criticalityReasons.push("行动可能施加或移除持续状态");
  if (clueRelevant) criticalityReasons.push("行动命中当前场景的线索发现路径");
  if (input.check) criticalityReasons.push("行动包含正式规则检定");
  const criticality: TtrpgRuntimeActionContextV2["criticality"] =
    criticalityReasons.some((reason) => /生存|持续状态|线索/u.test(reason))
      ? "critical"
      : input.check || input.resourceChanges.length
        ? "meaningful"
        : "routine";

  const observers: TtrpgRuntimeActionObserverV2[] = participantKeys.map(
    (actorKey) => {
      const template =
        input.campaign.characterTemplates.find(
          (item) => item.characterKey === actorKey,
        ) ?? fail(`场景参与者不在 CampaignPack:${actorKey}`);
      const relation: TtrpgRuntimeActionObserverV2["relation"] =
        actorKey === input.actorKey
          ? "actor"
          : actorKey === input.targetKey
            ? "target"
            : affectedKeys.has(actorKey)
              ? "direct-effect"
              : "scene-witness";
      const relevance: TtrpgRuntimeActionObserverV2["relevance"] =
        relation === "actor" || relation === "target"
          ? "primary"
          : relation === "direct-effect" || criticality === "critical"
            ? "relevant"
            : "ambient";
      const controller = resolveTtrpgCharacterControllerV2(
        template,
        input.participantControllers?.[actorKey],
      );
      const reasons =
        relation === "actor"
          ? ["该角色发起了行动"]
          : relation === "target"
            ? ["该角色是行动的直接目标"]
            : relation === "direct-effect"
              ? ["该角色的资源或状态被规则效果改变"]
              : criticality === "critical"
                ? ["该角色在场且行动对当前局势具有关键影响"]
                : ["该角色在当前场景中目击行动"];
      return {
        actorKey,
        role: template.role,
        controller,
        relation,
        relevance,
        present: true,
        responsePolicy: responsePolicy({
          actorKey,
          actingActorKey: input.actorKey,
          controller,
        }),
        reasons,
      };
    },
  );

  const reactionActors = observers.filter((observer) => {
    if (observer.actorKey === input.actorKey) return false;
    const template = input.campaign.characterTemplates.find(
      (item) => item.characterKey === observer.actorKey,
    )!;
    const budget = product.actionEconomy?.budgets[observer.actorKey];
    return (
      (budget?.reactionsRemaining ?? 0) > 0 &&
      input.rulePack.actions.some(
        (action) =>
          action.phase === "reaction" &&
          scene.actionKeys.includes(action.key) &&
          grantedActions({
            state: input.state,
            template,
            rulePack: input.rulePack,
          }).has(action.key),
      )
    );
  });
  const relevantResponders = observers.filter(
    (observer) =>
      observer.actorKey !== input.actorKey && observer.relevance !== "ambient",
  );
  const humanConfirmationRequiredActorKeys = (
    values: TtrpgRuntimeActionObserverV2[],
  ) =>
    values
      .filter((observer) => observer.responsePolicy === "prompt-human")
      .map((observer) => observer.actorKey);
  const reactionWindows = [
    {
      layer: "mechanical-reaction" as const,
      status: reactionActors.length ? ("open" as const) : ("closed" as const),
      eligibleActorKeys: reactionActors.map((observer) => observer.actorKey),
      humanConfirmationRequiredActorKeys:
        humanConfirmationRequiredActorKeys(reactionActors),
      reason: reactionActors.length
        ? "在场角色拥有可用的反应行动与剩余反应预算。"
        : "没有在场角色同时满足反应行动与预算条件。",
    },
    {
      layer: "immediate-character" as const,
      status: relevantResponders.length
        ? ("advisory" as const)
        : ("closed" as const),
      eligibleActorKeys: relevantResponders.map(
        (observer) => observer.actorKey,
      ),
      humanConfirmationRequiredActorKeys:
        humanConfirmationRequiredActorKeys(relevantResponders),
      reason: relevantResponders.length
        ? "直接目标、受影响者和关键行动的在场目击者可给出角色反应。"
        : "本行动没有需要额外角色反馈的相关观察者。",
    },
    {
      layer: "scene-consequence" as const,
      status: "advisory" as const,
      eligibleActorKeys: [],
      humanConfirmationRequiredActorKeys: [],
      reason: "KP 依据已提交结果、当前场景和失败前进原则判断局势变化。",
    },
    {
      layer: "campaign-consequence" as const,
      status:
        criticality === "critical"
          ? ("advisory" as const)
          : ("closed" as const),
      eligibleActorKeys: [],
      humanConfirmationRequiredActorKeys: [],
      reason:
        criticality === "critical"
          ? "该行动可能影响任务、阵营、Clock 或后续场景，但须由正式命令另行提交。"
          : "本次行动不直接产生战役层持久变化。",
    },
  ];
  const reactionActorKeys = new Set(
    reactionActors.map((observer) => observer.actorKey),
  );
  const reactionCandidates: TtrpgRuntimeReactionCandidateV2[] =
    relevantResponders.map((observer) => {
      const template = input.campaign.characterTemplates.find(
        (item) => item.characterKey === observer.actorKey,
      )!;
      const actorName =
        input.state.entities[observer.actorKey]?.name ?? template.name;
      const reactionActionKey = reactionActorKeys.has(observer.actorKey)
        ? (input.rulePack.actions.find(
            (candidate) =>
              candidate.phase === "reaction" &&
              scene.actionKeys.includes(candidate.key) &&
              grantedActions({
                state: input.state,
                template,
                rulePack: input.rulePack,
              }).has(candidate.key),
          )?.key ?? null)
        : null;
      if (observer.responsePolicy === "prompt-human") {
        return {
          actorKey: observer.actorKey,
          responsePolicy: observer.responsePolicy,
          visibleFacts: [
            `${actorName}在当前场景中观察到了「${input.action.name}」的可见结果。`,
          ],
          motivation: "真人玩家保留角色发言、内心、资源和移动的全部决定权。",
          reactionType: "prompt-human",
          proposedActionKey: reactionActionKey,
          targetKey: input.actorKey,
          rulePrerequisites: reactionActionKey
            ? ["等待该真人明确确认是否消耗反应与相关资源。"]
            : ["等待该真人决定是否给出非机械角色反馈。"],
          publicReactionText: null,
          visibility: "player-private",
          reasonIfNoReaction: "系统与 KP 不得代演该真人角色。",
        };
      }
      const threatenedSecret = clueRelevant && template.role === "npc";
      const motivation =
        template.role === "npc"
          ? [
              template.gmProfile?.objective,
              template.gmProfile?.leverage,
              template.gmProfile?.escalation,
            ]
              .filter(Boolean)
              .join("；") || template.description
          : [template.playerProfile?.privateGoal, template.playerProfile?.portrayal]
              .filter(Boolean)
              .join("；") || template.description;
      const automatic =
        observer.responsePolicy === "gm-eligible" ||
        observer.responsePolicy === "ai-eligible";
      return {
        actorKey: observer.actorKey,
        responsePolicy: observer.responsePolicy,
        visibleFacts: [
          `${actorName}在当前场景中观察到了「${input.action.name}」的可见结果。`,
          ...(input.targetKey === observer.actorKey
            ? ["该角色是行动的直接目标。"]
            : []),
        ],
        motivation,
        reactionType: threatenedSecret
          ? "conceal-or-block"
          : reactionActionKey
            ? "assist"
            : "observe",
        proposedActionKey: reactionActionKey,
        targetKey: input.actorKey,
        rulePrerequisites: reactionActionKey
          ? ["规则行动、目标、反应预算与资源必须再次通过 RulePack 裁决。"]
          : ["当前没有自动提交的机械反应；这里只生成角色反应候选。"],
        publicReactionText: automatic
          ? threatenedSecret
            ? `${actorName}察觉调查触及自己关切的资料，立即收拢现场物件，并显露出转移话题或阻止继续翻查的意图。`
            : `${actorName}根据自己在场看到的结果调整了姿态；任何机械介入仍须另行裁决。`
          : null,
        visibility: automatic ? "gm-only" : "player-private",
        reasonIfNoReaction: automatic
          ? null
          : `响应权限为 ${observer.responsePolicy}，不允许自动代演。`,
      };
    });
  const actorItems = ownedItems(input.state, input.actorKey);
  const grantingItemInstanceIds = actorItems
    .filter((item) =>
      input.rulePack.items
        .find((definition) => definition.key === item.definitionRef)
        ?.grantedActionKeys.includes(input.action.key),
    )
    .map((item) => item.itemInstanceId);
  const discoveredConclusionKeys = product.discoveredClues.flatMap(
    (discovery) => {
      const clue = input.campaign.clues.find(
        (item) => item.clueKey === discovery.clueKey,
      );
      return clue ? [clue.conclusionKey] : [];
    },
  );
  const nextTemplate =
    input.nextActorKey == null
      ? null
      : (input.campaign.characterTemplates.find(
          (item) => item.characterKey === input.nextActorKey,
        ) ?? null);
  const suggestedNextActionKeys =
    nextTemplate == null
      ? []
      : scene.actionKeys
          .filter((actionKey) =>
            grantedActions({
              state: input.state,
              template: nextTemplate,
              rulePack: input.rulePack,
            }).has(actionKey),
          )
          .slice(0, 8);
  const changedEntityKeys = [...new Set([...affectedKeys])];
  const checkSummary = input.check
    ? `检定 ${input.check.dice.join(" + ")}${input.check.modifier === 0 ? "" : input.check.modifier > 0 ? ` + ${input.check.modifier}` : ` - ${Math.abs(input.check.modifier)}`} = ${input.check.total}，难度 ${input.check.dc}`
    : "该行动无需掷骰";
  const actorName = input.state.entities[input.actorKey]?.name ?? actor.name;
  const targetName =
    input.targetKey == null
      ? null
      : (input.state.entities[input.targetKey]?.name ?? input.targetKey);
  const failForwardAvailable =
    !!input.check && !input.check.success && !!scene.failureForward;
  const context: TtrpgRuntimeActionContextV2 = {
    schema: "storyforge.ttrpg-action-context",
    version: 2,
    sceneKey: scene.sceneKey,
    sceneSnapshot: {
      title: scene.title,
      description: scene.description,
      locationKey: scene.locationKey,
      failureForward: scene.failureForward,
      gmSecret: scene.gmSecret,
    },
    round: runtime.round,
    activeActorKey: runtime.activeActorKey ?? input.actorKey,
    actorKey: input.actorKey,
    actorController: resolveTtrpgCharacterControllerV2(
      actor,
      input.participantControllers?.[input.actorKey],
    ),
    targetKey: input.targetKey,
    actionKey: input.action.key,
    actionPhase: input.action.phase,
    ...(input.declaredIntent ? { declaredIntent: input.declaredIntent } : {}),
    checkSnapshot: input.check?.rule
      ? {
          checkKey: input.check.rule.checkKey,
          attributeKey: input.check.rule.attributeKey,
          attributeValue: Number(
            input.state.entities[input.actorKey]?.attributes[
              input.check.rule.attributeKey
            ],
          ),
          ...(input.check.rule.skillKey == null
            ? {}
            : {
                skillKey: input.check.rule.skillKey,
                skillValue: input.check.rule.skillValue ?? 0,
              }),
          diceModelKey: input.check.rule.diceModelKey,
          difficulty: input.check.dc,
        }
      : null,
    criticality,
    criticalityReasons,
    actorConditionKeys: (product.conditions[input.actorKey] ?? []).map(
      (condition) => condition.conditionKey,
    ),
    actorInventoryInstanceIds: actorItems.map((item) => item.itemInstanceId),
    grantingItemInstanceIds,
    abilityStateKey: input.abilityChange.stateKey,
    abilityUsesBefore: input.abilityChange.before.remainingUses,
    abilityCooldownBefore: Math.max(
      0,
      (input.abilityChange.before.cooldownUntilRound ?? runtime.round) -
        runtime.round,
    ),
    activeQuestKeys: product.questProgress
      .filter((quest) => quest.status === "active")
      .map((quest) => quest.questKey),
    discoveredConclusionKeys: [...new Set(discoveredConclusionKeys)],
    observers,
    reactionWindows,
    reactionCandidates,
  };
  return {
    schema: "storyforge.ttrpg-action-receipt",
    version: 2,
    receiptKey: `action-receipt.${input.sequence}`,
    actionSequence: input.sequence,
    terminalStatus: input.check ? "resolved-check" : "resolved-no-roll",
    context,
    mechanicalSummary: `${actorName}执行「${input.action.name}」：${degreeLabel(input.outcome)}；${checkSummary}。`,
    actorConsequence: changedEntityKeys.includes(input.actorKey)
      ? `${actorName}自身的资源或状态已按规则更新。`
      : `${actorName}的行动次数、冷却与行动经济已按规则记录。`,
    sceneConsequence: targetName
      ? `行动直接影响${targetName}；其他反应只可来自当前场景中的相关角色。`
      : `行动作用于当前场景；KP 可依据结果描述局势，但不能改写已提交的规则结果。`,
    worldConsequence:
      "本行动不会直接修改世界 Canon；任何长期事实、奖励、惩罚、关系或 Clock 变化必须另行提交 EffectPlan。",
    failForwardAvailable,
    changedEntityKeys,
    suggestedNextActionKeys,
    nextActorKey: input.nextActorKey,
    nextRound: input.nextRound,
  };
}

function parseObserver(
  value: unknown,
  label: string,
): TtrpgRuntimeActionObserverV2 {
  const row = object(value, label);
  exact(
    row,
    [
      "actorKey",
      "role",
      "controller",
      "relation",
      "relevance",
      "present",
      "responsePolicy",
      "reasons",
    ],
    label,
  );
  if (row.present !== true) fail(`${label}.present 必须为 true`);
  return {
    actorKey: key(row.actorKey, `${label}.actorKey`),
    role: enumValue(row.role, ["player", "npc"] as const, `${label}.role`),
    controller: enumValue(
      row.controller,
      ["human", "ai", "hybrid", "vacant", "gm"] as const,
      `${label}.controller`,
    ),
    relation: enumValue(
      row.relation,
      ["actor", "target", "direct-effect", "scene-witness"] as const,
      `${label}.relation`,
    ),
    relevance: enumValue(
      row.relevance,
      ["primary", "relevant", "ambient"] as const,
      `${label}.relevance`,
    ),
    present: true,
    responsePolicy: enumValue(
      row.responsePolicy,
      [
        "actor-owned",
        "prompt-human",
        "ai-eligible",
        "gm-eligible",
        "observe-only",
      ] as const,
      `${label}.responsePolicy`,
    ),
    reasons: textArray(row.reasons, `${label}.reasons`, 16),
  };
}

function parseReactionWindow(value: unknown, label: string) {
  const row = object(value, label);
  exact(
    row,
    [
      "layer",
      "status",
      "eligibleActorKeys",
      "humanConfirmationRequiredActorKeys",
      "reason",
    ],
    label,
  );
  const eligibleActorKeys = keyArray(
    row.eligibleActorKeys,
    `${label}.eligibleActorKeys`,
  );
  const humanConfirmationRequiredActorKeys = keyArray(
    row.humanConfirmationRequiredActorKeys,
    `${label}.humanConfirmationRequiredActorKeys`,
  );
  if (
    humanConfirmationRequiredActorKeys.some(
      (actorKey) => !eligibleActorKeys.includes(actorKey),
    )
  ) {
    fail(`${label}真人确认角色必须属于可响应角色`);
  }
  return {
    layer: enumValue(
      row.layer,
      [
        "mechanical-reaction",
        "immediate-character",
        "scene-consequence",
        "campaign-consequence",
      ] as const,
      `${label}.layer`,
    ),
    status: enumValue(
      row.status,
      ["open", "advisory", "closed"] as const,
      `${label}.status`,
    ),
    eligibleActorKeys,
    humanConfirmationRequiredActorKeys,
    reason: text(row.reason, `${label}.reason`, 2_000),
  };
}

function parseReactionCandidate(
  value: unknown,
  label: string,
): TtrpgRuntimeReactionCandidateV2 {
  const row = object(value, label);
  exact(
    row,
    [
      "actorKey",
      "responsePolicy",
      "visibleFacts",
      "motivation",
      "reactionType",
      "proposedActionKey",
      "targetKey",
      "rulePrerequisites",
      "publicReactionText",
      "visibility",
      "reasonIfNoReaction",
    ],
    label,
  );
  const responsePolicy = enumValue(
    row.responsePolicy,
    [
      "actor-owned",
      "prompt-human",
      "ai-eligible",
      "gm-eligible",
      "observe-only",
    ] as const,
    `${label}.responsePolicy`,
  );
  const publicReactionText =
    row.publicReactionText == null
      ? null
      : text(row.publicReactionText, `${label}.publicReactionText`, 4_000);
  if (responsePolicy === "prompt-human" && publicReactionText != null)
    fail(`${label}不得代演真人角色`);
  if (
    (responsePolicy === "ai-eligible" || responsePolicy === "gm-eligible") &&
    publicReactionText == null
  )
    fail(`${label}自动/主持角色缺少可观察反应候选`);
  return {
    actorKey: key(row.actorKey, `${label}.actorKey`),
    responsePolicy,
    visibleFacts: textArray(row.visibleFacts, `${label}.visibleFacts`, 16),
    motivation: text(row.motivation, `${label}.motivation`, 4_000),
    reactionType: enumValue(
      row.reactionType,
      [
        "conceal-or-block",
        "assist",
        "withdraw",
        "observe",
        "prompt-human",
      ] as const,
      `${label}.reactionType`,
    ),
    proposedActionKey:
      row.proposedActionKey == null
        ? null
        : key(row.proposedActionKey, `${label}.proposedActionKey`),
    targetKey:
      row.targetKey == null ? null : key(row.targetKey, `${label}.targetKey`),
    rulePrerequisites: textArray(
      row.rulePrerequisites,
      `${label}.rulePrerequisites`,
      16,
    ),
    publicReactionText,
    visibility: enumValue(
      row.visibility,
      ["public", "player-private", "gm-only"] as const,
      `${label}.visibility`,
    ),
    reasonIfNoReaction:
      row.reasonIfNoReaction == null
        ? null
        : text(row.reasonIfNoReaction, `${label}.reasonIfNoReaction`, 2_000),
  };
}

export function parseTtrpgActionReceiptV2(
  value: unknown,
): TtrpgRuntimeActionReceiptV2 {
  const row = object(value, "ActionReceipt");
  exact(
    row,
    [
      "schema",
      "version",
      "receiptKey",
      "actionSequence",
      "terminalStatus",
      "context",
      "mechanicalSummary",
      "actorConsequence",
      "sceneConsequence",
      "worldConsequence",
      "failForwardAvailable",
      "changedEntityKeys",
      "suggestedNextActionKeys",
      "nextActorKey",
      "nextRound",
    ],
    "ActionReceipt",
  );
  if (
    row.schema !== "storyforge.ttrpg-action-receipt" ||
    row.version !== 2 ||
    !["resolved", "resolved-no-roll", "resolved-check"].includes(
      String(row.terminalStatus),
    )
  ) {
    fail("ActionReceipt schema/version/terminalStatus 无效");
  }
  const actionSequence = integer(
    row.actionSequence,
    "ActionReceipt.actionSequence",
    1,
  );
  const contextRow = object(row.context, "ActionContext");
  const contextFields = [
    "schema",
    "version",
    "sceneKey",
    "round",
    "activeActorKey",
    "actorKey",
    "actorController",
    "targetKey",
    "actionKey",
    "actionPhase",
    "criticality",
    "criticalityReasons",
    "actorConditionKeys",
    "actorInventoryInstanceIds",
    "grantingItemInstanceIds",
    "abilityStateKey",
    "abilityUsesBefore",
    "abilityCooldownBefore",
    "activeQuestKeys",
    "discoveredConclusionKeys",
    "observers",
    "reactionWindows",
  ];
  if (Object.prototype.hasOwnProperty.call(contextRow, "sceneSnapshot"))
    contextFields.push("sceneSnapshot");
  if (Object.prototype.hasOwnProperty.call(contextRow, "checkSnapshot"))
    contextFields.push("checkSnapshot");
  if (Object.prototype.hasOwnProperty.call(contextRow, "declaredIntent"))
    contextFields.push("declaredIntent");
  if (Object.prototype.hasOwnProperty.call(contextRow, "reactionCandidates"))
    contextFields.push("reactionCandidates");
  exact(
    contextRow,
    contextFields,
    "ActionContext",
  );
  if (
    contextRow.schema !== "storyforge.ttrpg-action-context" ||
    contextRow.version !== 2
  )
    fail("ActionContext schema/version 无效");
  if (
    !Array.isArray(contextRow.observers) ||
    !Array.isArray(contextRow.reactionWindows)
  )
    fail("ActionContext 观察者/反应窗口无效");
  const observers = contextRow.observers.map((item, index) =>
    parseObserver(item, `ActionContext.observers[${index}]`),
  );
  const reactionWindows = contextRow.reactionWindows.map((item, index) =>
    parseReactionWindow(item, `ActionContext.reactionWindows[${index}]`),
  );
  const reactionCandidates = Array.isArray(contextRow.reactionCandidates)
    ? contextRow.reactionCandidates.map((item, index) =>
        parseReactionCandidate(
          item,
          `ActionContext.reactionCandidates[${index}]`,
        ),
      )
    : undefined;
  if (
    reactionWindows.length !== 4 ||
    new Set(reactionWindows.map((item) => item.layer)).size !== 4
  )
    fail("ActionContext 必须包含四层唯一反应窗口");
  const actorKey = key(contextRow.actorKey, "ActionContext.actorKey");
  if (
    !observers.some(
      (observer) =>
        observer.actorKey === actorKey && observer.relation === "actor",
    )
  )
    fail("ActionContext 缺少行动者观察记录");
  if (reactionCandidates) {
    const relevantObservers = new Map(
      observers
        .filter(
          (observer) =>
            observer.actorKey !== actorKey && observer.relevance !== "ambient",
        )
        .map((observer) => [observer.actorKey, observer]),
    );
    if (
      reactionCandidates.length !== relevantObservers.size ||
      new Set(reactionCandidates.map((candidate) => candidate.actorKey)).size !==
        reactionCandidates.length ||
      reactionCandidates.some(
        (candidate) =>
          relevantObservers.get(candidate.actorKey)?.responsePolicy !==
          candidate.responsePolicy,
      )
    ) {
      fail("ActionContext 反应候选必须恰好覆盖全部相关在场观察者且保持权限");
    }
  }
  const abilityUsesBefore =
    contextRow.abilityUsesBefore == null
      ? null
      : integer(
          contextRow.abilityUsesBefore,
          "ActionContext.abilityUsesBefore",
        );
  const targetKey =
    contextRow.targetKey == null
      ? null
      : key(contextRow.targetKey, "ActionContext.targetKey");
  const nextActorKey =
    row.nextActorKey == null
      ? null
      : key(row.nextActorKey, "ActionReceipt.nextActorKey");
  const declaredIntent =
    contextRow.declaredIntent == null
      ? undefined
      : (() => {
          const intent = object(
            contextRow.declaredIntent,
            "ActionContext.declaredIntent",
          );
          exact(
            intent,
            ["intentKey", "rawInput", "goal", "method"],
            "ActionContext.declaredIntent",
          );
          return {
            intentKey: key(
              intent.intentKey,
              "ActionContext.declaredIntent.intentKey",
            ),
            rawInput: text(
              intent.rawInput,
              "ActionContext.declaredIntent.rawInput",
              10_000,
            ),
            goal:
              intent.goal == null
                ? null
                : text(intent.goal, "ActionContext.declaredIntent.goal", 2_000),
            method:
              intent.method == null
                ? null
                : text(
                    intent.method,
                    "ActionContext.declaredIntent.method",
                    2_000,
                  ),
          };
        })();
  const sceneSnapshot = contextRow.sceneSnapshot == null
    ? undefined
    : (() => {
        const snapshot = object(contextRow.sceneSnapshot, "ActionContext.sceneSnapshot");
        exact(
          snapshot,
          ["title", "description", "locationKey", "failureForward", "gmSecret"],
          "ActionContext.sceneSnapshot",
        );
        return {
          title: text(snapshot.title, "ActionContext.sceneSnapshot.title", 300),
          description: text(snapshot.description, "ActionContext.sceneSnapshot.description", 20_000),
          locationKey:
            snapshot.locationKey == null
              ? null
              : key(snapshot.locationKey, "ActionContext.sceneSnapshot.locationKey"),
          failureForward: text(snapshot.failureForward, "ActionContext.sceneSnapshot.failureForward", 20_000),
          gmSecret: text(snapshot.gmSecret, "ActionContext.sceneSnapshot.gmSecret", 20_000),
        };
      })();
  const checkSnapshot = contextRow.checkSnapshot == null
    ? null
    : (() => {
        const snapshot = object(contextRow.checkSnapshot, "ActionContext.checkSnapshot");
        exact(
          snapshot,
          [
            "checkKey",
            "attributeKey",
            "attributeValue",
            ...(Object.prototype.hasOwnProperty.call(snapshot, "skillKey")
              ? ["skillKey", "skillValue"]
              : []),
            "diceModelKey",
            "difficulty",
          ],
          "ActionContext.checkSnapshot",
        );
        const skillKey =
          snapshot.skillKey == null
            ? null
            : key(snapshot.skillKey, "ActionContext.checkSnapshot.skillKey");
        const skillValue =
          snapshot.skillValue == null
            ? null
            : finite(
                snapshot.skillValue,
                "ActionContext.checkSnapshot.skillValue",
              );
        if ((skillKey == null) !== (skillValue == null))
          fail("ActionContext.checkSnapshot 技能字段必须成对出现");
        return {
          checkKey: key(snapshot.checkKey, "ActionContext.checkSnapshot.checkKey"),
          attributeKey: key(snapshot.attributeKey, "ActionContext.checkSnapshot.attributeKey"),
          attributeValue: finite(snapshot.attributeValue, "ActionContext.checkSnapshot.attributeValue"),
          ...(skillKey == null
            ? {}
            : { skillKey, skillValue: skillValue as number }),
          diceModelKey: key(snapshot.diceModelKey, "ActionContext.checkSnapshot.diceModelKey"),
          difficulty: integer(snapshot.difficulty, "ActionContext.checkSnapshot.difficulty", 0),
        };
      })();
  if (
    row.receiptKey !== `action-receipt.${actionSequence}` ||
    typeof row.failForwardAvailable !== "boolean"
  )
    fail("ActionReceipt 身份或失败前进字段无效");
  return {
    schema: "storyforge.ttrpg-action-receipt",
    version: 2,
    receiptKey: String(row.receiptKey),
    actionSequence,
    terminalStatus: row.terminalStatus as TtrpgRuntimeActionReceiptV2["terminalStatus"],
    context: {
      schema: "storyforge.ttrpg-action-context",
      version: 2,
      sceneKey: key(contextRow.sceneKey, "ActionContext.sceneKey"),
      ...(sceneSnapshot ? { sceneSnapshot } : {}),
      round: integer(contextRow.round, "ActionContext.round", 1),
      activeActorKey: key(
        contextRow.activeActorKey,
        "ActionContext.activeActorKey",
      ),
      actorKey,
      actorController: enumValue(
        contextRow.actorController,
        ["human", "ai", "hybrid", "vacant", "gm"] as const,
        "ActionContext.actorController",
      ),
      targetKey,
      actionKey: key(contextRow.actionKey, "ActionContext.actionKey"),
      actionPhase: enumValue(
        contextRow.actionPhase,
        ["free", "action", "reaction", "downtime"] as const,
        "ActionContext.actionPhase",
      ),
      ...(declaredIntent ? { declaredIntent } : {}),
      ...(Object.prototype.hasOwnProperty.call(contextRow, "checkSnapshot")
        ? { checkSnapshot }
        : {}),
      criticality: enumValue(
        contextRow.criticality,
        ["routine", "meaningful", "critical"] as const,
        "ActionContext.criticality",
      ),
      criticalityReasons: textArray(
        contextRow.criticalityReasons,
        "ActionContext.criticalityReasons",
        32,
      ),
      actorConditionKeys: keyArray(
        contextRow.actorConditionKeys,
        "ActionContext.actorConditionKeys",
      ),
      actorInventoryInstanceIds: keyArray(
        contextRow.actorInventoryInstanceIds,
        "ActionContext.actorInventoryInstanceIds",
      ),
      grantingItemInstanceIds: keyArray(
        contextRow.grantingItemInstanceIds,
        "ActionContext.grantingItemInstanceIds",
      ),
      abilityStateKey: key(
        contextRow.abilityStateKey,
        "ActionContext.abilityStateKey",
      ),
      abilityUsesBefore,
      abilityCooldownBefore: integer(
        contextRow.abilityCooldownBefore,
        "ActionContext.abilityCooldownBefore",
      ),
      activeQuestKeys: keyArray(
        contextRow.activeQuestKeys,
        "ActionContext.activeQuestKeys",
      ),
      discoveredConclusionKeys: keyArray(
        contextRow.discoveredConclusionKeys,
        "ActionContext.discoveredConclusionKeys",
      ),
      observers,
      reactionWindows,
      ...(reactionCandidates ? { reactionCandidates } : {}),
    },
    mechanicalSummary: text(
      row.mechanicalSummary,
      "ActionReceipt.mechanicalSummary",
    ),
    actorConsequence: text(
      row.actorConsequence,
      "ActionReceipt.actorConsequence",
    ),
    sceneConsequence: text(
      row.sceneConsequence,
      "ActionReceipt.sceneConsequence",
    ),
    worldConsequence: text(
      row.worldConsequence,
      "ActionReceipt.worldConsequence",
    ),
    failForwardAvailable: row.failForwardAvailable,
    changedEntityKeys: keyArray(
      row.changedEntityKeys,
      "ActionReceipt.changedEntityKeys",
    ),
    suggestedNextActionKeys: keyArray(
      row.suggestedNextActionKeys,
      "ActionReceipt.suggestedNextActionKeys",
    ),
    nextActorKey,
    nextRound: integer(row.nextRound, "ActionReceipt.nextRound", 1),
  };
}

export function createDeterministicGmSynthesisFrameV2(
  receipt: TtrpgRuntimeActionReceiptV2,
): TtrpgRuntimeGmSynthesisFrameV2 {
  const candidateByActor = new Map(
    (receipt.context.reactionCandidates ?? []).map((candidate) => [
      candidate.actorKey,
      candidate,
    ]),
  );
  return {
    schema: "storyforge.ttrpg-gm-synthesis-frame",
    version: 2,
    actionSequence: receipt.actionSequence,
    mechanicalOutcome: receipt.mechanicalSummary,
    actorFeedback: receipt.actorConsequence,
    reactions: receipt.context.observers
      .filter(
        (observer) =>
          observer.actorKey !== receipt.context.actorKey &&
          observer.relevance !== "ambient",
      )
      .map((observer) => {
        const candidate = candidateByActor.get(observer.actorKey);
        return {
          actorKey: observer.actorKey,
          responsePolicy: observer.responsePolicy,
          text:
            observer.responsePolicy === "prompt-human" ||
            observer.responsePolicy === "observe-only"
              ? null
              : (candidate?.publicReactionText ??
                "该角色已观察到结果；其具体反应必须遵守角色目标、已知信息和当前场景。"),
        };
      }),
    sceneUpdate: receipt.sceneConsequence,
    worldUpdate: receipt.worldConsequence,
    nextPrompts: receipt.suggestedNextActionKeys.map(
      (actionKey) => `可考虑行动：${actionKey}`,
    ),
  };
}

export function parseTtrpgGmSynthesisFrameV2(
  value: unknown,
  receipt: TtrpgRuntimeActionReceiptV2,
): TtrpgRuntimeGmSynthesisFrameV2 {
  const row = object(value, "GmSynthesisFrame");
  exact(
    row,
    [
      "schema",
      "version",
      "actionSequence",
      "mechanicalOutcome",
      "actorFeedback",
      "reactions",
      "sceneUpdate",
      "worldUpdate",
      "nextPrompts",
    ],
    "GmSynthesisFrame",
  );
  if (
    row.schema !== "storyforge.ttrpg-gm-synthesis-frame" ||
    row.version !== 2 ||
    row.actionSequence !== receipt.actionSequence ||
    !Array.isArray(row.reactions)
  ) {
    fail("GmSynthesisFrame schema/version/行动绑定无效");
  }
  const allowed = new Map(
    receipt.context.observers
      .filter(
        (observer) =>
          observer.actorKey !== receipt.context.actorKey &&
          observer.relevance !== "ambient",
      )
      .map((observer) => [observer.actorKey, observer]),
  );
  const reactions = row.reactions.map((value, index) => {
    const reaction = object(value, `GmSynthesisFrame.reactions[${index}]`);
    exact(
      reaction,
      ["actorKey", "responsePolicy", "text"],
      `GmSynthesisFrame.reactions[${index}]`,
    );
    const actorKey = key(
      reaction.actorKey,
      `GmSynthesisFrame.reactions[${index}].actorKey`,
    );
    const observer =
      allowed.get(actorKey) ??
      fail(`GmSynthesisFrame 包含不在场或不相关角色:${actorKey}`);
    const policy = enumValue(
      reaction.responsePolicy,
      [
        "actor-owned",
        "prompt-human",
        "ai-eligible",
        "gm-eligible",
        "observe-only",
      ] as const,
      `GmSynthesisFrame.reactions[${index}].responsePolicy`,
    );
    if (policy !== observer.responsePolicy)
      fail(`GmSynthesisFrame 试图改变角色响应权限:${actorKey}`);
    const reactionText =
      reaction.text == null
        ? null
        : text(
            reaction.text,
            `GmSynthesisFrame.reactions[${index}].text`,
            4_000,
          );
    if (policy === "prompt-human" && reactionText != null)
      fail(`AI 不得代演真人角色:${actorKey}`);
    if (
      (policy === "ai-eligible" || policy === "gm-eligible") &&
      reactionText == null
    )
      fail(`自动/主持角色缺少结构化反应:${actorKey}`);
    return { actorKey, responsePolicy: policy, text: reactionText };
  });
  if (
    new Set(reactions.map((reaction) => reaction.actorKey)).size !==
      reactions.length ||
    reactions.length !== allowed.size ||
    reactions.some((reaction) => !allowed.has(reaction.actorKey))
  ) {
    fail("GmSynthesisFrame 必须恰好覆盖全部相关在场观察者");
  }
  return {
    schema: "storyforge.ttrpg-gm-synthesis-frame",
    version: 2,
    actionSequence: receipt.actionSequence,
    mechanicalOutcome: text(
      row.mechanicalOutcome,
      "GmSynthesisFrame.mechanicalOutcome",
    ),
    actorFeedback: text(row.actorFeedback, "GmSynthesisFrame.actorFeedback"),
    reactions,
    sceneUpdate: text(row.sceneUpdate, "GmSynthesisFrame.sceneUpdate"),
    worldUpdate: text(row.worldUpdate, "GmSynthesisFrame.worldUpdate"),
    nextPrompts: textArray(row.nextPrompts, "GmSynthesisFrame.nextPrompts", 8),
  };
}
