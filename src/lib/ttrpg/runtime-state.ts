/** TTRPG-owned runtime state parsing and deterministic reducers. */
import type { RuleCheckResolutionV1 } from "./rule-pack";
import { assertProductRuntimeIntegerV1 as assertFiniteInteger, isProductRuntimeJsonObjectV1 as isObject } from "../product/runtime-values";
import { assertTtrpgDiceRollTraceV2 } from "./dice";
import { parseProductRuntimeDiceExpressionV1 } from "../product/runtime-dice";
import { parseTtrpgAbilityRuntimeStateV2, parseTtrpgUsagePoolStateV2, ttrpgAbilityStateKeyV2 } from "./ability-ledger";
import { parseTtrpgActionEconomyV2 } from "./action-economy";
import { parseTtrpgActionReceiptV2, parseTtrpgGmSynthesisFrameV2 } from "./action-feedback";
import { parseTtrpgEffectLedgerStateV2 } from "./effect-runtime";
import { parseTtrpgInventoryStateV2 } from "./item-ledger";
import { type TtrpgRuntimeScene, type TtrpgRuntimeAction, type TtrpgRuntimeCheck, type TtrpgDegreeV2, type TtrpgRuntimeIntentReceiptV2, type TtrpgRuntimeHumanResponseV2, type TtrpgRuntimeRestReceiptV2, type TtrpgRuntimeResource, type TtrpgRuntimeCondition, type TtrpgRuntimeCombatant, type TtrpgRuntimeEncounter, type TtrpgRuntimeAttackResult, type TtrpgRuntimeState, type TtrpgRuntimeModelEvidenceV1, type TtrpgRuntimeTabletopStateV1, type TtrpgCharacterSheetV2, type TtrpgRuntimeItemReceiptV2, type TtrpgRuntimeCampaignState, type TtrpgRuntimeQuest, type TtrpgRuntimeQuestStatus, SIMULATION_TTRPG_QUEST_STATUSES, type TtrpgRuntimeNpcSchedule, type TtrpgRuntimeCampaignSessionV2, type TtrpgRuntimeRosterEntryV2, type TtrpgRuntimeCampaignMemoryV2, type TtrpgRuntimeSupplementReceiptV2, type TtrpgRuntimeWorldEvolutionV2, type TtrpgRuntimeVersionTransitionV2, type ProductRuntimeState, type RuntimeEntityState, type TtrpgRuntimeTurnCandidate, type TtrpgRuntimeCheckRequest } from "../types";

export function isNpcRuntimeEntity(entity: RuntimeEntityState): boolean {
  return entity.kind === "npc" || (entity.kind === "character"
    && (entity.attributes.role === "npc" || entity.attributes.roleWeight === "npc"));
}
export function assertTtrpgScene(value: unknown): TtrpgRuntimeScene {
  if (!isObject(value)) throw new Error("跑团场景必须是对象。");
  const sceneId = String(value.sceneId ?? "").trim();
  const sceneKey =
    value.sceneKey == null ? null : String(value.sceneKey).trim() || null;
  const title = String(value.title ?? "").trim();
  const description = String(value.description ?? "").trim();
  const locationKey =
    value.locationKey == null ? null : String(value.locationKey).trim() || null;
  const status = String(value.status ?? "active");
  if (!sceneId || sceneId.length > 160)
    throw new Error("跑团场景缺少有效 ID。");
  if (
    sceneKey != null &&
    (sceneKey.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(sceneKey))
  ) {
    throw new Error("跑团 Campaign 场景 key 无效。");
  }
  if (!title || title.length > 200) throw new Error("跑团场景标题无效。");
  if (description.length > 8_000) throw new Error("跑团场景描述过长。");
  if (status !== "active" && status !== "resolved")
    throw new Error("跑团场景状态无效。");
  return {
    sceneId,
    sceneKey,
    title,
    description,
    locationKey,
    status: status as TtrpgRuntimeScene["status"],
  };
}

export function assertTtrpgAction(value: unknown): TtrpgRuntimeAction {
  if (!isObject(value)) throw new Error("跑团动作必须是对象。");
  const eventSequence = assertFiniteInteger(
    value.eventSequence,
    "跑团动作事件序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const actorKey = String(value.actorKey ?? "").trim();
  const text = String(value.text ?? "").trim();
  if (!actorKey || actorKey.length > 160)
    throw new Error("跑团动作缺少行动者。");
  if (!text || text.length > 4_000) throw new Error("跑团动作文本无效。");
  return { eventSequence, actorKey, text };
}

export function ttrpgDegreeSucceededV2(
  degree: RuleCheckResolutionV1["degree"],
): boolean {
  return [
    "partial-success",
    "success",
    "hard-success",
    "extreme-success",
    "critical-success",
  ].includes(degree);
}

export function assertTtrpgCheck(value: unknown): TtrpgRuntimeCheck {
  if (!isObject(value)) throw new Error("跑团检定必须是对象。");
  const eventSequence = assertFiniteInteger(
    value.eventSequence,
    "跑团检定事件序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const actorKey = String(value.actorKey ?? "").trim();
  const skill = String(value.skill ?? "").trim();
  const expression = String(value.expression ?? "").trim();
  const dc = assertFiniteInteger(value.dc, "检定难度", 0, 1_000);
  const dice = value.dice;
  if (!actorKey || actorKey.length > 160)
    throw new Error("跑团检定缺少行动者。");
  if (!skill || skill.length > 120) throw new Error("跑团检定技能无效。");
  if (!Array.isArray(dice)) throw new Error("跑团检定缺少骰子结果。");
  const parsed = parseProductRuntimeDiceExpressionV1(expression);
  if (dice.length !== parsed.count)
    throw new Error("跑团检定骰子数量与骰式不一致。");
  const normalizedDice = dice.map((die) =>
    assertFiniteInteger(die, "检定骰子点数", 1, parsed.sides),
  );
  const modifier = Number(value.modifier);
  const total = Number(value.total);
  const success = value.success;
  const visibility =
    value.visibility == null ? "public" : String(value.visibility);
  if (!["public", "gm-only"].includes(visibility)) {
    throw new Error("跑团检定可见性无效。");
  }
  const formalDegree = isObject(value.rule)
    ? String(value.rule.degree ?? "")
    : null;
  const formalMode =
    isObject(value.rule) && value.rule.mode != null
      ? String(value.rule.mode)
      : null;
  if (
    modifier !== parsed.modifier ||
    total !== normalizedDice.reduce((sum, die) => sum + die, modifier)
  ) {
    throw new Error("跑团检定合计与骰式不一致。");
  }
  const expectedSuccess =
    formalMode == null
      ? total >= dc
      : [
          "partial-success",
          "success",
          "hard-success",
          "extreme-success",
          "critical-success",
        ].includes(formalDegree ?? "");
  if (success !== expectedSuccess)
    throw new Error("跑团检定成功状态与合计不一致。");
  let rule: TtrpgRuntimeCheck["rule"] = null;
  if (value.rule != null) {
    if (!isObject(value.rule)) throw new Error("正式规则检定证据必须是对象。");
    const actionKey = String(value.rule.actionKey ?? "").trim();
    const checkKey = String(value.rule.checkKey ?? "").trim();
    const attributeKey = String(value.rule.attributeKey ?? "").trim();
    const skillKey =
      value.rule.skillKey == null ? null : String(value.rule.skillKey).trim();
    const skillValue =
      value.rule.skillValue == null ? null : Number(value.rule.skillValue);
    const diceModelKey = String(value.rule.diceModelKey ?? "").trim();
    const degree = String(value.rule.degree ?? "");
    const mode = value.rule.mode == null ? undefined : String(value.rule.mode);
    const seedCommitment =
      value.rule.seedCommitment == null
        ? null
        : String(value.rule.seedCommitment);
    const nonce = value.rule.nonce == null ? null : String(value.rule.nonce);
    const proofHash = String(value.rule.proofHash ?? "");
    const rulePackContentHash = String(value.rule.rulePackContentHash ?? "");
    if (
      ![actionKey, checkKey, attributeKey, diceModelKey].every((key) =>
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(key),
      )
    ) {
      throw new Error("正式规则检定 key 无效。");
    }
    if (
      (skillKey == null) !== (skillValue == null) ||
      (skillKey != null &&
        (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(skillKey) ||
          !Number.isFinite(skillValue) ||
          Math.abs(skillValue!) > 1_000))
    ) {
      throw new Error("正式规则检定技能证据无效。");
    }
    if (
      ![
        "critical-failure",
        "failure",
        "partial-success",
        "success",
        "hard-success",
        "extreme-success",
        "critical-success",
      ].includes(degree)
    ) {
      throw new Error("正式规则检定结果等级无效。");
    }
    if (
      mode != null &&
      !["total-vs-target", "roll-under", "success-pool", "opposed"].includes(
        mode,
      )
    ) {
      throw new Error("正式规则检定裁决模式无效。");
    }
    if (
      !/^[0-9a-f]{64}$/.test(proofHash) ||
      !/^[0-9a-f]{64}$/.test(rulePackContentHash)
    ) {
      throw new Error("正式规则检定 hash 无效。");
    }
    if (
      (seedCommitment != null && !/^[0-9a-f]{64}$/.test(seedCommitment)) ||
      (nonce != null && (!nonce || nonce.length > 10_000))
    ) {
      throw new Error("正式规则检定承诺证据无效。");
    }
    if (
      !Array.isArray(value.rule.rolledDice) ||
      !Array.isArray(value.rule.keptDice)
    ) {
      throw new Error("正式规则检定骰子证据无效。");
    }
    const rolledDice = value.rule.rolledDice.map((die) =>
      assertFiniteInteger(die, "正式规则原始骰点", 1, 100),
    );
    const keptDice = value.rule.keptDice.map((die) =>
      assertFiniteInteger(die, "正式规则保留骰点", 1, 100),
    );
    if (!keptDice.length || keptDice.some((die) => !rolledDice.includes(die))) {
      throw new Error("正式规则保留骰点不属于原始骰点。");
    }
    const stableKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
    const winnerRef =
      value.rule.winnerRef == null ? null : String(value.rule.winnerRef).trim();
    const tiedRefs = Array.isArray(value.rule.tiedRefs)
      ? value.rule.tiedRefs.map((item) => String(item).trim())
      : [];
    const calculationTrace = Array.isArray(value.rule.calculationTrace)
      ? value.rule.calculationTrace.map((item) => String(item))
      : [];
    if (
      (winnerRef != null && !stableKeyPattern.test(winnerRef)) ||
      tiedRefs.some((item) => !stableKeyPattern.test(item)) ||
      new Set(tiedRefs).size !== tiedRefs.length ||
      calculationTrace.length > 100 ||
      calculationTrace.some((item) => !item || item.length > 500)
    ) {
      throw new Error("正式规则检定裁决轨迹无效。");
    }
    let opponent: NonNullable<TtrpgRuntimeCheck["rule"]>["opponent"] = null;
    if (value.rule.opponent != null) {
      if (!isObject(value.rule.opponent))
        throw new Error("对抗检定目标证据必须是对象。");
      const contestantRef = String(
        value.rule.opponent.contestantRef ?? "",
      ).trim();
      const opponentAttributeKey = String(
        value.rule.opponent.attributeKey ?? "",
      ).trim();
      const opponentDegree = String(value.rule.opponent.degree ?? "");
      if (
        !stableKeyPattern.test(contestantRef) ||
        !stableKeyPattern.test(opponentAttributeKey) ||
        ![
          "critical-failure",
          "failure",
          "partial-success",
          "success",
          "hard-success",
          "extreme-success",
          "critical-success",
        ].includes(opponentDegree) ||
        !/^[0-9a-f]{64}$/.test(String(value.rule.opponent.proofHash ?? ""))
      ) {
        throw new Error("对抗检定目标证据字段无效。");
      }
      if (
        !Array.isArray(value.rule.opponent.rolledDice) ||
        !Array.isArray(value.rule.opponent.keptDice)
      ) {
        throw new Error("对抗检定目标骰子证据无效。");
      }
      const opponentRolledDice = value.rule.opponent.rolledDice.map((die) =>
        assertFiniteInteger(die, "对抗检定目标原始骰点", 1, 100),
      );
      const opponentKeptDice = value.rule.opponent.keptDice.map((die) =>
        assertFiniteInteger(die, "对抗检定目标保留骰点", 1, 100),
      );
      const opponentModifier = Number(value.rule.opponent.attributeModifier);
      const opponentTotal = Number(value.rule.opponent.total);
      if (
        !opponentKeptDice.length ||
        opponentKeptDice.some((die) => !opponentRolledDice.includes(die)) ||
        !Number.isFinite(opponentModifier) ||
        opponentModifier < -1_000 ||
        opponentModifier > 1_000 ||
        opponentTotal !==
          opponentKeptDice.reduce((sum, die) => sum + die, opponentModifier)
      ) {
        throw new Error("对抗检定目标合计证据无效。");
      }
      opponent = {
        contestantRef,
        attributeKey: opponentAttributeKey,
        rolledDice: opponentRolledDice,
        keptDice: opponentKeptDice,
        attributeModifier: opponentModifier,
        total: opponentTotal,
        degree: opponentDegree as TtrpgDegreeV2,
        rollTrace: assertTtrpgDiceRollTraceV2(value.rule.opponent.rollTrace),
        proofHash: String(value.rule.opponent.proofHash),
      };
    }
    if (
      (mode === "opposed" && opponent == null) ||
      (mode !== "opposed" && opponent != null)
    ) {
      throw new Error("正式规则对抗证据与裁决模式不一致。");
    }
    rule = {
      actionKey,
      checkKey,
      attributeKey,
      ...(skillKey == null
        ? {}
        : { skillKey, skillValue: skillValue as number }),
      diceModelKey,
      rolledDice,
      keptDice,
      degree: degree as NonNullable<TtrpgRuntimeCheck["rule"]>["degree"],
      ...(mode == null
        ? {}
        : {
            mode: mode as NonNullable<TtrpgRuntimeCheck["rule"]>["mode"],
            successes:
              value.rule.successes == null
                ? null
                : assertFiniteInteger(
                    value.rule.successes,
                    "正式规则成功数",
                    0,
                    10_000,
                  ),
            winnerRef,
            tiedRefs,
            calculationTrace,
            opponent,
          }),
      rollTrace:
        value.rule.rollTrace == null
          ? null
          : assertTtrpgDiceRollTraceV2(value.rule.rollTrace),
      seedCommitment,
      nonce,
      proofHash,
      rulePackContentHash,
    };
  }
  return {
    eventSequence,
    actorKey,
    skill,
    expression: parsed.normalized,
    dice: normalizedDice,
    modifier,
    total,
    dc,
    success: Boolean(success),
    visibility: visibility as "public" | "gm-only",
    rule,
  };
}

export function assertTtrpgRuleActionResult(
  value: unknown,
): import("../types").TtrpgRuntimeRuleActionResultV1 {
  if (!isObject(value)) throw new Error("正式规则行动结果必须是对象。");
  const eventSequence = assertFiniteInteger(
    value.eventSequence,
    "规则行动事件序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const actionKey = String(value.actionKey ?? "").trim();
  const actionName = String(value.actionName ?? "").trim();
  const actorKey = String(value.actorKey ?? "").trim();
  const targetKey =
    value.targetKey == null ? null : String(value.targetKey).trim() || null;
  const actionPhase =
    value.actionPhase == null
      ? null
      : (String(
          value.actionPhase,
        ) as import("../types").TtrpgRuntimeRuleActionResultV1["actionPhase"]);
  const outcome = String(
    value.outcome ?? "",
  ) as import("../types").TtrpgRuntimeRuleActionResultV1["outcome"];
  if (
    !actionKey ||
    !actionName ||
    !actorKey ||
    (actionPhase != null &&
      !["free", "action", "reaction", "downtime"].includes(actionPhase)) ||
    ![
      "automatic",
      "critical-failure",
      "failure",
      "partial-success",
      "success",
      "hard-success",
      "extreme-success",
      "critical-success",
    ].includes(outcome)
  ) {
    throw new Error("正式规则行动身份或结果无效。");
  }
  const check =
    value.check == null
      ? null
      : assertTtrpgCheck({ ...(value.check as object), eventSequence });
  if (
    !Array.isArray(value.resourceChanges) ||
    !Array.isArray(value.conditionChanges)
  ) {
    throw new Error("正式规则行动效果必须是数组。");
  }
  const resourceChanges = value.resourceChanges.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`规则资源变化 ${index} 无效。`);
    const entityKey = String(raw.entityKey ?? "").trim();
    const resourceKey = String(raw.resourceKey ?? "").trim();
    const before = assertFiniteInteger(
      raw.before,
      "规则资源原值",
      0,
      1_000_000_000,
    );
    const delta = assertFiniteInteger(
      raw.delta,
      "规则资源变化",
      -1_000_000_000,
      1_000_000_000,
    );
    const after = assertFiniteInteger(
      raw.after,
      "规则资源结果",
      0,
      1_000_000_000,
    );
    const maximum = assertFiniteInteger(
      raw.maximum,
      "规则资源上限",
      1,
      1_000_000_000,
    );
    const proofHash = raw.proofHash == null ? null : String(raw.proofHash);
    if (
      !entityKey ||
      !resourceKey ||
      after > maximum ||
      (proofHash != null && !/^[0-9a-f]{64}$/.test(proofHash))
    ) {
      throw new Error(`规则资源变化 ${index} 字段无效。`);
    }
    return { entityKey, resourceKey, before, delta, after, maximum, proofHash };
  });
  const conditionChanges = value.conditionChanges.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`规则状态变化 ${index} 无效。`);
    const entityKey = String(raw.entityKey ?? "").trim();
    const conditionKey = String(raw.conditionKey ?? "").trim();
    const stacks = assertFiniteInteger(raw.stacks, "规则状态层数", 0, 1_000);
    const duration =
      raw.duration == null
        ? null
        : assertFiniteInteger(raw.duration, "规则状态持续时间", 0, 1_000_000);
    if (!entityKey || !conditionKey)
      throw new Error(`规则状态变化 ${index} 字段无效。`);
    return { entityKey, conditionKey, stacks, duration };
  });
  let abilityChange: import("../types").TtrpgRuntimeRuleActionResultV1["abilityChange"] =
    null;
  if (value.abilityChange != null) {
    if (!isObject(value.abilityChange))
      throw new Error("规则能力变化必须是对象。");
    const change = value.abilityChange;
    const stateKey = String(change.stateKey ?? "").trim();
    const before = parseTtrpgAbilityRuntimeStateV2(change.before);
    const after = parseTtrpgAbilityRuntimeStateV2(change.after);
    const sharedPoolKey =
      change.sharedPoolKey == null
        ? null
        : String(change.sharedPoolKey).trim() || null;
    const sharedPoolBefore =
      change.sharedPoolBefore == null
        ? null
        : parseTtrpgUsagePoolStateV2(change.sharedPoolBefore);
    const sharedPoolAfter =
      change.sharedPoolAfter == null
        ? null
        : parseTtrpgUsagePoolStateV2(change.sharedPoolAfter);
    if (
      stateKey !== ttrpgAbilityStateKeyV2(actorKey, actionKey) ||
      before.actorInstanceId !== actorKey ||
      after.actorInstanceId !== actorKey ||
      before.abilityKey !== actionKey ||
      after.abilityKey !== actionKey ||
      (sharedPoolKey == null) !== (sharedPoolBefore == null) ||
      (sharedPoolKey == null) !== (sharedPoolAfter == null) ||
      (sharedPoolKey != null &&
        (sharedPoolBefore?.poolKey !== sharedPoolKey ||
          sharedPoolAfter?.poolKey !== sharedPoolKey))
    ) {
      throw new Error("规则能力变化身份不一致。");
    }
    abilityChange = {
      stateKey,
      before,
      after,
      sharedPoolKey,
      sharedPoolBefore,
      sharedPoolAfter,
    };
  }
  let actorAuthority: import("../types").TtrpgRuntimeRuleActionResultV1["actorAuthority"] =
    null;
  if (value.actorAuthority != null) {
    if (!isObject(value.actorAuthority))
      throw new Error("AI 行动授权必须是对象。");
    const source = String(value.actorAuthority.source ?? "");
    const viewerKey = String(value.actorAuthority.viewerKey ?? "").trim();
    const runId = assertFiniteInteger(
      value.actorAuthority.runId,
      "AI 玩家 Run ID",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const candidateHash = String(value.actorAuthority.candidateHash ?? "");
    const contextManifestHash = String(
      value.actorAuthority.contextManifestHash ?? "",
    );
    const approach = String(value.actorAuthority.approach ?? "")
      .trim()
      .normalize("NFC");
    const spokenIntent =
      value.actorAuthority.spokenIntent == null
        ? null
        : String(value.actorAuthority.spokenIntent).trim().normalize("NFC") ||
          null;
    if (
      ![
        "ai-player",
        "hybrid-confirmed",
        "ai-gm-npc",
        "hybrid-gm-confirmed",
      ].includes(source) ||
      !viewerKey ||
      !/^[0-9a-f]{64}$/.test(candidateHash) ||
      !/^[0-9a-f]{64}$/.test(contextManifestHash) ||
      !approach ||
      approach.length > 4_000 ||
      (spokenIntent?.length ?? 0) > 2_000
    ) {
      throw new Error("AI 行动授权字段无效。");
    }
    actorAuthority = {
      source: source as
        "ai-player" | "hybrid-confirmed" | "ai-gm-npc" | "hybrid-gm-confirmed",
      viewerKey,
      runId,
      candidateHash,
      contextManifestHash,
      approach,
      spokenIntent,
    };
  }
  const receipt =
    value.receipt == null ? null : parseTtrpgActionReceiptV2(value.receipt);
  if (
    receipt &&
    (receipt.actionSequence !== eventSequence ||
      receipt.context.actorKey !== actorKey ||
      receipt.context.targetKey !== targetKey ||
      receipt.context.actionKey !== actionKey ||
      receipt.context.actionPhase !== actionPhase ||
      receipt.nextActorKey !==
        (value.nextActorKey == null
          ? null
          : String(value.nextActorKey).trim() || null) ||
      receipt.nextRound !== Number(value.nextRound))
  ) {
    throw new Error("ActionReceipt 与规则行动结果身份或回合推进不一致。");
  }
  return {
    eventSequence,
    actionKey,
    actionName,
    actorKey,
    targetKey,
    actionPhase,
    outcome,
    check,
    resourceChanges,
    conditionChanges,
    abilityChange,
    actorAuthority,
    receipt,
    nextActorKey:
      value.nextActorKey == null
        ? null
        : String(value.nextActorKey).trim() || null,
    nextRound: assertFiniteInteger(
      value.nextRound,
      "规则行动下一回合",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

export function parseTtrpgIntentReceiptV2(
  value: unknown,
): TtrpgRuntimeIntentReceiptV2 {
  if (
    !isObject(value) ||
    value.schema !== "storyforge.ttrpg-intent-receipt" ||
    value.version !== 2
  ) {
    throw new Error("正式行动意图收据 schema/version 无效。");
  }
  const allowed = [
    "schema",
    "version",
    "receiptKey",
    "eventSequence",
    "intentKey",
    "actorKey",
    "rawInput",
    "proposedActionKey",
    "targetKey",
    "terminalStatus",
    "reason",
    "suggestedActionKeys",
  ];
  if (Object.keys(value).some((field) => !allowed.includes(field))) {
    throw new Error("正式行动意图收据包含未知字段。");
  }
  const eventSequence = assertFiniteInteger(
    value.eventSequence,
    "行动意图事件序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const stable = (raw: unknown, label: string, nullable = false) => {
    if (nullable && raw == null) return null;
    const parsed = String(raw ?? "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(parsed))
      throw new Error(`${label} 无效。`);
    return parsed;
  };
  const receiptKey = stable(value.receiptKey, "行动意图收据 key")!;
  const intentKey = stable(value.intentKey, "行动意图 key")!;
  const actorKey = stable(value.actorKey, "行动意图角色")!;
  const proposedActionKey = stable(
    value.proposedActionKey,
    "行动意图规则行动",
    true,
  );
  const targetKey = stable(value.targetKey, "行动意图目标", true);
  const rawInput = String(value.rawInput ?? "")
    .trim()
    .normalize("NFC");
  const reason = String(value.reason ?? "")
    .trim()
    .normalize("NFC");
  const terminalStatus = String(value.terminalStatus ?? "");
  const suggestedActionKeys = Array.isArray(value.suggestedActionKeys)
    ? value.suggestedActionKeys.map((item) => stable(item, "建议规则行动 key")!)
    : [];
  if (
    receiptKey !== `intent-receipt.${eventSequence}` ||
    !rawInput ||
    rawInput.length > 10_000 ||
    !reason ||
    reason.length > 2_000 ||
    ![
      "needs-clarification",
      "rejected-illegal",
      "interrupted",
      "queued/deferred",
      "cancelled",
    ].includes(terminalStatus) ||
    suggestedActionKeys.length > 32 ||
    new Set(suggestedActionKeys).size !== suggestedActionKeys.length
  ) {
    throw new Error("正式行动意图收据字段无效。");
  }
  return {
    schema: "storyforge.ttrpg-intent-receipt",
    version: 2,
    receiptKey,
    eventSequence,
    intentKey,
    actorKey,
    rawInput,
    proposedActionKey,
    targetKey,
    terminalStatus:
      terminalStatus as TtrpgRuntimeIntentReceiptV2["terminalStatus"],
    reason,
    suggestedActionKeys,
  };
}

export function parseTtrpgHumanResponseV2(
  value: unknown,
): TtrpgRuntimeHumanResponseV2 {
  if (
    !isObject(value) ||
    value.schema !== "storyforge.ttrpg-human-response" ||
    value.version !== 2
  ) {
    throw new Error("真人角色回应 schema/version 无效。");
  }
  const expected = [
    "schema",
    "version",
    "responseKey",
    "eventSequence",
    "actionSequence",
    "actionReceiptKey",
    "actorKey",
    "kind",
    "text",
    "audience",
    "viewerKey",
  ];
  if (Object.keys(value).sort().join(",") !== expected.sort().join(",")) {
    throw new Error("真人角色回应字段不精确。");
  }
  const eventSequence = assertFiniteInteger(
    value.eventSequence,
    "真人回应事件序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const actionSequence = assertFiniteInteger(
    value.actionSequence,
    "真人回应行动序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const stable = (raw: unknown, label: string) => {
    const parsed = String(raw ?? "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(parsed))
      throw new Error(`${label} 无效。`);
    return parsed;
  };
  const responseKey = stable(value.responseKey, "真人回应 key");
  const actionReceiptKey = stable(value.actionReceiptKey, "行动收据 key");
  const actorKey = stable(value.actorKey, "真人回应角色");
  const viewerKey = stable(value.viewerKey, "真人回应 viewer");
  const kind = String(value.kind);
  const audience = String(value.audience);
  const text = String(value.text ?? "")
    .trim()
    .normalize("NFC");
  if (
    responseKey !== `human-response.${actionSequence}.${actorKey}` ||
    !["speak", "act-narratively", "decline"].includes(kind) ||
    !["party", "gm-only"].includes(audience) ||
    !text ||
    text.length > 10_000 ||
    (kind === "decline" && text !== "本角色选择不作额外回应。")
  ) {
    throw new Error("真人角色回应内容无效。");
  }
  return {
    schema: "storyforge.ttrpg-human-response",
    version: 2,
    responseKey,
    eventSequence,
    actionSequence,
    actionReceiptKey,
    actorKey,
    kind: kind as TtrpgRuntimeHumanResponseV2["kind"],
    text,
    audience: audience as TtrpgRuntimeHumanResponseV2["audience"],
    viewerKey,
  };
}

export function parseTtrpgRestReceiptV2(value: unknown): TtrpgRuntimeRestReceiptV2 {
  if (
    !isObject(value) ||
    value.schema !== "storyforge.ttrpg-rest-receipt" ||
    value.version !== 2
  ) {
    throw new Error("正式休息收据 schema/version 无效。");
  }
  const eventSequence = assertFiniteInteger(
    value.eventSequence,
    "休息事件序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const restKey = String(value.restKey ?? "").trim();
  const kind = String(value.kind ?? "");
  const completedBy = String(value.completedBy ?? "").trim();
  const reason = String(value.reason ?? "")
    .trim()
    .normalize("NFC");
  const actorKeys = Array.isArray(value.actorKeys)
    ? value.actorKeys.map((item) => String(item).trim())
    : [];
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(restKey) ||
    !["short-rest", "long-rest"].includes(kind) ||
    !completedBy ||
    !reason ||
    reason.length > 2_000 ||
    !actorKeys.length ||
    actorKeys.some((key) => !key) ||
    new Set(actorKeys).size !== actorKeys.length ||
    !Array.isArray(value.abilityChanges)
  ) {
    throw new Error("正式休息收据字段无效。");
  }
  const abilityChanges = value.abilityChanges.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`休息能力恢复 ${index} 无效。`);
    const stateKey = String(raw.stateKey ?? "").trim();
    const actorKey = String(raw.actorKey ?? "").trim();
    const abilityKey = String(raw.abilityKey ?? "").trim();
    const before = parseTtrpgAbilityRuntimeStateV2(raw.before);
    const after = parseTtrpgAbilityRuntimeStateV2(raw.after);
    if (
      stateKey !== ttrpgAbilityStateKeyV2(actorKey, abilityKey) ||
      before.actorInstanceId !== actorKey ||
      after.actorInstanceId !== actorKey ||
      before.abilityKey !== abilityKey ||
      after.abilityKey !== abilityKey ||
      !actorKeys.includes(actorKey)
    ) {
      throw new Error(`休息能力恢复 ${index} 身份不一致。`);
    }
    return { stateKey, actorKey, abilityKey, before, after };
  });
  if (
    new Set(abilityChanges.map((item) => item.stateKey)).size !==
    abilityChanges.length
  ) {
    throw new Error("正式休息收据包含重复能力状态。");
  }
  return {
    schema: "storyforge.ttrpg-rest-receipt",
    version: 2,
    eventSequence,
    restKey,
    kind: kind as "short-rest" | "long-rest",
    actorKeys,
    completedBy,
    reason,
    abilityChanges,
  };
}

function assertTtrpgResource(value: unknown): TtrpgRuntimeResource {
  if (!isObject(value)) throw new Error("跑团资源必须是对象。");
  const current = assertFiniteInteger(
    value.current,
    "资源当前值",
    0,
    1_000_000_000,
  );
  const maximum = assertFiniteInteger(
    value.maximum,
    "资源上限",
    1,
    1_000_000_000,
  );
  if (current > maximum) throw new Error("资源当前值不能超过上限。");
  return { current, maximum };
}

export function assertTtrpgCondition(value: unknown): TtrpgRuntimeCondition {
  if (!isObject(value)) throw new Error("跑团状态效果必须是对象。");
  const conditionId = String(value.conditionId ?? "").trim();
  const name = String(value.name ?? "").trim();
  const description = String(value.description ?? "").trim();
  const duration =
    value.duration == null
      ? null
      : assertFiniteInteger(value.duration, "状态效果持续回合", 0, 1_000_000);
  const stacks = assertFiniteInteger(
    value.stacks ?? 1,
    "状态效果层数",
    1,
    1_000,
  );
  if (!conditionId || conditionId.length > 160)
    throw new Error("状态效果缺少有效 ID。");
  if (!name || name.length > 120) throw new Error("状态效果名称无效。");
  if (description.length > 2_000) throw new Error("状态效果描述过长。");
  return { conditionId, name, description, duration, stacks };
}

function assertTtrpgCombatant(value: unknown): TtrpgRuntimeCombatant {
  if (!isObject(value)) throw new Error("战斗参与者必须是对象。");
  const entityKey = String(value.entityKey ?? "").trim();
  const initiative = assertFiniteInteger(value.initiative, "先攻值", 0, 1_000);
  const armorClass = assertFiniteInteger(
    value.armorClass,
    "护甲等级",
    0,
    1_000,
  );
  if (!entityKey || entityKey.length > 160)
    throw new Error("战斗参与者缺少实体键。");
  if (!isObject(value.resources)) throw new Error("战斗资源必须是对象。");
  const resources: Record<string, TtrpgRuntimeResource> = {};
  for (const [key, resource] of Object.entries(value.resources)) {
    if (!key.trim() || key.length > 80) throw new Error("战斗资源键无效。");
    resources[key] = assertTtrpgResource(resource);
  }
  if (!resources.hp) throw new Error("战斗参与者必须拥有 hp 资源。");
  if (!Array.isArray(value.conditions))
    throw new Error("战斗状态效果必须是数组。");
  const conditions = value.conditions.map(assertTtrpgCondition);
  if (
    new Set(conditions.map((condition) => condition.conditionId)).size !==
    conditions.length
  ) {
    throw new Error("战斗状态效果不能重复。");
  }
  return { entityKey, initiative, armorClass, resources, conditions };
}

export function assertTtrpgEncounter(value: unknown): TtrpgRuntimeEncounter {
  if (!isObject(value)) throw new Error("跑团遭遇必须是对象。");
  const encounterId = String(value.encounterId ?? "").trim();
  const title = String(value.title ?? "").trim();
  const description = String(value.description ?? "").trim();
  const status = String(value.status ?? "active");
  const round = assertFiniteInteger(
    value.round,
    "战斗回合",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const activeActorKey =
    value.activeActorKey == null
      ? null
      : String(value.activeActorKey).trim() || null;
  if (!encounterId || encounterId.length > 160)
    throw new Error("遭遇缺少有效 ID。");
  if (!title || title.length > 200) throw new Error("遭遇标题无效。");
  if (description.length > 8_000) throw new Error("遭遇描述过长。");
  if (status !== "active" && status !== "resolved")
    throw new Error("遭遇状态无效。");
  if (!Array.isArray(value.turnOrder) || value.turnOrder.length === 0)
    throw new Error("遭遇必须有回合顺序。");
  const turnOrder = value.turnOrder.map((raw) => String(raw).trim());
  if (
    turnOrder.some((key) => !key || key.length > 160) ||
    new Set(turnOrder).size !== turnOrder.length
  ) {
    throw new Error("遭遇回合顺序包含无效或重复参与者。");
  }
  if (activeActorKey != null && !turnOrder.includes(activeActorKey))
    throw new Error("遭遇当前行动者不在回合顺序中。");
  if (!isObject(value.combatants)) throw new Error("遭遇缺少战斗参与者。");
  const combatants: Record<string, TtrpgRuntimeCombatant> = {};
  for (const [key, raw] of Object.entries(value.combatants)) {
    const combatant = assertTtrpgCombatant(raw);
    if (combatant.entityKey !== key)
      throw new Error(`遭遇参与者索引与实体键不一致: ${key}`);
    combatants[key] = combatant;
  }
  if (
    turnOrder.some((key) => !combatants[key]) ||
    Object.keys(combatants).some((key) => !turnOrder.includes(key))
  ) {
    throw new Error("遭遇回合顺序与参与者不一致。");
  }
  return {
    encounterId,
    title,
    description,
    status: status as TtrpgRuntimeEncounter["status"],
    round,
    activeActorKey,
    turnOrder,
    combatants,
  };
}

export function assertTtrpgAttackResult(value: unknown): TtrpgRuntimeAttackResult {
  if (!isObject(value)) throw new Error("攻击结果必须是对象。");
  const actorKey = String(value.actorKey ?? "").trim();
  const targetKey = String(value.targetKey ?? "").trim();
  const attackExpression = String(value.attackExpression ?? "").trim();
  const damageExpression =
    value.damageExpression == null
      ? null
      : String(value.damageExpression).trim() || null;
  const resourceKey = String(value.resourceKey ?? "hp").trim();
  const reason = String(value.reason ?? "").trim();
  if (
    !actorKey ||
    !targetKey ||
    actorKey.length > 160 ||
    targetKey.length > 160
  )
    throw new Error("攻击缺少有效行动者或目标。");
  const attack = parseProductRuntimeDiceExpressionV1(attackExpression);
  const attackDice = value.attackDice;
  if (!Array.isArray(attackDice) || attackDice.length !== attack.count)
    throw new Error("攻击骰子数量与骰式不一致。");
  const normalizedAttackDice = attackDice.map((die) =>
    assertFiniteInteger(die, "攻击骰子点数", 1, attack.sides),
  );
  const attackModifier = Number(value.attackModifier);
  const attackTotal = Number(value.attackTotal);
  const armorClass = assertFiniteInteger(
    value.armorClass,
    "护甲等级",
    0,
    1_000,
  );
  const hit = value.hit;
  if (
    attackModifier !== attack.modifier ||
    attackTotal !==
      normalizedAttackDice.reduce((sum, die) => sum + die, attackModifier)
  ) {
    throw new Error("攻击合计与骰式不一致。");
  }
  if (hit !== attackTotal >= armorClass)
    throw new Error("攻击命中状态与合计不一致。");
  let normalizedDamageExpression: string | null = null;
  let damageDice: number[] = [];
  let damageModifier = 0;
  const damageTotal = Number(value.damageTotal ?? 0);
  if (damageExpression) {
    const damage = parseProductRuntimeDiceExpressionV1(damageExpression);
    if (
      !Array.isArray(value.damageDice) ||
      value.damageDice.length !== damage.count
    )
      throw new Error("伤害骰子数量与骰式不一致。");
    damageDice = value.damageDice.map((die) =>
      assertFiniteInteger(die, "伤害骰子点数", 1, damage.sides),
    );
    damageModifier = Number(value.damageModifier);
    if (
      damageModifier !== damage.modifier ||
      damageTotal !== damageDice.reduce((sum, die) => sum + die, damageModifier)
    ) {
      throw new Error("伤害合计与骰式不一致。");
    }
    if (damageTotal < 0) throw new Error("伤害合计不能为负数。");
    normalizedDamageExpression = damage.normalized;
  } else if (
    damageTotal !== 0 ||
    (Array.isArray(value.damageDice) && value.damageDice.length > 0)
  ) {
    throw new Error("没有伤害骰式时不能提交伤害结果。");
  }
  const resourceDelta = assertFiniteInteger(
    value.resourceDelta,
    "资源变化量",
    -1_000_000_000,
    1_000_000_000,
  );
  if (!hit && (damageTotal !== 0 || resourceDelta !== 0))
    throw new Error("未命中攻击不能造成伤害。");
  if (hit && resourceDelta !== -damageTotal)
    throw new Error("攻击资源变化必须等于伤害负值。");
  if (!resourceKey || resourceKey.length > 80)
    throw new Error("攻击资源键无效。");
  if (reason.length > 2_000) throw new Error("攻击理由过长。");
  return {
    actorKey,
    targetKey,
    attackExpression: attack.normalized,
    attackDice: normalizedAttackDice,
    attackModifier,
    attackTotal,
    armorClass,
    hit: Boolean(hit),
    damageExpression: normalizedDamageExpression,
    damageDice,
    damageModifier,
    damageTotal,
    resourceKey,
    resourceDelta,
    reason,
  };
}

function emptyTtrpgState(): TtrpgRuntimeState {
  return {
    scene: null,
    round: 0,
    activeActorKey: null,
    turnOrder: [],
    actions: [],
    checks: [],
    attacks: [],
    encounter: null,
    campaign: emptyTtrpgCampaignState(),
    product: null,
  };
}

export function parseTtrpgModelEvidenceV1(
  value: unknown,
): TtrpgRuntimeModelEvidenceV1 | null {
  if (value == null) return null;
  if (!isObject(value)) throw new Error("正式 TTRPG 模型调用证据无效。");
  const provider = String(value.provider ?? "").trim();
  const model = String(value.model ?? "").trim();
  const usageSource = String(value.usageSource ?? "");
  const inputTokens = assertFiniteInteger(
    value.inputTokens,
    "AI GM 输入 tokens",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const outputTokens = assertFiniteInteger(
    value.outputTokens,
    "AI GM 输出 tokens",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const totalTokens = assertFiniteInteger(
    value.totalTokens,
    "AI GM 总 tokens",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const latencyMs = assertFiniteInteger(
    value.latencyMs,
    "AI GM 延迟",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const estimatedCostUsd =
    value.estimatedCostUsd == null ? null : Number(value.estimatedCostUsd);
  if (
    !provider ||
    provider.length > 100 ||
    !model ||
    model.length > 200 ||
    !["provider", "estimated"].includes(usageSource) ||
    totalTokens !== inputTokens + outputTokens ||
    (estimatedCostUsd != null &&
      (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0))
  ) {
    throw new Error("正式 TTRPG 模型调用证据字段无效。");
  }
  return {
    provider,
    model,
    usageSource: usageSource as "provider" | "estimated",
    inputTokens,
    outputTokens,
    totalTokens,
    latencyMs,
    estimatedCostUsd,
  };
}

function parseTtrpgTabletopStateV1(
  value: unknown,
): TtrpgRuntimeTabletopStateV1 | null {
  if (value == null) return null;
  if (
    !isObject(value) ||
    !Array.isArray(value.maps) ||
    !Array.isArray(value.tokens) ||
    !Array.isArray(value.visibleLayerKeys) ||
    !Array.isArray(value.revealedFogKeys)
  ) {
    throw new Error("正式 TTRPG 桌面状态无效。");
  }
  const maps = value.maps.map((raw, index) => {
    if (
      !isObject(raw) ||
      !Array.isArray(raw.sceneKeys) ||
      !Array.isArray(raw.publicLayerKeys) ||
      !Array.isArray(raw.gmLayerKeys) ||
      !Array.isArray(raw.areaKeys) ||
      !Array.isArray(raw.gmAreaKeys) ||
      !Array.isArray(raw.fogKeys)
    ) {
      throw new Error(`正式 TTRPG 桌面地图 ${index} 无效。`);
    }
    const mapKey = String(raw.mapKey ?? "").trim();
    const toKeys = (items: unknown[], label: string) => {
      const keys = items.map((item) => String(item).trim());
      if (keys.some((key) => !key) || new Set(keys).size !== keys.length)
        throw new Error(`${label} 无效或重复。`);
      return keys;
    };
    const sceneKeys = toKeys(raw.sceneKeys, "桌面场景索引");
    const publicLayerKeys = toKeys(raw.publicLayerKeys, "桌面公开图层");
    const gmLayerKeys = toKeys(raw.gmLayerKeys, "桌面 GM 图层");
    const areaKeys = toKeys(raw.areaKeys, "桌面公开区域");
    const gmAreaKeys = toKeys(raw.gmAreaKeys, "桌面 GM 区域");
    const fogKeys = toKeys(raw.fogKeys, "桌面迷雾索引");
    if (
      !mapKey ||
      publicLayerKeys.some((key) => gmLayerKeys.includes(key)) ||
      areaKeys.some((key) => gmAreaKeys.includes(key))
    ) {
      throw new Error(`正式 TTRPG 桌面地图 ${index} 字段冲突。`);
    }
    return {
      mapKey,
      sceneKeys,
      width: assertFiniteInteger(raw.width, "桌面地图宽度", 4, 100),
      height: assertFiniteInteger(raw.height, "桌面地图高度", 4, 100),
      publicLayerKeys,
      gmLayerKeys,
      areaKeys,
      gmAreaKeys,
      fogKeys,
    };
  });
  if (
    !maps.length ||
    new Set(maps.map((map) => map.mapKey)).size !== maps.length
  )
    throw new Error("正式 TTRPG 桌面地图索引无效。");
  const knownLayers = new Set(
    maps.flatMap((map) => [...map.publicLayerKeys, ...map.gmLayerKeys]),
  );
  const knownFog = new Set(maps.flatMap((map) => map.fogKeys));
  const visibleLayerKeys = value.visibleLayerKeys.map((item) =>
    String(item).trim(),
  );
  const revealedFogKeys = value.revealedFogKeys.map((item) =>
    String(item).trim(),
  );
  if (
    visibleLayerKeys.some((key) => !knownLayers.has(key)) ||
    new Set(visibleLayerKeys).size !== visibleLayerKeys.length ||
    revealedFogKeys.some((key) => !knownFog.has(key)) ||
    new Set(revealedFogKeys).size !== revealedFogKeys.length
  ) {
    throw new Error("正式 TTRPG 桌面图层或迷雾投影无效。");
  }
  const tokens = value.tokens.map((raw, index) => {
    if (!isObject(raw))
      throw new Error(`正式 TTRPG 桌面 token ${index} 无效。`);
    const tokenKey = String(raw.tokenKey ?? "").trim();
    const entityKey = String(raw.entityKey ?? "").trim();
    const mapKey = String(raw.mapKey ?? "").trim();
    const controllerKey =
      raw.controllerKey == null
        ? null
        : String(raw.controllerKey).trim() || null;
    if (
      !tokenKey ||
      !entityKey ||
      !maps.some((map) => map.mapKey === mapKey) ||
      typeof raw.hidden !== "boolean"
    ) {
      throw new Error(`正式 TTRPG 桌面 token ${index} 字段无效。`);
    }
    return {
      tokenKey,
      entityKey,
      mapKey,
      x: assertFiniteInteger(raw.x, "桌面 token x", 0, 100),
      y: assertFiniteInteger(raw.y, "桌面 token y", 0, 100),
      size: assertFiniteInteger(raw.size, "桌面 token 大小", 1, 20),
      controllerKey,
      hidden: raw.hidden,
    };
  });
  if (new Set(tokens.map((token) => token.tokenKey)).size !== tokens.length)
    throw new Error("正式 TTRPG 桌面 token 重复。");
  const currentMapKey =
    value.currentMapKey == null
      ? null
      : String(value.currentMapKey).trim() || null;
  if (currentMapKey && !maps.some((map) => map.mapKey === currentMapKey))
    throw new Error("正式 TTRPG 当前桌面地图无效。");
  return {
    currentMapKey,
    maps,
    tokens,
    visibleLayerKeys,
    revealedFogKeys,
    updatedAtSequence:
      value.updatedAtSequence == null
        ? null
        : assertFiniteInteger(
            value.updatedAtSequence,
            "桌面更新序号",
            1,
            Number.MAX_SAFE_INTEGER,
          ),
  };
}

function parseTtrpgMediaStateV1(
  value: unknown,
): NonNullable<NonNullable<TtrpgRuntimeState["product"]>["media"]> | null {
  if (value == null) return null;
  if (
    !isObject(value) ||
    !isObject(value.runtimePolicy) ||
    !Array.isArray(value.slots)
  ) {
    throw new Error("正式 TTRPG 媒资状态无效。");
  }
  const visualBibleHash =
    value.visualBibleHash == null ? null : String(value.visualBibleHash);
  if (visualBibleHash != null && !/^[a-f0-9]{64}$/.test(visualBibleHash))
    throw new Error("正式 TTRPG 视觉圣经 hash 无效。");
  const generatedCount = assertFiniteInteger(
    value.generatedCount,
    "运行时已生成媒资数",
    0,
    4_096,
  );
  const policy = value.runtimePolicy;
  if (
    typeof policy.enabled !== "boolean" ||
    !["any", "wifi-only", "disabled"].includes(String(policy.networkPolicy)) ||
    typeof policy.maximumSessionCostUsd !== "number" ||
    !Number.isFinite(policy.maximumSessionCostUsd) ||
    policy.maximumSessionCostUsd < 0 ||
    policy.maximumSessionCostUsd > 10_000 ||
    typeof policy.allowProviderFallback !== "boolean"
  )
    throw new Error("正式 TTRPG 媒资策略无效。");
  const runtimePolicy = {
    enabled: policy.enabled,
    networkPolicy: String(policy.networkPolicy) as
      "any" | "wifi-only" | "disabled",
    maximumSessionCostUsd: policy.maximumSessionCostUsd,
    maximumConcurrentRequests: assertFiniteInteger(
      policy.maximumConcurrentRequests,
      "媒资最大并发",
      1,
      16,
    ),
    maximumAttempts: assertFiniteInteger(
      policy.maximumAttempts,
      "媒资最大重试",
      1,
      10,
    ),
    maximumGeneratedAssets: assertFiniteInteger(
      policy.maximumGeneratedAssets,
      "媒资最大数量",
      0,
      4_096,
    ),
    allowProviderFallback: policy.allowProviderFallback,
  };
  if (!runtimePolicy.enabled && runtimePolicy.maximumGeneratedAssets !== 0)
    throw new Error("禁用媒资策略仍声明生成数量。");
  const slots = value.slots.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`正式 TTRPG 媒资槽 ${index} 无效。`);
    const slotKey = String(raw.slotKey ?? "").trim();
    const targetRef = String(raw.targetRef ?? "").trim();
    const kind = String(raw.kind);
    const audience = String(raw.audience);
    const status = String(raw.status);
    const requestKey =
      raw.requestKey == null ? null : String(raw.requestKey).trim() || null;
    const assetKey =
      raw.assetKey == null ? null : String(raw.assetKey).trim() || null;
    const mediaAssetId =
      raw.mediaAssetId == null
        ? null
        : assertFiniteInteger(
            raw.mediaAssetId,
            "媒资槽资产 ID",
            1,
            Number.MAX_SAFE_INTEGER,
          );
    const mediaAssetVersion =
      raw.mediaAssetVersion == null
        ? null
        : assertFiniteInteger(
            raw.mediaAssetVersion,
            "媒资槽资产版本",
            1,
            Number.MAX_SAFE_INTEGER,
          );
    const mediaContentHash =
      raw.mediaContentHash == null ? null : String(raw.mediaContentHash);
    const lastErrorCode =
      raw.lastErrorCode == null
        ? null
        : String(raw.lastErrorCode).trim() || null;
    const fallbackText = String(raw.fallbackText ?? "").trim();
    const altText = String(raw.altText ?? "").trim();
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(slotKey) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(targetRef) ||
      ![
        "scene",
        "map",
        "character-portrait",
        "character-expression",
        "token",
        "item-icon",
        "handout",
      ].includes(kind) ||
      !["public", "party", "private", "gm-only"].includes(audience) ||
      !["placeholder", "queued", "available", "failed", "cancelled"].includes(
        status,
      ) ||
      !fallbackText ||
      fallbackText.length > 20_000 ||
      !altText ||
      altText.length > 2_000 ||
      (requestKey != null &&
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(requestKey)) ||
      (assetKey != null &&
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(assetKey)) ||
      (mediaContentHash != null && !/^[a-f0-9]{64}$/.test(mediaContentHash)) ||
      (lastErrorCode != null &&
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(lastErrorCode))
    ) {
      throw new Error(`正式 TTRPG 媒资槽 ${index} 字段无效。`);
    }
    if (
      (status === "queued" || status === "failed" || status === "cancelled") &&
      requestKey == null
    ) {
      throw new Error(`正式 TTRPG 媒资槽 ${index} 缺少请求身份。`);
    }
    if (
      mediaAssetId != null &&
      (status !== "available" ||
        mediaAssetVersion == null ||
        mediaContentHash == null ||
        assetKey == null)
    ) {
      throw new Error(`正式 TTRPG 媒资槽 ${index} 动态资产证据不完整。`);
    }
    if (
      mediaAssetId == null &&
      (mediaAssetVersion != null || mediaContentHash != null)
    )
      throw new Error("媒资槽存在悬空动态资产元数据。");
    return {
      slotKey,
      kind: kind as import("../types").TtrpgRuntimeMediaKindV1,
      targetRef,
      audience: audience as import("../types").TtrpgRuntimeMediaAudienceV1,
      fallbackText,
      altText,
      status: status as
        "placeholder" | "queued" | "available" | "failed" | "cancelled",
      requestKey,
      assetKey,
      mediaAssetId,
      mediaAssetVersion,
      mediaContentHash,
      lastErrorCode,
      updatedAtSequence:
        raw.updatedAtSequence == null
          ? null
          : assertFiniteInteger(
              raw.updatedAtSequence,
              "媒资槽更新序号",
              1,
              Number.MAX_SAFE_INTEGER,
            ),
    };
  });
  if (
    new Set(slots.map((slot) => slot.slotKey)).size !== slots.length ||
    generatedCount !==
      slots.filter(
        (slot) => slot.status === "available" && slot.mediaAssetId != null,
      ).length ||
    generatedCount > runtimePolicy.maximumGeneratedAssets
  )
    throw new Error("正式 TTRPG 媒资槽重复或计数不一致。");
  return { visualBibleHash, generatedCount, runtimePolicy, slots };
}

function parseTtrpgProductState(
  value: unknown,
): TtrpgRuntimeState["product"] {
  if (value == null) return null;
  if (
    !isObject(value) ||
    !/^[0-9a-f]{64}$/.test(String(value.rulePackContentHash ?? ""))
  ) {
    throw new Error("正式 TTRPG 产品状态无效。");
  }
  const campaignKey = String(value.campaignKey ?? "").trim();
  const campaignTitle = String(value.campaignTitle ?? "").trim();
  const openingSceneKey = String(value.openingSceneKey ?? "").trim();
  if (!campaignKey || !campaignTitle || !openingSceneKey)
    throw new Error("正式 TTRPG 产品身份不完整。");
  if (
    !isObject(value.sessionZero) ||
    !Array.isArray(value.sessionZero.requiredItemKeys) ||
    !Array.isArray(value.sessionZero.acceptedItemKeys)
  ) {
    throw new Error("正式 TTRPG Session Zero 状态无效。");
  }
  const requiredItemKeys = value.sessionZero.requiredItemKeys.map((item) =>
    String(item).trim(),
  );
  const acceptedItemKeys = value.sessionZero.acceptedItemKeys.map((item) =>
    String(item).trim(),
  );
  const selectedCharacterKeys = Array.isArray(
    value.sessionZero.selectedCharacterKeys,
  )
    ? value.sessionZero.selectedCharacterKeys.map((item) => String(item).trim())
    : [];
  if (
    !requiredItemKeys.length ||
    [...requiredItemKeys, ...acceptedItemKeys].some((item) => !item) ||
    new Set(requiredItemKeys).size !== requiredItemKeys.length ||
    new Set(acceptedItemKeys).size !== acceptedItemKeys.length ||
    selectedCharacterKeys.some((item) => !item) ||
    new Set(selectedCharacterKeys).size !== selectedCharacterKeys.length
  ) {
    throw new Error("Session Zero 确认项无效或重复。");
  }
  const completed = value.sessionZero.completed === true;
  const completedBy =
    value.sessionZero.completedBy == null
      ? null
      : String(value.sessionZero.completedBy).trim() || null;
  const completedAtSequence =
    value.sessionZero.completedAtSequence == null
      ? null
      : assertFiniteInteger(
          value.sessionZero.completedAtSequence,
          "Session Zero 完成序号",
          1,
          Number.MAX_SAFE_INTEGER,
        );
  if (completed !== (completedBy != null && completedAtSequence != null))
    throw new Error("Session Zero 完成状态不一致。");
  const rawSafety = value.safety;
  const safetyStatus = isObject(rawSafety)
    ? String(rawSafety.status ?? "")
    : "active";
  const safetyReason =
    isObject(rawSafety) && rawSafety.reason != null
      ? String(rawSafety.reason).trim() || null
      : null;
  const safetyChangedBy =
    isObject(rawSafety) && rawSafety.changedBy != null
      ? String(rawSafety.changedBy).trim() || null
      : null;
  const safetyChangedAtSequence =
    isObject(rawSafety) && rawSafety.changedAtSequence != null
      ? assertFiniteInteger(
          rawSafety.changedAtSequence,
          "安全状态变更序号",
          1,
          Number.MAX_SAFE_INTEGER,
        )
      : null;
  if (
    !["active", "paused"].includes(safetyStatus) ||
    (safetyChangedAtSequence == null) !== (safetyChangedBy == null) ||
    (safetyStatus === "paused" && !safetyReason)
  ) {
    throw new Error("正式 TTRPG 安全状态无效。");
  }
  const hiddenDicePolicy =
    value.hiddenDicePolicy == null ? "never" : String(value.hiddenDicePolicy);
  if (!["never", "gm-only", "allowed"].includes(hiddenDicePolicy)) {
    throw new Error("正式 TTRPG 暗骰策略无效。");
  }
  if (
    !Array.isArray(value.sceneKeys) ||
    !Array.isArray(value.clueCatalog) ||
    !Array.isArray(value.discoveredClues)
  ) {
    throw new Error("正式 TTRPG 战役索引无效。");
  }
  const sceneKeys = value.sceneKeys.map((item) => String(item).trim());
  if (
    !sceneKeys.length ||
    sceneKeys.some((item) => !item) ||
    new Set(sceneKeys).size !== sceneKeys.length
  ) {
    throw new Error("正式 TTRPG 场景索引无效。");
  }
  const openedSceneKeys = Array.isArray(value.openedSceneKeys)
    ? value.openedSceneKeys.map((item) => String(item).trim())
    : [];
  if (
    openedSceneKeys.some((key) => !sceneKeys.includes(key)) ||
    new Set(openedSceneKeys).size !== openedSceneKeys.length
  ) {
    throw new Error("正式 TTRPG 已开启场景索引无效。");
  }
  const clueCatalog = value.clueCatalog.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`正式 TTRPG 线索索引 ${index} 无效。`);
    const clueKey = String(raw.clueKey ?? "").trim();
    const conclusionKey = String(raw.conclusionKey ?? "").trim();
    const sourceVisibility = String(raw.sourceVisibility ?? "");
    if (
      !clueKey ||
      !conclusionKey ||
      typeof raw.required !== "boolean" ||
      !["gm-only", "discoverable", "public"].includes(sourceVisibility)
    ) {
      throw new Error(`正式 TTRPG 线索索引 ${index} 字段无效。`);
    }
    return {
      clueKey,
      conclusionKey,
      required: raw.required,
      sourceVisibility: sourceVisibility as
        "gm-only" | "discoverable" | "public",
    };
  });
  if (
    new Set(clueCatalog.map((item) => item.clueKey)).size !== clueCatalog.length
  ) {
    throw new Error("正式 TTRPG 线索索引重复。");
  }
  const clockCatalog = (
    Array.isArray(value.clockCatalog) ? value.clockCatalog : []
  ).map((raw, index) => {
    if (!isObject(raw)) throw new Error(`正式 TTRPG Clock ${index} 无效。`);
    const clockKey = String(raw.clockKey ?? "").trim();
    const title = String(raw.title ?? "").trim();
    const visibility = String(raw.visibility ?? "");
    const onComplete = String(raw.onComplete ?? "").trim();
    const initialValue = assertFiniteInteger(
      raw.initialValue,
      "Clock 初值",
      0,
      99,
    );
    const maximum = assertFiniteInteger(raw.maximum, "Clock 上限", 2, 100);
    if (
      !clockKey ||
      !title ||
      !onComplete ||
      initialValue >= maximum ||
      !["gm-only", "party", "public"].includes(visibility)
    ) {
      throw new Error(`正式 TTRPG Clock ${index} 字段无效。`);
    }
    return {
      clockKey,
      title,
      initialValue,
      maximum,
      visibility: visibility as "gm-only" | "party" | "public",
      onComplete,
    };
  });
  if (
    new Set(clockCatalog.map((item) => item.clockKey)).size !==
    clockCatalog.length
  ) {
    throw new Error("正式 TTRPG Clock 索引重复。");
  }
  const discoveredClues = value.discoveredClues.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`已发现线索 ${index} 无效。`);
    const clueKey = String(raw.clueKey ?? "").trim();
    const actorKey = String(raw.actorKey ?? "").trim();
    const visibility = String(raw.visibility ?? "");
    if (!clueKey || !actorKey || !["private", "party"].includes(visibility))
      throw new Error(`已发现线索 ${index} 字段无效。`);
    return {
      clueKey,
      actorKey,
      visibility: visibility as "private" | "party",
      eventSequence: assertFiniteInteger(
        raw.eventSequence,
        "线索发现序号",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    };
  });
  if (
    new Set(discoveredClues.map((item) => item.clueKey)).size !==
    discoveredClues.length
  )
    throw new Error("同一线索不能重复发现。");
  if (
    !isObject(value.conditions) ||
    !Array.isArray(value.actionHistory) ||
    !Array.isArray(value.gmNarrations) ||
    !Array.isArray(value.questProgress) ||
    !Array.isArray(value.endingCatalog) ||
    !isObject(value.advancement)
  ) {
    throw new Error("正式 TTRPG 规则效果状态无效。");
  }
  const conditions: NonNullable<TtrpgRuntimeState["product"]>["conditions"] =
    {};
  for (const [entityKey, rawConditions] of Object.entries(value.conditions)) {
    if (!entityKey || !Array.isArray(rawConditions))
      throw new Error("正式 TTRPG 状态效果索引无效。");
    const parsed = rawConditions.map((raw, index) => {
      if (!isObject(raw))
        throw new Error(`正式 TTRPG 状态效果 ${index} 无效。`);
      const conditionKey = String(raw.conditionKey ?? "").trim();
      if (!conditionKey)
        throw new Error(`正式 TTRPG 状态效果 ${index} key 无效。`);
      return {
        conditionKey,
        stacks: assertFiniteInteger(
          raw.stacks,
          "正式 TTRPG 状态层数",
          1,
          1_000,
        ),
        duration:
          raw.duration == null
            ? null
            : assertFiniteInteger(
                raw.duration,
                "正式 TTRPG 状态时长",
                1,
                1_000_000,
              ),
      };
    });
    if (new Set(parsed.map((item) => item.conditionKey)).size !== parsed.length)
      throw new Error("正式 TTRPG 状态效果重复。");
    conditions[entityKey] = parsed;
  }
  const characterCustomizations = (
    Array.isArray(value.characterCustomizations)
      ? value.characterCustomizations
      : []
  ).map((raw, index) => {
    if (!isObject(raw) || !isObject(raw.attributes))
      throw new Error(`正式 TTRPG 自定义角色 ${index} 无效。`);
    const characterKey = String(raw.characterKey ?? "").trim();
    const name = String(raw.name ?? "").trim();
    const description = String(raw.description ?? "").trim();
    const attributes = Object.fromEntries(
      Object.entries(raw.attributes).map(([key, rawValue]) => {
        const parsed = Number(rawValue);
        if (
          !key.trim() ||
          !Number.isFinite(parsed) ||
          parsed < -1_000_000 ||
          parsed > 1_000_000
        ) {
          throw new Error(`正式 TTRPG 自定义角色 ${index} 属性无效。`);
        }
        return [key.trim(), parsed];
      }),
    );
    if (
      !characterKey ||
      !name ||
      name.length > 300 ||
      !description ||
      description.length > 20_000 ||
      !Object.keys(attributes).length
    )
      throw new Error(`正式 TTRPG 自定义角色 ${index} 字段无效。`);
    if (raw.characterSheet != null && !isObject(raw.characterSheet)) {
      throw new Error(`正式 TTRPG 自定义角色 ${index} 完整角色卡无效。`);
    }
    return {
      characterKey,
      name,
      description,
      attributes,
      ...(raw.characterSheet == null
        ? {}
        : {
            characterSheet: structuredClone(
              raw.characterSheet,
            ) as unknown as TtrpgCharacterSheetV2,
          }),
      customizedAtSequence: assertFiniteInteger(
        raw.customizedAtSequence,
        "角色定制事件序号",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    };
  });
  if (
    new Set(characterCustomizations.map((item) => item.characterKey)).size !==
    characterCustomizations.length
  ) {
    throw new Error("同一正式角色不能存在多份当前定制。");
  }
  const actionHistory = value.actionHistory.map(assertTtrpgRuleActionResult);
  const intentReceipts = (
    Array.isArray(value.intentReceipts) ? value.intentReceipts : []
  ).map(parseTtrpgIntentReceiptV2);
  if (
    new Set(intentReceipts.map((item) => item.intentKey)).size !==
      intentReceipts.length ||
    intentReceipts.some(
      (item, index) =>
        index > 0 &&
        item.eventSequence <= intentReceipts[index - 1].eventSequence,
    )
  ) {
    throw new Error("正式 TTRPG 行动意图收据重复或乱序。");
  }
  const humanResponses = (
    Array.isArray(value.humanResponses) ? value.humanResponses : []
  ).map(parseTtrpgHumanResponseV2);
  if (
    new Set(humanResponses.map((item) => item.responseKey)).size !==
      humanResponses.length ||
    humanResponses.some(
      (item, index) =>
        index > 0 &&
        item.eventSequence <= humanResponses[index - 1].eventSequence,
    )
  ) {
    throw new Error("真人角色回应重复或乱序。");
  }
  const restHistory = (
    Array.isArray(value.restHistory) ? value.restHistory : []
  ).map(parseTtrpgRestReceiptV2);
  if (
    new Set(restHistory.map((item) => item.restKey)).size !==
      restHistory.length ||
    restHistory.some(
      (item, index) =>
        index > 0 && item.eventSequence <= restHistory[index - 1].eventSequence,
    )
  ) {
    throw new Error("正式 TTRPG 休息账本重复或乱序。");
  }
  const gmNarrations = value.gmNarrations.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`正式 TTRPG GM 叙事 ${index} 无效。`);
    const text = String(raw.text ?? "").trim();
    const source = raw.source == null ? "ai-confirmed" : String(raw.source);
    const candidateHash =
      raw.candidateHash == null ? null : String(raw.candidateHash);
    const runId =
      raw.runId == null
        ? null
        : assertFiniteInteger(
            raw.runId,
            "GM 叙事 Run ID",
            1,
            Number.MAX_SAFE_INTEGER,
          );
    const modelEvidence = parseTtrpgModelEvidenceV1(raw.modelEvidence);
    const modelCalls = Array.isArray(raw.modelCalls)
      ? raw.modelCalls
          .map(parseTtrpgModelEvidenceV1)
          .filter(
            (item): item is TtrpgRuntimeModelEvidenceV1 => item != null,
          )
      : modelEvidence
        ? [modelEvidence]
        : [];
    const repairApplied = raw.repairApplied === true;
    const actionSequence = assertFiniteInteger(
      raw.actionSequence,
      "GM 叙事动作序号",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const actionReceipt =
      actionHistory.find((action) => action.eventSequence === actionSequence)
        ?.receipt ?? null;
    const synthesisFrame =
      raw.synthesisFrame == null
        ? null
        : actionReceipt
          ? parseTtrpgGmSynthesisFrameV2(raw.synthesisFrame, actionReceipt)
          : (() => {
              throw new Error(
                `正式 TTRPG GM 叙事 ${index} 的综合帧缺少 ActionReceipt。`,
              );
            })();
    if (
      !text ||
      text.length > 20_000 ||
      !["human-gm", "ai-confirmed", "deterministic-fallback"].includes(
        source,
      ) ||
      (source === "ai-confirmed" &&
        (!candidateHash ||
          !/^[0-9a-f]{64}$/.test(candidateHash) ||
          runId == null)) ||
      modelCalls.length > 2 ||
      ((source === "human-gm" || source === "deterministic-fallback") &&
        (candidateHash != null ||
          runId != null ||
          modelEvidence != null ||
          modelCalls.length ||
          repairApplied))
    ) {
      throw new Error(`正式 TTRPG GM 叙事 ${index} 字段无效。`);
    }
    return {
      eventSequence: assertFiniteInteger(
        raw.eventSequence,
        "GM 叙事事件序号",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      actionSequence,
      checkSequence:
        raw.checkSequence == null
          ? null
          : assertFiniteInteger(
              raw.checkSequence,
              "GM 叙事检定序号",
              1,
              Number.MAX_SAFE_INTEGER,
            ),
      text,
      candidateHash,
      runId,
      modelEvidence,
      modelCalls,
      repairApplied,
      synthesisFrame,
      source: source as "human-gm" | "ai-confirmed" | "deterministic-fallback",
    };
  });
  if (
    new Set(gmNarrations.map((item) => item.actionSequence)).size !==
    gmNarrations.length
  ) {
    throw new Error("同一正式规则行动不能记录多份 GM 叙事。");
  }
  const questProgress = value.questProgress.map((raw, index) => {
    if (!isObject(raw) || !Array.isArray(raw.requiredConclusionKeys)) {
      throw new Error(`正式 TTRPG 任务进度 ${index} 无效。`);
    }
    const questKey = String(raw.questKey ?? "").trim();
    const requiredConclusionKeys = raw.requiredConclusionKeys.map((item) =>
      String(item).trim(),
    );
    const status = String(raw.status ?? "");
    const completedAtSequence =
      raw.completedAtSequence == null
        ? null
        : assertFiniteInteger(
            raw.completedAtSequence,
            "任务完成序号",
            1,
            Number.MAX_SAFE_INTEGER,
          );
    if (
      !questKey ||
      !requiredConclusionKeys.length ||
      requiredConclusionKeys.some((item) => !item) ||
      new Set(requiredConclusionKeys).size !== requiredConclusionKeys.length ||
      !["active", "completed"].includes(status) ||
      (status === "completed") !== (completedAtSequence != null)
    ) {
      throw new Error(`正式 TTRPG 任务进度 ${index} 字段无效。`);
    }
    return {
      questKey,
      requiredConclusionKeys,
      status: status as "active" | "completed",
      completedAtSequence,
    };
  });
  if (
    !questProgress.length ||
    new Set(questProgress.map((item) => item.questKey)).size !==
      questProgress.length
  ) {
    throw new Error("正式 TTRPG 任务索引无效或重复。");
  }
  const endingCatalog = value.endingCatalog.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`正式 TTRPG 结局 ${index} 无效。`);
    const endingKey = String(raw.endingKey ?? "").trim();
    const title = String(raw.title ?? "").trim();
    const epilogue = String(raw.epilogue ?? "").trim();
    if (
      !endingKey ||
      !title ||
      !epilogue ||
      title.length > 300 ||
      epilogue.length > 20_000
    ) {
      throw new Error(`正式 TTRPG 结局 ${index} 字段无效。`);
    }
    let trigger: NonNullable<
      TtrpgRuntimeState["product"]
    >["endingCatalog"][number]["trigger"] = null;
    if (raw.trigger != null) {
      if (!isObject(raw.trigger))
        throw new Error(`正式 TTRPG 结局 ${index} trigger 无效。`);
      const sceneKey = String(raw.trigger.sceneKey ?? "").trim();
      const requiredConclusionKeys = Array.isArray(
        raw.trigger.requiredConclusionKeys,
      )
        ? raw.trigger.requiredConclusionKeys.map((item) => String(item).trim())
        : [];
      const forbiddenConclusionKeys = Array.isArray(
        raw.trigger.forbiddenConclusionKeys,
      )
        ? raw.trigger.forbiddenConclusionKeys.map((item) => String(item).trim())
        : [];
      const knownConclusions = new Set(
        clueCatalog.map((item) => item.conclusionKey),
      );
      if (
        !sceneKeys.includes(sceneKey) ||
        requiredConclusionKeys.some((key) => !knownConclusions.has(key)) ||
        forbiddenConclusionKeys.some((key) => !knownConclusions.has(key)) ||
        requiredConclusionKeys.some((key) =>
          forbiddenConclusionKeys.includes(key),
        ) ||
        new Set(requiredConclusionKeys).size !==
          requiredConclusionKeys.length ||
        new Set(forbiddenConclusionKeys).size !== forbiddenConclusionKeys.length
      ) {
        throw new Error(`正式 TTRPG 结局 ${index} trigger 字段无效。`);
      }
      trigger = { sceneKey, requiredConclusionKeys, forbiddenConclusionKeys };
    }
    return { endingKey, title, epilogue, trigger };
  });
  if (
    endingCatalog.length < 2 ||
    new Set(endingCatalog.map((item) => item.endingKey)).size !==
      endingCatalog.length
  ) {
    throw new Error("正式 TTRPG 结局索引无效或重复。");
  }
  let ending: NonNullable<TtrpgRuntimeState["product"]>["ending"] = null;
  if (value.ending != null) {
    if (!isObject(value.ending)) throw new Error("正式 TTRPG 已选结局无效。");
    const endingKey = String(value.ending.endingKey ?? "").trim();
    if (!endingCatalog.some((item) => item.endingKey === endingKey))
      throw new Error("正式 TTRPG 已选结局不在目录中。");
    ending = {
      endingKey,
      eventSequence: assertFiniteInteger(
        value.ending.eventSequence,
        "战役结局序号",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    };
  }
  const currencyKey = String(value.advancement.currencyKey ?? "").trim();
  const currencyName = String(value.advancement.currencyName ?? "").trim();
  const totalAwarded = assertFiniteInteger(
    value.advancement.totalAwarded,
    "成长奖励总额",
    0,
    1_000_000_000,
  );
  if (
    !Array.isArray(value.advancement.milestones) ||
    !Array.isArray(value.advancement.awardedMilestoneKeys)
  ) {
    throw new Error("正式 TTRPG 成长里程碑无效。");
  }
  const milestones = value.advancement.milestones.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`成长里程碑 ${index} 无效。`);
    const milestoneKey = String(raw.milestoneKey ?? "").trim();
    const title = String(raw.title ?? "").trim();
    const award = assertFiniteInteger(
      raw.award,
      "成长里程碑奖励",
      0,
      1_000_000,
    );
    if (!milestoneKey || !title || title.length > 300)
      throw new Error(`成长里程碑 ${index} 字段无效。`);
    return { milestoneKey, title, award };
  });
  const awardedMilestoneKeys = value.advancement.awardedMilestoneKeys.map(
    (item) => String(item).trim(),
  );
  if (
    !currencyKey ||
    !currencyName ||
    !milestones.length ||
    new Set(milestones.map((item) => item.milestoneKey)).size !==
      milestones.length ||
    awardedMilestoneKeys.some(
      (key) => !milestones.some((item) => item.milestoneKey === key),
    ) ||
    new Set(awardedMilestoneKeys).size !== awardedMilestoneKeys.length ||
    totalAwarded !==
      milestones
        .filter((item) => awardedMilestoneKeys.includes(item.milestoneKey))
        .reduce((sum, item) => sum + item.award, 0)
  ) {
    throw new Error("正式 TTRPG 成长投影不一致。");
  }
  const tabletop = parseTtrpgTabletopStateV1(value.tabletop);
  const media = parseTtrpgMediaStateV1(value.media);
  const actionEconomy =
    value.actionEconomy == null
      ? null
      : parseTtrpgActionEconomyV2(value.actionEconomy);
  const inventory =
    value.inventory == null
      ? null
      : parseTtrpgInventoryStateV2(value.inventory);
  const itemSnapshot = (
    raw: unknown,
    itemInstanceId: string,
    label: string,
  ): TtrpgRuntimeItemReceiptV2["before"] => {
    if (raw == null) return null;
    try {
      return parseTtrpgInventoryStateV2({
        schema: "storyforge.ttrpg-inventory",
        version: 2,
        items: { [itemInstanceId]: raw },
        appliedCommandIds: [],
      }).items[itemInstanceId];
    } catch (error) {
      throw new Error(
        `${label} 无效：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const itemHistory: TtrpgRuntimeItemReceiptV2[] = Array.isArray(
    value.itemHistory,
  )
    ? value.itemHistory.map((raw, index) => {
        if (!isObject(raw) || !isObject(raw.requestedBy)) {
          throw new Error(`正式 TTRPG 物品收据 ${index} 无效。`);
        }
        const itemInstanceId = String(raw.itemInstanceId ?? "").trim();
        const definitionRef = String(raw.definitionRef ?? "").trim();
        const commandId = String(raw.commandId ?? "").trim();
        const operation = String(
          raw.operation ?? "",
        ) as TtrpgRuntimeItemReceiptV2["operation"];
        const role = String(raw.requestedBy.role ?? "");
        const actorKey = String(raw.requestedBy.actorKey ?? "").trim();
        const eventSequence = assertFiniteInteger(
          raw.eventSequence,
          "物品收据事件序号",
          1,
          Number.MAX_SAFE_INTEGER,
        );
        if (
          raw.schema !== "storyforge.ttrpg-item-receipt" ||
          raw.version !== 2 ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(itemInstanceId) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(definitionRef) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(commandId) ||
          ![
            "grant",
            "remove",
            "transfer",
            "use",
            "equip",
            "unequip",
            "attune",
            "damage",
            "repair",
          ].includes(operation) ||
          !["gm", "player"].includes(role) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(actorKey)
        ) {
          throw new Error(`正式 TTRPG 物品收据 ${index} 字段无效。`);
        }
        const before = itemSnapshot(
          raw.before,
          itemInstanceId,
          `物品收据 ${index}.before`,
        );
        const after = itemSnapshot(
          raw.after,
          itemInstanceId,
          `物品收据 ${index}.after`,
        );
        if (
          (!before && !after) ||
          (before?.definitionRef ?? after?.definitionRef) !== definitionRef
        ) {
          throw new Error(`正式 TTRPG 物品收据 ${index} 前后状态不一致。`);
        }
        return {
          schema: "storyforge.ttrpg-item-receipt",
          version: 2,
          eventSequence,
          commandId,
          operation,
          itemInstanceId,
          definitionRef,
          requestedBy: { role: role as "gm" | "player", actorKey },
          before,
          after,
        };
      })
    : [];
  if (
    itemHistory.length > 100_000 ||
    new Set(itemHistory.map((item) => item.eventSequence)).size !==
      itemHistory.length ||
    new Set(itemHistory.map((item) => item.commandId)).size !==
      itemHistory.length
  ) {
    throw new Error("正式 TTRPG 物品收据过多或重复。");
  }
  const abilityStates =
    value.abilityStates == null
      ? null
      : (() => {
          if (
            !isObject(value.abilityStates) ||
            Object.keys(value.abilityStates).length > 10_000
          ) {
            throw new Error("正式 TTRPG 能力状态无效。");
          }
          return Object.fromEntries(
            Object.entries(value.abilityStates).map(([stateKey, raw]) => {
              const parsed = parseTtrpgAbilityRuntimeStateV2(raw);
              if (
                stateKey !==
                ttrpgAbilityStateKeyV2(
                  parsed.actorInstanceId,
                  parsed.abilityKey,
                )
              ) {
                throw new Error(`正式 TTRPG 能力状态索引不一致:${stateKey}`);
              }
              return [stateKey, parsed];
            }),
          );
        })();
  const usagePools =
    value.usagePools == null
      ? null
      : (() => {
          if (
            !isObject(value.usagePools) ||
            Object.keys(value.usagePools).length > 1_000
          ) {
            throw new Error("正式 TTRPG 共享次数池无效。");
          }
          return Object.fromEntries(
            Object.entries(value.usagePools).map(([poolKey, raw]) => {
              const parsed = parseTtrpgUsagePoolStateV2(raw);
              if (parsed.poolKey !== poolKey)
                throw new Error(`正式 TTRPG 共享次数池索引不一致:${poolKey}`);
              return [poolKey, parsed];
            }),
          );
        })();
  const effectLedger =
    value.effectLedger == null
      ? null
      : parseTtrpgEffectLedgerStateV2(value.effectLedger);
  const characterProgression: NonNullable<
    TtrpgRuntimeState["product"]
  >["characterProgression"] =
    value.characterProgression == null
      ? null
      : (() => {
          if (
            !isObject(value.characterProgression) ||
            Object.keys(value.characterProgression).length > 256
          ) {
            throw new Error("正式 TTRPG 角色成长索引无效。");
          }
          return Object.fromEntries(
            Object.entries(value.characterProgression).map(
              ([characterKey, raw]) => {
                if (
                  !characterKey.trim() ||
                  !isObject(raw) ||
                  !isObject(raw.attributeIncreases) ||
                  !isObject(raw.skillIncreases) ||
                  !Array.isArray(raw.history) ||
                  raw.history.length > 10_000
                ) {
                  throw new Error(`正式 TTRPG 角色成长无效:${characterKey}`);
                }
                const model = String(raw.model);
                if (
                  !["numeric-level", "rank", "point-buy", "classless"].includes(
                    model,
                  )
                )
                  throw new Error("角色成长模式无效。");
                const level =
                  raw.level == null
                    ? null
                    : assertFiniteInteger(raw.level, "角色等级", 1, 1_000);
                const rankKey =
                  raw.rankKey == null
                    ? null
                    : String(raw.rankKey).trim() || null;
                if (
                  (model === "numeric-level") !== (level != null) ||
                  (model === "rank") !== (rankKey != null)
                ) {
                  throw new Error(
                    `角色成长等级/阶位与模式不一致:${characterKey}`,
                  );
                }
                const parseIncreases = (
                  source: Record<string, unknown>,
                  label: string,
                ) =>
                  Object.fromEntries(
                    Object.entries(source).map(([entryKey, amount]) => {
                      if (!entryKey.trim())
                        throw new Error(`${label} key 无效。`);
                      return [
                        entryKey,
                        assertFiniteInteger(amount, label, 0, 1_000_000),
                      ];
                    }),
                  );
                const history = raw.history.map((entry, index) => {
                  if (
                    !isObject(entry) ||
                    !["attribute", "skill", "level", "rank"].includes(
                      String(entry.kind),
                    )
                  ) {
                    throw new Error(`角色成长历史 ${index} 无效。`);
                  }
                  const targetKey = String(entry.targetKey ?? "").trim();
                  const before = entry.before;
                  const after = entry.after;
                  if (
                    !targetKey ||
                    !["string", "number"].includes(typeof before) ||
                    !["string", "number"].includes(typeof after) ||
                    typeof before !== typeof after
                  )
                    throw new Error(`角色成长历史 ${index} 前后值无效。`);
                  return {
                    eventSequence: assertFiniteInteger(
                      entry.eventSequence,
                      "成长事件序号",
                      1,
                      Number.MAX_SAFE_INTEGER,
                    ),
                    kind: String(entry.kind) as
                      "attribute" | "skill" | "level" | "rank",
                    targetKey,
                    before: before as number | string,
                    after: after as number | string,
                    cost: assertFiniteInteger(
                      entry.cost,
                      "成长消耗",
                      1,
                      1_000_000,
                    ),
                  };
                });
                const spentCurrency = assertFiniteInteger(
                  raw.spentCurrency,
                  "成长已消费货币",
                  0,
                  1_000_000_000,
                );
                if (
                  history.reduce((sum, entry) => sum + entry.cost, 0) !==
                  spentCurrency
                )
                  throw new Error("成长历史消费与余额不一致。");
                return [
                  characterKey,
                  {
                    model: model as
                      "numeric-level" | "rank" | "point-buy" | "classless",
                    level,
                    rankKey,
                    spentCurrency,
                    attributeIncreases: parseIncreases(
                      raw.attributeIncreases,
                      "属性成长次数",
                    ),
                    skillIncreases: parseIncreases(
                      raw.skillIncreases,
                      "技能成长次数",
                    ),
                    history,
                  },
                ];
              },
            ),
          );
        })();
  return {
    rulePackContentHash: String(value.rulePackContentHash),
    campaignKey,
    campaignTitle,
    openingSceneKey,
    sessionZero: {
      completed,
      requiredItemKeys,
      acceptedItemKeys,
      selectedCharacterKeys,
      completedBy,
      completedAtSequence,
    },
    safety: {
      status: safetyStatus as "active" | "paused",
      reason: safetyReason,
      changedBy: safetyChangedBy,
      changedAtSequence: safetyChangedAtSequence,
    },
    hiddenDicePolicy: hiddenDicePolicy as "never" | "gm-only" | "allowed",
    sceneKeys,
    openedSceneKeys,
    clueCatalog,
    clockCatalog,
    discoveredClues,
    conditions,
    actionEconomy,
    inventory,
    itemHistory,
    abilityStates,
    usagePools,
    effectLedger,
    characterProgression,
    characterCustomizations,
    actionHistory,
    intentReceipts,
    humanResponses,
    restHistory,
    gmNarrations,
    questProgress,
    endingCatalog,
    ending,
    advancement: {
      currencyKey,
      currencyName,
      totalAwarded,
      milestones,
      awardedMilestoneKeys,
    },
    tabletop,
    media,
  };
}

export function parseTtrpgState(value: unknown): TtrpgRuntimeState | null {
  if (value == null) return null;
  if (!isObject(value)) throw new Error("跑团状态必须是对象或 null。");
  const scene = value.scene == null ? null : assertTtrpgScene(value.scene);
  const round = assertFiniteInteger(
    value.round,
    "跑团回合",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const activeActorKey =
    value.activeActorKey == null
      ? null
      : String(value.activeActorKey).trim() || null;
  if (!Array.isArray(value.turnOrder))
    throw new Error("跑团回合顺序必须是数组。");
  const turnOrder = value.turnOrder.map((raw) => String(raw).trim());
  if (
    turnOrder.some((key) => !key || key.length > 160) ||
    new Set(turnOrder).size !== turnOrder.length
  ) {
    throw new Error("跑团回合顺序包含无效或重复行动者。");
  }
  if (activeActorKey != null && !turnOrder.includes(activeActorKey))
    throw new Error("跑团当前行动者不在回合顺序中。");
  const initiative: TtrpgRuntimeState["initiative"] =
    value.initiative == null
      ? null
      : (() => {
          if (
            !isObject(value.initiative) ||
            !Array.isArray(value.initiative.entries)
          )
            throw new Error("跑团先攻收据无效。");
          const sceneKey = String(value.initiative.sceneKey ?? "").trim();
          const diceModelKey = String(
            value.initiative.diceModelKey ?? "",
          ).trim();
          const attributeKey = String(
            value.initiative.attributeKey ?? "",
          ).trim();
          const entries = value.initiative.entries.map((raw, index) => {
            if (
              !isObject(raw) ||
              !Array.isArray(raw.rolledDice) ||
              !Array.isArray(raw.keptDice)
            )
              throw new Error(`跑团先攻项 ${index} 无效。`);
            const actorKey = String(raw.actorKey ?? "").trim();
            const rolledDice = raw.rolledDice.map((die) =>
              assertFiniteInteger(die, "先攻原始骰点", 1, 100),
            );
            const keptDice = raw.keptDice.map((die) =>
              assertFiniteInteger(die, "先攻保留骰点", 1, 100),
            );
            const modifier = assertFiniteInteger(
              raw.modifier,
              "先攻修正",
              -1_000,
              1_000,
            );
            const total = assertFiniteInteger(
              raw.total,
              "先攻总值",
              -100_000,
              100_000,
            );
            const seedCommitment = String(raw.seedCommitment ?? "");
            const nonce = String(raw.nonce ?? "");
            const proofHash = String(raw.proofHash ?? "");
            if (
              !actorKey ||
              !keptDice.length ||
              total !== keptDice.reduce((sum, die) => sum + die, modifier) ||
              !/^[a-f0-9]{64}$/.test(seedCommitment) ||
              !nonce ||
              nonce.length > 10_000 ||
              !/^[a-f0-9]{64}$/.test(proofHash)
            ) {
              throw new Error(`跑团先攻项 ${index} 证据不一致。`);
            }
            return {
              actorKey,
              rolledDice,
              keptDice,
              modifier,
              total,
              rollTrace: assertTtrpgDiceRollTraceV2(raw.rollTrace),
              seedCommitment,
              nonce,
              proofHash,
            };
          });
          if (
            !sceneKey ||
            !diceModelKey ||
            !attributeKey ||
            entries.length !== turnOrder.length ||
            entries.some((entry, index) => entry.actorKey !== turnOrder[index])
          )
            throw new Error("跑团先攻顺序与回合顺序不一致。");
          return { sceneKey, diceModelKey, attributeKey, entries };
        })();
  if (!Array.isArray(value.actions) || !Array.isArray(value.checks))
    throw new Error("跑团动作与检定记录必须是数组。");
  if (value.attacks != null && !Array.isArray(value.attacks))
    throw new Error("跑团攻击记录必须是数组。");
  return {
    scene,
    round,
    activeActorKey,
    turnOrder,
    initiative,
    actions: value.actions.map(assertTtrpgAction),
    checks: value.checks.map(assertTtrpgCheck),
    attacks: (value.attacks ?? []).map(assertTtrpgAttackResult),
    encounter:
      value.encounter == null ? null : assertTtrpgEncounter(value.encounter),
    campaign: parseTtrpgCampaignState(value.campaign),
    product: parseTtrpgProductState(value.product),
  };
}

export function emptyTtrpgCampaignState(): TtrpgRuntimeCampaignState {
  return {
    summary: "",
    quests: [],
    npcSchedules: [],
    activeSessionKey: null,
    playSessions: [],
    roster: [],
    memories: [],
    supplements: [],
    worldEvolution: [],
    versionTransitions: [],
  };
}

export function assertTtrpgQuest(value: unknown): TtrpgRuntimeQuest {
  if (!isObject(value)) throw new Error("战役任务必须是对象。");
  const questId = String(value.questId ?? "").trim();
  const title = String(value.title ?? "").trim();
  const description = String(value.description ?? "").trim();
  const status = String(value.status ?? "") as TtrpgRuntimeQuestStatus;
  if (!questId || questId.length > 160) throw new Error("战役任务 ID 无效。");
  if (!title || title.length > 240) throw new Error("战役任务标题无效。");
  if (description.length > 8_000) throw new Error("战役任务描述过长。");
  if (!SIMULATION_TTRPG_QUEST_STATUSES.includes(status))
    throw new Error(`未知战役任务状态: ${status}`);
  const dueClock =
    value.dueClock == null
      ? null
      : assertFiniteInteger(
          value.dueClock,
          "任务期限",
          0,
          Number.MAX_SAFE_INTEGER,
        );
  return {
    questId,
    title,
    description,
    status,
    priority: assertFiniteInteger(value.priority ?? 0, "任务优先级", 0, 5),
    dueClock,
    updatedSequence: assertFiniteInteger(
      value.updatedSequence,
      "任务更新时间序号",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

export function assertTtrpgNpcSchedule(value: unknown): TtrpgRuntimeNpcSchedule {
  if (!isObject(value)) throw new Error("NPC 日程必须是对象。");
  const scheduleId = String(value.scheduleId ?? "").trim();
  const entityKey = String(value.entityKey ?? "").trim();
  const activity = String(value.activity ?? "").trim();
  const recurrence = String(value.recurrence ?? "once");
  if (!scheduleId || scheduleId.length > 160)
    throw new Error("NPC 日程 ID 无效。");
  if (!entityKey || entityKey.length > 160)
    throw new Error("NPC 日程缺少 NPC。");
  if (!activity || activity.length > 2_000)
    throw new Error("NPC 日程活动无效。");
  if (!["once", "daily", "weekly"].includes(recurrence))
    throw new Error(`未知 NPC 日程重复方式: ${recurrence}`);
  const startClock = assertFiniteInteger(
    value.startClock,
    "NPC 日程开始时间",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const endClock =
    value.endClock == null
      ? null
      : assertFiniteInteger(
          value.endClock,
          "NPC 日程结束时间",
          startClock,
          Number.MAX_SAFE_INTEGER,
        );
  const locationKey =
    value.locationKey == null ? null : String(value.locationKey).trim() || null;
  return {
    scheduleId,
    entityKey,
    startClock,
    endClock,
    locationKey,
    activity,
    recurrence: recurrence as TtrpgRuntimeNpcSchedule["recurrence"],
    updatedSequence: assertFiniteInteger(
      value.updatedSequence,
      "日程更新时间序号",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

const TTRPG_LONG_CAMPAIGN_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
export const TTRPG_SHA256 = /^[0-9a-f]{64}$/;

export function longCampaignKey(value: unknown, label: string): string {
  const parsed = String(value ?? "").trim();
  if (!TTRPG_LONG_CAMPAIGN_KEY.test(parsed))
    throw new Error(`${label} 不是稳定 key。`);
  return parsed;
}

export function longCampaignText(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false,
): string {
  const parsed = String(value ?? "")
    .trim()
    .normalize("NFC");
  if ((!allowEmpty && !parsed) || parsed.length > maximum)
    throw new Error(`${label} 为空或过长。`);
  return parsed;
}

export function assertTtrpgCampaignPlaySessionV2(
  value: unknown,
): TtrpgRuntimeCampaignSessionV2 {
  if (!isObject(value)) throw new Error("长期战役分场必须是对象。");
  const status = String(value.status ?? "");
  if (!Array.isArray(value.participantKeys))
    throw new Error("长期战役分场缺少参与者。");
  const participantKeys = value.participantKeys.map((item) =>
    longCampaignKey(item, "长期战役参与者"),
  );
  if (
    participantKeys.length < 1 ||
    participantKeys.length > 12 ||
    new Set(participantKeys).size !== participantKeys.length ||
    !["active", "completed", "cancelled"].includes(status) ||
    !TTRPG_SHA256.test(String(value.rulePackContentHash ?? ""))
  ) {
    throw new Error("长期战役分场字段无效。");
  }
  const completedSequence =
    value.completedSequence == null
      ? null
      : assertFiniteInteger(
          value.completedSequence,
          "长期战役分场完成序号",
          1,
          Number.MAX_SAFE_INTEGER,
        );
  if ((status === "active") !== (completedSequence == null))
    throw new Error("长期战役分场状态与完成序号不一致。");
  return {
    sessionKey: longCampaignKey(value.sessionKey, "长期战役分场 key"),
    ordinal: assertFiniteInteger(value.ordinal, "长期战役分场序号", 1, 10_000),
    title: longCampaignText(value.title, "长期战役分场标题", 300),
    status: status as TtrpgRuntimeCampaignSessionV2["status"],
    participantKeys,
    startedSequence: assertFiniteInteger(
      value.startedSequence,
      "长期战役分场开始序号",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    completedSequence,
    summary: longCampaignText(
      value.summary,
      "长期战役分场摘要",
      20_000,
      status === "active",
    ),
    rulePackContentHash: String(value.rulePackContentHash),
    campaignKey: longCampaignKey(value.campaignKey, "长期战役 Campaign key"),
  };
}

export function assertTtrpgRosterEntryV2(
  value: unknown,
): TtrpgRuntimeRosterEntryV2 {
  if (!isObject(value)) throw new Error("长期战役编组必须是对象。");
  const status = String(value.status ?? "");
  if (!["active", "reserve", "retired"].includes(status))
    throw new Error("长期战役编组状态无效。");
  const joinedSessionKey =
    value.joinedSessionKey == null
      ? null
      : longCampaignKey(value.joinedSessionKey, "角色加入分场");
  const leftSessionKey =
    value.leftSessionKey == null
      ? null
      : longCampaignKey(value.leftSessionKey, "角色离开分场");
  const replacementFor =
    value.replacementFor == null
      ? null
      : longCampaignKey(value.replacementFor, "补员替代角色");
  if ((status === "retired") !== (leftSessionKey != null))
    throw new Error("退场角色必须记录离开分场，未退场角色不得记录离开分场。");
  return {
    characterKey: longCampaignKey(value.characterKey, "长期战役角色"),
    status: status as TtrpgRuntimeRosterEntryV2["status"],
    joinedSessionKey,
    leftSessionKey,
    replacementFor,
    reason: longCampaignText(value.reason, "编组变更理由", 2_000, true),
    updatedSequence: assertFiniteInteger(
      value.updatedSequence,
      "编组更新序号",
      0,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

export function assertTtrpgCampaignMemoryV2(
  value: unknown,
): TtrpgRuntimeCampaignMemoryV2 {
  if (!isObject(value)) throw new Error("长期战役记忆必须是对象。");
  const audience = String(value.audience ?? "");
  if (
    audience !== "party" &&
    audience !== "gm-only" &&
    !/^actor:[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(audience)
  ) {
    throw new Error("长期战役记忆受众无效。");
  }
  return {
    memoryKey: longCampaignKey(value.memoryKey, "长期战役记忆 key"),
    subjectKey: longCampaignKey(value.subjectKey, "长期战役记忆主体"),
    summary: longCampaignText(value.summary, "长期战役记忆摘要", 4_000),
    audience: audience as TtrpgRuntimeCampaignMemoryV2["audience"],
    sourceSessionKey: longCampaignKey(value.sourceSessionKey, "记忆来源分场"),
    updatedSequence: assertFiniteInteger(
      value.updatedSequence,
      "记忆更新序号",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

export function assertTtrpgSupplementReceiptV2(
  value: unknown,
): TtrpgRuntimeSupplementReceiptV2 {
  if (!isObject(value)) throw new Error("补充包收据必须是对象。");
  const compatibility = String(value.compatibility ?? "");
  if (
    !["same-release", "next-release"].includes(compatibility) ||
    !TTRPG_SHA256.test(String(value.contentHash ?? ""))
  ) {
    throw new Error("补充包收据字段无效。");
  }
  return {
    supplementKey: longCampaignKey(value.supplementKey, "补充包 key"),
    title: longCampaignText(value.title, "补充包标题", 300),
    contentHash: String(value.contentHash),
    compatibility:
      compatibility as TtrpgRuntimeSupplementReceiptV2["compatibility"],
    sourceRef: longCampaignKey(value.sourceRef, "补充包来源"),
    activatedSessionKey:
      value.activatedSessionKey == null
        ? null
        : longCampaignKey(value.activatedSessionKey, "补充包激活分场"),
    approvedBy: longCampaignKey(value.approvedBy, "补充包批准者"),
    updatedSequence: assertFiniteInteger(
      value.updatedSequence,
      "补充包更新序号",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

export function assertTtrpgWorldEvolutionV2(
  value: unknown,
): TtrpgRuntimeWorldEvolutionV2 {
  if (!isObject(value)) throw new Error("世界演化候选必须是对象。");
  const category = String(value.category ?? "");
  const status = String(value.status ?? "");
  if (
    !["character", "location", "faction", "artifact", "event", "lore"].includes(
      category,
    ) ||
    !["proposed", "approved-for-world-review", "rejected"].includes(status)
  ) {
    throw new Error("世界演化候选字段无效。");
  }
  return {
    candidateKey: longCampaignKey(value.candidateKey, "世界演化候选 key"),
    category: category as TtrpgRuntimeWorldEvolutionV2["category"],
    summary: longCampaignText(value.summary, "世界演化摘要", 8_000),
    sourceSessionKey: longCampaignKey(
      value.sourceSessionKey,
      "世界演化来源分场",
    ),
    status: status as TtrpgRuntimeWorldEvolutionV2["status"],
    targetWorldRef:
      value.targetWorldRef == null
        ? null
        : longCampaignKey(value.targetWorldRef, "世界演化目标"),
    reviewedBy:
      value.reviewedBy == null
        ? null
        : longCampaignKey(value.reviewedBy, "世界演化审核者"),
    updatedSequence: assertFiniteInteger(
      value.updatedSequence,
      "世界演化更新序号",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

export function assertTtrpgVersionTransitionV2(
  value: unknown,
): TtrpgRuntimeVersionTransitionV2 {
  if (!isObject(value)) throw new Error("版本迁移记录必须是对象。");
  const compatibility = String(value.compatibility ?? "");
  const status = String(value.status ?? "");
  if (
    !["same-content", "compatible", "manual-migration", "breaking"].includes(
      compatibility,
    ) ||
    !["planned", "activated", "rejected"].includes(status) ||
    !TTRPG_SHA256.test(String(value.fromRulePackContentHash ?? "")) ||
    !TTRPG_SHA256.test(String(value.toRulePackContentHash ?? ""))
  ) {
    throw new Error("版本迁移记录字段无效。");
  }
  return {
    transitionKey: longCampaignKey(value.transitionKey, "版本迁移 key"),
    fromRulePackContentHash: String(value.fromRulePackContentHash),
    toRulePackContentHash: String(value.toRulePackContentHash),
    fromCampaignKey: longCampaignKey(
      value.fromCampaignKey,
      "迁移前 Campaign key",
    ),
    toCampaignKey: longCampaignKey(value.toCampaignKey, "迁移后 Campaign key"),
    compatibility:
      compatibility as TtrpgRuntimeVersionTransitionV2["compatibility"],
    status: status as TtrpgRuntimeVersionTransitionV2["status"],
    notes: longCampaignText(value.notes, "版本迁移说明", 8_000),
    approvedBy: longCampaignKey(value.approvedBy, "版本迁移批准者"),
    updatedSequence: assertFiniteInteger(
      value.updatedSequence,
      "版本迁移更新序号",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function parseTtrpgCampaignState(value: unknown): TtrpgRuntimeCampaignState {
  if (value == null) return emptyTtrpgCampaignState();
  if (!isObject(value)) throw new Error("长期战役状态必须是对象。");
  const summary = String(value.summary ?? "").trim();
  if (summary.length > 20_000) throw new Error("长期战役摘要过长。");
  if (!Array.isArray(value.quests) || !Array.isArray(value.npcSchedules)) {
    throw new Error("长期战役任务和 NPC 日程必须是数组。");
  }
  const quests = value.quests.map(assertTtrpgQuest);
  const npcSchedules = value.npcSchedules.map(assertTtrpgNpcSchedule);
  if (new Set(quests.map((quest) => quest.questId)).size !== quests.length)
    throw new Error("战役任务 ID 不能重复。");
  if (
    new Set(npcSchedules.map((schedule) => schedule.scheduleId)).size !==
    npcSchedules.length
  )
    throw new Error("NPC 日程 ID 不能重复。");
  const playSessions = Array.isArray(value.playSessions)
    ? value.playSessions.map(assertTtrpgCampaignPlaySessionV2)
    : [];
  const roster = Array.isArray(value.roster)
    ? value.roster.map(assertTtrpgRosterEntryV2)
    : [];
  const memories = Array.isArray(value.memories)
    ? value.memories.map(assertTtrpgCampaignMemoryV2)
    : [];
  const supplements = Array.isArray(value.supplements)
    ? value.supplements.map(assertTtrpgSupplementReceiptV2)
    : [];
  const worldEvolution = Array.isArray(value.worldEvolution)
    ? value.worldEvolution.map(assertTtrpgWorldEvolutionV2)
    : [];
  const versionTransitions = Array.isArray(value.versionTransitions)
    ? value.versionTransitions.map(assertTtrpgVersionTransitionV2)
    : [];
  const activeSessionKey =
    value.activeSessionKey == null
      ? null
      : longCampaignKey(value.activeSessionKey, "当前长期战役分场");
  const unique = <T>(items: T[], pick: (item: T) => string, label: string) => {
    if (new Set(items.map(pick)).size !== items.length)
      throw new Error(`${label} 不能重复。`);
  };
  unique(playSessions, (item) => item.sessionKey, "长期战役分场 key");
  unique(playSessions, (item) => String(item.ordinal), "长期战役分场序号");
  unique(roster, (item) => item.characterKey, "长期战役角色");
  unique(memories, (item) => item.memoryKey, "长期战役记忆 key");
  unique(supplements, (item) => item.supplementKey, "补充包 key");
  unique(worldEvolution, (item) => item.candidateKey, "世界演化候选 key");
  unique(versionTransitions, (item) => item.transitionKey, "版本迁移 key");
  const active = playSessions.filter((item) => item.status === "active");
  if (
    active.length > 1 ||
    (activeSessionKey == null) !== (active.length === 0) ||
    (activeSessionKey != null && active[0]?.sessionKey !== activeSessionKey)
  ) {
    throw new Error("长期战役当前分场索引不一致。");
  }
  const sessionKeys = new Set(playSessions.map((item) => item.sessionKey));
  if (
    roster.some(
      (item) =>
        (item.joinedSessionKey != null &&
          !sessionKeys.has(item.joinedSessionKey)) ||
        (item.leftSessionKey != null && !sessionKeys.has(item.leftSessionKey)),
    ) ||
    memories.some((item) => !sessionKeys.has(item.sourceSessionKey)) ||
    worldEvolution.some((item) => !sessionKeys.has(item.sourceSessionKey))
  ) {
    throw new Error("长期战役引用了不存在的分场。");
  }
  return {
    summary,
    quests,
    npcSchedules,
    activeSessionKey,
    playSessions,
    roster,
    memories,
    supplements,
    worldEvolution,
    versionTransitions,
  };
}

export function requireTtrpgState(
  state: ProductRuntimeState,
): TtrpgRuntimeState {
  if (!state.ttrpg) state.ttrpg = emptyTtrpgState();
  return state.ttrpg;
}

export function parseTtrpgRuntimeTurnCandidate(
  value: unknown,
): TtrpgRuntimeTurnCandidate {
  if (!isObject(value)) throw new Error("跑团回合候选必须是对象。");
  const allowed = new Set([
    "baseSequence",
    "actorKey",
    "action",
    "narrative",
    "check",
    "outcomes",
    "nextActorKey",
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new Error(`跑团回合候选包含未知字段: ${unknown.join(", ")}`);
  const baseSequence = assertFiniteInteger(
    value.baseSequence,
    "跑团候选基线序号",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const actorKey = String(value.actorKey ?? "").trim();
  const action = String(value.action ?? "").trim();
  const narrative = String(value.narrative ?? "").trim();
  const nextActorKey =
    value.nextActorKey == null
      ? null
      : String(value.nextActorKey).trim() || null;
  if (!actorKey || actorKey.length > 160)
    throw new Error("跑团候选缺少行动者。");
  if (!action || action.length > 4_000) throw new Error("跑团候选动作无效。");
  if (!narrative || narrative.length > 20_000)
    throw new Error("跑团候选叙事无效。");
  let check: TtrpgRuntimeCheckRequest | null = null;
  if (value.check != null) {
    if (!isObject(value.check))
      throw new Error("跑团检定候选必须是对象或 null。");
    const skill = String(value.check.skill ?? "").trim();
    const expression = String(value.check.expression ?? "").trim();
    const reason = String(value.check.reason ?? "").trim();
    const dc = assertFiniteInteger(value.check.dc, "检定难度", 0, 1_000);
    parseProductRuntimeDiceExpressionV1(expression);
    if (!skill || skill.length > 120) throw new Error("跑团候选技能无效。");
    if (!reason || reason.length > 1_000)
      throw new Error("跑团候选检定理由无效。");
    check = { skill, expression, dc, reason };
  }
  let outcomes: TtrpgRuntimeTurnCandidate["outcomes"] = null;
  if (value.outcomes != null) {
    if (!isObject(value.outcomes))
      throw new Error("跑团检定分支叙事必须是对象或 null。");
    const success = String(value.outcomes.success ?? "").trim();
    const failure = String(value.outcomes.failure ?? "").trim();
    if (
      !success ||
      !failure ||
      success.length > 20_000 ||
      failure.length > 20_000
    ) {
      throw new Error("跑团检定成功/失败叙事无效。");
    }
    outcomes = { success, failure };
  }
  if ((check == null) !== (outcomes == null))
    throw new Error("跑团检定与成功/失败叙事必须同时提供。");
  return {
    baseSequence,
    actorKey,
    action,
    narrative,
    check,
    outcomes,
    nextActorKey,
  };
}

export type TtrpgTabletopOperationV1 =
  | { kind: "move-token"; tokenKey: string; x: number; y: number }
  | { kind: "set-token-hidden"; tokenKey: string; hidden: boolean }
  | { kind: "set-fog"; fogKey: string; revealed: boolean }
  | { kind: "set-layer"; layerKey: string; visible: boolean };

export function parseTtrpgTabletopOperationV1(
  value: unknown,
): TtrpgTabletopOperationV1 {
  if (!isObject(value)) throw new Error("桌面操作必须是对象。");
  const kind = String(value.kind ?? "");
  const actual = Object.keys(value).sort().join(",");
  const key = (raw: unknown, label: string) => {
    const result = String(raw ?? "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(result))
      throw new Error(`${label} 无效。`);
    return result;
  };
  if (kind === "move-token") {
    if (actual !== "kind,tokenKey,x,y")
      throw new Error("移动 token 操作字段不精确。");
    return {
      kind,
      tokenKey: key(value.tokenKey, "桌面 token key"),
      x: assertFiniteInteger(value.x, "桌面 token x", 0, 100),
      y: assertFiniteInteger(value.y, "桌面 token y", 0, 100),
    };
  }
  if (kind === "set-token-hidden") {
    if (actual !== "hidden,kind,tokenKey" || typeof value.hidden !== "boolean")
      throw new Error("token 可见性操作字段无效。");
    return {
      kind,
      tokenKey: key(value.tokenKey, "桌面 token key"),
      hidden: value.hidden,
    };
  }
  if (kind === "set-fog") {
    if (
      actual !== "fogKey,kind,revealed" ||
      typeof value.revealed !== "boolean"
    )
      throw new Error("迷雾操作字段无效。");
    return {
      kind,
      fogKey: key(value.fogKey, "桌面迷雾 key"),
      revealed: value.revealed,
    };
  }
  if (kind === "set-layer") {
    if (
      actual !== "kind,layerKey,visible" ||
      typeof value.visible !== "boolean"
    )
      throw new Error("图层操作字段无效。");
    return {
      kind,
      layerKey: key(value.layerKey, "桌面图层 key"),
      visible: value.visible,
    };
  }
  throw new Error("桌面操作 kind 无效。");
}

export function applyTtrpgTabletopOperationV1(input: {
  tabletop: TtrpgRuntimeTabletopStateV1;
  role: "gm" | "player";
  actorKey: string;
  operation: TtrpgTabletopOperationV1;
  sequence: number;
}): void {
  const mapKey = input.tabletop.currentMapKey;
  const map = input.tabletop.maps.find((item) => item.mapKey === mapKey);
  if (!map) throw new Error("当前场景没有可操作的冻结桌面地图。");
  const operation = input.operation;
  if (
    operation.kind === "move-token" ||
    operation.kind === "set-token-hidden"
  ) {
    const token = input.tabletop.tokens.find(
      (item) =>
        item.tokenKey === operation.tokenKey && item.mapKey === map.mapKey,
    );
    if (!token) throw new Error("桌面 token 不属于当前地图。");
    if (
      input.role === "player" &&
      (operation.kind !== "move-token" ||
        token.controllerKey !== input.actorKey ||
        token.hidden)
    ) {
      throw new Error("玩家只能移动自己控制且已公开的 token。");
    }
    if (operation.kind === "move-token") {
      token.x = operation.x;
      token.y = operation.y;
    } else {
      if (input.role !== "gm")
        throw new Error("只有 GM 可以改变 token 可见性。");
      token.hidden = operation.hidden;
    }
  } else if (operation.kind === "set-fog") {
    if (input.role !== "gm" || !map.fogKeys.includes(operation.fogKey))
      throw new Error("只有 GM 可以操作当前地图迷雾。");
    input.tabletop.revealedFogKeys = operation.revealed
      ? [...new Set([...input.tabletop.revealedFogKeys, operation.fogKey])]
      : input.tabletop.revealedFogKeys.filter(
          (key) => key !== operation.fogKey,
        );
  } else {
    if (
      input.role !== "gm" ||
      ![...map.publicLayerKeys, ...map.gmLayerKeys].includes(operation.layerKey)
    ) {
      throw new Error("只有 GM 可以操作当前地图图层。");
    }
    input.tabletop.visibleLayerKeys = operation.visible
      ? [...new Set([...input.tabletop.visibleLayerKeys, operation.layerKey])]
      : input.tabletop.visibleLayerKeys.filter(
          (key) => key !== operation.layerKey,
        );
  }
  input.tabletop.updatedAtSequence = input.sequence;
}
