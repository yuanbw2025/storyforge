/** TTRPG-owned event reducer. Shared runtime storage dispatches here by product event namespace. */
import { earnedTtrpgCharacterCurrencyV2 } from './advancement'
import { parseTtrpgAbilityRuntimeStateV2, resetTtrpgAbilityUsageV2, ttrpgAbilityStateKeyV2 } from './ability-ledger'
import { spendTtrpgActionEconomyV2, startTtrpgActionEconomySceneV2 } from './action-economy'
import { parseTtrpgGmSynthesisFrameV2 } from './action-feedback'
import { applyTtrpgEffectPlanToRuntimeV2, proposeTtrpgEffectChoiceToRuntimeV2, resolveTtrpgEffectChoiceToRuntimeV2 } from './effect-runtime'
import { parseTtrpgEffectPlanV2 } from './effect-plan'
import { applyTtrpgItemCommandV2, parseTtrpgItemCommandV2, ttrpgItemDefinitionFromRuleV1 } from './item-ledger'
import { parseRulePackV1 } from './rule-pack'
import {
  applyTtrpgTabletopOperationV1,
  assertTtrpgCampaignMemoryV2,
  assertTtrpgCampaignPlaySessionV2,
  assertTtrpgCheck,
  assertTtrpgRosterEntryV2,
  assertTtrpgRuleActionResult,
  assertTtrpgScene,
  assertTtrpgSupplementReceiptV2,
  assertTtrpgVersionTransitionV2,
  assertTtrpgWorldEvolutionV2,
  longCampaignKey,
  longCampaignText,
  parseTtrpgHumanResponseV2,
  parseTtrpgIntentReceiptV2,
  parseTtrpgModelEvidenceV1,
  parseTtrpgRestReceiptV2,
  parseTtrpgState,
  parseTtrpgTabletopOperationV1,
  requireTtrpgState,
} from './runtime-state'
import type {
  ProductRuntimeEvent,
  ProductRuntimeState,
  TtrpgCharacterSheetV2,
  TtrpgRuntimeModelEvidenceV1,
} from '../types'
import {
  assertProductRuntimeIntegerV1 as assertFiniteInteger,
  isProductRuntimeJsonObjectV1 as isObject,
  stableProductRuntimeJsonV1 as stableJson,
  type ProductRuntimeJsonObjectV1,
} from '../product/runtime-values'

export function applyTtrpgRuntimeEventV1(
  state: ProductRuntimeState,
  event: ProductRuntimeEvent,
  payload: ProductRuntimeJsonObjectV1,
): ProductRuntimeState {
  switch (event.type) {
    case "ttrpg.character.customized": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (product.sessionZero.completed || ttrpg.scene) {
        throw new Error("角色只能在正式战役 Session Zero 完成前定制。");
      }
      const characterKey = String(payload.characterKey ?? "").trim();
      const name = String(payload.name ?? "").trim();
      const description = String(payload.description ?? "").trim();
      if (
        !characterKey ||
        event.actorKey !== characterKey ||
        !name ||
        name.length > 300 ||
        !description ||
        description.length > 20_000 ||
        !isObject(payload.attributes) ||
        !isObject(payload.entityAttributes) ||
        !isObject(payload.characterSheet) ||
        state.entities[characterKey]?.kind !== "player"
      ) {
        throw new Error("正式 TTRPG 角色定制事件无效。");
      }
      const attributes = Object.fromEntries(
        Object.entries(payload.attributes).map(([key, value]) => {
          const parsed = Number(value);
          if (!key.trim() || !Number.isFinite(parsed))
            throw new Error("正式 TTRPG 角色属性无效。");
          return [key.trim(), parsed];
        }),
      );
      const entityAttributes = Object.fromEntries(
        Object.entries(payload.entityAttributes).map(([key, value]) => {
          if (
            !key.trim() ||
            (!["string", "number", "boolean"].includes(typeof value) &&
              value !== null)
          ) {
            throw new Error("正式 TTRPG 角色投影属性无效。");
          }
          return [key, value as string | number | boolean | null];
        }),
      );
      const entity = state.entities[characterKey];
      entity.name = name;
      entity.attributes = { ...entity.attributes, ...entityAttributes };
      const current = product.characterCustomizations.find(
        (item) => item.characterKey === characterKey,
      );
      const customization = {
        characterKey,
        name,
        description,
        attributes,
        characterSheet: structuredClone(
          payload.characterSheet,
        ) as unknown as TtrpgCharacterSheetV2,
        customizedAtSequence: event.sequence,
      };
      if (current) Object.assign(current, customization);
      else product.characterCustomizations.push(customization);
      break;
    }
    case "ttrpg.character.advanced": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      const characterKey = String(payload.characterKey ?? "").trim();
      const kind = String(payload.kind);
      const targetKey = String(payload.targetKey ?? "").trim();
      const before = payload.before;
      const after = payload.after;
      const cost = assertFiniteInteger(payload.cost, "成长消费", 1, 1_000_000);
      const progression = product.characterProgression[characterKey];
      if (
        !product.sessionZero.completed ||
        product.ending ||
        !progression ||
        event.actorKey !== characterKey ||
        !targetKey ||
        !["attribute", "skill", "level", "rank"].includes(kind) ||
        !["number", "string"].includes(typeof before) ||
        typeof before !== typeof after ||
        !isObject(payload.entityAttributes) ||
        progression.spentCurrency + cost >
          earnedTtrpgCharacterCurrencyV2(product, characterKey)
      ) {
        throw new Error("正式 TTRPG 角色成长事件无效。");
      }
      if (kind === "attribute") {
        const current = state.entities[characterKey]?.attributes[targetKey];
        if (
          typeof before !== "number" ||
          typeof after !== "number" ||
          current !== before ||
          after !== before + 1
        ) {
          throw new Error("角色属性成长前后值不连续。");
        }
        progression.attributeIncreases[targetKey] =
          (progression.attributeIncreases[targetKey] ?? 0) + 1;
      } else if (kind === "skill") {
        if (
          typeof before !== "number" ||
          typeof after !== "number" ||
          after !== before + 1
        ) {
          throw new Error("角色技能成长前后值不连续。");
        }
        progression.skillIncreases[targetKey] =
          (progression.skillIncreases[targetKey] ?? 0) + 1;
      } else if (kind === "level") {
        if (
          progression.model !== "numeric-level" ||
          typeof before !== "number" ||
          typeof after !== "number" ||
          progression.level !== before ||
          after !== before + 1
        )
          throw new Error("角色等级成长无效。");
        progression.level = after;
      } else {
        if (
          progression.model !== "rank" ||
          typeof before !== "string" ||
          typeof after !== "string" ||
          progression.rankKey !== before ||
          before === after
        )
          throw new Error("角色阶位成长无效。");
        progression.rankKey = after;
        if (
          typeof state.entities[characterKey]?.attributes.rankPower === "number"
        ) {
          progression.attributeIncreases.rankPower =
            (progression.attributeIncreases.rankPower ?? 0) + 1;
        }
      }
      const entity = state.entities[characterKey];
      if (!entity) throw new Error("角色成长目标不存在。");
      for (const [field, raw] of Object.entries(payload.entityAttributes)) {
        if (
          !field.trim() ||
          (!["string", "number", "boolean"].includes(typeof raw) &&
            raw !== null) ||
          (typeof raw === "number" && !Number.isFinite(raw))
        )
          throw new Error("角色成长实体投影无效。");
        entity.attributes[field] = raw as string | number | boolean | null;
      }
      progression.spentCurrency += cost;
      progression.history.push({
        eventSequence: event.sequence,
        kind: kind as "attribute" | "skill" | "level" | "rank",
        targetKey,
        before: before as number | string,
        after: after as number | string,
        cost,
      });
      break;
    }
    case "ttrpg.session-zero.completed": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (product.sessionZero.completed)
        throw new Error("Session Zero 已完成，不能重复提交。");
      if (!Array.isArray(payload.acceptedItemKeys))
        throw new Error("Session Zero 缺少确认项。");
      const acceptedItemKeys = payload.acceptedItemKeys
        .map((item) => String(item).trim())
        .sort();
      if (!Array.isArray(payload.selectedCharacterKeys))
        throw new Error("Session Zero 缺少玩家角色编组。");
      const selectedCharacterKeys = payload.selectedCharacterKeys.map((item) =>
        String(item).trim(),
      );
      const requiredItemKeys = [...product.sessionZero.requiredItemKeys].sort();
      if (stableJson(acceptedItemKeys) !== stableJson(requiredItemKeys)) {
        throw new Error("必须确认全部 Session Zero 安全与共识事项。");
      }
      if (
        !selectedCharacterKeys.length ||
        new Set(selectedCharacterKeys).size !== selectedCharacterKeys.length ||
        selectedCharacterKeys.some(
          (key) => state.entities[key]?.kind !== "player",
        )
      ) {
        throw new Error("Session Zero 玩家角色编组无效。");
      }
      const completedBy = String(payload.completedBy ?? "").trim();
      if (!completedBy || completedBy !== event.actorKey)
        throw new Error("Session Zero 完成人身份无效。");
      product.sessionZero = {
        ...product.sessionZero,
        completed: true,
        acceptedItemKeys,
        selectedCharacterKeys,
        completedBy,
        completedAtSequence: event.sequence,
      };
      const existingRoster = new Map(
        ttrpg.campaign.roster.map((entry) => [entry.characterKey, entry]),
      );
      const allPlayerKeys = Object.values(state.entities)
        .filter((entity) => entity.kind === "player")
        .map((entity) => entity.entityKey);
      ttrpg.campaign.roster = allPlayerKeys.map((characterKey) => ({
        characterKey,
        status: selectedCharacterKeys.includes(characterKey)
          ? ("active" as const)
          : ("reserve" as const),
        joinedSessionKey: null,
        leftSessionKey: null,
        replacementFor: null,
        reason: existingRoster.get(characterKey)?.reason ?? "",
        updatedSequence: event.sequence,
      }));
      break;
    }
    case "ttrpg.safety.changed": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product.sessionZero.completed || product.ending)
        throw new Error("当前正式战役不能变更安全状态。");
      const status = String(payload.status ?? "");
      const reason =
        payload.reason == null ? null : String(payload.reason).trim() || null;
      const changedBy = String(payload.changedBy ?? "").trim();
      if (
        !["active", "paused"].includes(status) ||
        !changedBy ||
        changedBy !== event.actorKey ||
        (status === "paused" && !reason) ||
        status === product.safety.status
      ) {
        throw new Error("安全状态变更无效。");
      }
      product.safety = {
        status: status as "active" | "paused",
        reason: status === "paused" ? reason : null,
        changedBy,
        changedAtSequence: event.sequence,
      };
      break;
    }
    case "ttrpg.clue.discovered": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product.sessionZero.completed)
        throw new Error("正式战役尚未完成 Session Zero。");
      if (!ttrpg.scene || ttrpg.scene.status !== "active")
        throw new Error("请先打开一个正式战役场景。");
      const clueKey = String(payload.clueKey ?? "").trim();
      const actorKey = String(payload.actorKey ?? "").trim();
      const visibility = String(payload.visibility ?? "");
      const catalog = product.clueCatalog.find(
        (item) => item.clueKey === clueKey,
      );
      if (!catalog) throw new Error("线索不属于冻结 CampaignPack。");
      if (catalog.sourceVisibility === "gm-only")
        throw new Error("GM 私密线索不能通过玩家发现路径公开。");
      if (catalog.sourceVisibility === "public" && visibility !== "party")
        throw new Error("公开线索必须对队伍可见。");
      if (visibility !== "private" && visibility !== "party")
        throw new Error("线索可见范围无效。");
      const actor = state.entities[actorKey];
      if (
        !actor ||
        !["player", "character"].includes(actor.kind) ||
        actorKey !== event.actorKey
      ) {
        throw new Error("线索发现者必须是当前正式战役中的玩家角色。");
      }
      const existing = product.discoveredClues.find(
        (item) => item.clueKey === clueKey,
      );
      if (existing) {
        if (existing.visibility !== "private" || visibility !== "party")
          throw new Error("同一线索不能重复发现。");
        existing.visibility = "party";
        existing.actorKey = actorKey;
        existing.eventSequence = event.sequence;
      } else {
        product.discoveredClues.push({
          clueKey,
          actorKey,
          visibility: visibility as "private" | "party",
          eventSequence: event.sequence,
        });
      }
      const discoveredConclusions = new Set(
        product.discoveredClues
          .map(
            (item) =>
              product.clueCatalog.find((clue) => clue.clueKey === item.clueKey)
                ?.conclusionKey,
          )
          .filter((item): item is string => !!item),
      );
      for (const quest of product.questProgress) {
        if (
          quest.status === "active" &&
          quest.requiredConclusionKeys.every((key) =>
            discoveredConclusions.has(key),
          )
        ) {
          quest.status = "completed";
          quest.completedAtSequence = event.sequence;
        }
      }
      break;
    }
    case "ttrpg.scene.opened": {
      const ttrpg = requireTtrpgState(state);
      const scene = assertTtrpgScene(payload.scene);
      if (!ttrpg.product.sessionZero.completed)
        throw new Error("正式战役必须先完成 Session Zero。");
      if (ttrpg.product.ending)
        throw new Error("正式战役已经结束，不能再打开场景。");
      if (!ttrpg.product.sceneKeys.includes(scene.sceneKey)) {
        throw new Error("正式场景必须来自冻结 CampaignPack。");
      }
      const rawTurnOrder = payload.turnOrder;
      if (!Array.isArray(rawTurnOrder) || rawTurnOrder.length === 0) {
        throw new Error("跑团场景至少需要一个行动者。");
      }
      const turnOrder = rawTurnOrder.map((raw) => String(raw).trim());
      if (new Set(turnOrder).size !== turnOrder.length)
        throw new Error("跑团回合顺序不能重复。");
      for (const actorKey of turnOrder) {
        const actor = state.entities[actorKey];
        if (!actor || !["player", "character", "npc"].includes(actor.kind)) {
          throw new Error(`跑团行动者不存在或类型不支持: ${actorKey}`);
        }
      }
      const initiative = parseTtrpgState({
        ...ttrpg,
        scene,
        round: 1,
        activeActorKey: turnOrder[0],
        turnOrder,
        initiative: payload.initiative,
      })!.initiative;
      if (initiative?.sceneKey !== scene.sceneKey) {
        throw new Error("正式场景先攻收据没有绑定当前场景。");
      }
      if (scene.locationKey != null) {
        const location = state.entities[scene.locationKey];
        if (!location || location.kind !== "location")
          throw new Error(`跑团场景地点不存在: ${scene.locationKey}`);
      }
      ttrpg.scene = scene;
      if (!ttrpg.product.openedSceneKeys.includes(scene.sceneKey)) {
        ttrpg.product.openedSceneKeys.push(scene.sceneKey);
      }
      if (ttrpg.product.tabletop) {
        const tabletopMap = ttrpg.product.tabletop.maps.find((map) =>
          map.sceneKeys.includes(scene.sceneKey),
        );
        ttrpg.product.tabletop.currentMapKey = tabletopMap?.mapKey ?? null;
        ttrpg.product.tabletop.updatedAtSequence = event.sequence;
      }
      ttrpg.round = 1;
      ttrpg.activeActorKey = turnOrder[0];
      ttrpg.turnOrder = turnOrder;
      ttrpg.initiative = initiative;
      if (!Array.isArray(payload.abilityResets))
        throw new Error("正式场景事件缺少能力场景重置计划。");
      for (const raw of payload.abilityResets) {
        if (!isObject(raw)) throw new Error("能力场景重置项无效。");
        const stateKey = String(raw.stateKey ?? "").trim();
        const before = parseTtrpgAbilityRuntimeStateV2(raw.before);
        const after = parseTtrpgAbilityRuntimeStateV2(raw.after);
        if (
          stateKey !==
            ttrpgAbilityStateKeyV2(
              before.actorInstanceId,
              before.abilityKey,
            ) ||
          stableJson(ttrpg.product.abilityStates[stateKey]) !==
            stableJson(before)
        ) {
          throw new Error(`能力场景重置基线不一致:${stateKey}`);
        }
        ttrpg.product.abilityStates[stateKey] = after;
      }
      ttrpg.product.actionEconomy = startTtrpgActionEconomySceneV2({
        economy: ttrpg.product.actionEconomy,
        sceneKey: scene.sceneKey,
        turnOrder,
      });
      ttrpg.actions = [];
      ttrpg.checks = [];
      ttrpg.attacks = [];
      ttrpg.encounter = null;
      break;
    }
    case "ttrpg.media.requested": {
      const product = requireTtrpgState(state).product;
      if (
        !product.media.runtimePolicy.enabled ||
        product.media.runtimePolicy.networkPolicy === "disabled"
      ) {
        throw new Error("正式 TTRPG 没有启用运行时媒资。");
      }
      const slotKey = String(payload.slotKey ?? "").trim();
      const requestKey = String(payload.requestKey ?? "").trim();
      const styleBibleHash = String(payload.styleBibleHash ?? "").trim();
      const slot = product.media.slots.find((item) => item.slotKey === slotKey);
      if (
        !slot ||
        event.targetKey !== slotKey ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(requestKey) ||
        !/^[a-f0-9]{64}$/.test(styleBibleHash) ||
        payload.kind !== slot.kind ||
        payload.targetRef !== slot.targetRef ||
        payload.audience !== slot.audience ||
        (slot.status === "available" && slot.requestKey !== requestKey)
      ) {
        throw new Error("运行时媒资请求没有严格绑定冻结槽位。");
      }
      if (
        product.media.visualBibleHash != null &&
        product.media.visualBibleHash !== styleBibleHash
      ) {
        throw new Error("运行时媒资请求的视觉圣经已经漂移。");
      }
      product.media.visualBibleHash = styleBibleHash;
      slot.status = "queued";
      slot.requestKey = requestKey;
      slot.lastErrorCode = null;
      slot.updatedAtSequence = event.sequence;
      break;
    }
    case "ttrpg.media.available": {
      const product = requireTtrpgState(state).product;
      const slotKey = String(payload.slotKey ?? "").trim();
      const requestKey = String(payload.requestKey ?? "").trim();
      const assetKey = String(payload.assetKey ?? "").trim();
      const contentHash = String(payload.mediaContentHash ?? "").trim();
      const mediaAssetId = assertFiniteInteger(
        payload.mediaAssetId,
        "运行时媒资 ID",
        1,
        Number.MAX_SAFE_INTEGER,
      );
      const mediaAssetVersion = assertFiniteInteger(
        payload.mediaAssetVersion,
        "运行时媒资版本",
        1,
        Number.MAX_SAFE_INTEGER,
      );
      const slot = product.media.slots.find((item) => item.slotKey === slotKey);
      if (
        !slot ||
        event.targetKey !== slotKey ||
        slot.requestKey !== requestKey ||
        slot.status !== "queued" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(assetKey) ||
        !/^[a-f0-9]{64}$/.test(contentHash) ||
        product.media.generatedCount >=
          product.media.runtimePolicy.maximumGeneratedAssets
      ) {
        throw new Error("运行时媒资可用事件无效或超过冻结预算。");
      }
      slot.status = "available";
      slot.assetKey = assetKey;
      slot.mediaAssetId = mediaAssetId;
      slot.mediaAssetVersion = mediaAssetVersion;
      slot.mediaContentHash = contentHash;
      slot.lastErrorCode = null;
      slot.updatedAtSequence = event.sequence;
      product.media.generatedCount += 1;
      break;
    }
    case "ttrpg.media.failed": {
      const product = requireTtrpgState(state).product;
      const slotKey = String(payload.slotKey ?? "").trim();
      const requestKey = String(payload.requestKey ?? "").trim();
      const errorCode = String(payload.errorCode ?? "").trim();
      const slot = product.media.slots.find((item) => item.slotKey === slotKey);
      if (
        !slot ||
        event.targetKey !== slotKey ||
        slot.requestKey !== requestKey ||
        slot.status !== "queued" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(errorCode)
      ) {
        throw new Error("运行时媒资失败事件无效。");
      }
      slot.status = "failed";
      slot.lastErrorCode = errorCode;
      slot.updatedAtSequence = event.sequence;
      break;
    }
    case "ttrpg.media.cancelled": {
      const product = requireTtrpgState(state).product;
      const slotKey = String(payload.slotKey ?? "").trim();
      const requestKey = String(payload.requestKey ?? "").trim();
      const slot = product.media.slots.find((item) => item.slotKey === slotKey);
      if (
        !slot ||
        event.targetKey !== slotKey ||
        slot.requestKey !== requestKey ||
        !["queued", "failed"].includes(slot.status)
      )
        throw new Error("运行时媒资取消事件无效。");
      slot.status = "cancelled";
      slot.lastErrorCode = null;
      slot.updatedAtSequence = event.sequence;
      break;
    }
    case "ttrpg.tabletop.updated": {
      const product = requireTtrpgState(state).product;
      if (
        !product.sessionZero.completed ||
        !product.tabletop ||
        !state.ttrpg?.scene ||
        state.ttrpg.scene.status !== "active"
      ) {
        throw new Error("正式桌面操作需要已开始且未暂停的 CampaignPack 场景。");
      }
      const role = String(payload.role ?? "");
      const actorKey = String(payload.actorKey ?? "").trim();
      if (
        !["gm", "player"].includes(role) ||
        !actorKey ||
        event.actorKey !== actorKey
      )
        throw new Error("桌面操作者身份无效。");
      const operation = parseTtrpgTabletopOperationV1(payload.operation);
      applyTtrpgTabletopOperationV1({
        tabletop: product.tabletop,
        role: role as "gm" | "player",
        actorKey,
        operation,
        sequence: event.sequence,
      });
      break;
    }
    case "ttrpg.check.resolved": {
      const ttrpg = requireTtrpgState(state);
      if (!isObject(payload.check))
        throw new Error("跑团检定缺少 check 对象。");
      const check = assertTtrpgCheck({
        ...payload.check,
        eventSequence: event.sequence,
      });
      if (!ttrpg.turnOrder.includes(check.actorKey))
        throw new Error("跑团检定行动者不在当前回合顺序中。");
      if (
        check.rule.rulePackContentHash !== ttrpg.product.rulePackContentHash
      ) {
        throw new Error("正式 TTRPG 检定缺少匹配冻结规则包的裁定证据。");
      }
      if (ttrpg.activeActorKey !== check.actorKey)
        throw new Error("当前还没轮到该正式规则行动者。");
      ttrpg.checks.push(check);
      break;
    }
    case "ttrpg.intent.receipted": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product.sessionZero.completed || !ttrpg.scene) {
        throw new Error("正式行动意图收据需要已打开的 CampaignPack 场景。");
      }
      const receipt = parseTtrpgIntentReceiptV2(payload.receipt);
      if (
        receipt.eventSequence !== event.sequence ||
        receipt.actorKey !== event.actorKey ||
        receipt.targetKey !== event.targetKey
      ) {
        throw new Error("正式行动意图收据与事件身份不一致。");
      }
      const history = product.intentReceipts;
      if (history.some((item) => item.intentKey === receipt.intentKey)) {
        throw new Error("正式行动意图已经存在终态收据。");
      }
      history.push(receipt);
      break;
    }
    case "ttrpg.human-response.recorded": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product.sessionZero.completed || !ttrpg.scene) {
        throw new Error("真人角色回应需要已打开的正式 CampaignPack 场景。");
      }
      const response = parseTtrpgHumanResponseV2(payload.response);
      if (
        response.eventSequence !== event.sequence ||
        response.actorKey !== event.actorKey
      ) {
        throw new Error("真人角色回应与事件身份不一致。");
      }
      const sourceAction = product.actionHistory.find(
        (action) => action.eventSequence === response.actionSequence,
      );
      const sourceReceipt = sourceAction?.receipt;
      if (
        !sourceReceipt ||
        sourceReceipt.receiptKey !== response.actionReceiptKey
      ) {
        throw new Error("真人角色回应没有绑定有效 ActionReceipt。");
      }
      const observer = sourceReceipt.context.observers.find(
        (item) => item.actorKey === response.actorKey,
      );
      const promptWindow = sourceReceipt.context.reactionWindows.some(
        (window) =>
          window.status !== "closed" &&
          window.layer === "immediate-character" &&
          window.humanConfirmationRequiredActorKeys.includes(response.actorKey),
      );
      if (observer?.responsePolicy !== "prompt-human" || !promptWindow) {
        throw new Error("该角色没有属于本人的开放回应窗口。");
      }
      const history = product.humanResponses;
      if (history.some((item) => item.responseKey === response.responseKey)) {
        throw new Error("该真人角色已经回应本次行动。");
      }
      history.push(response);
      break;
    }
    case "ttrpg.rule.action.resolved": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (
        !product.sessionZero.completed ||
        !ttrpg.scene ||
        ttrpg.scene.status !== "active"
      ) {
        throw new Error("正式规则行动需要已开始的 CampaignPack 场景。");
      }
      if (!isObject(payload.result)) throw new Error("正式规则行动缺少结果。");
      const result = assertTtrpgRuleActionResult({
        ...payload.result,
        eventSequence: event.sequence,
      });
      if (
        result.actorKey !== event.actorKey ||
        result.targetKey !== event.targetKey
      ) {
        throw new Error("正式规则行动的行动者或目标与事件元数据不一致。");
      }
      if (
        result.actionPhase !== "reaction" &&
        ttrpg.activeActorKey !== result.actorKey
      ) {
        throw new Error("当前还没轮到该正式规则行动者。");
      }
      if (
        result.check &&
        (!result.check.rule ||
          result.check.rule.rulePackContentHash !==
            product.rulePackContentHash ||
          result.check.rule.actionKey !== result.actionKey)
      ) {
        throw new Error("正式规则行动的检定证据与冻结 RulePack 不一致。");
      }
      if (result.receipt) {
        const receipt = result.receipt;
        const declaredIntentKey = receipt.context.declaredIntent?.intentKey;
        if (
          declaredIntentKey &&
          (product.intentReceipts.some(
            (item) => item.intentKey === declaredIntentKey,
          ) ||
            product.actionHistory.some(
              (item) =>
                item.receipt?.context.declaredIntent?.intentKey ===
                declaredIntentKey,
            ))
        ) {
          throw new Error("正式行动意图已经存在终态收据。");
        }
        const observerKeys = receipt.context.observers.map(
          (observer) => observer.actorKey,
        );
        const changedEntityKeys = [
          ...new Set([
            ...result.resourceChanges.map((change) => change.entityKey),
            ...result.conditionChanges.map((change) => change.entityKey),
          ]),
        ];
        const actorConditions = (product.conditions[result.actorKey] ?? []).map(
          (condition) => condition.conditionKey,
        );
        const actorInventory = Object.values(product.inventory.items)
          .filter(
            (item) =>
              item.ownerRef === result.actorKey &&
              !item.stateTags.includes("broken"),
          )
          .map((item) => item.itemInstanceId);
        if (
          receipt.context.sceneKey !== ttrpg.scene.sceneKey ||
          receipt.context.round !== ttrpg.round ||
          receipt.context.activeActorKey !==
            (ttrpg.activeActorKey ?? result.actorKey) ||
          stableJson(observerKeys) !== stableJson(ttrpg.turnOrder) ||
          stableJson(receipt.context.actorConditionKeys) !==
            stableJson(actorConditions) ||
          stableJson(receipt.context.actorInventoryInstanceIds) !==
            stableJson(actorInventory) ||
          stableJson(receipt.changedEntityKeys) !==
            stableJson(changedEntityKeys)
        ) {
          throw new Error("ActionReceipt 上下文与规则行动提交前状态不一致。");
        }
      }
      for (const change of result.resourceChanges) {
        const entity = state.entities[change.entityKey];
        if (!entity)
          throw new Error(`正式规则资源目标不存在:${change.entityKey}`);
        const current = entity.attributes[`resource.${change.resourceKey}`];
        const maximum = entity.attributes[`resourceMax.${change.resourceKey}`];
        if (
          current !== change.before ||
          maximum !== change.maximum ||
          change.after !==
            Math.max(0, Math.min(change.maximum, change.before + change.delta))
        ) {
          throw new Error(
            `正式规则资源变化与当前状态不一致:${change.resourceKey}`,
          );
        }
        entity.attributes[`resource.${change.resourceKey}`] = change.after;
        if (change.resourceKey === "vigor") entity.attributes.hp = change.after;
      }
      for (const change of result.conditionChanges) {
        if (!state.entities[change.entityKey])
          throw new Error(`正式规则状态目标不存在:${change.entityKey}`);
        const current = product.conditions[change.entityKey] ?? [];
        const without = current.filter(
          (item) => item.conditionKey !== change.conditionKey,
        );
        product.conditions[change.entityKey] =
          change.stacks > 0
            ? [
                ...without,
                {
                  conditionKey: change.conditionKey,
                  stacks: change.stacks,
                  duration: change.duration,
                },
              ]
            : without;
      }
      if (!result.abilityChange) {
        throw new Error("正式规则行动缺少能力次数/冷却变化证据。");
      }
      {
        if (
          stableJson(product.abilityStates[result.abilityChange.stateKey]) !==
            stableJson(result.abilityChange.before)
        ) {
          throw new Error("正式规则行动的能力账本基线不一致。");
        }
        product.abilityStates[result.abilityChange.stateKey] = structuredClone(
          result.abilityChange.after,
        );
        if (result.abilityChange.sharedPoolKey != null) {
          if (
            stableJson(
              product.usagePools[result.abilityChange.sharedPoolKey],
            ) !== stableJson(result.abilityChange.sharedPoolBefore)
          ) {
            throw new Error("正式规则行动的共享次数池基线不一致。");
          }
          product.usagePools[result.abilityChange.sharedPoolKey] =
            structuredClone(result.abilityChange.sharedPoolAfter!);
        }
      }
      if (result.actionPhase) {
        const transition = spendTtrpgActionEconomyV2({
          economy: product.actionEconomy,
          turnOrder: ttrpg.turnOrder,
          actorKey: result.actorKey,
          phase: result.actionPhase,
        });
        if (
          transition.nextActorKey !== result.nextActorKey ||
          transition.nextRound !== result.nextRound
        ) {
          throw new Error("正式规则行动的行动经济推进不一致。");
        }
        product.actionEconomy = transition.economy;
        ttrpg.activeActorKey = transition.economy.activeActorKey;
        ttrpg.round = transition.economy.round;
      } else if (result.nextActorKey == null) {
        if (result.nextRound !== ttrpg.round)
          throw new Error("非回合行动不能修改回合数。");
      } else {
        const currentIndex = ttrpg.turnOrder.indexOf(result.actorKey);
        const nextIndex = (currentIndex + 1) % ttrpg.turnOrder.length;
        const expectedActor = ttrpg.turnOrder[nextIndex];
        const expectedRound = ttrpg.round + (nextIndex === 0 ? 1 : 0);
        if (
          result.nextActorKey !== expectedActor ||
          result.nextRound !== expectedRound
        ) {
          throw new Error("正式规则行动的回合推进不一致。");
        }
        ttrpg.activeActorKey = result.nextActorKey;
        ttrpg.round = result.nextRound;
      }
      ttrpg.actions.push({
        eventSequence: event.sequence,
        actorKey: result.actorKey,
        text: result.actionName,
      });
      if (result.check) ttrpg.checks.push(result.check);
      product.actionHistory.push(result);
      break;
    }
    case "ttrpg.rest.completed": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (
        !product.sessionZero.completed ||
        product.ending
      ) {
        throw new Error("正式休息需要进行中的 CampaignPack 与能力账本。");
      }
      if (ttrpg.encounter?.status === "active") {
        throw new Error("战斗遭遇进行中不能完成休息。");
      }
      const receipt = parseTtrpgRestReceiptV2(payload.receipt);
      if (
        receipt.eventSequence !== event.sequence ||
        receipt.completedBy !== event.actorKey
      ) {
        throw new Error("正式休息收据与事件身份不一致。");
      }
      const history = product.restHistory;
      if (history.some((item) => item.restKey === receipt.restKey)) {
        throw new Error("正式休息 key 已经提交。");
      }
      const rulePack = parseRulePackV1(payload.rulePack);
      const expectedChanges = Object.entries(product.abilityStates).flatMap(
        ([stateKey, before]) => {
          if (!receipt.actorKeys.includes(before.actorInstanceId)) return [];
          const action = rulePack.actions.find(
            (item) => item.key === before.abilityKey,
          );
          if (!action?.usage.reset.includes(receipt.kind)) return [];
          const after = resetTtrpgAbilityUsageV2({
            definition: {
              abilityKey: action.key,
              actionDefinitionKey: action.key,
              usage: action.usage,
            },
            state: before,
            trigger: receipt.kind,
            eventId: `event.${event.sequence}`,
          });
          return [
            {
              stateKey,
              actorKey: before.actorInstanceId,
              abilityKey: before.abilityKey,
              before: structuredClone(before),
              after,
            },
          ];
        },
      );
      if (stableJson(receipt.abilityChanges) !== stableJson(expectedChanges)) {
        throw new Error("正式休息恢复清单与冻结 RulePack 或当前账本不一致。");
      }
      for (const change of receipt.abilityChanges) {
        if (
          stableJson(product.abilityStates[change.stateKey]) !==
          stableJson(change.before)
        ) {
          throw new Error(`正式休息能力账本基线不一致:${change.stateKey}`);
        }
        product.abilityStates[change.stateKey] = structuredClone(change.after);
      }
      history.push(receipt);
      break;
    }
    case "ttrpg.item.changed": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product.sessionZero.completed) {
        throw new Error("正式物品命令需要已完成 Session Zero 的库存账本。");
      }
      const command = parseTtrpgItemCommandV2(payload.command);
      if (command.commandId !== event.commandId)
        throw new Error("物品命令与正式事件幂等键不一致。");
      const definitions = isObject(payload.definitions)
        ? Object.fromEntries(
            Object.entries(payload.definitions).map(
              ([definitionKey, definition]) => [
                definitionKey,
                ttrpgItemDefinitionFromRuleV1(
                  definition as import("../types").RuleItemDefinitionV1,
                ),
              ],
            ),
          )
        : null;
      if (!definitions) throw new Error("正式物品命令缺少冻结定义。");
      const before = structuredClone(
        product.inventory.items[command.instanceId] ?? null,
      );
      const applied = applyTtrpgItemCommandV2({
        state: product.inventory,
        definitions,
        command,
      });
      if (applied.replayed) throw new Error("物品命令已经在库存账本执行。");
      const changed = applied.changedItemIds
        .map((itemId) => applied.state.items[itemId])
        .filter(Boolean);
      if (
        changed.some(
          (item) => item.ownerRef != null && !state.entities[item.ownerRef],
        )
      ) {
        throw new Error("物品命令产生了未知角色所有者。");
      }
      product.inventory = applied.state;
      const requestedBy = isObject(payload.requestedBy)
        ? {
            role: String(payload.requestedBy.role),
            actorKey: String(payload.requestedBy.actorKey ?? "").trim(),
          }
        : {
            role: event.actorKey === "gm" ? "gm" : "player",
            actorKey: String(event.actorKey ?? "").trim(),
          };
      if (
        !["gm", "player"].includes(requestedBy.role) ||
        requestedBy.actorKey !== event.actorKey
      ) {
        throw new Error("物品收据操作者与正式事件身份不一致。");
      }
      const after = structuredClone(
        product.inventory.items[command.instanceId] ?? null,
      );
      const history = product.itemHistory;
      if (
        history.some(
          (receipt) =>
            receipt.commandId === event.commandId ||
            receipt.eventSequence === event.sequence,
        )
      ) {
        throw new Error("物品收据已经存在。");
      }
      history.push({
        schema: "storyforge.ttrpg-item-receipt",
        version: 2,
        eventSequence: event.sequence,
        commandId: event.commandId,
        operation: command.kind,
        itemInstanceId: command.instanceId,
        definitionRef:
          before?.definitionRef ??
          after?.definitionRef ??
          (command.kind === "grant" ? command.definitionRef : ""),
        requestedBy: {
          role: requestedBy.role as "gm" | "player",
          actorKey: requestedBy.actorKey,
        },
        before,
        after,
      });
      break;
    }
    case "ttrpg.effects.choice.proposed": {
      const product = requireTtrpgState(state).product;
      if (!product.sessionZero.completed) {
        throw new Error("正式效果选择需要已完成 Session Zero 的效果账本。");
      }
      const plan = parseTtrpgEffectPlanV2(payload.plan);
      if (plan.idempotencyKey !== event.commandId) {
        throw new Error("效果选择提议幂等键与正式事件 commandId 不一致。");
      }
      const actionSequence = assertFiniteInteger(
        payload.actionSequence,
        "效果选择来源行动序号",
        1,
        event.sequence - 1,
      );
      const ownerActorKey = String(payload.ownerActorKey ?? "").trim();
      if (event.actorKey !== "gm" || !ownerActorKey) {
        throw new Error("效果选择提议必须由 GM 提交并绑定所有者。");
      }
      const proposed = proposeTtrpgEffectChoiceToRuntimeV2({
        state,
        plan,
        actionSequence,
        ownerActorKey,
        eventSequence: event.sequence,
      });
      Object.assign(state, proposed.state);
      break;
    }
    case "ttrpg.effects.applied": {
      const product = requireTtrpgState(state).product;
      if (!product.sessionZero.completed) {
        throw new Error("正式 EffectPlan 需要已完成 Session Zero 的效果账本。");
      }
      const plan = parseTtrpgEffectPlanV2(payload.plan);
      if (plan.idempotencyKey !== event.commandId)
        throw new Error("EffectPlan 幂等键与正式事件 commandId 不一致。");
      const rulePack = parseRulePackV1(payload.rulePack);
      if (payload.choiceKey != null) {
        if (!isObject(payload.requestedBy)) {
          throw new Error("效果选择结算缺少操作者。");
        }
        const choiceKey = String(payload.choiceKey ?? "").trim();
        const selectedEffectKey = String(
          payload.selectedEffectKey ?? "",
        ).trim();
        const requestedBy = {
          role: String(payload.requestedBy.role ?? ""),
          actorKey: String(payload.requestedBy.actorKey ?? "").trim(),
        };
        const pending = product.effectLedger.pendingChoices.find(
          (choice) => choice.choiceKey === choiceKey,
        );
        if (
          !pending ||
          !["gm", "player"].includes(requestedBy.role) ||
          requestedBy.actorKey !== pending.ownerActorKey ||
          event.actorKey !== pending.ownerActorKey
        ) {
          throw new Error("效果选择结算身份或所有者不一致。");
        }
        const resolved = resolveTtrpgEffectChoiceToRuntimeV2({
          state,
          rulePack,
          choiceKey,
          selectedEffectKey,
          commandId: event.commandId,
          eventSequence: event.sequence,
        });
        if (stableJson(resolved.plan) !== stableJson(plan)) {
          throw new Error("效果选择结算计划不是由冻结选项派生。");
        }
        Object.assign(state, resolved.state);
        break;
      }
      if (
        product.effectLedger.pendingChoices.some(
          (choice) => choice.plan.sourceEventId === plan.sourceEventId,
        )
      ) {
        throw new Error("该行动已有待玩家确认的后果，不能绕过选择直接结算。");
      }
      const applied = applyTtrpgEffectPlanToRuntimeV2({
        state,
        rulePack,
        plan,
        eventSequence: event.sequence,
      });
      Object.assign(state, applied.state);
      break;
    }
    case "ttrpg.gm.response.recorded": {
      const ttrpg = requireTtrpgState(state);
      if (!ttrpg.scene || ttrpg.scene.status !== "active")
        throw new Error("跑团尚未开始活动场景。");
      const actionSequence = assertFiniteInteger(
        payload.actionSequence,
        "跑团动作序号",
        1,
        event.sequence - 1,
      );
      if (
        !ttrpg.actions.some((action) => action.eventSequence === actionSequence)
      ) {
        throw new Error("AI GM 叙事没有对应的玩家动作。");
      }
      if (payload.checkSequence != null) {
        const checkSequence = assertFiniteInteger(
          payload.checkSequence,
          "跑团检定序号",
          1,
          event.sequence - 1,
        );
        if (
          !ttrpg.checks.some((check) => check.eventSequence === checkSequence)
        ) {
          throw new Error("AI GM 叙事引用了不存在的检定。");
        }
      }
      const text = String(payload.text ?? "").trim();
      if (!text || text.length > 20_000)
        throw new Error("AI GM 叙事文本无效。");
      {
        const source = String(payload.source ?? "");
        const candidateHash =
          payload.candidateHash == null ? null : String(payload.candidateHash);
        const runId =
          payload.runId == null
            ? null
            : assertFiniteInteger(
                payload.runId,
                "AI GM Run ID",
                1,
                Number.MAX_SAFE_INTEGER,
              );
        const latestAction =
          ttrpg.product.actionHistory[ttrpg.product.actionHistory.length - 1];
        if (
          !["human-gm", "ai-confirmed", "deterministic-fallback"].includes(
            source,
          ) ||
          (source === "ai-confirmed" &&
            (!candidateHash ||
              !/^[0-9a-f]{64}$/.test(candidateHash) ||
              runId == null)) ||
          ((source === "human-gm" || source === "deterministic-fallback") &&
            (candidateHash != null || runId != null)) ||
          latestAction?.eventSequence !== actionSequence
        ) {
          throw new Error("正式 GM 叙事证据无效或没有绑定最近规则行动。");
        }
        const checkSequence =
          payload.checkSequence == null
            ? null
            : assertFiniteInteger(
                payload.checkSequence,
                "跑团检定序号",
                1,
                event.sequence - 1,
              );
        if ((latestAction.check?.eventSequence ?? null) !== checkSequence) {
          throw new Error("正式 AI GM 叙事引用的检定与规则行动不一致。");
        }
        if (
          ttrpg.product.gmNarrations.some(
            (item) => item.actionSequence === actionSequence,
          )
        ) {
          throw new Error("最近规则行动已经有正式 GM 叙事。");
        }
        const modelEvidence = parseTtrpgModelEvidenceV1(payload.modelEvidence);
        if (!Array.isArray(payload.modelCalls)) {
          throw new Error("正式 GM 响应缺少模型调用账本。");
        }
        const modelCalls = payload.modelCalls
          .map(parseTtrpgModelEvidenceV1)
          .filter(
            (item): item is TtrpgRuntimeModelEvidenceV1 => item != null,
          );
        const repairApplied = payload.repairApplied === true;
        if (
          modelCalls.length > 2 ||
          ((source === "human-gm" || source === "deterministic-fallback") &&
            (modelEvidence || modelCalls.length || repairApplied))
        ) {
          throw new Error("正式 GM 模型调用或修复证据无效。");
        }
        const synthesisFrame = parseTtrpgGmSynthesisFrameV2(
          payload.synthesisFrame,
          latestAction.receipt,
        );
        ttrpg.product.gmNarrations.push({
          eventSequence: event.sequence,
          actionSequence,
          checkSequence,
          text,
          candidateHash,
          runId,
          modelEvidence,
          modelCalls,
          repairApplied,
          synthesisFrame,
          source: source as
            "human-gm" | "ai-confirmed" | "deterministic-fallback",
        });
      }
      state.narratives.push({ eventSequence: event.sequence, text });
      break;
    }
    case "ttrpg.campaign.ended": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (
        product.ending ||
        !ttrpg.scene ||
        ttrpg.scene.status !== "active"
      ) {
        throw new Error("正式战役当前不能提交结局。");
      }
      const endingKey = String(payload.endingKey ?? "").trim();
      const ending = product.endingCatalog.find(
        (item) => item.endingKey === endingKey,
      );
      if (
        !ending ||
        payload.title !== ending.title ||
        payload.epilogue !== ending.epilogue
      ) {
        throw new Error("战役结局与冻结 CampaignPack 不一致。");
      }
      const knownConclusions = new Set(
        product.discoveredClues.flatMap((discovery) => {
          const clue = product.clueCatalog.find(
            (item) => item.clueKey === discovery.clueKey,
          );
          return clue ? [clue.conclusionKey] : [];
        }),
      );
      if (
        ending.trigger.sceneKey !== ttrpg.scene.sceneKey ||
        ending.trigger.requiredConclusionKeys.some(
          (key) => !knownConclusions.has(key),
        ) ||
        ending.trigger.forbiddenConclusionKeys.some((key) =>
          knownConclusions.has(key),
        )
      ) {
        throw new Error("战役结局触发条件与当前状态不一致。");
      }
      if (!Array.isArray(payload.awardedMilestones))
        throw new Error("战役结局缺少成长里程碑。");
      const awardedMilestones = payload.awardedMilestones.map((raw, index) => {
        if (!isObject(raw)) throw new Error(`战役成长奖励 ${index} 无效。`);
        return {
          milestoneKey: String(raw.milestoneKey ?? "").trim(),
          award: assertFiniteInteger(raw.award, "战役成长奖励", 0, 1_000_000),
        };
      });
      const expectedMilestones = product.advancement.milestones
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
      if (stableJson(awardedMilestones) !== stableJson(expectedMilestones)) {
        throw new Error("战役成长奖励与冻结 CampaignPack 不一致。");
      }
      product.advancement.awardedMilestoneKeys.push(
        ...awardedMilestones.map((item) => item.milestoneKey),
      );
      product.advancement.totalAwarded += awardedMilestones.reduce(
        (sum, item) => sum + item.award,
        0,
      );
      product.ending = { endingKey, eventSequence: event.sequence };
      ttrpg.scene.status = "resolved";
      ttrpg.activeActorKey = null;
      state.narratives.push({
        eventSequence: event.sequence,
        text: ending.epilogue,
      });
      break;
    }
    case "ttrpg.campaign.session.started": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (
        !product.sessionZero.completed ||
        product.ending ||
        ttrpg.campaign.activeSessionKey != null
      ) {
        throw new Error("当前正式战役不能开始新的长期分场。");
      }
      const playSession = assertTtrpgCampaignPlaySessionV2(payload.playSession);
      if (
        playSession.status !== "active" ||
        playSession.startedSequence !== event.sequence ||
        playSession.completedSequence != null ||
        playSession.ordinal !== ttrpg.campaign.playSessions.length + 1 ||
        playSession.rulePackContentHash !== product.rulePackContentHash ||
        playSession.campaignKey !== product.campaignKey ||
        ttrpg.campaign.playSessions.some(
          (item) => item.sessionKey === playSession.sessionKey,
        )
      ) {
        throw new Error("长期战役分场开始收据与当前冻结战役不一致。");
      }
      const activeRoster = ttrpg.campaign.roster
        .filter((entry) => entry.status === "active")
        .map((entry) => entry.characterKey)
        .sort();
      const participants = [...playSession.participantKeys].sort();
      if (
        !activeRoster.length ||
        stableJson(activeRoster) !== stableJson(participants) ||
        participants.some((key) => state.entities[key]?.kind !== "player")
      ) {
        throw new Error("长期战役分场参与者必须精确匹配当前活动编组。");
      }
      ttrpg.campaign.playSessions.push(playSession);
      ttrpg.campaign.activeSessionKey = playSession.sessionKey;
      ttrpg.campaign.roster = ttrpg.campaign.roster.map((entry) =>
        entry.status === "active" && entry.joinedSessionKey == null
          ? {
              ...entry,
              joinedSessionKey: playSession.sessionKey,
              updatedSequence: event.sequence,
            }
          : entry,
      );
      break;
    }
    case "ttrpg.campaign.session.completed": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign;
      const sessionKey = longCampaignKey(
        payload.sessionKey,
        "长期战役完成分场 key",
      );
      const active = campaignState.playSessions.find(
        (item) => item.sessionKey === sessionKey,
      );
      const summary = longCampaignText(
        payload.summary,
        "长期战役分场摘要",
        20_000,
      );
      if (
        campaignState.activeSessionKey !== sessionKey ||
        active?.status !== "active" ||
        active.completedSequence != null ||
        !Array.isArray(payload.memories) ||
        !Array.isArray(payload.abilityResets)
      ) {
        throw new Error("长期战役完成事件没有绑定当前活动分场。");
      }
      const memories = payload.memories.map(assertTtrpgCampaignMemoryV2);
      if (
        new Set(memories.map((item) => item.memoryKey)).size !==
          memories.length ||
        memories.some(
          (item) =>
            item.sourceSessionKey !== sessionKey ||
            item.updatedSequence !== event.sequence ||
            campaignState.memories.some(
              (prior) => prior.memoryKey === item.memoryKey,
            ) ||
            (item.audience.startsWith("actor:") &&
              !campaignState.roster.some(
                (entry) =>
                  entry.characterKey === item.audience.slice("actor:".length),
              )),
        )
      ) {
        throw new Error("长期战役记忆没有唯一绑定当前分场或合法受众。");
      }
      const product = ttrpg.product;
      for (const raw of payload.abilityResets) {
        if (!isObject(raw)) throw new Error("能力跨场重置项无效。");
        const stateKey = String(raw.stateKey ?? "").trim();
        const before = parseTtrpgAbilityRuntimeStateV2(raw.before);
        const after = parseTtrpgAbilityRuntimeStateV2(raw.after);
        if (
          stateKey !==
            ttrpgAbilityStateKeyV2(before.actorInstanceId, before.abilityKey) ||
          stableJson(product.abilityStates[stateKey]) !== stableJson(before) ||
          after.actorInstanceId !== before.actorInstanceId ||
          after.abilityKey !== before.abilityKey ||
          after.lastUsedEventId !== `event.${event.sequence}`
        ) {
          throw new Error(`能力跨场重置基线不一致:${stateKey}`);
        }
        product.abilityStates[stateKey] = after;
      }
      active.status = "completed";
      active.completedSequence = event.sequence;
      active.summary = summary;
      campaignState.activeSessionKey = null;
      campaignState.memories.push(...memories);
      const summaryEntry = `第 ${active.ordinal} 场《${active.title}》：${summary}`;
      campaignState.summary = [campaignState.summary, summaryEntry]
        .filter(Boolean)
        .join("\n\n")
        .slice(-20_000);
      ttrpg.campaign = campaignState;
      break;
    }
    case "ttrpg.campaign.roster.changed": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign;
      if (campaignState.activeSessionKey != null)
        throw new Error("长期战役只能在两场之间变更编组。");
      const entry = assertTtrpgRosterEntryV2(payload.entry);
      const priorIndex = campaignState.roster.findIndex(
        (item) => item.characterKey === entry.characterKey,
      );
      const prior = campaignState.roster[priorIndex];
      if (
        !prior ||
        entry.updatedSequence !== event.sequence ||
        state.entities[entry.characterKey]?.kind !== "player" ||
        !ttrpg.product.characterProgression[entry.characterKey] ||
        prior.status === "retired" ||
        prior.status === entry.status ||
        (prior.status === "reserve" && entry.status !== "active") ||
        (prior.status === "active" && entry.status === "active") ||
        entry.joinedSessionKey !== prior.joinedSessionKey ||
        (entry.status === "retired" && entry.leftSessionKey == null) ||
        (entry.status !== "retired" && entry.leftSessionKey != null)
      ) {
        throw new Error("长期战役编组变更不是允许的补员、轮换或退役迁移。");
      }
      if (entry.replacementFor != null) {
        const replaced = campaignState.roster.find(
          (item) => item.characterKey === entry.replacementFor,
        );
        if (
          entry.status !== "active" ||
          entry.replacementFor === entry.characterKey ||
          replaced?.status !== "retired"
        ) {
          throw new Error("补员替代关系必须指向已经退役的不同角色。");
        }
      }
      const nextRoster = [...campaignState.roster];
      nextRoster[priorIndex] = entry;
      const activeKeys = nextRoster
        .filter((item) => item.status === "active")
        .map((item) => item.characterKey);
      if (!activeKeys.length || activeKeys.length > 12)
        throw new Error("长期战役必须保留 1–12 名活动角色。");
      campaignState.roster = nextRoster;
      ttrpg.campaign = campaignState;
      ttrpg.product.sessionZero.selectedCharacterKeys = activeKeys;
      break;
    }
    case "ttrpg.campaign.supplement.activated": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign;
      if (campaignState.activeSessionKey != null)
        throw new Error("补充包只能在两场之间激活。");
      const supplement = assertTtrpgSupplementReceiptV2(payload.supplement);
      if (
        supplement.updatedSequence !== event.sequence ||
        campaignState.supplements.some(
          (item) => item.supplementKey === supplement.supplementKey,
        ) ||
        (supplement.activatedSessionKey != null &&
          !campaignState.playSessions.some(
            (item) =>
              item.sessionKey === supplement.activatedSessionKey &&
              item.status === "completed",
          ))
      ) {
        throw new Error("补充包激活收据无效或重复。");
      }
      campaignState.supplements.push(supplement);
      ttrpg.campaign = campaignState;
      break;
    }
    case "ttrpg.campaign.world-evolution.recorded": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign;
      if (campaignState.activeSessionKey != null)
        throw new Error("世界演化候选只能在两场之间记录或复审。");
      const candidate = assertTtrpgWorldEvolutionV2(payload.candidate);
      if (
        candidate.updatedSequence !== event.sequence ||
        !campaignState.playSessions.some(
          (item) =>
            item.sessionKey === candidate.sourceSessionKey &&
            item.status === "completed",
        )
      ) {
        throw new Error("世界演化候选没有绑定已完成分场。");
      }
      const index = campaignState.worldEvolution.findIndex(
        (item) => item.candidateKey === candidate.candidateKey,
      );
      const prior = campaignState.worldEvolution[index];
      if (!prior) {
        if (candidate.status !== "proposed" || candidate.reviewedBy != null)
          throw new Error("新世界演化候选必须先进入 proposed 状态。");
        campaignState.worldEvolution.push(candidate);
      } else {
        if (
          prior.status !== "proposed" ||
          candidate.status === "proposed" ||
          candidate.reviewedBy == null ||
          candidate.category !== prior.category ||
          candidate.summary !== prior.summary ||
          candidate.sourceSessionKey !== prior.sourceSessionKey ||
          candidate.targetWorldRef !== prior.targetWorldRef
        ) {
          throw new Error("世界演化候选只能由 proposed 审核为批准或拒绝。");
        }
        campaignState.worldEvolution[index] = candidate;
      }
      // Approval deliberately stops at a review candidate. World Canon writes
      // still require the normal AdoptionSchema/FIELD_REGISTRY path.
      ttrpg.campaign = campaignState;
      break;
    }
    case "ttrpg.campaign.version-transition.recorded": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign;
      const product = ttrpg.product;
      if (campaignState.activeSessionKey != null)
        throw new Error("版本迁移只能在冻结战役的两场之间记录。");
      const transition = assertTtrpgVersionTransitionV2(payload.transition);
      if (
        transition.updatedSequence !== event.sequence ||
        transition.fromRulePackContentHash !== product.rulePackContentHash ||
        transition.fromCampaignKey !== product.campaignKey ||
        campaignState.versionTransitions.some(
          (item) => item.transitionKey === transition.transitionKey,
        ) ||
        (transition.status === "activated" &&
          (transition.toRulePackContentHash !== product.rulePackContentHash ||
            transition.toCampaignKey !== product.campaignKey))
      ) {
        throw new Error("版本迁移记录与当前冻结内容不一致或试图原地换包。");
      }
      campaignState.versionTransitions.push(transition);
      ttrpg.campaign = campaignState;
      break;
    }
    default:
      throw new Error(`[ttrpg] 未登记运行事件：${event.type}`)
  }
  state.lastSequence = event.sequence
  return state
}
