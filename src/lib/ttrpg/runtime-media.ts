import Dexie from "dexie";
import { db } from "../db/schema";
import { importProductRuntimeMediaAssetV1 } from "../product/runtime-media-library";
import { readProductMediaBlobData } from "../product-production/media-blob-store";
import { hashProductProductionValueV2 } from "../product-production/hash";
import {
  detectProductImageDimensionsV1,
  resolveProductMediaProviderAdapterV1,
  type ProductMediaProviderAdapterV1,
  type ProductMediaRequestV1,
  type MediaProviderTransportV1,
} from "../product-production/media-adapters";
import { verifyProductRuntimeSource } from "../product-production/preview-source";
import {
  configuredMediaRelayUrlV1,
  inspectConfiguredAgnesImageCapabilityV1,
  resolveConfiguredAgnesImageCapabilityV1,
  resolveTrustedRelayMediaCapabilityV1,
  type ResolvedProductMediaCapabilityV1,
} from "../product-production/media-transport";
import type {
  ProductRuntimeEvent,
  ProductRuntimeSession,
  ProductRuntimeState,
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
} from "../workspace/scope";
import {
  applyProductRuntimeEvent,
  parseProductRuntimeState,
  replayProductRuntimeEvents,
} from "./runtime-api";
import { parseTtrpgCampaignContentV1 } from "./campaign";
import {
  avgMediaKindForTtrpgRuntimeV1,
  parseTtrpgMediaManifestV1,
  parseTtrpgVisualBibleV1,
} from "./media-contract";
import { parseRulePackV1 } from "./rule-pack";
import { createTtrpgViewerProjectionV1, type TtrpgViewerRuntimeMediaRefV1 } from "./viewer-projection";
import { readTtrpgSessionParticipantsV2 } from "./participants";
import {
  EMPTY_RUNTIME_MEDIA_ACCOUNTING, canRetryRuntimeMedia, committedRuntimeMediaCost,
  hasRuntimeMediaDispatchAuthority, hasUnresolvedRuntimeMediaAttempt, isRuntimeMediaCost, measuredRuntimeMediaCost,
  readRuntimeMediaAccounting,
} from "./runtime-media-attempt-accounting";

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
  session: ProductRuntimeSession;
  scope: WorkspaceScope;
  visualBible: TtrpgVisualBibleV1;
  manifest: TtrpgMediaManifestV1;
  runtimeSourceHash: string;
  campaign: ReturnType<typeof parseTtrpgCampaignContentV1>;
  rulePack: ReturnType<typeof parseRulePackV1>;
}

async function loadContext(sessionId: number, activeOnly = true): Promise<RuntimeMediaContextV1> {
  const session = await db.productRuntimeSessions.get(sessionId);
  if (
    !session ||
    session.kind !== "ttrpg" ||
    (activeOnly && session.status !== "active") ||
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
    | { kind: "release"; productReleaseId: number }
    | { kind: "build"; productBuildId: number; expectedPreviewHash: string }
    | null = null;
  if (session.productReleaseId != null) {
    resolvedSource = { kind: "release", productReleaseId: session.productReleaseId };
  } else if (session.productBuildId != null) {
    const build = await db.productBuilds.get(session.productBuildId);
    if (!build?.previewHash || build.id == null)
      fail("TTRPG Build Preview 不存在");
    resolvedSource = {
      kind: "build",
      productBuildId: build.id,
      expectedPreviewHash: build.previewHash,
    };
  }
  if (!resolvedSource) fail("TTRPG Instance 没有冻结 Release/Build");
  const verified = await verifyProductRuntimeSource({
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
    campaign,
    rulePack,
  };
}

function visibleSlotKeys(
  context: RuntimeMediaContextV1,
  participant: TtrpgSessionParticipantRecordV2,
  state: ProductRuntimeState,
): Set<string> {
  if (participant.assignmentState === "left" || participant.controller === "vacant") return new Set();
  const projection = createTtrpgViewerProjectionV1({
    state, campaign: context.campaign, rulePack: context.rulePack,
    role: participant.role, actorKey: participant.actorKey,
  });
  return new Set(projection.media?.slots.map(slot => slot.slotKey) ?? []);
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
  qualityProfile: ProductMediaRequestV1["qualityProfile"];
  environment: ProductMediaRequestV1["environment"];
}): ProductMediaRequestV1 {
  return {
    schema: "storyforge.product-media-request",
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

async function stateAndEvents(session: ProductRuntimeSession) {
  const events = await db.productRuntimeEvents
    .where("sessionId")
    .equals(session.id!)
    .sortBy("sequence");
  return {
    events,
    state: replayProductRuntimeEvents(
      parseProductRuntimeState(session.initialStateJson),
      events,
    ),
  };
}

function eventFor(input: {
  session: ProductRuntimeSession;
  sequence: number;
  type: ProductRuntimeEvent["type"];
  targetKey: string;
  commandId: string;
  payload: Record<string, unknown>;
}): ProductRuntimeEvent {
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
  qualityProfile?: ProductMediaRequestV1["qualityProfile"];
  environment?: ProductMediaRequestV1["environment"];
  adapter?: ProductMediaProviderAdapterV1;
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
  if (!visibleSlotKeys(context, participant, (await stateAndEvents(context.session)).state).has(slotKey)) {
    fail("媒资槽当前对 viewer 不可见");
  }
  const styleBibleHash = await hashProductProductionValueV2(context.visualBible);
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
  const inputHash = await hashProductProductionValueV2({
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
  const adapter = input.adapter ?? resolveProductMediaProviderAdapterV1(adapterId);
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
      db.productRuntimeSessions,
      db.productRuntimeEvents,
      db.ttrpgSessionParticipants,
      db.ttrpgRuntimeAssetRequests,
    ),
    async () => {
      const session = await db.productRuntimeSessions.get(input.sessionId);
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
      const { state } = await stateAndEvents(session);
      const product = state.ttrpg?.product;
      if (
        !product?.sessionZero.completed ||
        product.safety.status !== "active" ||
        !product.media
      )
        fail("运行时媒资需要已开团且安全状态正常");
      if (!visibleSlotKeys(context, currentParticipant, state).has(slotKey)) {
        fail("媒资槽当前对 viewer 不可见");
      }
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
      const jobs = await db.ttrpgRuntimeAssetRequests
        .where("sessionId")
        .equals(input.sessionId)
        .toArray();
      const committedCost = jobs.reduce((sum, row) => sum + committedRuntimeMediaCost(row), 0);
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
      applyProductRuntimeEvent(state, event);
      event.id = (await db.productRuntimeEvents.add(event)) as number;
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
        attemptAccountingJson: EMPTY_RUNTIME_MEDIA_ACCOUNTING,
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
      await db.productRuntimeSessions.update(session.id!, { updatedAt: now });
      return row;
    },
  );
}

async function configuredRuntimeImageCapability(input: {
  context: RuntimeMediaContextV1;
  maximumRequestCostUsd: number;
}): Promise<ResolvedProductMediaCapabilityV1> {
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
    capabilityHash: await hashProductProductionValueV2(requirementBase),
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
  let row = original;
  if (original.status === "queued") {
    const visible = await readVisibleTtrpgRuntimeMediaRequestsV1({ sessionId: original.sessionId, viewerKey: input.viewerKey });
    if (!visible.find(item => item.id === original.id)?.canResume) fail("媒资请求不可继续发送");
  } else {
    row = await retryTtrpgRuntimeAssetRequestV1(input);
  }
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

function sameRuntimeMediaOwner(session: ProductRuntimeSession | undefined, context: RuntimeMediaContextV1) {
  return session?.id === context.session.id && session?.status === "active" &&
    session.runtimeSourceHash === context.runtimeSourceHash &&
    session.productBuildId === context.session.productBuildId &&
    session.productReleaseId === context.session.productReleaseId &&
    session.projectId === context.scope.projectId && session.worldId === context.scope.worldId &&
    session.workId === context.scope.workId;
}

function mediaRowBelongsToSession(row: TtrpgRuntimeAssetRequestRecordV1, session: ProductRuntimeSession) {
  return row.sessionId === session.id && row.projectId === session.projectId && row.worldGroupId === session.worldGroupId &&
    row.worldId === session.worldId && row.workId === session.workId;
}

function sameRuntimeMediaIntent(row: TtrpgRuntimeAssetRequestRecordV1 | undefined, original: TtrpgRuntimeAssetRequestRecordV1) {
  return row != null && row.id === original.id && row.sessionId === original.sessionId &&
    row.projectId === original.projectId && row.worldGroupId === original.worldGroupId &&
    row.worldId === original.worldId && row.workId === original.workId &&
    row.requestKey === original.requestKey && row.slotKey === original.slotKey &&
    row.inputHash === original.inputHash && row.requestedAtSequence === original.requestedAtSequence;
}

async function sessionMediaCommittedCost(sessionId: number) {
  const rows = await db.ttrpgRuntimeAssetRequests.where("sessionId").equals(sessionId).toArray();
  return rows.reduce((sum, row) => sum + committedRuntimeMediaCost(row), 0);
}

function markSettledMediaAttempt(row: TtrpgRuntimeAssetRequestRecordV1, sequence: number | null) {
  const accounting = readRuntimeMediaAccounting(row);
  const attempt = accounting?.attempts.find(item => item.ordinal === row.attemptCount &&
    item.dispatchKey === row.processorLeaseId);
  if (!attempt || attempt.costUsd === null || sequence === null) return row.attemptAccountingJson;
  attempt.settledSequence = sequence;
  return JSON.stringify(accounting);
}

async function terminalFailure(input: {
  context: RuntimeMediaContextV1;
  requestId: number;
  leaseId: string | null;
  errorCode: string;
  detail: string;
}): Promise<TtrpgRuntimeAssetRequestRecordV1> {
  const errorCode = key(
    input.errorCode.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 200) ||
      "provider-failed",
    "errorCode",
  );
  const detail = boundedText(input.detail || "媒资生成失败", "失败详情", 2_000);
  return db.transaction(
    "rw",
    db.productRuntimeSessions,
    db.productRuntimeEvents,
    db.ttrpgRuntimeAssetRequests,
    async () => {
      const [session, row] = await Promise.all([
        db.productRuntimeSessions.get(input.context.session.id!),
        db.ttrpgRuntimeAssetRequests.get(input.requestId),
      ]);
      if (
        !session || !sameRuntimeMediaOwner(session, input.context) ||
        !row || !mediaRowBelongsToSession(row, session) ||
        row.status !== "generating" ||
        row.processorLeaseId !== input.leaseId
      )
        fail("媒资处理租约已失效");
      const { state } = await stateAndEvents(session);
      const slot = state.ttrpg?.product?.media.slots.find(item => item.slotKey === row.slotKey);
      let terminalEventSequence = row.terminalEventSequence;
      let updatedAt = Date.now();
      if (slot?.requestKey === row.requestKey && slot.status === "queued") {
        const event = eventFor({
          session, sequence: state.lastSequence + 1, type: "ttrpg.media.failed",
          targetKey: row.slotKey, commandId: `media.failed.${row.requestKey}.${row.attemptCount}`,
          payload: { requestKey: row.requestKey, slotKey: row.slotKey, errorCode },
        });
        applyProductRuntimeEvent(state, event);
        event.id = (await db.productRuntimeEvents.add(event)) as number;
        updatedAt = event.createdAt;
        terminalEventSequence = event.sequence;
        await db.productRuntimeSessions.update(session.id!, { updatedAt });
      }
      await db.ttrpgRuntimeAssetRequests.update(row.id!, {
        status: "failed",
        processorLeaseId: null,
        processorLeaseExpiresAt: null,
        lastErrorCode: errorCode,
        lastErrorDetail: detail,
        terminalEventSequence,
        attemptAccountingJson: markSettledMediaAttempt(row, terminalEventSequence),
        revision: row.revision + 1,
        updatedAt,
      });
      return (await db.ttrpgRuntimeAssetRequests.get(row.id!))!;
    },
  );
}

export async function processTtrpgRuntimeAssetRequestV1(input: {
  requestId: number;
  transport: MediaProviderTransportV1;
  adapter?: ProductMediaProviderAdapterV1;
  signal?: AbortSignal;
  networkClass?: "wifi" | "metered" | "offline";
  qualityProfile?: ProductMediaRequestV1["qualityProfile"];
  environment?: ProductMediaRequestV1["environment"];
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
        !sameRuntimeMediaIntent(row, original) ||
        row.status !== "queued" ||
        !hasRuntimeMediaDispatchAuthority(row) ||
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
    });
  }
  const adapter =
    input.adapter ?? resolveProductMediaProviderAdapterV1(claimed.adapterId);
  const request = requestFromRow({
    row: claimed,
    slot,
    qualityProfile: input.qualityProfile ?? "internal",
    environment: input.environment ?? "production",
  });
  const signal = input.signal ?? new AbortController().signal;
  const maximumUsd = context.manifest.runtimePolicy.maximumSessionCostUsd;
  let dispatched = false;

  async function updateAttempt(update: (attempt: NonNullable<ReturnType<typeof readRuntimeMediaAccounting>>["attempts"][number]) => void) {
    return db.transaction("rw", db.productRuntimeSessions, db.ttrpgRuntimeAssetRequests, async () => {
      const [session, row] = await Promise.all([
        db.productRuntimeSessions.get(claimed.sessionId), db.ttrpgRuntimeAssetRequests.get(claimed.id!),
      ]);
      if (!session || session.runtimeSourceHash !== context.runtimeSourceHash ||
        session.projectId !== claimed.projectId || session.worldId !== claimed.worldId ||
        session.workId !== claimed.workId || !row || !sameRuntimeMediaIntent(row, claimed))
        fail("不能向已变更的媒资请求写入尝试证据");
      const accounting = readRuntimeMediaAccounting(row);
      const attempt = accounting?.attempts.find(item => item.ordinal === claimed.attemptCount && item.dispatchKey === leaseId);
      if (!accounting || !attempt) fail("媒资尝试没有已确认的发送记录");
      update(attempt);
      await db.ttrpgRuntimeAssetRequests.update(row.id!, {
        attemptAccountingJson: JSON.stringify(accounting),
        actualCostUsd: measuredRuntimeMediaCost(accounting),
        revision: row.revision + 1,
        updatedAt: Date.now(),
      });
    });
  }

  const transport: MediaProviderTransportV1 = {
    executionLocation: input.transport.executionLocation,
    rawResponseEvidence: input.transport.rawResponseEvidence,
    async request(wire, requestSignal, onRawResponse) {
      requestSignal.throwIfAborted();
      if (dispatched || wire.adapterId !== claimed.adapterId || wire.requestId !== request.requestId)
        fail("媒资尝试只允许发送一次与原请求一致的调用");
      await db.transaction("rw", db.productRuntimeSessions, db.productRuntimeEvents,
        db.ttrpgSessionParticipants, db.ttrpgRuntimeAssetRequests, async () => {
          const [session, row] = await Promise.all([
            db.productRuntimeSessions.get(claimed.sessionId), db.ttrpgRuntimeAssetRequests.get(claimed.id!),
          ]);
          if (!session || !sameRuntimeMediaOwner(session, context) || !row || !mediaRowBelongsToSession(row, session) || !sameRuntimeMediaIntent(row, claimed) ||
            row.status !== "generating" || row.processorLeaseId !== leaseId ||
            row.attemptCount !== claimed.attemptCount || (row.processorLeaseExpiresAt ?? 0) <= Date.now())
            fail("媒资处理租约在发送前失效");
          const accounting = readRuntimeMediaAccounting(row);
          if (!accounting || !hasRuntimeMediaDispatchAuthority(row) ||
            accounting.attempts.some(item => item.ordinal === row.attemptCount))
            fail("媒资尝试存在未结算的发送记录");
          const { state } = await stateAndEvents(session);
          const product = state.ttrpg?.product;
          const currentSlot = product?.media.slots.find(item => item.slotKey === row.slotKey);
          const participant = await db.ttrpgSessionParticipants.where("sessionId").equals(row.sessionId)
            .filter(item => item.viewerKey === row.requesterViewerKey).first();
          if (!participant || !product?.sessionZero.completed || product.safety.status !== "active" ||
            currentSlot?.requestKey !== row.requestKey || currentSlot.status !== "queued" ||
            !visibleSlotKeys(context, participant, state).has(row.slotKey)) fail("媒资原槽位或授权在发送前失效");
          // The generating row already holds this attempt's reservation. Do not count it twice.
          if (await sessionMediaCommittedCost(row.sessionId) > maximumUsd) fail("运行时媒资会话成本预算不足");
          requestSignal.throwIfAborted();
          accounting.attempts.push({ ordinal: row.attemptCount, afterSequence: state.lastSequence, settledSequence: null, dispatchKey: leaseId,
            reservationUsd: row.costReservationUsd, costUsd: null, receiptHash: null, candidate: null });
          await db.ttrpgRuntimeAssetRequests.update(row.id!, {
            attemptAccountingJson: JSON.stringify(accounting), revision: row.revision + 1, updatedAt: Date.now(),
          });
        });
      dispatched = true;
      const response = await input.transport.request(wire, requestSignal, onRawResponse);
      const costUsd = isRuntimeMediaCost(response.costUsd) ? response.costUsd : null;
      const receiptHash = await hashProductProductionValueV2({
        adapterId: wire.adapterId, requestId: wire.requestId, status: response.status,
        providerRequestId: response.providerRequestId, costUsd,
      });
      await updateAttempt(attempt => {
        if (attempt.receiptHash !== null) fail("媒资尝试的已观察收据不能覆盖");
        attempt.costUsd = costUsd;
        attempt.receiptHash = receiptHash;
      });
      if (response.costUsd !== null && !isRuntimeMediaCost(response.costUsd)) fail("provider 成本收据无效");
      return response;
    },
    ...(input.transport.fetchExternalAsset ? {
      fetchExternalAsset: (asset, fetchSignal) => {
        if (!dispatched) fail("原媒资尝试尚未发送");
        return input.transport.fetchExternalAsset!(asset, fetchSignal);
      },
    } : {}),
  };

  try {
    if (adapter.capability.adapterId !== claimed.adapterId) fail("媒资 adapter 与原请求不一致");
    const candidates = await adapter.generate(request, transport, signal);
    if (!dispatched || candidates.length !== 1) fail("运行时媒资 adapter 必须返回一次发送的一个候选");
    const candidate = await adapter.parseAndVerify(candidates[0]);
    const dimensions = detectProductImageDimensionsV1(candidate.data);
    if (!dimensions) fail("provider 图片无法读取固有尺寸");
    const assetKey =
      `ttrpg.runtime.${claimed.sessionId}.${claimed.requestKey}`.slice(0, 200);
    const asset = await importProductRuntimeMediaAssetV1({
      scope: context.scope,
      productRuntimeSessionId: context.session.id!,
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
    if (asset.ownerKind !== "runtime" || asset.productType !== "ttrpg" ||
      asset.productRuntimeSessionId !== claimed.sessionId || asset.productReleaseId !== null ||
      asset.projectId !== claimed.projectId || asset.worldId !== claimed.worldId || asset.workId !== claimed.workId)
      fail("媒资候选不属于原请求 Instance");
    await updateAttempt(attempt => {
      if (attempt.receiptHash === null || attempt.candidate !== null) fail("不能覆盖或伪造媒资候选证据");
      attempt.candidate = { assetKey: asset.assetKey, version: asset.version, contentHash: asset.contentHash };
    });
    const current = await db.ttrpgRuntimeAssetRequests.get(claimed.id!);
    if (current && (current.status !== "generating" || current.processorLeaseId !== leaseId)) return current;
    if (await sessionMediaCommittedCost(claimed.sessionId) > maximumUsd) {
      return terminalFailure({ context, requestId: claimed.id!, leaseId,
        errorCode: "session-cost-budget-exceeded", detail: "provider 返回成本超过会话预算，候选未绑定。" });
    }
    return db.transaction(
      "rw",
      db.productRuntimeSessions,
      db.productRuntimeEvents,
      db.ttrpgRuntimeAssetRequests,
      db.productMediaAssets,
      db.ttrpgSessionParticipants,
      async () => {
        const [session, row, currentAsset] = await Promise.all([
          db.productRuntimeSessions.get(context.session.id!),
          db.ttrpgRuntimeAssetRequests.get(claimed.id!),
          db.productMediaAssets.get(asset.id!),
        ]);
        if (
          !session || !sameRuntimeMediaOwner(session, context) ||
          !row || !mediaRowBelongsToSession(row, session) || !sameRuntimeMediaIntent(row, claimed) ||
          row.status !== "generating" || row.processorLeaseId !== leaseId ||
          (row.processorLeaseExpiresAt ?? 0) <= Date.now() ||
          !currentAsset || currentAsset.contentHash !== candidate.contentHash ||
          currentAsset.productRuntimeSessionId !== row.sessionId
        ) fail("媒资完成时租约或统一媒资绑定失效");
        if (await sessionMediaCommittedCost(row.sessionId) > maximumUsd)
          return terminalFailure({ context, requestId: row.id!, leaseId,
            errorCode: "session-cost-budget-exceeded", detail: "provider 返回成本超过会话预算，候选未绑定。" });
        const { state } = await stateAndEvents(session);
        const participant = await db.ttrpgSessionParticipants.where("sessionId").equals(row.sessionId)
          .filter(item => item.viewerKey === row.requesterViewerKey).first();
        if (!participant || state.ttrpg?.product?.safety.status !== "active" ||
          !visibleSlotKeys(context, participant, state).has(row.slotKey)) fail("媒资原授权在绑定前失效");
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
        applyProductRuntimeEvent(state, event);
        event.id = (await db.productRuntimeEvents.add(event)) as number;
        const updatedAt = event.createdAt;
        await db.ttrpgRuntimeAssetRequests.update(row.id!, {
          status: "available",
          attemptAccountingJson: markSettledMediaAttempt(row, event.sequence),
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
        await db.productRuntimeSessions.update(session.id!, { updatedAt });
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
      errorCode: dispatched && hasUnresolvedRuntimeMediaAttempt(current)
        ? "provider-outcome-unknown"
        : cause instanceof DOMException && cause.name === "AbortError"
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
    db.productRuntimeSessions,
    db.productRuntimeEvents,
    db.ttrpgRuntimeAssetRequests,
    async () => {
      const [session, row] = await Promise.all([
        db.productRuntimeSessions.get(context.session.id!),
        db.ttrpgRuntimeAssetRequests.get(original.id!),
      ]);
      if (!session || !sameRuntimeMediaOwner(session, context) || !row || !mediaRowBelongsToSession(row, session) || !sameRuntimeMediaIntent(row, original) ||
        !canRetryRuntimeMedia(row, await sessionMediaCommittedCost(original.sessionId),
          context.manifest.runtimePolicy.maximumSessionCostUsd))
        fail("媒资请求不可重试：尝试未结算、已耗尽或会话预算不足");
      const { state } = await stateAndEvents(session);
      const slot = state.ttrpg?.product?.media.slots.find(item => item.slotKey === row.slotKey);
      if (slot?.status !== "failed" || slot.requestKey !== row.requestKey)
        fail("媒资槽已更换，不能重试原请求");
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
      applyProductRuntimeEvent(state, event);
      event.id = (await db.productRuntimeEvents.add(event)) as number;
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
      await db.productRuntimeSessions.update(session.id!, { updatedAt });
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
    db.productRuntimeSessions,
    db.productRuntimeEvents,
    db.ttrpgRuntimeAssetRequests,
    async () => {
      const [session, row] = await Promise.all([
        db.productRuntimeSessions.get(context.session.id!),
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
      applyProductRuntimeEvent(state, event);
      event.id = (await db.productRuntimeEvents.add(event)) as number;
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
      await db.productRuntimeSessions.update(session.id!, { updatedAt });
      return (await db.ttrpgRuntimeAssetRequests.get(row.id!))!;
    },
  );
}

/** Only an explicitly tracked claim with no dispatch can return to the queue. */
export async function recoverTtrpgRuntimeMediaQueueV1(input: {
  sessionId: number;
  now?: number;
}): Promise<number> {
  const context = await loadContext(input.sessionId);
  const now = input.now ?? Date.now();
  return db.transaction("rw", db.productRuntimeSessions, db.productRuntimeEvents, db.ttrpgRuntimeAssetRequests, async () => {
    const session = await db.productRuntimeSessions.get(input.sessionId);
    if (!sameRuntimeMediaOwner(session, context)) fail("Instance 在媒资恢复期间发生变化");
    const expired = await db.ttrpgRuntimeAssetRequests
      .where("[sessionId+status]")
      .equals([input.sessionId, "generating"])
      .filter((row) => (row.processorLeaseExpiresAt ?? 0) <= now)
      .toArray();
    for (const row of expired) {
      const accounting = readRuntimeMediaAccounting(row);
      const attempt = accounting?.attempts.find(item => item.ordinal === row.attemptCount);
      if (accounting && accounting.inherited === null && !attempt && row.attemptCount > 0) {
        await db.ttrpgRuntimeAssetRequests.update(row.id!, {
          status: "queued",
          attemptCount: row.attemptCount - 1,
          processorLeaseId: null,
          processorLeaseExpiresAt: null,
          lastErrorCode: "processor-lease-expired",
          lastErrorDetail: "处理器在发送前中断，任务已恢复到队列。",
          revision: row.revision + 1,
          updatedAt: now,
        });
      } else {
        const unknown = !attempt || attempt.costUsd === null;
        await terminalFailure({ context, requestId: row.id!, leaseId: row.processorLeaseId,
          errorCode: unknown ? "provider-outcome-unknown" : "processor-lease-expired",
          detail: unknown ? "上次发送结果未确认，已保留预算，不能重复发送。" : "上次处理器在接收结果后中断。" });
      }
    }
    return expired.length;
  });
}

export type VisibleTtrpgRuntimeMediaRequestV1 = Omit<TtrpgRuntimeAssetRequestRecordV1,
  "prompt" | "negativePrompt" | "processorLeaseId" | "processorLeaseExpiresAt" | "lastErrorDetail" | "attemptAccountingJson"
> & { canRetry: boolean; canResume: boolean; hasUnresolvedAttempt: boolean };

export async function readVisibleTtrpgRuntimeMediaRequestsV1(input: {
  sessionId: number;
  viewerKey: string;
}): Promise<VisibleTtrpgRuntimeMediaRequestV1[]> {
  const viewerKey = key(input.viewerKey, "viewerKey");
  const context = await loadContext(input.sessionId, false);
  return db.transaction("r", scopeTransactionTables(
    db.productRuntimeSessions, db.productRuntimeEvents,
    db.ttrpgSessionParticipants, db.ttrpgRuntimeAssetRequests,
  ), async () => {
    await resolveScope({ scope: context.scope });
    const session = await db.productRuntimeSessions.get(input.sessionId);
    if (!session || session.runtimeSourceHash !== context.runtimeSourceHash ||
      session.productBuildId !== context.session.productBuildId || session.productReleaseId !== context.session.productReleaseId ||
      session.projectId !== context.scope.projectId || session.worldId !== context.scope.worldId || session.workId !== context.scope.workId) fail("Instance 在读取期间发生变化");
    const participants = await readTtrpgSessionParticipantsV2(input.sessionId);
    const participant = participants.find(row => row.viewerKey === viewerKey);
    if (!participant) fail("viewer 不属于该 TTRPG Instance");
    const visible = visibleSlotKeys(context, participant, (await stateAndEvents(session)).state);
    const rows = await db.ttrpgRuntimeAssetRequests.where("sessionId").equals(input.sessionId).sortBy("createdAt");
    const committedUsd = rows.reduce((sum, row) => sum + committedRuntimeMediaCost(row), 0);
    return rows.filter(row => {
      const slot = context.manifest.slots.find(item => item.slotKey === row.slotKey);
      return slot && visible.has(slot.slotKey) && row.projectId === context.scope.projectId &&
        row.worldId === context.scope.worldId && row.workId === context.scope.workId &&
        row.kind === slot.kind && row.targetRef === slot.targetRef && row.audience === slot.audience &&
        row.fallbackText === slot.fallbackText && row.altText === slot.altText && canSeeAudience({
        participant,
        audience: row.audience,
        targetRef: row.targetRef,
      });
    })
    .map((row) => {
      const {
        prompt: _prompt,
        negativePrompt: _negativePrompt,
        processorLeaseId: _lease,
        processorLeaseExpiresAt: _expires,
        lastErrorDetail: _detail,
        attemptAccountingJson: _accounting,
        ...visible
      } = row;
      const canManage = participant.role === "gm" || row.requesterViewerKey === viewerKey;
      return { ...visible, canResume: canManage && row.status === "queued" &&
          row.attemptCount < row.maximumAttempts && hasRuntimeMediaDispatchAuthority(row) &&
          committedUsd <= context.manifest.runtimePolicy.maximumSessionCostUsd,
        canRetry: canManage && canRetryRuntimeMedia(row, committedUsd,
        context.manifest.runtimePolicy.maximumSessionCostUsd),
        hasUnresolvedAttempt: hasUnresolvedRuntimeMediaAttempt(row) };
    });
  });
}

export async function readTtrpgRuntimeMediaBlobV1(input: {
  scope: WorkspaceScope;
  sessionId: number;
  viewerKey: string;
} & (
  | { runtimeAsset: TtrpgViewerRuntimeMediaRefV1; mediaAssetId?: never }
  | { mediaAssetId: number; runtimeAsset?: never }
)): Promise<Blob> {
  const scope = await resolveScope({ scope: input.scope });
  // Backups remap the row FK; a replayed event can still carry the old local ID.
  // Resolve that locator through the exact replayed slot and the viewer's owned request.
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (!session || session.projectId !== scope.projectId || session.worldId !== scope.worldId ||
    session.workId !== scope.workId) fail("viewer 不能读取该运行时媒资");
  const visible = await readVisibleTtrpgRuntimeMediaRequestsV1({
    sessionId: input.sessionId,
    viewerKey: input.viewerKey,
  });
  const slots = (await stateAndEvents(session)).state.ttrpg?.product?.media.slots ?? [];
  const stable = input.runtimeAsset;
  const slot = stable ? slots.find(item => item.status === "available" &&
    item.slotKey === stable.slotKey && item.requestKey === stable.requestKey && item.assetKey === stable.assetKey &&
    item.mediaAssetVersion === stable.version && item.mediaContentHash === stable.contentHash)
    : slots.find(item => item.status === "available" && item.mediaAssetId === input.mediaAssetId);
  if (stable && !slot) fail("viewer 不能读取该运行时媒资");
  const candidates = visible.filter(row => row.status === "available" && (slot
    ? row.requestKey === slot.requestKey && row.slotKey === slot.slotKey &&
      row.mediaAssetVersion === slot.mediaAssetVersion && row.mediaContentHash === slot.mediaContentHash
    : row.mediaAssetId === input.mediaAssetId));
  // Stable reads fail closed if restored rows do not prove one exact binding.
  if (stable && candidates.length !== 1) fail("viewer 不能读取该运行时媒资");
  const request = candidates[0];
  if (!request?.mediaAssetId || !request.mediaContentHash || request.mediaAssetVersion == null)
    fail("viewer 不能读取该运行时媒资");
  const asset = await db.productMediaAssets.get(request.mediaAssetId);
  if (
    !asset ||
    asset.ownerKind !== "runtime" || asset.productType !== "ttrpg" ||
    asset.productRuntimeSessionId !== input.sessionId || asset.productReleaseId !== null ||
    !(await assertRecordInScope(scope, "productMediaAssets", asset, {
      owner: "work",
    })) ||
    (slot != null && asset.assetKey !== slot.assetKey) ||
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
  const digest = hashProductProductionValueV2(parseTtrpgVisualBibleV1(value));
  return Dexie.currentTransaction ? Dexie.waitFor(digest) : digest;
}

export function assertTtrpgRuntimeMediaHashV1(value: string): string {
  if (!HASH.test(value)) fail("运行时媒资 hash 无效");
  return value;
}
