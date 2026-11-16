import type {
  OnlineRoomCommandReceiptV1,
  OnlineRoomCommandV1,
  OnlineRoomMemberV1,
  OnlineRoomVisibleEventV1,
} from "./room-authority";
import type {
  OnlineRoomReconnectResultV1,
  OnlineRoomTransportV1,
} from "./room-client";

export class OnlineRoomTransportErrorV1 extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly status: number | null = null,
  ) {
    super(`[online-room-transport:${code}] ${message}`);
    this.name = "OnlineRoomTransportErrorV1";
  }
}

interface FetchLikeResponseV1 {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

type FetchLikeV1 = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<FetchLikeResponseV1>;

export interface OnlineRoomCredentialBundleV1 {
  roomId: string;
  releaseHash: string;
  member: OnlineRoomMemberV1;
  authToken: string;
  cursor: number;
}

/**
 * Ephemeral navigation payload produced by an accepted LFG application.
 * It deliberately contains no persistence helpers: the account and invite
 * credentials may only travel through mounted product state until the player
 * explicitly confirms the join.
 */
export interface OnlineRoomJoinHandoffV1 {
  roomId: string;
  releaseHash: string;
  actorKey: string;
  inviteId: string;
  inviteToken: string;
  displayName: string;
  memberAccessToken: string;
  expiresAt: number;
}

export interface HostedOnlineRoomTransportV1 extends OnlineRoomTransportV1 {
  createRoom(input: {
    requestId: string;
    roomId: string;
    releaseHash: string;
    selectedCharacterKeys: string[];
    creatorAccessToken: string;
    gmDisplayName: string;
  }): Promise<OnlineRoomCredentialBundleV1>;
  issueInvite(input: {
    roomId: string;
    gmMemberId: string;
    gmAuthToken: string;
    role: "player" | "spectator";
    actorKey: string | null;
    expiresAt: number;
    maximumUses: number;
  }): Promise<{ inviteId: string; inviteToken: string }>;
  joinRoom(input: {
    roomId: string;
    inviteId: string;
    inviteToken: string;
    displayName: string;
  }): Promise<OnlineRoomCredentialBundleV1>;
  joinAuthenticatedRoom(input: {
    requestId: string;
    roomId: string;
    inviteId: string;
    inviteToken: string;
    memberAccessToken: string;
    displayName: string;
  }): Promise<OnlineRoomCredentialBundleV1>;
  resumeAuthenticatedRoom(input: {
    roomId: string;
    memberAccessToken: string;
  }): Promise<OnlineRoomCredentialBundleV1>;
  waitForAdvance(input: {
    roomId: string;
    memberId: string;
    authToken: string;
    afterSequence: number;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<{ cursor: number; timedOut: boolean }>;
  listMembers(input: {
    roomId: string;
    memberId: string;
    authToken: string;
  }): Promise<OnlineRoomMemberV1[]>;
  proposeGmTransfer(input: {
    roomId: string;
    gmMemberId: string;
    gmAuthToken: string;
    targetMemberId: string;
    expiresAt: number;
  }): Promise<{
    transferId: string;
    target: OnlineRoomMemberV1;
    expiresAt: number;
    acceptedSequence: number;
  }>;
  acceptGmTransfer(input: {
    roomId: string;
    memberId: string;
    authToken: string;
    transferId: string;
  }): Promise<{
    formerGm: OnlineRoomMemberV1;
    gm: OnlineRoomMemberV1;
    acceptedSequence: number;
  }>;
  cancelGmTransfer(input: {
    roomId: string;
    gmMemberId: string;
    gmAuthToken: string;
    transferId: string;
  }): Promise<{ cancelled: true; acceptedSequence: number }>;
}

function fail(
  code: string,
  message: string,
  retryable = false,
  status: number | null = null,
): never {
  throw new OnlineRoomTransportErrorV1(code, message, retryable, status);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("protocol", `${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
  label: string,
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    actual.some((key) => !expected.includes(key))
  ) {
    fail("protocol", `${label} 字段不符合协议`);
  }
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || Number(value) < minimum)
    fail("protocol", `${label} 无效`);
  return Number(value);
}

function string(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    fail("protocol", `${label} 无效`);
  return value;
}

function parseMember(value: unknown): OnlineRoomMemberV1 {
  const member = record(value, "member");
  exactKeys(
    member,
    [
      "memberId",
      "displayName",
      "role",
      "actorKey",
      "connected",
      "joinedAt",
      "lastSeenAt",
    ],
    "member",
  );
  if (!["gm", "player", "spectator"].includes(String(member.role)))
    fail("protocol", "member.role 无效");
  if (typeof member.connected !== "boolean")
    fail("protocol", "member.connected 无效");
  return {
    memberId: string(member.memberId, "member.memberId", 200),
    displayName: string(member.displayName, "member.displayName", 100),
    role: member.role as OnlineRoomMemberV1["role"],
    actorKey:
      member.actorKey == null
        ? null
        : string(member.actorKey, "member.actorKey", 200),
    connected: member.connected,
    joinedAt: integer(member.joinedAt, "member.joinedAt"),
    lastSeenAt: integer(member.lastSeenAt, "member.lastSeenAt"),
  };
}

function parseVisibleEvent(value: unknown): OnlineRoomVisibleEventV1 {
  const event = record(value, "event");
  exactKeys(
    event,
    [
      "sequence",
      "eventType",
      "publicPayload",
      "privatePayload",
      "resultingStateHash",
      "createdAt",
    ],
    "event",
  );
  const resultingStateHash = string(
    event.resultingStateHash,
    "event.resultingStateHash",
    64,
  );
  if (!/^[0-9a-f]{64}$/.test(resultingStateHash))
    fail("protocol", "event.resultingStateHash 不是 sha256");
  return {
    sequence: integer(event.sequence, "event.sequence", 1),
    eventType: string(event.eventType, "event.eventType", 200),
    publicPayload: structuredClone(event.publicPayload),
    privatePayload: structuredClone(event.privatePayload),
    resultingStateHash,
    createdAt: integer(event.createdAt, "event.createdAt"),
  };
}

function parseReceipt(value: unknown): OnlineRoomCommandReceiptV1 {
  const receipt = record(value, "receipt");
  exactKeys(
    receipt,
    ["requestId", "acceptedSequence", "event", "duplicate"],
    "receipt",
  );
  if (typeof receipt.duplicate !== "boolean")
    fail("protocol", "receipt.duplicate 无效");
  const event = parseVisibleEvent(receipt.event);
  const acceptedSequence = integer(
    receipt.acceptedSequence,
    "receipt.acceptedSequence",
    1,
  );
  if (acceptedSequence !== event.sequence)
    fail("protocol", "receipt sequence 不一致");
  return {
    requestId: string(receipt.requestId, "receipt.requestId", 200),
    acceptedSequence,
    event,
    duplicate: receipt.duplicate,
  };
}

function parseReconnect(value: unknown): OnlineRoomReconnectResultV1 {
  const reconnect = record(value, "reconnect");
  exactKeys(
    reconnect,
    ["cursor", "member", "events", "projection"],
    "reconnect",
  );
  const cursor = integer(reconnect.cursor, "reconnect.cursor");
  if (!Array.isArray(reconnect.events))
    fail("protocol", "reconnect.events 必须是数组");
  const events = reconnect.events.map(parseVisibleEvent);
  if (
    events.some(
      (event, index) =>
        event.sequence > cursor ||
        (index > 0 && event.sequence <= events[index - 1].sequence),
    )
  ) {
    fail("protocol", "reconnect.events 游标顺序无效");
  }
  return {
    cursor,
    member: parseMember(reconnect.member),
    events,
    projection: structuredClone(reconnect.projection),
  };
}

function normalizedBaseUrl(baseUrl: string): string {
  const value = baseUrl.trim().replace(/\/+$/, "");
  if (!value || /[?#]/.test(value)) fail("configuration", "在线服务地址无效");
  return value;
}

/**
 * Strict HTTP adapter for the authoritative room API. Credentials are sent in
 * JSON bodies only, never query strings, so reconnects and commands do not
 * leak bearer material through URLs or intermediary access logs.
 */
export class HttpOnlineRoomTransportV1 implements HostedOnlineRoomTransportV1 {
  private readonly baseUrl: string;

  constructor(input: {
    baseUrl: string;
    fetch?: FetchLikeV1;
    timeoutMs?: number;
  }) {
    this.baseUrl = normalizedBaseUrl(input.baseUrl);
    this.fetchImpl =
      input.fetch ?? (globalThis.fetch as unknown as FetchLikeV1);
    this.timeoutMs = input.timeoutMs ?? 15_000;
    if (typeof this.fetchImpl !== "function")
      fail("configuration", "运行环境没有 fetch");
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 100 ||
      this.timeoutMs > 120_000
    ) {
      fail("configuration", "timeoutMs 必须为 100～120000");
    }
  }

  private readonly fetchImpl: FetchLikeV1;
  private readonly timeoutMs: number;

  async createRoom(input: {
    requestId: string;
    roomId: string;
    releaseHash: string;
    selectedCharacterKeys: string[];
    creatorAccessToken: string;
    gmDisplayName: string;
  }): Promise<OnlineRoomCredentialBundleV1> {
    const value = record(
      await this.post("/v1/rooms", { protocolVersion: 1, ...input }),
      "create room",
    );
    exactKeys(
      value,
      ["roomId", "releaseHash", "member", "authToken", "cursor"],
      "create room",
    );
    const releaseHash = string(
      value.releaseHash,
      "create room.releaseHash",
      64,
    );
    if (!/^[0-9a-f]{64}$/.test(releaseHash))
      fail("protocol", "create room.releaseHash 不是 sha256");
    return {
      roomId: string(value.roomId, "create room.roomId", 200),
      releaseHash,
      member: parseMember(value.member),
      authToken: string(value.authToken, "create room.authToken", 500),
      cursor: integer(value.cursor, "create room.cursor"),
    };
  }

  async issueInvite(input: {
    roomId: string;
    gmMemberId: string;
    gmAuthToken: string;
    role: "player" | "spectator";
    actorKey: string | null;
    expiresAt: number;
    maximumUses: number;
  }): Promise<{ inviteId: string; inviteToken: string }> {
    const value = record(
      await this.post("/v1/rooms/invites", { protocolVersion: 1, ...input }),
      "room invite",
    );
    exactKeys(value, ["inviteId", "inviteToken"], "room invite");
    return {
      inviteId: string(value.inviteId, "room invite.inviteId", 200),
      inviteToken: string(value.inviteToken, "room invite.inviteToken", 500),
    };
  }

  async joinRoom(input: {
    roomId: string;
    inviteId: string;
    inviteToken: string;
    displayName: string;
  }): Promise<OnlineRoomCredentialBundleV1> {
    const value = record(
      await this.post("/v1/rooms/join", { protocolVersion: 1, ...input }),
      "join room",
    );
    exactKeys(
      value,
      ["roomId", "releaseHash", "member", "authToken", "cursor"],
      "join room",
    );
    const releaseHash = string(value.releaseHash, "join room.releaseHash", 64);
    if (!/^[0-9a-f]{64}$/.test(releaseHash))
      fail("protocol", "join room.releaseHash 不是 sha256");
    return {
      roomId: string(value.roomId, "join room.roomId", 200),
      releaseHash,
      member: parseMember(value.member),
      authToken: string(value.authToken, "join room.authToken", 500),
      cursor: integer(value.cursor, "join room.cursor"),
    };
  }

  async joinAuthenticatedRoom(input: {
    requestId: string;
    roomId: string;
    inviteId: string;
    inviteToken: string;
    memberAccessToken: string;
    displayName: string;
  }): Promise<OnlineRoomCredentialBundleV1> {
    return this.parseCredentialBundle(
      await this.post("/v1/rooms/join-account", {
        protocolVersion: 1,
        ...input,
      }),
      "account room join",
    );
  }

  async resumeAuthenticatedRoom(input: {
    roomId: string;
    memberAccessToken: string;
  }): Promise<OnlineRoomCredentialBundleV1> {
    return this.parseCredentialBundle(
      await this.post("/v1/rooms/session", {
        protocolVersion: 1,
        ...input,
      }),
      "account room session",
    );
  }

  async waitForAdvance(input: {
    roomId: string;
    memberId: string;
    authToken: string;
    afterSequence: number;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<{ cursor: number; timedOut: boolean }> {
    const { signal, ...body } = input;
    const value = record(
      await this.post(
        "/v1/rooms/wait",
        {
          protocolVersion: 1,
          ...body,
        },
        signal,
      ),
      "room realtime wait",
    );
    exactKeys(value, ["cursor", "timedOut"], "room realtime wait");
    if (typeof value.timedOut !== "boolean")
      fail("protocol", "room realtime wait.timedOut 无效");
    const cursor = integer(value.cursor, "room realtime wait.cursor");
    if (
      cursor < input.afterSequence ||
      (value.timedOut && cursor !== input.afterSequence)
    ) {
      fail("protocol", "room realtime wait.cursor 与请求不一致");
    }
    return { cursor, timedOut: value.timedOut };
  }

  async listMembers(input: {
    roomId: string;
    memberId: string;
    authToken: string;
  }): Promise<OnlineRoomMemberV1[]> {
    const value = record(
      await this.post("/v1/rooms/members", {
        protocolVersion: 1,
        ...input,
      }),
      "room members",
    );
    exactKeys(value, ["members"], "room members");
    if (!Array.isArray(value.members) || value.members.length > 100)
      fail("protocol", "room members.members 无效");
    const members = value.members.map(parseMember);
    const memberIds = members.map((member) => member.memberId);
    const actorKeys = members.flatMap((member) =>
      member.actorKey == null ? [] : [member.actorKey],
    );
    if (
      members.filter(
        (member) => member.role === "gm" && member.actorKey == null,
      ).length !== 1 ||
      members.some(
        (member) => (member.role === "player") !== (member.actorKey != null),
      ) ||
      new Set(memberIds).size !== memberIds.length ||
      new Set(actorKeys).size !== actorKeys.length
    ) {
      fail("protocol", "room members 成员权限或角色席位不一致");
    }
    return members;
  }

  async proposeGmTransfer(input: {
    roomId: string;
    gmMemberId: string;
    gmAuthToken: string;
    targetMemberId: string;
    expiresAt: number;
  }): Promise<{
    transferId: string;
    target: OnlineRoomMemberV1;
    expiresAt: number;
    acceptedSequence: number;
  }> {
    const value = record(
      await this.post("/v1/rooms/gm-transfer", {
        protocolVersion: 1,
        ...input,
      }),
      "gm transfer",
    );
    exactKeys(
      value,
      ["transferId", "target", "expiresAt", "acceptedSequence"],
      "gm transfer",
    );
    const transferId = string(value.transferId, "gm transfer.transferId", 200);
    const target = parseMember(value.target);
    if (
      !/^transfer\.[A-Za-z0-9-]+$/.test(transferId) ||
      target.role !== "player" ||
      !target.connected ||
      !target.actorKey ||
      target.memberId !== input.targetMemberId ||
      value.expiresAt !== input.expiresAt
    ) {
      fail("protocol", "gm transfer 目标或编号无效");
    }
    return {
      transferId,
      target,
      expiresAt: integer(value.expiresAt, "gm transfer.expiresAt", 1),
      acceptedSequence: integer(
        value.acceptedSequence,
        "gm transfer.acceptedSequence",
        1,
      ),
    };
  }

  async acceptGmTransfer(input: {
    roomId: string;
    memberId: string;
    authToken: string;
    transferId: string;
  }): Promise<{
    formerGm: OnlineRoomMemberV1;
    gm: OnlineRoomMemberV1;
    acceptedSequence: number;
  }> {
    const value = record(
      await this.post("/v1/rooms/gm-transfer/accept", {
        protocolVersion: 1,
        ...input,
      }),
      "accept gm transfer",
    );
    exactKeys(
      value,
      ["formerGm", "gm", "acceptedSequence"],
      "accept gm transfer",
    );
    const formerGm = parseMember(value.formerGm);
    const gm = parseMember(value.gm);
    if (
      formerGm.role !== "player" ||
      !formerGm.actorKey ||
      gm.role !== "gm" ||
      gm.actorKey != null ||
      formerGm.memberId === gm.memberId
    ) {
      fail("protocol", "accept gm transfer 成员权限交换无效");
    }
    return {
      formerGm,
      gm,
      acceptedSequence: integer(
        value.acceptedSequence,
        "accept gm transfer.acceptedSequence",
        1,
      ),
    };
  }

  async cancelGmTransfer(input: {
    roomId: string;
    gmMemberId: string;
    gmAuthToken: string;
    transferId: string;
  }): Promise<{ cancelled: true; acceptedSequence: number }> {
    const value = record(
      await this.post("/v1/rooms/gm-transfer/cancel", {
        protocolVersion: 1,
        ...input,
      }),
      "cancel gm transfer",
    );
    exactKeys(value, ["cancelled", "acceptedSequence"], "cancel gm transfer");
    if (value.cancelled !== true)
      fail("protocol", "cancel gm transfer.cancelled 无效");
    return {
      cancelled: true,
      acceptedSequence: integer(
        value.acceptedSequence,
        "cancel gm transfer.acceptedSequence",
        1,
      ),
    };
  }

  submit(command: OnlineRoomCommandV1): Promise<OnlineRoomCommandReceiptV1> {
    return this.post("/v1/rooms/commands", command).then(parseReceipt);
  }

  reconnect(input: {
    roomId: string;
    memberId: string;
    authToken: string;
    afterSequence: number;
  }): Promise<OnlineRoomReconnectResultV1> {
    return this.post("/v1/rooms/reconnect", {
      protocolVersion: 1,
      ...input,
    }).then(parseReconnect);
  }

  async disconnect(input: {
    roomId: string;
    memberId: string;
    authToken: string;
  }): Promise<void> {
    const result = record(
      await this.post("/v1/rooms/disconnect", { protocolVersion: 1, ...input }),
      "disconnect",
    );
    exactKeys(result, ["disconnected"], "disconnect");
    if (result.disconnected !== true) fail("protocol", "disconnect 回执无效");
  }

  private parseCredentialBundle(
    value: unknown,
    label: string,
  ): OnlineRoomCredentialBundleV1 {
    const bundle = record(value, label);
    exactKeys(
      bundle,
      ["roomId", "releaseHash", "member", "authToken", "cursor"],
      label,
    );
    const releaseHash = string(bundle.releaseHash, `${label}.releaseHash`, 64);
    if (!/^[0-9a-f]{64}$/.test(releaseHash))
      fail("protocol", `${label}.releaseHash 不是 sha256`);
    return {
      roomId: string(bundle.roomId, `${label}.roomId`, 200),
      releaseHash,
      member: parseMember(bundle.member),
      authToken: string(bundle.authToken, `${label}.authToken`, 500),
      cursor: integer(bundle.cursor, `${label}.cursor`),
    };
  }

  private async post(
    path: string,
    body: unknown,
    externalSignal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else
      externalSignal?.addEventListener("abort", abortFromCaller, {
        once: true,
      });
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        // A native fetch body is still cancellable after its headers arrive.
        // Preserve timeout/caller-abort classification in the outer catch.
        if (controller.signal.aborted) throw error;
        fail(
          "invalid_response",
          "在线房间服务返回了非 JSON 响应",
          response.status >= 500,
          response.status,
        );
      }
      if (!response.ok) {
        const error = record(payload, "error response");
        const code =
          typeof error.code === "string" && error.code
            ? error.code
            : `http_${response.status}`;
        const message =
          typeof error.message === "string" && error.message
            ? error.message
            : "在线房间请求失败";
        fail(
          code,
          message,
          response.status === 408 ||
            response.status === 429 ||
            response.status >= 500,
          response.status,
        );
      }
      return payload;
    } catch (error) {
      if (externalSignal?.aborted)
        fail("request_aborted", "在线房间请求已取消", true);
      if (controller.signal.aborted) fail("timeout", "在线房间请求超时", true);
      if (error instanceof OnlineRoomTransportErrorV1) throw error;
      fail(
        "transport_unavailable",
        error instanceof Error ? error.message : "在线房间服务不可达",
        true,
      );
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

export function configuredOnlineRoomTransportV1(): HttpOnlineRoomTransportV1 | null {
  const baseUrl = import.meta.env.VITE_STORYFORGE_ONLINE_SERVICE_URL?.trim();
  return baseUrl ? new HttpOnlineRoomTransportV1({ baseUrl }) : null;
}
