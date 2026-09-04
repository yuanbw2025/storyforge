/** Product-owned deterministic runtime commands: ttrpg. */
import { applyTtrpgEffectPlanToRuntimeV2, proposeTtrpgEffectChoiceToRuntimeV2, resolveTtrpgEffectChoiceToRuntimeV2 } from "./effect-runtime";
import { assertProductReleaseUnchanged } from "../product/releases";
import { availableTtrpgCharacterCurrencyV2 } from "./advancement";
import { createCompleteTtrpgCharacterSheetV2 } from "./character-sheet";
import { createTtrpgActionReceiptV2, parseTtrpgGmSynthesisFrameV2, assertTtrpgFeedbackOutcomeConsistentV2, createDeterministicGmSynthesisFrameV2 } from "./action-feedback";
import { db } from "../db/schema";
import { evaluateTtrpgActionRequirementsV2 } from "./action-requirement";
import { parseRulePackV1, evaluateRuleNumberExpressionV1, resolveRulePackDiceModelV1, resolveRulePackCheckV1 } from "./rule-pack";
import { parseTtrpgCampaignContentV1 } from "./campaign";
import { parseTtrpgEffectPlanV2 } from "./effect-plan";
import { parseTtrpgItemCommandV2, ttrpgItemDefinitionFromRuleV1, applyTtrpgItemCommandV2 } from "./item-ledger";
import { readTtrpgSessionParticipantsV2, finalizeTtrpgSessionParticipantsV2 } from "./participants";
import { resetTtrpgAbilityUsageV2, ttrpgAbilityStateKeyV2, consumeTtrpgAbilityV2 } from "./ability-ledger";
import { spendTtrpgActionEconomyV2 } from "./action-economy";
import { applyProductRuntimeEvent, assertFiniteInteger, cloneState, hashStateJson, isObject, normalizeCommandId, parseEventPayload, parseProductRuntimeState, readLatestSessionEventSequenceV1, readProductRuntimeState, readProductRuntimeStateVersion, readSessionEvents, readVerifiedProductRuntimeHeadV1, replayProductRuntimeEvents, stableJson } from "../product/runtime-core";
import { TTRPG_SHA256, applyTtrpgTabletopOperationV1, assertTtrpgCampaignMemoryV2, assertTtrpgRuleActionResult, longCampaignKey, longCampaignText, parseTtrpgIntentReceiptV2, parseTtrpgModelEvidenceV1, parseTtrpgTabletopOperationV1, ttrpgDegreeSucceededV2, type TtrpgTabletopOperationV1 } from "./runtime-state";
import { verifyProductReleaseManifestV1 } from "../product-production/runtime-package";
import { verifyProductRuntimeSource } from "../product-production/preview-source";
import type { ProductRuntimeEventType, ProductRuntimeSession, ProductRuntimeEvent, ProductRuntimeState, TtrpgCharacterSheetV2, TtrpgRuntimeCampaignSessionV2, TtrpgRuntimeCampaignMemoryV2, TtrpgRuntimeRosterEntryV2, TtrpgRuntimeSupplementReceiptV2, TtrpgRuntimeWorldEvolutionV2, TtrpgRuntimeVersionTransitionV2, TtrpgCampaignContentV1, TtrpgRuntimeIntentReceiptV2, TtrpgRuntimeHumanResponseV2, TtrpgRuntimeCheck, TtrpgRuntimeRestReceiptV2, TtrpgRuntimeModelEvidenceV1 } from "../types";
export interface FormalTtrpgCommandEnvelope {
  sessionId: number;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
}

type FormalTtrpgEventType = Extract<
  ProductRuntimeEventType,
  | "ttrpg.character.customized"
  | "ttrpg.character.advanced"
  | "ttrpg.session-zero.completed"
  | "ttrpg.scene.opened"
  | "ttrpg.clue.discovered"
  | "ttrpg.intent.receipted"
  | "ttrpg.human-response.recorded"
  | "ttrpg.check.resolved"
  | "ttrpg.rule.action.resolved"
  | "ttrpg.rest.completed"
  | "ttrpg.gm.response.recorded"
  | "ttrpg.item.changed"
  | "ttrpg.effects.choice.proposed"
  | "ttrpg.effects.applied"
  | "ttrpg.campaign.ended"
  | "ttrpg.safety.changed"
  | "ttrpg.tabletop.updated"
  | "ttrpg.campaign.session.started"
  | "ttrpg.campaign.session.completed"
  | "ttrpg.campaign.roster.changed"
  | "ttrpg.campaign.supplement.activated"
  | "ttrpg.campaign.world-evolution.recorded"
  | "ttrpg.campaign.version-transition.recorded"
>;

async function verifyFormalTtrpgSource(session: ProductRuntimeSession) {
  const sourceCount = [
    session.productReleaseId,
    session.productBuildId,
  ].filter((value) => value != null).length;
  if (
    session.kind !== "ttrpg" ||
    !session.runtimeSourceHash ||
    sourceCount !== 1
  ) {
    throw new Error("[ttrpg] 正式 TTRPG 实例没有唯一冻结运行源。");
  }
  if (session.productBuildId != null) {
    if (session.worldId == null || session.workId == null) {
      throw new Error("[ttrpg] Build Preview 实例缺少完整工作区作用域。");
    }
    const buildBefore = await db.productBuilds.get(session.productBuildId);
    if (!buildBefore || !buildBefore.previewHash) {
      throw new Error("[ttrpg] Build Preview 运行源不存在。");
    }
    const playable = await verifyProductRuntimeSource({
      scope: {
        projectId: session.projectId,
        worldId: session.worldId,
        workId: session.workId,
      },
      source: {
        kind: "build",
        productBuildId: session.productBuildId,
        expectedPreviewHash: buildBefore.previewHash,
      },
    });
    const build = await db.productBuilds.get(session.productBuildId);
    if (!build || stableJson(build) !== stableJson(buildBefore)) {
      throw new Error("[ttrpg] ProductBuild 在运行源校验期间发生变化。");
    }
    if (
      playable.runtimePackage.productType !== "ttrpg" ||
      !playable.runtimePackage.ttrpg ||
      playable.packageHash !== session.runtimeSourceHash
    ) {
      throw new Error("[ttrpg] 实例与冻结 TTRPG Build Preview 不一致。");
    }
    const rulePack = parseRulePackV1(
      playable.runtimePackage.ttrpg.rulePack.content,
    );
    const campaign = parseTtrpgCampaignContentV1(
      playable.runtimePackage.ttrpg.campaign,
      rulePack,
    );
    return {
      source: { kind: "build" as const, build },
      runtimePackage: playable.runtimePackage,
      packageHash: playable.packageHash,
      rulePack,
      campaign,
    };
  }
  const release = await assertProductReleaseUnchanged(session.productReleaseId!);
  const manifest = await verifyProductReleaseManifestV1(release.manifestJson);
  if (
    manifest.productType !== "ttrpg" ||
    !manifest.runtimePackage.ttrpg ||
    manifest.packageHash !== session.runtimeSourceHash
  ) {
    throw new Error("[ttrpg] 实例与冻结 TTRPG ProductRelease 不一致。");
  }
  const rulePack = parseRulePackV1(
    manifest.runtimePackage.ttrpg.rulePack.content,
  );
  const campaign = parseTtrpgCampaignContentV1(
    manifest.runtimePackage.ttrpg.campaign,
    rulePack,
  );
  return {
    source: { kind: "release" as const, release },
    runtimePackage: manifest.runtimePackage,
    packageHash: manifest.packageHash,
    rulePack,
    campaign,
  };
}

function assertFormalTtrpgPrior(input: {
  prior: ProductRuntimeEvent;
  type: FormalTtrpgEventType;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
  intent: Record<string, unknown>;
}): void {
  const body = parseEventPayload(input.prior);
  if (
    input.prior.type !== input.type ||
    input.prior.commandId !== input.commandId ||
    input.prior.baseSequence !== input.baseSequence ||
    input.prior.baseStateHash !== input.baseStateHash ||
    stableJson(body.intent) !== stableJson(input.intent)
  ) {
    throw new Error("[ttrpg] commandId 已被不同命令使用。");
  }
}

async function appendFormalTtrpgCommand(
  input: FormalTtrpgCommandEnvelope & {
    type: FormalTtrpgEventType;
    intent: Record<string, unknown>;
    build: (context: {
      session: ProductRuntimeSession;
      state: ProductRuntimeState;
      sequence: number;
      rulePack: ReturnType<typeof parseRulePackV1>;
      campaign: ReturnType<typeof parseTtrpgCampaignContentV1>;
      participants: import("../types").TtrpgSessionParticipantRecordV2[];
    }) => Promise<{
      actorKey: string | null;
      targetKey: string | null;
      payload: Record<string, unknown>;
    }>;
    afterCommit?: (context: {
      session: ProductRuntimeSession;
      state: ProductRuntimeState;
      event: ProductRuntimeEvent;
      rulePack: ReturnType<typeof parseRulePackV1>;
      campaign: ReturnType<typeof parseTtrpgCampaignContentV1>;
    }) => Promise<void>;
  },
): Promise<ProductRuntimeEvent> {
  const commandId = normalizeCommandId(input.commandId);
  const baseStateHash = input.baseStateHash.trim();
  if (
    !Number.isInteger(input.baseSequence) ||
    input.baseSequence < 0 ||
    !/^[a-f0-9]{64}$/.test(baseStateHash)
  ) {
    throw new Error("[ttrpg] 命令基线无效。");
  }
  const previewSession = await db.productRuntimeSessions.get(input.sessionId);
  if (!previewSession) throw new Error("[ttrpg] 正式 TTRPG 实例不存在。");
  const frozen = await verifyFormalTtrpgSource(previewSession);
  const previewPrior = await db.productRuntimeEvents
    .where("[sessionId+commandId]")
    .equals([input.sessionId, commandId])
    .first();
  if (previewPrior) {
    assertFormalTtrpgPrior({
      prior: previewPrior,
      type: input.type,
      commandId,
      baseSequence: input.baseSequence,
      baseStateHash,
      intent: input.intent,
    });
    return previewPrior;
  }
  const previewHead = await readVerifiedProductRuntimeHeadV1(previewSession);
  const previewState = previewHead.state;
  const previewParticipants = await db.ttrpgSessionParticipants
    .where("sessionId")
    .equals(input.sessionId)
    .sortBy("seatKey");
  const previewHash = previewHead.stateHash;
  if (
    previewState.lastSequence !== input.baseSequence ||
    previewHash !== baseStateHash
  ) {
    throw new Error("[ttrpg] 战役状态已变化，请刷新后重试。");
  }
  if (
    !previewState.ttrpg?.product ||
    previewState.ttrpg.product.rulePackContentHash !==
      frozen.runtimePackage.ttrpg!.rulePack.contentHash ||
    previewState.ttrpg.product.campaignKey !== frozen.campaign.campaignKey
  ) {
    throw new Error("[ttrpg] 战役状态没有绑定冻结 RulePack/CampaignPack。");
  }
  if (
    previewState.ttrpg.product.safety.status === "paused" &&
    input.type !== "ttrpg.safety.changed"
  ) {
    throw new Error(
      "[ttrpg] 战役已由安全工具暂停；恢复后才能继续规则、场景或 AI 主持。",
    );
  }
  // Preflight command-specific validation before opening the write transaction.
  const previewBuilt = await input.build({
    session: previewSession,
    state: previewState,
    sequence: previewState.lastSequence + 1,
    rulePack: frozen.rulePack,
    campaign: frozen.campaign,
    participants: previewParticipants,
  });
  const preparedEvent: ProductRuntimeEvent = {
    projectId: previewSession.projectId,
    worldGroupId: previewSession.worldGroupId ?? null,
    sessionId: previewSession.id!,
    sequence: previewState.lastSequence + 1,
    type: input.type,
    actorKey: previewBuilt.actorKey,
    targetKey: previewBuilt.targetKey,
    commandId,
    baseSequence: input.baseSequence,
    baseStateHash,
    payloadJson: JSON.stringify({
      ...previewBuilt.payload,
      intent: input.intent,
    }),
    createdAt: Date.now(),
  };
  const preparedState = applyProductRuntimeEvent(
    cloneState(previewState),
    preparedEvent,
  );
  const preparedStateJson = JSON.stringify(preparedState);
  const preparedStateHash = await hashStateJson(preparedStateJson);
  return db.transaction(
    "rw",
    [
      db.productRuntimeSessions,
      db.productRuntimeEvents,
      db.ttrpgSessionParticipants,
      db.productReleases,
      db.productBuilds,
    ],
    async () => {
      const session = await db.productRuntimeSessions.get(input.sessionId);
      if (!session) throw new Error("[ttrpg] 正式 TTRPG 实例不存在。");
      const currentSource = frozen.source.kind === "release"
        ? session.productReleaseId == null
          ? null
          : await db.productReleases.get(session.productReleaseId)
        : session.productBuildId == null
          ? null
          : await db.productBuilds.get(session.productBuildId);
      const sourceUnchanged =
        frozen.source.kind === "release"
          ? currentSource != null &&
            currentSource.id === frozen.source.release.id &&
            "contentHash" in currentSource &&
            currentSource.manifestJson === frozen.source.release.manifestJson &&
            currentSource.contentHash === frozen.source.release.contentHash &&
            session.productBuildId == null
          : currentSource != null &&
            currentSource.id === frozen.source.build.id &&
            "previewHash" in currentSource &&
            currentSource.productionId === frozen.source.build.productionId &&
            currentSource.buildNumber === frozen.source.build.buildNumber &&
            currentSource.briefRevision === frozen.source.build.briefRevision &&
            currentSource.briefHash === frozen.source.build.briefHash &&
            currentSource.previewManifestJson ===
              frozen.source.build.previewManifestJson &&
            currentSource.previewHash === frozen.source.build.previewHash &&
            currentSource.packageHash === frozen.source.build.packageHash &&
            currentSource.manifestHash === frozen.source.build.manifestHash &&
            ["preview-ready", "release-ready", "released"].includes(
              currentSource.status,
            ) &&
            session.productReleaseId == null;
      if (
        !sourceUnchanged ||
        session.productReleaseId !== previewSession.productReleaseId ||
        session.productBuildId !== previewSession.productBuildId ||
        session.runtimeSourceHash !== frozen.packageHash ||
        session.seed !== previewSession.seed
      ) {
        throw new Error("[ttrpg] 冻结运行源在命令提交期间发生变化。");
      }
      const currentParticipants = await db.ttrpgSessionParticipants
        .where("sessionId")
        .equals(input.sessionId)
        .sortBy("seatKey");
      const prior = await db.productRuntimeEvents
        .where("[sessionId+commandId]")
        .equals([input.sessionId, commandId])
        .first();
      if (prior) {
        assertFormalTtrpgPrior({
          prior,
          type: input.type,
          commandId,
          baseSequence: input.baseSequence,
          baseStateHash,
          intent: input.intent,
        });
        return prior;
      }
      if (session.status !== "active")
        throw new Error("[ttrpg] 只有 active 战役可以提交命令。");
      const latestSequence = await readLatestSessionEventSequenceV1(
        input.sessionId,
      );
      let state: ProductRuntimeState;
      if (
        latestSequence === previewHead.sequence &&
        session.runtimeHeadSequence === previewHead.sequence &&
        session.runtimeHeadStateJson === previewHead.stateJson &&
        session.runtimeHeadStateHash === previewHead.stateHash
      ) {
        state = cloneState(previewState);
      } else {
        const events = await readSessionEvents(session);
        state = replayProductRuntimeEvents(
          parseProductRuntimeState(session.initialStateJson),
          events,
        );
      }
      const currentStateJson = JSON.stringify(state);
      if (
        state.lastSequence !== input.baseSequence ||
        currentStateJson !== previewHead.stateJson ||
        previewHead.stateHash !== baseStateHash ||
        state.lastSequence !== previewState.lastSequence ||
        stableJson(currentParticipants) !== stableJson(previewParticipants)
      ) {
        throw new Error("[ttrpg] 战役状态已变化，请刷新后重试。");
      }
      // The state hash, release bytes, seed and next sequence were all compared
      // above, so the preflight result is the exact deterministic command plan.
      // Reusing it also keeps WebCrypto outside Dexie's active transaction.
      const event: ProductRuntimeEvent = { ...preparedEvent };
      state = applyProductRuntimeEvent(state, event);
      if (stableJson(state) !== stableJson(preparedState)) {
        throw new Error("[ttrpg] 事务内规则结果与预提交计划不一致。");
      }
      event.id = (await db.productRuntimeEvents.add(event)) as number;
      await input.afterCommit?.({
        session,
        state,
        event,
        rulePack: frozen.rulePack,
        campaign: frozen.campaign,
      });
      await db.productRuntimeSessions.update(session.id!, {
        updatedAt: event.createdAt,
        runtimeHeadSequence: event.sequence,
        runtimeHeadStateJson: preparedStateJson,
        runtimeHeadStateHash: preparedStateHash,
      });
      return event;
    },
  );
}

export async function customizeTtrpgPlayerCharacterV1(
  input: FormalTtrpgCommandEnvelope & {
    characterKey: string;
    name: string;
    description: string;
    attributes: Record<string, number>;
    identity?: Partial<TtrpgCharacterSheetV2["identity"]>;
  },
): Promise<ProductRuntimeEvent> {
  const characterKey = input.characterKey.trim();
  const name = input.name.trim().normalize("NFC");
  const description = input.description.trim().normalize("NFC");
  const attributes = Object.fromEntries(
    Object.entries(input.attributes).map(([key, value]) => [
      key.trim(),
      Number(value),
    ]),
  );
  if (
    !characterKey ||
    !name ||
    name.length > 300 ||
    !description ||
    description.length > 20_000 ||
    Object.keys(attributes).some(
      (key) => !key || !Number.isFinite(attributes[key]),
    )
  ) {
    throw new Error("[ttrpg] 角色创建器输入无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.character.customized",
    intent: { characterKey, name, description, attributes },
    build: async ({ state, rulePack, campaign }) => {
      const product = state.ttrpg?.product;
      const template = campaign.characterTemplates.find(
        (item) => item.characterKey === characterKey && item.role === "player",
      );
      if (
        !product ||
        product.sessionZero.completed ||
        state.ttrpg?.scene ||
        !template
      ) {
        throw new Error("[ttrpg] 只能在 Session Zero 前定制冻结玩家角色。");
      }
      const expectedKeys = rulePack.attributes.map(
        (attribute) => attribute.key,
      );
      if (
        Object.keys(attributes).length !== expectedKeys.length ||
        expectedKeys.some(
          (key) => !Object.prototype.hasOwnProperty.call(attributes, key),
        )
      ) {
        throw new Error("[ttrpg] 角色创建器必须填写全部规则属性。");
      }
      for (const attribute of rulePack.attributes) {
        const value = attributes[attribute.key];
        if (
          !Number.isInteger(value) ||
          value < attribute.minimum ||
          value > attribute.maximum
        ) {
          throw new Error(
            `[ttrpg] ${attribute.name} 必须在 ${attribute.minimum}–${attribute.maximum} 之间。`,
          );
        }
      }
      const frozenBudget = rulePack.attributes.reduce(
        (sum, attribute) => sum + template.attributes[attribute.key],
        0,
      );
      const allocatedBudget = rulePack.attributes.reduce(
        (sum, attribute) => sum + attributes[attribute.key],
        0,
      );
      if (allocatedBudget !== frozenBudget) {
        throw new Error(
          `[ttrpg] 属性点必须保持 ${frozenBudget} 点；当前为 ${allocatedBudget} 点。`,
        );
      }
      const derived = Object.fromEntries(
        rulePack.derivedStats.map((stat) => {
          let value = evaluateRuleNumberExpressionV1(stat.formula, attributes);
          if (stat.minimum != null) value = Math.max(stat.minimum, value);
          if (stat.maximum != null) value = Math.min(stat.maximum, value);
          return [stat.key, value];
        }),
      );
      const maximums = Object.fromEntries(
        rulePack.resources.map((resource) => [
          resource.key,
          evaluateRuleNumberExpressionV1(resource.maximumFormula, attributes),
        ]),
      );
      const resources = Object.fromEntries(
        rulePack.resources.map((resource) => [
          resource.key,
          resource.initialMode === "maximum"
            ? maximums[resource.key]
            : resource.minimum,
        ]),
      );
      const entityAttributes = {
        identity: description,
        ...attributes,
        ...derived,
        ...Object.fromEntries(
          Object.entries(resources).map(([key, value]) => [
            `resource.${key}`,
            value,
          ]),
        ),
        ...Object.fromEntries(
          Object.entries(maximums).map(([key, value]) => [
            `resourceMax.${key}`,
            value,
          ]),
        ),
        hp: resources.vigor ?? 1,
        maxHp: maximums.vigor ?? resources.vigor ?? 1,
        armorClass: derived.defense ?? 8,
        initiative:
          attributes[rulePack.turnStructure.initiativeAttributeKey] ?? 0,
      };
      const { characterSheet: _frozenSheet, ...templateWithoutSheet } =
        template;
      const effectiveTemplate = {
        ...templateWithoutSheet,
        name,
        description,
        attributes,
      };
      const previousIdentity: Partial<TtrpgCharacterSheetV2["identity"]> =
        template.characterSheet?.identity ?? {};
      const characterSheet = createCompleteTtrpgCharacterSheetV2({
        template: effectiveTemplate,
        rulePack,
        authoringMode: "manual",
        progression: template.characterSheet?.rules.progression,
        identity: {
          ...structuredClone(previousIdentity),
          ...structuredClone(input.identity ?? {}),
          name,
          background: input.identity?.background ?? description,
          appearance:
            input.identity?.appearance ??
            previousIdentity.appearance ??
            description,
        },
      });
      return {
        actorKey: characterKey,
        targetKey: characterKey,
        payload: {
          characterKey,
          name,
          description,
          attributes,
          entityAttributes,
          characterSheet,
        },
      };
    },
  });
}

export async function advanceTtrpgCharacterV1(
  input: FormalTtrpgCommandEnvelope & {
    characterKey: string;
    kind: "attribute" | "skill" | "level" | "rank";
    targetKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const characterKey = input.characterKey.trim();
  const targetKey = input.targetKey.trim();
  if (
    !characterKey ||
    !targetKey ||
    !["attribute", "skill", "level", "rank"].includes(input.kind)
  ) {
    throw new Error("[ttrpg] 角色成长请求无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.character.advanced",
    intent: { characterKey, kind: input.kind, targetKey },
    build: async ({ state, rulePack, campaign }) => {
      const product = state.ttrpg?.product;
      const template = campaign.characterTemplates.find(
        (item) => item.characterKey === characterKey && item.role === "player",
      );
      const progression = product?.characterProgression?.[characterKey];
      const entity = state.entities[characterKey];
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        product.safety.status !== "active" ||
        !product.sessionZero.selectedCharacterKeys.includes(characterKey) ||
        !template ||
        !progression ||
        !entity
      ) {
        throw new Error(
          "[ttrpg] 只有已开团、未结局且安全状态正常的本局玩家角色可以成长。",
        );
      }
      const available = availableTtrpgCharacterCurrencyV2(
        product,
        characterKey,
      );
      let cost: number;
      let before: number | string;
      let after: number | string;
      const entityAttributes: Record<string, string | number | boolean | null> =
        {};
      if (input.kind === "attribute") {
        if (!["point-buy", "classless"].includes(progression.model)) {
          throw new Error(
            "[ttrpg] 当前成长模式不能直接购买属性；请使用等级或阶位成长。",
          );
        }
        const definition = rulePack.attributes.find(
          (item) => item.key === targetKey,
        );
        const current = entity.attributes[targetKey];
        const maximum = definition
          ? Math.min(
              definition.maximum,
              rulePack.advancement.maximumAttributeValue,
            )
          : null;
        if (
          !definition ||
          typeof current !== "number" ||
          maximum == null ||
          current >= maximum
        ) {
          throw new Error("[ttrpg] 属性不存在或已达到规则上限。");
        }
        cost = rulePack.advancement.attributeIncreaseCost;
        before = current;
        after = current + 1;
        entityAttributes[targetKey] = after;
      } else if (input.kind === "skill") {
        if (progression.model === "rank")
          throw new Error("[ttrpg] 阶位制角色必须先按阶位规则成长。");
        const base = template.skills[targetKey];
        if (typeof base !== "number")
          throw new Error("[ttrpg] 只能提高冻结角色卡上已有的技能。");
        before = base + (progression.skillIncreases[targetKey] ?? 0);
        const maximum = rulePack.advancement.maximumSkillValue ?? 10;
        if (before >= maximum) throw new Error("[ttrpg] 技能已达到规则上限。");
        cost =
          rulePack.advancement.skillIncreaseCost ??
          rulePack.advancement.attributeIncreaseCost;
        after = before + 1;
      } else if (input.kind === "level") {
        if (progression.model !== "numeric-level" || progression.level == null)
          throw new Error("[ttrpg] 当前角色不是等级制成长。");
        if (progression.level >= (rulePack.advancement.maximumLevel ?? 20))
          throw new Error("[ttrpg] 角色已达到等级上限。");
        cost =
          rulePack.advancement.levelIncreaseCost ??
          rulePack.advancement.attributeIncreaseCost;
        before = progression.level;
        after = progression.level + 1;
      } else {
        if (progression.model !== "rank" || progression.rankKey == null)
          throw new Error("[ttrpg] 当前角色不是阶位制成长。");
        const order = rulePack.advancement.rankOrder?.length
          ? rulePack.advancement.rankOrder
          : ["D", "C", "B", "A"];
        const index = order.indexOf(progression.rankKey);
        if (index < 0 || index >= order.length - 1)
          throw new Error("[ttrpg] 角色已达到最高阶位。");
        cost =
          rulePack.advancement.rankIncreaseCost ??
          rulePack.advancement.attributeIncreaseCost;
        before = progression.rankKey;
        after = order[index + 1];
        const rankPower = entity.attributes.rankPower;
        if (typeof rankPower === "number")
          entityAttributes.rankPower = rankPower + 1;
      }
      if (available < cost) {
        throw new Error(
          `[ttrpg] ${product.advancement.currencyName}不足：需要 ${cost}，当前可用 ${available}。`,
        );
      }
      if (
        Object.keys(entityAttributes).some((field) =>
          rulePack.attributes.some((attribute) => attribute.key === field),
        )
      ) {
        const effectiveAttributes = Object.fromEntries(
          [...rulePack.attributes, ...rulePack.derivedStats].map(
            (attribute) => [
              attribute.key,
              typeof entityAttributes[attribute.key] === "number"
                ? Number(entityAttributes[attribute.key])
                : Number(entity.attributes[attribute.key]),
            ],
          ),
        );
        for (const stat of rulePack.derivedStats) {
          let value = evaluateRuleNumberExpressionV1(
            stat.formula,
            effectiveAttributes,
          );
          if (stat.minimum != null) value = Math.max(stat.minimum, value);
          if (stat.maximum != null) value = Math.min(stat.maximum, value);
          entityAttributes[stat.key] = value;
        }
        for (const resource of rulePack.resources) {
          const maximum = evaluateRuleNumberExpressionV1(
            resource.maximumFormula,
            effectiveAttributes,
          );
          const current = Number(entity.attributes[`resource.${resource.key}`]);
          entityAttributes[`resourceMax.${resource.key}`] = maximum;
          entityAttributes[`resource.${resource.key}`] = Math.max(
            resource.minimum,
            Math.min(maximum, current),
          );
        }
        entityAttributes.hp =
          entityAttributes["resource.vigor"] ?? entity.attributes.hp ?? 1;
        entityAttributes.maxHp =
          entityAttributes["resourceMax.vigor"] ?? entity.attributes.maxHp ?? 1;
        entityAttributes.armorClass =
          entityAttributes.defense ?? entity.attributes.armorClass ?? 8;
        entityAttributes.initiative =
          effectiveAttributes[rulePack.turnStructure.initiativeAttributeKey] ??
          0;
      }
      return {
        actorKey: characterKey,
        targetKey: characterKey,
        payload: {
          characterKey,
          kind: input.kind,
          targetKey,
          before,
          after,
          cost,
          entityAttributes,
        },
      };
    },
  });
}

export async function completeTtrpgSessionZero(
  input: FormalTtrpgCommandEnvelope & {
    acceptedItemKeys: string[];
    selectedCharacterKeys?: string[];
    completedBy: string;
  },
): Promise<ProductRuntimeEvent> {
  const acceptedItemKeys = [
    ...new Set(
      input.acceptedItemKeys.map((item) => item.trim()).filter(Boolean),
    ),
  ].sort();
  const requestedCharacterKeys = [
    ...new Set(
      (input.selectedCharacterKeys ?? [])
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  const completedBy = input.completedBy.trim();
  const previewSession = await db.productRuntimeSessions.get(input.sessionId);
  if (!previewSession) throw new Error("[ttrpg] 正式 TTRPG 实例不存在。");
  const { campaign: previewCampaign } =
    await verifyFormalTtrpgSource(previewSession);
  const allPlayerCharacterKeys = previewCampaign.characterTemplates
    .filter((item) => item.role === "player")
    .map((item) => item.characterKey);
  const selectedCharacterKeys = requestedCharacterKeys.length
    ? requestedCharacterKeys
    : allPlayerCharacterKeys;
  const participantRows = await readTtrpgSessionParticipantsV2(input.sessionId);
  const acknowledgedCharacterKeys = participantRows.flatMap((row) =>
    row.role === "player" &&
    row.actorKey != null &&
    row.controller !== "vacant" &&
    row.assignmentState !== "vacant" &&
    row.assignmentState !== "left"
      ? [row.actorKey]
      : [],
  );
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.session-zero.completed",
    intent: { acceptedItemKeys, selectedCharacterKeys, completedBy },
    build: async ({ state, campaign }) => {
      const product = state.ttrpg?.product;
      if (!product || product.sessionZero.completed)
        throw new Error("[ttrpg] Session Zero 已完成或产品状态缺失。");
      if (!completedBy || completedBy.length > 160)
        throw new Error("[ttrpg] Session Zero 完成人无效。");
      if (
        stableJson(acceptedItemKeys) !==
        stableJson([...product.sessionZero.requiredItemKeys].sort())
      ) {
        throw new Error("[ttrpg] 必须确认全部 Session Zero 安全与共识事项。");
      }
      const allowed = new Set(
        campaign.characterTemplates
          .filter((item) => item.role === "player")
          .map((item) => item.characterKey),
      );
      if (
        selectedCharacterKeys.length < campaign.playerCount.minimum ||
        selectedCharacterKeys.length > campaign.playerCount.maximum ||
        selectedCharacterKeys.some((key) => !allowed.has(key))
      ) {
        throw new Error(
          `[ttrpg] 请选择 ${campaign.playerCount.minimum}–${campaign.playerCount.maximum} 名冻结玩家角色。`,
        );
      }
      const selected = new Set(selectedCharacterKeys);
      const activeSeats = participantRows.filter(
        (row) =>
          row.role === "gm" ||
          (row.actorKey != null && selected.has(row.actorKey)),
      );
      if (
        !activeSeats.some((row) => row.role === "gm") ||
        selectedCharacterKeys.some(
          (characterKey) =>
            !activeSeats.some((row) => row.actorKey === characterKey),
        ) ||
        activeSeats.some(
          (row) =>
            row.controller === "vacant" ||
            row.assignmentState === "vacant" ||
            row.assignmentState === "left",
        )
      ) {
        throw new Error(
          "[ttrpg] Session Zero 仍有未认领、空缺或已离席的活动席位。",
        );
      }
      if (
        activeSeats.some(
          (row) =>
            (row.controller === "ai" || row.controller === "hybrid") &&
            !row.consent.aiIdentityDisclosed,
        )
      ) {
        throw new Error(
          "[ttrpg] Session Zero 必须先向全部活动席位披露 AI 身份。",
        );
      }
      return {
        actorKey: completedBy,
        targetKey: product.campaignKey,
        payload: { acceptedItemKeys, selectedCharacterKeys, completedBy },
      };
    },
    afterCommit: async ({ event }) => {
      await finalizeTtrpgSessionParticipantsV2({
        sessionId: input.sessionId,
        // Session Zero acknowledges every configured seat in the frozen
        // roster. The subset in product.sessionZero remains the opening active
        // party; accepted reserve seats can later reinforce a long campaign
        // without inventing consent after play has started. Vacant reserves
        // remain unavailable until a future roster-release workflow.
        selectedCharacterKeys: acknowledgedCharacterKeys,
        eventSequence: event.sequence,
        completedBy,
      });
    },
  });
}

export async function changeTtrpgSafetyStatus(
  input: FormalTtrpgCommandEnvelope & {
    status: "active" | "paused";
    reason?: string | null;
    changedBy: string;
  },
): Promise<ProductRuntimeEvent> {
  const changedBy = input.changedBy.trim();
  const reason = input.reason?.trim() || null;
  if (
    !changedBy ||
    changedBy.length > 160 ||
    (input.status === "paused" && !reason) ||
    (reason?.length ?? 0) > 2_000
  ) {
    throw new Error("[ttrpg] 安全状态命令无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.safety.changed",
    intent: { status: input.status, reason, changedBy },
    build: async ({ state }) => {
      const product = state.ttrpg?.product;
      if (!product?.sessionZero.completed || product.ending)
        throw new Error("[ttrpg] 当前正式战役不能变更安全状态。");
      if (product.safety.status === input.status)
        throw new Error("[ttrpg] 安全状态没有变化。");
      return {
        actorKey: changedBy,
        targetKey: product.campaignKey,
        payload: { status: input.status, reason, changedBy },
      };
    },
  });
}

function assertFormalTtrpgGmV2(
  participants: import("../types").TtrpgSessionParticipantRecordV2[],
  gmKey: string,
): void {
  const gm = participants.find((row) => row.role === "gm");
  if (
    !gm ||
    ![gm.seatKey, gm.viewerKey].includes(gmKey) ||
    gm.controller === "vacant" ||
    gm.assignmentState === "vacant" ||
    gm.assignmentState === "left" ||
    gm.sessionZeroAcceptedAtSequence == null
  ) {
    throw new Error("[ttrpg] 长期战役命令必须由已确认的本局 GM 提交。");
  }
}

export async function startTtrpgCampaignSessionV2(
  input: FormalTtrpgCommandEnvelope & {
    sessionKey: string;
    title: string;
    participantKeys: string[];
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const sessionKey = longCampaignKey(input.sessionKey, "长期战役分场 key");
  const title = longCampaignText(input.title, "长期战役分场标题", 300);
  const participantKeys = [
    ...new Set(
      input.participantKeys.map((key) =>
        longCampaignKey(key, "长期战役参与者"),
      ),
    ),
  ];
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.session.started",
    intent: { sessionKey, title, participantKeys, gmKey },
    build: async ({ state, sequence, participants }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const campaignState = ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        !campaignState ||
        campaignState.activeSessionKey != null ||
        campaignState.playSessions.some(
          (item) => item.sessionKey === sessionKey,
        )
      ) {
        throw new Error("[ttrpg] 当前正式战役不能开始新的长期分场。");
      }
      const activeRoster = campaignState.roster
        .filter((entry) => entry.status === "active")
        .map((entry) => entry.characterKey)
        .sort();
      if (
        !activeRoster.length ||
        stableJson(activeRoster) !== stableJson([...participantKeys].sort())
      ) {
        throw new Error("[ttrpg] 分场参与者必须精确匹配当前活动编组。");
      }
      for (const characterKey of participantKeys) {
        const seat = participants.find(
          (row) => row.role === "player" && row.actorKey === characterKey,
        );
        if (
          !seat ||
          seat.controller === "vacant" ||
          seat.assignmentState === "vacant" ||
          seat.assignmentState === "left" ||
          seat.sessionZeroAcceptedAtSequence == null ||
          ((seat.controller === "ai" || seat.controller === "hybrid") &&
            !seat.consent.aiIdentityDisclosed)
        ) {
          throw new Error(`[ttrpg] 活动角色席位尚未确认:${characterKey}`);
        }
      }
      return {
        actorKey: gmKey,
        targetKey: product.campaignKey,
        payload: {
          playSession: {
            sessionKey,
            ordinal: campaignState.playSessions.length + 1,
            title,
            status: "active",
            participantKeys,
            startedSequence: sequence,
            completedSequence: null,
            summary: "",
            rulePackContentHash: product.rulePackContentHash,
            campaignKey: product.campaignKey,
          } satisfies TtrpgRuntimeCampaignSessionV2,
        },
      };
    },
  });
}

export async function completeTtrpgCampaignSessionV2(
  input: FormalTtrpgCommandEnvelope & {
    sessionKey: string;
    summary: string;
    memories?: Array<{
      memoryKey: string;
      subjectKey: string;
      summary: string;
      audience: TtrpgRuntimeCampaignMemoryV2["audience"];
    }>;
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const sessionKey = longCampaignKey(input.sessionKey, "长期战役分场 key");
  const summary = longCampaignText(input.summary, "长期战役分场摘要", 20_000);
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  const memoryInputs = (input.memories ?? []).map((memory) =>
    assertTtrpgCampaignMemoryV2({
      ...memory,
      sourceSessionKey: sessionKey,
      updatedSequence: 1,
    }),
  );
  if (
    new Set(memoryInputs.map((item) => item.memoryKey)).size !==
    memoryInputs.length
  ) {
    throw new Error("[ttrpg] 同一分场不能提交重复记忆 key。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.session.completed",
    intent: { sessionKey, summary, memories: memoryInputs, gmKey },
    build: async ({ state, sequence, rulePack, participants }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const campaignState = ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !product?.sessionZero.completed ||
        !campaignState ||
        campaignState.activeSessionKey !== sessionKey ||
        campaignState.playSessions.find(
          (item) => item.sessionKey === sessionKey,
        )?.status !== "active"
      ) {
        throw new Error("[ttrpg] 只能完成当前活动长期分场。");
      }
      if (
        memoryInputs.some(
          (memory) =>
            campaignState.memories.some(
              (prior) => prior.memoryKey === memory.memoryKey,
            ) ||
            (memory.audience.startsWith("actor:") &&
              !campaignState.roster.some(
                (entry) =>
                  entry.characterKey === memory.audience.slice("actor:".length),
              )),
        )
      ) {
        throw new Error("[ttrpg] 长期战役记忆 key 或受众无效。");
      }
      const memories = memoryInputs.map((memory) => ({
        ...memory,
        updatedSequence: sequence,
      }));
      const abilityResets = Object.entries(product.abilityStates ?? {}).flatMap(
        ([stateKey, before]) => {
          const action = rulePack.actions.find(
            (item) => item.key === before.abilityKey,
          );
          if (!action?.usage.reset.includes("session")) return [];
          const after = resetTtrpgAbilityUsageV2({
            definition: {
              abilityKey: action.key,
              actionDefinitionKey: action.key,
              usage: action.usage,
            },
            state: before,
            trigger: "session",
            eventId: `event.${sequence}`,
          });
          return [{ stateKey, before, after }];
        },
      );
      return {
        actorKey: gmKey,
        targetKey: sessionKey,
        payload: { sessionKey, summary, memories, abilityResets },
      };
    },
  });
}

export async function changeTtrpgCampaignRosterV2(
  input: FormalTtrpgCommandEnvelope & {
    characterKey: string;
    status: TtrpgRuntimeRosterEntryV2["status"];
    replacementFor?: string | null;
    reason: string;
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const characterKey = longCampaignKey(input.characterKey, "长期战役角色");
  const replacementFor =
    input.replacementFor == null
      ? null
      : longCampaignKey(input.replacementFor, "补员替代角色");
  const reason = longCampaignText(input.reason, "编组变更理由", 2_000);
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  if (!(["active", "reserve", "retired"] as string[]).includes(input.status))
    throw new Error("[ttrpg] 编组目标状态无效。");
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.roster.changed",
    intent: {
      characterKey,
      status: input.status,
      replacementFor,
      reason,
      gmKey,
    },
    build: async ({ state, sequence, participants }) => {
      const ttrpg = state.ttrpg;
      const campaignState = ttrpg?.campaign;
      const product = ttrpg?.product;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !campaignState ||
        !product?.sessionZero.completed ||
        product.ending ||
        campaignState.activeSessionKey != null
      ) {
        throw new Error("[ttrpg] 编组只能在未结束战役的两场之间调整。");
      }
      const prior = campaignState.roster.find(
        (entry) => entry.characterKey === characterKey,
      );
      if (!prior || prior.status === "retired" || prior.status === input.status)
        throw new Error("[ttrpg] 角色当前编组状态不能执行该迁移。");
      if (input.status === "active") {
        if (prior.status !== "reserve")
          throw new Error("[ttrpg] 只有后备角色可以加入活动编组。");
        const seat = participants.find(
          (row) => row.role === "player" && row.actorKey === characterKey,
        );
        if (
          !seat ||
          seat.controller === "vacant" ||
          seat.assignmentState === "vacant" ||
          seat.assignmentState === "left" ||
          seat.sessionZeroAcceptedAtSequence == null
        ) {
          throw new Error("[ttrpg] 补员席位尚未在 Session Zero 中确认。");
        }
        if (replacementFor != null) {
          const replaced = campaignState.roster.find(
            (entry) => entry.characterKey === replacementFor,
          );
          if (!replaced || replaced.status !== "retired")
            throw new Error("[ttrpg] 补员只能替代已经退役的角色。");
        }
      } else if (prior.status !== "active" || replacementFor != null) {
        throw new Error("[ttrpg] 只有活动角色可以轮换或退役。");
      }
      const lastCompleted = [...campaignState.playSessions]
        .reverse()
        .find((item) => item.status === "completed");
      if (input.status === "retired" && !lastCompleted)
        throw new Error("[ttrpg] 角色至少完成一场后才能正式退役。");
      return {
        actorKey: gmKey,
        targetKey: characterKey,
        payload: {
          entry: {
            ...prior,
            status: input.status,
            leftSessionKey:
              input.status === "retired" ? lastCompleted!.sessionKey : null,
            replacementFor: input.status === "active" ? replacementFor : null,
            reason,
            updatedSequence: sequence,
          } satisfies TtrpgRuntimeRosterEntryV2,
        },
      };
    },
  });
}

export async function activateTtrpgCampaignSupplementV2(
  input: FormalTtrpgCommandEnvelope & {
    supplementKey: string;
    title: string;
    contentHash: string;
    compatibility: TtrpgRuntimeSupplementReceiptV2["compatibility"];
    sourceRef: string;
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const supplementKey = longCampaignKey(input.supplementKey, "补充包 key");
  const title = longCampaignText(input.title, "补充包标题", 300);
  const contentHash = String(input.contentHash).trim();
  const sourceRef = longCampaignKey(input.sourceRef, "补充包来源");
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  if (
    !TTRPG_SHA256.test(contentHash) ||
    !["same-release", "next-release"].includes(input.compatibility)
  ) {
    throw new Error("[ttrpg] 补充包兼容性或内容哈希无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.supplement.activated",
    intent: {
      supplementKey,
      title,
      contentHash,
      compatibility: input.compatibility,
      sourceRef,
      gmKey,
    },
    build: async ({ state, sequence, participants }) => {
      const campaignState = state.ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !state.ttrpg?.product?.sessionZero.completed ||
        !campaignState ||
        campaignState.activeSessionKey != null ||
        campaignState.supplements.some(
          (item) => item.supplementKey === supplementKey,
        )
      ) {
        throw new Error("[ttrpg] 当前不能激活该补充包。");
      }
      const activatedSessionKey =
        [...campaignState.playSessions]
          .reverse()
          .find((item) => item.status === "completed")?.sessionKey ?? null;
      return {
        actorKey: gmKey,
        targetKey: supplementKey,
        payload: {
          supplement: {
            supplementKey,
            title,
            contentHash,
            compatibility: input.compatibility,
            sourceRef,
            activatedSessionKey,
            approvedBy: gmKey,
            updatedSequence: sequence,
          } satisfies TtrpgRuntimeSupplementReceiptV2,
        },
      };
    },
  });
}

export async function recordTtrpgWorldEvolutionV2(
  input: FormalTtrpgCommandEnvelope & {
    candidateKey: string;
    category: TtrpgRuntimeWorldEvolutionV2["category"];
    summary: string;
    sourceSessionKey: string;
    status: TtrpgRuntimeWorldEvolutionV2["status"];
    targetWorldRef?: string | null;
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const candidateKey = longCampaignKey(input.candidateKey, "世界演化候选 key");
  const summary = longCampaignText(input.summary, "世界演化摘要", 8_000);
  const sourceSessionKey = longCampaignKey(
    input.sourceSessionKey,
    "世界演化来源分场",
  );
  const targetWorldRef =
    input.targetWorldRef == null
      ? null
      : longCampaignKey(input.targetWorldRef, "世界演化目标");
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.world-evolution.recorded",
    intent: {
      candidateKey,
      category: input.category,
      summary,
      sourceSessionKey,
      status: input.status,
      targetWorldRef,
      gmKey,
    },
    build: async ({ state, sequence, participants }) => {
      const campaignState = state.ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (!campaignState || campaignState.activeSessionKey != null)
        throw new Error("[ttrpg] 世界演化只能在两场之间处理。");
      const prior = campaignState.worldEvolution.find(
        (item) => item.candidateKey === candidateKey,
      );
      if (
        !campaignState.playSessions.some(
          (item) =>
            item.sessionKey === sourceSessionKey && item.status === "completed",
        ) ||
        (!prior && input.status !== "proposed") ||
        (prior && (prior.status !== "proposed" || input.status === "proposed"))
      ) {
        throw new Error("[ttrpg] 世界演化候选创建或复审状态无效。");
      }
      if (
        prior &&
        (prior.category !== input.category ||
          prior.summary !== summary ||
          prior.sourceSessionKey !== sourceSessionKey ||
          prior.targetWorldRef !== targetWorldRef)
      ) {
        throw new Error("[ttrpg] 世界演化复审不得篡改候选内容。");
      }
      return {
        actorKey: gmKey,
        targetKey: candidateKey,
        payload: {
          candidate: {
            candidateKey,
            category: input.category,
            summary,
            sourceSessionKey,
            status: input.status,
            targetWorldRef,
            reviewedBy: input.status === "proposed" ? null : gmKey,
            updatedSequence: sequence,
          } satisfies TtrpgRuntimeWorldEvolutionV2,
        },
      };
    },
  });
}

export async function recordTtrpgVersionTransitionV2(
  input: FormalTtrpgCommandEnvelope & {
    transitionKey: string;
    toRulePackContentHash: string;
    toCampaignKey: string;
    compatibility: TtrpgRuntimeVersionTransitionV2["compatibility"];
    status: TtrpgRuntimeVersionTransitionV2["status"];
    notes: string;
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const transitionKey = longCampaignKey(input.transitionKey, "版本迁移 key");
  const toRulePackContentHash = String(input.toRulePackContentHash).trim();
  const toCampaignKey = longCampaignKey(
    input.toCampaignKey,
    "迁移后 Campaign key",
  );
  const notes = longCampaignText(input.notes, "版本迁移说明", 8_000);
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  if (!TTRPG_SHA256.test(toRulePackContentHash))
    throw new Error("[ttrpg] 迁移目标 RulePack hash 无效。");
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.version-transition.recorded",
    intent: {
      transitionKey,
      toRulePackContentHash,
      toCampaignKey,
      compatibility: input.compatibility,
      status: input.status,
      notes,
      gmKey,
    },
    build: async ({ state, sequence, participants }) => {
      const product = state.ttrpg?.product;
      const campaignState = state.ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !product ||
        !campaignState ||
        campaignState.activeSessionKey != null ||
        campaignState.versionTransitions.some(
          (item) => item.transitionKey === transitionKey,
        )
      ) {
        throw new Error("[ttrpg] 当前不能记录该版本迁移。");
      }
      if (
        input.status === "activated" &&
        (toRulePackContentHash !== product.rulePackContentHash ||
          toCampaignKey !== product.campaignKey)
      ) {
        throw new Error(
          "[ttrpg] 不得在运行中原地替换冻结规则；请创建跨版本续团 Instance。",
        );
      }
      return {
        actorKey: gmKey,
        targetKey: transitionKey,
        payload: {
          transition: {
            transitionKey,
            fromRulePackContentHash: product.rulePackContentHash,
            toRulePackContentHash,
            fromCampaignKey: product.campaignKey,
            toCampaignKey,
            compatibility: input.compatibility,
            status: input.status,
            notes,
            approvedBy: gmKey,
            updatedSequence: sequence,
          } satisfies TtrpgRuntimeVersionTransitionV2,
        },
      };
    },
  });
}

export async function openTtrpgCampaignScene(
  input: FormalTtrpgCommandEnvelope & {
    sceneKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const sceneKey = input.sceneKey.trim();
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.scene.opened",
    intent: { sceneKey },
    build: async ({ session, state, sequence, rulePack, campaign }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      if (!ttrpg || !product?.sessionZero.completed)
        throw new Error("[ttrpg] 请先完成 Session Zero。");
      if (product.ending) throw new Error("[ttrpg] 正式战役已经结束。");
      const scene = campaign.scenes.find((item) => item.sceneKey === sceneKey);
      if (!scene) throw new Error("[ttrpg] 场景不属于冻结 CampaignPack。");
      if (!ttrpg.scene && sceneKey !== product.openingSceneKey) {
        throw new Error("[ttrpg] 正式战役必须从冻结开场场景开始。");
      }
      if (ttrpg.scene?.sceneKey) {
        const current = campaign.scenes.find(
          (item) => item.sceneKey === ttrpg.scene?.sceneKey,
        );
        if (!current?.nextSceneKeys.includes(sceneKey)) {
          throw new Error("[ttrpg] 只能进入当前冻结场景声明的后继场景。");
        }
      }
      const allPlayers = campaign.characterTemplates
        .filter((item) => item.role === "player")
        .map((item) => item.characterKey);
      const selectedPlayers = product.sessionZero.selectedCharacterKeys.length
        ? product.sessionZero.selectedCharacterKeys
        : allPlayers;
      const playerSet = new Set(allPlayers);
      const participants = (
        scene.participantKeys.length ? scene.participantKeys : selectedPlayers
      ).filter((key) => !playerSet.has(key) || selectedPlayers.includes(key));
      if (!participants.length)
        throw new Error("[ttrpg] 正式场景没有可用行动者。");
      const initiativeEntries = await Promise.all(
        participants.map(async (actorKey) => {
          const modifier = Number(
            state.entities[actorKey]?.attributes[
              rulePack.turnStructure.initiativeAttributeKey
            ],
          );
          if (!Number.isFinite(modifier))
            throw new Error(`[ttrpg] 角色缺少先攻属性:${actorKey}`);
          const nonce = `${input.commandId}:${sequence}:initiative:${actorKey}`;
          const rolled = await resolveRulePackDiceModelV1({
            rulePack,
            diceModelKey: rulePack.turnStructure.initiativeDiceModelKey,
            seed: session.seed,
            nonce,
            modifier,
          });
          return {
            actorKey,
            rolledDice: rolled.dice,
            keptDice: rolled.keptDice,
            modifier,
            total: rolled.total,
            rollTrace: rolled.rollTrace,
            seedCommitment: rolled.seedCommitment,
            nonce: rolled.nonce,
            proofHash: rolled.proofHash,
          };
        }),
      );
      initiativeEntries.sort(
        (left, right) =>
          right.total - left.total ||
          left.actorKey.localeCompare(right.actorKey),
      );
      const turnOrder = initiativeEntries.map((entry) => entry.actorKey);
      const abilityResets = Object.entries(product.abilityStates ?? {}).flatMap(
        ([stateKey, before]) => {
          const action = rulePack.actions.find(
            (item) => item.key === before.abilityKey,
          );
          if (!action?.usage.reset.includes("scene")) return [];
          const after = resetTtrpgAbilityUsageV2({
            definition: {
              abilityKey: action.key,
              actionDefinitionKey: action.key,
              usage: action.usage,
            },
            state: before,
            trigger: "scene",
            eventId: `event.${sequence}`,
          });
          return [{ stateKey, before, after }];
        },
      );
      return {
        actorKey: turnOrder[0],
        targetKey: scene.locationKey,
        payload: {
          scene: {
            sceneId: `campaign-scene:${scene.sceneKey}:${sequence}`,
            sceneKey: scene.sceneKey,
            title: scene.title,
            description: scene.description,
            locationKey: scene.locationKey,
            status: "active",
          },
          turnOrder,
          initiative: {
            sceneKey: scene.sceneKey,
            diceModelKey: rulePack.turnStructure.initiativeDiceModelKey,
            attributeKey: rulePack.turnStructure.initiativeAttributeKey,
            entries: initiativeEntries,
          },
          abilityResets,
        },
      };
    },
  });
}

export async function updateTtrpgTabletopV1(
  input: FormalTtrpgCommandEnvelope & {
    role: "gm" | "player";
    actorKey: string;
    operation: TtrpgTabletopOperationV1;
  },
): Promise<ProductRuntimeEvent> {
  const actorKey = input.actorKey.trim();
  const operation = parseTtrpgTabletopOperationV1(input.operation);
  if (
    !actorKey ||
    actorKey.length > 200 ||
    !["gm", "player"].includes(input.role)
  ) {
    throw new Error("[ttrpg] 桌面操作者无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.tabletop.updated",
    intent: { role: input.role, actorKey, operation },
    build: async ({ state, sequence }) => {
      const product = state.ttrpg?.product;
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        !product.tabletop ||
        !state.ttrpg?.scene ||
        state.ttrpg.scene.status !== "active"
      ) {
        throw new Error("[ttrpg] 当前正式战役没有可操作桌面。");
      }
      if (
        input.role === "player" &&
        !product.sessionZero.selectedCharacterKeys.includes(actorKey)
      ) {
        throw new Error("[ttrpg] 玩家桌面操作者不在本局角色名单中。");
      }
      applyTtrpgTabletopOperationV1({
        tabletop: structuredClone(product.tabletop),
        role: input.role,
        actorKey,
        operation,
        sequence,
      });
      const targetKey =
        operation.kind === "set-fog"
          ? operation.fogKey
          : operation.kind === "set-layer"
            ? operation.layerKey
            : operation.tokenKey;
      return {
        actorKey,
        targetKey,
        payload: { role: input.role, actorKey, operation },
      };
    },
  });
}

/**
 * Atomically grants, transfers, consumes, equips or changes one ItemInstance.
 * The formal command id is also the inventory idempotency key, so transport
 * retries cannot duplicate loot or apply a stale transfer twice.
 */
export async function commitTtrpgItemCommandV2(
  input: FormalTtrpgCommandEnvelope & {
    command: import("../ttrpg/item-ledger").TtrpgItemCommandV2;
    requestedBy: { role: "gm" | "player"; actorKey: string };
  },
): Promise<ProductRuntimeEvent> {
  const command = parseTtrpgItemCommandV2(input.command);
  if (!input.requestedBy || typeof input.requestedBy !== "object") {
    throw new Error("[ttrpg] 物品命令必须声明已验证的操作者。");
  }
  const requestedBy = {
    role: input.requestedBy.role,
    actorKey: input.requestedBy.actorKey.trim(),
  };
  if (
    !["gm", "player"].includes(requestedBy.role) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(requestedBy.actorKey)
  ) {
    throw new Error("[ttrpg] 物品命令操作者无效。");
  }
  if (command.commandId !== input.commandId.trim()) {
    throw new Error("[ttrpg] 物品命令必须复用正式 commandId 作为幂等键。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.item.changed",
    intent: { command, requestedBy },
    build: async ({ state, sequence, rulePack, participants }) => {
      const product = state.ttrpg?.product;
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        !product.inventory
      ) {
        throw new Error("[ttrpg] 当前正式战役没有可操作库存。");
      }
      if (requestedBy.role === "gm") {
        assertFormalTtrpgGmV2(participants, requestedBy.actorKey);
      } else {
        const seat = participants.find(
          (row) =>
            row.role === "player" && row.actorKey === requestedBy.actorKey,
        );
        const prior = product.inventory.items[command.instanceId];
        if (
          !seat ||
          !["human", "hybrid"].includes(seat.controller) ||
          seat.assignmentState !== "claimed" ||
          seat.sessionZeroAcceptedAtSequence == null ||
          !prior ||
          prior.ownerRef !== requestedBy.actorKey ||
          ["grant", "remove"].includes(command.kind)
        ) {
          throw new Error(
            "[ttrpg] 玩家只能操作自己持有的物品，授予与移除由 GM 负责。",
          );
        }
      }
      if (command.kind === "grant" && command.eventId !== `event.${sequence}`) {
        throw new Error(
          `[ttrpg] 新物品 acquiredByEventId 必须为 event.${sequence}。`,
        );
      }
      const entityRefs =
        command.kind === "grant"
          ? [command.ownerRef, command.locationRef]
          : command.kind === "transfer"
            ? [command.expectedOwnerRef, command.destinationOwnerRef]
            : "expectedOwnerRef" in command
              ? [command.expectedOwnerRef]
              : [];
      if (entityRefs.some((ref) => ref != null && !state.entities[ref])) {
        throw new Error("[ttrpg] 物品所有者或地点不属于当前冻结运行时。");
      }
      const definitions = Object.fromEntries(
        rulePack.items.map((item) => [
          item.key,
          ttrpgItemDefinitionFromRuleV1(item),
        ]),
      );
      const applied = applyTtrpgItemCommandV2({
        state: product.inventory,
        definitions,
        command,
      });
      if (applied.replayed) throw new Error("[ttrpg] 物品命令已经执行。");
      const prior = product.inventory.items[command.instanceId];
      const actorKey = requestedBy.actorKey;
      const targetKey =
        command.kind === "transfer"
          ? command.destinationOwnerRef
          : (prior?.ownerRef ?? command.instanceId);
      return {
        actorKey,
        targetKey,
        payload: {
          command,
          requestedBy,
          // Frozen RulePack definitions are included so replay never reads mutable DB rows.
          definitions: Object.fromEntries(
            rulePack.items.map((item) => [item.key, item]),
          ),
        },
      };
    },
  });
}

/** Commit one closed reward/penalty plan as an all-or-nothing replayable event. */
export async function commitTtrpgEffectPlanV2(
  input: FormalTtrpgCommandEnvelope & {
    plan: import("../types").TtrpgEffectPlanV2;
    /** When set, this plan is the single authoritative consequence ledger for that resolved action. */
    actionSequence?: number;
  },
): Promise<ProductRuntimeEvent> {
  const plan = parseTtrpgEffectPlanV2(input.plan);
  const actionSequence =
    input.actionSequence == null
      ? null
      : assertFiniteInteger(
          input.actionSequence,
          "EffectPlan 来源行动序号",
          1,
          Number.MAX_SAFE_INTEGER,
        );
  if (plan.idempotencyKey !== input.commandId.trim()) {
    throw new Error("[ttrpg] EffectPlan 必须复用正式 commandId 作为幂等键。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.effects.applied",
    intent: { plan, actionSequence },
    build: async ({ state, sequence, rulePack }) => {
      const product = state.ttrpg?.product;
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        !product.effectLedger
      ) {
        throw new Error("[ttrpg] 当前正式战役没有可提交的效果账本。");
      }
      if (actionSequence != null) {
        const sourceAction = product.actionHistory.find(
          (action) => action.eventSequence === actionSequence,
        );
        if (
          !sourceAction ||
          plan.sourceEventId !== `event.${actionSequence}` ||
          plan.ruleRef !== sourceAction.actionKey
        ) {
          throw new Error(
            "[ttrpg] 行动后果必须精确引用已经提交的规则行动与 actionKey。",
          );
        }
        const expectedDegree =
          sourceAction.outcome === "automatic"
            ? "success"
            : sourceAction.outcome;
        if (plan.degree !== expectedDegree) {
          throw new Error("[ttrpg] 行动后果等级与冻结判定结果不一致。");
        }
        if (
          product.effectLedger.entries.some(
            (entry) => entry.sourceEventId === plan.sourceEventId,
          ) ||
          product.effectLedger.pendingChoices.some(
            (choice) => choice.plan.sourceEventId === plan.sourceEventId,
          )
        ) {
          throw new Error("[ttrpg] 该规则行动已经提交过唯一后果计划。");
        }
      }
      applyTtrpgEffectPlanToRuntimeV2({
        state,
        rulePack,
        plan,
        eventSequence: sequence,
      });
      const audienceActor = plan.audience.startsWith("actor:")
        ? plan.audience.slice("actor:".length)
        : null;
      return {
        actorKey: audienceActor,
        targetKey: plan.effects[0]?.targetRef ?? product.campaignKey,
        payload: { plan, rulePack },
      };
    },
  });
}

/** Record a GM-authored set of mutually-exclusive consequences without applying one. */
export async function proposeTtrpgEffectChoiceV2(
  input: FormalTtrpgCommandEnvelope & {
    plan: import("../types").TtrpgEffectPlanV2;
    actionSequence: number;
    ownerActorKey: string;
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const plan = parseTtrpgEffectPlanV2(input.plan);
  const actionSequence = assertFiniteInteger(
    input.actionSequence,
    "效果选择来源行动序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const ownerActorKey = normalizeCommandId(input.ownerActorKey);
  const gmKey = normalizeCommandId(input.gmKey);
  if (plan.idempotencyKey !== input.commandId.trim()) {
    throw new Error("[ttrpg] 效果选择提议必须复用正式 commandId 作为幂等键。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.effects.choice.proposed",
    intent: { plan, actionSequence, ownerActorKey, gmKey },
    build: async ({ state, sequence, participants }) => {
      assertFormalTtrpgGmV2(participants, gmKey);
      proposeTtrpgEffectChoiceToRuntimeV2({
        state,
        plan,
        actionSequence,
        ownerActorKey,
        eventSequence: sequence,
      });
      return {
        actorKey: "gm",
        targetKey: ownerActorKey,
        payload: { plan, actionSequence, ownerActorKey },
      };
    },
  });
}

/** Resolve one pending consequence choice through the owning seat authority. */
export async function resolveTtrpgEffectChoiceV2(
  input: FormalTtrpgCommandEnvelope & {
    choiceKey: string;
    selectedEffectKey: string;
    requestedBy: { role: "gm" | "player"; actorKey: string };
    gmKey?: string;
  },
): Promise<ProductRuntimeEvent> {
  const choiceKey = normalizeCommandId(input.choiceKey);
  const selectedEffectKey = normalizeCommandId(input.selectedEffectKey);
  const requestedBy = {
    role: input.requestedBy?.role,
    actorKey: normalizeCommandId(input.requestedBy?.actorKey ?? ""),
  };
  const gmKey = input.gmKey == null ? null : normalizeCommandId(input.gmKey);
  if (!["gm", "player"].includes(requestedBy.role)) {
    throw new Error("[ttrpg] 效果选择操作者无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.effects.applied",
    intent: { choiceKey, selectedEffectKey, requestedBy, gmKey },
    build: async ({ state, sequence, rulePack, participants }) => {
      const product = state.ttrpg?.product;
      const choice = product?.effectLedger?.pendingChoices.find(
        (item) => item.choiceKey === choiceKey,
      );
      if (!product?.sessionZero.completed || product.ending || !choice) {
        throw new Error("[ttrpg] 待选择后果不存在或当前战役不可结算。");
      }
      if (choice.ownerActorKey !== requestedBy.actorKey) {
        throw new Error("[ttrpg] 只能结算自己角色的后果选择。");
      }
      const seat = participants.find(
        (row) => row.role === "player" && row.actorKey === choice.ownerActorKey,
      );
      if (requestedBy.role === "player") {
        if (
          !seat ||
          !["human", "hybrid"].includes(seat.controller) ||
          seat.assignmentState !== "claimed" ||
          seat.sessionZeroAcceptedAtSequence == null
        ) {
          throw new Error("[ttrpg] 该角色没有可确认选择的真人席位。");
        }
      } else {
        if (!gmKey) throw new Error("[ttrpg] GM 代管选择缺少主持身份。");
        assertFormalTtrpgGmV2(participants, gmKey);
        if (!seat || seat.controller !== "ai") {
          throw new Error("[ttrpg] GM 只能代纯 AI 玩家席位确认后果选择。");
        }
      }
      const resolved = resolveTtrpgEffectChoiceToRuntimeV2({
        state,
        rulePack,
        choiceKey,
        selectedEffectKey,
        commandId: input.commandId,
        eventSequence: sequence,
      });
      return {
        actorKey: choice.ownerActorKey,
        targetKey: resolved.plan.effects[0].targetRef,
        payload: {
          choiceKey,
          selectedEffectKey,
          requestedBy,
          plan: resolved.plan,
          rulePack,
        },
      };
    },
  });
}

export async function discoverTtrpgClue(
  input: FormalTtrpgCommandEnvelope & {
    clueKey: string;
    actorKey: string;
    visibility: "private" | "party";
  },
): Promise<ProductRuntimeEvent> {
  const clueKey = input.clueKey.trim();
  const actorKey = input.actorKey.trim();
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.clue.discovered",
    intent: { clueKey, actorKey, visibility: input.visibility },
    build: async ({ state, campaign }) => {
      if (
        !state.ttrpg?.product?.sessionZero.completed ||
        !state.ttrpg.scene?.sceneKey
      ) {
        throw new Error("[ttrpg] 请先完成 Session Zero 并打开正式场景。");
      }
      const clue = campaign.clues.find((item) => item.clueKey === clueKey);
      if (
        !clue ||
        !state.ttrpg.scene ||
        !campaign.scenes.find(
          (item) =>
            item.sceneKey === state.ttrpg!.scene!.sceneKey &&
            item.clueKeys.includes(clueKey),
        )
      )
        throw new Error("[ttrpg] 当前场景不包含该线索。");
      if (clue.visibility === "gm-only")
        throw new Error("[ttrpg] GM 私密线索不能通过玩家发现命令公开。");
      if (clue.visibility === "public" && input.visibility !== "party")
        throw new Error("[ttrpg] 公开线索必须对队伍可见。");
      const existing = state.ttrpg.product.discoveredClues.find(
        (item) => item.clueKey === clueKey,
      );
      if (
        existing &&
        !(existing.visibility === "private" && input.visibility === "party")
      ) {
        throw new Error("[ttrpg] 该线索已经发现。");
      }
      const actor = state.entities[actorKey];
      if (
        !actor ||
        !["player", "character"].includes(actor.kind) ||
        (state.ttrpg.product.sessionZero.selectedCharacterKeys.length > 0 &&
          !state.ttrpg.product.sessionZero.selectedCharacterKeys.includes(
            actorKey,
          ))
      ) {
        throw new Error("[ttrpg] 线索发现者不是本局已选择的玩家角色。");
      }
      return {
        actorKey,
        targetKey: clueKey,
        payload: { clueKey, actorKey, visibility: input.visibility },
      };
    },
  });
}

function resolveTtrpgActionSkillV2(input: {
  state: ProductRuntimeState;
  campaign: TtrpgCampaignContentV1;
  actorKey: string;
  actionKey: string;
}): { skillKey: string; skillValue: number } {
  const template = input.campaign.characterTemplates.find(
    (item) => item.characterKey === input.actorKey,
  );
  if (!template) throw new Error("[ttrpg] 技能判定角色不在冻结 CampaignPack。");
  const customization =
    input.state.ttrpg?.product?.characterCustomizations.find(
      (item) => item.characterKey === input.actorKey,
    );
  const raw =
    customization?.characterSheet?.rules.skills[input.actionKey] ??
    template.characterSheet?.rules.skills[input.actionKey] ??
    template.skills[input.actionKey] ??
    0;
  if (!Number.isFinite(raw) || raw < -1_000 || raw > 1_000) {
    throw new Error(
      `[ttrpg] 角色技能值无效:${input.actorKey}.${input.actionKey}`,
    );
  }
  return { skillKey: input.actionKey, skillValue: Number(raw) };
}

export function classifyTtrpgSubmittedIntentV2(input: {
  state: ProductRuntimeState;
  campaign: TtrpgCampaignContentV1;
  rulePack: ReturnType<typeof parseRulePackV1>;
  actorKey: string;
  actionKey: string | null;
  targetKey: string | null;
}): {
  status: "needs-clarification" | "rejected-illegal" | null;
  reason: string;
  suggestedActionKeys: string[];
} {
  const ttrpg = input.state.ttrpg;
  const product = ttrpg?.product;
  const scene = input.campaign.scenes.find(
    (item) => item.sceneKey === ttrpg?.scene?.sceneKey,
  );
  const template = input.campaign.characterTemplates.find(
    (item) => item.characterKey === input.actorKey,
  );
  const itemActionKeys = Object.values(product?.inventory?.items ?? {})
    .filter(
      (item) =>
        item.ownerRef === input.actorKey && !item.stateTags.includes("broken"),
    )
    .flatMap(
      (item) =>
        input.rulePack.items.find(
          (definition) => definition.key === item.definitionRef,
        )?.grantedActionKeys ?? [],
    );
  const granted = new Set([...(template?.actionKeys ?? []), ...itemActionKeys]);
  const suggestedActionKeys = (scene?.actionKeys ?? [])
    .filter((actionKey) => granted.has(actionKey))
    .slice(0, 12);
  if (!ttrpg || !product?.sessionZero.completed || !scene || !template) {
    return {
      status: "rejected-illegal",
      reason: "当前尚未完成 Session Zero 或打开可行动场景。",
      suggestedActionKeys,
    };
  }
  if (!input.actionKey) {
    return {
      status: "needs-clarification",
      reason:
        "请确认这段描述要使用哪一项规则行动；系统不会替你暗选风险、资源或检定方式。",
      suggestedActionKeys,
    };
  }
  const action = input.rulePack.actions.find(
    (item) => item.key === input.actionKey,
  );
  if (
    !action ||
    !scene.actionKeys.includes(input.actionKey) ||
    !granted.has(input.actionKey)
  ) {
    return {
      status: "rejected-illegal",
      reason: "当前场景、角色卡或所持物品没有授予这项规则行动。",
      suggestedActionKeys,
    };
  }
  if (!ttrpg.turnOrder.includes(input.actorKey)) {
    return {
      status: "rejected-illegal",
      reason: "该角色不在当前场景，不能感知或执行这里的行动。",
      suggestedActionKeys,
    };
  }
  if (action.phase !== "reaction" && ttrpg.activeActorKey !== input.actorKey) {
    return {
      status: "rejected-illegal",
      reason: `当前轮到 ${ttrpg.activeActorKey ?? "其他角色"}，本行动不会掷骰或消耗资源。`,
      suggestedActionKeys,
    };
  }
  const requirement = evaluateTtrpgActionRequirementsV2({
    action,
    rulePack: input.rulePack,
    actorAttributes: input.state.entities[input.actorKey]?.attributes,
    actorConditions: product.conditions[input.actorKey],
  });
  if (!requirement.met) {
    return {
      status: "rejected-illegal",
      reason: requirement.reason!,
      suggestedActionKeys: suggestedActionKeys.filter(
        (actionKey) => actionKey !== action.key,
      ),
    };
  }
  if (
    action.target === "self" &&
    input.targetKey != null &&
    input.targetKey !== input.actorKey
  ) {
    return {
      status: "rejected-illegal",
      reason: "这项行动只能以行动者自己为目标。",
      suggestedActionKeys,
    };
  }
  if (
    ["single-ally", "single-enemy"].includes(action.target) &&
    (!input.targetKey ||
      input.targetKey === input.actorKey ||
      !ttrpg.turnOrder.includes(input.targetKey))
  ) {
    return {
      status: "needs-clarification",
      reason: "请指定当前场景中的另一名合法目标。",
      suggestedActionKeys,
    };
  }
  const ability =
    product.abilityStates?.[ttrpgAbilityStateKeyV2(input.actorKey, action.key)];
  if (!ability) {
    return {
      status: "rejected-illegal",
      reason: "角色缺少这项能力的冻结次数账本。",
      suggestedActionKeys,
    };
  }
  if (ability.disabledReasons.length > 0) {
    return {
      status: "rejected-illegal",
      reason: `能力当前被禁用：${ability.disabledReasons.join("、")}。`,
      suggestedActionKeys,
    };
  }
  if (ability.remainingUses === 0) {
    const resetLabels = action.usage.reset.map(
      (trigger) =>
        ({
          turn: "下一回合",
          round: "下一轮",
          scene: "下一场景",
          encounter: "遭遇结束",
          session: "下一场游戏",
          "short-rest": "短休",
          "long-rest": "长休",
          "manual-gm": "KP 手动恢复",
          milestone: "指定里程碑",
        })[trigger] ?? trigger,
    );
    return {
      status: "rejected-illegal",
      reason: `次数已耗尽；${resetLabels.length ? `${resetLabels.join("或")}恢复` : "当前规则没有自动恢复条件"}。本次没有掷骰、消耗或重复奖励。`,
      suggestedActionKeys: suggestedActionKeys.filter(
        (actionKey) => actionKey !== action.key,
      ),
    };
  }
  if (
    ability.cooldownUntilRound != null &&
    ttrpg.round < ability.cooldownUntilRound
  ) {
    return {
      status: "rejected-illegal",
      reason: `能力冷却到第 ${ability.cooldownUntilRound} 轮；当前是第 ${ttrpg.round} 轮。`,
      suggestedActionKeys: suggestedActionKeys.filter(
        (actionKey) => actionKey !== action.key,
      ),
    };
  }
  const resourceCosts = new Map<string, number>();
  if (action.usage.resourceKey && (action.usage.cost ?? 0) > 0) {
    resourceCosts.set(action.usage.resourceKey, action.usage.cost ?? 0);
  }
  if (action.costResourceKey && action.costAmount > 0) {
    resourceCosts.set(
      action.costResourceKey,
      (resourceCosts.get(action.costResourceKey) ?? 0) + action.costAmount,
    );
  }
  for (const [resourceKey, resourceCost] of resourceCosts) {
    const available =
      input.state.entities[input.actorKey]?.attributes[
        `resource.${resourceKey}`
      ];
    if (typeof available !== "number" || available < resourceCost) {
      return {
        status: "rejected-illegal",
        reason: `资源不足：${resourceKey} 需要 ${resourceCost}，当前 ${typeof available === "number" ? available : 0}。`,
        suggestedActionKeys: suggestedActionKeys.filter(
          (actionKey) => actionKey !== action.key,
        ),
      };
    }
  }
  if (action.usage.sharedPoolKey) {
    const pool = product.usagePools?.[action.usage.sharedPoolKey];
    if (!pool || pool.remaining < (action.usage.cost ?? 1)) {
      return {
        status: "rejected-illegal",
        reason: `共享次数池 ${action.usage.sharedPoolKey} 不足。`,
        suggestedActionKeys: suggestedActionKeys.filter(
          (actionKey) => actionKey !== action.key,
        ),
      };
    }
  }
  try {
    if (product.actionEconomy) {
      spendTtrpgActionEconomyV2({
        economy: product.actionEconomy,
        turnOrder: ttrpg.turnOrder,
        actorKey: input.actorKey,
        phase: action.phase,
      });
    }
  } catch (cause) {
    return {
      status: "rejected-illegal",
      reason: cause instanceof Error ? cause.message : String(cause),
      suggestedActionKeys: suggestedActionKeys.filter(
        (actionKey) => actionKey !== action.key,
      ),
    };
  }
  return {
    status: null,
    reason: "行动合法，进入冻结 RulePack 裁决。",
    suggestedActionKeys,
  };
}

/**
 * Human/GM intent gate. Legal declarations resolve through the same RulePack
 * action event; unclear or illegal declarations still commit one terminal,
 * player-visible receipt without rolling dice or mutating mechanics.
 */
export async function submitTtrpgActionIntentV2(
  input: FormalTtrpgCommandEnvelope & {
    intentKey: string;
    actorKey: string;
    rawInput: string;
    actionKey?: string | null;
    targetKey?: string | null;
    goal?: string | null;
    method?: string | null;
    difficulty?: number;
    situationalModifier?: number;
    rollVisibility?: "public" | "gm-only";
    submittedBy: { role: "gm" | "player"; viewerKey: string };
  },
): Promise<ProductRuntimeEvent> {
  const intentKey = input.intentKey.trim();
  const actorKey = input.actorKey.trim();
  const rawInput = input.rawInput.trim().normalize("NFC");
  const actionKey = input.actionKey?.trim() || null;
  const targetKey = input.targetKey?.trim() || null;
  const goal = input.goal?.trim().normalize("NFC") || null;
  const method = input.method?.trim().normalize("NFC") || null;
  const submittedBy = {
    role: input.submittedBy?.role,
    viewerKey: input.submittedBy?.viewerKey?.trim() ?? "",
  };
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(intentKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(actorKey) ||
    !rawInput ||
    rawInput.length > 10_000 ||
    (goal?.length ?? 0) > 2_000 ||
    (method?.length ?? 0) > 2_000 ||
    !["gm", "player"].includes(String(submittedBy.role)) ||
    !submittedBy.viewerKey
  ) {
    throw new Error("[ttrpg] 行动意图提交字段无效。");
  }
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (!session) throw new Error("[ttrpg] 正式 TTRPG 实例不存在。");
  const prior = (await readSessionEvents(session)).find(
    (event) => event.commandId === input.commandId.trim(),
  );
  if (prior) {
    const payload = parseEventPayload(prior);
    const priorIntent =
      prior.type === "ttrpg.intent.receipted" && isObject(payload.receipt)
        ? parseTtrpgIntentReceiptV2(payload.receipt)
        : prior.type === "ttrpg.rule.action.resolved" &&
            isObject(payload.result)
          ? assertTtrpgRuleActionResult(payload.result).receipt?.context
              .declaredIntent
          : null;
    if (
      !priorIntent ||
      priorIntent.intentKey !== intentKey ||
      priorIntent.rawInput !== rawInput
    ) {
      throw new Error("[ttrpg] commandId 已被不同行动意图使用。");
    }
    return prior;
  }
  const [state, version, frozen, participants] = await Promise.all([
    readProductRuntimeState(input.sessionId),
    readProductRuntimeStateVersion(input.sessionId),
    verifyFormalTtrpgSource(session),
    readTtrpgSessionParticipantsV2(input.sessionId),
  ]);
  if (
    version.sequence !== input.baseSequence ||
    version.stateHash !== input.baseStateHash
  ) {
    throw new Error("[ttrpg] 战役状态已变化，请刷新后重试。");
  }
  if (submittedBy.role === "gm") {
    assertFormalTtrpgGmV2(participants, submittedBy.viewerKey);
  } else {
    const seat = participants.find(
      (row) =>
        row.role === "player" &&
        row.actorKey === actorKey &&
        row.viewerKey === submittedBy.viewerKey,
    );
    if (
      !seat ||
      !["human", "hybrid"].includes(seat.controller) ||
      seat.assignmentState !== "claimed" ||
      seat.sessionZeroAcceptedAtSequence == null
    ) {
      throw new Error("[ttrpg] 当前 viewer 没有为该角色提交行动的席位权限。");
    }
  }
  const classification = classifyTtrpgSubmittedIntentV2({
    state,
    campaign: frozen.campaign,
    rulePack: frozen.rulePack,
    actorKey,
    actionKey,
    targetKey,
  });
  if (classification.status == null && actionKey) {
    return resolveTtrpgRuleAction({
      sessionId: input.sessionId,
      commandId: input.commandId,
      baseSequence: input.baseSequence,
      baseStateHash: input.baseStateHash,
      actionKey,
      actorKey,
      targetKey,
      difficulty: input.difficulty,
      situationalModifier: input.situationalModifier,
      rollVisibility: input.rollVisibility,
      declaredIntent: { intentKey, rawInput, goal, method },
    });
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.intent.receipted",
    intent: {
      intentKey,
      actorKey,
      rawInput,
      actionKey,
      targetKey,
      goal,
      method,
      submittedBy,
    },
    build: async ({
      state: current,
      sequence,
      campaign,
      rulePack,
      participants,
    }) => {
      if (submittedBy.role === "gm") {
        assertFormalTtrpgGmV2(participants, submittedBy.viewerKey);
      } else if (
        !participants.some(
          (row) =>
            row.role === "player" &&
            row.actorKey === actorKey &&
            row.viewerKey === submittedBy.viewerKey &&
            ["human", "hybrid"].includes(row.controller) &&
            row.assignmentState === "claimed" &&
            row.sessionZeroAcceptedAtSequence != null,
        )
      ) {
        throw new Error("[ttrpg] 当前 viewer 没有为该角色提交行动的席位权限。");
      }
      const terminal = classifyTtrpgSubmittedIntentV2({
        state: current,
        campaign,
        rulePack,
        actorKey,
        actionKey,
        targetKey,
      });
      if (terminal.status == null) {
        throw new Error("[ttrpg] 行动已经合法，请刷新并进入正式规则裁决。");
      }
      const receipt: TtrpgRuntimeIntentReceiptV2 = {
        schema: "storyforge.ttrpg-intent-receipt",
        version: 2,
        receiptKey: `intent-receipt.${sequence}`,
        eventSequence: sequence,
        intentKey,
        actorKey,
        rawInput,
        proposedActionKey: actionKey,
        targetKey,
        terminalStatus: terminal.status,
        reason: terminal.reason,
        suggestedActionKeys: terminal.suggestedActionKeys,
      };
      return { actorKey, targetKey, payload: { receipt } };
    },
  });
}

/** Records one human-owned, non-mechanical response to an ActionReceipt prompt window. */
export async function recordTtrpgHumanResponseV2(
  input: FormalTtrpgCommandEnvelope & {
    actionSequence: number;
    actionReceiptKey: string;
    actorKey: string;
    kind: "speak" | "act-narratively" | "decline";
    text?: string;
    audience: "party" | "gm-only";
    viewerKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const actionSequence = assertFiniteInteger(
    input.actionSequence,
    "真人回应行动序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const actionReceiptKey = input.actionReceiptKey.trim();
  const actorKey = input.actorKey.trim();
  const viewerKey = input.viewerKey.trim();
  const kind = input.kind;
  const audience = input.audience;
  const text =
    kind === "decline"
      ? "本角色选择不作额外回应。"
      : String(input.text ?? "")
          .trim()
          .normalize("NFC");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(actionReceiptKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(actorKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(viewerKey) ||
    !["speak", "act-narratively", "decline"].includes(kind) ||
    !["party", "gm-only"].includes(audience) ||
    !text ||
    text.length > 10_000
  ) {
    throw new Error("[ttrpg] 真人角色回应字段无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.human-response.recorded",
    intent: {
      actionSequence,
      actionReceiptKey,
      actorKey,
      kind,
      text,
      audience,
      viewerKey,
    },
    build: async ({ state, sequence, participants }) => {
      const product = state.ttrpg?.product;
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        product.safety.status !== "active"
      ) {
        throw new Error("[ttrpg] 当前战役不能提交真人角色回应。");
      }
      const seat = participants.find(
        (row) =>
          row.role === "player" &&
          row.actorKey === actorKey &&
          row.viewerKey === viewerKey,
      );
      if (
        !seat ||
        !["human", "hybrid"].includes(seat.controller) ||
        seat.assignmentState !== "claimed" ||
        seat.sessionZeroAcceptedAtSequence == null
      ) {
        throw new Error("[ttrpg] 当前 viewer 没有替该真人角色回应的席位权限。");
      }
      const sourceAction = product.actionHistory.find(
        (action) => action.eventSequence === actionSequence,
      );
      const sourceReceipt = sourceAction?.receipt;
      if (!sourceReceipt || sourceReceipt.receiptKey !== actionReceiptKey) {
        throw new Error(
          "[ttrpg] 真人回应绑定的 ActionReceipt 不存在或已变化。",
        );
      }
      const observer = sourceReceipt.context.observers.find(
        (item) => item.actorKey === actorKey,
      );
      const promptWindow = sourceReceipt.context.reactionWindows.some(
        (window) =>
          window.status !== "closed" &&
          window.layer === "immediate-character" &&
          window.humanConfirmationRequiredActorKeys.includes(actorKey),
      );
      if (observer?.responsePolicy !== "prompt-human" || !promptWindow) {
        throw new Error("[ttrpg] 该角色没有属于本人的开放回应窗口。");
      }
      if (
        (product.humanResponses ?? []).some(
          (response) =>
            response.actionSequence === actionSequence &&
            response.actorKey === actorKey,
        )
      ) {
        throw new Error("[ttrpg] 该真人角色已经回应本次行动。");
      }
      const response: TtrpgRuntimeHumanResponseV2 = {
        schema: "storyforge.ttrpg-human-response",
        version: 2,
        responseKey: `human-response.${actionSequence}.${actorKey}`,
        eventSequence: sequence,
        actionSequence,
        actionReceiptKey,
        actorKey,
        kind,
        text,
        audience,
        viewerKey,
      };
      return {
        actorKey,
        targetKey: sourceAction?.actorKey ?? null,
        payload: { response },
      };
    },
  });
}

/**
 * Records a non-resolution terminal disposition without rolling dice or
 * mutating action economy. Queueing/interruption requires a structurally
 * available frozen action; cancellation may also close an unstructured draft.
 */
export async function commitTtrpgIntentDispositionV2(
  input: FormalTtrpgCommandEnvelope & {
    intentKey: string;
    actorKey: string;
    rawInput: string;
    actionKey?: string | null;
    targetKey?: string | null;
    terminalStatus: "interrupted" | "queued/deferred" | "cancelled";
    reason: string;
    submittedBy: { role: "gm" | "player"; viewerKey: string };
  },
): Promise<ProductRuntimeEvent> {
  const intentKey = input.intentKey.trim();
  const actorKey = input.actorKey.trim();
  const rawInput = input.rawInput.trim().normalize("NFC");
  const actionKey = input.actionKey?.trim() || null;
  const targetKey = input.targetKey?.trim() || null;
  const reason = input.reason.trim().normalize("NFC");
  const terminalStatus = input.terminalStatus;
  const submittedBy = {
    role: input.submittedBy?.role,
    viewerKey: input.submittedBy?.viewerKey?.trim() ?? "",
  };
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(intentKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(actorKey) ||
    !rawInput ||
    rawInput.length > 10_000 ||
    !reason ||
    reason.length > 4_000 ||
    !["interrupted", "queued/deferred", "cancelled"].includes(terminalStatus) ||
    !["gm", "player"].includes(String(submittedBy.role)) ||
    !submittedBy.viewerKey
  ) {
    throw new Error("[ttrpg] 行动意图终态处置字段无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.intent.receipted",
    intent: {
      intentKey,
      actorKey,
      rawInput,
      actionKey,
      targetKey,
      terminalStatus,
      reason,
      submittedBy,
    },
    build: async ({ state, sequence, campaign, rulePack, participants }) => {
      if (submittedBy.role === "gm") {
        assertFormalTtrpgGmV2(participants, submittedBy.viewerKey);
      } else if (
        !participants.some(
          (row) =>
            row.role === "player" &&
            row.actorKey === actorKey &&
            row.viewerKey === submittedBy.viewerKey &&
            ["human", "hybrid"].includes(row.controller) &&
            row.assignmentState === "claimed" &&
            row.sessionZeroAcceptedAtSequence != null,
        )
      ) {
        throw new Error("[ttrpg] 当前 viewer 没有处置该角色行动的席位权限。");
      }
      if (terminalStatus === "interrupted" && submittedBy.role !== "gm") {
        throw new Error("[ttrpg] 只有 KP/规则权威可以确认行动被正式打断。");
      }
      const classification = classifyTtrpgSubmittedIntentV2({
        state,
        campaign,
        rulePack,
        actorKey,
        actionKey,
        targetKey,
      });
      if (
        terminalStatus !== "cancelled" &&
        (!actionKey || !classification.suggestedActionKeys.includes(actionKey))
      ) {
        throw new Error(
          "[ttrpg] 只有当前场景与角色卡实际授予的行动可以排队或被打断。",
        );
      }
      const receipt: TtrpgRuntimeIntentReceiptV2 = {
        schema: "storyforge.ttrpg-intent-receipt",
        version: 2,
        receiptKey: `intent-receipt.${sequence}`,
        eventSequence: sequence,
        intentKey,
        actorKey,
        rawInput,
        proposedActionKey: actionKey,
        targetKey,
        terminalStatus,
        reason,
        suggestedActionKeys: classification.suggestedActionKeys.filter(
          (candidate) => candidate !== actionKey,
        ),
      };
      return { actorKey, targetKey, payload: { receipt } };
    },
  });
}

export async function resolveTtrpgRuleCheck(
  input: FormalTtrpgCommandEnvelope & {
    actionKey: string;
    actorKey: string;
    targetKey?: string | null;
    difficulty?: number;
    situationalModifier?: number;
    rollVisibility?: "public" | "gm-only";
  },
): Promise<ProductRuntimeEvent> {
  const actionKey = input.actionKey.trim();
  const actorKey = input.actorKey.trim();
  const targetKey = input.targetKey?.trim() || null;
  const difficulty = input.difficulty;
  const situationalModifier = input.situationalModifier ?? 0;
  const rollVisibility = input.rollVisibility ?? "public";
  if (!["public", "gm-only"].includes(rollVisibility)) {
    throw new Error("[ttrpg] 检定可见性无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.check.resolved",
    intent: {
      actionKey,
      actorKey,
      targetKey,
      difficulty: difficulty ?? null,
      situationalModifier,
      rollVisibility,
    },
    build: async ({ session, state, sequence, rulePack, campaign }) => {
      const ttrpg = state.ttrpg;
      if (!ttrpg?.product?.sessionZero.completed || !ttrpg.scene?.sceneKey) {
        throw new Error("[ttrpg] 请先完成 Session Zero 并打开正式场景。");
      }
      if (
        rollVisibility === "gm-only" &&
        ttrpg.product.hiddenDicePolicy === "never"
      ) {
        throw new Error("[ttrpg] 冻结 CampaignPack 不允许暗骰。");
      }
      const scene = campaign.scenes.find(
        (item) => item.sceneKey === ttrpg.scene!.sceneKey,
      );
      const action = rulePack.actions.find((item) => item.key === actionKey);
      const template = campaign.characterTemplates.find(
        (item) => item.characterKey === actorKey,
      );
      const checkEffect = action?.effects.find(
        (effect) => effect.kind === "check",
      );
      if (
        !scene?.actionKeys.includes(actionKey) ||
        !action ||
        !template ||
        !checkEffect ||
        checkEffect.kind !== "check"
      ) {
        throw new Error("[ttrpg] 当前角色/场景没有该冻结规则行动。");
      }
      const granted =
        template.actionKeys.includes(actionKey) ||
        template.itemKeys.some((itemKey) =>
          rulePack.items
            .find((item) => item.key === itemKey)
            ?.grantedActionKeys.includes(actionKey),
        );
      if (!granted) throw new Error("[ttrpg] 角色卡没有该行动。");
      if (action.target === "self" && targetKey !== actorKey)
        throw new Error("[ttrpg] 自身行动目标必须是行动者。");
      if (
        (action.target === "single-ally" || action.target === "single-enemy") &&
        (!targetKey || targetKey === actorKey)
      ) {
        throw new Error("[ttrpg] 单体行动必须选择另一名目标。");
      }
      if (targetKey && !state.entities[targetKey])
        throw new Error("[ttrpg] 行动目标不存在。");
      const actorSkill = resolveTtrpgActionSkillV2({
        state,
        campaign,
        actorKey,
        actionKey,
      });
      const opponentSkill =
        targetKey == null
          ? null
          : resolveTtrpgActionSkillV2({
              state,
              campaign,
              actorKey: targetKey,
              actionKey,
            });
      const resolution = await resolveRulePackCheckV1({
        rulePack,
        checkKey: checkEffect.checkKey,
        attributeKey: checkEffect.attributeKey,
        attributes: Object.fromEntries(
          [...rulePack.attributes, ...rulePack.derivedStats].map(
            (attribute) => [
              attribute.key,
              Number(state.entities[actorKey]?.attributes[attribute.key]),
            ],
          ),
        ),
        seed: session.seed,
        nonce: `${input.commandId}:${sequence}:${actionKey}`,
        difficulty,
        situationalModifier: situationalModifier + actorSkill.skillValue,
        contestantRef: actorKey,
        opponent:
          targetKey == null
            ? undefined
            : {
                contestantRef: targetKey,
                attributeKey: checkEffect.attributeKey,
                situationalModifier: opponentSkill?.skillValue ?? 0,
                attributes: Object.fromEntries(
                  [...rulePack.attributes, ...rulePack.derivedStats].map(
                    (attribute) => [
                      attribute.key,
                      Number(
                        state.entities[targetKey]?.attributes[attribute.key],
                      ),
                    ],
                  ),
                ),
              },
      });
      const model = rulePack.diceModels.find(
        (item) => item.key === resolution.diceModelKey,
      )!;
      const modifier = ["total-vs-target", "opposed"].includes(resolution.mode)
        ? resolution.attributeModifier + resolution.situationalModifier
        : 0;
      const expression = `${resolution.keptDice.length}d${model.sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ""}`;
      return {
        actorKey,
        targetKey: targetKey ?? actorKey,
        payload: {
          check: {
            actorKey,
            skill: action.name,
            expression,
            dice: resolution.keptDice,
            modifier,
            total: resolution.total,
            dc: resolution.difficulty,
            success: ttrpgDegreeSucceededV2(resolution.degree),
            visibility: rollVisibility,
            rule: {
              actionKey,
              checkKey: resolution.checkKey,
              attributeKey: resolution.attributeKey,
              skillKey: actorSkill.skillKey,
              skillValue: actorSkill.skillValue,
              diceModelKey: resolution.diceModelKey,
              rolledDice: resolution.dice,
              keptDice: resolution.keptDice,
              degree: resolution.degree,
              mode: resolution.mode,
              successes: resolution.successes,
              winnerRef: resolution.winnerRef,
              tiedRefs: resolution.tiedRefs,
              calculationTrace: resolution.calculationTrace,
              opponent:
                resolution.opponent == null
                  ? null
                  : {
                      contestantRef: resolution.opponent.contestantRef,
                      attributeKey: resolution.opponent.attributeKey,
                      rolledDice: resolution.opponent.dice,
                      keptDice: resolution.opponent.keptDice,
                      attributeModifier: resolution.opponent.attributeModifier,
                      total: resolution.opponent.total,
                      degree: resolution.opponent.degree,
                      rollTrace: resolution.opponent.rollTrace,
                      proofHash: resolution.opponent.proofHash,
                    },
              rollTrace: resolution.rollTrace,
              seedCommitment: resolution.seedCommitment,
              nonce: resolution.nonce,
              proofHash: resolution.proofHash,
              rulePackContentHash: ttrpg.product.rulePackContentHash,
            },
          },
        },
      };
    },
  });
}

export async function resolveTtrpgRuleAction(
  input: FormalTtrpgCommandEnvelope & {
    actionKey: string;
    actorKey: string;
    targetKey?: string | null;
    difficulty?: number;
    situationalModifier?: number;
    rollVisibility?: "public" | "gm-only";
    declaredIntent?: {
      intentKey: string;
      rawInput: string;
      goal?: string | null;
      method?: string | null;
    } | null;
  },
): Promise<ProductRuntimeEvent> {
  return resolveTtrpgRuleActionWithAuthority(input);
}

async function resolveTtrpgRuleActionWithAuthority(
  input: FormalTtrpgCommandEnvelope & {
    actionKey: string;
    actorKey: string;
    targetKey?: string | null;
    difficulty?: number;
    situationalModifier?: number;
    rollVisibility?: "public" | "gm-only";
    declaredIntent?: {
      intentKey: string;
      rawInput: string;
      goal?: string | null;
      method?: string | null;
    } | null;
    actorAuthority?: NonNullable<
      import("../types").TtrpgRuntimeRuleActionResultV1["actorAuthority"]
    >;
  },
): Promise<ProductRuntimeEvent> {
  const actionKey = input.actionKey.trim();
  const actorKey = input.actorKey.trim();
  const targetKey = input.targetKey?.trim() || null;
  const difficulty = input.difficulty;
  const situationalModifier = input.situationalModifier ?? 0;
  const rollVisibility = input.rollVisibility ?? "public";
  if (!["public", "gm-only"].includes(rollVisibility)) {
    throw new Error("[ttrpg] 检定可见性无效。");
  }
  const actorAuthority =
    input.actorAuthority == null ? null : structuredClone(input.actorAuthority);
  const declaredIntent =
    input.declaredIntent == null
      ? null
      : {
          intentKey: input.declaredIntent.intentKey.trim(),
          rawInput: input.declaredIntent.rawInput.trim().normalize("NFC"),
          goal: input.declaredIntent.goal?.trim().normalize("NFC") || null,
          method: input.declaredIntent.method?.trim().normalize("NFC") || null,
        };
  if (
    declaredIntent &&
    (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(declaredIntent.intentKey) ||
      !declaredIntent.rawInput ||
      declaredIntent.rawInput.length > 10_000 ||
      (declaredIntent.goal?.length ?? 0) > 2_000 ||
      (declaredIntent.method?.length ?? 0) > 2_000)
  ) {
    throw new Error("[ttrpg] 行动声明意图无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.rule.action.resolved",
    intent: {
      actionKey,
      actorKey,
      targetKey,
      difficulty: difficulty ?? null,
      situationalModifier,
      rollVisibility,
      actorAuthority,
      declaredIntent,
    },
    build: async ({
      session,
      state,
      sequence,
      rulePack,
      campaign,
      participants,
    }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      if (!ttrpg || !product?.sessionZero.completed || !ttrpg.scene?.sceneKey) {
        throw new Error("[ttrpg] 请先完成 Session Zero 并打开正式场景。");
      }
      if (
        rollVisibility === "gm-only" &&
        product.hiddenDicePolicy === "never"
      ) {
        throw new Error("[ttrpg] 冻结 CampaignPack 不允许暗骰。");
      }
      const scene = campaign.scenes.find(
        (item) => item.sceneKey === ttrpg.scene!.sceneKey,
      );
      const action = rulePack.actions.find((item) => item.key === actionKey);
      const template = campaign.characterTemplates.find(
        (item) => item.characterKey === actorKey,
      );
      if (!scene?.actionKeys.includes(actionKey) || !action || !template) {
        throw new Error("[ttrpg] 当前角色/场景没有该冻结规则行动。");
      }
      const actorSeat =
        participants.find(
          (row) => row.role === "player" && row.actorKey === actorKey,
        ) ?? null;
      const gmSeat = participants.find((row) => row.role === "gm") ?? null;
      const gmActorAuthority =
        actorAuthority?.source === "ai-gm-npc" ||
        actorAuthority?.source === "hybrid-gm-confirmed";
      if (
        !actorAuthority &&
        (actorSeat?.controller === "ai" || actorSeat?.controller === "vacant")
      ) {
        throw new Error("[ttrpg] AI 或空缺玩家席位不能通过真人直提入口行动。");
      }
      if (
        !actorAuthority &&
        template.role === "npc" &&
        gmSeat?.controller === "ai"
      ) {
        throw new Error("[ttrpg] AI KP 控制的 NPC 不能通过真人直提入口行动。");
      }
      if (actorAuthority) {
        if (gmActorAuthority) {
          if (
            template.role !== "npc" ||
            actorSeat ||
            !gmSeat ||
            gmSeat.viewerKey !== actorAuthority.viewerKey ||
            gmSeat.sessionZeroAcceptedAtSequence == null ||
            !gmSeat.consent.safetyBoundariesAccepted ||
            !gmSeat.consent.aiIdentityDisclosed ||
            (actorAuthority.source === "ai-gm-npc" &&
              gmSeat.controller !== "ai") ||
            (actorAuthority.source === "hybrid-gm-confirmed" &&
              (gmSeat.controller !== "hybrid" ||
                !gmSeat.consent.aiAdviceAllowed))
          ) {
            throw new Error(
              "[ttrpg] AI KP 角色行动与当前 GM 席位、NPC 权威或同意策略不一致。",
            );
          }
        } else {
          const seat = actorSeat;
          if (
            !seat ||
            seat.viewerKey !== actorAuthority.viewerKey ||
            seat.sessionZeroAcceptedAtSequence == null ||
            !seat.consent.safetyBoundariesAccepted ||
            !seat.consent.aiIdentityDisclosed ||
            (actorAuthority.source === "ai-player" &&
              seat.controller !== "ai") ||
            (actorAuthority.source === "hybrid-confirmed" &&
              (seat.controller !== "hybrid" || !seat.consent.aiAdviceAllowed))
          ) {
            throw new Error(
              "[ttrpg] AI 玩家行动与当前席位控制权或同意策略不一致。",
            );
          }
        }
      }
      const economyTransition = product.actionEconomy
        ? spendTtrpgActionEconomyV2({
            economy: product.actionEconomy,
            turnOrder: ttrpg.turnOrder,
            actorKey,
            phase: action.phase,
          })
        : null;
      if (!economyTransition && ttrpg.activeActorKey !== actorKey) {
        throw new Error("[ttrpg] 当前还没轮到该行动者。");
      }
      const inventoryItemKeys =
        product.inventory == null
          ? template.itemKeys
          : Object.values(product.inventory.items)
              .filter(
                (item) =>
                  item.ownerRef === actorKey &&
                  !item.stateTags.includes("broken"),
              )
              .map((item) => item.definitionRef);
      const granted =
        template.actionKeys.includes(actionKey) ||
        inventoryItemKeys.some((itemKey) =>
          rulePack.items
            .find((item) => item.key === itemKey)
            ?.grantedActionKeys.includes(actionKey),
        );
      if (!granted) throw new Error("[ttrpg] 角色卡没有该行动。");
      const participantSet = new Set(ttrpg.turnOrder);
      let resolvedTargetKey: string | null = targetKey;
      if (action.target === "self") resolvedTargetKey = actorKey;
      else if (action.target === "scene") resolvedTargetKey = null;
      else if (
        !resolvedTargetKey ||
        resolvedTargetKey === actorKey ||
        !participantSet.has(resolvedTargetKey)
      ) {
        throw new Error("[ttrpg] 单体行动必须选择当前场景中的另一名目标。");
      }
      if (
        !state.entities[actorKey] ||
        (resolvedTargetKey && !state.entities[resolvedTargetKey])
      ) {
        throw new Error("[ttrpg] 行动者或目标不存在。");
      }
      const actorSkill = resolveTtrpgActionSkillV2({
        state,
        campaign,
        actorKey,
        actionKey,
      });
      const opponentSkill =
        resolvedTargetKey == null
          ? null
          : resolveTtrpgActionSkillV2({
              state,
              campaign,
              actorKey: resolvedTargetKey,
              actionKey,
            });

      const resourceChanges: import("../types").TtrpgRuntimeRuleActionResultV1["resourceChanges"] =
        [];
      const resourceCurrent = (
        entityKey: string,
        resourceKey: string,
      ): { current: number; maximum: number } => {
        const prior = [...resourceChanges]
          .reverse()
          .find(
            (item) =>
              item.entityKey === entityKey && item.resourceKey === resourceKey,
          );
        if (prior) return { current: prior.after, maximum: prior.maximum };
        const entity = state.entities[entityKey];
        const current = entity?.attributes[`resource.${resourceKey}`];
        const maximum = entity?.attributes[`resourceMax.${resourceKey}`];
        if (
          !Number.isInteger(current) ||
          !Number.isInteger(maximum) ||
          Number(maximum) <= 0
        ) {
          throw new Error(
            `[ttrpg] 角色缺少规则资源:${entityKey}.${resourceKey}`,
          );
        }
        return { current: Number(current), maximum: Number(maximum) };
      };
      const addResourceChange = (
        entityKey: string,
        resourceKey: string,
        delta: number,
        proofHash: string | null,
      ) => {
        const { current, maximum } = resourceCurrent(entityKey, resourceKey);
        const after = Math.max(0, Math.min(maximum, current + delta));
        resourceChanges.push({
          entityKey,
          resourceKey,
          before: current,
          delta,
          after,
          maximum,
          proofHash,
        });
      };
      const abilityStateKey = ttrpgAbilityStateKeyV2(actorKey, actionKey);
      const beforeAbility = product.abilityStates?.[abilityStateKey];
      if (!beforeAbility)
        throw new Error(`[ttrpg] 角色缺少冻结能力次数账本:${abilityStateKey}`);
      const sharedPoolKey = action.usage.sharedPoolKey;
      const beforeSharedPool =
        sharedPoolKey == null
          ? null
          : (product.usagePools?.[sharedPoolKey] ?? null);
      const abilityResource =
        action.usage.resourceKey == null
          ? null
          : resourceCurrent(actorKey, action.usage.resourceKey).current;
      const abilityUse = consumeTtrpgAbilityV2({
        definition: {
          abilityKey: action.key,
          actionDefinitionKey: action.key,
          usage: action.usage,
        },
        state: beforeAbility,
        eventId: `event.${sequence}`,
        currentRound: ttrpg.round,
        resourceCurrent: abilityResource,
        sharedPool: beforeSharedPool,
      });
      if (abilityUse.resourceDelta !== 0 && action.usage.resourceKey) {
        addResourceChange(
          actorKey,
          action.usage.resourceKey,
          abilityUse.resourceDelta,
          null,
        );
      }
      const abilityChange: import("../types").TtrpgRuntimeRuleActionResultV1["abilityChange"] =
        {
          stateKey: abilityStateKey,
          before: structuredClone(beforeAbility),
          after: abilityUse.state,
          sharedPoolKey,
          sharedPoolBefore:
            beforeSharedPool == null ? null : structuredClone(beforeSharedPool),
          sharedPoolAfter: abilityUse.sharedPool,
        };
      if (action.costResourceKey && action.costAmount > 0) {
        const resource = resourceCurrent(actorKey, action.costResourceKey);
        if (resource.current < action.costAmount)
          throw new Error(`[ttrpg] ${action.name}所需资源不足。`);
        addResourceChange(
          actorKey,
          action.costResourceKey,
          -action.costAmount,
          null,
        );
      }

      const checkEffects = action.effects.filter(
        (effect): effect is Extract<typeof effect, { kind: "check" }> =>
          effect.kind === "check",
      );
      if (checkEffects.length > 1)
        throw new Error("[ttrpg] v1 规则行动最多包含一个检定效果。");
      const activeConditions = product.conditions[actorKey] ?? [];
      const conditionModifier = activeConditions.reduce((sum, condition) => {
        const definition = rulePack.conditions.find(
          (item) => item.key === condition.conditionKey,
        );
        return sum + (definition?.checkModifier ?? 0) * condition.stacks;
      }, 0);
      let check: TtrpgRuntimeCheck | null = null;
      let outcome: import("../types").TtrpgRuntimeRuleActionResultV1["outcome"] =
        "automatic";
      if (checkEffects[0]) {
        const effect = checkEffects[0];
        const resolution = await resolveRulePackCheckV1({
          rulePack,
          checkKey: effect.checkKey,
          attributeKey: effect.attributeKey,
          attributes: Object.fromEntries(
            [...rulePack.attributes, ...rulePack.derivedStats].map(
              (attribute) => [
                attribute.key,
                Number(state.entities[actorKey]?.attributes[attribute.key]),
              ],
            ),
          ),
          seed: session.seed,
          nonce: `${input.commandId}:${sequence}:${actionKey}`,
          difficulty,
          situationalModifier:
            situationalModifier + conditionModifier + actorSkill.skillValue,
          contestantRef: actorKey,
          opponent:
            resolvedTargetKey == null
              ? undefined
              : {
                  contestantRef: resolvedTargetKey,
                  attributeKey: effect.attributeKey,
                  situationalModifier: opponentSkill?.skillValue ?? 0,
                  attributes: Object.fromEntries(
                    [...rulePack.attributes, ...rulePack.derivedStats].map(
                      (attribute) => [
                        attribute.key,
                        Number(
                          state.entities[resolvedTargetKey]?.attributes[
                            attribute.key
                          ],
                        ),
                      ],
                    ),
                  ),
                },
        });
        const model = rulePack.diceModels.find(
          (item) => item.key === resolution.diceModelKey,
        )!;
        const modifier = ["total-vs-target", "opposed"].includes(
          resolution.mode,
        )
          ? resolution.attributeModifier + resolution.situationalModifier
          : 0;
        const expression = `${resolution.keptDice.length}d${model.sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ""}`;
        outcome = resolution.degree;
        check = {
          eventSequence: sequence,
          actorKey,
          skill: action.name,
          expression,
          dice: resolution.keptDice,
          modifier,
          total: resolution.total,
          dc: resolution.difficulty,
          success: ttrpgDegreeSucceededV2(resolution.degree),
          visibility: rollVisibility,
          rule: {
            actionKey,
            checkKey: resolution.checkKey,
            attributeKey: resolution.attributeKey,
            skillKey: actorSkill.skillKey,
            skillValue: actorSkill.skillValue,
            diceModelKey: resolution.diceModelKey,
            rolledDice: resolution.dice,
            keptDice: resolution.keptDice,
            degree: resolution.degree,
            mode: resolution.mode,
            successes: resolution.successes,
            winnerRef: resolution.winnerRef,
            tiedRefs: resolution.tiedRefs,
            calculationTrace: resolution.calculationTrace,
            opponent:
              resolution.opponent == null
                ? null
                : {
                    contestantRef: resolution.opponent.contestantRef,
                    attributeKey: resolution.opponent.attributeKey,
                    rolledDice: resolution.opponent.dice,
                    keptDice: resolution.opponent.keptDice,
                    attributeModifier: resolution.opponent.attributeModifier,
                    total: resolution.opponent.total,
                    degree: resolution.opponent.degree,
                    rollTrace: resolution.opponent.rollTrace,
                    proofHash: resolution.opponent.proofHash,
                  },
            rollTrace: resolution.rollTrace,
            seedCommitment: resolution.seedCommitment,
            nonce: resolution.nonce,
            proofHash: resolution.proofHash,
            rulePackContentHash: product.rulePackContentHash,
          },
        };
      }
      const effectSucceeded = check == null || check.success;
      const conditionChanges: import("../types").TtrpgRuntimeRuleActionResultV1["conditionChanges"] =
        [];
      for (const [effectIndex, effect] of action.effects.entries()) {
        if (effect.kind === "check") continue;
        const shouldApply = effect.appliesOnDegrees
          ? effect.appliesOnDegrees.includes(outcome)
          : effectSucceeded;
        if (!shouldApply) continue;
        const effectTargetKey =
          effect.targetScope === "actor"
            ? actorKey
            : (resolvedTargetKey ?? actorKey);
        if (effect.kind === "resource") {
          addResourceChange(
            effectTargetKey,
            effect.resourceKey,
            effect.delta,
            null,
          );
        } else if (effect.kind === "damage") {
          const modifier =
            effect.modifierAttributeKey == null
              ? 0
              : Number(
                  state.entities[actorKey].attributes[
                    effect.modifierAttributeKey
                  ],
                );
          if (!Number.isFinite(modifier))
            throw new Error(
              `[ttrpg] 伤害修正属性无效:${effect.modifierAttributeKey}`,
            );
          const damage = await resolveRulePackDiceModelV1({
            rulePack,
            diceModelKey: effect.diceModelKey,
            seed: session.seed,
            nonce: `${input.commandId}:${sequence}:${actionKey}:damage:${effectIndex}`,
            modifier,
          });
          addResourceChange(
            effectTargetKey,
            effect.resourceKey,
            -Math.max(0, damage.total),
            damage.proofHash,
          );
        } else if (effect.kind === "condition") {
          const definition = rulePack.conditions.find(
            (item) => item.key === effect.conditionKey,
          )!;
          const existing = product.conditions[effectTargetKey]?.find(
            (item) => item.conditionKey === effect.conditionKey,
          );
          const stacks =
            definition.stacking === "replace"
              ? Math.min(definition.maximumStacks, effect.stacks)
              : Math.min(
                  definition.maximumStacks,
                  (existing?.stacks ?? 0) + effect.stacks,
                );
          conditionChanges.push({
            entityKey: effectTargetKey,
            conditionKey: effect.conditionKey,
            stacks,
            duration: definition.defaultDurationRounds,
          });
        }
      }
      const completesTurn = economyTransition
        ? economyTransition.nextActorKey != null
        : action.phase === "action";
      if (completesTurn) {
        for (const condition of activeConditions) {
          if (condition.duration == null) continue;
          const duration = condition.duration - 1;
          conditionChanges.push({
            entityKey: actorKey,
            conditionKey: condition.conditionKey,
            stacks: duration > 0 ? condition.stacks : 0,
            duration: duration > 0 ? duration : null,
          });
        }
      }
      const currentIndex = ttrpg.turnOrder.indexOf(actorKey);
      const shouldAdvance = action.phase === "action";
      const nextIndex = (currentIndex + 1) % ttrpg.turnOrder.length;
      const nextActorKey =
        economyTransition?.nextActorKey ??
        (shouldAdvance ? ttrpg.turnOrder[nextIndex] : null);
      const nextRound =
        economyTransition?.nextRound ??
        (shouldAdvance ? ttrpg.round + (nextIndex === 0 ? 1 : 0) : ttrpg.round);
      const receipt = createTtrpgActionReceiptV2({
        state,
        campaign,
        rulePack,
        sequence,
        sceneKey: scene.sceneKey,
        action,
        actorKey,
        targetKey: resolvedTargetKey,
        check,
        outcome,
        resourceChanges,
        conditionChanges,
        abilityChange,
        nextActorKey,
        nextRound,
        participantControllers: Object.fromEntries(
          participants.flatMap((row) =>
            row.actorKey == null ? [] : [[row.actorKey, row.controller]],
          ),
        ),
        declaredIntent,
      });
      return {
        actorKey,
        targetKey: resolvedTargetKey,
        payload: {
          result: {
            eventSequence: sequence,
            actionKey,
            actionName: action.name,
            actorKey,
            targetKey: resolvedTargetKey,
            actionPhase: action.phase,
            outcome,
            check,
            resourceChanges,
            conditionChanges,
            abilityChange,
            actorAuthority,
            receipt,
            nextActorKey,
            nextRound,
          },
        },
      };
    },
  });
}

/**
 * GM-authorized short/long rest. The command resets only usages explicitly
 * named by the frozen RulePack and writes every before/after value to replay.
 */
export async function completeTtrpgRestV2(
  input: FormalTtrpgCommandEnvelope & {
    restKey: string;
    kind: "short-rest" | "long-rest";
    actorKeys: string[];
    gmKey: string;
    reason: string;
  },
): Promise<ProductRuntimeEvent> {
  const restKey = input.restKey.trim();
  const kind = input.kind;
  const actorKeys = [...new Set(input.actorKeys.map((key) => key.trim()))];
  const gmKey = input.gmKey.trim();
  const reason = input.reason.trim().normalize("NFC");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(restKey) ||
    !["short-rest", "long-rest"].includes(kind) ||
    !actorKeys.length ||
    actorKeys.some((key) => !key) ||
    !gmKey ||
    !reason ||
    reason.length > 2_000
  ) {
    throw new Error("[ttrpg] 休息命令字段无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.rest.completed",
    intent: { restKey, kind, actorKeys, gmKey, reason },
    build: async ({ state, sequence, rulePack, participants }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !product?.sessionZero.completed ||
        !product.abilityStates ||
        product.ending ||
        ttrpg?.encounter?.status === "active" ||
        (product.restHistory ?? []).some((item) => item.restKey === restKey)
      ) {
        throw new Error("[ttrpg] 当前战役不能完成这次休息。");
      }
      if (
        actorKeys.some(
          (key) => !product.sessionZero.selectedCharacterKeys.includes(key),
        )
      ) {
        throw new Error(
          "[ttrpg] 休息对象必须是 Session Zero 已确认的玩家角色。",
        );
      }
      const abilityChanges: TtrpgRuntimeRestReceiptV2["abilityChanges"] =
        Object.entries(product.abilityStates).flatMap(([stateKey, before]) => {
          if (!actorKeys.includes(before.actorInstanceId)) return [];
          const action = rulePack.actions.find(
            (item) => item.key === before.abilityKey,
          );
          if (!action?.usage.reset.includes(kind)) return [];
          return [
            {
              stateKey,
              actorKey: before.actorInstanceId,
              abilityKey: before.abilityKey,
              before: structuredClone(before),
              after: resetTtrpgAbilityUsageV2({
                definition: {
                  abilityKey: action.key,
                  actionDefinitionKey: action.key,
                  usage: action.usage,
                },
                state: before,
                trigger: kind,
                eventId: `event.${sequence}`,
              }),
            },
          ];
        });
      const receipt: TtrpgRuntimeRestReceiptV2 = {
        schema: "storyforge.ttrpg-rest-receipt",
        version: 2,
        eventSequence: sequence,
        restKey,
        kind,
        actorKeys,
        completedBy: gmKey,
        reason,
        abilityChanges,
      };
      return {
        actorKey: gmKey,
        targetKey: restKey,
        payload: { receipt, rulePack },
      };
    },
  });
}

/**
 * The only commit gate for AI/hybrid player candidates. The mechanical action
 * is re-derived by RulePack after verifying the exact Instance-owned durable
 * checkpoint and, for hybrid seats, a human confirmation event.
 */
export async function commitTtrpgPlayerActionFromHarnessV1(input: {
  sessionId: number;
  runId: number;
  candidateHash: string;
}): Promise<ProductRuntimeEvent> {
  if (
    !Number.isInteger(input.runId) ||
    input.runId < 1 ||
    !/^[0-9a-f]{64}$/.test(input.candidateHash)
  ) {
    throw new Error("[ttrpg] AI 玩家候选授权无效。");
  }
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (
    !session ||
    session.kind !== "ttrpg" ||
    session.worldId == null ||
    session.workId == null
  ) {
    throw new Error("[ttrpg] AI 玩家运行缺少正式工作区 owner。");
  }
  const scope = {
    projectId: session.projectId,
    worldId: session.worldId,
    workId: session.workId,
  };
  const { readInstanceAgentRunV1 } = await import("../agent/run/event-store");
  const { readLatestVerifiedAgentRunCheckpointV1 } =
    await import("../agent/run/checkpoint");
  // These readers each use their own verified Dexie boundary; keep them
  // sequential so nested read transactions cannot outlive one another.
  const run = await readInstanceAgentRunV1(scope, input.runId);
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(
    scope,
    input.runId,
    { owner: "instance" },
  );
  const participants = await readTtrpgSessionParticipantsV2(input.sessionId);
  const candidate = checkpoint?.resumePayload;
  if (
    !isObject(candidate) ||
    candidate.schema !== "storyforge.ttrpg-player-action-candidate" ||
    candidate.version !== 1 ||
    candidate.portable !== false ||
    candidate.runId !== input.runId ||
    candidate.productRuntimeSessionId !== input.sessionId ||
    candidate.candidateHash !== input.candidateHash ||
    typeof candidate.actorKey !== "string" ||
    typeof candidate.seatKey !== "string" ||
    typeof candidate.viewerKey !== "string" ||
    typeof candidate.actionKey !== "string" ||
    typeof candidate.approach !== "string" ||
    typeof candidate.contextManifestHash !== "string" ||
    typeof candidate.baseSequence !== "number" ||
    typeof candidate.stateHash !== "string"
  ) {
    throw new Error("[ttrpg] AI 玩家检查点候选无效。");
  }
  const { candidateHash: _candidateHash, ...candidateBody } = candidate;
  const expectedCandidateHash = await (
    await import("../agent/run/hash")
  ).hashCanonicalValue(candidateBody);
  if (
    expectedCandidateHash !== input.candidateHash ||
    run.run.productRuntimeSessionId !== input.sessionId ||
    run.contract.permissions.contextSourceKeys.length !== 1 ||
    run.contract.permissions.contextSourceKeys[0] !== "ttrpgPlayerRuntime" ||
    run.contract.scope.runtime?.productRuntimeSessionId !== input.sessionId ||
    run.contract.scope.runtime.baseSequence !== candidate.baseSequence ||
    run.contract.scope.runtime.stateHash !== candidate.stateHash
  ) {
    throw new Error("[ttrpg] AI 玩家 RunContract、上下文或候选哈希不一致。");
  }
  const seat = participants.find(
    (row) =>
      row.seatKey === candidate.seatKey && row.actorKey === candidate.actorKey,
  );
  if (
    !seat ||
    seat.viewerKey !== candidate.viewerKey ||
    seat.controller !== candidate.controller
  ) {
    throw new Error("[ttrpg] AI 玩家候选与当前席位不一致。");
  }
  const persisted = run.events.find(
    (event) =>
      event.type === "candidate.persisted" &&
      event.payload.candidateHash === input.candidateHash,
  );
  if (!persisted || persisted.type !== "candidate.persisted")
    throw new Error("[ttrpg] AI 玩家候选没有持久化证据。");
  const hybrid = seat.controller === "hybrid";
  if (persisted.payload.requiresConfirmation !== hybrid) {
    throw new Error("[ttrpg] AI 玩家候选确认策略与席位控制权不一致。");
  }
  if (
    hybrid &&
    !run.events.some(
      (event) =>
        event.type === "confirmation.recorded" &&
        event.payload.candidateHash === input.candidateHash &&
        event.payload.decision === "adopt",
    )
  ) {
    throw new Error("[ttrpg] 混合席位行动候选尚未获得真人确认。");
  }
  return resolveTtrpgRuleActionWithAuthority({
    sessionId: input.sessionId,
    commandId: `ttrpg-ai-player:${input.runId}:${input.candidateHash.slice(0, 32)}`,
    baseSequence: Number(candidate.baseSequence),
    baseStateHash: String(candidate.stateHash),
    actionKey: String(candidate.actionKey),
    actorKey: String(candidate.actorKey),
    targetKey: candidate.targetKey == null ? null : String(candidate.targetKey),
    difficulty:
      candidate.defaultDifficulty == null
        ? undefined
        : Number(candidate.defaultDifficulty),
    situationalModifier: 0,
    actorAuthority: {
      source: hybrid ? "hybrid-confirmed" : "ai-player",
      viewerKey: String(candidate.viewerKey),
      runId: input.runId,
      candidateHash: input.candidateHash,
      contextManifestHash: String(candidate.contextManifestHash),
      approach: String(candidate.approach),
      spokenIntent:
        candidate.spokenIntent == null ? null : String(candidate.spokenIntent),
    },
  });
}

/**
 * The only commit gate for an AI/hybrid GM choosing an NPC's formal action.
 * The model may choose only an intent from the current GM projection; the
 * frozen RulePack still derives dice, effects, costs and turn advancement.
 */
export async function commitTtrpgGmActorActionFromHarnessV1(input: {
  sessionId: number;
  runId: number;
  candidateHash: string;
}): Promise<ProductRuntimeEvent> {
  if (
    !Number.isInteger(input.runId) ||
    input.runId < 1 ||
    !/^[0-9a-f]{64}$/.test(input.candidateHash)
  ) {
    throw new Error("[ttrpg] AI KP 角色行动候选授权无效。");
  }
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (
    !session ||
    session.kind !== "ttrpg" ||
    session.worldId == null ||
    session.workId == null
  ) {
    throw new Error("[ttrpg] AI KP 运行缺少正式工作区 owner。");
  }
  const scope = {
    projectId: session.projectId,
    worldId: session.worldId,
    workId: session.workId,
  };
  const { readInstanceAgentRunV1 } = await import("../agent/run/event-store");
  const { readLatestVerifiedAgentRunCheckpointV1 } =
    await import("../agent/run/checkpoint");
  const run = await readInstanceAgentRunV1(scope, input.runId);
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(
    scope,
    input.runId,
    { owner: "instance" },
  );
  const participants = await readTtrpgSessionParticipantsV2(input.sessionId);
  const candidate = checkpoint?.resumePayload;
  if (
    !isObject(candidate) ||
    candidate.schema !== "storyforge.ttrpg-gm-actor-action-candidate" ||
    candidate.version !== 1 ||
    candidate.portable !== false ||
    candidate.runId !== input.runId ||
    candidate.productRuntimeSessionId !== input.sessionId ||
    candidate.candidateHash !== input.candidateHash ||
    typeof candidate.actorKey !== "string" ||
    typeof candidate.viewerKey !== "string" ||
    typeof candidate.actionKey !== "string" ||
    typeof candidate.approach !== "string" ||
    typeof candidate.contextManifestHash !== "string" ||
    typeof candidate.baseSequence !== "number" ||
    typeof candidate.stateHash !== "string"
  ) {
    throw new Error("[ttrpg] AI KP 角色行动检查点候选无效。");
  }
  const { candidateHash: _candidateHash, ...candidateBody } = candidate;
  const expectedCandidateHash = await (
    await import("../agent/run/hash")
  ).hashCanonicalValue(candidateBody);
  if (
    expectedCandidateHash !== input.candidateHash ||
    run.run.productRuntimeSessionId !== input.sessionId ||
    run.contract.permissions.contextSourceKeys.length !== 1 ||
    run.contract.permissions.contextSourceKeys[0] !== "ttrpgRuntime" ||
    run.contract.scope.runtime?.productRuntimeSessionId !== input.sessionId ||
    run.contract.scope.runtime.baseSequence !== candidate.baseSequence ||
    run.contract.scope.runtime.stateHash !== candidate.stateHash
  ) {
    throw new Error(
      "[ttrpg] AI KP 角色行动 RunContract、上下文或候选哈希不一致。",
    );
  }
  const gmSeat = participants.find((row) => row.role === "gm");
  if (
    !gmSeat ||
    gmSeat.viewerKey !== candidate.viewerKey ||
    gmSeat.controller !== candidate.controller
  ) {
    throw new Error("[ttrpg] AI KP 候选与当前 GM 席位不一致。");
  }
  const persisted = run.events.find(
    (event) =>
      event.type === "candidate.persisted" &&
      event.payload.candidateHash === input.candidateHash,
  );
  if (!persisted || persisted.type !== "candidate.persisted") {
    throw new Error("[ttrpg] AI KP 角色行动候选没有持久化证据。");
  }
  const hybrid = gmSeat.controller === "hybrid";
  if (persisted.payload.requiresConfirmation !== hybrid) {
    throw new Error("[ttrpg] AI KP 候选确认策略与 GM 控制权不一致。");
  }
  if (
    hybrid &&
    !run.events.some(
      (event) =>
        event.type === "confirmation.recorded" &&
        event.payload.candidateHash === input.candidateHash &&
        event.payload.decision === "adopt",
    )
  ) {
    throw new Error("[ttrpg] 混合 GM 角色行动候选尚未获得真人确认。");
  }
  return resolveTtrpgRuleActionWithAuthority({
    sessionId: input.sessionId,
    commandId: `ttrpg-ai-gm-actor:${input.runId}:${input.candidateHash.slice(0, 32)}`,
    baseSequence: Number(candidate.baseSequence),
    baseStateHash: String(candidate.stateHash),
    actionKey: String(candidate.actionKey),
    actorKey: String(candidate.actorKey),
    targetKey: candidate.targetKey == null ? null : String(candidate.targetKey),
    difficulty:
      candidate.defaultDifficulty == null
        ? undefined
        : Number(candidate.defaultDifficulty),
    situationalModifier: 0,
    actorAuthority: {
      source: hybrid ? "hybrid-gm-confirmed" : "ai-gm-npc",
      viewerKey: String(candidate.viewerKey),
      runId: input.runId,
      candidateHash: input.candidateHash,
      contextManifestHash: String(candidate.contextManifestHash),
      approach: String(candidate.approach),
      spokenIntent:
        candidate.spokenIntent == null ? null : String(candidate.spokenIntent),
    },
  });
}

/**
 * Commit author-confirmed GM prose for one already-resolved formal action.
 * This command never changes dice, resources, conditions, turns, clues, or
 * scene progression; those remain owned by RulePack commands.
 */
export async function commitTtrpgGmNarrationFromHarnessV1(
  input: FormalTtrpgCommandEnvelope & {
    runId: number;
    candidateHash: string;
    actionSequence: number;
    text: string;
    synthesisFrame: import("../types").TtrpgRuntimeGmSynthesisFrameV2;
  },
): Promise<ProductRuntimeEvent> {
  const runId = input.runId;
  const candidateHash = input.candidateHash.trim();
  const actionSequence = input.actionSequence;
  const narration = input.text.trim();
  if (
    !Number.isInteger(runId) ||
    runId < 1 ||
    !/^[0-9a-f]{64}$/.test(candidateHash) ||
    !Number.isInteger(actionSequence) ||
    actionSequence < 1 ||
    !narration ||
    narration.length > 20_000
  ) {
    throw new Error("[ttrpg] AI GM 候选授权或叙事无效。");
  }

  // A formal narration is accepted only after the Instance-owned durable Run
  // recorded an explicit author confirmation for the exact candidate hash.
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (!session || session.worldId == null || session.workId == null) {
    throw new Error("[ttrpg] AI GM 运行缺少正式工作区 owner。");
  }
  const { readInstanceAgentRunV1 } = await import("../agent/run/event-store");
  const run = await readInstanceAgentRunV1(
    {
      projectId: session.projectId,
      worldId: session.worldId,
      workId: session.workId,
    },
    runId,
  );
  if (
    run.run.productRuntimeSessionId !== input.sessionId ||
    run.contract.scope.runtime?.productRuntimeSessionId !== input.sessionId ||
    run.contract.scope.runtime.baseSequence !== input.baseSequence ||
    run.contract.scope.runtime.stateHash !== input.baseStateHash
  ) {
    throw new Error("[ttrpg] AI GM RunContract 与当前战役基线不一致。");
  }
  const persisted = run.events.some(
    (event) =>
      event.type === "candidate.persisted" &&
      event.payload.candidateHash === candidateHash &&
      event.payload.requiresConfirmation,
  );
  const confirmed = run.events.some(
    (event) =>
      event.type === "confirmation.recorded" &&
      event.payload.candidateHash === candidateHash &&
      event.payload.decision === "adopt",
  );
  if (!persisted || !confirmed)
    throw new Error("[ttrpg] AI GM 候选尚未获得作者确认。");
  const { readLatestVerifiedAgentRunCheckpointV1 } =
    await import("../agent/run/checkpoint");
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(
    {
      projectId: session.projectId,
      worldId: session.worldId,
      workId: session.workId,
    },
    runId,
    { owner: "instance" },
  );
  const frozenCandidate = checkpoint?.resumePayload;
  if (
    !isObject(frozenCandidate) ||
    frozenCandidate.candidateHash !== candidateHash ||
    frozenCandidate.runId !== runId ||
    frozenCandidate.productRuntimeSessionId !== input.sessionId ||
    frozenCandidate.baseSequence !== input.baseSequence ||
    frozenCandidate.stateHash !== input.baseStateHash ||
    frozenCandidate.actionSequence !== actionSequence ||
    frozenCandidate.narration !== narration ||
    stableJson(frozenCandidate.synthesisFrame) !==
      stableJson(input.synthesisFrame)
  ) {
    throw new Error("[ttrpg] AI GM 提交内容与已确认候选不一致。");
  }
  const modelEvidence = parseTtrpgModelEvidenceV1(
    frozenCandidate.modelEvidence,
  );
  const modelCalls = Array.isArray(frozenCandidate.modelCalls)
    ? frozenCandidate.modelCalls
        .map(parseTtrpgModelEvidenceV1)
        .filter((item): item is TtrpgRuntimeModelEvidenceV1 => item != null)
    : modelEvidence
      ? [modelEvidence]
      : [];
  const repairApplied = isObject(frozenCandidate.repairEvidence);
  if (modelCalls.length > 2)
    throw new Error("[ttrpg] AI GM 模型调用证据超过固定预算。");

  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.gm.response.recorded",
    intent: { runId, candidateHash, actionSequence, text: narration },
    build: async ({ state }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const latest = product?.actionHistory[product.actionHistory.length - 1];
      if (
        !product ||
        !ttrpg?.scene ||
        ttrpg.scene.status !== "active" ||
        latest?.eventSequence !== actionSequence
      ) {
        throw new Error("[ttrpg] AI GM 候选没有绑定最近的正式规则行动。");
      }
      if (
        product.gmNarrations.some(
          (item) => item.actionSequence === actionSequence,
        )
      ) {
        throw new Error("[ttrpg] 最近规则行动已经有正式 GM 叙事。");
      }
      const receipt =
        latest.receipt ??
        (() => {
          throw new Error("[ttrpg] AI GM 综合反馈缺少 ActionReceipt。");
        })();
      const synthesisFrame = parseTtrpgGmSynthesisFrameV2(
        input.synthesisFrame,
        receipt,
      );
      return {
        actorKey: null,
        targetKey: latest.actorKey,
        payload: {
          actionSequence,
          checkSequence: latest.check?.eventSequence ?? null,
          text: narration,
          candidateHash,
          runId,
          modelEvidence,
          modelCalls,
          repairApplied,
          synthesisFrame,
          source: "ai-confirmed",
        },
      };
    },
  });
}

/**
 * Commit prose written by the authenticated human GM for the latest resolved
 * RulePack action. Human narration is first-class campaign history, but it is
 * never allowed to alter dice, resources, conditions, clues, turns or scenes.
 */
export async function commitTtrpgHumanGmNarrationV1(
  input: FormalTtrpgCommandEnvelope & {
    actionSequence: number;
    text: string;
    gmKey: string;
  },
): Promise<ProductRuntimeEvent> {
  const actionSequence = input.actionSequence;
  const narration = input.text.trim().normalize("NFC");
  const gmKey = input.gmKey.trim();
  if (
    !Number.isInteger(actionSequence) ||
    actionSequence < 1 ||
    !narration ||
    narration.length > 20_000 ||
    !gmKey ||
    gmKey.length > 160
  ) {
    throw new Error("[ttrpg] 真人 GM 叙事输入无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.gm.response.recorded",
    intent: { actionSequence, text: narration, gmKey, source: "human-gm" },
    build: async ({ state }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const latest = product?.actionHistory[product.actionHistory.length - 1];
      if (
        !product ||
        !ttrpg?.scene ||
        ttrpg.scene.status !== "active" ||
        latest?.eventSequence !== actionSequence
      ) {
        throw new Error("[ttrpg] 真人 GM 叙事必须绑定最近的正式规则行动。");
      }
      if (
        product.gmNarrations.some(
          (item) => item.actionSequence === actionSequence,
        )
      ) {
        throw new Error("[ttrpg] 最近规则行动已经有正式 GM 叙事。");
      }
      assertTtrpgFeedbackOutcomeConsistentV2(narration, latest.outcome);
      const receipt =
        latest.receipt ??
        (() => {
          throw new Error("[ttrpg] 真人 GM 综合反馈缺少 ActionReceipt。");
        })();
      return {
        actorKey: gmKey,
        targetKey: latest.actorKey,
        payload: {
          actionSequence,
          checkSequence: latest.check?.eventSequence ?? null,
          text: narration,
          candidateHash: null,
          runId: null,
          source: "human-gm",
          synthesisFrame: createDeterministicGmSynthesisFrameV2(receipt),
        },
      };
    },
  });
}

function deterministicTtrpgNarrationV1(
  state: ProductRuntimeState,
  action: import("../types").TtrpgRuntimeRuleActionResultV1,
  rulePack: ReturnType<typeof parseRulePackV1>,
): string {
  const actorName = state.entities[action.actorKey]?.name ?? action.actorKey;
  const degreeLabels = {
    automatic: "规则自动生效",
    "critical-failure": "严重失败",
    failure: "失败，但场景仍可继续推进",
    "partial-success": "部分成功，并伴随代价",
    success: "成功",
    "hard-success": "困难成功",
    "extreme-success": "极难成功",
    "critical-success": "卓越成功",
  } as const;
  const parts = [
    `${actorName}执行「${action.actionName}」：${degreeLabels[action.outcome]}。`,
  ];
  if (action.check) {
    const signedModifier =
      action.check.modifier === 0
        ? ""
        : action.check.modifier > 0
          ? ` + ${action.check.modifier}`
          : ` - ${Math.abs(action.check.modifier)}`;
    parts.push(
      `检定 ${action.check.dice.join(" + ")}${signedModifier} = ${action.check.total}，难度 ${action.check.dc}。`,
    );
  }
  if (action.resourceChanges.length) {
    parts.push(
      action.resourceChanges
        .map((change) => {
          const targetName =
            state.entities[change.entityKey]?.name ?? change.entityKey;
          const resourceName =
            rulePack.resources.find((item) => item.key === change.resourceKey)
              ?.name ?? change.resourceKey;
          return `${targetName}的${resourceName}由 ${change.before} 变为 ${change.after}`;
        })
        .join("；") + "。",
    );
  }
  if (action.conditionChanges.length) {
    parts.push(
      action.conditionChanges
        .map((change) => {
          const targetName =
            state.entities[change.entityKey]?.name ?? change.entityKey;
          const conditionName =
            rulePack.conditions.find((item) => item.key === change.conditionKey)
              ?.name ?? change.conditionKey;
          return change.stacks > 0
            ? `${targetName}获得${conditionName}×${change.stacks}`
            : `${targetName}移除${conditionName}`;
        })
        .join("；") + "。",
    );
  }
  if (action.nextActorKey)
    parts.push(
      `接下来轮到${state.entities[action.nextActorKey]?.name ?? action.nextActorKey}。`,
    );
  return parts.join("");
}

/**
 * Code-owned fallback used when the model is unavailable or deliberately
 * disabled. It derives every claim from the already committed RulePack result
 * and, like AI prose, cannot mutate rules, permissions, clues or scene flow.
 */
export async function commitTtrpgDeterministicFallbackV1(
  input: FormalTtrpgCommandEnvelope & {
    actionSequence: number;
  },
): Promise<ProductRuntimeEvent> {
  if (!Number.isInteger(input.actionSequence) || input.actionSequence < 1) {
    throw new Error("[ttrpg] 确定性旁白动作序号无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.gm.response.recorded",
    intent: {
      actionSequence: input.actionSequence,
      source: "deterministic-fallback",
    },
    build: async ({ state, rulePack }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const latest = product?.actionHistory[product.actionHistory.length - 1];
      if (
        !product ||
        !ttrpg?.scene ||
        ttrpg.scene.status !== "active" ||
        latest?.eventSequence !== input.actionSequence
      ) {
        throw new Error("[ttrpg] 确定性旁白必须绑定最近的正式规则行动。");
      }
      if (
        product.gmNarrations.some(
          (item) => item.actionSequence === input.actionSequence,
        )
      ) {
        throw new Error("[ttrpg] 最近规则行动已经有正式 GM 叙事。");
      }
      const receipt =
        latest.receipt ??
        (() => {
          throw new Error("[ttrpg] 确定性综合反馈缺少 ActionReceipt。");
        })();
      return {
        actorKey: null,
        targetKey: latest.actorKey,
        payload: {
          actionSequence: input.actionSequence,
          checkSequence: latest.check?.eventSequence ?? null,
          text: deterministicTtrpgNarrationV1(state, latest, rulePack),
          candidateHash: null,
          runId: null,
          source: "deterministic-fallback",
          synthesisFrame: createDeterministicGmSynthesisFrameV2(receipt),
        },
      };
    },
  });
}

export async function completeTtrpgCampaignEnding(
  input: FormalTtrpgCommandEnvelope & {
    endingKey: string;
    completedBy: string;
  },
): Promise<ProductRuntimeEvent> {
  const endingKey = input.endingKey.trim();
  const completedBy = input.completedBy.trim();
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.ended",
    intent: { endingKey, completedBy },
    build: async ({ state, campaign }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      if (
        !product ||
        product.ending ||
        !ttrpg?.scene ||
        ttrpg.scene.status !== "active"
      ) {
        throw new Error("[ttrpg] 正式战役当前不能提交结局。");
      }
      if (!completedBy || completedBy.length > 160)
        throw new Error("[ttrpg] 战役结局提交者无效。");
      const currentScene = campaign.scenes.find(
        (item) => item.sceneKey === ttrpg.scene?.sceneKey,
      );
      if (!currentScene || currentScene.nextSceneKeys.length > 0) {
        throw new Error(
          "[ttrpg] 只有冻结 CampaignPack 的终局场景可以选择结局。",
        );
      }
      const ending = campaign.endings.find(
        (item) => item.endingKey === endingKey,
      );
      if (!ending) throw new Error("[ttrpg] 结局不属于冻结 CampaignPack。");
      const knownConclusions = new Set(
        product.discoveredClues.flatMap((discovery) => {
          const clue = product.clueCatalog.find(
            (item) => item.clueKey === discovery.clueKey,
          );
          return clue ? [clue.conclusionKey] : [];
        }),
      );
      if (ending.trigger) {
        if (
          ending.trigger.sceneKey !== currentScene.sceneKey ||
          ending.trigger.requiredConclusionKeys.some(
            (key) => !knownConclusions.has(key),
          ) ||
          ending.trigger.forbiddenConclusionKeys.some((key) =>
            knownConclusions.has(key),
          )
        ) {
          throw new Error("[ttrpg] 当前场景与已发现结论不满足该结局触发条件。");
        }
      } else if (
        product.questProgress.some((quest) => quest.status !== "completed")
      ) {
        throw new Error("[ttrpg] 仍有主线结论未完成，不能选择无显式触发条件的结局。");
      }
      const awardedMilestones = product.advancement.milestones
        .filter(
          (item, index) =>
            !product.advancement.awardedMilestoneKeys.includes(
              item.milestoneKey,
            ) && product.questProgress[index]?.status === "completed",
        )
        .map((item) => ({
          milestoneKey: item.milestoneKey,
          award: item.award,
        }));
      return {
        actorKey: completedBy,
        targetKey: endingKey,
        payload: {
          endingKey,
          title: ending.title,
          epilogue: ending.epilogue,
          awardedMilestones,
        },
      };
    },
  });
}
