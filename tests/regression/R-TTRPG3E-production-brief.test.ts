import { describe, expect, it } from "vitest";
import type {
  ProductRuntimePackageV1,
  ProductWorldSourceSelectionV1,
  TtrpgProductionSeatV2,
  WorkspaceScope,
} from "../../src/lib/types";
import {
  compileTtrpgProductionBriefV2,
  parseTtrpgProductionBriefV2,
  resolveTtrpgProductionRulePackV2,
  unresolvedTtrpgProductionBriefDecisionsV2,
} from "../../src/lib/ttrpg/production-brief";
import {
  bindProductionMediaToTtrpgCampaignV1,
  compileProductionTtrpgCampaignV2,
} from "../../src/lib/ttrpg/production-compiler";
import { validateTtrpgCampaignForPublicationV1 } from "../../src/lib/ttrpg/campaign";
import {
  createDefaultTtrpgProductionWizardValueV2,
  toTtrpgProductionBriefDraftInputV2,
} from "../../src/components/ttrpg/TtrpgProductionWizard";
import {
  CURRENT_PRODUCT_RESOURCE_KEYS,
  CURRENT_PRODUCT_SOURCE_CATALOG,
  currentProductSelection,
} from "../helpers/current-product-world";

const scope: WorkspaceScope = { projectId: 1, worldId: 1, workId: 1 };
const WORLD_HASH = "a".repeat(64);

function selection(): ProductWorldSourceSelectionV1 {
  return currentProductSelection("ttrpg", {
    participants: [CURRENT_PRODUCT_RESOURCE_KEYS.character],
    locations: [CURRENT_PRODUCT_RESOURCE_KEYS.location],
    items: [CURRENT_PRODUCT_RESOURCE_KEYS.artifact],
    quests: [CURRENT_PRODUCT_RESOURCE_KEYS.arc],
  });
}

const seats: TtrpgProductionSeatV2[] = [
  {
    seatKey: "player.1",
    label: "调查者",
    controller: "human",
    role: "player",
    characterMode: "world-template",
    sourceCharacterResourceKey: CURRENT_PRODUCT_RESOURCE_KEYS.character,
    characterName: "林舟",
    rankTier: null,
    privateGoal: "寻找失踪导师",
  },
  {
    seatKey: "player.2",
    label: "搭档",
    controller: "ai",
    role: "player",
    characterMode: "quick-card",
    sourceCharacterResourceKey: null,
    characterName: "守潮人",
    rankTier: "B",
    privateGoal: "隐藏旧港秘密",
  },
];

describe("R-TTRPG-3E · nine-step production brief", () => {
  it("九步向导把 d20 濒死资源检定和高级白名单村规完整交给 Brief 编译器", async () => {
    const value = createDefaultTtrpgProductionWizardValueV2();
    value.ruleOrigin = "builtin-d20-fantasy";
    value.startingLevelOrTier = "3";
    value.deathRecoveryHeroicDiceCost = 1;
    value.customHouseRulePatches = [
      {
        path: "turnStructure.reactionsPerRound",
        value: "2",
        reason: "让护援与法术反制拥有独立的反应预算。",
      },
    ];
    value.confirmAll = true;
    const draft = toTtrpgProductionBriefDraftInputV2({
      value,
      sourceOptions: null,
      sourceSelection: null,
      openingSituation: "潮门正在坍塌。",
    });
    expect(draft.rules?.houseRulePatches).toEqual([
      {
        path: "actions.death-recovery.costAmount",
        value: 1,
        reason: "作者把濒死恢复改为消耗英雄骰资源后进行体质检定。",
      },
      {
        path: "turnStructure.reactionsPerRound",
        value: 2,
        reason: "让护援与法术反制拥有独立的反应预算。",
      },
    ]);
    const brief = await compileTtrpgProductionBriefV2({
      scope,
      selection: selection(),
      worldContentHash: WORLD_HASH,
      title: "英雄骰濒死团",
      premise: "潮门正在坍塌。",
      tone: ["奇幻"],
      scale: { scope: "short-arc", targetPlayMinutes: 120, targetEndingCount: 2 },
      contentBoundaries: ["安全"],
      confirmDefaultMappings: true,
      draft,
    });
    expect(brief.rules.houseRuleDiff).toEqual([
      expect.objectContaining({ path: "actions.death-recovery.costAmount", before: 0, after: 1 }),
      expect.objectContaining({ path: "turnStructure.reactionsPerRound", before: 1, after: 2 }),
    ]);
    const rulePack = await resolveTtrpgProductionRulePackV2({ scope, brief });
    expect(rulePack.actions.find(action => action.key === "death-recovery")?.costAmount).toBe(1);
  });

  it("冻结完整九步选择、Rank Lite、真人+AI 席位、信息隔离和动态媒资", async () => {
    const brief = await compileTtrpgProductionBriefV2({
      scope,
      selection: selection(),
      worldContentHash: WORLD_HASH,
      title: "雾港潮门",
      premise: "在潮门关闭前找出失踪信号真相。",
      tone: ["悬疑", "克制"],
      scale: {
        scope: "campaign",
        targetPlayMinutes: 900,
        targetEndingCount: 5,
      },
      contentBoundaries: ["不描写露骨伤害"],
      confirmDefaultMappings: true,
      draft: {
        creationMode: "advanced",
        naturalLanguageInstruction: "AI 担任 KP，主持两名玩家的长线调查团。",
        rules: {
          origin: "builtin-rank-lite",
          houseRulePatches: [
            {
              path: "diceModels.rank-d20.sides",
              value: 100,
              reason: "使用 d100 但不得超过 100 面。",
            },
            {
              path: "turnStructure.reactionsPerRound",
              value: 2,
              reason: "强调护援。",
            },
          ],
        },
        gmMode: "ai",
        playerCount: 2,
        seats,
        story: {
          structure: "sandbox",
          targetSceneCount: 16,
          targetQuestCount: 4,
          clueRedundancy: 3,
          targetEndingCount: 5,
          failForward: true,
          freeRoam: true,
          canonMutationPolicy: "author-review",
          openingScene: "潮门即将关闭。",
        },
        information: {
          characterPrivateChannels: true,
          gmSecrets: true,
          hiddenNpcState: true,
          hiddenDice: "gm-only",
          interPlayerWhispers: true,
          revealAuditTrail: true,
        },
        media: {
          visualStyle: "雾港写实奇幻",
          sceneImages: true,
          characterPortraits: true,
          characterExpressions: true,
          itemIcons: true,
          handouts: true,
          maps: true,
          tokens: true,
          generationTiming: "hybrid",
          backgroundGeneration: true,
          textFallback: true,
          maximumGeneratedAssets: 48,
        },
      },
    });
    expect(parseTtrpgProductionBriefV2(brief)).toEqual(brief);
    expect(brief).toMatchObject({
      creationMode: "advanced",
      rules: {
        origin: "builtin-rank-lite",
        houseRuleDiff: [{ after: 100 }, { after: 2 }],
      },
      table: {
        gmMode: "ai",
        seats: [{ controller: "human" }, { controller: "ai", rankTier: "B" }],
      },
      story: { structure: "sandbox", failForward: true, freeRoam: true },
      information: { characterPrivateChannels: true, revealAuditTrail: true },
      media: {
        generationTiming: "hybrid",
        backgroundGeneration: true,
        maximumGeneratedAssets: 48,
      },
    });
    expect(unresolvedTtrpgProductionBriefDecisionsV2(brief)).toEqual([]);
  });

  it("最高允许 d100，d101 在 Brief 编译期被 RulePack 守卫拒绝", async () => {
    await expect(
      compileTtrpgProductionBriefV2({
        scope,
        selection: selection(),
        worldContentHash: WORLD_HASH,
        title: "越界骰",
        premise: "测试",
        tone: ["测试"],
        scale: { scope: "scene", targetPlayMinutes: 30, targetEndingCount: 1 },
        contentBoundaries: ["安全"],
        confirmDefaultMappings: true,
        draft: {
          rules: {
            origin: "builtin-storyforge",
            houseRulePatches: [
              {
                path: "diceModels.core-2d6.sides",
                value: 101,
                reason: "非法越界测试",
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/sides|100|骰/i);
  });

  it("正式 CampaignPack 冻结真人/AI/GM 控制权，而不是从角色文案猜测", async () => {
    const brief = await compileTtrpgProductionBriefV2({
      scope,
      selection: selection(),
      worldContentHash: WORLD_HASH,
      title: "席位权威",
      premise: "两名玩家与一名 NPC 推进调查。",
      tone: ["悬疑"],
      scale: {
        scope: "multi-chapter",
        targetPlayMinutes: 360,
        targetEndingCount: 2,
      },
      contentBoundaries: ["安全"],
      confirmDefaultMappings: true,
      draft: {
        rules: { origin: "builtin-d20-fantasy" },
        gmMode: "ai",
        playerCount: 2,
        seats,
        characters: {
          progressionMode: "rule-native",
          startingLevelOrTier: "3",
        },
        media: {
          visualStyle: "雾港写实奇幻",
          sceneImages: true,
          characterPortraits: true,
          characterExpressions: true,
          itemIcons: true,
          handouts: true,
          maps: true,
          tokens: true,
          generationTiming: "hybrid",
          backgroundGeneration: true,
          textFallback: true,
          maximumGeneratedAssets: 24,
        },
      },
    });
    expect(brief.campaignDesign.proposals).toHaveLength(3);
    const design = brief.campaignDesign;
    design.selection.sectionSources.fronts = "proposal.faction-pressure";
    design.selection.sectionSources.secrets = "proposal.escalating-crisis";
    design.selection.sectionSources.endings = "proposal.faction-pressure";
    design.selection.lockedSections = ["background", "coreConflict", "opening", "fronts", "secrets", "endings"];
    design.selection.authorNotes = "保留证据网背景，混合阵营压力与升级危机。";
    design.selection.confirmed = true;
    expect(parseTtrpgProductionBriefV2(brief).campaignDesign.selection.sectionSources).toMatchObject({
      fronts: "proposal.faction-pressure",
      secrets: "proposal.escalating-crisis",
      endings: "proposal.faction-pressure",
    });
    const rulePack = await resolveTtrpgProductionRulePackV2({ scope, brief });
    const narrative: ProductRuntimePackageV1["narrative"] = {
      moduleKind: "branching",
      moduleTitle: "潮门调查",
      entryNodeKey: "scene.opening",
      nodes: [
        {
          key: "scene.opening",
          kind: "opening",
          title: "潮门",
          summary: "调查从潮门开始。",
          conditionJson: "null",
          effectsJson: "[]",
          successorKeys: ["scene.choice"],
        },
        {
          key: "scene.choice",
          kind: "choice",
          title: "分歧",
          summary: "队伍选择追踪方向。",
          conditionJson: "null",
          effectsJson: "[]",
          successorKeys: ["scene.ending"],
        },
        {
          key: "scene.ending",
          kind: "ending",
          title: "余波",
          summary: "选择留下可继续的后果。",
          conditionJson: "null",
          effectsJson: "[]",
          successorKeys: [],
        },
      ],
      beats: [],
      choices: [],
    };
    const campaign = compileProductionTtrpgCampaignV2({
      productionKey: "authority-test",
      brief,
      selection: selection(),
      narrative,
      sourceCatalog: {
        characters: CURRENT_PRODUCT_SOURCE_CATALOG.characters,
        locations: CURRENT_PRODUCT_SOURCE_CATALOG.locations,
        artifacts: CURRENT_PRODUCT_SOURCE_CATALOG.artifacts,
        storyArcs: CURRENT_PRODUCT_SOURCE_CATALOG.storyArcs,
      },
      rulePack,
      worldContentHash: "a".repeat(64),
      worldSourceBundleHash: "b".repeat(64),
    });
    expect(
      campaign.characterTemplates
        .filter((character) => character.role === "player")
        .map((character) => character.controller),
    ).toEqual(["human", "ai"]);
    expect(
      campaign.characterTemplates
        .filter((character) => character.role === "npc")
        .every((character) => character.controller === "gm"),
    ).toBe(true);
    expect(
      campaign.characterTemplates.every(
        (character) =>
          character.characterSheet?.schema ===
          "storyforge.ttrpg-character-sheet",
      ),
    ).toBe(true);
    expect(
      campaign.characterTemplates.every(
        (character) =>
          character.characterSheet?.gates.characterComplete &&
          character.characterSheet.gates.ruleLegal &&
          character.characterSheet.gates.playableRole &&
          character.characterSheet.gates.secretScope,
      ),
    ).toBe(true);
    expect(
      campaign.characterTemplates.find(
        (character) => character.seatKey === "player.1",
      )?.characterSheet,
    ).toMatchObject({
      authoring: { mode: "world-conversion" },
      rules: { progression: { model: "numeric-level", level: 3 } },
    });
    expect(
      campaign.characterTemplates.find(
        (character) => character.seatKey === "player.2",
      )?.characterSheet,
    ).toMatchObject({
      authoring: { mode: "guided" },
      rules: { progression: { model: "numeric-level", level: 3 } },
    });
    expect(
      campaign.characterTemplates
        .filter((character) => character.role === "player")
        .map((character) => ({
          level: character.attributes.level,
          sheetLevel: character.characterSheet?.rules.attributes.level,
          vigor: character.resources.vigor,
          heroicDice: character.resources["heroic-dice"],
        })),
    ).toEqual([
      { level: 3, sheetLevel: 3, vigor: 23, heroicDice: 1 },
      { level: 3, sheetLevel: 3, vigor: 23, heroicDice: 1 },
    ]);
    expect(campaign.bible).toMatchObject({
      premise: brief.campaign.premise,
      coreConflict: brief.campaign.coreConflict,
      sourceRefs: [`world:${"a".repeat(64)}`],
    });
    expect(campaign.clocks?.length).toBeGreaterThan(0);
    expect(campaign.fronts?.every((front) => front.clockKeys.length > 0)).toBe(true);
    expect(campaign.secrets?.every((secret) => secret.relatedClueKeys.length > 0)).toBe(true);
    expect(campaign.endings.every((ending) => ending.trigger != null)).toBe(true);
    const campaignReport = validateTtrpgCampaignForPublicationV1(campaign, rulePack);
    expect(campaignReport.valid).toBe(true);
    expect(campaignReport.structural.unreachableSceneKeys).toEqual([]);
    expect(campaignReport.structural.deadEndSceneKeys).toEqual([]);
    expect(campaignReport.structural.counterexamples.every((item) => item.passed)).toBe(true);
    const unreachable = structuredClone(campaign);
    unreachable.scenes.push({
      ...structuredClone(unreachable.scenes[0]),
      sceneKey: "scene.unreachable",
      title: "不可达草稿",
      nextSceneKeys: [],
      tabletopMapKey: unreachable.scenes[0].tabletopMapKey,
    });
    expect(validateTtrpgCampaignForPublicationV1(unreachable, rulePack).errors).toContain(
      "存在入口不可达场景:scene.unreachable",
    );
    expect(
      campaign.visualBible?.characters.every(
        (character) => character.expressionBaselines.length >= 4,
      ),
    ).toBe(true);
    expect(
      new Set(campaign.mediaManifest?.slots.map((slot) => slot.kind)),
    ).toEqual(
      new Set([
        "scene",
        "map",
        "character-portrait",
        "character-expression",
        "token",
        "item-icon",
        "handout",
      ]),
    );
    expect(campaign.mediaManifest?.runtimePolicy).toMatchObject({
      enabled: true,
      networkPolicy: "any",
      maximumGeneratedAssets: 24,
      maximumConcurrentRequests: 2,
      maximumAttempts: 3,
      allowProviderFallback: true,
    });
    expect(
      campaign.mediaManifest?.slots.every(
        (slot) => slot.fallbackText && slot.altText && slot.promptTemplate,
      ),
    ).toBe(true);

    const firstCharacter = campaign.characterTemplates[0];
    const bound = bindProductionMediaToTtrpgCampaignV1(campaign, [
      {
        assetKey: "runtime.scene.prebuilt",
        version: 1,
        kind: "background",
        name: "开场图",
        mimeType: "image/png",
        byteSize: 24,
        width: 1536,
        height: 1024,
        durationMs: null,
        contentHash: "c".repeat(64),
        blobContentHash: "c".repeat(64),
        source: "test",
        license: "author-owned",
        altText: "开场图",
        characterTag: "",
        sceneTag: campaign.openingSceneKey,
      },
      {
        assetKey: "runtime.character.prebuilt",
        version: 1,
        kind: "character-pose",
        name: "角色立绘",
        mimeType: "image/png",
        byteSize: 24,
        width: 1024,
        height: 1536,
        durationMs: null,
        contentHash: "d".repeat(64),
        blobContentHash: "d".repeat(64),
        source: "test",
        license: "author-owned",
        altText: "角色立绘",
        characterTag: firstCharacter.characterKey,
        sceneTag: "",
      },
    ]);
    expect(
      bound.mediaManifest?.slots.find(
        (slot) =>
          slot.kind === "scene" && slot.targetRef === campaign.openingSceneKey,
      )?.assetKey,
    ).toBe("runtime.scene.prebuilt");
    expect(
      bound.characterTemplates.find(
        (character) => character.characterKey === firstCharacter.characterKey,
      )?.portraitAssetKey,
    ).toBe("runtime.character.prebuilt");
    expect(
      bound.visualBible?.characters.find(
        (character) => character.characterKey === firstCharacter.characterKey,
      )?.referenceAssetKeys,
    ).toContain("runtime.character.prebuilt");
  });

  it("未确认世界边界、数值、许可、AI 身份和媒资权利时保持可解释阻塞", async () => {
    const brief = await compileTtrpgProductionBriefV2({
      scope,
      selection: selection(),
      worldContentHash: WORLD_HASH,
      title: "未确认",
      premise: "测试确认",
      tone: ["测试"],
      scale: { scope: "scene", targetPlayMinutes: 30, targetEndingCount: 1 },
      contentBoundaries: ["安全"],
      confirmDefaultMappings: false,
      draft: { media: { sceneImages: true, maximumGeneratedAssets: 1 } },
    });
    expect(unresolvedTtrpgProductionBriefDecisionsV2(brief)).toEqual([
      "ttrpg-campaign-proposal-selection",
      "ttrpg-world-canon-boundary",
      "ttrpg-default-rule-mappings",
      "ttrpg-rule-license",
      "ttrpg-ai-participation-disclosure",
      "ttrpg-media-rights",
    ]);
    const tampered = structuredClone(brief) as unknown as Record<
      string,
      unknown
    >;
    delete (tampered.table as Record<string, unknown>).seats;
    expect(() => parseTtrpgProductionBriefV2(tampered)).toThrow(/字段不精确/);
  });
});
