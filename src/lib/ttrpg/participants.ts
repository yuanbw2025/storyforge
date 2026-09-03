import { db } from "../db/schema";
import type {
  ProductRuntimeSession,
  TtrpgCampaignContentV1,
  TtrpgSessionConsentPolicyV2,
  TtrpgSessionParticipantRecordV2,
} from "../types";

function fail(message: string): never {
  throw new Error(`[ttrpg-participants] ${message}`);
}
function stableKey(value: string, label: string): string {
  const parsed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(parsed)) fail(`${label}无效`);
  return parsed;
}
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

function defaultConsent(hasAi: boolean): TtrpgSessionConsentPolicyV2 {
  return {
    safetyBoundariesAccepted: false,
    aiIdentityDisclosed: !hasAi,
    aiAdviceAllowed: false,
    aiSubstitutionAllowed: false,
    pvpAllowed: false,
    characterDeathAllowed: false,
    sessionLoggingAllowed: true,
    generatedPortraitAllowed: false,
    publicSharingAllowed: false,
  };
}

function assertParticipant(
  row: TtrpgSessionParticipantRecordV2,
): TtrpgSessionParticipantRecordV2 {
  stableKey(row.seatKey, "seatKey");
  stableKey(row.viewerKey, "viewerKey");
  if (
    !Number.isInteger(row.projectId) ||
    row.projectId < 1 ||
    !Number.isInteger(row.worldId) ||
    row.worldId < 1 ||
    !Number.isInteger(row.workId) ||
    row.workId < 1 ||
    !Number.isInteger(row.sessionId) ||
    row.sessionId < 1 ||
    !["gm", "player", "spectator"].includes(row.role) ||
    !["human", "ai", "hybrid", "vacant"].includes(row.controller) ||
    !["assigned", "claimed", "vacant", "left"].includes(row.assignmentState) ||
    !["manual", "initiative", "natural", "pooled"].includes(row.activation) ||
    !["never", "with-owner-consent", "automatic-after-timeout"].includes(
      row.substitutionPolicy,
    ) ||
    !Number.isInteger(row.revision) ||
    row.revision < 1 ||
    !row.lastCommandId.trim() ||
    !row.lastCommandFingerprint
  ) {
    fail(`席位记录无效:${row.seatKey}`);
  }
  if (
    (row.role === "player") !== (row.actorKey != null) ||
    (row.controller === "vacant") !== (row.assignmentState === "vacant") ||
    (row.controller === "ai" && row.humanAssignmentPolicy != null) ||
    (row.controller !== "ai" &&
      row.controller !== "vacant" &&
      row.humanAssignmentPolicy == null) ||
    (row.substitutionPolicy !== "never" &&
      !row.consent.aiSubstitutionAllowed) ||
    ((row.controller === "ai" || row.controller === "hybrid") && !row.aiProfile)
  ) {
    fail(`席位控制权或同意策略不一致:${row.seatKey}`);
  }
  if (row.actorKey) stableKey(row.actorKey, "actorKey");
  if (
    row.aiProfile &&
    (row.aiProfile.latencyBudgetMs < 250 ||
      row.aiProfile.latencyBudgetMs > 120_000 ||
      row.aiProfile.costBudgetPerSessionUsd < 0 ||
      row.aiProfile.costBudgetPerSessionUsd > 10_000)
  ) {
    fail(`AI 席位预算无效:${row.seatKey}`);
  }
  return structuredClone(row);
}

export function buildInitialTtrpgParticipantsV2(input: {
  session: ProductRuntimeSession;
  campaign: TtrpgCampaignContentV1;
  now?: number;
}): TtrpgSessionParticipantRecordV2[] {
  if (
    input.session.kind !== "ttrpg" ||
    input.session.id == null ||
    input.session.worldId == null ||
    input.session.workId == null
  )
    fail("只能为正式 TTRPG Instance 建立席位");
  const now = input.now ?? Date.now();
  const playerTemplates = input.campaign.characterTemplates.filter(
    (character) => character.role === "player",
  );
  const gmMode = input.campaign.gmMode ?? "human";
  const hasAi =
    gmMode !== "human" ||
    playerTemplates.some((character) => character.controller === "ai");
  const common = {
    projectId: input.session.projectId,
    worldGroupId: input.session.worldGroupId ?? null,
    worldId: input.session.worldId,
    workId: input.session.workId,
    sessionId: input.session.id,
    sessionZeroAcceptedAtSequence: null,
    revision: 1,
    lastCommandId: "ttrpg-participants.initial-v2",
    lastCommandFingerprint: "initial-v2",
    createdAt: now,
    updatedAt: now,
  };
  const gm: TtrpgSessionParticipantRecordV2 = {
    ...common,
    seatKey: "gm",
    role: "gm",
    controller: gmMode,
    actorKey: null,
    viewerKey: "viewer.gm",
    assignmentState: "assigned",
    humanAssignmentPolicy: gmMode === "ai" ? null : "owner",
    activation: "manual",
    substitutionPolicy: "never",
    aiProfile:
      gmMode === "human"
        ? null
        : {
            agency: "balanced",
            riskTolerance: "balanced",
            latencyBudgetMs: 30_000,
            costBudgetPerSessionUsd: 5,
          },
    consent: defaultConsent(hasAi),
  };
  const players = playerTemplates.map(
    (template, index): TtrpgSessionParticipantRecordV2 => {
      const sourceController = template.controller ?? "human";
      if (sourceController === "gm")
        fail(`玩家角色不能使用 gm controller:${template.characterKey}`);
      const controller =
        sourceController === "open" ? "vacant" : sourceController;
      const seatKey = template.seatKey ?? `player.${index + 1}`;
      return {
        ...common,
        seatKey,
        role: "player",
        controller,
        actorKey: template.characterKey,
        viewerKey: `viewer.${seatKey}`,
        assignmentState: controller === "vacant" ? "vacant" : "assigned",
        humanAssignmentPolicy:
          controller === "ai"
            ? null
            : controller === "vacant"
              ? null
              : "claim-at-session-zero",
        activation: controller === "ai" ? "initiative" : "manual",
        substitutionPolicy: "never",
        aiProfile:
          controller === "ai"
            ? {
                agency: "balanced",
                riskTolerance: "balanced",
                latencyBudgetMs: 20_000,
                costBudgetPerSessionUsd: 2,
              }
            : null,
        consent: defaultConsent(hasAi),
      };
    },
  );
  const records = [gm, ...players].map(assertParticipant);
  if (
    new Set(records.map((row) => row.seatKey)).size !== records.length ||
    new Set(records.map((row) => row.viewerKey)).size !== records.length ||
    new Set(players.map((row) => row.actorKey)).size !== players.length
  )
    fail("CampaignPack 席位、viewer 或 actor 重复");
  return records;
}

export async function installInitialTtrpgParticipantsV2(input: {
  session: ProductRuntimeSession;
  campaign: TtrpgCampaignContentV1;
}): Promise<TtrpgSessionParticipantRecordV2[]> {
  const records = buildInitialTtrpgParticipantsV2(input);
  const existing = await db.ttrpgSessionParticipants
    .where("sessionId")
    .equals(input.session.id!)
    .toArray();
  if (existing.length) fail("TTRPG Instance 已存在席位记录");
  const ids = (await db.ttrpgSessionParticipants.bulkAdd(records, {
    allKeys: true,
  })) as number[];
  return records.map((row, index) => ({ ...row, id: ids[index] }));
}

export async function readTtrpgSessionParticipantsV2(
  sessionId: number,
): Promise<TtrpgSessionParticipantRecordV2[]> {
  if (!Number.isInteger(sessionId) || sessionId < 1) fail("sessionId 无效");
  const session = await db.productRuntimeSessions.get(sessionId);
  if (!session || session.kind !== "ttrpg") fail("TTRPG Instance 不存在");
  const rows = (
    await db.ttrpgSessionParticipants
      .where("sessionId")
      .equals(sessionId)
      .sortBy("seatKey")
  ).map(assertParticipant);
  if (!rows.length) fail("TTRPG Instance 缺少正式席位记录");
  if (
    rows.some(
      (row) =>
        row.projectId !== session.projectId ||
        row.worldId !== session.worldId ||
        row.workId !== session.workId,
    )
  ) {
    fail("席位记录与 Instance scope 不一致");
  }
  return rows;
}

export async function configureTtrpgSessionParticipantV2(input: {
  sessionId: number;
  seatKey: string;
  expectedRevision: number;
  commandId: string;
  requestedByViewerKey: string;
  controller?: "human" | "ai" | "hybrid" | "vacant";
  assignmentState?: "assigned" | "claimed" | "vacant" | "left";
  activation?: "manual" | "initiative" | "natural" | "pooled";
  substitutionPolicy?:
    "never" | "with-owner-consent" | "automatic-after-timeout";
  consent?: Partial<TtrpgSessionConsentPolicyV2>;
}): Promise<TtrpgSessionParticipantRecordV2> {
  const seatKey = stableKey(input.seatKey, "seatKey");
  const commandId = stableKey(input.commandId, "commandId");
  const requestedBy = stableKey(
    input.requestedByViewerKey,
    "requestedByViewerKey",
  );
  const commandFingerprint = stableJson({
    seatKey,
    requestedBy,
    controller: input.controller,
    assignmentState: input.assignmentState,
    activation: input.activation,
    substitutionPolicy: input.substitutionPolicy,
    consent: input.consent,
  });
  return db.transaction(
    "rw",
    db.productRuntimeSessions,
    db.productRuntimeEvents,
    db.ttrpgSessionParticipants,
    async () => {
      const session = await db.productRuntimeSessions.get(input.sessionId);
      if (!session || session.kind !== "ttrpg" || session.status !== "active")
        fail("TTRPG Instance 当前不可配置席位");
      const events = await db.productRuntimeEvents
        .where("sessionId")
        .equals(input.sessionId)
        .toArray();
      const rows = await db.ttrpgSessionParticipants
        .where("sessionId")
        .equals(input.sessionId)
        .toArray();
      const sessionZeroCompleted = events.some(
        (event) => event.type === "ttrpg.session-zero.completed",
      );
      if (sessionZeroCompleted)
        fail("Session Zero 完成后不能改变席位控制权或同意策略");
      const current =
        rows.find((row) => row.seatKey === seatKey) ?? fail("席位不存在");
      if (current.lastCommandId === commandId) {
        if (current.lastCommandFingerprint !== commandFingerprint)
          fail("commandId 已被不同席位配置使用");
        return assertParticipant(current);
      }
      const gm = rows.find((row) => row.role === "gm") ?? fail("GM 席位缺失");
      if (requestedBy !== current.viewerKey && requestedBy !== gm.viewerKey)
        fail("只有席位本人或 GM 可以配置该席位");
      if (current.revision !== input.expectedRevision)
        fail("席位已被其他配置更新，请刷新");
      const controller = input.controller ?? current.controller;
      if (current.role === "gm" && controller === "vacant")
        fail("GM 席位不能空缺");
      const consent = { ...current.consent, ...(input.consent ?? {}) };
      const substitutionPolicy =
        input.substitutionPolicy ?? current.substitutionPolicy;
      if (substitutionPolicy !== "never" && !consent.aiSubstitutionAllowed)
        fail("未记录本人同意时禁止 AI 代打");
      const aiEnabled = controller === "ai" || controller === "hybrid";
      if (aiEnabled && !consent.aiIdentityDisclosed)
        fail("启用 AI 前必须确认已披露 AI 身份");
      const now = Date.now();
      const next = assertParticipant({
        ...current,
        controller,
        assignmentState:
          input.assignmentState ??
          (controller === "vacant"
            ? "vacant"
            : current.assignmentState === "vacant"
              ? "assigned"
              : current.assignmentState),
        humanAssignmentPolicy:
          controller === "ai" || controller === "vacant"
            ? null
            : (current.humanAssignmentPolicy ?? "claim-at-session-zero"),
        activation: input.activation ?? current.activation,
        substitutionPolicy,
        aiProfile: aiEnabled
          ? (current.aiProfile ?? {
              agency: "balanced",
              riskTolerance: "balanced",
              latencyBudgetMs: 20_000,
              costBudgetPerSessionUsd: 2,
            })
          : null,
        consent,
        revision: current.revision + 1,
        lastCommandId: commandId,
        lastCommandFingerprint: commandFingerprint,
        updatedAt: now,
      });
      await db.ttrpgSessionParticipants.put(next);
      return next;
    },
  );
}

export async function finalizeTtrpgSessionParticipantsV2(input: {
  sessionId: number;
  selectedCharacterKeys: string[];
  eventSequence: number;
  completedBy: string;
}): Promise<void> {
  const rows = await db.ttrpgSessionParticipants
    .where("sessionId")
    .equals(input.sessionId)
    .toArray();
  if (!rows.length) fail("Session Zero 缺少显式席位记录");
  const selected = new Set(input.selectedCharacterKeys);
  const activeRows = rows.filter(
    (row) =>
      row.role === "gm" || (row.actorKey != null && selected.has(row.actorKey)),
  );
  if (
    activeRows.some(
      (row) =>
        row.controller === "vacant" ||
        row.assignmentState === "vacant" ||
        row.assignmentState === "left",
    )
  ) {
    fail("已选角色存在空缺或离席席位");
  }
  const hasAi = activeRows.some(
    (row) => row.controller === "ai" || row.controller === "hybrid",
  );
  if (hasAi && activeRows.some((row) => !row.consent.aiIdentityDisclosed))
    fail("Session Zero 必须向所有活动席位披露 AI 身份");
  const now = Date.now();
  for (const row of activeRows) {
    await db.ttrpgSessionParticipants.put(
      assertParticipant({
        ...row,
        assignmentState:
          row.assignmentState === "assigned" && row.controller !== "ai"
            ? "claimed"
            : row.assignmentState,
        consent: { ...row.consent, safetyBoundariesAccepted: true },
        sessionZeroAcceptedAtSequence: input.eventSequence,
        revision: row.revision + 1,
        lastCommandId: `session-zero.${input.eventSequence}.${input.completedBy}`,
        lastCommandFingerprint: stableJson({
          eventSequence: input.eventSequence,
          completedBy: input.completedBy,
        }),
        updatedAt: now,
      }),
    );
  }
}

/**
 * Called inside target Instance creation. Controller assignments and durable
 * user preferences may carry forward, but the new release never inherits a
 * completed Session Zero or safety-boundary acceptance.
 */
export async function carryTtrpgContinuationParticipantsV2(input: {
  parentSessionId: number;
  child: ProductRuntimeSession;
  transitionKey: string;
}): Promise<void> {
  if (
    input.child.id == null ||
    input.child.parentSessionId !== input.parentSessionId ||
    input.child.kind !== "ttrpg"
  )
    fail("续团席位目标 Instance 无效");
  const transitionKey = stableKey(input.transitionKey, "transitionKey");
  const [parentRows, childRows] = await Promise.all([
    db.ttrpgSessionParticipants
      .where("sessionId")
      .equals(input.parentSessionId)
      .toArray(),
    db.ttrpgSessionParticipants
      .where("sessionId")
      .equals(input.child.id)
      .toArray(),
  ]);
  if (!parentRows.length || !childRows.length) fail("续团席位记录缺失");
  const parentByIdentity = new Map(
    parentRows.map((row) => [
      row.role === "gm" ? "gm" : `actor:${row.actorKey}`,
      assertParticipant(row),
    ]),
  );
  const now = Date.now();
  const carried = childRows.map((row) => {
    const current = assertParticipant(row);
    const source = parentByIdentity.get(
      current.role === "gm" ? "gm" : `actor:${current.actorKey}`,
    );
    if (
      !source ||
      source.controller === "vacant" ||
      source.assignmentState === "left"
    )
      return current;
    return assertParticipant({
      ...current,
      controller: source.controller,
      assignmentState:
        source.assignmentState === "vacant"
          ? "assigned"
          : source.assignmentState,
      humanAssignmentPolicy:
        source.controller === "ai" ? null : source.humanAssignmentPolicy,
      activation: source.activation,
      substitutionPolicy: source.substitutionPolicy,
      aiProfile: structuredClone(source.aiProfile),
      consent: {
        ...structuredClone(source.consent),
        safetyBoundariesAccepted: false,
      },
      sessionZeroAcceptedAtSequence: null,
      revision: current.revision + 1,
      lastCommandId: `continuation.${transitionKey}`,
      lastCommandFingerprint: stableJson({
        parentSessionId: input.parentSessionId,
        childSessionId: input.child.id,
        transitionKey,
        seatKey: current.seatKey,
      }),
      updatedAt: now,
    });
  });
  await db.ttrpgSessionParticipants.bulkPut(carried);
}

export async function cloneTtrpgSessionParticipantsV2(input: {
  parentSessionId: number;
  child: ProductRuntimeSession;
}): Promise<void> {
  const parentRows = await db.ttrpgSessionParticipants
    .where("sessionId")
    .equals(input.parentSessionId)
    .toArray();
  // Legacy/kernel TTRPG sessions can predate explicit seat authority and do
  // not have a World/Work Instance scope. Branching their event-sourced state
  // must remain possible, but there is no participant authority to fabricate
  // or copy in that case.
  if (!parentRows.length) return;
  if (
    input.child.id == null ||
    input.child.worldId == null ||
    input.child.workId == null
  )
    fail("分支 Instance scope 无效");
  const now = Date.now();
  const rows = parentRows.map((row) =>
    assertParticipant({
      ...row,
      id: undefined,
      projectId: input.child.projectId,
      worldGroupId: input.child.worldGroupId ?? null,
      worldId: input.child.worldId!,
      workId: input.child.workId!,
      sessionId: input.child.id!,
      revision: 1,
      lastCommandId: `branch-from.${input.parentSessionId}`,
      lastCommandFingerprint: stableJson({
        parentSessionId: input.parentSessionId,
        seatKey: row.seatKey,
      }),
      createdAt: now,
      updatedAt: now,
    }),
  );
  await db.ttrpgSessionParticipants.bulkAdd(rows);
}
