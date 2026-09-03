import type { ProductRuntimeState, TtrpgRuntimeContentV1 } from "../types";
import { evaluateRuleNumberExpressionV1, parseRulePackV1 } from "./rule-pack";
import { parseTtrpgCampaignContentV1 } from "./campaign";
import { createDormantTtrpgActionEconomyV2 } from "./action-economy";
import {
  applyTtrpgItemCommandV2,
  createEmptyTtrpgInventoryV2,
  ttrpgItemDefinitionFromRuleV1,
} from "./item-ledger";
import {
  createTtrpgAbilityRuntimeStateV2,
  ttrpgAbilityStateKeyV2,
} from "./ability-ledger";
import { createEmptyTtrpgEffectLedgerV2 } from "./effect-runtime";
import { parseTtrpgCharacterSheetV2 } from "./character-sheet";
import { earnedTtrpgCharacterCurrencyV2 } from "./advancement";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([field, child]) => `${JSON.stringify(field)}:${stableJson(child)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export function createInitialTtrpgProductStateV1(input: {
  initialState: ProductRuntimeState;
  content: TtrpgRuntimeContentV1;
}): ProductRuntimeState {
  const state = structuredClone(input.initialState);
  const rulePack = parseRulePackV1(input.content.rulePack.content);
  const campaign = parseTtrpgCampaignContentV1(
    input.content.campaign,
    rulePack,
  );
  const itemDefinitions = Object.fromEntries(
    rulePack.items.map((item) => [
      item.key,
      ttrpgItemDefinitionFromRuleV1(item),
    ]),
  );
  let inventory = createEmptyTtrpgInventoryV2();
  campaign.characterTemplates.forEach((template, templateIndex) => {
    template.itemKeys.forEach((itemKey, itemIndex) => {
      inventory = applyTtrpgItemCommandV2({
        state: inventory,
        definitions: itemDefinitions,
        command: {
          commandId: `initial.item.${templateIndex}.${itemIndex}`,
          kind: "grant",
          instanceId: `item.${templateIndex}.${itemIndex}.${itemKey}`,
          definitionRef: itemKey,
          ownerRef: template.characterKey,
          locationRef: null,
          quantity: 1,
          eventId: "release.initial",
        },
      }).state;
    });
  });
  const abilityStates = Object.fromEntries(
    campaign.characterTemplates.flatMap((template) =>
      rulePack.actions.map((action) => {
        const stateKey = ttrpgAbilityStateKeyV2(
          template.characterKey,
          action.key,
        );
        return [
          stateKey,
          createTtrpgAbilityRuntimeStateV2({
            actorInstanceId: template.characterKey,
            definition: {
              abilityKey: action.key,
              actionDefinitionKey: action.key,
              usage: action.usage,
            },
          }),
        ];
      }),
    ),
  );
  for (const template of campaign.characterTemplates) {
    // Manual, quick-card and AI-generated PCs/NPCs are game-only entities.
    // They enter the session projection without being written back to World
    // Canon; world-backed templates continue to reuse release-character keys.
    const entity =
      state.entities[template.characterKey] ??
      (state.entities[template.characterKey] = {
        entityKey: template.characterKey,
        kind: template.role === "player" ? "player" : "npc",
        sourceId: null,
        name: template.name,
        locationKey: null,
        lifecycleStatus: "active",
        attributes: {
          productLocal: true,
          description: template.description,
        },
      });
    const derived = Object.fromEntries(
      rulePack.derivedStats.map((stat) => {
        let value = evaluateRuleNumberExpressionV1(
          stat.formula,
          template.attributes,
        );
        if (stat.minimum != null) value = Math.max(stat.minimum, value);
        if (stat.maximum != null) value = Math.min(stat.maximum, value);
        return [stat.key, value];
      }),
    );
    const maximums = Object.fromEntries(
      rulePack.resources.map((resource) => [
        resource.key,
        evaluateRuleNumberExpressionV1(
          resource.maximumFormula,
          template.attributes,
        ),
      ]),
    );
    entity.kind = template.role === "player" ? "player" : "npc";
    entity.attributes = {
      ...entity.attributes,
      ...template.attributes,
      ...derived,
      ...Object.fromEntries(
        Object.entries(template.resources).map(([key, value]) => [
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
      // Compatibility projection for the existing deterministic encounter core.
      hp: template.resources.vigor ?? 1,
      maxHp: maximums.vigor ?? template.resources.vigor ?? 1,
      armorClass: derived.defense ?? 8,
      initiative:
        template.attributes[rulePack.turnStructure.initiativeAttributeKey] ?? 0,
    };
  }
  const visualLocations = new Map(
    (campaign.visualBible?.locations ?? []).map((location) => [
      location.locationKey,
      location,
    ]),
  );
  for (const scene of campaign.scenes) {
    if (scene.locationKey == null || state.entities[scene.locationKey]) continue;
    const visual = visualLocations.get(scene.locationKey);
    state.entities[scene.locationKey] = {
      entityKey: scene.locationKey,
      kind: "location",
      sourceId: null,
      name: visual?.anchors[0] ?? scene.locationKey,
      locationKey: null,
      lifecycleStatus: "active",
      attributes: {
        productLocal: true,
        identity: visual?.identityPrompt ?? scene.description,
      },
    };
  }
  state.ttrpg = {
    scene: null,
    round: 0,
    activeActorKey: null,
    turnOrder: [],
    initiative: null,
    actions: [],
    checks: [],
    attacks: [],
    encounter: null,
    campaign: {
      summary: campaign.pitch,
      quests: [],
      npcSchedules: [],
      activeSessionKey: null,
      playSessions: [],
      roster: campaign.characterTemplates
        .filter((template) => template.role === "player")
        .map((template) => ({
          characterKey: template.characterKey,
          status: "reserve" as const,
          joinedSessionKey: null,
          leftSessionKey: null,
          replacementFor: null,
          reason: "",
          updatedSequence: 0,
        })),
      memories: [],
      supplements: [],
      worldEvolution: [],
      versionTransitions: [],
    },
    product: {
      rulePackContentHash: input.content.rulePack.contentHash,
      campaignKey: campaign.campaignKey,
      campaignTitle: campaign.title,
      openingSceneKey: campaign.openingSceneKey,
      sessionZero: {
        completed: false,
        requiredItemKeys: campaign.sessionZero.consentChecklist.map(
          (_, index) => `consent.${index + 1}`,
        ),
        acceptedItemKeys: [],
        selectedCharacterKeys: [],
        completedBy: null,
        completedAtSequence: null,
      },
      safety: {
        status: "active",
        reason: null,
        changedBy: null,
        changedAtSequence: null,
      },
      hiddenDicePolicy: campaign.informationPolicy?.hiddenDice ?? "never",
      sceneKeys: campaign.scenes.map((scene) => scene.sceneKey),
      openedSceneKeys: [],
      clueCatalog: campaign.clues.map((clue) => ({
        clueKey: clue.clueKey,
        conclusionKey: clue.conclusionKey,
        required: clue.required,
        sourceVisibility: clue.visibility,
      })),
      clockCatalog: (campaign.clocks ?? []).map((clock) => ({
        clockKey: clock.clockKey,
        title: clock.title,
        initialValue: clock.initialValue,
        maximum: clock.maximum,
        visibility: clock.visibility,
        onComplete: clock.onComplete,
      })),
      discoveredClues: [],
      conditions: {},
      actionEconomy: createDormantTtrpgActionEconomyV2({
        actionsPerTurn: rulePack.turnStructure.actionsPerTurn,
        reactionsPerRound: rulePack.turnStructure.reactionsPerRound,
      }),
      inventory,
      itemHistory: [],
      abilityStates,
      usagePools: {},
      effectLedger: createEmptyTtrpgEffectLedgerV2(),
      characterProgression: Object.fromEntries(
        campaign.characterTemplates
          .filter((template) => template.role === "player")
          .map((template) => {
            const progression = template.characterSheet?.rules.progression ?? {
              model:
                rulePack.advancement.progressionModel ?? ("point-buy" as const),
              level:
                rulePack.advancement.progressionModel === "numeric-level"
                  ? 1
                  : null,
              rankKey:
                rulePack.advancement.progressionModel === "rank"
                  ? (rulePack.advancement.rankOrder?.[0] ?? null)
                  : null,
            };
            return [
              template.characterKey,
              {
                model: progression.model,
                level: progression.level,
                rankKey: progression.rankKey,
                spentCurrency: 0,
                attributeIncreases: {},
                skillIncreases: {},
                history: [],
              },
            ];
          }),
      ),
      characterCustomizations: [],
      actionHistory: [],
      intentReceipts: [],
      humanResponses: [],
      restHistory: [],
      gmNarrations: [],
      questProgress: campaign.quests.map((quest) => ({
        questKey: quest.questKey,
        requiredConclusionKeys: quest.requiredConclusionKeys,
        status: "active",
        completedAtSequence: null,
      })),
      endingCatalog: campaign.endings.map((ending) => ({
        endingKey: ending.endingKey,
        title: ending.title,
        epilogue: ending.epilogue,
        trigger: ending.trigger ? structuredClone(ending.trigger) : null,
      })),
      ending: null,
      advancement: {
        currencyKey: rulePack.advancement.currencyKey,
        currencyName: rulePack.advancement.currencyName,
        totalAwarded: 0,
        milestones: campaign.advancementMilestones,
        awardedMilestoneKeys: [],
      },
      tabletop: campaign.tabletop
        ? {
            currentMapKey: null,
            maps: campaign.tabletop.maps.map((map) => ({
              mapKey: map.mapKey,
              sceneKeys: campaign.scenes
                .filter((scene) => scene.tabletopMapKey === map.mapKey)
                .map((scene) => scene.sceneKey),
              width: map.width,
              height: map.height,
              publicLayerKeys: map.layers
                .filter((layer) => !layer.gmOnly)
                .map((layer) => layer.layerKey),
              gmLayerKeys: map.layers
                .filter((layer) => layer.gmOnly)
                .map((layer) => layer.layerKey),
              areaKeys: map.areas
                .filter((area) => !area.gmOnly)
                .map((area) => area.areaKey),
              gmAreaKeys: map.areas
                .filter((area) => area.gmOnly)
                .map((area) => area.areaKey),
              fogKeys: map.fog.map((fog) => fog.fogKey),
            })),
            tokens: campaign.tabletop.maps.flatMap((map) =>
              map.tokens.map((token) => ({
                tokenKey: token.tokenKey,
                entityKey: token.entityKey,
                mapKey: map.mapKey,
                x: token.x,
                y: token.y,
                size: token.size,
                controllerKey: token.controllerKey,
                hidden: token.hidden,
              })),
            ),
            visibleLayerKeys: campaign.tabletop.maps.flatMap((map) =>
              map.layers.map((layer) => layer.layerKey),
            ),
            revealedFogKeys: [],
            updatedAtSequence: null,
          }
        : null,
      media: campaign.mediaManifest
        ? {
            visualBibleHash: null,
            generatedCount: 0,
            runtimePolicy: structuredClone(
              campaign.mediaManifest.runtimePolicy,
            ),
            slots: campaign.mediaManifest.slots.map((slot) => ({
              slotKey: slot.slotKey,
              kind: slot.kind,
              targetRef: slot.targetRef,
              audience: slot.audience,
              fallbackText: slot.fallbackText,
              altText: slot.altText,
              status: slot.assetKey
                ? ("available" as const)
                : ("placeholder" as const),
              requestKey: null,
              assetKey: slot.assetKey,
              mediaAssetId: null,
              mediaAssetVersion: null,
              mediaContentHash: null,
              lastErrorCode: null,
              updatedAtSequence: null,
            })),
          }
        : null,
    },
  };
  return state;
}

export function assertInitialTtrpgProductStateV1(input: {
  state: ProductRuntimeState;
  content: TtrpgRuntimeContentV1;
  allowProgress?: boolean;
}): void {
  const rulePack = parseRulePackV1(input.content.rulePack.content);
  const expected = createInitialTtrpgProductStateV1({
    initialState: { ...structuredClone(input.state), ttrpg: null },
    content: input.content,
  });
  if (!input.state.ttrpg)
    throw new Error("[ttrpg-runtime] 正式 TTRPG 初始状态缺少跑团投影");
  const actualProduct = input.state.ttrpg.product;
  const expectedProduct = expected.ttrpg!.product!;
  if (!actualProduct)
    throw new Error("[ttrpg-runtime] 正式 TTRPG 产品状态缺失");
  const mismatches = [
    actualProduct.rulePackContentHash !== expectedProduct.rulePackContentHash
      ? "rule-pack"
      : "",
    actualProduct.campaignKey !== expectedProduct.campaignKey ? "campaign" : "",
    JSON.stringify(actualProduct.sceneKeys) !==
    JSON.stringify(expectedProduct.sceneKeys)
      ? "scenes"
      : "",
    actualProduct.openedSceneKeys.some(
      (key) => !expectedProduct.sceneKeys.includes(key),
    )
      ? "opened-scenes"
      : "",
    JSON.stringify(actualProduct.clueCatalog) !==
    JSON.stringify(expectedProduct.clueCatalog)
      ? "clues"
      : "",
    stableJson(actualProduct.clockCatalog ?? []) !==
    stableJson(expectedProduct.clockCatalog ?? [])
      ? "clocks"
      : "",
    JSON.stringify(actualProduct.sessionZero.requiredItemKeys) !==
    JSON.stringify(expectedProduct.sessionZero.requiredItemKeys)
      ? "session-zero"
      : "",
    actualProduct.safety.status !== "active" && !input.allowProgress
      ? "safety"
      : "",
    JSON.stringify(
      actualProduct.questProgress.map((item) => ({
        questKey: item.questKey,
        requiredConclusionKeys: item.requiredConclusionKeys,
      })),
    ) !==
    JSON.stringify(
      expectedProduct.questProgress.map((item) => ({
        questKey: item.questKey,
        requiredConclusionKeys: item.requiredConclusionKeys,
      })),
    )
      ? "quests"
      : "",
    stableJson(actualProduct.endingCatalog) !==
    stableJson(expectedProduct.endingCatalog)
      ? "endings"
      : "",
    actualProduct.advancement.currencyKey !==
    expectedProduct.advancement.currencyKey
      ? "advancement-key"
      : "",
    actualProduct.advancement.currencyName !==
    expectedProduct.advancement.currencyName
      ? "advancement-name"
      : "",
    JSON.stringify(actualProduct.tabletop?.maps ?? null) !==
    JSON.stringify(expectedProduct.tabletop?.maps ?? null)
      ? "tabletop-catalog"
      : "",
    actualProduct.tabletop &&
    !input.allowProgress &&
    JSON.stringify(actualProduct.tabletop) !==
      JSON.stringify(expectedProduct.tabletop)
      ? "tabletop-state"
      : "",
    JSON.stringify(
      actualProduct.media?.slots.map((slot) => ({
        slotKey: slot.slotKey,
        kind: slot.kind,
        targetRef: slot.targetRef,
        audience: slot.audience,
        fallbackText: slot.fallbackText,
        altText: slot.altText,
      })) ?? null,
    ) !==
    JSON.stringify(
      expectedProduct.media?.slots.map((slot) => ({
        slotKey: slot.slotKey,
        kind: slot.kind,
        targetRef: slot.targetRef,
        audience: slot.audience,
        fallbackText: slot.fallbackText,
        altText: slot.altText,
      })) ?? null,
    )
      ? "media-catalog"
      : "",
    stableJson(actualProduct.media?.runtimePolicy ?? null) !==
    stableJson(expectedProduct.media?.runtimePolicy ?? null)
      ? "media-policy"
      : "",
    actualProduct.media &&
    !input.allowProgress &&
    stableJson(actualProduct.media) !== stableJson(expectedProduct.media)
      ? "media-state"
      : "",
    !input.allowProgress && actualProduct.characterCustomizations.length > 0
      ? "character-customizations"
      : "",
    actualProduct.inventory &&
    !input.allowProgress &&
    JSON.stringify(actualProduct.inventory) !==
      JSON.stringify(expectedProduct.inventory)
      ? "inventory-state"
      : "",
    !input.allowProgress && (actualProduct.itemHistory?.length ?? 0) > 0
      ? "item-history"
      : "",
    actualProduct.abilityStates &&
    !input.allowProgress &&
    JSON.stringify(actualProduct.abilityStates) !==
      JSON.stringify(expectedProduct.abilityStates)
      ? "ability-state"
      : "",
    actualProduct.usagePools &&
    !input.allowProgress &&
    JSON.stringify(actualProduct.usagePools) !==
      JSON.stringify(expectedProduct.usagePools)
      ? "usage-pool-state"
      : "",
    !input.allowProgress && (actualProduct.humanResponses?.length ?? 0) > 0
      ? "human-responses"
      : "",
    actualProduct.effectLedger &&
    !input.allowProgress &&
    JSON.stringify(actualProduct.effectLedger) !==
      JSON.stringify(expectedProduct.effectLedger)
      ? "effect-ledger-state"
      : "",
    actualProduct.characterProgression &&
    !input.allowProgress &&
    JSON.stringify(actualProduct.characterProgression) !==
      JSON.stringify(expectedProduct.characterProgression)
      ? "character-progression"
      : "",
    JSON.stringify(
      actualProduct.advancement.milestones.map((item) => ({
        milestoneKey: item.milestoneKey,
        title: item.title,
        award: item.award,
      })),
    ) !==
    JSON.stringify(
      expectedProduct.advancement.milestones.map((item) => ({
        milestoneKey: item.milestoneKey,
        title: item.title,
        award: item.award,
      })),
    )
      ? "milestones"
      : "",
  ].filter(Boolean);
  if (mismatches.length) {
    throw new Error(
      `[ttrpg-runtime] 正式 TTRPG 产品状态没有严格绑定冻结 CampaignPack:${mismatches.join(",")}`,
    );
  }
  if (actualProduct.inventory) {
    const knownDefinitions = new Set(rulePack.items.map((item) => item.key));
    const instances = Object.values(actualProduct.inventory.items);
    if (
      instances.some(
        (item) =>
          !knownDefinitions.has(item.definitionRef) ||
          (item.ownerRef != null && !input.state.entities[item.ownerRef]) ||
          (item.containerRef != null &&
            !actualProduct.inventory?.items[item.containerRef]),
      )
    ) {
      throw new Error(
        "[ttrpg-runtime] ItemInstance 引用没有绑定冻结 RulePack 或运行时实体",
      );
    }
  }
  for (const template of input.content.campaign.characterTemplates) {
    const actual = input.state.entities[template.characterKey];
    const customization = actualProduct.characterCustomizations.find(
      (item) => item.characterKey === template.characterKey,
    );
    if (customization && template.role !== "player") {
      throw new Error(
        `[ttrpg-runtime] NPC 不允许使用玩家角色创建器:${template.characterKey}`,
      );
    }
    const baseAttributes = customization?.attributes ?? template.attributes;
    if (customization?.characterSheet) {
      const { characterSheet: _frozenSheet, ...templateWithoutSheet } =
        template;
      parseTtrpgCharacterSheetV2(
        customization.characterSheet,
        {
          ...templateWithoutSheet,
          name: customization.name,
          description: customization.description,
          attributes: customization.attributes,
        },
        rulePack,
      );
    }
    const expectedAttributeKeys = rulePack.attributes.map((item) => item.key);
    const frozenBudget = rulePack.attributes.reduce(
      (sum, item) => sum + template.attributes[item.key],
      0,
    );
    const baseBudget = rulePack.attributes.reduce(
      (sum, item) => sum + baseAttributes[item.key],
      0,
    );
    if (
      Object.keys(baseAttributes).length !== expectedAttributeKeys.length ||
      expectedAttributeKeys.some(
        (key) => !Object.prototype.hasOwnProperty.call(baseAttributes, key),
      ) ||
      baseBudget !== frozenBudget ||
      rulePack.attributes.some(
        (item) =>
          !Number.isInteger(baseAttributes[item.key]) ||
          baseAttributes[item.key] < item.minimum ||
          baseAttributes[item.key] > item.maximum,
      )
    ) {
      throw new Error(
        `[ttrpg-runtime] 自定义角色属性不符合冻结 RulePack:${template.characterKey}`,
      );
    }
    const progression =
      actualProduct.characterProgression?.[template.characterKey] ?? null;
    if ((template.role === "player") !== (progression != null)) {
      throw new Error(
        `[ttrpg-runtime] 角色成长索引与角色类型不一致:${template.characterKey}`,
      );
    }
    if (progression) {
      const frozenProgression = template.characterSheet?.rules.progression;
      const expectedModel =
        frozenProgression?.model ??
        rulePack.advancement.progressionModel ??
        "point-buy";
      if (
        progression.model !== expectedModel ||
        progression.spentCurrency >
          earnedTtrpgCharacterCurrencyV2(
            actualProduct,
            template.characterKey,
          ) ||
        Object.keys(progression.attributeIncreases).some(
          (key) => !expectedAttributeKeys.includes(key),
        ) ||
        Object.keys(progression.skillIncreases).some(
          (key) => !Object.prototype.hasOwnProperty.call(template.skills, key),
        )
      ) {
        throw new Error(
          `[ttrpg-runtime] 角色成长没有绑定冻结车卡:${template.characterKey}`,
        );
      }
      const expectedCost = (kind: "attribute" | "skill" | "level" | "rank") =>
        kind === "attribute"
          ? rulePack.advancement.attributeIncreaseCost
          : kind === "skill"
            ? (rulePack.advancement.skillIncreaseCost ??
              rulePack.advancement.attributeIncreaseCost)
            : kind === "level"
              ? (rulePack.advancement.levelIncreaseCost ??
                rulePack.advancement.attributeIncreaseCost)
              : (rulePack.advancement.rankIncreaseCost ??
                rulePack.advancement.attributeIncreaseCost);
      if (
        progression.history.some(
          (entry) => entry.cost !== expectedCost(entry.kind),
        )
      ) {
        throw new Error(
          `[ttrpg-runtime] 角色成长消费不符合冻结 RulePack:${template.characterKey}`,
        );
      }
      for (const [skillKey, increase] of Object.entries(
        progression.skillIncreases,
      )) {
        if (
          !Number.isInteger(increase) ||
          increase < 0 ||
          template.skills[skillKey] + increase >
            (rulePack.advancement.maximumSkillValue ?? 10)
        ) {
          throw new Error(
            `[ttrpg-runtime] 技能成长越界:${template.characterKey}.${skillKey}`,
          );
        }
      }
    }
    const effectiveAttributes = Object.fromEntries(
      expectedAttributeKeys.map((key) => [
        key,
        baseAttributes[key] + (progression?.attributeIncreases[key] ?? 0),
      ]),
    );
    if (
      rulePack.attributes.some(
        (item) =>
          !Number.isInteger(effectiveAttributes[item.key]) ||
          effectiveAttributes[item.key] < item.minimum ||
          effectiveAttributes[item.key] >
            (progression
              ? Math.min(
                  item.maximum,
                  rulePack.advancement.maximumAttributeValue,
                )
              : item.maximum),
      )
    ) {
      throw new Error(
        `[ttrpg-runtime] 角色成长后属性越界:${template.characterKey}`,
      );
    }
    const target = structuredClone(expected.entities[template.characterKey]);
    if (target) {
      const derived = Object.fromEntries(
        rulePack.derivedStats.map((stat) => {
          let value = evaluateRuleNumberExpressionV1(
            stat.formula,
            effectiveAttributes,
          );
          if (stat.minimum != null) value = Math.max(stat.minimum, value);
          if (stat.maximum != null) value = Math.min(stat.maximum, value);
          return [stat.key, value];
        }),
      );
      const maximums = Object.fromEntries(
        rulePack.resources.map((resource) => [
          resource.key,
          evaluateRuleNumberExpressionV1(
            resource.maximumFormula,
            effectiveAttributes,
          ),
        ]),
      );
      if (customization) target.name = customization.name;
      target.attributes = {
        ...target.attributes,
        ...(customization ? { identity: customization.description } : {}),
        ...effectiveAttributes,
        ...derived,
        ...Object.fromEntries(
          Object.entries(maximums).map(([key, value]) => [
            `resourceMax.${key}`,
            value,
          ]),
        ),
        maxHp: maximums.vigor ?? target.attributes.maxHp,
        armorClass: derived.defense ?? 8,
        initiative:
          effectiveAttributes[rulePack.turnStructure.initiativeAttributeKey] ??
          0,
      };
    }
    const immutableKeys = [
      ...rulePack.attributes.map((item) => item.key),
      ...rulePack.derivedStats.map((item) => item.key),
      ...rulePack.resources.map((item) => `resourceMax.${item.key}`),
      "maxHp",
      "armorClass",
      "initiative",
    ];
    const immutableMismatch = immutableKeys.some(
      (key) => actual?.attributes[key] !== target?.attributes[key],
    );
    const entryMismatch =
      !input.allowProgress &&
      JSON.stringify(actual?.attributes) !== JSON.stringify(target?.attributes);
    const identityMismatch = customization
      ? actual?.name !== target?.name ||
        actual?.attributes.identity !== target?.attributes.identity
      : false;
    if (
      !actual ||
      !target ||
      immutableMismatch ||
      entryMismatch ||
      identityMismatch ||
      actual.kind !== target.kind
    ) {
      throw new Error(
        `[ttrpg-runtime] 角色初始状态未严格绑定 CampaignPack:${template.characterKey}`,
      );
    }
  }
}
