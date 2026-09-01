import Dexie from "dexie";
import { db } from "../db/schema";
import { importProductMediaAssetV1 } from "../game-production/media-asset-library";
import { readProductMediaBlobData } from "../game-production/media-blob-store";
import { hashGameProductionValueV2 } from "../game-production/hash";
import {
  detectGameImageDimensionsV1,
  resolveGameMediaProviderAdapterV1,
  type GameMediaProviderAdapterV1,
  type GameMediaRequestV1,
  type MediaProviderTransportV1,
} from "../game-production/media-adapters";
import { verifyPlayableGamePackageSource } from "../game-production/preview-source";
import {
  configuredMediaRelayUrlV1,
  inspectConfiguredAgnesImageCapabilityV1,
  resolveConfiguredAgnesImageCapabilityV1,
  resolveTrustedRelayMediaCapabilityV1,
  type ResolvedGameMediaCapabilityV1,
} from "../game-production/media-transport";
import type {
  SimulationEvent,
  SimulationSession,
  TtrpgMediaManifestV1,
  TtrpgRuntimeAssetRequestRecordV1,
  TtrpgSessionParticipantRecordV2,
  TtrpgVisualBibleV1,
  WorkspaceScope,
} from "../types";
import {
  assertRecordInScope,
  resolveScope,
  scopeTransactionTables,
} from "../world-engine/scope";
import {
  applySimulationEvent,
  parseSimulationState,
  replaySimulationEvents,
} from "../simulation/runtime";
import { parseTtrpgCampaignContentV1 } from "./campaign";
import {
  avgMediaKindForTtrpgRuntimeV1,
  parseTtrpgMediaManifestV1,
  parseTtrpgVisualBibleV1,
} from "./media-contract";
import { parseRulePackV1 } from "./rule-pack";

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const REQUEST_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,149}$/;
const HASH = /^[a-f0-9]{64}$/;
const LEASE_MS = 5 * 60 * 1_000;

function fail(message: string): never {
  throw new Error(`[ttrpg-runtime-media] ${message}`);
}
function key(value: string, label: string): string {
  const result = value.trim();
  if (!KEY.test(result)) fail(`${label} 无效`);
  return result;
}
function requestKeyValue(value: string): string {
  const result = value.trim();
  if (!REQUEST_KEY.test(result)) fail("requestKey 无效或超过 150 个字符");
  return result;
}
function boundedText(
  value: string | undefined,
  label: string,
  maximum: number,
  allowEmpty = false,
): string {
  const result = (value ?? "").trim().normalize("NFC");
  if ((!allowEmpty && !result) || result.length > maximum)
    fail(`${label} 为空或过长`);
  return result;
}

interface RuntimeMediaContextV1 {
  session: SimulationSession;
  scope: WorkspaceScope;
  visualBible: TtrpgVisualBibleV1;
  manifest: TtrpgMediaManifestV1;
  runtimeSourceHash: string;
}

async function loadContext(sessionId: number): Promise<RuntimeMediaContextV1> {
  const session = await db.simulationSessions.get(sessionId);
  if (
    !session ||
    session.kind !== "ttrpg" ||
    session.status !== "active" ||
    session.id == null ||
    session.worldId == null ||
    session.workId == null ||
    !session.runtimeSourceHash
  )
    fail("active TTRPG Instance 不存在");
  const scope = await resolveScope({
    scope: {
      projectId: session.projectId,
      worldId: session.worldId,
      workId: session.workId,
    },
  });
  let resolvedSource:
    | { kind: "release"; gameReleaseId: number }
    | { kind: "build"; gameBuildId: number; expectedPreviewHash: string }
    | null = null;
  if (session.gameReleaseId != null) {
    resolvedSource = { kind: "release", gameReleaseId: session.gameReleaseId };
  } else if (session.gameBuildId != null) {
    const build = await db.gameBuilds.get(session.gameBuildId);
    if (!build?.previewHash || build.id == null)
      fail("TTRPG Build Preview 不存在");
    resolvedSource = {
      kind: "build",
      gameBuildId: build.id,
      expectedPreviewHash: build.previewHash,
    };
  }
  if (!resolvedSource) fail("TTRPG Instance 没有冻结 Release/Build");
  const verified = await verifyPlayableGamePackageSource({
    scope,
    source: resolvedSource,
  });
  if (
    verified.runtimeSourceHash !== session.runtimeSourceHash ||
    verified.runtimePackage.productType !== "ttrpg" ||
    !verified.runtimePackage.ttrpg
  )
    fail("Instance 与冻结 TTRPG RuntimePackage 不一致");
  const rulePack = parseRulePackV1(
    verified.runtimePackage.ttrpg.rulePack.content,
  );
  const campaign = parseTtrpgCampaignContentV1(
    verified.runtimePackage.ttrpg.campaign,
    rulePack,
  );
  if (!campaign.visualBible || !campaign.mediaManifest)
    fail("旧 CampaignPack 没有运行时媒资合同");
  return {
    session,
    scope,
    visualBible: parseTtrpgVisualBibleV1(campaign.visualBible),
    manifest: parseTtrpgMediaManifestV1(campaign.mediaManifest),
    runtimeSourceHash: verified.runtimeSourceHash,
  };
}

function canSeeAudience(input: {
  participant: TtrpgSessionParticipantRecordV2;
  audience: TtrpgRuntimeAssetRequestRecordV1["audience"];
  targetRef: string;
}): boolean {
  if (input.participant.role === "gm") return true;
  if (input.audience === "gm-only") return false;
  if (input.participant.role === "spectator")
    return input.audience === "public";
  if (input.audience === "private")
    return input.participant.actorKey === input.targetRef;
  return true;
}

function assertRequester(input: {
  participant: TtrpgSessionParticipantRecordV2 | undefined;
  slot: TtrpgMediaManifestV1["slots"][number];
  participants: TtrpgSessionParticipantRecordV2[];
}): TtrpgSessionParticipantRecordV2 {
  const participant = input.participant;
  if (
    !participant ||
    participant.assignmentState === "left" ||
    participant.controller === "vacant" ||
    participant.role === "spectator" ||
    !canSeeAudience({
      participant,
      audience: input.slot.audience,
      targetRef: input.slot.targetRef,
    })
  ) {
    fail("viewer 没有请求该媒资槽的权限");
  }
  if (
    ["character-portrait", "character-expression", "token"].includes(
      input.slot.kind,
    )
  ) {
    const subject = input.participants.find(
      (row) => row.actorKey === input.slot.targetRef,
    );
    if (subject && !subject.consent.generatedPortraitAllowed)
      fail("角色本人尚未同意生成肖像或 Token");
  }
  return participant;
}

function visualAnchor(
  bible: TtrpgVisualBibleV1,
  slot: TtrpgMediaManifestV1["slots"][number],
): unknown {
  return (
    bible.characters.find(
      (character) => character.characterKey === slot.targetRef,
    ) ??
    bible.locations.find(
      (location) => location.locationKey === slot.targetRef,
    ) ??
    null
  );
}

function requestFromRow(input: {
  row: TtrpgRuntimeAssetRequestRecordV1;
  slot: TtrpgMediaManifestV1["slots"][number];
  qualityProfile: GameMediaRequestV1["qualityProfile"];
  environment: GameMediaRequestV1["environment"];
}): GameMediaRequestV1 {
  return {
    schema: "storyforge.game-media-request",
    version: 1,
    requestId: input.row.requestKey,
    adapterId: input.row.adapterId,
    mediaClass: "image",
    mediaKind: avgMediaKindForTtrpgRuntimeV1(input.row.kind),
    requirementKey: "ttrpg.runtime.visual",
    artifactKey: input.row.requestKey,
    prompt: input.row.prompt,
    negativePrompt: input.row.negativePrompt,
    count: 1,
    width: input.slot.width,
    height: input.slot.height,
    durationMs: null,
    inputHash: input.row.inputHash,
    qualityProfile: input.qualityProfile,
    environment: input.environment,
    allowedDataClasses: [`ttrpg.runtime.${input.row.audience}`],
    rightsPolicyVersion: "storyforge-runtime-media-rights-v1",
  };
}

async function stateAndEvents(session: SimulationSession) {
  const events = await db.simulationEvents
    .where("sessionId")
    .equals(session.id!)
    .sortBy("sequence");
  return {
    events,
    state: replaySimulationEvents(
      parseSimulationState(session.initialStateJson),
      events,
    ),
  };
}

function eventFor(input: {
  session: SimulationSession;
  sequence: number;
  type: SimulationEvent["type"];
  targetKey: string;
  commandId: string;
  payload: Record<string, unknown>;
}): SimulationEvent {
  return {
    projectId: input.session.projectId,
    worldGroupId: input.session.worldGroupId ?? null,
    sessionId: input.session.id!,
    sequence: input.sequence,
    type: input.type,
    actorKey: null,
    targetKey: input.targetKey,
    commandId: input.commandId,
    payloadJson: JSON.stringify(input.payload),
    createdAt: Date.now(),
  };
}

export async function enqueueTtrpgRuntimeAssetRequestV1(input: {
  sessionId: number;
  viewerKey: string;
  slotKey: string;
  requestKey: string;
  adapterId: string;
  promptAddition?: string;
  priority?: number;
  maximumRequestCostUsd?: number;
  qualityProfile?: GameMediaRequestV1["qualityProfile"];
  environment?: GameMediaRequestV1["environment"];
  adapter?: GameMediaProviderAdapterV1;
}): Promise<TtrpgRuntimeAssetRequestRecordV1> {
  const context = await loadContext(input.sessionId);
  const viewerKey = key(input.viewerKey, "viewerKey");
  const requestKey = requestKeyValue(input.requestKey);
  const slotKey = key(input.slotKey, "slotKey");
  const adapterId = key(input.adapterId, "adapterId");
  const slot = context.manifest.slots.find((item) => item.slotKey === slotKey);
  if (!slot) fail("媒资槽不属于冻结 CampaignPack");
  if (
    !context.manifest.runtimePolicy.enabled ||
    context.manifest.runtimePolicy.networkPolicy === "disabled"
  ) {
    fail("本战役已关闭运行时媒资生成");
  }
  const participants = await db.ttrpgSessionParticipants
    .where("sessionId")
    .equals(input.sessionId)
    .toArray();
  const participant = assertRequester({
    participant: participants.find((row) => row.viewerKey === viewerKey),
    slot,
    participants,
  });
  const styleBibleHash = await hashGameProductionValueV2(context.visualBible);
  const promptAddition = boundedText(
    input.promptAddition,
    "附加提示",
    4_000,
    true,
  );
  const prompt = [
    context.visualBible.style.description,
    slot.promptTemplate,
    JSON.stringify(visualAnchor(context.visualBible, slot)),
    promptAddition,
    "保持冻结视觉身份、世界时代、空间锚点和已确认角色特征；不要添加文字水印。",
  ]
    .filter(Boolean)
    .join("\n");
  const negativePrompt = [
    ...context.visualBible.style.prohibitedElements,
    "文字水印",
    "身份漂移",
    "不一致服装",
  ].join("；");
  const inputHash = await hashGameProductionValueV2({
    runtimeSourceHash: context.runtimeSourceHash,
    slot,
    styleBibleHash,
    prompt,
    negativePrompt,
    adapterId,
  });
  const provisional = {
    requestKey,
    adapterId,
    kind: slot.kind,
    prompt,
    negativePrompt,
    inputHash,
  } as Pick<
    TtrpgRuntimeAssetRequestRecordV1,
    | "requestKey"
    | "adapterId"
    | "kind"
    | "prompt"
    | "negativePrompt"
    | "inputHash"
  >;
  const adapter = input.adapter ?? resolveGameMediaProviderAdapterV1(adapterId);
  if (
    adapter.capability.adapterId !== adapterId ||
    !adapter.capability.mediaClasses.includes("image")
  )
    fail("adapter 不支持图片生成");
  const mediaRequest = requestFromRow({
    row: { ...provisional } as TtrpgRuntimeAssetRequestRecordV1,
    slot,
    qualityProfile: input.qualityProfile ?? "internal",
    environment: input.environment ?? "production",
  });
  const estimate = await adapter.estimate(mediaRequest);
  const ceiling =
    input.maximumRequestCostUsd ??
    Math.min(1, context.manifest.runtimePolicy.maximumSessionCostUsd);
  if (
    !Number.isFinite(ceiling) ||
    ceiling < 0 ||
    ceiling > context.manifest.runtimePolicy.maximumSessionCostUsd
  ) {
    fail("单次媒资成本上限无效");
  }
  const reservation = estimate.estimatedCostUsd ?? ceiling;
  if (!Number.isFinite(reservation) || reservation < 0 || reservation > ceiling)
    fail("provider 估算超过单次成本上限");
  const priority = input.priority ?? 50;
  if (!Number.isInteger(priority) || priority < 0 || priority > 100)
    fail("priority 必须是 0..100 整数");
  return db.transaction(
    "rw",
    scopeTransactionTables(
      db.simulationSessions,
      db.simulationEvents,
      db.ttrpgSessionParticipants,
      db.ttrpgRuntimeAssetRequests,
    ),
    async () => {
      const session = await db.simulationSessions.get(input.sessionId);
      if (
        !session ||
        session.status !== "active" ||
        session.runtimeSourceHash !== context.runtimeSourceHash
      )
        fail("Instance 在请求期间发生变化");
      const currentParticipant = await db.ttrpgSessionParticipants.get(
        participant.id!,
      );
      if (
        !currentParticipant ||
        currentParticipant.revision !== participant.revision
      )
        fail("viewer 权限在请求期间发生变化");
      const existing = await db.ttrpgRuntimeAssetRequests
        .where("[sessionId+requestKey]")
        .equals([input.sessionId, requestKey])
        .first();
      if (existing) {
        if (
          existing.inputHash !== inputHash ||
          existing.slotKey !== slotKey ||
          existing.requesterViewerKey !== viewerKey
        ) {
          fail("requestKey 已被不同媒资意图使用");
        }
        return existing;
      }
      const { state } = await stateAndEvents(session);
      const product = state.ttrpg?.product;
      if (
        !product?.sessionZero.completed ||
        product.safety.status !== "active" ||
        !product.media
      )
        fail("运行时媒资需要已开团且安全状态正常");
      const jobs = await db.ttrpgRuntimeAssetRequests
        .where("sessionId")
        .equals(input.sessionId)
        .toArray();
      const committedCost = jobs.reduce(
        (sum, row) =>
          sum +
          (row.actualCostUsd ??
            (row.status === "cancelled" ? 0 : row.costReservationUsd)),
        0,
      );
      if (
        committedCost + reservation >
        context.manifest.runtimePolicy.maximumSessionCostUsd
      )
        fail("运行时媒资会话成本预算不足");
      const activeOrAvailable = jobs.filter((row) =>
        ["queued", "generating", "available"].includes(row.status),
      ).length;
      if (
        activeOrAvailable >=
          context.manifest.runtimePolicy.maximumGeneratedAssets ||
        product.media.generatedCount >=
          context.manifest.runtimePolicy.maximumGeneratedAssets
      )
        fail("运行时媒资数量预算已满");
      const event = eventFor({
        session,
        sequence: state.lastSequence + 1,
        type: "ttrpg.media.requested",
        targetKey: slot.slotKey,
        commandId: `media.request.${requestKey}`,
        payload: {
          requestKey,
          slotKey: slot.slotKey,
          kind: slot.kind,
          targetRef: slot.targetRef,
          audience: slot.audience,
          styleBibleHash,
        },
      });
      applySimulationEvent(state, event);
      event.id = (await db.simulationEvents.add(event)) as number;
      const now = event.createdAt;
      const row: TtrpgRuntimeAssetRequestRecordV1 = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        worldId: session.worldId!,
        workId: session.workId!,
        sessionId: session.id!,
        requestKey,
        slotKey: slot.slotKey,
        kind: slot.kind,
        targetRef: slot.targetRef,
        audience: slot.audience,
        requesterViewerKey: viewerKey,
        prompt,
        negativePrompt,
        fallbackText: slot.fallbackText,
        altText: slot.altText,
        styleBibleHash,
        inputHash,
        adapterId,
        status: "queued",
        priority,
        attemptCount: 0,
        maximumAttempts: context.manifest.runtimePolicy.maximumAttempts,
        maximumSessionCostUsd:
          context.manifest.runtimePolicy.maximumSessionCostUsd,
        estimatedCostUsd: estimate.estimatedCostUsd,
        costReservationUsd: reservation,
        actualCostUsd: null,
        estimatedStorageBytes: estimate.estimatedStorageBytes,
        mediaAssetId: null,
        mediaAssetVersion: null,
        mediaContentHash: null,
        processorLeaseId: null,
        processorLeaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        requestedAtSequence: event.sequence,
        terminalEventSequence: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      row.id = (await db.ttrpgRuntimeAssetRequests.add(row)) as number;
      await db.simulationSessions.update(session.id!, { updatedAt: now });
      return row;
    },
  );
}

async function configuredRuntimeImageCapability(input: {
  context: RuntimeMediaContextV1;
  maximumRequestCostUsd: number;
}): Promise<ResolvedGameMediaCapabilityV1> {
  const requirementBase = {
    requirementKey: "ttrpg.runtime.visual",
    mediaClass: "image" as const,
    operation: "generate",
    adapterFamily: "configured-media",
    minimumCapabilityVersion: "1",
    allowedDataClasses: [
      "ttrpg.runtime.public",
      "ttrpg.runtime.party",
      "ttrpg.runtime.private",
      "ttrpg.runtime.gm-only",
    ],
    maximumRequestCost: input.maximumRequestCostUsd,
    maximumTotalCost:
      input.context.manifest.runtimePolicy.maximumSessionCostUsd,
    rightsPolicyVersion:
      input.context.visualBible.provenancePolicy.rightsPolicyVersion,
    required: false,
  };
  const requirement = {
    ...requirementBase,
    capabilityHash: await hashGameProductionValueV2(requirementBase),
  };
  const agnes = inspectConfiguredAgnesImageCapabilityV1({
    projectId: input.context.scope.projectId,
  });
  if (agnes.ready)
    return resolveConfiguredAgnesImageCapabilityV1({
      projectId: input.context.scope.projectId,
      requirement,
    });
  if (configuredMediaRelayUrlV1())
    return resolveTrustedRelayMediaCapabilityV1({ requirement });
  fail(agnes.issue || "未配置可用的图片生成能力或可信媒资 Relay");
}

/**
 * UI entry: persist the queue item first, then start provider work detached.
 * The returned promise never waits for image generation; refresh recovery uses
 * the same durable row and expired-lease recovery path.
 */
export async function requestConfiguredTtrpgRuntimeAssetV1(input: {
  sessionId: number;
  viewerKey: string;
  slotKey: string;
  requestKey: string;
  promptAddition?: string;
  priority?: number;
  maximumRequestCostUsd?: number;
  networkClass?: "wifi" | "metered" | "offline";
  onSettled?: () => void | Promise<void>;
}): Promise<TtrpgRuntimeAssetRequestRecordV1> {
  const context = await loadContext(input.sessionId);
  const maximumRequestCostUsd =
    input.maximumRequestCostUsd ??
    Math.min(1, context.manifest.runtimePolicy.maximumSessionCostUsd);
  const capability = await configuredRuntimeImageCapability({
    context,
    maximumRequestCostUsd,
  });
  const row = await enqueueTtrpgRuntimeAssetRequestV1({
    ...input,
    adapterId: capability.adapter.capability.adapterId,
    maximumRequestCostUsd,
    adapter: capability.adapter,
  });
  if (row.status === "queued") {
    void processTtrpgRuntimeAssetRequestV1({
      requestId: row.id!,
      adapter: capability.adapter,
      transport: capability.transport,
      networkClass: input.networkClass,
    })
      .catch(() => undefined)
      .finally(() => void input.onSettled?.());
  }
  return row;
}

/** Retry entry for UI: authorization and retry transition remain durable before detached provider work. */
export async function retryConfiguredTtrpgRuntimeAssetRequestV1(input: {
  requestId: number;
  viewerKey: string;
  networkClass?: "wifi" | "metered" | "offline";
  onSettled?: () => void | Promise<void>;
}): Promise<TtrpgRuntimeAssetRequestRecordV1> {
  const original = await db.ttrpgRuntimeAssetRequests.get(input.requestId);
  if (!original) fail("媒资请求不存在");
  const context = await loadContext(original.sessionId);
  const capability = await configuredRuntimeImageCapability({
    context,
    maximumRequestCostUsd: Math.min(
      Math.max(0, original.costReservationUsd),
      context.manifest.runtimePolicy.maximumSessionCostUsd,
    ),
  });
  if (capability.adapter.capability.adapterId !== original.adapterId) {
    fail("重试时 provider 已变化；请取消旧请求并创建新的受预算请求");
  }
  const row = await retryTtrpgRuntimeAssetRequestV1(input);
  void processTtrpgRuntimeAssetRequestV1({
    requestId: row.id!,
    adapter: capability.adapter,
    transport: capability.transport,
    networkClass: input.networkClass,
  })
    .catch(() => undefined)
    .finally(() => void input.onSettled?.());
  return row;
}

async function terminalFailure(input: {
  context: RuntimeMediaContextV1;
  requestId: number;
  leaseId: string;
  errorCode: string;
  detail: string;
  actualCostUsd?: number | null;
}): Promise<TtrpgRuntimeAssetRequestRecordV1> {
  const errorCode = key(
    input.errorCode.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 200) ||
      "provider-failed",
    "errorCode",
  );
  const detail = boundedText(input.detail || "媒资生成失败", "失败详情", 2_000);
  return db.transaction(
    "rw",
    db.simulationSessions,
    db.simulationEvents,
    db.ttrpgRuntimeAssetRequests,
    async () => {
      const [session, row] = await Promise.all([
        db.simulationSessions.get(input.context.session.id!),
        db.ttrpgRuntimeAssetRequests.get(input.requestId),
      ]);
      if (
        !session ||
        !row ||
        row.status !== "generating" ||
        row.processorLeaseId !== input.leaseId
      )
        fail("媒资处理租约已失效");
      const { state } = await stateAndEvents(session);
      const event = eventFor({
        session,
        sequence: state.lastSequence + 1,
        type: "ttrpg.media.failed",
        targetKey: row.slotKey,
        commandId: `media.failed.${row.requestKey}.${row.attemptCount}`,
        payload: {
          requestKey: row.requestKey,
          slotKey: row.slotKey,
          errorCode,
        },
      });
      applySimulationEvent(state, event);
      event.id = (await db.simulationEvents.add(event)) as number;
      const updatedAt = event.createdAt;
      await db.ttrpgRuntimeAssetRequests.update(row.id!, {
        status: "failed",
        actualCostUsd:
          input.actualCostUsd === undefined
            ? row.actualCostUsd
            : input.actualCostUsd,
        processorLeaseId: null,
        processorLeaseExpiresAt: null,
        lastErrorCode: errorCode,
        lastErrorDetail: detail,
        terminalEventSequence: event.sequence,
        revision: row.revision + 1,
        updatedAt,
      });
      await db.simulationSessions.update(session.id!, { updatedAt });
      return (await db.ttrpgRuntimeAssetRequests.get(row.id!))!;
    },
  );
}

export async function processTtrpgRuntimeAssetRequestV1(input: {
  requestId: number;
  transport: MediaProviderTransportV1;
  adapter?: GameMediaProviderAdapterV1;
  signal?: AbortSignal;
  networkClass?: "wifi" | "metered" | "offline";
  qualityProfile?: GameMediaRequestV1["qualityProfile"];
  environment?: GameMediaRequestV1["environment"];
}): Promise<TtrpgRuntimeAssetRequestRecordV1> {
  const original = await db.ttrpgRuntimeAssetRequests.get(input.requestId);
  if (!original) fail("媒资请求不存在");
  const context = await loadContext(original.sessionId);
  const slot = context.manifest.slots.find(
    (item) => item.slotKey === original.slotKey,
  );
  if (!slot) fail("媒资请求槽位已漂移");
  const leaseId = crypto.randomUUID();
  const now = Date.now();
  const claimed = await db.transaction(
    "rw",
    db.ttrpgRuntimeAssetRequests,
    async () => {
      const row = await db.ttrpgRuntimeAssetRequests.get(original.id!);
      if (
        !row ||
        row.status !== "queued" ||
        row.attemptCount >= row.maximumAttempts
      )
        fail("媒资请求当前不可处理或已耗尽重试");
      const generating = await db.ttrpgRuntimeAssetRequests
        .where("[sessionId+status]")
        .equals([row.sessionId, "generating"])
        .count();
      if (
        generating >= context.manifest.runtimePolicy.maximumConcurrentRequests
      )
        fail("运行时媒资并发已满");
      await db.ttrpgRuntimeAssetRequests.update(row.id!, {
        status: "generating",
        attemptCount: row.attemptCount + 1,
        processorLeaseId: leaseId,
        processorLeaseExpiresAt: now + LEASE_MS,
        revision: row.revision + 1,
        updatedAt: now,
      });
      return (await db.ttrpgRuntimeAssetRequests.get(row.id!))!;
    },
  );
  const networkClass = input.networkClass ?? "wifi";
  if (
    networkClass === "offline" ||
    (context.manifest.runtimePolicy.networkPolicy === "wifi-only" &&
      networkClass !== "wifi")
  ) {
    return terminalFailure({
      context,
      requestId: claimed.id!,
      leaseId,
      errorCode: "network-policy-blocked",
      detail: "当前网络策略不允许生成媒资。",
      actualCostUsd: 0,
    });
  }
  const adapter =
    input.adapter ?? resolveGameMediaProviderAdapterV1(claimed.adapterId);
  const request = requestFromRow({
    row: claimed,
    slot,
    qualityProfile: input.qualityProfile ?? "internal",
    environment: input.environment ?? "production",
  });
  try {
    const candidates = await adapter.generate(
      request,
      input.transport,
      input.signal ?? new AbortController().signal,
    );
    if (candidates.length !== 1) fail("运行时媒资 adapter 必须返回一个候选");
    const candidate = await adapter.parseAndVerify(candidates[0]);
    const actualCostUsd = candidate.providerReceipt.costUsd;
    if (
      actualCostUsd != null &&
      (!Number.isFinite(actualCostUsd) || actualCostUsd < 0)
    )
      fail("provider 成本收据无效");
    const otherJobs = await db.ttrpgRuntimeAssetRequests
      .where("sessionId")
      .equals(claimed.sessionId)
      .toArray();
    const otherCost = otherJobs
      .filter((row) => row.id !== claimed.id)
      .reduce(
        (sum, row) =>
          sum +
          (row.actualCostUsd ??
            (row.status === "cancelled" ? 0 : row.costReservationUsd)),
        0,
      );
    if (
      otherCost + (actualCostUsd ?? claimed.costReservationUsd) >
      claimed.maximumSessionCostUsd
    ) {
      return terminalFailure({
        context,
        requestId: claimed.id!,
        leaseId,
        errorCode: "session-cost-budget-exceeded",
        detail: "provider 返回成本超过会话预算，候选未绑定。",
        actualCostUsd,
      });
    }
    const dimensions = detectGameImageDimensionsV1(candidate.data);
    if (!dimensions) fail("provider 图片无法读取固有尺寸");
    const assetKey =
      `ttrpg.runtime.${claimed.sessionId}.${claimed.requestKey}`.slice(0, 200);
    const asset = await importProductMediaAssetV1({
      scope: context.scope,
      assetKey,
      kind: candidate.mediaKind,
      name: `运行时媒资 · ${claimed.slotKey}`,
      blob: new Blob([candidate.data], { type: candidate.mimeType }),
      altText: claimed.altText,
      source: candidate.adapterId,
      license: `rights-policy:${candidate.rights.rightsPolicyVersion}`,
      width: dimensions.width,
      height: dimensions.height,
      durationMs: null,
      characterTag: [
        "character-portrait",
        "character-expression",
        "token",
      ].includes(claimed.kind)
        ? claimed.targetRef
        : "",
      sceneTag:
        claimed.kind === "scene" || claimed.kind === "map"
          ? claimed.targetRef
          : "",
    });
    if (asset.contentHash !== candidate.contentHash)
      fail("统一媒资采用后 content hash 漂移");
    return db.transaction(
      "rw",
      db.simulationSessions,
      db.simulationEvents,
      db.ttrpgRuntimeAssetRequests,
      db.productMediaAssets,
      async () => {
        const [session, row, currentAsset] = await Promise.all([
          db.simulationSessions.get(context.session.id!),
          db.ttrpgRuntimeAssetRequests.get(claimed.id!),
          db.productMediaAssets.get(asset.id!),
        ]);
        if (
          !session ||
          !row ||
          row.status !== "generating" ||
          row.processorLeaseId !== leaseId ||
          !currentAsset ||
          currentAsset.contentHash !== candidate.contentHash
        )
          fail("媒资完成时租约或统一媒资绑定失效");
        const { state } = await stateAndEvents(session);
        const event = eventFor({
          session,
          sequence: state.lastSequence + 1,
          type: "ttrpg.media.available",
          targetKey: row.slotKey,
          commandId: `media.available.${row.requestKey}.${row.attemptCount}`,
          payload: {
            requestKey: row.requestKey,
            slotKey: row.slotKey,
            assetKey: currentAsset.assetKey,
            mediaAssetId: currentAsset.id,
            mediaAssetVersion: currentAsset.version,
            mediaContentHash: currentAsset.contentHash,
          },
        });
        applySimulationEvent(state, event);
        event.id = (await db.simulationEvents.add(event)) as number;
        const updatedAt = event.createdAt;
        await db.ttrpgRuntimeAssetRequests.update(row.id!, {
          status: "available",
          actualCostUsd,
          mediaAssetId: currentAsset.id!,
          mediaAssetVersion: currentAsset.version,
          mediaContentHash: currentAsset.contentHash,
          processorLeaseId: null,
          processorLeaseExpiresAt: null,
          lastErrorCode: null,
          lastErrorDetail: null,
          terminalEventSequence: event.sequence,
          revision: row.revision + 1,
          updatedAt,
        });
        await db.simulationSessions.update(session.id!, { updatedAt });
        return (await db.ttrpgRuntimeAssetRequests.get(row.id!))!;
      },
    );
  } catch (cause) {
    const current = await db.ttrpgRuntimeAssetRequests.get(claimed.id!);
    if (
      current?.status !== "generating" ||
      current.processorLeaseId !== leaseId
    )
      throw cause;
    return terminalFailure({
      context,
      requestId: claimed.id!,
      leaseId,
      errorCode:
        cause instanceof DOMException && cause.name === "AbortError"
          ? "provider-aborted"
          : "provider-generation-failed",
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export async function retryTtrpgRuntimeAssetRequestV1(input: {
  requestId: number;
  viewerKey: string;
}): Promise<TtrpgRuntimeAssetRequestRecordV1> {
  const viewerKey = key(input.viewerKey, "viewerKey");
  const original = await db.ttrpgRuntimeAssetRequests.get(input.requestId);
  if (!original) fail("媒资请求不存在");
  const context = await loadContext(original.sessionId);
  const participants = await db.ttrpgSessionParticipants
    .where("sessionId")
    .equals(original.sessionId)
    .toArray();
  const participant = participants.find((row) => row.viewerKey === viewerKey);
  if (
    !participant ||
    (participant.role !== "gm" && original.requesterViewerKey !== viewerKey)
  )
    fail("viewer 不能重试该媒资请求");
  return db.transaction(
    "rw",
    db.simulationSessions,
    db.simulationEvents,
    db.ttrpgRuntimeAssetRequests,
    async () => {
      const [session, row] = await Promise.all([
        db.simulationSessions.get(context.session.id!),
        db.ttrpgRuntimeAssetRequests.get(original.id!),
      ]);
      if (
        !session ||
        !row ||
        row.status !== "failed" ||
        row.attemptCount >= row.maximumAttempts
      )
        fail("媒资请求不可重试");
      const { state } = await stateAndEvents(session);
      const event = eventFor({
        session,
        sequence: state.lastSequence + 1,
        type: "ttrpg.media.requested",
        targetKey: row.slotKey,
        commandId: `media.retry.${row.requestKey}.${row.attemptCount + 1}`,
        payload: {
          requestKey: row.requestKey,
          slotKey: row.slotKey,
          kind: row.kind,
          targetRef: row.targetRef,
          audience: row.audience,
          styleBibleHash: row.styleBibleHash,
        },
      });
      applySimulationEvent(state, event);
      event.id = (await db.simulationEvents.add(event)) as number;
      const updatedAt = event.createdAt;
      await db.ttrpgRuntimeAssetRequests.update(row.id!, {
        status: "queued",
        processorLeaseId: null,
        processorLeaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        terminalEventSequence: null,
        revision: row.revision + 1,
        updatedAt,
      });
      await db.simulationSessions.update(session.id!, { updatedAt });
      return (await db.ttrpgRuntimeAssetRequests.get(row.id!))!;
    },
  );
}

export async function cancelTtrpgRuntimeAssetRequestV1(input: {
  requestId: number;
  viewerKey: string;
}): Promise<TtrpgRuntimeAssetRequestRecordV1> {
  const viewerKey = key(input.viewerKey, "viewerKey");
  const original = await db.ttrpgRuntimeAssetRequests.get(input.requestId);
  if (!original) fail("媒资请求不存在");
  const context = await loadContext(original.sessionId);
  const participants = await db.ttrpgSessionParticipants
    .where("sessionId")
    .equals(original.sessionId)
    .toArray();
  const participant = participants.find((row) => row.viewerKey === viewerKey);
  if (
    !participant ||
    (participant.role !== "gm" && original.requesterViewerKey !== viewerKey)
  )
    fail("viewer 不能取消该媒资请求");
  return db.transaction(
    "rw",
    db.simulationSessions,
    db.simulationEvents,
    db.ttrpgRuntimeAssetRequests,
    async () => {
      const [session, row] = await Promise.all([
        db.simulationSessions.get(context.session.id!),
        db.ttrpgRuntimeAssetRequests.get(original.id!),
      ]);
      if (!session || !row || !["queued", "failed"].includes(row.status))
        fail("媒资请求当前不可取消");
      const { state } = await stateAndEvents(session);
      const event = eventFor({
        session,
        sequence: state.lastSequence + 1,
        type: "ttrpg.media.cancelled",
        targetKey: row.slotKey,
        commandId: `media.cancel.${row.requestKey}.${row.revision}`,
        payload: { requestKey: row.requestKey, slotKey: row.slotKey },
      });
      applySimulationEvent(state, event);
      event.id = (await db.simulationEvents.add(event)) as number;
      const updatedAt = event.createdAt;
      await db.ttrpgRuntimeAssetRequests.update(row.id!, {
        status: "cancelled",
        processorLeaseId: null,
        processorLeaseExpiresAt: null,
        lastErrorCode: null,
        lastErrorDetail: null,
        terminalEventSequence: event.sequence,
        revision: row.revision + 1,
        updatedAt,
      });
      await db.simulationSessions.update(session.id!, { updatedAt });
      return (await db.ttrpgRuntimeAssetRequests.get(row.id!))!;
    },
  );
}

/** Browser crash recovery: generation has no replay event, so an expired lease can safely return to queued. */
export async function recoverTtrpgRuntimeMediaQueueV1(input: {
  sessionId: number;
  now?: number;
}): Promise<number> {
  await loadContext(input.sessionId);
  const now = input.now ?? Date.now();
  return db.transaction("rw", db.ttrpgRuntimeAssetRequests, async () => {
    const expired = await db.ttrpgRuntimeAssetRequests
      .where("[sessionId+status]")
      .equals([input.sessionId, "generating"])
      .filter((row) => (row.processorLeaseExpiresAt ?? 0) <= now)
      .toArray();
    for (const row of expired)
      await db.ttrpgRuntimeAssetRequests.update(row.id!, {
        status: "queued",
        processorLeaseId: null,
        processorLeaseExpiresAt: null,
        lastErrorCode: "processor-lease-expired",
        lastErrorDetail: "上次处理器中断，任务已恢复到队列。",
        revision: row.revision + 1,
        updatedAt: now,
      });
    return expired.length;
  });
}

export async function readVisibleTtrpgRuntimeMediaRequestsV1(input: {
  sessionId: number;
  viewerKey: string;
}): Promise<
  Array<
    Omit<
      TtrpgRuntimeAssetRequestRecordV1,
      | "prompt"
      | "negativePrompt"
      | "processorLeaseId"
      | "processorLeaseExpiresAt"
      | "lastErrorDetail"
    >
  >
> {
  const viewerKey = key(input.viewerKey, "viewerKey");
  const participants = await db.ttrpgSessionParticipants
    .where("sessionId")
    .equals(input.sessionId)
    .toArray();
  const participant = participants.find((row) => row.viewerKey === viewerKey);
  if (!participant) fail("viewer 不属于该 TTRPG Instance");
  const rows = await db.ttrpgRuntimeAssetRequests
    .where("sessionId")
    .equals(input.sessionId)
    .sortBy("createdAt");
  return rows
    .filter((row) =>
      canSeeAudience({
        participant,
        audience: row.audience,
        targetRef: row.targetRef,
      }),
    )
    .map((row) => {
      const {
        prompt: _prompt,
        negativePrompt: _negativePrompt,
        processorLeaseId: _lease,
        processorLeaseExpiresAt: _expires,
        lastErrorDetail: _detail,
        ...visible
      } = row;
      return visible;
    });
}

export async function readTtrpgRuntimeMediaBlobV1(input: {
  scope: WorkspaceScope;
  sessionId: number;
  mediaAssetId: number;
  viewerKey: string;
}): Promise<Blob> {
  const scope = await resolveScope({ scope: input.scope });
  const visible = await readVisibleTtrpgRuntimeMediaRequestsV1({
    sessionId: input.sessionId,
    viewerKey: input.viewerKey,
  });
  const request = visible.find(
    (row) =>
      row.mediaAssetId === input.mediaAssetId && row.status === "available",
  );
  if (
    !request ||
    !request.mediaContentHash ||
    request.mediaAssetVersion == null
  )
    fail("viewer 不能读取该运行时媒资");
  const asset = await db.productMediaAssets.get(input.mediaAssetId);
  if (
    !asset ||
    !(await assertRecordInScope(scope, "productMediaAssets", asset, {
      owner: "work",
    })) ||
    asset.contentHash !== request.mediaContentHash ||
    asset.version !== request.mediaAssetVersion
  )
    fail("统一媒资绑定损坏或跨 Work");
  const mediaBlob = await db.productMediaBlobs
    .where("mediaAssetId")
    .equals(asset.id!)
    .first();
  if (
    !mediaBlob ||
    !(await assertRecordInScope(scope, "productMediaBlobs", mediaBlob, {
      owner: "work",
    }))
  )
    fail("统一媒资字节链接缺失");
  const data = await readProductMediaBlobData({
    scope,
    blob: mediaBlob,
    expected: {
      contentHash: asset.contentHash,
      byteSize: asset.byteSize,
      mimeType: asset.mimeType,
    },
  });
  return new Blob([data], { type: asset.mimeType });
}

/** Avoid leaking a pending crypto promise out of a Dexie transaction in callers. */
export async function hashTtrpgVisualBibleV1(
  value: TtrpgVisualBibleV1,
): Promise<string> {
  const digest = hashGameProductionValueV2(parseTtrpgVisualBibleV1(value));
  return Dexie.currentTransaction ? Dexie.waitFor(digest) : digest;
}

export function assertTtrpgRuntimeMediaHashV1(value: string): string {
  if (!HASH.test(value)) fail("运行时媒资 hash 无效");
  return value;
}
