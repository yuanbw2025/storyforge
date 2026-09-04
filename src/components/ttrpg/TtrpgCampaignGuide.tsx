import { useEffect, useMemo, useState } from "react";
import {
  BookOpenText,
  CheckCircle2,
  Dices,
  Eye,
  EyeOff,
  GitBranch,
  Loader2,
  MapPinned,
  Monitor,
  PauseCircle,
  Pencil,
  PlayCircle,
  RotateCcw,
  Save,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  X,
} from "lucide-react";
import { db } from "../../lib/db/schema";
import { verifyProductRuntimeSource } from "../../lib/product-production/preview-source";
import { verifyProductReleaseManifestV1 } from "../../lib/product-production/runtime-package";
import {
  activateTtrpgCampaignSupplementV2,
  completeTtrpgSessionZero,
  completeTtrpgCampaignSessionV2,
  changeTtrpgCampaignRosterV2,
  changeTtrpgSafetyStatus,
  commitTtrpgDeterministicFallbackV1,
  commitTtrpgEffectPlanV2,
  commitTtrpgHumanGmNarrationV1,
  commitTtrpgIntentDispositionV2,
  commitTtrpgItemCommandV2,
  completeTtrpgRestV2,
  completeTtrpgCampaignEnding,
  advanceTtrpgCharacterV1,
  customizeTtrpgPlayerCharacterV1,
  discoverTtrpgClue,
  openTtrpgCampaignScene,
  readProductRuntimeStateVersion,
  recordTtrpgHumanResponseV2,
  recordTtrpgVersionTransitionV2,
  recordTtrpgWorldEvolutionV2,
  startTtrpgCampaignSessionV2,
  submitTtrpgActionIntentV2,
  updateTtrpgTabletopV1,
  type TtrpgTabletopOperationV1,
} from "../../lib/ttrpg/runtime-api";
import { parseTtrpgCampaignContentV1 } from "../../lib/ttrpg/campaign";
import {
  createTtrpgContinuationFromPlanV2,
  previewTtrpgContinuationV2,
} from "../../lib/ttrpg/continuity";
import type { TtrpgContinuationPlanV2 } from "../../lib/ttrpg/continuity-state";
import {
  adoptTtrpgGmNarrationCandidateV1,
  generateTtrpgGmNarrationCandidateV1,
  rejectTtrpgGmNarrationCandidateV1,
  type TtrpgGmNarrationCandidateV1,
} from "../../lib/ttrpg/gm-harness";
import type { TtrpgGmActorActionCandidateV1 } from "../../lib/ttrpg/gm-actor-harness";
import {
  adoptTtrpgPlayerActionCandidateV1,
  rejectTtrpgPlayerActionCandidateV1,
  type TtrpgPlayerActionCandidateV1,
} from "../../lib/ttrpg/player-harness";
import type { TtrpgItemCommandV2 } from "../../lib/ttrpg/item-ledger";
import { runTtrpgAiPlayerCycleV1 } from "../../lib/ttrpg/player-coordinator";
import {
  parseRulePackV1,
  ruleCheckDefaultDifficultyV2,
  ruleCheckDifficultyOptionsV2,
} from "../../lib/ttrpg/rule-pack";
import {
  configureTtrpgSessionParticipantV2,
  readTtrpgSessionParticipantsV2,
} from "../../lib/ttrpg/participants";
import {
  createTtrpgAutomaticSessionRecapsV2,
  createTtrpgViewerProjectionV1,
  type TtrpgViewerProjectionV1,
} from "../../lib/ttrpg/viewer-projection";
import { resolveRequestConfig } from "../../lib/ai/client";
import { isAIConfigReady } from "../../lib/ai/config-readiness";
import { useAIConfigStore } from "../../stores/ai-config";
import { useProjectStore } from "../../stores/project";
import TtrpgOnlineRoomPanel from "./TtrpgOnlineRoomPanel";
import type { OnlineRoomJoinHandoffV1 } from "../../lib/online/http-transport";
import {
  currentAiGmBetaGatePassedV1,
  currentProductPlatformEnvironmentV1,
  evaluateProductPlatformCapabilityV1,
} from "../../lib/product-platform/capability-status";
import type {
  ProductRelease,
  ProductRuntimePackageV1,
  ProductRuntimeSourceV1,
  RulePackV1,
  ProductRuntimeCheckpoint,
  ProductRuntimeState,
  ProductRuntimeSession,
  TtrpgCampaignContentV1,
  TtrpgCharacterSheetV2,
  TtrpgEffectAudienceV2,
  TtrpgEffectPlanV2,
  TtrpgEffectPrimitiveV2,
  TtrpgSessionParticipantRecordV2,
  WorkspaceScope,
} from "../../lib/types";
import TtrpgTabletopSurface from "./TtrpgTabletopSurface";
import TtrpgRuntimeMediaPanel from "./TtrpgRuntimeMediaPanel";

type PlayerMode = "player" | "gm";

const DIFFICULTY_LABELS: Record<TtrpgCampaignContentV1["difficulty"], string> =
  {
    introductory: "入门",
    standard: "标准",
    challenging: "挑战",
  };
const OUTCOME_LABELS: Record<string, string> = {
  automatic: "自动生效",
  "critical-failure": "严重失败",
  failure: "失败",
  "partial-success": "部分成功",
  success: "成功",
  "hard-success": "困难成功",
  "extreme-success": "极难成功",
  "critical-success": "卓越成功",
};
const PHASE_LABELS: Record<string, string> = {
  free: "自由行动",
  action: "主要行动",
  reaction: "反应",
  downtime: "幕间行动",
};
const INTENT_TERMINAL_LABELS: Record<string, string> = {
  "needs-clarification": "需要澄清",
  "rejected-illegal": "当前不合法",
  interrupted: "已被规则打断",
  "queued/deferred": "已延迟，等待新窗口",
  cancelled: "已由权限方撤回",
};
const CHARACTER_IDENTITY_TEXT_FIELDS = [
  ["pronouns", "称谓 / 代词"],
  ["gender", "性别"],
  ["age", "年龄"],
  ["ancestry", "种族 / 出身群体"],
  ["occupation", "职业 / 身份"],
  ["origin", "故乡 / 来源"],
  ["appearance", "外观"],
  ["shortTermGoal", "短期目标"],
  ["longTermGoal", "长期目标"],
  ["portrayal", "扮演提示"],
  ["voice", "语气与声音"],
] as const satisfies ReadonlyArray<
  readonly [keyof TtrpgCharacterSheetV2["identity"], string]
>;
const CHARACTER_IDENTITY_LIST_FIELDS = [
  ["personalityTraits", "性格特征"],
  ["beliefs", "信念"],
  ["flaws", "缺点"],
  ["fears", "恐惧"],
  ["desires", "欲望"],
  ["boundaries", "角色边界"],
  ["publicKnowledge", "他人公开知道"],
  ["privateKnowledge", "角色私密知识"],
  ["safetyNotes", "安全备注"],
  ["sampleLines", "示例台词"],
] as const satisfies ReadonlyArray<
  readonly [keyof TtrpgCharacterSheetV2["identity"], string]
>;

interface FrozenCampaignView {
  runtimePackage: ProductRuntimePackageV1;
  source: ProductRuntimeSourceV1;
  /** Online rooms may only bind an immutable published ProductRelease. */
  onlineReleaseHash: string | null;
  rulePack: RulePackV1;
  campaign: TtrpgCampaignContentV1;
}

function commandId(
  kind: string,
  sessionId: number,
  sequence: number,
  key = "",
): string {
  return `ttrpg-ui:${kind}:${sessionId}:${sequence}${key ? `:${key}` : ""}`;
}

function numberAttribute(
  state: ProductRuntimeState,
  entityKey: string,
  key: string,
): number | null {
  const value = state.entities[entityKey]?.attributes[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function TabletopBoard(props: {
  tabletop: NonNullable<TtrpgViewerProjectionV1["tabletop"]>;
  state: ProductRuntimeState;
  mode: PlayerMode;
  actorKey: string;
  selectedTokenKey: string;
  disabled: boolean;
  onSelect: (tokenKey: string) => void;
  onOperation: (operation: TtrpgTabletopOperationV1) => Promise<void>;
}) {
  return (
    <TtrpgTabletopSurface
      tabletop={props.tabletop}
      viewerRole={props.mode}
      viewerActorKey={props.actorKey}
      selectedTokenKey={props.selectedTokenKey}
      disabled={props.disabled}
      resolveEntityName={(entityKey) =>
        props.state.entities[entityKey]?.name ?? entityKey
      }
      onSelectToken={props.onSelect}
      onMoveToken={({ tokenKey, x, y }) =>
        props.onOperation({ kind: "move-token", tokenKey, x, y })
      }
      onSetFog={({ fogKey, revealed }) =>
        props.onOperation({ kind: "set-fog", fogKey, revealed })
      }
      onSetLayer={({ layerKey, visible }) =>
        props.onOperation({ kind: "set-layer", layerKey, visible })
      }
    />
  );
}

export default function TtrpgCampaignGuide(props: {
  session: ProductRuntimeSession;
  state: ProductRuntimeState;
  workspaceScope?: WorkspaceScope;
  checkpoints: ProductRuntimeCheckpoint[];
  onCheckpoint: (name: string) => Promise<void>;
  onBranch: (title: string) => Promise<number>;
  onRestoreCheckpoint: (checkpointId: number) => Promise<number>;
  onChanged: () => Promise<void>;
  initialOnlineHandoff?: OnlineRoomJoinHandoffV1 | null;
  onOnlineHandoffConsumed?: () => void;
}) {
  const [frozen, setFrozen] = useState<FrozenCampaignView | null>(null);
  const [mode, setMode] = useState<PlayerMode>("gm");
  const [theaterMode, setTheaterMode] = useState(false);
  const [acceptedItems, setAcceptedItems] = useState<Set<string>>(new Set());
  const [selectedCharacterKeys, setSelectedCharacterKeys] = useState<
    Set<string>
  >(new Set());
  const [actorKey, setActorKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [rollVisibility, setRollVisibility] = useState<"public" | "gm-only">(
    "public",
  );
  const [declaredActionIntent, setDeclaredActionIntent] = useState("");
  const [humanResponseText, setHumanResponseText] = useState("");
  const [humanResponseKind, setHumanResponseKind] = useState<
    "speak" | "act-narratively"
  >("speak");
  const [humanResponseAudience, setHumanResponseAudience] = useState<
    "party" | "gm-only"
  >("party");
  const [effectReason, setEffectReason] = useState(
    "依据本次规则行动结算线索、物品与世界状态变化。",
  );
  const [effectAudience, setEffectAudience] =
    useState<TtrpgEffectAudienceV2>("party");
  const [effectClueKey, setEffectClueKey] = useState("");
  const [effectItemKey, setEffectItemKey] = useState("");
  const [effectClockKey, setEffectClockKey] = useState("");
  const [effectClockAmount, setEffectClockAmount] = useState(1);
  const [effectSocialTargetKey, setEffectSocialTargetKey] = useState("");
  const [effectSocialKey, setEffectSocialKey] = useState("attitude");
  const [effectSocialAmount, setEffectSocialAmount] = useState(0);
  const [inventoryGrantItemKey, setInventoryGrantItemKey] = useState("");
  const [inventoryGrantOwnerKey, setInventoryGrantOwnerKey] = useState("");
  const [gmObjective, setGmObjective] = useState(
    "依据刚刚完成的规则行动，给玩家清晰、有氛围且不泄密的结果叙事。",
  );
  const [humanGmNarration, setHumanGmNarration] = useState("");
  const [gmCandidate, setGmCandidate] =
    useState<TtrpgGmNarrationCandidateV1 | null>(null);
  const [gmActorCandidate, setGmActorCandidate] =
    useState<TtrpgGmActorActionCandidateV1 | null>(null);
  const [gmActorPendingSequence, setGmActorPendingSequence] = useState<
    number | null
  >(null);
  const [gmActorSummary, setGmActorSummary] = useState("");
  const [playerCandidate, setPlayerCandidate] =
    useState<TtrpgPlayerActionCandidateV1 | null>(null);
  const [aiPlayerCyclePendingSequence, setAiPlayerCyclePendingSequence] =
    useState<number | null>(null);
  const [aiPlayerCycleSummary, setAiPlayerCycleSummary] = useState("");
  const [safetyReason, setSafetyReason] =
    useState("需要暂停并重新确认当前内容边界。");
  const [checkpointName, setCheckpointName] = useState("场景检查点");
  const [branchTitle, setBranchTitle] = useState("新的战役分支");
  const [campaignSessionTitle, setCampaignSessionTitle] = useState("");
  const [campaignSessionSummary, setCampaignSessionSummary] = useState("");
  const [campaignMemorySummary, setCampaignMemorySummary] = useState("");
  const [campaignMemoryAudience, setCampaignMemoryAudience] = useState<
    "party" | "gm-only" | `actor:${string}`
  >("party");
  const [campaignRosterReason, setCampaignRosterReason] =
    useState("依据本场结局调整长期战役编组。");
  const [campaignSupplementTitle, setCampaignSupplementTitle] =
    useState("会间补充包");
  const [campaignSupplementHash, setCampaignSupplementHash] = useState("");
  const [campaignSupplementSource, setCampaignSupplementSource] = useState(
    "author.local.supplement",
  );
  const [campaignWorldSummary, setCampaignWorldSummary] = useState("");
  const [campaignWorldCategory, setCampaignWorldCategory] = useState<
    "character" | "location" | "faction" | "artifact" | "event" | "lore"
  >("event");
  const [campaignTransitionHash, setCampaignTransitionHash] = useState("");
  const [campaignTransitionCampaignKey, setCampaignTransitionCampaignKey] =
    useState("");
  const [campaignTransitionNotes, setCampaignTransitionNotes] = useState("");
  const [continuationReleases, setContinuationReleases] = useState<
    ProductRelease[]
  >([]);
  const [continuationTargetReleaseId, setContinuationTargetReleaseId] =
    useState("");
  const [continuationPlan, setContinuationPlan] =
    useState<TtrpgContinuationPlanV2 | null>(null);
  const [createdContinuationSessionId, setCreatedContinuationSessionId] =
    useState<number | null>(null);
  const [builderCharacterKey, setBuilderCharacterKey] = useState("");
  const [builderName, setBuilderName] = useState("");
  const [builderDescription, setBuilderDescription] = useState("");
  const [builderAttributes, setBuilderAttributes] = useState<
    Record<string, number>
  >({});
  const [builderIdentity, setBuilderIdentity] = useState<
    Partial<TtrpgCharacterSheetV2["identity"]>
  >({});
  const [selectedTokenKey, setSelectedTokenKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [aiExperimentEnabled, setAiExperimentEnabled] = useState(false);
  const [participants, setParticipants] = useState<
    TtrpgSessionParticipantRecordV2[]
  >([]);
  const aiConfig = useAIConfigStore((state) => state.config);
  const updateWorkspace = useProjectStore((state) => state.updateWorkspace);

  const product = props.state.ttrpg?.product ?? null;
  const productCampaignKey = product?.campaignKey ?? null;
  const productRulePackContentHash = product?.rulePackContentHash ?? null;
  const sessionZero = product?.sessionZero ?? null;

  useEffect(() => {
    let cancelled = false;
    const projectId =
      props.workspaceScope?.projectId ?? props.session.projectId;
    void db.projects.get(projectId).then((project) => {
      if (!cancelled)
        setAiExperimentEnabled(
          project?.productPlatformOptIns?.ttrpgAiGmExperimental === true,
        );
    });
    return () => {
      cancelled = true;
    };
  }, [props.session.projectId, props.workspaceScope?.projectId]);

  useEffect(() => {
    let cancelled = false;
    setFrozen(null);
    setError("");
    if (!productCampaignKey || !productRulePackContentHash)
      return () => {
        cancelled = true;
      };
    void (async () => {
      let runtimePackage: ProductRuntimePackageV1;
      let playableSource: ProductRuntimeSourceV1;
      let onlineReleaseHash: string | null = null;
      if (props.session.productReleaseId != null) {
        playableSource = { kind: "release", productReleaseId: props.session.productReleaseId };
        const release = await db.productReleases.get(props.session.productReleaseId);
        if (!release) throw new Error("正式战役发布不存在。");
        const manifest = await verifyProductReleaseManifestV1(
          release.manifestJson,
        );
        runtimePackage = manifest.runtimePackage;
        onlineReleaseHash = release.contentHash;
      } else if (props.session.productBuildId != null) {
        const scope =
          props.workspaceScope?.projectId != null &&
          props.workspaceScope.worldId != null &&
          props.workspaceScope.workId != null
            ? {
                projectId: props.workspaceScope.projectId,
                worldId: props.workspaceScope.worldId,
                workId: props.workspaceScope.workId,
              }
            : props.session.worldId != null && props.session.workId != null
              ? {
                  projectId: props.session.projectId,
                  worldId: props.session.worldId,
                  workId: props.session.workId,
                }
              : null;
        if (!scope)
          throw new Error("TTRPG Build Preview 缺少正式工作区 owner。");
        const build = await db.productBuilds.get(props.session.productBuildId);
        if (!build?.previewHash)
          throw new Error("TTRPG Build Preview 不存在或尚未冻结。");
        playableSource = {
          kind: "build",
          productBuildId: props.session.productBuildId,
          expectedPreviewHash: build.previewHash,
        };
        const resolved = await verifyProductRuntimeSource({
          scope,
          source: playableSource,
        });
        runtimePackage = resolved.runtimePackage;
      } else {
        throw new Error("TTRPG 会话没有绑定 ProductRelease 或 Build Preview。");
      }
      if (runtimePackage.productType !== "ttrpg" || !runtimePackage.ttrpg) {
        throw new Error("会话绑定的不是正式 TTRPG 产品包。");
      }
      if (
        runtimePackage.ttrpg.campaign.campaignKey !== productCampaignKey ||
        runtimePackage.ttrpg.rulePack.contentHash !== productRulePackContentHash
      ) {
        throw new Error("运行状态与冻结 TTRPG 产品包 hash 不一致。");
      }
      const rulePack = parseRulePackV1(runtimePackage.ttrpg.rulePack.content);
      const campaign = parseTtrpgCampaignContentV1(
        runtimePackage.ttrpg.campaign,
        rulePack,
      );
      if (!cancelled)
        setFrozen({
          runtimePackage,
          source: playableSource,
          onlineReleaseHash,
          rulePack,
          campaign,
        });
    })().catch((cause) => {
      if (!cancelled)
        setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
    };
  }, [
    productCampaignKey,
    productRulePackContentHash,
    props.session.productBuildId,
    props.session.productReleaseId,
    props.session.projectId,
    props.session.workId,
    props.session.worldId,
    props.workspaceScope?.projectId,
    props.workspaceScope?.workId,
    props.workspaceScope?.worldId,
  ]);

  useEffect(() => {
    let cancelled = false;
    setContinuationPlan(null);
    setCreatedContinuationSessionId(null);
    if (
      props.session.worldId == null ||
      props.session.workId == null ||
      props.session.productReleaseId == null
    ) {
      setContinuationReleases([]);
      return () => {
        cancelled = true;
      };
    }
    void db.productReleases
      .where("projectId")
      .equals(props.session.projectId)
      .toArray()
      .then(async (rows) => {
        const compatible = (
          await Promise.all(
            rows
              .filter(
                (row) =>
                  row.worldId === props.session.worldId &&
                  row.workId === props.session.workId,
              )
              .map(async (row) => {
                try {
                  const manifest = await verifyProductReleaseManifestV1(
                    row.manifestJson,
                  );
                  return manifest.productType === "ttrpg" ? row : null;
                } catch {
                  return null;
                }
              }),
          )
        ).filter((row): row is ProductRelease => row != null);
        compatible.sort((left, right) => right.version - left.version);
        if (!cancelled) {
          setContinuationReleases(compatible);
          setContinuationTargetReleaseId((current) =>
            compatible.some((row) => String(row.id) === current)
              ? current
              : String(props.session.productReleaseId),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    props.session.productReleaseId,
    props.session.projectId,
    props.session.workId,
    props.session.worldId,
  ]);

  useEffect(() => {
    let cancelled = false;
    void readTtrpgSessionParticipantsV2(props.session.id!)
      .then((rows) => {
        if (!cancelled) {
          setParticipants(rows);
        }
      })
      .catch((cause) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setParticipants([]);
        setError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [props.session.id, product?.sessionZero.completed]);

  useEffect(() => {
    if (!product) return;
    setAcceptedItems(new Set(product.sessionZero.acceptedItemKeys));
  }, [product]);

  const playerTemplates = useMemo(
    () =>
      frozen?.campaign.characterTemplates.filter(
        (item) => item.role === "player",
      ) ?? [],
    [frozen],
  );
  const npcTemplates = useMemo(
    () =>
      frozen?.campaign.characterTemplates.filter(
        (item) => item.role === "npc",
      ) ?? [],
    [frozen],
  );
  useEffect(() => {
    if (!product || !frozen) return;
    if (product.sessionZero.selectedCharacterKeys.length) {
      setSelectedCharacterKeys(
        new Set(product.sessionZero.selectedCharacterKeys),
      );
      return;
    }
    const available = frozen.campaign.characterTemplates.filter(
      (item) => item.role === "player",
    );
    setSelectedCharacterKeys(
      new Set(
        available
          .slice(0, frozen.campaign.playerCount.minimum)
          .map((item) => item.characterKey),
      ),
    );
  }, [frozen, product, props.session.id]);
  useEffect(() => {
    if (
      !frozen ||
      !product ||
      !sessionZero ||
      sessionZero.completed ||
      !playerTemplates.length
    )
      return;
    const characterKey = playerTemplates.some(
      (item) => item.characterKey === builderCharacterKey,
    )
      ? builderCharacterKey
      : playerTemplates[0].characterKey;
    if (characterKey !== builderCharacterKey)
      setBuilderCharacterKey(characterKey);
    const template = playerTemplates.find(
      (item) => item.characterKey === characterKey,
    )!;
    const entity = props.state.entities[characterKey];
    setBuilderName(entity?.name ?? template.name);
    setBuilderDescription(
      typeof entity?.attributes.identity === "string"
        ? entity.attributes.identity
        : template.description,
    );
    const customization = product.characterCustomizations.find(
      (item) => item.characterKey === characterKey,
    );
    setBuilderIdentity(
      structuredClone(
        customization?.characterSheet?.identity ??
          template.characterSheet?.identity ?? {
            name: entity?.name ?? template.name,
            pronouns: "由玩家在 Session Zero 确认",
            gender: "由玩家在 Session Zero 确认",
            age: "由玩家在 Session Zero 确认",
            ancestry: "由玩家在 Session Zero 确认",
            occupation: "调查与行动成员",
            appearance: "由玩家在 Session Zero 确认",
            origin: "本战役原创",
            background:
              typeof entity?.attributes.identity === "string"
                ? entity.attributes.identity
                : template.description,
            personalityTraits: [],
            beliefs: [],
            flaws: [],
            fears: [],
            desires: [],
            boundaries: [],
            shortTermGoal:
              template.playerProfile?.privateGoal ?? "推进当前战役目标",
            longTermGoal: "完成角色成长弧线",
            publicKnowledge: [],
            privateKnowledge: template.playerProfile?.secret
              ? [template.playerProfile.secret]
              : [],
            safetyNotes: [],
            portrayal:
              template.playerProfile?.portrayal ?? "依据角色已知信息行动",
            voice: "由玩家确认",
            sampleLines: [],
            relationships: [],
            worldBindings: [],
          },
      ),
    );
    setBuilderAttributes(
      Object.fromEntries(
        frozen.rulePack.attributes.map((attribute) => [
          attribute.key,
          typeof entity?.attributes[attribute.key] === "number"
            ? Number(entity.attributes[attribute.key])
            : template.attributes[attribute.key],
        ]),
      ),
    );
  }, [
    builderCharacterKey,
    frozen,
    playerTemplates,
    product,
    sessionZero,
    props.state.entities,
  ]);
  const currentScene =
    frozen?.campaign.scenes.find(
      (item) => item.sceneKey === props.state.ttrpg?.scene?.sceneKey,
    ) ?? null;
  const activeActorKey =
    props.state.ttrpg?.activeActorKey ?? playerTemplates[0]?.characterKey ?? "";
  const activePlayerSeat =
    participants.find(
      (row) => row.role === "player" && row.actorKey === activeActorKey,
    ) ?? null;
  const gmSeat = participants.find((row) => row.role === "gm") ?? null;
  const frozenRoster = product?.sessionZero.selectedCharacterKeys ?? [];
  const clueRecipientKey =
    actorKey &&
    (frozenRoster.includes(actorKey) || selectedCharacterKeys.has(actorKey))
      ? actorKey
      : (frozenRoster[0] ?? [...selectedCharacterKeys][0] ?? "");
  const selectedActorKey =
    mode === "player" && clueRecipientKey ? clueRecipientKey : activeActorKey;
  const selectedActor =
    frozen?.campaign.characterTemplates.find(
      (item) => item.characterKey === selectedActorKey,
    ) ?? null;
  const selectedPlayerSeat =
    participants.find(
      (row) => row.role === "player" && row.actorKey === selectedActorKey,
    ) ?? null;
  const runtimeMediaViewerKey =
    mode === "gm"
      ? (participants.find((row) => row.role === "gm")?.viewerKey ?? "")
      : (selectedPlayerSeat?.viewerKey ?? "");
  const runtimeMediaScope =
    props.workspaceScope ??
    (props.session.worldId != null && props.session.workId != null
      ? {
          projectId: props.session.projectId,
          worldId: props.session.worldId,
          workId: props.session.workId,
        }
      : null);
  const otherTargets =
    props.state.ttrpg?.turnOrder.filter((key) => key !== selectedActorKey) ??
    [];
  const selectedTargetKey =
    targetKey && otherTargets.includes(targetKey)
      ? targetKey
      : (otherTargets[0] ?? "");
  const allDiscovered = product?.discoveredClues ?? [];
  const viewerProjection = useMemo(() => {
    if (!frozen || !product || !product.sessionZero.completed) return null;
    try {
      return createTtrpgViewerProjectionV1({
        state: props.state,
        campaign: frozen.campaign,
        rulePack: frozen.rulePack,
        role: mode,
        actorKey: mode === "player" ? clueRecipientKey : null,
        participantControllers: Object.fromEntries(
          participants.flatMap((row) =>
            row.actorKey == null ? [] : [[row.actorKey, row.controller]],
          ),
        ),
      });
    } catch {
      return null;
    }
  }, [clueRecipientKey, frozen, mode, participants, product, props.state]);
  const visibleClueKeys = new Set(
    viewerProjection?.visibleClues.map((item) => item.clueKey) ?? [],
  );
  const pendingHumanResponse =
    mode === "player"
      ? (viewerProjection?.pendingHumanResponses
          .filter((item) => item.actorKey === clueRecipientKey)
          .slice(-1)[0] ?? null)
      : null;
  const selectedActorView =
    viewerProjection?.actors.find(
      (item) => item.actorKey === selectedActorKey,
    ) ?? null;
  const selectedCharacterSheet = selectedActorView?.characterSheet ?? null;
  const visibleDiscovered =
    mode === "gm"
      ? allDiscovered
      : allDiscovered.filter((item) => visibleClueKeys.has(item.clueKey));
  const discovered = new Map(
    visibleDiscovered.map((item) => [item.clueKey, item]),
  );
  const checks = props.state.ttrpg?.checks ?? [];
  const latestCheck = checks[checks.length - 1] ?? null;
  const actionHistory = product?.actionHistory ?? [];
  const latestAction = actionHistory[actionHistory.length - 1] ?? null;
  const latestActionEffectCommitted = latestAction
    ? (product?.effectLedger?.entries.some(
        (entry) =>
          entry.sourceEventId === `event.${latestAction.eventSequence}`,
      ) ?? false)
    : false;
  const latestNarration = latestAction
    ? (product?.gmNarrations.find(
        (item) => item.actionSequence === latestAction.eventSequence,
      ) ?? null)
    : null;
  const latestProjectedAction =
    viewerProjection?.recentActions[
      viewerProjection.recentActions.length - 1
    ] ?? null;
  const latestVisibleCheck = latestCheck
    && latestProjectedAction
    && latestCheck.eventSequence === latestProjectedAction.eventSequence
    && (mode === "gm" || latestCheck.visibility !== "gm-only")
    ? latestCheck
    : null;
  const latestProjectedIntentReceipt =
    viewerProjection?.recentIntentReceipts[
      viewerProjection.recentIntentReceipts.length - 1
    ] ?? null;
  const latestProjectedRest =
    viewerProjection?.recentRests[viewerProjection.recentRests.length - 1] ??
    null;
  const allQuestsCompleted =
    product?.questProgress.every((item) => item.status === "completed") ??
    false;
  const enabledEndingKeys = new Set(
    viewerProjection?.gmControls?.endings
      .filter((ending) => ending.enabled)
      .map((ending) => ending.endingKey) ?? [],
  );
  const chosenEnding = product?.ending
    ? (product.endingCatalog.find(
        (item) => item.endingKey === product.ending?.endingKey,
      ) ?? null)
    : null;

  useEffect(() => {
    if (
      gmCandidate &&
      gmCandidate.actionSequence !== latestAction?.eventSequence
    )
      setGmCandidate(null);
  }, [gmCandidate, latestAction?.eventSequence]);
  useEffect(() => {
    if (
      playerCandidate &&
      (playerCandidate.baseSequence !== props.state.lastSequence ||
        playerCandidate.actorKey !== activeActorKey)
    )
      setPlayerCandidate(null);
  }, [activeActorKey, playerCandidate, props.state.lastSequence]);
  useEffect(() => {
    if (
      aiPlayerCyclePendingSequence != null &&
      props.state.lastSequence >= aiPlayerCyclePendingSequence
    ) {
      setAiPlayerCyclePendingSequence(null);
    }
  }, [aiPlayerCyclePendingSequence, props.state.lastSequence]);
  useEffect(() => {
    if (
      gmActorPendingSequence != null &&
      props.state.lastSequence >= gmActorPendingSequence
    ) {
      setGmActorPendingSequence(null);
    }
  }, [gmActorPendingSequence, props.state.lastSequence]);
  useEffect(() => {
    if (
      gmActorCandidate &&
      (gmActorCandidate.baseSequence !== props.state.lastSequence ||
        gmActorCandidate.actorKey !== activeActorKey)
    ) {
      setGmActorCandidate(null);
    }
  }, [activeActorKey, gmActorCandidate, props.state.lastSequence]);

  const run = async (
    action: () => Promise<unknown>,
    options: { refresh?: boolean } = {},
  ) => {
    setBusy(true);
    setError("");
    try {
      await action();
      if (options.refresh !== false) await props.onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const aiGmDecision = evaluateProductPlatformCapabilityV1("ttrpg-ai-gm", {
    environment: currentProductPlatformEnvironmentV1(),
    experimentalProject: aiExperimentEnabled,
    authorOptIn: false,
    onlineServiceConfigured: false,
    aiGmBetaGatePassed: currentAiGmBetaGatePassedV1(),
  });
  const setAiGmExperiment = (enabled: boolean) =>
    run(
      async () => {
        const projectId =
          props.workspaceScope?.projectId ?? props.session.projectId;
        const project = await db.projects.get(projectId);
        if (!project)
          throw new Error("当前项目不存在，无法保存 AI GM 实验授权。");
        await updateWorkspace(projectId, {
          productPlatformOptIns: {
            ...project.productPlatformOptIns,
            ttrpgAiGmExperimental: enabled,
          },
        });
        setAiExperimentEnabled(enabled);
        if (!enabled) setGmCandidate(null);
      },
      { refresh: false },
    );
  const commitTabletop = async (operation: TtrpgTabletopOperationV1) => {
    await run(async () => {
      const version = await readProductRuntimeStateVersion(props.session.id!);
      const tabletopActorKey = mode === "gm" ? "gm" : clueRecipientKey;
      await updateTtrpgTabletopV1({
        sessionId: props.session.id!,
        commandId: commandId(
          "tabletop",
          props.session.id!,
          version.sequence,
          operation.kind,
        ),
        baseSequence: version.sequence,
        baseStateHash: version.stateHash,
        role: mode,
        actorKey: tabletopActorKey,
        operation,
      });
    });
  };
  const commitInventoryCommand = async (input: {
    kind: string;
    instanceKey: string;
    build: (commandId: string, eventSequence: number) => TtrpgItemCommandV2;
  }) => {
    await run(async () => {
      const version = await readProductRuntimeStateVersion(props.session.id!);
      const id = commandId(
        `item-${input.kind}`,
        props.session.id!,
        version.sequence,
        input.instanceKey,
      );
      await commitTtrpgItemCommandV2({
        sessionId: props.session.id!,
        commandId: id,
        baseSequence: version.sequence,
        baseStateHash: version.stateHash,
        requestedBy: {
          role: mode,
          actorKey: mode === "gm" ? "gm" : clueRecipientKey,
        },
        command: input.build(id, version.sequence + 1),
      });
    });
  };
  const commitIntentDisposition = async (input: {
    actionKey: string | null;
    targetKey: string | null;
    terminalStatus: "interrupted" | "queued/deferred" | "cancelled";
    reason: string;
  }) => {
    if (!selectedActor) throw new Error("当前没有可处置行动的角色。");
    await run(async () => {
      const version = await readProductRuntimeStateVersion(props.session.id!);
      await commitTtrpgIntentDispositionV2({
        sessionId: props.session.id!,
        commandId: commandId(
          `intent-${input.terminalStatus.replace(/[^a-z]+/g, "-")}`,
          props.session.id!,
          version.sequence,
          input.actionKey ?? "draft",
        ),
        baseSequence: version.sequence,
        baseStateHash: version.stateHash,
        intentKey: `intent.${version.sequence + 1}.${selectedActor.characterKey}`,
        actorKey: selectedActor.characterKey,
        rawInput: declaredActionIntent,
        actionKey: input.actionKey,
        targetKey: input.targetKey,
        terminalStatus: input.terminalStatus,
        reason: input.reason,
        submittedBy: {
          role: mode,
          viewerKey:
            mode === "gm"
              ? (participants.find((row) => row.role === "gm")?.viewerKey ??
                "gm")
              : (selectedPlayerSeat?.viewerKey ?? ""),
        },
      });
      setDeclaredActionIntent("");
    });
  };

  if (!product) return null;
  if (!frozen) {
    return (
      <section className="rounded-lg border border-accent/30 bg-bg-surface p-5">
        {error ? (
          <p className="text-xs text-danger" role="alert">
            冻结 TTRPG 产品校验失败：{error}
          </p>
        ) : (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            正在校验冻结 RulePack 与 CampaignPack…
          </div>
        )}
      </section>
    );
  }

  const { campaign, rulePack } = frozen;
  const allSafetyAccepted = product.sessionZero.requiredItemKeys.every((key) =>
    acceptedItems.has(key),
  );
  const rosterReady =
    selectedCharacterKeys.size >= campaign.playerCount.minimum &&
    selectedCharacterKeys.size <= campaign.playerCount.maximum;
  const activeParticipantRows = participants.filter(
    (row) =>
      row.role === "gm" ||
      (row.actorKey != null && selectedCharacterKeys.has(row.actorKey)),
  );
  const participantReady =
    activeParticipantRows.some((row) => row.role === "gm") &&
    [...selectedCharacterKeys].every((characterKey) =>
      activeParticipantRows.some((row) => row.actorKey === characterKey),
    ) &&
    activeParticipantRows.every(
      (row) =>
        row.controller !== "vacant" &&
        row.assignmentState !== "vacant" &&
        row.assignmentState !== "left" &&
        ((row.controller !== "ai" && row.controller !== "hybrid") ||
          row.consent.aiIdentityDisclosed),
    );
  const safetyPaused = product.safety.status === "paused";
  const campaignState = props.state.ttrpg?.campaign ?? null;
  const activeCampaignSession = campaignState?.activeSessionKey
    ? (campaignState.playSessions.find(
        (item) => item.sessionKey === campaignState.activeSessionKey,
      ) ?? null)
    : null;
  const lastCompletedCampaignSession = campaignState
    ? ([...campaignState.playSessions]
        .reverse()
        .find((item) => item.status === "completed") ?? null)
    : null;
  const activeCampaignRoster =
    campaignState?.roster.filter((item) => item.status === "active") ?? [];
  const visibleContinuity = viewerProjection?.continuity ?? null;
  const builderTemplate =
    playerTemplates.find((item) => item.characterKey === builderCharacterKey) ??
    null;
  const builderBudget = builderTemplate
    ? rulePack.attributes.reduce(
        (sum, attribute) => sum + builderTemplate.attributes[attribute.key],
        0,
      )
    : 0;
  const builderAllocated = rulePack.attributes.reduce(
    (sum, attribute) => sum + (builderAttributes[attribute.key] ?? 0),
    0,
  );
  const selectedProgression =
    product.characterProgression?.[selectedActorKey] ?? null;
  const selectedGrowthAvailable = selectedProgression
    ? (selectedCharacterSheet?.rules.progression.unspentPoints ?? 0)
    : 0;
  const mayAdvanceSelected =
    !!selectedActorView &&
    (mode === "gm" || selectedActorView.controlledByViewer);

  return (
    <section
      className="formal-ttrpg-guide overflow-hidden rounded-lg border border-accent/40 bg-bg-surface"
      data-testid="formal-ttrpg-campaign-guide"
    >
      <header className="border-b border-border bg-accent/5 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-accent">
              FORMAL CAMPAIGN · {rulePack.title}
            </div>
            <h2 className="mt-1 text-lg font-semibold text-text-primary">
              {campaign.title}
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-text-muted">
              {campaign.pitch}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {!theaterMode && (
              <div className="flex rounded border border-border bg-bg-base p-1 text-xs">
                <button
                  aria-pressed={mode === "player"}
                  onClick={() => setMode("player")}
                  className={`rounded px-3 py-1.5 ${mode === "player" ? "bg-accent text-white" : "text-text-secondary"}`}
                >
                  <Users className="mr-1 inline h-3.5 w-3.5" />
                  玩家视图
                </button>
                <button
                  aria-pressed={mode === "gm"}
                  onClick={() => setMode("gm")}
                  className={`rounded px-3 py-1.5 ${mode === "gm" ? "bg-accent text-white" : "text-text-secondary"}`}
                >
                  <ShieldCheck className="mr-1 inline h-3.5 w-3.5" />
                  主持人视图
                </button>
              </div>
            )}
            <button
              aria-pressed={theaterMode}
              onClick={() => {
                setTheaterMode((current) => !current);
                setMode("player");
              }}
              className={`rounded border px-3 py-1.5 text-xs ${theaterMode ? "border-accent bg-accent text-white" : "border-border bg-bg-base text-text-secondary"}`}
            >
              <Monitor className="mr-1 inline h-3.5 w-3.5" />
              {theaterMode ? "退出投屏" : "安全投屏"}
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-text-muted">
          <span className="rounded bg-bg-base px-2 py-1">
            {campaign.playerCount.minimum}–{campaign.playerCount.maximum} 人
          </span>
          <span className="rounded bg-bg-base px-2 py-1">
            约 {campaign.estimatedMinutes} 分钟
          </span>
          <span className="rounded bg-bg-base px-2 py-1">
            {DIFFICULTY_LABELS[campaign.difficulty]}
          </span>
          <span className="rounded bg-bg-base px-2 py-1">
            规则 {rulePack.ruleSystemVersion}
          </span>
        </div>
      </header>

      <div className="space-y-5 p-5">
        {theaterMode && (
          <section
            className="overflow-hidden rounded-xl border border-accent/40 bg-gradient-to-br from-bg-base via-bg-surface to-accent/10 p-5"
            data-testid="ttrpg-theater-mode"
            aria-label="玩家安全投屏模式"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-accent">
                  PLAYER-SAFE THEATER
                </div>
                <h3 className="mt-2 text-2xl font-semibold text-text-primary">
                  {currentScene?.title ?? "战役尚未开场"}
                </h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">
                  {currentScene?.description ?? campaign.pitch}
                </p>
              </div>
              <div className="rounded border border-border bg-bg-base/80 px-3 py-2 text-xs text-text-muted">
                {currentScene?.locationKey
                  ? (props.state.entities[currentScene.locationKey]?.name ??
                    "当前场景")
                  : "叙事场景"}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              {frozenRoster.map((key) => {
                const entity = props.state.entities[key];
                const template = playerTemplates.find(
                  (item) => item.characterKey === key,
                );
                const name = entity?.name ?? template?.name ?? key;
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 rounded-full border border-border bg-bg-base/80 px-3 py-2"
                  >
                    <span
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-sm font-semibold text-accent"
                      aria-hidden="true"
                    >
                      {name.slice(0, 1)}
                    </span>
                    <span className="text-xs text-text-primary">{name}</span>
                  </div>
                );
              })}
            </div>
            <div
              className="mt-5 grid gap-2 sm:grid-cols-4"
              aria-label="玩家可见场景进度"
            >
              {(
                viewerProjection?.scenes ??
                campaign.scenes.map(() => ({
                  status: "locked" as const,
                  title: null,
                }))
              ).map((scene, index) => (
                <div
                  key={index}
                  className={`rounded border p-2 text-center text-[10px] ${scene.status === "current" ? "border-accent bg-accent/10 text-accent" : scene.status === "opened" ? "border-success/40 text-success" : "border-border text-text-muted"}`}
                >
                  {scene.title ?? `未探索场景 ${index + 1}`}
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-2 text-[10px] text-text-muted sm:grid-cols-2">
              <p>
                视觉
                fallback：当前发布未绑定场景图时，使用地点、角色和文本舞台。
              </p>
              <p>
                音频
                fallback：当前无音轨；全部关键信息均以文字呈现，不依赖声音。
              </p>
            </div>
          </section>
        )}
        {!product.sessionZero.completed ? (
          <section
            className="rounded border border-warning/40 bg-warning/5 p-4"
            data-testid="ttrpg-session-zero"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <ShieldCheck className="h-4 w-4 text-warning" />
              开局共识与安全工具
            </div>
            <p className="mt-2 text-xs leading-5 text-text-secondary">
              {campaign.sessionZero.premise}
            </p>
            {campaign.contentWarnings.length > 0 && (
              <p className="mt-2 text-xs text-warning">
                内容提醒：{campaign.contentWarnings.join("、")}
              </p>
            )}
            <div
              className="mt-3 grid gap-2 sm:grid-cols-2"
              data-testid="ttrpg-session-zero-consent-checklist"
            >
              {campaign.sessionZero.consentChecklist.map((label, index) => {
                const key = `consent.${index + 1}`;
                return (
                  <label
                    key={key}
                    className="flex items-start gap-2 rounded border border-border bg-bg-base p-2 text-xs text-text-secondary"
                  >
                    <input
                      type="checkbox"
                      checked={acceptedItems.has(key)}
                      onChange={() =>
                        setAcceptedItems((current) => {
                          const next = new Set(current);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>
            <div className="mt-3 grid gap-2 text-xs text-text-muted sm:grid-cols-3">
              <div>
                暂停信号：
                <strong className="text-text-primary">
                  {campaign.sessionZero.pauseSignal}
                </strong>
              </div>
              <div>
                淡出内容：{campaign.sessionZero.veils.join("、") || "现场协商"}
              </div>
              <div>
                随时离场：
                {campaign.sessionZero.openDoor ? "允许" : "需主持人确认"}
              </div>
            </div>
            <div
              className="mt-4 space-y-2"
              data-testid="ttrpg-session-participants"
            >
              <div className="text-xs font-medium text-text-primary">
                席位、AI 身份与代打授权
              </div>
              {participants.map((row) => {
                const actorName = row.actorKey
                  ? (props.state.entities[row.actorKey]?.name ?? row.actorKey)
                  : row.role === "gm"
                    ? "KP / GM"
                    : row.seatKey;
                const aiEnabled =
                  row.controller === "ai" || row.controller === "hybrid";
                const save = (
                  changes: Parameters<
                    typeof configureTtrpgSessionParticipantV2
                  >[0],
                ) =>
                  void run(
                    async () => {
                      await configureTtrpgSessionParticipantV2(changes);
                      setParticipants(
                        await readTtrpgSessionParticipantsV2(props.session.id!),
                      );
                    },
                    { refresh: false },
                  );
                return (
                  <article
                    key={row.seatKey}
                    className="rounded border border-border bg-bg-base p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <strong className="text-xs text-text-primary">
                          {actorName}
                        </strong>
                        <span className="ml-2 text-[9px] text-text-muted">
                          {row.seatKey} · rev {row.revision}
                        </span>
                      </div>
                      <select
                        aria-label={`${actorName} 控制方式`}
                        value={row.controller}
                        disabled={busy}
                        onChange={(event) => {
                          const controller = event.target
                            .value as TtrpgSessionParticipantRecordV2["controller"];
                          save({
                            sessionId: props.session.id!,
                            seatKey: row.seatKey,
                            expectedRevision: row.revision,
                            commandId: commandId(
                              "seat-controller",
                              props.session.id!,
                              row.revision,
                              row.seatKey,
                            ),
                            requestedByViewerKey: "viewer.gm",
                            controller,
                            assignmentState:
                              controller === "vacant" ? "vacant" : "assigned",
                          });
                        }}
                        className="rounded border border-border bg-bg-surface px-2 py-1 text-[10px] text-text-primary"
                      >
                        <option value="human">真人</option>
                        <option value="ai">AI</option>
                        <option value="hybrid">真人最终确认 + AI 建议</option>
                        {row.role === "player" && (
                          <option value="vacant">待加入</option>
                        )}
                      </select>
                    </div>
                    <div className="mt-2 grid gap-2 text-[10px] text-text-secondary sm:grid-cols-4">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={row.consent.aiIdentityDisclosed}
                          disabled={busy}
                          onChange={(event) =>
                            save({
                              sessionId: props.session.id!,
                              seatKey: row.seatKey,
                              expectedRevision: row.revision,
                              commandId: commandId(
                                "seat-ai-disclosure",
                                props.session.id!,
                                row.revision,
                                row.seatKey,
                              ),
                              requestedByViewerKey: "viewer.gm",
                              consent: {
                                aiIdentityDisclosed: event.target.checked,
                              },
                            })
                          }
                        />
                        已知晓本团 AI 身份
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={row.consent.aiAdviceAllowed}
                          disabled={busy || !row.consent.aiIdentityDisclosed}
                          onChange={(event) =>
                            save({
                              sessionId: props.session.id!,
                              seatKey: row.seatKey,
                              expectedRevision: row.revision,
                              commandId: commandId(
                                "seat-ai-advice",
                                props.session.id!,
                                row.revision,
                                row.seatKey,
                              ),
                              requestedByViewerKey: "viewer.gm",
                              consent: {
                                aiAdviceAllowed: event.target.checked,
                              },
                            })
                          }
                        />
                        允许 AI 给角色内建议
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={row.consent.aiSubstitutionAllowed}
                          disabled={
                            busy ||
                            !row.consent.aiIdentityDisclosed ||
                            row.controller === "ai"
                          }
                          onChange={(event) =>
                            save({
                              sessionId: props.session.id!,
                              seatKey: row.seatKey,
                              expectedRevision: row.revision,
                              commandId: commandId(
                                "seat-ai-substitute",
                                props.session.id!,
                                row.revision,
                                row.seatKey,
                              ),
                              requestedByViewerKey: "viewer.gm",
                              consent: {
                                aiSubstitutionAllowed: event.target.checked,
                              },
                              substitutionPolicy: event.target.checked
                                ? "with-owner-consent"
                                : "never",
                            })
                          }
                        />
                        允许缺席时 AI 代打
                      </label>
                      {row.role === "player" && (
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={row.consent.generatedPortraitAllowed}
                            disabled={busy}
                            onChange={(event) =>
                              save({
                                sessionId: props.session.id!,
                                seatKey: row.seatKey,
                                expectedRevision: row.revision,
                                commandId: commandId(
                                  "seat-generated-portrait",
                                  props.session.id!,
                                  row.revision,
                                  row.seatKey,
                                ),
                                requestedByViewerKey: "viewer.gm",
                                consent: {
                                  generatedPortraitAllowed:
                                    event.target.checked,
                                },
                              })
                            }
                          />
                          允许生成角色立绘、表情与 Token
                        </label>
                      )}
                    </div>
                    {aiEnabled && !row.consent.aiIdentityDisclosed && (
                      <p className="mt-2 text-[10px] text-warning">
                        该 AI/混合席位尚未完成身份披露，Session Zero 会被阻止。
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
            <p
              className={`mt-3 text-xs ${rosterReady ? "text-success" : "text-warning"}`}
            >
              本局角色：已选择 {selectedCharacterKeys.size} 名（需要{" "}
              {campaign.playerCount.minimum}–{campaign.playerCount.maximum}{" "}
              名）。在下方角色卡中选择或取消。
            </p>
            {!participantReady && (
              <p className="mt-2 text-xs text-warning">
                请先认领全部已选席位，并完成 AI 身份披露；AI 代打默认关闭。
              </p>
            )}
            <button
              disabled={
                busy || !allSafetyAccepted || !rosterReady || !participantReady
              }
              onClick={() =>
                void run(async () => {
                  const version = await readProductRuntimeStateVersion(
                    props.session.id!,
                  );
                  await completeTtrpgSessionZero({
                    sessionId: props.session.id!,
                    commandId: commandId(
                      "session-zero",
                      props.session.id!,
                      version.sequence,
                    ),
                    baseSequence: version.sequence,
                    baseStateHash: version.stateHash,
                    acceptedItemKeys: [...acceptedItems],
                    selectedCharacterKeys: [...selectedCharacterKeys],
                    completedBy: "gm",
                  });
                })
              }
              className="mt-4 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40"
            >
              确认共识并开始战役
            </button>
          </section>
        ) : (
          <div className="flex items-center gap-2 rounded border border-success/30 bg-success/5 px-3 py-2 text-xs text-success">
            <CheckCircle2 className="h-4 w-4" />
            Session Zero 已完成；安全共识已写入可回放事件。
          </div>
        )}

        {product.sessionZero.completed && (
          <section
            className={`rounded border p-3 ${safetyPaused ? "border-warning/50 bg-warning/10" : "border-success/30 bg-success/5"}`}
            data-testid="ttrpg-safety-control"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                  {safetyPaused ? (
                    <PauseCircle className="h-4 w-4 text-warning" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 text-success" />
                  )}
                  {safetyPaused ? "战役已安全暂停" : "安全工具可用"}
                </div>
                <p className="mt-1 text-xs text-text-muted">
                  暂停会在事件层阻断场景、规则、线索、结局与 AI
                  调用；不是只隐藏按钮。
                </p>
                {safetyPaused && (
                  <p className="mt-1 text-xs text-warning">
                    原因：{product.safety.reason}
                  </p>
                )}
              </div>
              {safetyPaused ? (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const version = await readProductRuntimeStateVersion(
                        props.session.id!,
                      );
                      await changeTtrpgSafetyStatus({
                        sessionId: props.session.id!,
                        commandId: commandId(
                          "safety-resume",
                          props.session.id!,
                          version.sequence,
                        ),
                        baseSequence: version.sequence,
                        baseStateHash: version.stateHash,
                        status: "active",
                        reason: null,
                        changedBy: "gm",
                      });
                    })
                  }
                  className="rounded bg-success px-3 py-1.5 text-xs text-white disabled:opacity-40"
                >
                  <PlayCircle className="mr-1 inline h-3.5 w-3.5" />
                  确认边界并恢复
                </button>
              ) : (
                <div className="flex min-w-[260px] flex-1 flex-wrap justify-end gap-2">
                  <input
                    value={safetyReason}
                    onChange={(event) => setSafetyReason(event.target.value)}
                    aria-label="安全暂停原因"
                    className="min-w-[220px] flex-1 rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                  />
                  <button
                    disabled={busy || !safetyReason.trim()}
                    onClick={() =>
                      void run(async () => {
                        const version = await readProductRuntimeStateVersion(
                          props.session.id!,
                        );
                        await changeTtrpgSafetyStatus({
                          sessionId: props.session.id!,
                          commandId: commandId(
                            "safety-pause",
                            props.session.id!,
                            version.sequence,
                          ),
                          baseSequence: version.sequence,
                          baseStateHash: version.stateHash,
                          status: "paused",
                          reason: safetyReason,
                          changedBy: "player",
                        });
                      })
                    }
                    className="rounded border border-warning/50 px-3 py-1.5 text-xs text-warning disabled:opacity-40"
                  >
                    <PauseCircle className="mr-1 inline h-3.5 w-3.5" />
                    立即暂停
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {frozen.onlineReleaseHash != null &&
          (product.sessionZero.completed ||
            props.initialOnlineHandoff != null) && (
            <TtrpgOnlineRoomPanel
              releaseHash={frozen.onlineReleaseHash}
              selectedCharacterKeys={[
                ...new Set([
                  ...product.sessionZero.selectedCharacterKeys,
                  ...(props.initialOnlineHandoff
                    ? [props.initialOnlineHandoff.actorKey]
                    : []),
                ]),
              ]}
              characterNames={Object.fromEntries(
                [
                  ...new Set([
                    ...product.sessionZero.selectedCharacterKeys,
                    ...(props.initialOnlineHandoff
                      ? [props.initialOnlineHandoff.actorKey]
                      : []),
                  ]),
                ].map((key) => [key, props.state.entities[key]?.name ?? key]),
              )}
              initialHandoff={props.initialOnlineHandoff}
              onInitialHandoffConsumed={props.onOnlineHandoffConsumed}
            />
          )}

        {product.sessionZero.completed &&
          viewerProjection?.media &&
          runtimeMediaScope &&
          runtimeMediaViewerKey && (
            <TtrpgRuntimeMediaPanel
              sessionId={props.session.id!}
              scope={runtimeMediaScope}
              runtimePackage={frozen.runtimePackage}
              source={frozen.source}
              media={viewerProjection.media}
              viewerKey={runtimeMediaViewerKey}
              disabled={busy || theaterMode}
              onChanged={props.onChanged}
            />
          )}

        {viewerProjection?.tabletop && (
          <TabletopBoard
            tabletop={viewerProjection.tabletop}
            state={props.state}
            mode={mode}
            actorKey={mode === "gm" ? "gm" : clueRecipientKey}
            selectedTokenKey={selectedTokenKey}
            disabled={busy || safetyPaused || !!product.ending}
            onSelect={setSelectedTokenKey}
            onOperation={commitTabletop}
          />
        )}

        {!product.sessionZero.completed && builderTemplate && (
          <section
            className="rounded border border-border bg-bg-base p-4"
            data-testid="ttrpg-character-builder"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Pencil className="h-4 w-4 text-accent" />
              角色创建器
            </div>
            <p className="mt-1 text-xs text-text-muted">
              完整车卡分为叙事身份与机械权限两层：身份可由玩家完善，属性总点数、技能、资源、能力、物品与成长模式必须通过冻结
              RulePack 校验。
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-[10px] text-text-muted">
                角色骨架
                <select
                  value={builderCharacterKey}
                  onChange={(event) =>
                    setBuilderCharacterKey(event.target.value)
                  }
                  className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary"
                >
                  {playerTemplates.map((character) => (
                    <option
                      key={character.characterKey}
                      value={character.characterKey}
                    >
                      {props.state.entities[character.characterKey]?.name ??
                        character.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[10px] text-text-muted">
                角色姓名
                <input
                  value={builderName}
                  maxLength={300}
                  onChange={(event) => setBuilderName(event.target.value)}
                  className="rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary"
                />
              </label>
            </div>
            <label className="mt-3 grid gap-1 text-[10px] text-text-muted">
              人物说明
              <textarea
                value={builderDescription}
                maxLength={20_000}
                rows={3}
                onChange={(event) => setBuilderDescription(event.target.value)}
                className="rounded border border-border bg-bg-surface p-2 text-xs text-text-primary"
              />
            </label>
            <details
              open
              className="mt-3 rounded border border-border bg-bg-surface p-3"
              data-testid="ttrpg-complete-character-identity"
            >
              <summary className="cursor-pointer text-xs font-semibold text-text-primary">
                完整身份、目标、秘密与扮演信息
              </summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {CHARACTER_IDENTITY_TEXT_FIELDS.map(([field, label]) => (
                  <label
                    key={field}
                    className={`grid gap-1 text-[10px] text-text-muted ${field === "appearance" || field === "portrayal" || field === "voice" ? "md:col-span-2 xl:col-span-3" : ""}`}
                  >
                    {label}
                    {field === "appearance" ||
                    field === "portrayal" ||
                    field === "voice" ? (
                      <textarea
                        rows={2}
                        value={
                          typeof builderIdentity[field] === "string"
                            ? String(builderIdentity[field])
                            : ""
                        }
                        onChange={(event) =>
                          setBuilderIdentity((current) => ({
                            ...current,
                            [field]: event.target.value,
                          }))
                        }
                        className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
                      />
                    ) : (
                      <input
                        value={
                          typeof builderIdentity[field] === "string"
                            ? String(builderIdentity[field])
                            : ""
                        }
                        onChange={(event) =>
                          setBuilderIdentity((current) => ({
                            ...current,
                            [field]: event.target.value,
                          }))
                        }
                        className="rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                      />
                    )}
                  </label>
                ))}
                <label className="grid gap-1 text-[10px] text-text-muted md:col-span-2 xl:col-span-3">
                  详细背景
                  <textarea
                    rows={4}
                    value={
                      typeof builderIdentity.background === "string"
                        ? builderIdentity.background
                        : ""
                    }
                    onChange={(event) =>
                      setBuilderIdentity((current) => ({
                        ...current,
                        background: event.target.value,
                      }))
                    }
                    className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
                  />
                </label>
                {CHARACTER_IDENTITY_LIST_FIELDS.map(([field, label]) => (
                  <label
                    key={field}
                    className="grid gap-1 text-[10px] text-text-muted"
                  >
                    {label}
                    <span className="text-[9px]">每行一项</span>
                    <textarea
                      rows={3}
                      value={
                        Array.isArray(builderIdentity[field])
                          ? (builderIdentity[field] as string[]).join("\n")
                          : ""
                      }
                      onChange={(event) =>
                        setBuilderIdentity((current) => ({
                          ...current,
                          [field]: event.target.value
                            .split("\n")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        }))
                      }
                      className="rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
                    />
                  </label>
                ))}
              </div>
              <p className="mt-3 text-[10px] leading-4 text-text-muted">
                关系、世界绑定与来源许可由制作流程冻结；私密知识、安全备注和非公开关系只投影给本角色与
                KP。
              </p>
            </details>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {rulePack.attributes.map((attribute) => (
                <label
                  key={attribute.key}
                  className="grid gap-1 rounded border border-border bg-bg-surface p-2 text-[10px] text-text-muted"
                >
                  <span>
                    {attribute.name}（{attribute.minimum}–{attribute.maximum}）
                  </span>
                  <input
                    type="number"
                    min={attribute.minimum}
                    max={attribute.maximum}
                    step={1}
                    value={
                      builderAttributes[attribute.key] ?? attribute.defaultValue
                    }
                    onChange={(event) =>
                      setBuilderAttributes((current) => ({
                        ...current,
                        [attribute.key]: Number(event.target.value),
                      }))
                    }
                    className="rounded border border-border bg-bg-base px-2 py-1 text-xs text-text-primary"
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <span
                className={`text-xs ${builderAllocated === builderBudget ? "text-success" : "text-warning"}`}
              >
                属性点 {builderAllocated} / {builderBudget}
              </span>
              <button
                disabled={
                  busy ||
                  !builderName.trim() ||
                  !builderDescription.trim() ||
                  builderAllocated !== builderBudget
                }
                onClick={() =>
                  void run(async () => {
                    const version = await readProductRuntimeStateVersion(
                      props.session.id!,
                    );
                    await customizeTtrpgPlayerCharacterV1({
                      sessionId: props.session.id!,
                      commandId: commandId(
                        "character",
                        props.session.id!,
                        version.sequence,
                        builderCharacterKey,
                      ),
                      baseSequence: version.sequence,
                      baseStateHash: version.stateHash,
                      characterKey: builderCharacterKey,
                      name: builderName,
                      description: builderDescription,
                      attributes: builderAttributes,
                      identity: builderIdentity,
                    });
                  })
                }
                className="rounded bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-40"
              >
                保存角色卡
              </button>
            </div>
          </section>
        )}

        {mode === "gm" && (
          <section
            className="rounded border border-border bg-bg-base p-4"
            data-testid="ttrpg-gm-prep-board"
            aria-label="主持人准备台"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Target className="h-4 w-4 text-accent" />
              主持人准备台
            </div>
            <p className="mt-1 text-xs text-text-muted">
              用玩家不可见的目标、秘密和场景关系主持；这里不要求理解内部 key
              或事件字段。
            </p>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
              <div className="rounded bg-bg-surface p-3">
                <span className="block text-[10px] text-text-muted">
                  场景路径
                </span>
                <strong>{campaign.scenes.length} 个场景</strong>
              </div>
              <div className="rounded bg-bg-surface p-3">
                <span className="block text-[10px] text-text-muted">
                  必需线索
                </span>
                <strong>
                  {campaign.clues.filter((clue) => clue.required).length} 条
                </strong>
              </div>
              <div className="rounded bg-bg-surface p-3">
                <span className="block text-[10px] text-text-muted">
                  失败前进
                </span>
                <strong>
                  {
                    campaign.clues.filter(
                      (clue) =>
                        clue.required && clue.discoveryPaths.length >= 2,
                    ).length
                  }{" "}
                  条已双路径
                </strong>
              </div>
              <div className="rounded bg-bg-surface p-3">
                <span className="block text-[10px] text-text-muted">
                  讲义备用
                </span>
                <strong>
                  {
                    campaign.handouts.filter((handout) => !handout.assetKey)
                      .length
                  }{" "}
                  份文本版
                </strong>
              </div>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded border border-border bg-bg-surface p-3">
                <div className="text-xs font-semibold text-text-primary">
                  场景关系图
                </div>
                <ol className="mt-2 space-y-2">
                  {campaign.scenes.map((scene) => {
                    const active = currentScene?.sceneKey === scene.sceneKey;
                    const opened = product.openedSceneKeys.includes(
                      scene.sceneKey,
                    );
                    return (
                      <li
                        key={scene.sceneKey}
                        className={`rounded border p-2 text-xs ${active ? "border-accent bg-accent/5" : "border-border"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <strong className="text-text-primary">
                            {scene.title}
                          </strong>
                          <span className="text-[10px] text-text-muted">
                            {active ? "当前" : opened ? "已开启" : "未开启"}
                          </span>
                        </div>
                        <p className="mt-1 text-text-muted">
                          通往：
                          {scene.nextSceneKeys
                            .map(
                              (key) =>
                                campaign.scenes.find(
                                  (item) => item.sceneKey === key,
                                )?.title ?? key,
                            )
                            .join("、") || "结局"}{" "}
                          · 线索 {scene.clueKeys.length}
                        </p>
                        <p className="mt-1 text-warning">
                          失败前进：{scene.failureForward}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              </div>
              <div className="rounded border border-border bg-bg-surface p-3">
                <div className="text-xs font-semibold text-text-primary">
                  NPC 目标与压力
                </div>
                <div className="mt-2 space-y-2">
                  {npcTemplates.map((npc) => {
                    const profile = npc.gmProfile ?? {
                      objective: `保持“${npc.description}”的立场一致。`,
                      leverage: "使用已冻结的世界知识与关系。",
                      secret: "旧发布未冻结专用秘密，请以场景 GM 提示为准。",
                      portrayal: "不替玩家决定行动。",
                      escalation: "只提高叙事代价，不改写规则结果。",
                    };
                    return (
                      <details
                        key={npc.characterKey}
                        className="rounded border border-border bg-bg-base px-3 py-2 text-xs"
                      >
                        <summary className="cursor-pointer font-medium text-text-primary">
                          {npc.name}
                        </summary>
                        <dl className="mt-2 grid gap-2 text-text-secondary">
                          <div>
                            <dt className="text-[10px] text-text-muted">
                              目标
                            </dt>
                            <dd>{profile.objective}</dd>
                          </div>
                          <div>
                            <dt className="text-[10px] text-text-muted">
                              筹码
                            </dt>
                            <dd>{profile.leverage}</dd>
                          </div>
                          <div>
                            <dt className="text-[10px] text-text-muted">
                              秘密
                            </dt>
                            <dd>{profile.secret}</dd>
                          </div>
                          <div>
                            <dt className="text-[10px] text-text-muted">
                              扮演提示
                            </dt>
                            <dd>{profile.portrayal}</dd>
                          </div>
                          <div>
                            <dt className="text-[10px] text-text-muted">
                              升级压力
                            </dt>
                            <dd>{profile.escalation}</dd>
                          </div>
                        </dl>
                      </details>
                    );
                  })}
                  {npcTemplates.length === 0 && (
                    <p className="text-xs text-warning">
                      当前旧发布没有 NPC
                      模板；战役仍可主持，但建议从制作页重新编译以获得 NPC
                      准备卡。
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        <section>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Users className="h-4 w-4 text-accent" />
            预生成角色
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {playerTemplates
              .filter(
                (character) =>
                  !product.sessionZero.completed ||
                  selectedCharacterKeys.has(character.characterKey),
              )
              .map((character) => {
                const entity = props.state.entities[character.characterKey];
                const displayName = entity?.name ?? character.name;
                const displayDescription =
                  typeof entity?.attributes.identity === "string"
                    ? entity.attributes.identity
                    : character.description;
                const active = character.characterKey === activeActorKey;
                const rosterSelected = selectedCharacterKeys.has(
                  character.characterKey,
                );
                return (
                  <button
                    key={character.characterKey}
                    onClick={() => {
                      if (product.sessionZero.completed) {
                        setActorKey(character.characterKey);
                        return;
                      }
                      setSelectedCharacterKeys((current) => {
                        const next = new Set(current);
                        if (next.has(character.characterKey))
                          next.delete(character.characterKey);
                        else if (next.size < campaign.playerCount.maximum)
                          next.add(character.characterKey);
                        return next;
                      });
                    }}
                    aria-pressed={
                      product.sessionZero.completed
                        ? clueRecipientKey === character.characterKey
                        : rosterSelected
                    }
                    aria-label={`${product.sessionZero.completed ? "查看角色" : "选择角色"}：${displayName}`}
                    className={`rounded border p-3 text-left ${active ? "border-accent bg-accent/5" : rosterSelected ? "border-success/50 bg-success/5" : "border-border bg-bg-base"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm text-text-primary">
                        {displayName}
                      </strong>
                      <span className="flex gap-1">
                        {rosterSelected && (
                          <span className="rounded bg-success/10 px-2 py-0.5 text-[10px] text-success">
                            本局角色
                          </span>
                        )}
                        {active && (
                          <span className="rounded bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                            当前行动
                          </span>
                        )}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-text-muted">
                      {displayDescription}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {rulePack.attributes.map((attribute) => (
                        <span
                          key={attribute.key}
                          className="rounded bg-bg-surface px-2 py-1 text-[10px] text-text-secondary"
                        >
                          {attribute.name}{" "}
                          {numberAttribute(
                            props.state,
                            character.characterKey,
                            attribute.key,
                          ) ?? "—"}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 text-[10px] text-text-muted">
                      {rulePack.resources
                        .map(
                          (resource) =>
                            `${resource.name} ${numberAttribute(props.state, character.characterKey, `resource.${resource.key}`) ?? "—"}/${numberAttribute(props.state, character.characterKey, `resourceMax.${resource.key}`) ?? "—"}`,
                        )
                        .join(" · ")}
                    </div>
                    {!entity && (
                      <div className="mt-2 text-[10px] text-danger">
                        运行时角色投影缺失
                      </div>
                    )}
                  </button>
                );
              })}
          </div>
        </section>

        {product.sessionZero.completed &&
          selectedCharacterSheet &&
          selectedActorView && (
            <section
              className="rounded border border-border bg-bg-base p-4"
              data-testid="ttrpg-complete-character-sheet"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                    <BookOpenText className="h-4 w-4 text-accent" />
                    {selectedCharacterSheet.identity.name} · 完整角色卡
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {selectedCharacterSheet.identity.occupation} ·{" "}
                    {selectedCharacterSheet.identity.ancestry} ·{" "}
                    {selectedCharacterSheet.identity.age} ·{" "}
                    {selectedCharacterSheet.identity.pronouns}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1 text-[10px]">
                  <span className="rounded bg-success/10 px-2 py-1 text-success">
                    角色完整
                  </span>
                  <span className="rounded bg-success/10 px-2 py-1 text-success">
                    规则合法
                  </span>
                  <span className="rounded bg-success/10 px-2 py-1 text-success">
                    可游玩
                  </span>
                  <span className="rounded bg-accent/10 px-2 py-1 text-accent">
                    {selectedCharacterSheet.privateFieldsVisible
                      ? "含本人/KP私密层"
                      : "公开层"}
                  </span>
                </div>
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <article className="rounded border border-border bg-bg-surface p-3 text-xs">
                  <strong className="text-text-primary">
                    身份、动机与扮演
                  </strong>
                  <dl className="mt-2 grid gap-2 text-text-secondary">
                    <div>
                      <dt className="text-[10px] text-text-muted">外观</dt>
                      <dd>{selectedCharacterSheet.identity.appearance}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-text-muted">背景</dt>
                      <dd>{selectedCharacterSheet.identity.background}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-text-muted">
                        短期 / 长期目标
                      </dt>
                      <dd>
                        {selectedCharacterSheet.identity.shortTermGoal} /{" "}
                        {selectedCharacterSheet.identity.longTermGoal}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-text-muted">
                        性格 / 信念 / 缺点
                      </dt>
                      <dd>
                        {[
                          ...selectedCharacterSheet.identity.personalityTraits,
                          ...selectedCharacterSheet.identity.beliefs,
                          ...selectedCharacterSheet.identity.flaws,
                        ].join(" · ") || "未公开"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[10px] text-text-muted">公开知识</dt>
                      <dd>
                        {selectedCharacterSheet.identity.publicKnowledge.join(
                          " · ",
                        ) || "无"}
                      </dd>
                    </div>
                    {selectedCharacterSheet.privateFieldsVisible && (
                      <>
                        <div>
                          <dt className="text-[10px] text-warning">私密知识</dt>
                          <dd>
                            {selectedCharacterSheet.identity.privateKnowledge.join(
                              " · ",
                            ) || "无"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] text-warning">
                            恐惧 / 欲望
                          </dt>
                          <dd>
                            {[
                              ...selectedCharacterSheet.identity.fears,
                              ...selectedCharacterSheet.identity.desires,
                            ].join(" · ") || "无"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] text-warning">安全边界</dt>
                          <dd>
                            {[
                              ...selectedCharacterSheet.identity.boundaries,
                              ...selectedCharacterSheet.identity.safetyNotes,
                            ].join(" · ") || "以 Session Zero 为准"}
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                </article>
                <article className="rounded border border-border bg-bg-surface p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-text-primary">
                      数值、技能与成长
                    </strong>
                    <span className="text-[10px] text-accent">
                      {selectedCharacterSheet.rules.progression.model === "rank"
                        ? `阶位 ${selectedCharacterSheet.rules.progression.rankKey}`
                        : selectedCharacterSheet.rules.progression.model ===
                            "numeric-level"
                          ? `等级 ${selectedCharacterSheet.rules.progression.level}`
                          : "点购成长"}
                    </span>
                  </div>
                  <p className="mt-2 text-[10px] text-text-muted">
                    {product.advancement.currencyName}：获得{" "}
                    {selectedCharacterSheet.rules.progression.experience} · 已用{" "}
                    {selectedProgression?.spentCurrency ?? 0} · 可用{" "}
                    {selectedGrowthAvailable}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {rulePack.attributes.map((attribute) => (
                      <div
                        key={attribute.key}
                        className="rounded border border-border bg-bg-base p-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span>{attribute.name}</span>
                          <strong>
                            {
                              selectedCharacterSheet.rules.attributes[
                                attribute.key
                              ]
                            }
                          </strong>
                        </div>
                        {mayAdvanceSelected &&
                          ["point-buy", "classless"].includes(
                            selectedCharacterSheet.rules.progression.model,
                          ) && (
                            <button
                              disabled={
                                busy ||
                                selectedGrowthAvailable <
                                  rulePack.advancement.attributeIncreaseCost ||
                                selectedCharacterSheet.rules.attributes[
                                  attribute.key
                                ] >=
                                  Math.min(
                                    attribute.maximum,
                                    rulePack.advancement.maximumAttributeValue,
                                  )
                              }
                              onClick={() =>
                                void run(async () => {
                                  const version =
                                    await readProductRuntimeStateVersion(
                                      props.session.id!,
                                    );
                                  await advanceTtrpgCharacterV1({
                                    sessionId: props.session.id!,
                                    commandId: commandId(
                                      "advance-attribute",
                                      props.session.id!,
                                      version.sequence,
                                      `${selectedActorKey}.${attribute.key}`,
                                    ),
                                    baseSequence: version.sequence,
                                    baseStateHash: version.stateHash,
                                    characterKey: selectedActorKey,
                                    kind: "attribute",
                                    targetKey: attribute.key,
                                  });
                                })
                              }
                              className="mt-1 text-[9px] text-accent disabled:text-text-muted"
                            >
                              +1（{rulePack.advancement.attributeIncreaseCost}）
                            </button>
                          )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3">
                    <span className="text-[10px] text-text-muted">技能</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {Object.entries(selectedCharacterSheet.rules.skills).map(
                        ([skillKey, value]) => (
                          <span
                            key={skillKey}
                            className="rounded bg-bg-base px-2 py-1 text-[10px]"
                          >
                            {rulePack.actions.find(
                              (action) => action.key === skillKey,
                            )?.name ?? skillKey}{" "}
                            {value}
                            {mayAdvanceSelected &&
                              selectedCharacterSheet.rules.progression.model !==
                                "rank" && (
                                <button
                                  disabled={
                                    busy ||
                                    selectedGrowthAvailable <
                                      (rulePack.advancement.skillIncreaseCost ??
                                        rulePack.advancement
                                          .attributeIncreaseCost) ||
                                    value >=
                                      (rulePack.advancement.maximumSkillValue ??
                                        10)
                                  }
                                  onClick={() =>
                                    void run(async () => {
                                      const version =
                                        await readProductRuntimeStateVersion(
                                          props.session.id!,
                                        );
                                      await advanceTtrpgCharacterV1({
                                        sessionId: props.session.id!,
                                        commandId: commandId(
                                          "advance-skill",
                                          props.session.id!,
                                          version.sequence,
                                          `${selectedActorKey}.${skillKey}`,
                                        ),
                                        baseSequence: version.sequence,
                                        baseStateHash: version.stateHash,
                                        characterKey: selectedActorKey,
                                        kind: "skill",
                                        targetKey: skillKey,
                                      });
                                    })
                                  }
                                  className="ml-1 text-accent disabled:text-text-muted"
                                >
                                  +
                                </button>
                              )}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                  {mayAdvanceSelected &&
                    selectedCharacterSheet.rules.progression.model ===
                      "rank" && (
                      <button
                        disabled={
                          busy ||
                          selectedGrowthAvailable <
                            (rulePack.advancement.rankIncreaseCost ??
                              rulePack.advancement.attributeIncreaseCost) ||
                          selectedCharacterSheet.rules.progression.rankKey ===
                            rulePack.advancement.rankOrder?.[
                              rulePack.advancement.rankOrder.length - 1
                            ]
                        }
                        onClick={() =>
                          void run(async () => {
                            const version = await readProductRuntimeStateVersion(
                              props.session.id!,
                            );
                            await advanceTtrpgCharacterV1({
                              sessionId: props.session.id!,
                              commandId: commandId(
                                "advance-rank",
                                props.session.id!,
                                version.sequence,
                                selectedActorKey,
                              ),
                              baseSequence: version.sequence,
                              baseStateHash: version.stateHash,
                              characterKey: selectedActorKey,
                              kind: "rank",
                              targetKey: "rank",
                            });
                          })
                        }
                        className="mt-3 rounded border border-accent/40 px-3 py-1 text-[10px] text-accent disabled:opacity-40"
                      >
                        提升阶位（
                        {rulePack.advancement.rankIncreaseCost ??
                          rulePack.advancement.attributeIncreaseCost}
                        ）
                      </button>
                    )}
                  {mayAdvanceSelected &&
                    selectedCharacterSheet.rules.progression.model ===
                      "numeric-level" && (
                      <button
                        disabled={
                          busy ||
                          selectedGrowthAvailable <
                            (rulePack.advancement.levelIncreaseCost ??
                              rulePack.advancement.attributeIncreaseCost) ||
                          (selectedCharacterSheet.rules.progression.level ??
                            1) >= (rulePack.advancement.maximumLevel ?? 20)
                        }
                        onClick={() =>
                          void run(async () => {
                            const version = await readProductRuntimeStateVersion(
                              props.session.id!,
                            );
                            await advanceTtrpgCharacterV1({
                              sessionId: props.session.id!,
                              commandId: commandId(
                                "advance-level",
                                props.session.id!,
                                version.sequence,
                                selectedActorKey,
                              ),
                              baseSequence: version.sequence,
                              baseStateHash: version.stateHash,
                              characterKey: selectedActorKey,
                              kind: "level",
                              targetKey: "level",
                            });
                          })
                        }
                        className="mt-3 rounded border border-accent/40 px-3 py-1 text-[10px] text-accent disabled:opacity-40"
                      >
                        提升等级（
                        {rulePack.advancement.levelIncreaseCost ??
                          rulePack.advancement.attributeIncreaseCost}
                        ）
                      </button>
                    )}
                </article>
                <article className="rounded border border-border bg-bg-surface p-3 text-xs">
                  <strong className="text-text-primary">
                    能力、次数与随身物品
                  </strong>
                  <div className="mt-2 space-y-2">
                    {selectedCharacterSheet.rules.abilityKeys.map(
                      (actionKey) => {
                        const action = rulePack.actions.find(
                          (item) => item.key === actionKey,
                        );
                        const ability =
                          product.abilityStates?.[
                            `${selectedActorKey}::${actionKey}`
                          ];
                        return (
                          <div
                            key={actionKey}
                            className="rounded border border-border bg-bg-base p-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span>{action?.name ?? actionKey}</span>
                              <span className="text-[9px] text-text-muted">
                                {ability?.remainingUses == null
                                  ? "不限次数"
                                  : `剩余 ${ability.remainingUses}`}
                                {ability?.cooldownUntilRound == null
                                  ? ""
                                  : ` · 冷却至 ${ability.cooldownUntilRound} 轮`}
                              </span>
                            </div>
                          </div>
                        );
                      },
                    )}
                  </div>
                  <div className="mt-3">
                    <span className="text-[10px] text-text-muted">
                      物品实例
                    </span>
                    <div className="mt-1 space-y-1">
                      {(product.inventory
                        ? Object.values(product.inventory.items).filter(
                            (item) => item.ownerRef === selectedActorKey,
                          )
                        : []
                      ).map((item) => (
                        <div
                          key={item.itemInstanceId}
                          className="flex justify-between rounded bg-bg-base px-2 py-1 text-[10px]"
                        >
                          <span>
                            {rulePack.items.find(
                              (definition) =>
                                definition.key === item.definitionRef,
                            )?.name ?? item.definitionRef}{" "}
                            ×{item.quantity}
                          </span>
                          <span className="text-text-muted">
                            {item.charges == null ? "" : `次数 ${item.charges}`}
                            {item.durability == null
                              ? ""
                              : ` · 耐久 ${item.durability}`}
                            {item.stateTags.length
                              ? ` · ${item.stateTags.join("/")}`
                              : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {selectedProgression?.history.length ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[10px] text-accent">
                        成长历史 {selectedProgression.history.length} 笔
                      </summary>
                      <ol className="mt-1 space-y-1 text-[10px] text-text-muted">
                        {selectedProgression.history.map((entry) => (
                          <li key={entry.eventSequence}>
                            #{entry.eventSequence} {entry.kind}:
                            {entry.targetKey} {entry.before}→{entry.after}（-
                            {entry.cost}）
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </article>
              </div>
            </section>
          )}

        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
              <MapPinned className="h-4 w-4 text-accent" />
              战役场景
            </div>
            <div className="space-y-2">
              {campaign.scenes.map((scene, sceneIndex) => {
                const active =
                  props.state.ttrpg?.scene?.sceneKey === scene.sceneKey;
                const sceneView = viewerProjection?.scenes[sceneIndex];
                const opened =
                  sceneView?.status === "opened" ||
                  sceneView?.status === "current";
                const canOpen = !props.state.ttrpg?.scene
                  ? scene.sceneKey === product.openingSceneKey
                  : currentScene?.nextSceneKeys.includes(scene.sceneKey) ===
                    true;
                if (mode === "player" && !opened && !active) {
                  return (
                    <article
                      key={scene.sceneKey}
                      className="rounded border border-dashed border-border bg-bg-base p-3"
                    >
                      <strong className="text-sm text-text-muted">
                        未探索场景
                      </strong>
                      <p className="mt-1 text-xs text-text-muted">
                        标题、地点与内容会在主持人开启后公开。
                      </p>
                    </article>
                  );
                }
                return (
                  <article
                    key={scene.sceneKey}
                    className={`rounded border p-3 ${active ? "border-accent bg-accent/5" : "border-border bg-bg-base"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <strong className="text-sm text-text-primary">
                          {scene.title}
                        </strong>
                        <p className="mt-1 text-xs leading-5 text-text-muted">
                          {scene.description}
                        </p>
                      </div>
                      {active && (
                        <span className="shrink-0 rounded bg-accent px-2 py-1 text-[10px] text-white">
                          当前
                        </span>
                      )}
                    </div>
                    {mode === "gm" && (
                      <details className="mt-2 text-xs text-warning">
                        <summary className="cursor-pointer">
                          GM 私密提示
                        </summary>
                        <p className="mt-1 whitespace-pre-wrap">
                          {scene.gmSecret}
                        </p>
                        <p className="mt-1 text-text-muted">
                          失败推进：{scene.failureForward}
                        </p>
                      </details>
                    )}
                    {mode === "gm" && (
                      <button
                        disabled={
                          busy ||
                          safetyPaused ||
                          !product.sessionZero.completed ||
                          active ||
                          !canOpen ||
                          !!product.ending
                        }
                        onClick={() =>
                          void run(async () => {
                            const version = await readProductRuntimeStateVersion(
                              props.session.id!,
                            );
                            await openTtrpgCampaignScene({
                              sessionId: props.session.id!,
                              commandId: commandId(
                                "scene",
                                props.session.id!,
                                version.sequence,
                                scene.sceneKey,
                              ),
                              baseSequence: version.sequence,
                              baseStateHash: version.stateHash,
                              sceneKey: scene.sceneKey,
                            });
                          })
                        }
                        className="mt-3 rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-hover disabled:opacity-40"
                      >
                        {active
                          ? "正在进行"
                          : canOpen
                            ? "打开场景"
                            : "尚未解锁"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <section className="rounded border border-border bg-bg-base p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <Dices className="h-4 w-4 text-accent" />
                可用行动
              </div>
              {currentScene && activeActorKey && (
                <p
                  className="mt-2 text-xs text-text-secondary"
                  data-testid="ttrpg-active-actor"
                >
                  当前行动者：
                  <strong className="text-text-primary">
                    {props.state.entities[activeActorKey]?.name ??
                      activeActorKey}
                  </strong>
                  {activePlayerSeat
                    ? ` · ${activePlayerSeat.controller === "human" ? "真人" : activePlayerSeat.controller === "ai" ? "AI 玩家" : activePlayerSeat.controller === "hybrid" ? "真人确认 + AI 建议" : "待加入"}`
                    : " · KP 控制"}
                </p>
              )}
              {!currentScene && (
                <p className="mt-2 text-xs text-text-muted">
                  由主持人打开场景后，系统会按角色卡和 RulePack 显示可用行动。
                </p>
              )}
              {currentScene &&
              selectedActor &&
              (mode === "gm" ||
                (selectedActor.role === "player" &&
                  selectedActor.characterKey === clueRecipientKey)) ? (
                <div className="mt-3 space-y-2">
                  {product.actionEconomy?.budgets[
                    selectedActor.characterKey
                  ] && (
                    <div
                      className="flex flex-wrap gap-2 text-[10px] text-text-muted"
                      data-testid="ttrpg-action-budget"
                    >
                      <span className="rounded bg-bg-surface px-2 py-1">
                        主要行动{" "}
                        {
                          product.actionEconomy.budgets[
                            selectedActor.characterKey
                          ].actionsRemaining
                        }
                      </span>
                      <span className="rounded bg-bg-surface px-2 py-1">
                        反应{" "}
                        {
                          product.actionEconomy.budgets[
                            selectedActor.characterKey
                          ].reactionsRemaining
                        }
                      </span>
                      <span className="rounded bg-bg-surface px-2 py-1">
                        自由行动{" "}
                        {
                          product.actionEconomy.budgets[
                            selectedActor.characterKey
                          ].freeActionsRemaining
                        }
                      </span>
                    </div>
                  )}
                  {(props.state.ttrpg?.initiative?.entries.length ?? 0) > 0 && (
                    <div
                      className="flex flex-wrap gap-1 text-[10px] text-text-muted"
                      data-testid="ttrpg-initiative-order"
                    >
                      先攻：
                      {props.state.ttrpg!.initiative!.entries.map((entry) => (
                        <span
                          key={entry.actorKey}
                          className="rounded bg-bg-surface px-2 py-1"
                        >
                          {props.state.entities[entry.actorKey]?.name ??
                            entry.actorKey}{" "}
                          {entry.total}
                        </span>
                      ))}
                    </div>
                  )}
                  <div
                    className="rounded border border-accent/30 bg-accent/5 p-3"
                    data-testid="ttrpg-natural-language-intent"
                  >
                    <label className="text-[10px] font-medium text-text-primary">
                      角色行动声明
                      <textarea
                        value={declaredActionIntent}
                        onChange={(event) =>
                          setDeclaredActionIntent(event.target.value)
                        }
                        rows={3}
                        maxLength={10_000}
                        placeholder="例如：我消耗最后一次洞察专注，检查印章是否被替换，并把发现告诉岑遥。"
                        className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs leading-5 text-text-primary"
                      />
                    </label>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] text-text-muted">
                        先写清目标与方法，再点击下方规则行动；若你不确定该用哪项，可先提交澄清收据。
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={
                            busy ||
                            safetyPaused ||
                            !declaredActionIntent.trim() ||
                            (mode === "player" &&
                              !selectedPlayerSeat?.viewerKey)
                          }
                          onClick={() =>
                            void run(async () => {
                              const version = await readProductRuntimeStateVersion(
                                props.session.id!,
                              );
                              await submitTtrpgActionIntentV2({
                                sessionId: props.session.id!,
                                commandId: commandId(
                                  "intent-clarify",
                                  props.session.id!,
                                  version.sequence,
                                ),
                                baseSequence: version.sequence,
                                baseStateHash: version.stateHash,
                                intentKey: `intent.${version.sequence + 1}.${selectedActor.characterKey}`,
                                actorKey: selectedActor.characterKey,
                                rawInput: declaredActionIntent,
                                actionKey: null,
                                targetKey: null,
                                submittedBy: {
                                  role: mode,
                                  viewerKey:
                                    mode === "gm"
                                      ? (participants.find(
                                          (row) => row.role === "gm",
                                        )?.viewerKey ?? "gm")
                                      : selectedPlayerSeat!.viewerKey,
                                },
                              });
                            })
                          }
                          className="rounded border border-accent/40 px-2 py-1 text-[10px] text-accent disabled:opacity-40"
                        >
                          我不确定规则，先请求澄清
                        </button>
                        <button
                          type="button"
                          disabled={
                            busy ||
                            safetyPaused ||
                            !declaredActionIntent.trim() ||
                            (mode === "player" &&
                              !selectedPlayerSeat?.viewerKey)
                          }
                          onClick={() =>
                            void commitIntentDisposition({
                              actionKey: null,
                              targetKey: null,
                              terminalStatus: "cancelled",
                              reason:
                                "原行动者撤回尚未进入规则裁决的声明；没有掷骰、消耗或状态变化。",
                            })
                          }
                          className="rounded border border-border px-2 py-1 text-[10px] text-text-muted disabled:opacity-40"
                        >
                          撤回并记录
                        </button>
                      </div>
                    </div>
                  </div>
                  {gmActorSummary && (
                    <p
                      className="rounded border border-purple-500/20 bg-purple-500/5 p-2 text-[10px] text-text-muted"
                      data-testid="ttrpg-ai-gm-actor-summary"
                      role="status"
                    >
                      {gmActorSummary}
                    </p>
                  )}
                  {selectedActor?.role === "npc" &&
                    !activePlayerSeat &&
                    gmSeat &&
                    (gmSeat.controller === "ai" ||
                      gmSeat.controller === "hybrid") && (
                      <div
                        className="rounded border border-purple-500/30 bg-purple-500/5 p-3"
                        data-testid="ttrpg-ai-gm-actor-control"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <strong className="text-xs text-text-primary">
                              {gmSeat.controller === "ai"
                                ? "AI KP 的 NPC 回合"
                                : "混合 KP 的 NPC 回合"}
                            </strong>
                            <p className="mt-1 text-[10px] leading-4 text-text-muted">
                              模型只从当前 NPC
                              的合法行动闭集提出意图；骰点、效果、次数、物品和回合推进仍由冻结
                              RulePack 结算。
                              {gmSeat.controller === "hybrid"
                                ? "候选必须由真人 KP 确认。"
                                : "每次只推进一个 NPC 行动，避免自动主持失控。"}
                            </p>
                          </div>
                          {!gmActorCandidate && aiGmDecision.enabled && (
                            <button
                              disabled={
                                busy ||
                                gmActorPendingSequence != null ||
                                safetyPaused ||
                                !props.workspaceScope ||
                                !isAIConfigReady(
                                  resolveRequestConfig(aiConfig, {
                                    category: "runtime.ttrpg-gm",
                                  }).config,
                                )
                              }
                              onClick={() =>
                                void run(async () => {
                                  if (!props.workspaceScope)
                                    throw new Error(
                                      "AI KP 角色行动缺少 WorkspaceScope。",
                                    );
                                  const {
                                    adoptTtrpgGmActorActionCandidateV1,
                                    generateTtrpgGmActorActionCandidateV1,
                                  } = await import(
                                    "../../lib/ttrpg/gm-actor-harness"
                                  );
                                  const generated =
                                    await generateTtrpgGmActorActionCandidateV1(
                                      {
                                        scope: props.workspaceScope,
                                        productRuntimeSessionId: props.session.id!,
                                        objective:
                                          "依据当前 NPC 的目标、已知信息、现场局势和冻结规则，选择一个合理且不替真人玩家做决定的行动。",
                                        aiConfig,
                                      },
                                    );
                                  if (
                                    generated.candidate
                                      .requiresHumanConfirmation
                                  ) {
                                    setGmActorCandidate(generated.candidate);
                                    setGmActorSummary(
                                      "AI 已给出 NPC 行动建议，等待真人 KP 确认。",
                                    );
                                    return;
                                  }
                                  await adoptTtrpgGmActorActionCandidateV1({
                                    scope: props.workspaceScope,
                                    runId: generated.candidate.runId,
                                  });
                                  const version =
                                    await readProductRuntimeStateVersion(
                                      props.session.id!,
                                    );
                                  setGmActorPendingSequence(version.sequence);
                                  setGmActorSummary(
                                    `${generated.candidate.actionName} 已由 RulePack 结算；正在切换到下一行动者。`,
                                  );
                                })
                              }
                              className="rounded bg-purple-600 px-3 py-1.5 text-[10px] text-white disabled:opacity-40"
                            >
                              推进 AI KP 的 NPC 回合
                            </button>
                          )}
                        </div>
                        {!aiGmDecision.enabled && (
                          <div className="mt-2 rounded border border-warning/30 bg-warning/5 p-2 text-[10px] text-warning">
                            <span>{aiGmDecision.blockers.join("；")}</span>
                            {!aiExperimentEnabled && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void setAiGmExperiment(true)}
                                className="mt-2 block rounded bg-purple-600 px-3 py-1.5 text-[10px] text-white disabled:opacity-40"
                              >
                                将当前项目加入 AI GM 实验
                              </button>
                            )}
                          </div>
                        )}
                        {gmActorCandidate && (
                          <div className="mt-3 rounded border border-border bg-bg-surface p-3">
                            <strong className="text-xs text-text-primary">
                              建议：{gmActorCandidate.actionName}
                              {gmActorCandidate.targetName
                                ? ` → ${gmActorCandidate.targetName}`
                                : ""}
                            </strong>
                            <p className="mt-1 text-xs leading-5 text-text-secondary">
                              {gmActorCandidate.approach}
                            </p>
                            {gmActorCandidate.spokenIntent && (
                              <p className="mt-1 text-xs text-accent">
                                “{gmActorCandidate.spokenIntent}”
                              </p>
                            )}
                            <div className="mt-2 flex gap-2">
                              <button
                                disabled={busy || !props.workspaceScope}
                                onClick={() =>
                                  void run(async () => {
                                    if (!props.workspaceScope)
                                      throw new Error(
                                        "混合 KP 确认缺少 WorkspaceScope。",
                                      );
                                    const {
                                      adoptTtrpgGmActorActionCandidateV1,
                                    } = await import(
                                      "../../lib/ttrpg/gm-actor-harness"
                                    );
                                    await adoptTtrpgGmActorActionCandidateV1({
                                      scope: props.workspaceScope,
                                      runId: gmActorCandidate.runId,
                                    });
                                    const version =
                                      await readProductRuntimeStateVersion(
                                        props.session.id!,
                                      );
                                    setGmActorPendingSequence(version.sequence);
                                    setGmActorSummary(
                                      `${gmActorCandidate.actionName} 已由真人 KP 确认并完成规则结算。`,
                                    );
                                    setGmActorCandidate(null);
                                  })
                                }
                                className="rounded bg-success px-3 py-1 text-[10px] text-white disabled:opacity-40"
                              >
                                真人 KP 确认并结算
                              </button>
                              <button
                                disabled={busy || !props.workspaceScope}
                                onClick={() =>
                                  void run(
                                    async () => {
                                        if (!props.workspaceScope)
                                          throw new Error(
                                            "混合 KP 拒绝缺少 WorkspaceScope。",
                                          );
                                        const {
                                          rejectTtrpgGmActorActionCandidateV1,
                                        } = await import(
                                          "../../lib/ttrpg/gm-actor-harness"
                                        );
                                        await rejectTtrpgGmActorActionCandidateV1(
                                        {
                                          scope: props.workspaceScope,
                                          runId: gmActorCandidate.runId,
                                        },
                                      );
                                      setGmActorCandidate(null);
                                      setGmActorSummary(
                                        "真人 KP 已拒绝本次 NPC 行动建议。",
                                      );
                                    },
                                    { refresh: false },
                                  )
                                }
                                className="rounded border border-border px-3 py-1 text-[10px] text-text-secondary disabled:opacity-40"
                              >
                                拒绝建议
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  {aiPlayerCycleSummary && (
                    <p
                      className="rounded border border-purple-500/20 bg-purple-500/5 p-2 text-[10px] text-text-muted"
                      data-testid="ttrpg-ai-player-cycle-summary"
                      role="status"
                    >
                      {aiPlayerCycleSummary}
                    </p>
                  )}
                  {activePlayerSeat &&
                    (activePlayerSeat.controller === "ai" ||
                      activePlayerSeat.controller === "hybrid") && (
                      <div
                        className="rounded border border-purple-500/30 bg-purple-500/5 p-3"
                        data-testid="ttrpg-ai-player-control"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <strong className="text-xs text-text-primary">
                              {activePlayerSeat.controller === "ai"
                                ? "AI 玩家席位"
                                : "混合玩家席位"}
                            </strong>
                            <p className="mt-1 text-[10px] leading-4 text-text-muted">
                              只读取该角色的玩家投影并从可用行动闭集提议；骰点和结果仍由
                              RulePack 结算。
                              {activePlayerSeat.controller === "hybrid"
                                ? "建议必须由真人确认。"
                                : "连续 AI 席位会有界推进，遇到真人或 KP 即停止。"}
                            </p>
                          </div>
                          {!playerCandidate && (
                            <button
                              disabled={
                                busy ||
                                aiPlayerCyclePendingSequence != null ||
                                safetyPaused ||
                                !props.workspaceScope ||
                                !isAIConfigReady(
                                  resolveRequestConfig(aiConfig, {
                                    category: "runtime.ttrpg-player",
                                  }).config,
                                )
                              }
                              onClick={() =>
                                void run(async () => {
                                  if (!props.workspaceScope)
                                    throw new Error(
                                      "AI 玩家缺少 WorkspaceScope。",
                                    );
                                  const cycle = await runTtrpgAiPlayerCycleV1({
                                    scope: props.workspaceScope,
                                    productRuntimeSessionId: props.session.id!,
                                    aiConfig,
                                  });
                                  const version =
                                    await readProductRuntimeStateVersion(
                                      props.session.id!,
                                    );
                                  if (cycle.committedActions > 0) {
                                    setAiPlayerCyclePendingSequence(
                                      version.sequence,
                                    );
                                  }
                                  const terminal =
                                    cycle.decisions[cycle.decisions.length - 1];
                                  setAiPlayerCycleSummary(
                                    cycle.committedActions > 0
                                      ? `已结算 ${cycle.committedActions} 个 AI 行动；${terminal?.status === "human-controlled" ? "已停在真人回合" : terminal?.status === "gm-controlled" ? "已停在 KP / NPC 回合" : terminal?.status === "awaiting-human-confirmation" ? "等待真人确认混合席位建议" : terminal?.status === "vacant" ? "已停在空缺席位" : terminal?.status === "manual-required" ? "已停在手动激活席位" : "已到达本次有界推进终点"}。`
                                      : `没有自动提交行动；${terminal?.status === "human-controlled" ? "当前是真人回合" : terminal?.status === "gm-controlled" ? "当前由 KP / NPC 行动" : terminal?.status === "awaiting-human-confirmation" ? "等待真人确认混合席位建议" : terminal?.status === "vacant" ? "当前席位空缺" : terminal?.status === "manual-required" ? "当前席位需要手动激活" : "当前没有可自动推进的 AI 玩家"}。`,
                                  );
                                  const awaiting = cycle.decisions.find(
                                    (decision) =>
                                      decision.status ===
                                      "awaiting-human-confirmation",
                                  );
                                  setPlayerCandidate(
                                    awaiting?.status ===
                                      "awaiting-human-confirmation"
                                      ? awaiting.candidate
                                      : null,
                                  );
                                })
                              }
                              className="rounded bg-purple-600 px-3 py-1.5 text-[10px] text-white disabled:opacity-40"
                            >
                              {activePlayerSeat.controller === "ai"
                                ? "推进 AI 玩家回合"
                                : "生成角色内建议"}
                            </button>
                          )}
                        </div>
                        {playerCandidate && (
                          <div className="mt-3 rounded border border-border bg-bg-surface p-3">
                            <div className="text-xs font-medium text-text-primary">
                              建议：{playerCandidate.actionName}
                              {playerCandidate.targetName
                                ? ` → ${playerCandidate.targetName}`
                                : ""}
                            </div>
                            <p className="mt-1 text-xs leading-5 text-text-secondary">
                              {playerCandidate.approach}
                            </p>
                            {playerCandidate.spokenIntent && (
                              <p className="mt-1 text-xs text-accent">
                                “{playerCandidate.spokenIntent}”
                              </p>
                            )}
                            <div className="mt-2 flex gap-2">
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    if (!props.workspaceScope)
                                      throw new Error(
                                        "混合席位确认缺少 WorkspaceScope。",
                                      );
                                    await adoptTtrpgPlayerActionCandidateV1({
                                      scope: props.workspaceScope,
                                      runId: playerCandidate.runId,
                                    });
                                    setPlayerCandidate(null);
                                  })
                                }
                                className="rounded bg-accent px-3 py-1 text-[10px] text-white disabled:opacity-40"
                              >
                                由真人确认并结算
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void run(
                                    async () => {
                                      if (!props.workspaceScope)
                                        throw new Error(
                                          "混合席位拒绝缺少 WorkspaceScope。",
                                        );
                                      await rejectTtrpgPlayerActionCandidateV1({
                                        scope: props.workspaceScope,
                                        runId: playerCandidate.runId,
                                      });
                                      setPlayerCandidate(null);
                                    },
                                    { refresh: false },
                                  )
                                }
                                className="rounded border border-border px-3 py-1 text-[10px] text-text-muted disabled:opacity-40"
                              >
                                拒绝建议
                              </button>
                            </div>
                            <div className="mt-2 font-mono text-[9px] text-text-muted">
                              Run #{playerCandidate.runId} · base #
                              {playerCandidate.baseSequence} · candidate{" "}
                              {playerCandidate.candidateHash.slice(0, 12)} ·{" "}
                              {playerCandidate.modelEvidence.totalTokens} tokens
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  {otherTargets.length > 0 && (
                    <label className="grid gap-1 text-[10px] text-text-muted">
                      单体行动目标
                      <select
                        value={selectedTargetKey}
                        onChange={(event) => setTargetKey(event.target.value)}
                        className="rounded border border-border bg-bg-surface p-2 text-xs text-text-primary"
                      >
                        {otherTargets.map((key) => (
                          <option key={key} value={key}>
                            {props.state.entities[key]?.name ??
                              campaign.characterTemplates.find(
                                (item) => item.characterKey === key,
                              )?.name ??
                              key}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {currentScene.actionKeys
                    .map((actionKey) =>
                      rulePack.actions.find((item) => item.key === actionKey),
                    )
                    .filter(
                      (action): action is NonNullable<typeof action> =>
                        !!action,
                    )
                    .map((action) => {
                      const check = action.effects.find(
                        (effect) => effect.kind === "check",
                      );
                      const ownedItemKeys =
                        product.inventory == null
                          ? selectedActor.itemKeys
                          : Object.values(product.inventory.items)
                              .filter(
                                (item) =>
                                  item.ownerRef ===
                                    selectedActor.characterKey &&
                                  !item.stateTags.includes("broken"),
                              )
                              .map((item) => item.definitionRef);
                      const allowed =
                        selectedActor.actionKeys.includes(action.key) ||
                        ownedItemKeys.some((itemKey) =>
                          rulePack.items
                            .find((item) => item.key === itemKey)
                            ?.grantedActionKeys.includes(action.key),
                        );
                      const abilityState =
                        product.abilityStates?.[
                          `${selectedActor.characterKey}::${action.key}`
                        ];
                      const onCooldown =
                        abilityState?.cooldownUntilRound != null &&
                        props.state.ttrpg!.round <
                          abilityState.cooldownUntilRound;
                      const exhausted = abilityState?.remainingUses === 0;
                      const budget =
                        product.actionEconomy?.budgets[
                          selectedActor.characterKey
                        ];
                      const budgetAvailable =
                        !budget ||
                        (action.phase === "reaction"
                          ? budget.reactionsRemaining > 0
                          : action.phase === "free"
                            ? budget.freeActionsRemaining > 0
                            : budget.actionsRemaining > 0);
                      const turnAvailable =
                        action.phase === "reaction" ||
                        activeActorKey === selectedActor.characterKey;
                      const checkDefinition =
                        check?.kind === "check"
                          ? rulePack.checks.find(
                              (item) => item.key === check.checkKey,
                            )
                          : null;
                      const defaultDifficulty = checkDefinition
                        ? ruleCheckDefaultDifficultyV2(
                            checkDefinition,
                            check?.kind === "check"
                              ? selectedActor.attributes[check.attributeKey]
                              : null,
                          )
                        : null;
                      const difficultyOptions = checkDefinition
                        ? ruleCheckDifficultyOptionsV2(
                            checkDefinition,
                            check?.kind === "check"
                              ? selectedActor.attributes[check.attributeKey]
                              : null,
                          )
                        : null;
                      return (
                        <div
                          key={action.key}
                          className="rounded border border-border bg-bg-surface p-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <strong className="text-xs text-text-primary">
                                {action.name}
                              </strong>
                              <p className="mt-0.5 text-[10px] text-text-muted">
                                {action.description}
                              </p>
                              {abilityState && (
                                <p className="mt-1 text-[10px] text-text-muted">
                                  {abilityState.remainingUses == null
                                    ? "次数：不限"
                                    : `剩余 ${abilityState.remainingUses} 次`}
                                  {abilityState.cooldownUntilRound == null
                                    ? ""
                                    : ` · 冷却至第 ${abilityState.cooldownUntilRound} 轮`}
                                </p>
                              )}
                            </div>
                            <span className="text-[10px] text-text-muted">
                              {PHASE_LABELS[action.phase] ?? action.phase}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {checkDefinition && (
                              <select
                                value={
                                  difficulty || String(defaultDifficulty ?? "")
                                }
                                onChange={(event) =>
                                  setDifficulty(event.target.value)
                                }
                                aria-label="正式规则难度"
                                className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                              >
                                <option value={difficultyOptions?.easy ?? 0}>
                                  容易 {difficultyOptions?.easy ?? 0}
                                </option>
                                <option
                                  value={difficultyOptions?.standard ?? 0}
                                >
                                  标准 {difficultyOptions?.standard ?? 0}
                                </option>
                                <option value={difficultyOptions?.hard ?? 0}>
                                  困难 {difficultyOptions?.hard ?? 0}
                                </option>
                              </select>
                            )}
                            {checkDefinition &&
                              product.hiddenDicePolicy !== "never" && (
                                <select
                                  value={rollVisibility}
                                  onChange={(event) =>
                                    setRollVisibility(
                                      event.target.value as
                                        "public" | "gm-only",
                                    )
                                  }
                                  aria-label="检定可见性"
                                  className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                                >
                                  <option value="public">公开骰</option>
                                  <option value="gm-only">暗骰（仅 KP）</option>
                                </select>
                              )}
                            <button
                              disabled={
                                busy ||
                                safetyPaused ||
                                selectedPlayerSeat?.controller === "ai" ||
                                !declaredActionIntent.trim() ||
                                (mode === "player" &&
                                  !selectedPlayerSeat?.viewerKey)
                              }
                              onClick={() =>
                                void run(async () => {
                                  const version =
                                    await readProductRuntimeStateVersion(
                                      props.session.id!,
                                    );
                                  const target =
                                    action.target === "self"
                                      ? selectedActor.characterKey
                                      : action.target === "scene"
                                        ? null
                                        : selectedTargetKey;
                                  await submitTtrpgActionIntentV2({
                                    sessionId: props.session.id!,
                                    commandId: commandId(
                                      "intent",
                                      props.session.id!,
                                      version.sequence,
                                      action.key,
                                    ),
                                    baseSequence: version.sequence,
                                    baseStateHash: version.stateHash,
                                    intentKey: `intent.${version.sequence + 1}.${selectedActor.characterKey}`,
                                    rawInput: declaredActionIntent,
                                    actionKey: action.key,
                                    actorKey: selectedActor.characterKey,
                                    targetKey: target,
                                    difficulty: checkDefinition
                                      ? Number(
                                          difficulty || defaultDifficulty || 0,
                                        )
                                      : undefined,
                                    rollVisibility:
                                      checkDefinition &&
                                      product.hiddenDicePolicy !== "never"
                                        ? rollVisibility
                                        : "public",
                                    submittedBy: {
                                      role: mode,
                                      viewerKey:
                                        mode === "gm"
                                          ? (participants.find(
                                              (row) => row.role === "gm",
                                            )?.viewerKey ?? "gm")
                                          : selectedPlayerSeat!.viewerKey,
                                    },
                                  });
                                  setDeclaredActionIntent("");
                                })
                              }
                              className="rounded bg-accent px-3 py-1 text-[10px] text-white disabled:opacity-40"
                            >
                              {!allowed
                                ? "提交并获取非法原因"
                                : !turnAvailable ||
                                    !budgetAvailable ||
                                    onCooldown ||
                                    exhausted
                                  ? "提交并获取终态反馈"
                                  : checkDefinition
                                    ? "提交意图、检定并结算"
                                    : "提交意图并直接结算"}
                            </button>
                            <button
                              type="button"
                              disabled={
                                busy ||
                                safetyPaused ||
                                !allowed ||
                                !declaredActionIntent.trim() ||
                                (mode === "player" &&
                                  !selectedPlayerSeat?.viewerKey)
                              }
                              onClick={() =>
                                void commitIntentDisposition({
                                  actionKey: action.key,
                                  targetKey:
                                    action.target === "self"
                                      ? selectedActor.characterKey
                                      : action.target === "scene"
                                        ? null
                                        : selectedTargetKey,
                                  terminalStatus: "queued/deferred",
                                  reason:
                                    "行动者明确选择延迟这项合法行动；本次没有掷骰、消耗或状态变化，等待新的行动窗口重新确认。",
                                })
                              }
                              className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary disabled:opacity-40"
                            >
                              延迟并记录
                            </button>
                            {mode === "gm" && (
                              <button
                                type="button"
                                disabled={
                                  busy ||
                                  safetyPaused ||
                                  !allowed ||
                                  !declaredActionIntent.trim()
                                }
                                onClick={() =>
                                  void commitIntentDisposition({
                                    actionKey: action.key,
                                    targetKey:
                                      action.target === "self"
                                        ? selectedActor.characterKey
                                        : action.target === "scene"
                                          ? null
                                          : selectedTargetKey,
                                    terminalStatus: "interrupted",
                                    reason:
                                      "KP 确认一项已结算的规则反应或场景变化先行打断该行动；本次没有掷骰，资源与次数保持不变。",
                                  })
                                }
                                className="rounded border border-warning/50 px-2 py-1 text-[10px] text-warning disabled:opacity-40"
                              >
                                KP 确认被打断
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              ) : (
                currentScene && (
                  <p className="mt-2 text-xs text-text-muted">
                    正在等待{" "}
                    {props.state.entities[activeActorKey]?.name ??
                      activeActorKey}{" "}
                    行动。
                  </p>
                )
              )}
              {mode === "gm" &&
                product.sessionZero.completed &&
                !product.ending && (
                  <div
                    className="mt-3 flex flex-wrap items-center gap-2 rounded border border-border bg-bg-surface p-3"
                    data-testid="ttrpg-rest-controls"
                  >
                    <div className="mr-auto">
                      <strong className="text-xs text-text-primary">
                        规则化休息
                      </strong>
                      <p className="mt-0.5 text-[10px] text-text-muted">
                        只恢复冻结规则明确声明的短休/长休次数与冷却，并写入可重放收据。
                      </p>
                    </div>
                    {(["short-rest", "long-rest"] as const).map((kind) => (
                      <button
                        key={kind}
                        disabled={
                          busy ||
                          safetyPaused ||
                          props.state.ttrpg?.encounter?.status === "active"
                        }
                        onClick={() =>
                          void run(async () => {
                            const version = await readProductRuntimeStateVersion(
                              props.session.id!,
                            );
                            await completeTtrpgRestV2({
                              sessionId: props.session.id!,
                              commandId: commandId(
                                kind,
                                props.session.id!,
                                version.sequence,
                              ),
                              baseSequence: version.sequence,
                              baseStateHash: version.stateHash,
                              restKey: `rest.${version.sequence + 1}.${kind}`,
                              kind,
                              actorKeys:
                                product.sessionZero.selectedCharacterKeys,
                              gmKey: "gm",
                              reason:
                                kind === "short-rest"
                                  ? "队伍在安全窗口完成短休。"
                                  : "队伍在安全地点完成长休。",
                            });
                          })
                        }
                        className="rounded border border-border px-3 py-1.5 text-[10px] text-text-secondary disabled:opacity-40"
                      >
                        {kind === "short-rest" ? "完成短休" : "完成长休"}
                      </button>
                    ))}
                    {latestProjectedRest && (
                      <span className="w-full text-[9px] text-text-muted">
                        最近：
                        {latestProjectedRest.kind === "short-rest"
                          ? "短休"
                          : "长休"}
                        ，恢复了 {latestProjectedRest.resetAbilityKeys.length}{" "}
                        项能力状态。
                      </span>
                    )}
                  </div>
                )}
              {latestProjectedIntentReceipt &&
                latestProjectedIntentReceipt.eventSequence >
                  (latestAction?.eventSequence ?? 0) && (
                  <div
                    className="mt-3 rounded border border-warning/40 bg-warning/5 p-3 text-xs"
                    data-testid="ttrpg-intent-terminal-receipt"
                    aria-live="polite"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-text-primary">
                        行动意图终态：
                        {INTENT_TERMINAL_LABELS[
                          latestProjectedIntentReceipt.terminalStatus
                        ] ?? latestProjectedIntentReceipt.terminalStatus}
                      </strong>
                      <span className="font-mono text-[9px] text-text-muted">
                        {latestProjectedIntentReceipt.receiptKey}
                      </span>
                    </div>
                    <p className="mt-2 text-text-secondary">
                      “{latestProjectedIntentReceipt.rawInput}”
                    </p>
                    <p className="mt-2 leading-5 text-warning">
                      {latestProjectedIntentReceipt.reason}
                    </p>
                    {latestProjectedIntentReceipt.suggestedActionKeys.length >
                      0 && (
                      <p className="mt-2 text-[10px] text-text-muted">
                        可行替代：
                        {latestProjectedIntentReceipt.suggestedActionKeys
                          .map(
                            (key) =>
                              rulePack.actions.find(
                                (action) => action.key === key,
                              )?.name ?? key,
                          )
                          .join("、")}
                      </p>
                    )}
                  </div>
                )}
              {latestAction && (
                <div className="mt-3 rounded border border-success/30 bg-success/5 p-3 text-xs">
                  <div className="font-medium text-text-primary">
                    最近行动：{latestAction.actionName} ·{" "}
                    {latestProjectedAction?.outcome === "hidden"
                      ? "暗骰待 KP 反馈"
                      : (OUTCOME_LABELS[latestAction.outcome] ??
                        latestAction.outcome)}
                  </div>
                  {latestAction.resourceChanges.length > 0 && (
                    <div className="mt-1 text-text-secondary">
                      {latestAction.resourceChanges
                        .map(
                          (change) =>
                            `${props.state.entities[change.entityKey]?.name ?? change.entityKey} ${rulePack.resources.find((item) => item.key === change.resourceKey)?.name ?? change.resourceKey} ${change.before}→${change.after}`,
                        )
                        .join(" · ")}
                    </div>
                  )}
                  {latestAction.conditionChanges.length > 0 && (
                    <div className="mt-1 text-text-secondary">
                      状态：
                      {latestAction.conditionChanges
                        .map(
                          (change) =>
                            `${rulePack.conditions.find((item) => item.key === change.conditionKey)?.name ?? change.conditionKey}${change.stacks ? `×${change.stacks}` : "移除"}`,
                        )
                        .join(" · ")}
                    </div>
                  )}
                </div>
              )}
              {latestProjectedAction?.receipt && (
                <div
                  className="mt-3 rounded border border-accent/30 bg-accent/5 p-3 text-xs"
                  data-testid="ttrpg-action-receipt"
                  aria-live="polite"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-text-primary">行动终态回执</strong>
                    <span className="font-mono text-[9px] text-text-muted">
                      {latestProjectedAction.receipt.receiptKey} ·{" "}
                      {latestProjectedAction.receipt.criticality}
                    </span>
                  </div>
                  {latestProjectedAction.receipt.declaredIntent && (
                    <p className="mt-2 rounded bg-bg-surface p-2 text-text-secondary">
                      原行动声明：“
                      {latestProjectedAction.receipt.declaredIntent.rawInput}”
                    </p>
                  )}
                  <p className="mt-2 leading-5 text-text-secondary">
                    {latestProjectedAction.receipt.mechanicalSummary}
                  </p>
                  {latestVisibleCheck ? (
                    <p className="mt-2 rounded bg-bg-surface p-2 font-mono text-[10px] text-text-secondary" data-testid="ttrpg-dice-proof-summary">
                      骰式 {latestVisibleCheck.expression} · 骰值 [{latestVisibleCheck.dice.join("、")}] · 修正 {latestVisibleCheck.modifier >= 0 ? "+" : ""}{latestVisibleCheck.modifier}
                      {latestVisibleCheck.rule?.proofHash ? ` · 证明 ${latestVisibleCheck.rule.proofHash.slice(0, 16)}…` : ""}
                    </p>
                  ) : latestProjectedAction.outcome === "hidden" ? (
                    <p className="mt-2 rounded bg-bg-surface p-2 text-[10px] text-text-muted">暗骰的骰式、骰值与证明只向 KP 展示；玩家仅获得可行动的结果反馈。</p>
                  ) : null}
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="rounded bg-bg-surface p-2">
                      <span className="text-[9px] text-text-muted">
                        行动者后果
                      </span>
                      <p className="mt-1 text-text-secondary">
                        {latestProjectedAction.receipt.actorConsequence}
                      </p>
                    </div>
                    <div className="rounded bg-bg-surface p-2">
                      <span className="text-[9px] text-text-muted">
                        场景反馈
                      </span>
                      <p className="mt-1 text-text-secondary">
                        {latestProjectedAction.receipt.sceneConsequence}
                      </p>
                    </div>
                  </div>
                  {latestProjectedAction.receipt.failForwardAvailable && (
                    <p className="mt-2 rounded border border-warning/30 bg-warning/5 p-2 text-warning">
                      失败前进已开启：失败会带来代价或局势变化，但不会锁死继续行动的路径。
                    </p>
                  )}
                  {latestProjectedAction.receipt.observers.some(
                    (observer) =>
                      observer.relevance !== "ambient" &&
                      observer.actorKey !== latestAction.actorKey,
                  ) && (
                    <div className="mt-2">
                      <span className="text-[9px] text-text-muted">
                        在场相关角色与响应权限
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {latestProjectedAction.receipt.observers
                          .filter(
                            (observer) =>
                              observer.relevance !== "ambient" &&
                              observer.actorKey !== latestAction.actorKey,
                          )
                          .map((observer) => (
                            <span
                              key={observer.actorKey}
                              className="rounded border border-border bg-bg-surface px-2 py-1 text-[10px] text-text-secondary"
                            >
                              {props.state.entities[observer.actorKey]?.name ??
                                observer.actorKey}{" "}
                              ·{" "}
                              {observer.responsePolicy === "prompt-human"
                                ? "等待本人回应"
                                : observer.responsePolicy === "ai-eligible"
                                  ? "AI 可按角色卡回应"
                                  : observer.responsePolicy === "gm-eligible"
                                    ? "KP 可代入回应"
                                    : "仅观察"}
                            </span>
                          ))}
                      </div>
                    </div>
                  )}
                  {latestProjectedAction.receipt.reactionWindows.some(
                    (window) => window.status === "open",
                  ) && (
                    <p className="mt-2 text-[10px] text-accent">
                      反应窗口已开放：
                      {latestProjectedAction.receipt.reactionWindows
                        .filter((window) => window.status === "open")
                        .flatMap((window) => window.eligibleActorKeys)
                        .map((key) => props.state.entities[key]?.name ?? key)
                        .join("、")}
                    </p>
                  )}
                  {(viewerProjection?.humanResponses ?? [])
                    .filter(
                      (response) =>
                        response.actionSequence ===
                        latestProjectedAction.eventSequence,
                    )
                    .map((response) => (
                      <p
                        key={response.responseKey}
                        className="mt-2 rounded border border-border bg-bg-surface p-2 text-text-secondary"
                      >
                        <strong>
                          {props.state.entities[response.actorKey]?.name ??
                            response.actorKey}{" "}
                          本人回应：
                        </strong>
                        {response.text}
                        <span className="ml-2 text-[9px] text-text-muted">
                          {response.audience === "gm-only"
                            ? "仅本人/KP"
                            : "全队"}
                        </span>
                      </p>
                    ))}
                  <p className="mt-2 text-[9px] text-text-muted">
                    {latestProjectedAction.receipt.worldConsequence}
                  </p>
                </div>
              )}
              {pendingHumanResponse &&
                selectedPlayerSeat &&
                ["human", "hybrid"].includes(selectedPlayerSeat.controller) && (
                  <div
                    className="mt-3 rounded border border-accent/30 bg-bg-surface p-3 text-xs"
                    data-testid="ttrpg-human-response-window"
                  >
                    <strong className="text-text-primary">轮到本人回应</strong>
                    <p className="mt-1 text-[10px] text-text-muted">
                      这是角色所有者的非机械回应，绑定 ActionReceipt{" "}
                      {pendingHumanResponse.actionReceiptKey}；KP 和 AI
                      不能替你填写。若要发动规则 reaction，请另走正式行动结算。
                    </p>
                    <textarea
                      aria-label="真人角色回应"
                      value={humanResponseText}
                      onChange={(event) =>
                        setHumanResponseText(event.target.value)
                      }
                      rows={2}
                      className="mt-2 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                      placeholder="说出本角色的话，或描述由本人决定、且不直接改写规则状态的反应。"
                    />
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <label className="text-[10px] text-text-muted">
                        回应类型
                        <select
                          aria-label="真人回应类型"
                          value={humanResponseKind}
                          onChange={(event) =>
                            setHumanResponseKind(
                              event.target.value as "speak" | "act-narratively",
                            )
                          }
                          className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                        >
                          <option value="speak">本人发言</option>
                          <option value="act-narratively">
                            本人叙事动作（无机械写入）
                          </option>
                        </select>
                      </label>
                      <label className="text-[10px] text-text-muted">
                        可见范围
                        <select
                          aria-label="真人回应可见范围"
                          value={humanResponseAudience}
                          onChange={(event) =>
                            setHumanResponseAudience(
                              event.target.value as "party" | "gm-only",
                            )
                          }
                          className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                        >
                          <option value="party">全队</option>
                          <option value="gm-only">仅本人和 KP</option>
                        </select>
                      </label>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        disabled={busy || !humanResponseText.trim()}
                        onClick={() =>
                          void run(async () => {
                            const version = await readProductRuntimeStateVersion(
                              props.session.id!,
                            );
                            await recordTtrpgHumanResponseV2({
                              sessionId: props.session.id!,
                              commandId: commandId(
                                "human-response",
                                props.session.id!,
                                pendingHumanResponse.actionSequence,
                                pendingHumanResponse.actorKey,
                              ),
                              baseSequence: version.sequence,
                              baseStateHash: version.stateHash,
                              actionSequence:
                                pendingHumanResponse.actionSequence,
                              actionReceiptKey:
                                pendingHumanResponse.actionReceiptKey,
                              actorKey: pendingHumanResponse.actorKey,
                              kind: humanResponseKind,
                              text: humanResponseText.trim(),
                              audience: humanResponseAudience,
                              viewerKey: selectedPlayerSeat.viewerKey,
                            });
                            setHumanResponseText("");
                          })
                        }
                        className="rounded border border-accent/40 bg-accent/5 px-3 py-1.5 text-xs text-accent disabled:opacity-40"
                      >
                        提交本角色回应
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const version = await readProductRuntimeStateVersion(
                              props.session.id!,
                            );
                            await recordTtrpgHumanResponseV2({
                              sessionId: props.session.id!,
                              commandId: commandId(
                                "human-response-decline",
                                props.session.id!,
                                pendingHumanResponse.actionSequence,
                                pendingHumanResponse.actorKey,
                              ),
                              baseSequence: version.sequence,
                              baseStateHash: version.stateHash,
                              actionSequence:
                                pendingHumanResponse.actionSequence,
                              actionReceiptKey:
                                pendingHumanResponse.actionReceiptKey,
                              actorKey: pendingHumanResponse.actorKey,
                              kind: "decline",
                              audience: humanResponseAudience,
                              viewerKey: selectedPlayerSeat.viewerKey,
                            });
                            setHumanResponseText("");
                          })
                        }
                        className="rounded border border-border px-3 py-1.5 text-xs text-text-muted disabled:opacity-40"
                      >
                        本人选择不回应
                      </button>
                    </div>
                  </div>
                )}
              {mode === "gm" && latestAction && (
                <div
                  className="mt-3 rounded border border-border bg-bg-surface p-3 text-xs"
                  data-testid="ttrpg-action-effect-builder"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-text-primary">行动后果计划</strong>
                    <span className="font-mono text-[9px] text-text-muted">
                      source event.{latestAction.eventSequence} ·{" "}
                      {latestAction.actionKey}
                    </span>
                  </div>
                  {latestActionEffectCommitted ? (
                    <p className="mt-2 rounded border border-success/30 bg-success/5 p-2 text-success">
                      本次行动的唯一原子后果计划已经入账，不能重复发放奖励或重复推进时钟。
                    </p>
                  ) : (
                    <>
                      <p className="mt-2 text-[10px] leading-4 text-text-muted">
                        KP
                        确认后，所选线索、物品、时钟和社交变化会在同一事件中全部成功或全部回滚。
                      </p>
                      <textarea
                        aria-label="行动后果原因"
                        value={effectReason}
                        onChange={(event) =>
                          setEffectReason(event.target.value)
                        }
                        rows={2}
                        className="mt-2 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                      />
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <label className="text-[10px] text-text-muted">
                          可见范围
                          <select
                            value={effectAudience}
                            onChange={(event) =>
                              setEffectAudience(
                                event.target.value as TtrpgEffectAudienceV2,
                              )
                            }
                            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                          >
                            <option value="party">全队</option>
                            <option value="public">公开</option>
                            <option value="gm">仅 KP</option>
                            <option value={`actor:${latestAction.actorKey}`}>
                              仅行动者
                            </option>
                          </select>
                        </label>
                        <label className="text-[10px] text-text-muted">
                          发现当前场景线索（可选）
                          <select
                            value={effectClueKey}
                            onChange={(event) =>
                              setEffectClueKey(event.target.value)
                            }
                            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                          >
                            <option value="">不结算线索</option>
                            {(currentScene?.clueKeys ?? []).map((clueKey) => {
                              const clue = campaign.clues.find(
                                (item) => item.clueKey === clueKey,
                              );
                              return (
                                <option key={clueKey} value={clueKey}>
                                  {clue?.title ?? clueKey}
                                </option>
                              );
                            })}
                          </select>
                        </label>
                        <label className="text-[10px] text-text-muted">
                          授予规则物品（可选）
                          <select
                            value={effectItemKey}
                            onChange={(event) =>
                              setEffectItemKey(event.target.value)
                            }
                            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                          >
                            <option value="">不授予物品</option>
                            {rulePack.items.map((item) => (
                              <option key={item.key} value={item.key}>
                                {item.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[10px] text-text-muted">
                          世界时钟 key（可选）
                          <input
                            value={effectClockKey}
                            onChange={(event) =>
                              setEffectClockKey(event.target.value)
                            }
                            placeholder="alarm"
                            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                          />
                        </label>
                        <label className="text-[10px] text-text-muted">
                          时钟推进值
                          <input
                            type="number"
                            step={1}
                            value={effectClockAmount}
                            onChange={(event) =>
                              setEffectClockAmount(Number(event.target.value))
                            }
                            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                          />
                        </label>
                        <label className="text-[10px] text-text-muted">
                          社交目标（可选）
                          <select
                            value={effectSocialTargetKey}
                            onChange={(event) =>
                              setEffectSocialTargetKey(event.target.value)
                            }
                            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                          >
                            <option value="">不结算社交变化</option>
                            {(latestAction.receipt?.context.observers ?? [])
                              .filter(
                                (observer) =>
                                  observer.actorKey !== latestAction.actorKey,
                              )
                              .map((observer) => (
                                <option
                                  key={observer.actorKey}
                                  value={observer.actorKey}
                                >
                                  {props.state.entities[observer.actorKey]
                                    ?.name ?? observer.actorKey}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="text-[10px] text-text-muted">
                          社交账本 key
                          <input
                            value={effectSocialKey}
                            onChange={(event) =>
                              setEffectSocialKey(event.target.value)
                            }
                            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                          />
                        </label>
                        <label className="text-[10px] text-text-muted">
                          社交变化值
                          <input
                            type="number"
                            step={1}
                            value={effectSocialAmount}
                            onChange={(event) =>
                              setEffectSocialAmount(Number(event.target.value))
                            }
                            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        disabled={
                          busy ||
                          safetyPaused ||
                          !effectReason.trim() ||
                          (!effectClueKey &&
                            !effectItemKey &&
                            !effectClockKey.trim() &&
                            !(
                              effectSocialTargetKey && effectSocialAmount !== 0
                            ))
                        }
                        onClick={() =>
                          run(async () => {
                            const version = await readProductRuntimeStateVersion(
                              props.session.id!,
                            );
                            const effects: TtrpgEffectPrimitiveV2[] = [];
                            if (effectClueKey) {
                              effects.push({
                                effectKey: `consequence.${latestAction.eventSequence}.clue`,
                                family: "story",
                                operation: "clue.discover",
                                targetRef: latestAction.actorKey,
                                storyKey: effectClueKey,
                                value: true,
                              });
                            }
                            if (effectItemKey) {
                              effects.push({
                                effectKey: `consequence.${latestAction.eventSequence}.item`,
                                family: "item",
                                operation: "item.grant",
                                targetRef: latestAction.actorKey,
                                itemDefinitionRef: effectItemKey,
                                itemInstanceRef: null,
                                destinationRef: null,
                                amount: 1,
                              });
                            }
                            if (effectClockKey.trim()) {
                              effects.push({
                                effectKey: `consequence.${latestAction.eventSequence}.clock`,
                                family: "story",
                                operation: "clock.advance",
                                targetRef:
                                  currentScene?.sceneKey ?? product.campaignKey,
                                storyKey: effectClockKey.trim(),
                                value: effectClockAmount,
                              });
                            }
                            if (
                              effectSocialTargetKey &&
                              effectSocialAmount !== 0
                            ) {
                              effects.push({
                                effectKey: `consequence.${latestAction.eventSequence}.social`,
                                family: "social",
                                operation: "relationship",
                                targetRef: effectSocialTargetKey,
                                socialKey: effectSocialKey.trim(),
                                amount: effectSocialAmount,
                              });
                            }
                            const id = commandId(
                              "action-effect",
                              props.session.id!,
                              version.sequence,
                              String(latestAction.eventSequence),
                            );
                            const plan: TtrpgEffectPlanV2 = {
                              schema: "storyforge.ttrpg-effect-plan",
                              version: 2,
                              planKey: `action-consequence.${latestAction.eventSequence}`,
                              degree:
                                latestAction.outcome === "automatic"
                                  ? "success"
                                  : latestAction.outcome,
                              sourceEventId: `event.${latestAction.eventSequence}`,
                              ruleRef: latestAction.actionKey,
                              reason: effectReason.trim(),
                              audience: effectAudience,
                              idempotencyKey: id,
                              status: "immediate",
                              effects,
                            };
                            await commitTtrpgEffectPlanV2({
                              sessionId: props.session.id!,
                              commandId: id,
                              baseSequence: version.sequence,
                              baseStateHash: version.stateHash,
                              actionSequence: latestAction.eventSequence,
                              plan,
                            });
                            setEffectClueKey("");
                            setEffectItemKey("");
                            setEffectClockKey("");
                            setEffectSocialTargetKey("");
                            setEffectSocialAmount(0);
                          })
                        }
                        className="mt-3 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                      >
                        原子提交行动后果
                      </button>
                    </>
                  )}
                </div>
              )}
              {latestCheck?.rule &&
              (mode === "gm" || latestCheck.visibility !== "gm-only") ? (
                <div className="mt-3 rounded border border-accent/30 bg-accent/5 p-3 text-xs">
                  <div className="font-medium text-text-primary">
                    最近裁定：{latestCheck.skill}
                  </div>
                  <div className="mt-1 text-text-secondary">
                    {latestCheck.dice.join(" + ")}{" "}
                    {latestCheck.modifier >= 0 ? "+" : "−"}{" "}
                    {Math.abs(latestCheck.modifier)} = {latestCheck.total} /{" "}
                    {latestCheck.dc}
                  </div>
                  <div className="mt-1 text-accent">
                    {OUTCOME_LABELS[latestCheck.rule.degree] ??
                      latestCheck.rule.degree}
                  </div>
                  {mode === "gm" && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[9px] text-text-muted">
                        展开审计证明
                      </summary>
                      <div className="mt-1 break-all font-mono text-[9px] text-text-muted">
                        {latestCheck.rule.proofHash}
                      </div>
                    </details>
                  )}
                </div>
              ) : latestCheck?.rule ? (
                <div className="mt-3 rounded border border-accent/30 bg-accent/5 p-3 text-xs text-text-secondary">
                  暗骰已提交：骰点、合计与成功等级仅 KP 可见；等待主持反馈。
                </div>
              ) : null}
              {latestNarration && (
                <div
                  className="mt-3 rounded border border-success/30 bg-success/5 p-3 text-xs"
                  data-testid="formal-ttrpg-gm-narration"
                  aria-live="polite"
                >
                  <div className="font-medium text-text-primary">
                    {latestNarration.source === "ai-confirmed"
                      ? "AI GM 叙事（真人已确认）"
                      : latestNarration.source === "human-gm"
                        ? "真人 GM 叙事"
                        : "规则结果旁白（确定性降级）"}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap leading-5 text-text-secondary">
                    {latestNarration.text}
                  </p>
                  {latestNarration.synthesisFrame && (
                    <div className="mt-3 space-y-2 border-t border-border pt-2">
                      <p className="text-[10px] text-text-secondary">
                        <strong className="text-text-primary">
                          场景更新：
                        </strong>
                        {latestNarration.synthesisFrame.sceneUpdate}
                      </p>
                      {latestNarration.synthesisFrame.reactions.length > 0 && (
                        <div className="space-y-1">
                          {latestNarration.synthesisFrame.reactions.map(
                            (reaction) => (
                              <p
                                key={reaction.actorKey}
                                className="rounded bg-bg-surface px-2 py-1 text-[10px] text-text-secondary"
                              >
                                <strong className="text-text-primary">
                                  {props.state.entities[reaction.actorKey]
                                    ?.name ?? reaction.actorKey}
                                  ：
                                </strong>
                                {reaction.text ??
                                  "由该真人玩家自行决定是否以及如何回应。"}
                              </p>
                            ),
                          )}
                        </div>
                      )}
                      {latestNarration.synthesisFrame.nextPrompts.length >
                        0 && (
                        <p className="text-[10px] text-accent">
                          接下来：
                          {latestNarration.synthesisFrame.nextPrompts.join(
                            " · ",
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  {latestNarration.source === "ai-confirmed" ? (
                    <div className="mt-2 font-mono text-[9px] text-text-muted">
                      Run #{latestNarration.runId} · candidate{" "}
                      {latestNarration.candidateHash?.slice(0, 12)}
                      {latestNarration.modelEvidence
                        ? ` · ${latestNarration.modelCalls.length || 1} call${latestNarration.repairApplied ? " · 已有限修复" : ""} · ${latestNarration.modelEvidence.totalTokens} tokens · ${latestNarration.modelEvidence.latencyMs} ms${latestNarration.modelEvidence.estimatedCostUsd == null ? "" : ` · $${latestNarration.modelEvidence.estimatedCostUsd.toFixed(6)}`}`
                        : ""}
                    </div>
                  ) : (
                    <div className="mt-2 text-[9px] text-text-muted">
                      无模型调用 ·{" "}
                      {latestNarration.source === "human-gm"
                        ? "由房间真人主持正式提交"
                        : "全文来自已提交的 RulePack 结果"}
                    </div>
                  )}
                </div>
              )}
              {mode === "gm" && latestAction && !latestNarration && (
                <div
                  className="mt-3 rounded border border-purple-500/30 bg-purple-500/5 p-3 text-xs"
                  data-testid="trustworthy-ai-gm"
                >
                  <div className="rounded border border-border bg-bg-surface p-3">
                    <div className="font-medium text-text-primary">
                      真人 KP 回应
                    </div>
                    <p className="mt-1 text-[10px] text-text-muted">
                      机械回执已经立即生效；这里补充场景叙述。提交不会修改骰点、资源、状态或回合。
                    </p>
                    <textarea
                      value={humanGmNarration}
                      onChange={(event) =>
                        setHumanGmNarration(event.target.value)
                      }
                      rows={3}
                      className="mt-2 w-full rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
                      aria-label="真人 KP 行动反馈"
                    />
                    <button
                      disabled={
                        busy || safetyPaused || !humanGmNarration.trim()
                      }
                      onClick={() =>
                        void run(async () => {
                          const version = await readProductRuntimeStateVersion(
                            props.session.id!,
                          );
                          await commitTtrpgHumanGmNarrationV1({
                            sessionId: props.session.id!,
                            commandId: commandId(
                              "human-gm",
                              props.session.id!,
                              version.sequence,
                              String(latestAction.eventSequence),
                            ),
                            baseSequence: version.sequence,
                            baseStateHash: version.stateHash,
                            actionSequence: latestAction.eventSequence,
                            text: humanGmNarration,
                            gmKey: "gm",
                          });
                          setHumanGmNarration("");
                        })
                      }
                      className="mt-2 rounded bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-40"
                    >
                      提交真人 KP 反馈
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 font-medium text-text-primary">
                    <Sparkles className="h-4 w-4 text-purple-400" />
                    可信 AI GM{" "}
                    <span className="rounded bg-warning/10 px-2 py-0.5 text-[9px] font-normal text-warning">
                      实验性 · 真实模型 Beta 门未验收
                    </span>
                    {aiExperimentEnabled && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void setAiGmExperiment(false)}
                        className="ml-auto rounded border border-border px-2 py-1 text-[9px] font-normal text-text-muted disabled:opacity-40"
                      >
                        退出当前项目实验
                      </button>
                    )}
                  </div>
                  <p className="mt-1 leading-5 text-text-muted">
                    只为刚刚完成的 RulePack 行动生成叙事候选。AI
                    无权改骰点、资源、状态、回合、线索权限或场景。
                  </p>
                  {!aiGmDecision.enabled && (
                    <div
                      className="mt-2 rounded border border-warning/30 bg-warning/5 p-3 text-[10px] leading-5 text-warning"
                      data-testid="ttrpg-ai-gm-capability-blocker"
                    >
                      <strong className="block">AI GM 当前未开放</strong>
                      <span>{aiGmDecision.blockers.join("；")}</span>
                      {!aiExperimentEnabled && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void setAiGmExperiment(true)}
                          className="mt-2 block rounded bg-purple-600 px-3 py-1.5 text-xs text-white disabled:opacity-40"
                        >
                          将当前项目加入 AI GM 实验
                        </button>
                      )}
                      <span className="mt-2 block text-text-muted">
                        确定性旁白与人类 GM
                        始终可用；加入实验不会通过生产环境的真实样本门。
                      </span>
                    </div>
                  )}
                  {!gmCandidate ? (
                    <>
                      <textarea
                        value={gmObjective}
                        onChange={(event) => setGmObjective(event.target.value)}
                        rows={3}
                        className="mt-2 w-full rounded border border-border bg-bg-surface p-2 text-xs text-text-primary"
                        aria-label="AI GM 主持目标"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          disabled={
                            busy ||
                            safetyPaused ||
                            !aiGmDecision.enabled ||
                            !props.workspaceScope ||
                            !gmObjective.trim() ||
                            !isAIConfigReady(
                              resolveRequestConfig(aiConfig, {
                                category: "runtime.ttrpg-gm",
                              }).config,
                            )
                          }
                          onClick={() =>
                            void run(async () => {
                              if (!props.workspaceScope)
                                throw new Error(
                                  "正式 AI GM 缺少 WorkspaceScope。",
                                );
                              const generated =
                                await generateTtrpgGmNarrationCandidateV1({
                                  scope: props.workspaceScope,
                                  productRuntimeSessionId: props.session.id!,
                                  objective: gmObjective,
                                  aiConfig,
                                });
                              setGmCandidate(generated.candidate);
                            })
                          }
                          className="rounded bg-purple-600 px-3 py-1.5 text-xs text-white disabled:opacity-40"
                        >
                          生成受治理候选
                        </button>
                        <button
                          disabled={busy || safetyPaused}
                          onClick={() =>
                            void run(async () => {
                              const version = await readProductRuntimeStateVersion(
                                props.session.id!,
                              );
                              await commitTtrpgDeterministicFallbackV1({
                                sessionId: props.session.id!,
                                commandId: commandId(
                                  "gm-fallback",
                                  props.session.id!,
                                  version.sequence,
                                  String(latestAction.eventSequence),
                                ),
                                baseSequence: version.sequence,
                                baseStateHash: version.stateHash,
                                actionSequence: latestAction.eventSequence,
                              });
                            })
                          }
                          className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary disabled:opacity-40"
                        >
                          使用确定性旁白
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="mt-2 rounded border border-border bg-bg-surface p-3">
                      <p className="whitespace-pre-wrap leading-5 text-text-secondary">
                        {gmCandidate.narration}
                      </p>
                      <div className="mt-2 space-y-1 border-t border-border pt-2">
                        <p className="text-[10px] text-text-secondary">
                          <strong className="text-text-primary">
                            行动者：
                          </strong>
                          {gmCandidate.synthesisFrame.actorFeedback}
                        </p>
                        <p className="text-[10px] text-text-secondary">
                          <strong className="text-text-primary">场景：</strong>
                          {gmCandidate.synthesisFrame.sceneUpdate}
                        </p>
                        {gmCandidate.synthesisFrame.reactions.map(
                          (reaction) => (
                            <p
                              key={reaction.actorKey}
                              className="text-[10px] text-text-secondary"
                            >
                              <strong className="text-text-primary">
                                {props.state.entities[reaction.actorKey]
                                  ?.name ?? reaction.actorKey}
                                ：
                              </strong>
                              {reaction.text ?? "必须由真人本人回应"}
                            </p>
                          ),
                        )}
                      </div>
                      {gmCandidate.offeredClueKeys.length > 0 && (
                        <p className="mt-2 text-[10px] text-warning">
                          线索建议（不会自动公开）：
                          {gmCandidate.offeredClueKeys
                            .map(
                              (key) =>
                                campaign.clues.find(
                                  (item) => item.clueKey === key,
                                )?.title ?? key,
                            )
                            .join("、")}
                        </p>
                      )}
                      {gmCandidate.recommendedNextSceneKeys.length > 0 && (
                        <p className="mt-1 text-[10px] text-text-muted">
                          后继场景建议（不会自动推进）：
                          {gmCandidate.recommendedNextSceneKeys
                            .map(
                              (key) =>
                                campaign.scenes.find(
                                  (item) => item.sceneKey === key,
                                )?.title ?? key,
                            )
                            .join("、")}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          disabled={
                            busy || safetyPaused || !props.workspaceScope
                          }
                          onClick={() =>
                            void run(async () => {
                              if (!props.workspaceScope)
                                throw new Error(
                                  "正式 AI GM 缺少 WorkspaceScope。",
                                );
                              await adoptTtrpgGmNarrationCandidateV1({
                                scope: props.workspaceScope,
                                runId: gmCandidate.runId,
                              });
                              setGmCandidate(null);
                            })
                          }
                          className="rounded bg-success px-3 py-1.5 text-xs text-white disabled:opacity-40"
                        >
                          <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                          确认并写入叙事
                        </button>
                        <button
                          disabled={busy || !props.workspaceScope}
                          onClick={() =>
                            void run(async () => {
                              if (!props.workspaceScope)
                                throw new Error(
                                  "正式 AI GM 缺少 WorkspaceScope。",
                                );
                              await rejectTtrpgGmNarrationCandidateV1({
                                scope: props.workspaceScope,
                                runId: gmCandidate.runId,
                              });
                              setGmCandidate(null);
                            })
                          }
                          className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary disabled:opacity-40"
                        >
                          <X className="mr-1 inline h-3.5 w-3.5" />
                          拒绝
                        </button>
                      </div>
                      <div className="mt-2 font-mono text-[9px] text-text-muted">
                        Run #{gmCandidate.runId} · base #
                        {gmCandidate.baseSequence} · candidate{" "}
                        {gmCandidate.candidateHash.slice(0, 12)}
                        {gmCandidate.modelEvidence
                          ? ` · ${gmCandidate.modelCalls?.length ?? 1} call${gmCandidate.repairEvidence ? " · 已有限修复" : ""} · ${gmCandidate.modelEvidence.totalTokens} tokens · ${gmCandidate.modelEvidence.latencyMs} ms${gmCandidate.modelEvidence.estimatedCostUsd == null ? "" : ` · $${gmCandidate.modelEvidence.estimatedCostUsd.toFixed(6)}`}`
                          : ""}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section
              className="rounded border border-border bg-bg-base p-3"
              data-testid="ttrpg-inventory-ledger"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <ScrollText className="h-4 w-4 text-accent" />
                物品与装备
              </div>
              {mode === "gm" && (
                <div className="mt-3 grid gap-2 rounded border border-border bg-bg-surface p-2 sm:grid-cols-[1fr_1fr_auto]">
                  <label className="text-[10px] text-text-muted">
                    授予规则物品
                    <select
                      value={inventoryGrantItemKey}
                      onChange={(event) =>
                        setInventoryGrantItemKey(event.target.value)
                      }
                      className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                    >
                      <option value="">选择物品…</option>
                      {rulePack.items.map((item) => (
                        <option key={item.key} value={item.key}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[10px] text-text-muted">
                    持有者
                    <select
                      value={inventoryGrantOwnerKey}
                      onChange={(event) =>
                        setInventoryGrantOwnerKey(event.target.value)
                      }
                      className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                    >
                      <option value="">选择角色…</option>
                      {(props.state.ttrpg?.turnOrder ?? []).map((key) => (
                        <option key={key} value={key}>
                          {props.state.entities[key]?.name ?? key}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      safetyPaused ||
                      !inventoryGrantItemKey ||
                      !inventoryGrantOwnerKey
                    }
                    onClick={() =>
                      void commitInventoryCommand({
                        kind: "grant",
                        instanceKey: inventoryGrantItemKey,
                        build: (id, eventSequence) => ({
                          commandId: id,
                          kind: "grant",
                          instanceId: `item.manual.${eventSequence}.${inventoryGrantItemKey}`,
                          definitionRef: inventoryGrantItemKey,
                          ownerRef: inventoryGrantOwnerKey,
                          locationRef: null,
                          quantity: 1,
                          eventId: `event.${eventSequence}`,
                        }),
                      }).then(() => {
                        setInventoryGrantItemKey("");
                        setInventoryGrantOwnerKey("");
                      })
                    }
                    className="self-end rounded bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                  >
                    授予
                  </button>
                </div>
              )}
              <div className="mt-3 space-y-2">
                {(product.inventory
                  ? Object.values(product.inventory.items).filter(
                      (item) =>
                        mode === "gm" || item.ownerRef === clueRecipientKey,
                    )
                  : []
                ).map((item) => {
                  const definition = rulePack.items.find(
                    (row) => row.key === item.definitionRef,
                  );
                  const destinations =
                    props.state.ttrpg?.turnOrder.filter(
                      (key) => key !== item.ownerRef,
                    ) ?? [];
                  const canOperate =
                    mode === "gm" || item.ownerRef === clueRecipientKey;
                  const canConsume =
                    (item.charges != null && item.charges > 0) ||
                    (definition?.mechanics?.stackPolicy === "stackable" &&
                      item.quantity > 0);
                  const equipSlots = definition?.mechanics?.equipSlots ?? [];
                  const maximumDurability =
                    definition?.mechanics?.maximumDurability ?? null;
                  return (
                    <div
                      key={item.itemInstanceId}
                      className="rounded border border-border bg-bg-surface p-2 text-xs"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <strong className="text-text-primary">
                            {item.customName ??
                              definition?.name ??
                              item.definitionRef}
                          </strong>
                          <p className="mt-0.5 text-[10px] text-text-muted">
                            持有者：
                            {item.ownerRef
                              ? (props.state.entities[item.ownerRef]?.name ??
                                item.ownerRef)
                              : "场景/无主"}{" "}
                            · 数量 {item.quantity}
                            {item.charges == null
                              ? ""
                              : ` · 充能 ${item.charges}`}
                            {item.durability == null
                              ? ""
                              : ` · 耐久 ${item.durability}`}
                            {item.equippedSlots.length
                              ? ` · 装备 ${item.equippedSlots.join("、")}`
                              : ""}
                            {item.stateTags.length
                              ? ` · ${item.stateTags.join("、")}`
                              : ""}
                          </p>
                        </div>
                        {canOperate && item.ownerRef && (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {destinations.length > 0 && (
                              <select
                                aria-label={`转移${definition?.name ?? item.definitionRef}`}
                                defaultValue=""
                                disabled={busy || safetyPaused}
                                onChange={(event) => {
                                  const destinationOwnerRef =
                                    event.target.value;
                                  if (!destinationOwnerRef) return;
                                  void commitInventoryCommand({
                                    kind: "transfer",
                                    instanceKey: item.itemInstanceId,
                                    build: (id) => ({
                                      commandId: id,
                                      kind: "transfer",
                                      instanceId: item.itemInstanceId,
                                      expectedOwnerRef: item.ownerRef,
                                      destinationOwnerRef,
                                    }),
                                  });
                                }}
                                className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                              >
                                <option value="">转移给…</option>
                                {destinations.map((key) => (
                                  <option key={key} value={key}>
                                    {props.state.entities[key]?.name ?? key}
                                  </option>
                                ))}
                              </select>
                            )}
                            {canConsume && (
                              <button
                                type="button"
                                disabled={busy || safetyPaused}
                                onClick={() =>
                                  void commitInventoryCommand({
                                    kind: "use",
                                    instanceKey: item.itemInstanceId,
                                    build: (id) => ({
                                      commandId: id,
                                      kind: "use",
                                      instanceId: item.itemInstanceId,
                                      expectedOwnerRef: item.ownerRef,
                                      amount: 1,
                                    }),
                                  })
                                }
                                className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary disabled:opacity-40"
                              >
                                使用 1 次
                              </button>
                            )}
                            {equipSlots.length > 0 &&
                              item.equippedSlots.length === 0 && (
                                <button
                                  type="button"
                                  disabled={
                                    busy ||
                                    safetyPaused ||
                                    item.stateTags.includes("broken")
                                  }
                                  onClick={() =>
                                    void commitInventoryCommand({
                                      kind: "equip",
                                      instanceKey: item.itemInstanceId,
                                      build: (id) => ({
                                        commandId: id,
                                        kind: "equip",
                                        instanceId: item.itemInstanceId,
                                        expectedOwnerRef: item.ownerRef!,
                                        slots: equipSlots,
                                      }),
                                    })
                                  }
                                  className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary disabled:opacity-40"
                                >
                                  装备
                                </button>
                              )}
                            {item.equippedSlots.length > 0 && (
                              <button
                                type="button"
                                disabled={busy || safetyPaused}
                                onClick={() =>
                                  void commitInventoryCommand({
                                    kind: "unequip",
                                    instanceKey: item.itemInstanceId,
                                    build: (id) => ({
                                      commandId: id,
                                      kind: "unequip",
                                      instanceId: item.itemInstanceId,
                                      expectedOwnerRef: item.ownerRef!,
                                    }),
                                  })
                                }
                                className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary disabled:opacity-40"
                              >
                                卸下
                              </button>
                            )}
                            {definition?.mechanics?.requiresAttunement &&
                              item.attunedToActorRef !== item.ownerRef && (
                                <button
                                  type="button"
                                  disabled={busy || safetyPaused}
                                  onClick={() =>
                                    void commitInventoryCommand({
                                      kind: "attune",
                                      instanceKey: item.itemInstanceId,
                                      build: (id) => ({
                                        commandId: id,
                                        kind: "attune",
                                        instanceId: item.itemInstanceId,
                                        expectedOwnerRef: item.ownerRef!,
                                      }),
                                    })
                                  }
                                  className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary disabled:opacity-40"
                                >
                                  绑定
                                </button>
                              )}
                            {maximumDurability != null &&
                              item.durability != null &&
                              item.durability < maximumDurability && (
                                <button
                                  type="button"
                                  disabled={busy || safetyPaused}
                                  onClick={() =>
                                    void commitInventoryCommand({
                                      kind: "repair",
                                      instanceKey: item.itemInstanceId,
                                      build: (id) => ({
                                        commandId: id,
                                        kind: "repair",
                                        instanceId: item.itemInstanceId,
                                        amount: 1,
                                      }),
                                    })
                                  }
                                  className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary disabled:opacity-40"
                                >
                                  修理 +1
                                </button>
                              )}
                            {mode === "gm" &&
                              item.durability != null &&
                              item.durability > 0 && (
                                <button
                                  type="button"
                                  disabled={busy || safetyPaused}
                                  onClick={() =>
                                    void commitInventoryCommand({
                                      kind: "damage",
                                      instanceKey: item.itemInstanceId,
                                      build: (id) => ({
                                        commandId: id,
                                        kind: "damage",
                                        instanceId: item.itemInstanceId,
                                        amount: 1,
                                      }),
                                    })
                                  }
                                  className="rounded border border-warning/40 px-2 py-1 text-[10px] text-warning disabled:opacity-40"
                                >
                                  损坏 -1
                                </button>
                              )}
                            {mode === "gm" && (
                              <button
                                type="button"
                                disabled={busy || safetyPaused}
                                onClick={() =>
                                  void commitInventoryCommand({
                                    kind: "remove",
                                    instanceKey: item.itemInstanceId,
                                    build: (id) => ({
                                      commandId: id,
                                      kind: "remove",
                                      instanceId: item.itemInstanceId,
                                      expectedOwnerRef: item.ownerRef,
                                      quantity: item.quantity,
                                    }),
                                  })
                                }
                                className="rounded border border-danger/40 px-2 py-1 text-[10px] text-danger disabled:opacity-40"
                              >
                                移除
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {(!product.inventory ||
                  Object.values(product.inventory.items).filter(
                    (item) =>
                      mode === "gm" || item.ownerRef === clueRecipientKey,
                  ).length === 0) && (
                  <p className="text-xs text-text-muted">
                    当前视图没有可见物品。
                  </p>
                )}
              </div>
            </section>

            <section className="rounded border border-border bg-bg-base p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                {mode === "gm" ? (
                  <EyeOff className="h-4 w-4 text-accent" />
                ) : (
                  <Eye className="h-4 w-4 text-accent" />
                )}
                线索
              </div>
              <div className="mt-2 space-y-2">
                {(currentScene?.clueKeys ?? [])
                  .map((clueKey) =>
                    campaign.clues.find((item) => item.clueKey === clueKey),
                  )
                  .filter((clue): clue is NonNullable<typeof clue> => !!clue)
                  .map((clue) => {
                    const known = discovered.get(clue.clueKey);
                    const playerCanSee =
                      clue.visibility === "public" || !!known;
                    if (mode === "player" && !playerCanSee)
                      return (
                        <div
                          key={clue.clueKey}
                          className="rounded border border-dashed border-border p-2 text-xs text-text-muted"
                        >
                          尚未发现的线索
                        </div>
                      );
                    return (
                      <div
                        key={clue.clueKey}
                        className="rounded border border-border bg-bg-surface p-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <strong className="text-text-primary">
                            {clue.title}
                          </strong>
                          <span className="text-[10px] text-text-muted">
                            {known?.visibility ?? clue.visibility}
                          </span>
                        </div>
                        <p className="mt-1 text-text-secondary">
                          {clue.description}
                        </p>
                        {mode === "gm" && clue.visibility !== "gm-only" && (
                          <div className="mt-2 flex gap-2">
                            <button
                              disabled={busy || safetyPaused || !!known}
                              onClick={() =>
                                void run(async () => {
                                  const version =
                                    await readProductRuntimeStateVersion(
                                      props.session.id!,
                                    );
                                  await discoverTtrpgClue({
                                    sessionId: props.session.id!,
                                    commandId: commandId(
                                      "clue-private",
                                      props.session.id!,
                                      version.sequence,
                                      clue.clueKey,
                                    ),
                                    baseSequence: version.sequence,
                                    baseStateHash: version.stateHash,
                                    clueKey: clue.clueKey,
                                    actorKey: clueRecipientKey,
                                    visibility: "private",
                                  });
                                })
                              }
                              className="rounded border border-border px-2 py-1 text-[10px] disabled:opacity-40"
                            >
                              告知当前玩家
                            </button>
                            <button
                              disabled={
                                busy ||
                                safetyPaused ||
                                known?.visibility === "party"
                              }
                              onClick={() =>
                                void run(async () => {
                                  const version =
                                    await readProductRuntimeStateVersion(
                                      props.session.id!,
                                    );
                                  await discoverTtrpgClue({
                                    sessionId: props.session.id!,
                                    commandId: commandId(
                                      "clue-party",
                                      props.session.id!,
                                      version.sequence,
                                      clue.clueKey,
                                    ),
                                    baseSequence: version.sequence,
                                    baseStateHash: version.stateHash,
                                    clueKey: clue.clueKey,
                                    actorKey: clueRecipientKey,
                                    visibility: "party",
                                  });
                                })
                              }
                              className="rounded border border-border px-2 py-1 text-[10px] disabled:opacity-40"
                            >
                              向队伍公开
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                {!currentScene && (
                  <p className="text-xs text-text-muted">
                    打开场景后显示该场景的线索。
                  </p>
                )}
              </div>
            </section>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded border border-border bg-bg-base p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <ScrollText className="h-4 w-4 text-accent" />
              {mode === "gm" ? "讲义桌面" : "玩家讲义"}
            </div>
            <div className="mt-2 space-y-2">
              {campaign.handouts
                .filter((handout) =>
                  mode === "gm"
                    ? true
                    : viewerProjection?.visibleHandoutKeys.includes(
                        handout.handoutKey,
                      ) === true,
                )
                .map((handout) => (
                  <article
                    key={handout.handoutKey}
                    className="rounded border border-border bg-bg-surface p-2"
                  >
                    <strong className="text-xs text-text-primary">
                      {handout.title}
                    </strong>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-text-secondary">
                      {handout.body || handout.fallbackText}
                    </p>
                    {!handout.assetKey && (
                      <span className="mt-1 block text-[10px] text-text-muted">
                        文本备用版
                      </span>
                    )}
                  </article>
                ))}
            </div>
          </div>
          <div className="rounded border border-border bg-bg-base p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <BookOpenText className="h-4 w-4 text-accent" />
              规则速查
            </div>
            <div className="mt-2 space-y-2">
              {rulePack.compendium.map((entry) => (
                <details
                  key={entry.key}
                  className="rounded border border-border bg-bg-surface px-3 py-2 text-xs"
                >
                  <summary className="cursor-pointer font-medium text-text-primary">
                    {entry.title}
                  </summary>
                  <p className="mt-2 leading-5 text-text-secondary">
                    {entry.body}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {visibleContinuity && campaignState && (
          <section
            className="rounded border border-border bg-bg-base p-4"
            data-testid="ttrpg-long-campaign"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <GitBranch className="h-4 w-4 text-accent" />
                长期战役连续性
              </div>
              <span className="text-[10px] text-text-muted">
                已完成 {campaignState.playSessions.length} 场
                {activeCampaignSession
                  ? ` · 正在进行：${activeCampaignSession.title}`
                  : " · 当前为会间阶段"}
              </span>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              分场、编组、跨场记忆、次数重置、补充包和世界演化都写入同一事件流；世界演化批准只进入世界引擎复审，不会直接改写世界正典。
            </p>

            {mode === "gm" && (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {!activeCampaignSession ? (
                  <div className="rounded border border-border bg-bg-surface p-3">
                    <div className="text-xs font-medium text-text-primary">
                      开始第 {campaignState.playSessions.length + 1} 场
                    </div>
                    <input
                      value={campaignSessionTitle}
                      onChange={(event) =>
                        setCampaignSessionTitle(event.target.value)
                      }
                      placeholder={`第 ${campaignState.playSessions.length + 1} 场`}
                      aria-label="长期战役分场标题"
                      className="mt-2 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                    />
                    <div className="mt-2 text-[10px] text-text-muted">
                      活动角色：
                      {activeCampaignRoster
                        .map(
                          (entry) =>
                            props.state.entities[entry.characterKey]?.name ??
                            entry.characterKey,
                        )
                        .join("、") || "无"}
                    </div>
                    <button
                      disabled={
                        busy || safetyPaused || !activeCampaignRoster.length
                      }
                      onClick={() =>
                        void run(async () => {
                          const version = await readProductRuntimeStateVersion(
                            props.session.id!,
                          );
                          const ordinal = campaignState.playSessions.length + 1;
                          await startTtrpgCampaignSessionV2({
                            sessionId: props.session.id!,
                            commandId: commandId(
                              "campaign-session-start",
                              props.session.id!,
                              version.sequence,
                              String(ordinal),
                            ),
                            baseSequence: version.sequence,
                            baseStateHash: version.stateHash,
                            sessionKey: `session.${ordinal}`,
                            title:
                              campaignSessionTitle.trim() || `第 ${ordinal} 场`,
                            participantKeys: activeCampaignRoster.map(
                              (entry) => entry.characterKey,
                            ),
                            gmKey: "gm",
                          });
                          setCampaignSessionTitle("");
                        })
                      }
                      className="mt-2 rounded border border-accent/40 bg-accent/5 px-3 py-1.5 text-xs text-accent disabled:opacity-40"
                    >
                      宣布本场开始
                    </button>
                  </div>
                ) : (
                  <div className="rounded border border-border bg-bg-surface p-3">
                    <div className="text-xs font-medium text-text-primary">
                      完成本场并固化连续性
                    </div>
                    <textarea
                      value={campaignSessionSummary}
                      onChange={(event) =>
                        setCampaignSessionSummary(event.target.value)
                      }
                      placeholder="可选：补充主持人口吻、桌上笑点或事实账本以外的说明；事实对账会自动生成。"
                      aria-label="长期战役分场摘要"
                      className="mt-2 min-h-20 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                    />
                    <textarea
                      value={campaignMemorySummary}
                      onChange={(event) =>
                        setCampaignMemorySummary(event.target.value)
                      }
                      placeholder="可选：写入一条供后续 AI KP 和角色引用的跨场记忆。"
                      aria-label="长期战役跨场记忆"
                      className="mt-2 min-h-16 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                    />
                    <select
                      value={campaignMemoryAudience}
                      onChange={(event) =>
                        setCampaignMemoryAudience(
                          event.target.value as
                            "party" | "gm-only" | `actor:${string}`,
                        )
                      }
                      aria-label="长期战役记忆受众"
                      className="mt-2 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                    >
                      <option value="party">全队记忆</option>
                      <option value="gm-only">仅 KP</option>
                      {activeCampaignSession.participantKeys.map((key) => (
                        <option key={key} value={`actor:${key}`}>
                          仅角色：{props.state.entities[key]?.name ?? key}
                        </option>
                      ))}
                    </select>
                    <button
                      disabled={busy || safetyPaused || !viewerProjection}
                      onClick={() =>
                        void run(async () => {
                          const version = await readProductRuntimeStateVersion(
                            props.session.id!,
                          );
                          const automaticRecaps =
                            createTtrpgAutomaticSessionRecapsV2({
                              state: props.state,
                              campaign,
                              rulePack,
                              sessionKey: activeCampaignSession.sessionKey,
                              participantKeys:
                                activeCampaignSession.participantKeys,
                            });
                          const publicSummary = automaticRecaps.publicSummary;
                          const authorSupplement =
                            campaignSessionSummary.trim();
                          await completeTtrpgCampaignSessionV2({
                            sessionId: props.session.id!,
                            commandId: commandId(
                              "campaign-session-complete",
                              props.session.id!,
                              version.sequence,
                              activeCampaignSession.sessionKey,
                            ),
                            baseSequence: version.sequence,
                            baseStateHash: version.stateHash,
                            sessionKey: activeCampaignSession.sessionKey,
                            summary: authorSupplement
                              ? `${publicSummary}\n主持补充：${authorSupplement}`.slice(
                                  0,
                                  20_000,
                                )
                              : publicSummary,
                            memories: [
                              ...automaticRecaps.memories,
                              ...(campaignMemorySummary.trim()
                                ? [
                                    {
                                      memoryKey: `memory.${activeCampaignSession.sessionKey}.${version.sequence + 1}`,
                                      subjectKey:
                                        campaignMemoryAudience.startsWith(
                                          "actor:",
                                        )
                                          ? campaignMemoryAudience.slice(
                                              "actor:".length,
                                            )
                                          : product.campaignKey,
                                      summary: campaignMemorySummary.trim(),
                                      audience: campaignMemoryAudience,
                                    },
                                  ]
                                : []),
                            ],
                            gmKey: "gm",
                          });
                          setCampaignSessionSummary("");
                          setCampaignMemorySummary("");
                          setCampaignMemoryAudience("party");
                        })
                      }
                      className="mt-2 rounded border border-success/40 bg-success/5 px-3 py-1.5 text-xs text-success disabled:opacity-40"
                    >
                      自动对账并结束本场
                    </button>
                    <p className="mt-2 text-[10px] text-text-muted">
                      结束时自动冻结一份公开事实回顾、一份 KP
                      完整回顾，以及每个参与角色各自的信息隔离私人回顾；上方输入只作为主持补充。
                    </p>
                  </div>
                )}

                <div className="rounded border border-border bg-bg-surface p-3">
                  <div className="text-xs font-medium text-text-primary">
                    会间编组：补员、轮换、退役
                  </div>
                  <input
                    value={campaignRosterReason}
                    onChange={(event) =>
                      setCampaignRosterReason(event.target.value)
                    }
                    aria-label="长期战役编组变更理由"
                    className="mt-2 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                  />
                  <div className="mt-2 space-y-2">
                    {campaignState.roster.map((entry) => {
                      const activeCount = campaignState.roster.filter(
                        (item) => item.status === "active",
                      ).length;
                      const name =
                        props.state.entities[entry.characterKey]?.name ??
                        entry.characterKey;
                      const change = async (
                        status: "active" | "reserve" | "retired",
                      ) => {
                        const version = await readProductRuntimeStateVersion(
                          props.session.id!,
                        );
                        await changeTtrpgCampaignRosterV2({
                          sessionId: props.session.id!,
                          commandId: commandId(
                            "campaign-roster",
                            props.session.id!,
                            version.sequence,
                            `${entry.characterKey}.${status}`,
                          ),
                          baseSequence: version.sequence,
                          baseStateHash: version.stateHash,
                          characterKey: entry.characterKey,
                          status,
                          reason: campaignRosterReason.trim(),
                          gmKey: "gm",
                        });
                      };
                      return (
                        <div
                          key={entry.characterKey}
                          className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-2 py-1.5"
                        >
                          <span className="text-[10px] text-text-secondary">
                            {name} · {entry.status}
                          </span>
                          <div className="flex gap-1">
                            {entry.status === "reserve" && (
                              <button
                                disabled={
                                  busy ||
                                  safetyPaused ||
                                  !!activeCampaignSession ||
                                  !campaignRosterReason.trim()
                                }
                                onClick={() => void run(() => change("active"))}
                                className="rounded border border-border px-2 py-1 text-[10px] disabled:opacity-40"
                              >
                                加入
                              </button>
                            )}
                            {entry.status === "active" && (
                              <>
                                <button
                                  disabled={
                                    busy ||
                                    safetyPaused ||
                                    !!activeCampaignSession ||
                                    activeCount <= 1 ||
                                    !campaignRosterReason.trim()
                                  }
                                  onClick={() =>
                                    void run(() => change("reserve"))
                                  }
                                  className="rounded border border-border px-2 py-1 text-[10px] disabled:opacity-40"
                                >
                                  转后备
                                </button>
                                <button
                                  disabled={
                                    busy ||
                                    safetyPaused ||
                                    !!activeCampaignSession ||
                                    !lastCompletedCampaignSession ||
                                    activeCount <= 1 ||
                                    !campaignRosterReason.trim()
                                  }
                                  onClick={() =>
                                    void run(() => change("retired"))
                                  }
                                  className="rounded border border-warning/40 px-2 py-1 text-[10px] text-warning disabled:opacity-40"
                                >
                                  退役
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded border border-border bg-bg-surface p-3">
                  <div className="text-xs font-medium text-text-primary">
                    会间扩展与世界回流
                  </div>
                  <input
                    value={campaignSupplementTitle}
                    onChange={(event) =>
                      setCampaignSupplementTitle(event.target.value)
                    }
                    aria-label="长期战役补充包标题"
                    className="mt-2 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                  />
                  <input
                    value={campaignSupplementHash}
                    onChange={(event) =>
                      setCampaignSupplementHash(event.target.value)
                    }
                    placeholder={`内容 SHA-256（默认当前规则 ${product.rulePackContentHash.slice(0, 8)}…）`}
                    aria-label="长期战役补充包哈希"
                    className="mt-2 w-full rounded border border-border bg-bg-base px-2 py-1.5 font-mono text-[10px] text-text-primary"
                  />
                  <input
                    value={campaignSupplementSource}
                    onChange={(event) =>
                      setCampaignSupplementSource(event.target.value)
                    }
                    aria-label="长期战役补充包来源"
                    className="mt-2 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                  />
                  <button
                    disabled={
                      busy ||
                      safetyPaused ||
                      !!activeCampaignSession ||
                      !campaignSupplementTitle.trim() ||
                      !campaignSupplementSource.trim()
                    }
                    onClick={() =>
                      void run(async () => {
                        const version = await readProductRuntimeStateVersion(
                          props.session.id!,
                        );
                        await activateTtrpgCampaignSupplementV2({
                          sessionId: props.session.id!,
                          commandId: commandId(
                            "campaign-supplement",
                            props.session.id!,
                            version.sequence,
                          ),
                          baseSequence: version.sequence,
                          baseStateHash: version.stateHash,
                          supplementKey: `supplement.${version.sequence + 1}`,
                          title: campaignSupplementTitle.trim(),
                          contentHash:
                            campaignSupplementHash.trim() ||
                            product.rulePackContentHash,
                          compatibility: "same-release",
                          sourceRef: campaignSupplementSource.trim(),
                          gmKey: "gm",
                        });
                        setCampaignSupplementHash("");
                      })
                    }
                    className="mt-2 rounded border border-border px-3 py-1.5 text-[10px] text-text-secondary disabled:opacity-40"
                  >
                    激活并记录补充包收据
                  </button>

                  <textarea
                    value={campaignWorldSummary}
                    onChange={(event) =>
                      setCampaignWorldSummary(event.target.value)
                    }
                    placeholder="本场故事对世界产生了什么可持续变化？"
                    aria-label="长期战役世界演化摘要"
                    className="mt-3 min-h-16 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                  />
                  <select
                    value={campaignWorldCategory}
                    onChange={(event) =>
                      setCampaignWorldCategory(
                        event.target.value as typeof campaignWorldCategory,
                      )
                    }
                    aria-label="长期战役世界演化类别"
                    className="mt-2 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                  >
                    <option value="event">事件</option>
                    <option value="character">角色</option>
                    <option value="location">地点</option>
                    <option value="faction">势力</option>
                    <option value="artifact">物品</option>
                    <option value="lore">设定</option>
                  </select>
                  <button
                    disabled={
                      busy ||
                      safetyPaused ||
                      !!activeCampaignSession ||
                      !lastCompletedCampaignSession ||
                      !campaignWorldSummary.trim()
                    }
                    onClick={() =>
                      void run(async () => {
                        const version = await readProductRuntimeStateVersion(
                          props.session.id!,
                        );
                        await recordTtrpgWorldEvolutionV2({
                          sessionId: props.session.id!,
                          commandId: commandId(
                            "campaign-world-evolution",
                            props.session.id!,
                            version.sequence,
                          ),
                          baseSequence: version.sequence,
                          baseStateHash: version.stateHash,
                          candidateKey: `world-evolution.${version.sequence + 1}`,
                          category: campaignWorldCategory,
                          summary: campaignWorldSummary.trim(),
                          sourceSessionKey:
                            lastCompletedCampaignSession!.sessionKey,
                          status: "proposed",
                          gmKey: "gm",
                        });
                        setCampaignWorldSummary("");
                      })
                    }
                    className="mt-2 rounded border border-border px-3 py-1.5 text-[10px] text-text-secondary disabled:opacity-40"
                  >
                    提交世界引擎复审候选
                  </button>
                </div>

                <div className="rounded border border-border bg-bg-surface p-3 lg:col-span-2">
                  <div className="text-xs font-medium text-text-primary">
                    下一发布续团计划
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <input
                      value={campaignTransitionHash}
                      onChange={(event) =>
                        setCampaignTransitionHash(event.target.value)
                      }
                      placeholder="目标 RulePack SHA-256"
                      aria-label="长期战役目标规则哈希"
                      className="rounded border border-border bg-bg-base px-2 py-1.5 font-mono text-[10px] text-text-primary"
                    />
                    <input
                      value={campaignTransitionCampaignKey}
                      onChange={(event) =>
                        setCampaignTransitionCampaignKey(event.target.value)
                      }
                      placeholder="目标 CampaignPack key"
                      aria-label="长期战役目标战役 key"
                      className="rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                    />
                  </div>
                  <textarea
                    value={campaignTransitionNotes}
                    onChange={(event) =>
                      setCampaignTransitionNotes(event.target.value)
                    }
                    placeholder="说明兼容字段、需要人工复核的成长/物品/规则变化。"
                    aria-label="长期战役版本迁移说明"
                    className="mt-2 min-h-16 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                  />
                  <button
                    disabled={
                      busy ||
                      safetyPaused ||
                      !!activeCampaignSession ||
                      !campaignTransitionHash.trim() ||
                      !campaignTransitionCampaignKey.trim() ||
                      !campaignTransitionNotes.trim()
                    }
                    onClick={() =>
                      void run(async () => {
                        const version = await readProductRuntimeStateVersion(
                          props.session.id!,
                        );
                        await recordTtrpgVersionTransitionV2({
                          sessionId: props.session.id!,
                          commandId: commandId(
                            "campaign-version-plan",
                            props.session.id!,
                            version.sequence,
                          ),
                          baseSequence: version.sequence,
                          baseStateHash: version.stateHash,
                          transitionKey: `transition.${version.sequence + 1}`,
                          toRulePackContentHash: campaignTransitionHash.trim(),
                          toCampaignKey: campaignTransitionCampaignKey.trim(),
                          compatibility: "manual-migration",
                          status: "planned",
                          notes: campaignTransitionNotes.trim(),
                          gmKey: "gm",
                        });
                        setCampaignTransitionNotes("");
                      })
                    }
                    className="mt-2 rounded border border-border px-3 py-1.5 text-[10px] text-text-secondary disabled:opacity-40"
                  >
                    冻结续团迁移计划
                  </button>
                  <p className="mt-2 text-[10px] text-text-muted">
                    这里只计划迁移；不同规则/战役发布不能热替换当前
                    Instance，必须创建新的跨发布续团并携带兼容性收据。
                  </p>
                  <div className="mt-3 border-t border-border pt-3">
                    <div className="text-[10px] font-medium text-text-primary">
                      从已发布版本创建真正的续团 Instance
                    </div>
                    <select
                      value={continuationTargetReleaseId}
                      onChange={(event) => {
                        setContinuationTargetReleaseId(event.target.value);
                        setContinuationPlan(null);
                        setCreatedContinuationSessionId(null);
                      }}
                      aria-label="跨发布续团目标版本"
                      className="mt-2 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                    >
                      {continuationReleases.map((release) => (
                        <option key={release.id} value={release.id}>
                          v{release.version} · {release.label}
                          {release.id === props.session.productReleaseId
                            ? "（同内容安全续团）"
                            : ""}
                        </option>
                      ))}
                    </select>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        disabled={
                          busy ||
                          !!activeCampaignSession ||
                          !continuationTargetReleaseId ||
                          props.session.worldId == null ||
                          props.session.workId == null
                        }
                        onClick={() =>
                          void run(
                            async () => {
                              const targetRelease = continuationReleases.find(
                                (release) =>
                                  String(release.id) ===
                                  continuationTargetReleaseId,
                              );
                              if (!targetRelease)
                                throw new Error("目标 TTRPG 发布不存在。");
                              const targetManifest =
                                await verifyProductReleaseManifestV1(
                                  targetRelease.manifestJson,
                                );
                              const targetTtrpg =
                                targetManifest.runtimePackage.ttrpg;
                              if (!targetTtrpg)
                                throw new Error("目标发布缺少 TTRPG 内容。");
                              const targetRule = parseRulePackV1(
                                targetTtrpg.rulePack.content,
                              );
                              const targetCampaign =
                                parseTtrpgCampaignContentV1(
                                  targetTtrpg.campaign,
                                  targetRule,
                                );
                              const sameContent =
                                targetTtrpg.rulePack.contentHash ===
                                  product.rulePackContentHash &&
                                targetCampaign.campaignKey ===
                                  product.campaignKey;
                              const plan = await previewTtrpgContinuationV2({
                                scope: props.workspaceScope ?? {
                                  projectId: props.session.projectId,
                                  worldId: props.session.worldId!,
                                  workId: props.session.workId!,
                                },
                                parentSessionId: props.session.id!,
                                targetProductReleaseId: targetRelease.id!,
                                compatibility: sameContent
                                  ? "same-content"
                                  : "manual-migration",
                                transitionKey: `transition.release.${targetRelease.id}.${props.state.lastSequence}`,
                                approvedBy: "gm",
                              });
                              setContinuationPlan(plan);
                              setCreatedContinuationSessionId(null);
                            },
                            { refresh: false },
                          )
                        }
                        className="rounded border border-border px-3 py-1.5 text-[10px] text-text-secondary disabled:opacity-40"
                      >
                        预览兼容迁移
                      </button>
                      <button
                        disabled={
                          busy ||
                          !continuationPlan ||
                          props.session.worldId == null ||
                          props.session.workId == null
                        }
                        onClick={() =>
                          void run(async () => {
                            if (!continuationPlan)
                              throw new Error("请先预览并确认迁移计划。");
                            const child =
                              await createTtrpgContinuationFromPlanV2({
                                scope: props.workspaceScope ?? {
                                  projectId: props.session.projectId,
                                  worldId: props.session.worldId!,
                                  workId: props.session.workId!,
                                },
                                plan: continuationPlan,
                                title: `${product.campaignTitle} · 续团`,
                              });
                            setCreatedContinuationSessionId(child.id!);
                          })
                        }
                        className="rounded border border-success/40 bg-success/5 px-3 py-1.5 text-[10px] text-success disabled:opacity-40"
                      >
                        确认并创建独立续团
                      </button>
                    </div>
                    {continuationPlan && (
                      <div className="mt-2 rounded border border-border bg-bg-base p-2 text-[10px] text-text-secondary">
                        <div className="font-mono text-text-muted">
                          plan {continuationPlan.planHash.slice(0, 16)}… ·{" "}
                          {continuationPlan.compatibility}
                        </div>
                        <div className="mt-1">
                          继承：{continuationPlan.carried.join("；")}
                        </div>
                        <div className="mt-1">
                          重置：{continuationPlan.reset.join("；")}
                        </div>
                        {continuationPlan.warnings.map((warning) => (
                          <div key={warning} className="mt-1 text-warning">
                            {warning}
                          </div>
                        ))}
                      </div>
                    )}
                    {createdContinuationSessionId != null && (
                      <p className="mt-2 text-[10px] text-success">
                        已创建续团 Instance #{createdContinuationSessionId}
                        ；旧战役未改动，新战役必须重新完成 Session Zero。
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-text-primary">
                  分场与公开回顾
                </div>
                <div className="mt-2 max-h-64 space-y-2 overflow-auto">
                  {visibleContinuity.playSessions.map((session) => (
                    <article
                      key={session.sessionKey}
                      className="rounded border border-border bg-bg-surface p-2 text-[10px]"
                    >
                      <div className="flex justify-between gap-2 text-text-primary">
                        <strong>
                          #{session.ordinal} {session.title}
                        </strong>
                        <span>{session.status}</span>
                      </div>
                      {session.summary && (
                        <p className="mt-1 whitespace-pre-wrap text-text-secondary">
                          {session.summary}
                        </p>
                      )}
                    </article>
                  ))}
                  {!visibleContinuity.playSessions.length && (
                    <p className="text-xs text-text-muted">尚未开始第一场。</p>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-text-primary">
                  当前可见跨场记忆
                </div>
                <div className="mt-2 max-h-64 space-y-2 overflow-auto">
                  {visibleContinuity.memories.slice(-30).map((memory) => (
                    <article
                      key={memory.memoryKey}
                      className="rounded border border-border bg-bg-surface p-2 text-[10px]"
                    >
                      <div className="text-text-muted">
                        {memory.sourceSessionKey} · {memory.audience}
                      </div>
                      <p className="mt-1 text-text-secondary">
                        {memory.summary}
                      </p>
                    </article>
                  ))}
                  {!visibleContinuity.memories.length && (
                    <p className="text-xs text-text-muted">尚无可见记忆。</p>
                  )}
                </div>
              </div>
            </div>

            {mode === "gm" && campaignState.worldEvolution.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="text-xs font-medium text-text-primary">
                  世界演化复审队列
                </div>
                {campaignState.worldEvolution.map((candidate) => (
                  <article
                    key={candidate.candidateKey}
                    className="rounded border border-border bg-bg-surface p-2 text-[10px]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-text-secondary">
                        {candidate.category} · {candidate.status} ·{" "}
                        {candidate.summary}
                      </span>
                      {candidate.status === "proposed" && (
                        <div className="flex gap-1">
                          {(
                            [
                              ["approved-for-world-review", "批准复审"],
                              ["rejected", "拒绝"],
                            ] as const
                          ).map(([status, label]) => (
                            <button
                              key={status}
                              disabled={busy || !!activeCampaignSession}
                              onClick={() =>
                                void run(async () => {
                                  const version =
                                    await readProductRuntimeStateVersion(
                                      props.session.id!,
                                    );
                                  await recordTtrpgWorldEvolutionV2({
                                    sessionId: props.session.id!,
                                    commandId: commandId(
                                      "campaign-world-review",
                                      props.session.id!,
                                      version.sequence,
                                      `${candidate.candidateKey}.${status}`,
                                    ),
                                    baseSequence: version.sequence,
                                    baseStateHash: version.stateHash,
                                    candidateKey: candidate.candidateKey,
                                    category: candidate.category,
                                    summary: candidate.summary,
                                    sourceSessionKey:
                                      candidate.sourceSessionKey,
                                    status,
                                    targetWorldRef: candidate.targetWorldRef,
                                    gmKey: "gm",
                                  });
                                })
                              }
                              className="rounded border border-border px-2 py-1 disabled:opacity-40"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        <section
          className="rounded border border-border bg-bg-base p-4"
          data-testid="ttrpg-campaign-progress"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <CheckCircle2 className="h-4 w-4 text-accent" />
            主线、成长与结局
          </div>
          {(viewerProjection?.clocks.length ?? 0) > 0 && (
            <div
              className="mt-3 grid gap-2 md:grid-cols-2"
              data-testid="ttrpg-campaign-clocks"
            >
              {viewerProjection!.clocks.map((clock) => (
                <article
                  key={clock.clockKey}
                  className="rounded border border-border bg-bg-surface p-3"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <strong className="text-text-primary">{clock.title}</strong>
                    <span
                      className={
                        clock.completed ? "text-error" : "text-warning"
                      }
                    >
                      {clock.current}/{clock.maximum}
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded bg-bg-base">
                    <div
                      className="h-full bg-accent"
                      style={{
                        width: `${Math.min(100, (clock.current / clock.maximum) * 100)}%`,
                      }}
                    />
                  </div>
                  {clock.onComplete && (
                    <p className="mt-2 text-[10px] text-text-muted">
                      {clock.onComplete}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {campaign.quests.map((quest) => {
              const progress = product.questProgress.find(
                (item) => item.questKey === quest.questKey,
              );
              const knownConclusions = new Set(
                mode === "player"
                  ? (viewerProjection?.visibleConclusionKeys ?? [])
                  : visibleDiscovered
                      .map(
                        (item) =>
                          product.clueCatalog.find(
                            (clue) => clue.clueKey === item.clueKey,
                          )?.conclusionKey,
                      )
                      .filter((item): item is string => !!item),
              );
              const visibleCompleted = quest.requiredConclusionKeys.every(
                (key) => knownConclusions.has(key),
              );
              const completed =
                mode === "gm"
                  ? progress?.status === "completed"
                  : visibleCompleted;
              return (
                <article
                  key={quest.questKey}
                  className="rounded border border-border bg-bg-surface p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-xs text-text-primary">
                      {quest.title}
                    </strong>
                    <span
                      className={`text-[10px] ${completed ? "text-success" : "text-warning"}`}
                    >
                      {completed ? "已完成" : "进行中"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {quest.objective}
                  </p>
                  <div className="mt-2 text-[10px] text-text-secondary">
                    结论：
                    {quest.requiredConclusionKeys
                      .map((key) => {
                        const known = knownConclusions.has(key);
                        const title =
                          campaign.clues.find(
                            (clue) => clue.conclusionKey === key,
                          )?.title ?? "已确认结论";
                        return `${known ? "✓" : "○"} ${known || mode === "gm" ? title : "未发现结论"}`;
                      })
                      .join(" · ")}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="mt-3 text-xs text-text-secondary">
            成长：{product.advancement.currencyName}{" "}
            {product.advancement.totalAwarded}
            {product.advancement.awardedMilestoneKeys.length > 0
              ? ` · ${product.advancement.awardedMilestoneKeys.join("、")}`
              : " · 尚未结算里程碑"}
          </div>
          {(viewerProjection?.effectReceipts.length ?? 0) > 0 && (
            <div className="mt-3 space-y-2" data-testid="ttrpg-effect-receipts">
              <div className="text-xs font-medium text-text-primary">
                奖励、惩罚与事实收据
              </div>
              {viewerProjection!.effectReceipts.map((receipt) => (
                <article
                  key={`${receipt.eventSequence}:${receipt.planKey}`}
                  className="rounded border border-border bg-bg-surface p-2 text-[10px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-text-primary">
                      {receipt.reason}
                    </strong>
                    <span className="text-text-muted">
                      #{receipt.eventSequence} ·{" "}
                      {OUTCOME_LABELS[receipt.degree] ?? receipt.degree}
                    </span>
                  </div>
                  <p className="mt-1 text-text-secondary">
                    {receipt.transitions
                      .map(
                        (transition) =>
                          `${transition.operation} → ${props.state.entities[transition.targetRef]?.name ?? transition.targetRef}`,
                      )
                      .join(" · ")}
                  </p>
                </article>
              ))}
            </div>
          )}
          {chosenEnding ? (
            <div className="mt-3 rounded border border-success/30 bg-success/5 p-4">
              <div className="font-semibold text-text-primary">
                {chosenEnding.title}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-text-secondary">
                {chosenEnding.epilogue}
              </p>
              <div className="mt-2 text-[10px] text-success">
                战役已完成，结局、成长和回放已由同一事件冻结。
              </div>
            </div>
          ) : (
            currentScene?.nextSceneKeys.length === 0 && (
              <div className="mt-3">
                <p className="text-xs text-text-muted">
                  {allQuestsCompleted
                    ? "终局条件正在依据当前场景与已发现结论计算，由 GM 选择可用结局。"
                    : "终局场景已开启；可用结局由机器化触发条件计算，失败前进路径仍可补齐线索。"}
                </p>
                {mode === "gm" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {campaign.endings.map((ending) => (
                      <button
                        key={ending.endingKey}
                        disabled={
                          busy ||
                          safetyPaused ||
                          !enabledEndingKeys.has(ending.endingKey)
                        }
                        onClick={() =>
                          void run(async () => {
                            const version = await readProductRuntimeStateVersion(
                              props.session.id!,
                            );
                            await completeTtrpgCampaignEnding({
                              sessionId: props.session.id!,
                              commandId: commandId(
                                "ending",
                                props.session.id!,
                                version.sequence,
                                ending.endingKey,
                              ),
                              baseSequence: version.sequence,
                              baseStateHash: version.stateHash,
                              endingKey: ending.endingKey,
                              completedBy: "gm",
                            });
                          })
                        }
                        className="rounded border border-accent/40 bg-accent/5 px-3 py-2 text-xs text-accent disabled:opacity-40"
                      >
                        选择：{ending.title}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          )}
        </section>

        {viewerProjection &&
          (viewerProjection.recap.resolvedActionCount > 0 ||
            viewerProjection.recap.ending) && (
            <section
              className="rounded border border-border bg-bg-base p-4"
              data-testid="ttrpg-session-recap"
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <ScrollText className="h-4 w-4 text-accent" />
                会后记录
              </div>
              <div className="mt-3 grid gap-3 text-xs text-text-secondary md:grid-cols-3">
                <div className="rounded bg-bg-surface p-3">
                  <div className="text-[10px] text-text-muted">已历场景</div>
                  <div className="mt-1">
                    {viewerProjection.recap.openedSceneTitles.join("、") ||
                      "尚未开始"}
                  </div>
                </div>
                <div className="rounded bg-bg-surface p-3">
                  <div className="text-[10px] text-text-muted">可见线索</div>
                  <div className="mt-1">
                    {viewerProjection.recap.visibleClueTitles.join("、") ||
                      "尚无"}
                  </div>
                </div>
                <div className="rounded bg-bg-surface p-3">
                  <div className="text-[10px] text-text-muted">
                    规则行动 / 成长
                  </div>
                  <div className="mt-1">
                    {viewerProjection.recap.resolvedActionCount} 次 /{" "}
                    {viewerProjection.recap.advancementAwarded} 点
                  </div>
                </div>
              </div>
              <div className="mt-3 rounded border border-border bg-bg-surface p-3 text-[10px] text-text-muted">
                <strong className="text-xs text-text-primary">
                  本场事实对账 · {viewerProjection.recap.scope.title}
                </strong>
                <span className="ml-2">
                  {viewerProjection.recap.viewerKind === "gm-complete"
                    ? "KP 完整账"
                    : viewerProjection.recap.viewerKind === "character-private"
                      ? "本角色私人账"
                      : "公开观战账"}
                </span>
                <span className="ml-2">
                  事件 {viewerProjection.recap.scope.fromSequence}–
                  {viewerProjection.recap.scope.toSequence}
                </span>
                <p className="mt-1">
                  本场新发现：
                  {viewerProjection.recap.discoveredThisSessionTitles.join(
                    "、",
                  ) || "无"}{" "}
                  · 未解必需线索：
                  {viewerProjection.recap.unresolvedRequiredClues.visibleTitles.join(
                    "、",
                  ) ||
                    `${viewerProjection.recap.unresolvedRequiredClues.hiddenCount} 条未公开`}
                </p>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <article className="rounded border border-border bg-bg-surface p-3 text-[10px] text-text-secondary">
                  <strong className="text-xs text-text-primary">
                    资源、状态与能力次数
                  </strong>
                  <div className="mt-2 max-h-48 space-y-1 overflow-auto">
                    {viewerProjection.recap.resourceChanges.map((change) => (
                      <p
                        key={`resource.${change.eventSequence}.${change.actorKey}.${change.resourceKey}`}
                      >
                        #{change.eventSequence} {change.actorName} ·{" "}
                        {change.resourceName} {change.before} → {change.after}（
                        {change.delta >= 0 ? "+" : ""}
                        {change.delta}）
                      </p>
                    ))}
                    {viewerProjection.recap.conditionChanges.map((change) => (
                      <p
                        key={`condition.${change.eventSequence}.${change.actorKey}.${change.conditionKey}`}
                      >
                        #{change.eventSequence} {change.actorName} ·{" "}
                        {change.conditionName} ×{change.stacks}
                        {change.duration == null
                          ? ""
                          : ` · 剩余 ${change.duration}`}
                      </p>
                    ))}
                    {viewerProjection.recap.abilityChanges.map((change) => (
                      <p
                        key={`ability.${change.eventSequence}.${change.actorKey}.${change.abilityKey}.${change.reason}`}
                      >
                        #{change.eventSequence} {change.actorName} ·{" "}
                        {change.abilityName} · {change.reason} · 次数{" "}
                        {change.usesBefore ?? "∞"} → {change.usesAfter ?? "∞"}
                      </p>
                    ))}
                    {!viewerProjection.recap.resourceChanges.length &&
                      !viewerProjection.recap.conditionChanges.length &&
                      !viewerProjection.recap.abilityChanges.length && (
                        <p className="text-text-muted">本场没有可见变化。</p>
                      )}
                  </div>
                </article>
                <article className="rounded border border-border bg-bg-surface p-3 text-[10px] text-text-secondary">
                  <strong className="text-xs text-text-primary">
                    物品取得、使用与转移
                  </strong>
                  <div className="mt-2 max-h-48 space-y-1 overflow-auto">
                    {viewerProjection.recap.itemChanges.map((change) => (
                      <p
                        key={`item.${change.eventSequence}.${change.itemInstanceId}.${change.source}`}
                      >
                        #{change.eventSequence} {change.title} ·{" "}
                        {change.operation} ·{" "}
                        {change.ownerBefore
                          ? (props.state.entities[change.ownerBefore]?.name ??
                            change.ownerBefore)
                          : "无主"}{" "}
                        →{" "}
                        {change.ownerAfter
                          ? (props.state.entities[change.ownerAfter]?.name ??
                            change.ownerAfter)
                          : "移除"}
                        {change.chargesBefore !== change.chargesAfter
                          ? ` · 充能 ${change.chargesBefore ?? "—"} → ${change.chargesAfter ?? "—"}`
                          : ""}
                        {change.durabilityBefore !== change.durabilityAfter
                          ? ` · 耐久 ${change.durabilityBefore ?? "—"} → ${change.durabilityAfter ?? "—"}`
                          : ""}
                      </p>
                    ))}
                    {!viewerProjection.recap.itemChanges.length && (
                      <p className="text-text-muted">本场没有可见物品变化。</p>
                    )}
                  </div>
                </article>
                <article className="rounded border border-border bg-bg-surface p-3 text-[10px] text-text-secondary lg:col-span-2">
                  <strong className="text-xs text-text-primary">
                    奖励、惩罚、关系与剧情账本
                  </strong>
                  <div className="mt-2 max-h-48 space-y-1 overflow-auto">
                    {viewerProjection.recap.ledgerChanges
                      .filter(
                        (change) =>
                          !["item", "ability", "numeric", "condition"].includes(
                            change.family,
                          ),
                      )
                      .map((change) => (
                        <p
                          key={`ledger.${change.eventSequence}.${change.family}.${change.operation}.${change.targetRef}`}
                        >
                          #{change.eventSequence} {change.family}/
                          {change.operation} ·{" "}
                          {props.state.entities[change.targetRef]?.name ??
                            change.targetRef}{" "}
                          · {change.before} → {change.after} · {change.reason}
                        </p>
                      ))}
                    {!viewerProjection.recap.ledgerChanges.some(
                      (change) =>
                        !["item", "ability", "numeric", "condition"].includes(
                          change.family,
                        ),
                    ) && (
                      <p className="text-text-muted">
                        本场没有可见奖励、关系或剧情账本变化。
                      </p>
                    )}
                  </div>
                  <p className="mt-2 text-text-muted">
                    待处理：
                    {[
                      ...viewerProjection.recap.outstanding.exhaustedAbilityNames.map(
                        (name) => `能力 ${name}`,
                      ),
                      ...viewerProjection.recap.outstanding
                        .activeConditionNames,
                      ...viewerProjection.recap.outstanding.activeQuestTitles.map(
                        (name) => `任务 ${name}`,
                      ),
                      ...viewerProjection.recap.outstanding.incompleteClockTitles.map(
                        (name) => `Clock ${name}`,
                      ),
                    ].join("、") || "无"}
                  </p>
                </article>
              </div>
              {viewerProjection.recap.ending && (
                <div className="mt-3 rounded border border-success/30 bg-success/5 p-3">
                  <strong className="text-xs text-text-primary">
                    {viewerProjection.recap.ending.title}
                  </strong>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-text-secondary">
                    {viewerProjection.recap.ending.epilogue}
                  </p>
                </div>
              )}
              <p className="mt-3 text-xs text-text-muted">
                {viewerProjection.recap.nextPreparation}
              </p>
            </section>
          )}

        {mode === "gm" && (
          <section
            className="rounded border border-border bg-bg-base p-4"
            data-testid="ttrpg-save-and-branch"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Save className="h-4 w-4 text-accent" />
              存档与平行分支
            </div>
            <p className="mt-1 text-xs text-text-muted">
              检查点保存当前事件序列；恢复不会覆盖原战役，而会建立可审计的新分支。
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="flex gap-2">
                <input
                  value={checkpointName}
                  onChange={(event) => setCheckpointName(event.target.value)}
                  aria-label="正式战役检查点名称"
                  className="min-w-0 flex-1 rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary"
                />
                <button
                  disabled={busy || !checkpointName.trim()}
                  onClick={() =>
                    void run(async () => {
                      await props.onCheckpoint(checkpointName.trim());
                      setCheckpointName("场景检查点");
                    })
                  }
                  className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary disabled:opacity-40"
                >
                  <Save className="mr-1 inline h-3.5 w-3.5" />
                  保存
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  value={branchTitle}
                  onChange={(event) => setBranchTitle(event.target.value)}
                  aria-label="正式战役分支名称"
                  className="min-w-0 flex-1 rounded border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary"
                />
                <button
                  disabled={busy || !branchTitle.trim()}
                  onClick={() =>
                    void run(
                      async () => {
                        await props.onBranch(branchTitle.trim());
                        setBranchTitle("新的战役分支");
                      },
                      { refresh: false },
                    )
                  }
                  className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary disabled:opacity-40"
                >
                  <GitBranch className="mr-1 inline h-3.5 w-3.5" />
                  分支
                </button>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {props.checkpoints.map((checkpoint) => (
                <div
                  key={checkpoint.id}
                  className="flex items-center gap-2 rounded border border-border bg-bg-surface px-3 py-2 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate text-text-secondary">
                    {checkpoint.name}
                  </span>
                  <span className="font-mono text-[10px] text-text-muted">
                    #{checkpoint.throughSequence}
                  </span>
                  <button
                    disabled={busy || checkpoint.id == null}
                    onClick={() =>
                      void run(
                        () => props.onRestoreCheckpoint(checkpoint.id!),
                        { refresh: false },
                      )
                    }
                    className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-accent disabled:opacity-40"
                    aria-label={`从检查点 ${checkpoint.name} 建立恢复分支`}
                    title="从检查点建立恢复分支"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {props.checkpoints.length === 0 && (
                <p className="text-xs text-text-muted">尚未保存检查点。</p>
              )}
            </div>
          </section>
        )}

        {error && (
          <p
            role="alert"
            aria-live="assertive"
            className="rounded border border-danger/30 bg-danger/10 p-3 text-xs text-danger"
          >
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
