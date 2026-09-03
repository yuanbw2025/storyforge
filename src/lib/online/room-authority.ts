import { hashCanonicalValue } from "../agent/run/hash";

export type OnlineRoomRoleV1 = "gm" | "player" | "spectator";
export type OnlineRoomCommandKindV1 =
  | "safety.pause"
  | "safety.resume"
  | "scene.open"
  | "clue.reveal"
  | "ending.choose"
  | "gm.narrate"
  | "intent.submit"
  | "rule.action"
  | "human.response"
  | "item.command"
  | "rest.complete"
  | "effects.apply"
  | "effects.choice.propose"
  | "effects.choice.resolve"
  | "campaign.session.start"
  | "campaign.session.complete"
  | "ai.player.run"
  | "ai.gm.act"
  | "ai.gm.narrate"
  | "chat.message"
  | "dice.request"
  | "tabletop.move"
  | "tabletop.fog"
  | "tabletop.layer";

export interface OnlineRoomMemberV1 {
  memberId: string;
  displayName: string;
  role: OnlineRoomRoleV1;
  actorKey: string | null;
  connected: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

export interface OnlineRoomCommandV1 {
  protocolVersion: 1;
  roomId: string;
  releaseHash: string;
  requestId: string;
  memberId: string;
  authToken: string;
  expectedSequence: number;
  kind: OnlineRoomCommandKindV1;
  actorKey: string | null;
  payload: unknown;
}

export interface OnlineRoomDomainEventV1 {
  eventType: string;
  publicPayload: unknown;
  gmPrivatePayload?: unknown;
  privatePayloadByMemberId?: Record<string, unknown>;
  resultingStateHash: string;
}

export interface OnlineRoomDomainAdapterV1 {
  apply(input: {
    roomId: string;
    releaseHash: string;
    sequence: number;
    member: OnlineRoomMemberV1;
    /** Credential-free roster snapshot used for actor-seat private routing. */
    members: OnlineRoomMemberV1[];
    command: Omit<OnlineRoomCommandV1, "authToken">;
  }): Promise<OnlineRoomDomainEventV1>;
  project(input: {
    roomId: string;
    releaseHash: string;
    sequence: number;
    member: OnlineRoomMemberV1;
    members: OnlineRoomMemberV1[];
  }): Promise<unknown>;
  /**
   * Durable rooms require both hooks. The checkpoint must contain only the
   * deterministic domain state needed to continue applying room commands.
   */
  exportCheckpoint?(): Promise<unknown>;
  restoreCheckpoint?(checkpoint: unknown): Promise<void>;
}

export interface OnlineRoomVisibleEventV1 {
  sequence: number;
  eventType: string;
  publicPayload: unknown;
  privatePayload: unknown | null;
  resultingStateHash: string;
  createdAt: number;
}

export interface OnlineRoomCommandReceiptV1 {
  requestId: string;
  acceptedSequence: number;
  event: OnlineRoomVisibleEventV1;
  duplicate: boolean;
}

interface StoredRoomEventV1 extends OnlineRoomDomainEventV1 {
  sequence: number;
  createdAt: number;
}

interface StoredMemberV1 extends OnlineRoomMemberV1 {
  tokenHash: string;
  /** Hash of a deployment-authenticated account principal; never projected. */
  principalHash?: string;
  /** Additional account-resume credentials, bounded to avoid snapshot growth. */
  secondaryTokenHashes?: string[];
}

interface StoredInviteV1 {
  inviteId: string;
  tokenHash: string;
  role: OnlineRoomRoleV1;
  actorKey: string | null;
  expiresAt: number;
  remainingUses: number;
}

interface StoredGmTransferV1 {
  transferId: string;
  fromGmMemberId: string;
  targetMemberId: string;
  targetActorKey: string;
  expiresAt: number;
  createdAt: number;
}

export interface OnlineRoomSnapshotV1 {
  schema: "storyforge.online-room-snapshot";
  version: 1;
  revision: number;
  roomId: string;
  releaseHash: string;
  sequence: number;
  members: StoredMemberV1[];
  invites: StoredInviteV1[];
  events: StoredRoomEventV1[];
  receipts: Array<
    [string, { fingerprint: string; receipt: OnlineRoomCommandReceiptV1 }]
  >;
  rateWindows: Array<[string, number[]]>;
  /** Optional only for reading snapshots created before two-party GM transfer existed. */
  pendingGmTransfer?: StoredGmTransferV1 | null;
  domainCheckpoint: unknown;
  updatedAt: number;
  integrityHash: string;
}

export interface OnlineRoomPersistenceV1 {
  load(roomId: string): Promise<OnlineRoomSnapshotV1 | null>;
  compareAndSwap(input: {
    roomId: string;
    expectedRevision: number | null;
    snapshot: OnlineRoomSnapshotV1;
  }): Promise<boolean>;
}

interface LocalRoomStateV1 {
  revision: number;
  sequence: number;
  members: Map<string, StoredMemberV1>;
  invites: Map<string, StoredInviteV1>;
  events: StoredRoomEventV1[];
  receipts: Map<
    string,
    { fingerprint: string; receipt: OnlineRoomCommandReceiptV1 }
  >;
  rateWindows: Map<string, number[]>;
  pendingGmTransfer: StoredGmTransferV1 | null;
}

export class OnlineRoomAuthorityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(`[online-room:${code}] ${message}`);
    this.name = "OnlineRoomAuthorityError";
  }
}

function fail(code: string, message: string): never {
  throw new OnlineRoomAuthorityError(code, message);
}

function token(): string {
  return `${crypto.randomUUID()}.${crypto.randomUUID()}`;
}

function key(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== "string") fail("protocol", `${label} 必须是字符串`);
  const result = value.trim();
  if (
    !result ||
    result.length > maximum ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)
  ) {
    fail("protocol", `${label} 无效`);
  }
  return result;
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") fail("protocol", `${label} 必须是字符串`);
  const result = value.trim().normalize("NFC");
  if (!result || result.length > maximum) fail("protocol", `${label} 无效`);
  return result;
}

function sha(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!/^[0-9a-f]{64}$/.test(result))
    fail("protocol", `${label} 必须是 sha256`);
  return result;
}

function parseCommand(value: OnlineRoomCommandV1): OnlineRoomCommandV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("protocol", "命令必须是对象");
  const expected = [
    "protocolVersion",
    "roomId",
    "releaseHash",
    "requestId",
    "memberId",
    "authToken",
    "expectedSequence",
    "kind",
    "actorKey",
    "payload",
  ];
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length ||
    actual.some((field) => !expected.includes(field))
  )
    fail("protocol", "命令字段不在闭集");
  if (value.protocolVersion !== 1) fail("protocol_version", "协议版本不受支持");
  const kinds: OnlineRoomCommandKindV1[] = [
    "safety.pause",
    "safety.resume",
    "scene.open",
    "clue.reveal",
    "ending.choose",
    "gm.narrate",
    "intent.submit",
    "rule.action",
    "human.response",
    "item.command",
    "rest.complete",
    "effects.apply",
    "effects.choice.propose",
    "effects.choice.resolve",
    "campaign.session.start",
    "campaign.session.complete",
    "ai.player.run",
    "ai.gm.act",
    "ai.gm.narrate",
    "chat.message",
    "dice.request",
    "tabletop.move",
    "tabletop.fog",
    "tabletop.layer",
  ];
  if (!kinds.includes(value.kind)) fail("protocol", "命令 kind 无效");
  if (!Number.isInteger(value.expectedSequence) || value.expectedSequence < 0)
    fail("protocol", "expectedSequence 无效");
  const encoded = JSON.stringify(value.payload);
  if (encoded === undefined || encoded.length > 64_000)
    fail("payload_too_large", "命令 payload 超过 64KB");
  return {
    protocolVersion: 1,
    roomId: key(value.roomId, "roomId"),
    releaseHash: sha(value.releaseHash, "releaseHash"),
    requestId: key(value.requestId, "requestId"),
    memberId: key(value.memberId, "memberId"),
    authToken: text(value.authToken, "authToken", 500),
    expectedSequence: value.expectedSequence,
    kind: value.kind,
    actorKey: value.actorKey == null ? null : key(value.actorKey, "actorKey"),
    payload: structuredClone(value.payload),
  };
}

function authorize(
  member: OnlineRoomMemberV1,
  command: OnlineRoomCommandV1,
): void {
  if (member.role === "spectator" && command.kind !== "chat.message") {
    fail("forbidden", "观战者不能提交游戏命令");
  }
  if (
    [
      "scene.open", "ending.choose", "gm.narrate", "safety.resume", "effects.apply", "effects.choice.propose",
      "campaign.session.start", "campaign.session.complete",
      "ai.player.run",
      "ai.gm.act",
      "ai.gm.narrate",
    ].includes(
      command.kind,
    ) &&
    member.role !== "gm"
  ) {
    fail("forbidden", "该命令只允许 GM 提交");
  }
  if (
    ["tabletop.fog", "tabletop.layer"].includes(command.kind) &&
    member.role !== "gm"
  ) {
    fail("forbidden", "迷雾和图层命令只允许 GM 提交");
  }
  if (command.kind === "tabletop.move") {
    if (
      member.role === "player" &&
      (!member.actorKey || command.actorKey !== member.actorKey)
    ) {
      fail("actor_spoof", "玩家只能移动自己角色的桌面 token");
    }
    if (member.role !== "gm" && member.role !== "player")
      fail("forbidden", "桌面移动需要游戏席位");
  }
  if (["intent.submit", "rule.action", "dice.request"].includes(command.kind)) {
    if (
      member.role === "player" &&
      (!member.actorKey || command.actorKey !== member.actorKey)
    ) {
      fail("actor_spoof", "玩家只能为自己的已分配角色提交命令");
    }
    if (member.role !== "gm" && member.role !== "player")
      fail("forbidden", "该命令需要游戏席位");
  }
  if (command.kind === "human.response") {
    if (member.role !== "player") {
      fail("forbidden", "真人角色回应只能由已认证的玩家席位提交");
    }
    if (!member.actorKey || command.actorKey !== member.actorKey) {
      fail("actor_spoof", "玩家只能回应自己已分配的角色窗口");
    }
  }
  if (command.kind === "item.command") {
    if (member.role === "player" && (!member.actorKey || command.actorKey !== member.actorKey)) {
      fail("actor_spoof", "玩家只能操作自己角色持有的物品");
    }
    if (member.role !== "gm" && member.role !== "player") {
      fail("forbidden", "物品命令需要游戏席位");
    }
  }
  if (command.kind === "rest.complete") {
    if (member.role !== "gm" || command.actorKey != null) {
      fail("forbidden", "休息结算只能由 GM 提交");
    }
  }
  if (command.kind === "effects.apply" && command.actorKey != null) {
    fail("protocol", "GM 提交后果计划不得伪装成玩家角色命令");
  }
  if (command.kind === "effects.choice.propose" && command.actorKey != null) {
    fail("protocol", "GM 提交玩家后果选择不得伪装成玩家角色命令");
  }
  if (command.kind === "effects.choice.resolve") {
    if (member.role === "player" && (!member.actorKey || command.actorKey !== member.actorKey)) {
      fail("actor_spoof", "玩家只能确认自己角色的后果选择");
    }
    if (member.role === "gm" && command.actorKey == null) {
      fail("protocol", "GM 代管纯 AI 席位选择时必须明确角色");
    }
    if (member.role !== "gm" && member.role !== "player") {
      fail("forbidden", "后果选择需要已认证的游戏席位");
    }
  }
  if (
    ["campaign.session.start", "campaign.session.complete", "ai.player.run", "ai.gm.act", "ai.gm.narrate"].includes(command.kind) &&
    command.actorKey != null
  ) {
    fail("protocol", "GM 服务命令不得由客户端绑定或伪装成玩家角色");
  }
  if (command.kind === "clue.reveal") {
    if (
      member.role === "player" &&
      (!member.actorKey || command.actorKey !== member.actorKey)
    ) {
      fail("actor_spoof", "玩家只能为自己的已分配角色发现线索");
    }
    if (member.role !== "gm" && member.role !== "player")
      fail("forbidden", "线索命令需要游戏席位");
  }
  if (command.kind === "gm.narrate" && command.actorKey != null)
    fail("protocol", "GM 叙事不得伪装成玩家角色命令");
}

function visibleEvent(
  event: StoredRoomEventV1,
  member: OnlineRoomMemberV1,
): OnlineRoomVisibleEventV1 {
  return {
    sequence: event.sequence,
    eventType: event.eventType,
    publicPayload: structuredClone(event.publicPayload),
    privatePayload: structuredClone(
      member.role === "gm"
        ? (event.gmPrivatePayload ?? null)
        : (event.privatePayloadByMemberId?.[member.memberId] ?? null),
    ),
    resultingStateHash: event.resultingStateHash,
    createdAt: event.createdAt,
  };
}

export class AuthoritativeOnlineRoomV1 {
  readonly protocolVersion = 1 as const;
  private revision = 0;
  private sequence = 0;
  private readonly members = new Map<string, StoredMemberV1>();
  private readonly invites = new Map<string, StoredInviteV1>();
  private readonly events: StoredRoomEventV1[] = [];
  private readonly receipts = new Map<
    string,
    { fingerprint: string; receipt: OnlineRoomCommandReceiptV1 }
  >();
  private readonly rateWindows = new Map<string, number[]>();
  private pendingGmTransfer: StoredGmTransferV1 | null = null;
  private mutationTail: Promise<void> = Promise.resolve();

  private constructor(
    readonly roomId: string,
    readonly releaseHash: string,
    private readonly adapter: OnlineRoomDomainAdapterV1,
    private readonly now: () => number,
    private readonly rateLimit: { commands: number; windowMs: number },
    private readonly persistence?: OnlineRoomPersistenceV1,
  ) {}

  static async create(input: {
    roomId: string;
    releaseHash: string;
    gmDisplayName: string;
    /**
     * Hosted deployments may inject a server-issued, replay-stable credential
     * so a lost create response can be recovered with the same provisioning
     * request. Local/offline callers omit it and receive a fresh random token.
     */
    gmAuthToken?: string;
    /** Hosted identity binding; omitted by local and anonymous rooms. */
    gmPrincipalBinding?: string;
    adapter: OnlineRoomDomainAdapterV1;
    now?: () => number;
    rateLimit?: { commands: number; windowMs: number };
    persistence?: OnlineRoomPersistenceV1;
  }): Promise<{
    room: AuthoritativeOnlineRoomV1;
    gm: { member: OnlineRoomMemberV1; authToken: string };
  }> {
    assertDurableAdapter(input.adapter, input.persistence);
    const now = input.now ?? (() => Date.now());
    const room = new AuthoritativeOnlineRoomV1(
      key(input.roomId, "roomId"),
      sha(input.releaseHash, "releaseHash"),
      input.adapter,
      now,
      input.rateLimit ?? { commands: 30, windowMs: 10_000 },
      input.persistence,
    );
    const authToken =
      input.gmAuthToken == null
        ? token()
        : text(input.gmAuthToken, "gmAuthToken", 500);
    const member: StoredMemberV1 = {
      memberId: `member.${crypto.randomUUID()}`,
      displayName: text(input.gmDisplayName, "gmDisplayName", 100),
      role: "gm",
      actorKey: null,
      connected: true,
      joinedAt: now(),
      lastSeenAt: now(),
      tokenHash: await hashCanonicalValue(authToken),
      ...(input.gmPrincipalBinding == null
        ? {}
        : {
            principalHash: await hashCanonicalValue(
              text(input.gmPrincipalBinding, "gmPrincipalBinding", 500),
            ),
          }),
    };
    room.members.set(member.memberId, member);
    await room.persistNewRoom();
    const publicMember = room.publicMember(member);
    return { room, gm: { member: publicMember, authToken } };
  }

  /**
   * Rehydrates the sole GM session using a credential already bound into the
   * durable room snapshot. This is deliberately credential-only: the hosted
   * registry must first authenticate the account and deterministically issue
   * the same opaque credential for the exact original create request.
   */
  async resumeGmWithCredential(authToken: string): Promise<{
    member: OnlineRoomMemberV1;
    authToken: string;
    cursor: number;
  }> {
    return this.runMutation(async () => {
      const normalized = text(authToken, "gmAuthToken", 500);
      const presented = await hashCanonicalValue(normalized);
      const gm = [...this.members.values()].find(
        (member) => member.role === "gm",
      );
      if (!gm || gm.tokenHash !== presented)
        fail("unauthorized", "主持凭据不属于该房间");
      gm.connected = true;
      gm.lastSeenAt = this.now();
      return {
        member: this.publicMember(gm),
        authToken: normalized,
        cursor: this.sequence,
      };
    });
  }

  static async restore(input: {
    roomId: string;
    adapter: OnlineRoomDomainAdapterV1;
    persistence: OnlineRoomPersistenceV1;
    now?: () => number;
    rateLimit?: { commands: number; windowMs: number };
  }): Promise<AuthoritativeOnlineRoomV1> {
    assertDurableAdapter(input.adapter, input.persistence);
    const roomId = key(input.roomId, "roomId");
    const snapshot = await input.persistence.load(roomId);
    if (!snapshot) fail("room_not_found", "持久化房间不存在");
    await verifyOnlineRoomSnapshotV1(snapshot, roomId);
    const room = new AuthoritativeOnlineRoomV1(
      snapshot.roomId,
      snapshot.releaseHash,
      input.adapter,
      input.now ?? (() => Date.now()),
      input.rateLimit ?? { commands: 30, windowMs: 10_000 },
      input.persistence,
    );
    room.restoreLocalState({
      revision: snapshot.revision,
      sequence: snapshot.sequence,
      members: new Map(
        snapshot.members.map((member) => [
          member.memberId,
          structuredClone(member),
        ]),
      ),
      invites: new Map(
        snapshot.invites.map((invite) => [
          invite.inviteId,
          structuredClone(invite),
        ]),
      ),
      events: structuredClone(snapshot.events),
      receipts: new Map(structuredClone(snapshot.receipts)),
      rateWindows: new Map(structuredClone(snapshot.rateWindows)),
      pendingGmTransfer: structuredClone(snapshot.pendingGmTransfer ?? null),
    });
    await input.adapter.restoreCheckpoint!(
      structuredClone(snapshot.domainCheckpoint),
    );
    return room;
  }

  async issueInvite(input: {
    gmMemberId: string;
    gmAuthToken: string;
    role: Exclude<OnlineRoomRoleV1, "gm">;
    actorKey?: string | null;
    expiresAt: number;
    maximumUses?: number;
    /** Server-only deterministic capability used by matchmaking recovery. */
    stableInvite?: { inviteId: string; inviteToken: string };
  }): Promise<{ inviteId: string; inviteToken: string }> {
    return this.runMutation(async () => {
      const gm = await this.authenticate(input.gmMemberId, input.gmAuthToken);
      if (gm.role !== "gm") fail("forbidden", "只有 GM 可以签发邀请");
      if (!Number.isFinite(input.expiresAt) || input.expiresAt <= this.now())
        fail("invite", "邀请过期时间无效");
      const maximumUses = input.maximumUses ?? 1;
      if (!Number.isInteger(maximumUses) || maximumUses < 1 || maximumUses > 20)
        fail("invite", "邀请使用次数无效");
      const actorKey =
        input.actorKey == null ? null : key(input.actorKey, "actorKey");
      if (input.role === "player" && !actorKey)
        fail("invite", "玩家邀请必须绑定角色席位");
      if (input.role === "spectator" && actorKey)
        fail("invite", "观战邀请不能绑定角色");
      const stableInvite =
        input.stableInvite == null
          ? null
          : {
              inviteId: key(
                input.stableInvite.inviteId,
                "stableInvite.inviteId",
              ),
              inviteToken: text(
                input.stableInvite.inviteToken,
                "stableInvite.inviteToken",
                500,
              ),
            };
      if (stableInvite) {
        const existing = this.invites.get(stableInvite.inviteId);
        if (existing) {
          const tokenHash = await hashCanonicalValue(stableInvite.inviteToken);
          if (
            existing.tokenHash !== tokenHash ||
            existing.role !== input.role ||
            existing.actorKey !== actorKey ||
            existing.expiresAt !== input.expiresAt
          ) {
            fail("request_conflict", "稳定邀请 ID 已被不同邀请占用");
          }
          return stableInvite;
        }
      }
      if (
        actorKey &&
        [...this.members.values()].some(
          (member) => member.actorKey === actorKey,
        )
      )
        fail("seat_taken", "角色席位已经占用");
      const inviteToken = stableInvite?.inviteToken ?? token();
      const invite: StoredInviteV1 = {
        inviteId: stableInvite?.inviteId ?? `invite.${crypto.randomUUID()}`,
        tokenHash: await hashCanonicalValue(inviteToken),
        role: input.role,
        actorKey,
        expiresAt: input.expiresAt,
        remainingUses: maximumUses,
      };
      this.invites.set(invite.inviteId, invite);
      return { inviteId: invite.inviteId, inviteToken };
    });
  }

  async join(input: {
    inviteId: string;
    inviteToken: string;
    displayName: string;
    /** Hosted account join. Both values must be supplied together. */
    principalBinding?: string;
    memberAuthToken?: string;
  }): Promise<{
    member: OnlineRoomMemberV1;
    authToken: string;
    cursor: number;
  }> {
    return this.runMutation(async () => {
      if (
        (input.principalBinding == null) !==
        (input.memberAuthToken == null)
      ) {
        fail("protocol", "账号身份绑定和成员凭据必须同时提供");
      }
      const principalHash =
        input.principalBinding == null
          ? null
          : await hashCanonicalValue(
              text(input.principalBinding, "principalBinding", 500),
            );
      const suppliedAuthToken =
        input.memberAuthToken == null
          ? null
          : text(input.memberAuthToken, "memberAuthToken", 500);
      if (principalHash && suppliedAuthToken) {
        const existing = [...this.members.values()].find(
          (member) => member.principalHash === principalHash,
        );
        if (existing) {
          const presented = await hashCanonicalValue(suppliedAuthToken);
          if (!this.memberAcceptsTokenHash(existing, presented)) {
            fail("unauthorized", "账号已绑定房间席位，但恢复凭据无效");
          }
          existing.connected = true;
          existing.lastSeenAt = this.now();
          return {
            member: this.publicMember(existing),
            authToken: suppliedAuthToken,
            cursor: this.sequence,
          };
        }
      }
      const invite = this.invites.get(key(input.inviteId, "inviteId"));
      if (
        !invite ||
        invite.expiresAt <= this.now() ||
        invite.remainingUses < 1 ||
        invite.tokenHash !==
          (await hashCanonicalValue(
            text(input.inviteToken, "inviteToken", 500),
          ))
      ) {
        fail("invite_invalid", "邀请不存在、已过期或凭据无效");
      }
      if (
        invite.actorKey &&
        [...this.members.values()].some(
          (member) => member.actorKey === invite.actorKey,
        )
      ) {
        fail("seat_taken", "角色席位已经占用");
      }
      const authToken = suppliedAuthToken ?? token();
      const member: StoredMemberV1 = {
        memberId: `member.${crypto.randomUUID()}`,
        displayName: text(input.displayName, "displayName", 100),
        role: invite.role,
        actorKey: invite.actorKey,
        connected: true,
        joinedAt: this.now(),
        lastSeenAt: this.now(),
        tokenHash: await hashCanonicalValue(authToken),
        ...(principalHash ? { principalHash } : {}),
      };
      this.members.set(member.memberId, member);
      invite.remainingUses -= 1;
      const publicMember = this.publicMember(member);
      return { member: publicMember, authToken, cursor: this.sequence };
    });
  }

  /**
   * Server-side account recovery boundary. The caller must authenticate the
   * external account before presenting its principal binding here. No account
   * identifier or credential is ever included in player projections/events.
   */
  async resumeMemberByPrincipal(input: {
    principalBinding: string;
    memberAuthToken: string;
  }): Promise<{
    member: OnlineRoomMemberV1;
    authToken: string;
    cursor: number;
  }> {
    return this.runMutation(async () => {
      const principalHash = await hashCanonicalValue(
        text(input.principalBinding, "principalBinding", 500),
      );
      const member = [...this.members.values()].find(
        (row) => row.principalHash === principalHash,
      );
      if (!member) fail("room_not_found", "账号尚未绑定该房间席位");
      const authToken = text(input.memberAuthToken, "memberAuthToken", 500);
      const tokenHash = await hashCanonicalValue(authToken);
      if (!this.memberAcceptsTokenHash(member, tokenHash)) {
        const hashes = [...(member.secondaryTokenHashes ?? []), tokenHash];
        member.secondaryTokenHashes = [...new Set(hashes)].slice(-4);
      }
      member.connected = true;
      member.lastSeenAt = this.now();
      return {
        member: this.publicMember(member),
        authToken,
        cursor: this.sequence,
      };
    });
  }

  async submit(
    value: OnlineRoomCommandV1,
  ): Promise<OnlineRoomCommandReceiptV1> {
    return this.runMutation(async () => {
      const command = parseCommand(value);
      if (command.roomId !== this.roomId)
        fail("room_mismatch", "命令 roomId 不属于当前房间");
      if (command.releaseHash !== this.releaseHash)
        fail("release_spoof", "命令伪造或使用了过期 ProductRelease");
      const member = await this.authenticate(
        command.memberId,
        command.authToken,
      );
      authorize(member, command);
      const fingerprint = await hashCanonicalValue({
        ...command,
        authToken: undefined,
      });
      const receiptKey = `${member.memberId}\u0000${command.requestId}`;
      const prior = this.receipts.get(receiptKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          fail("request_conflict", "requestId 已被不同命令使用");
        return { ...structuredClone(prior.receipt), duplicate: true };
      }
      if (command.expectedSequence !== this.sequence)
        fail("stale_cursor", `房间已推进到 #${this.sequence}`);
      this.enforceRateLimit(member.memberId);
      const { authToken: _authToken, ...safeCommand } = command;
      const applied = await this.adapter.apply({
        roomId: this.roomId,
        releaseHash: this.releaseHash,
        sequence: this.sequence + 1,
        member: this.publicMember(member),
        members: [...this.members.values()].map((row) =>
          this.publicMember(row),
        ),
        command: safeCommand,
      });
      if (
        !applied.eventType.trim() ||
        !/^[0-9a-f]{64}$/.test(applied.resultingStateHash)
      ) {
        fail("adapter_invalid", "领域适配器返回了无效事件或状态哈希");
      }
      const event: StoredRoomEventV1 = {
        ...structuredClone(applied),
        sequence: this.sequence + 1,
        createdAt: this.now(),
      };
      this.sequence = event.sequence;
      this.events.push(event);
      member.lastSeenAt = this.now();
      const receipt: OnlineRoomCommandReceiptV1 = {
        requestId: command.requestId,
        acceptedSequence: event.sequence,
        event: visibleEvent(event, member),
        duplicate: false,
      };
      this.receipts.set(receiptKey, {
        fingerprint,
        receipt: structuredClone(receipt),
      });
      return receipt;
    });
  }

  async reconnect(input: {
    memberId: string;
    authToken: string;
    afterSequence: number;
  }): Promise<{
    cursor: number;
    member: OnlineRoomMemberV1;
    events: OnlineRoomVisibleEventV1[];
    projection: unknown;
  }> {
    return this.runMutation(async () => {
      const member = await this.authenticate(input.memberId, input.authToken);
      if (
        !Number.isInteger(input.afterSequence) ||
        input.afterSequence < 0 ||
        input.afterSequence > this.sequence
      ) {
        fail("cursor_invalid", "重连 cursor 无效");
      }
      member.connected = true;
      member.lastSeenAt = this.now();
      const publicMember = this.publicMember(member);
      return {
        cursor: this.sequence,
        member: publicMember,
        events: this.events
          .filter((event) => event.sequence > input.afterSequence)
          .map((event) => visibleEvent(event, publicMember)),
        projection: structuredClone(
          await this.adapter.project({
            roomId: this.roomId,
            releaseHash: this.releaseHash,
            sequence: this.sequence,
            member: publicMember,
            members: [...this.members.values()].map((row) =>
              this.publicMember(row),
            ),
          }),
        ),
      };
    });
  }

  async disconnect(memberId: string, authToken: string): Promise<void> {
    return this.runMutation(async () => {
      const member = await this.authenticate(memberId, authToken);
      member.connected = false;
      member.lastSeenAt = this.now();
    });
  }

  listMembersForGm(
    memberId: string,
    authToken: string,
  ): Promise<OnlineRoomMemberV1[]> {
    return this.authenticate(memberId, authToken).then((member) => {
      if (member.role !== "gm")
        fail("forbidden", "只有 GM 可以读取完整房间成员");
      return [...this.members.values()].map((row) => this.publicMember(row));
    });
  }

  /**
   * Two-party GM handover. The current GM proposes an online player; only that
   * player's own credential can accept. The former GM then takes the player's
   * actor seat, so the table never gains a vacant or double-controlled PC.
   */
  async proposeGmTransfer(input: {
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
    return this.runMutation(async () => {
      const gm = await this.authenticate(input.gmMemberId, input.gmAuthToken);
      if (gm.role !== "gm") fail("forbidden", "只有当前 GM 可以发起主持移交");
      const target = this.members.get(
        key(input.targetMemberId, "targetMemberId"),
      );
      if (
        !target ||
        target.role !== "player" ||
        !target.actorKey ||
        !target.connected
      ) {
        fail("transfer_invalid", "主持只能移交给当前在线且已绑定角色的玩家");
      }
      if (
        !Number.isInteger(input.expiresAt) ||
        input.expiresAt <= this.now() ||
        input.expiresAt > this.now() + 10 * 60_000
      ) {
        fail("transfer_invalid", "主持移交有效期必须在未来 10 分钟内");
      }
      const transfer: StoredGmTransferV1 = {
        transferId: `transfer.${crypto.randomUUID()}`,
        fromGmMemberId: gm.memberId,
        targetMemberId: target.memberId,
        targetActorKey: target.actorKey,
        expiresAt: input.expiresAt,
        createdAt: this.now(),
      };
      this.pendingGmTransfer = transfer;
      const event = await this.appendAuthorityEvent(
        "room.gm-transfer.proposed",
        {
          transferId: transfer.transferId,
          fromDisplayName: gm.displayName,
          targetMemberId: target.memberId,
          targetDisplayName: target.displayName,
          expiresAt: transfer.expiresAt,
        },
      );
      return {
        transferId: transfer.transferId,
        target: this.publicMember(target),
        expiresAt: transfer.expiresAt,
        acceptedSequence: event.sequence,
      };
    });
  }

  async acceptGmTransfer(input: {
    memberId: string;
    authToken: string;
    transferId: string;
  }): Promise<{
    formerGm: OnlineRoomMemberV1;
    gm: OnlineRoomMemberV1;
    acceptedSequence: number;
  }> {
    return this.runMutation(async () => {
      const target = await this.authenticate(input.memberId, input.authToken);
      const transfer = this.pendingGmTransfer;
      if (
        !transfer ||
        transfer.transferId !== key(input.transferId, "transferId") ||
        transfer.targetMemberId !== target.memberId ||
        transfer.expiresAt <= this.now()
      ) {
        fail("transfer_invalid", "主持移交不存在、已过期或不属于当前成员");
      }
      const formerGm = this.members.get(transfer.fromGmMemberId);
      if (
        !formerGm ||
        formerGm.role !== "gm" ||
        target.role !== "player" ||
        target.actorKey !== transfer.targetActorKey
      ) {
        fail("transfer_conflict", "主持或目标席位在确认前已经变化");
      }
      formerGm.role = "player";
      formerGm.actorKey = transfer.targetActorKey;
      formerGm.lastSeenAt = this.now();
      target.role = "gm";
      target.actorKey = null;
      target.lastSeenAt = this.now();
      this.pendingGmTransfer = null;
      // Outstanding invites were issued under the former GM's authority and
      // must not survive the handover.
      this.invites.clear();
      const event = await this.appendAuthorityEvent("room.gm-transferred", {
        transferId: transfer.transferId,
        formerGmDisplayName: formerGm.displayName,
        gmDisplayName: target.displayName,
        transferredActorKey: transfer.targetActorKey,
      });
      return {
        formerGm: this.publicMember(formerGm),
        gm: this.publicMember(target),
        acceptedSequence: event.sequence,
      };
    });
  }

  async cancelGmTransfer(input: {
    gmMemberId: string;
    gmAuthToken: string;
    transferId: string;
  }): Promise<{ cancelled: true; acceptedSequence: number }> {
    return this.runMutation(async () => {
      const gm = await this.authenticate(input.gmMemberId, input.gmAuthToken);
      const transfer = this.pendingGmTransfer;
      if (
        gm.role !== "gm" ||
        !transfer ||
        transfer.fromGmMemberId !== gm.memberId ||
        transfer.transferId !== key(input.transferId, "transferId")
      ) {
        fail("transfer_invalid", "当前成员不能取消该主持移交");
      }
      this.pendingGmTransfer = null;
      const event = await this.appendAuthorityEvent(
        "room.gm-transfer.cancelled",
        {
          transferId: transfer.transferId,
        },
      );
      return { cancelled: true, acceptedSequence: event.sequence };
    });
  }

  private async authenticate(
    memberId: string,
    authToken: string,
  ): Promise<StoredMemberV1> {
    const member = this.members.get(key(memberId, "memberId"));
    const presented = await hashCanonicalValue(
      text(authToken, "authToken", 500),
    );
    if (!member || !this.memberAcceptsTokenHash(member, presented))
      fail("unauthorized", "成员凭据无效");
    return member;
  }

  private memberAcceptsTokenHash(
    member: StoredMemberV1,
    presented: string,
  ): boolean {
    return (
      member.tokenHash === presented ||
      (member.secondaryTokenHashes ?? []).includes(presented)
    );
  }

  private publicMember(member: StoredMemberV1): OnlineRoomMemberV1 {
    const {
      tokenHash: _tokenHash,
      principalHash: _principalHash,
      secondaryTokenHashes: _secondaryTokenHashes,
      ...publicMember
    } = member;
    return structuredClone(publicMember);
  }

  private enforceRateLimit(memberId: string): void {
    const cutoff = this.now() - this.rateLimit.windowMs;
    const recent = (this.rateWindows.get(memberId) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );
    if (recent.length >= this.rateLimit.commands)
      fail("rate_limited", "命令速率超过房间上限");
    recent.push(this.now());
    this.rateWindows.set(memberId, recent);
  }

  private async runMutation<T>(operation: () => Promise<T>): Promise<T> {
    let releaseLock!: () => void;
    const previous = this.mutationTail;
    this.mutationTail = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    await previous;
    const localBackup = this.persistence ? this.captureLocalState() : null;
    const domainBackup = this.persistence
      ? structuredClone(await this.adapter.exportCheckpoint!())
      : null;
    try {
      const result = await operation();
      if (this.persistence) await this.persistExistingRoom();
      return result;
    } catch (error) {
      if (localBackup) this.restoreLocalState(localBackup);
      if (this.persistence) await this.adapter.restoreCheckpoint!(domainBackup);
      throw error;
    } finally {
      releaseLock();
    }
  }

  private captureLocalState(): LocalRoomStateV1 {
    return {
      revision: this.revision,
      sequence: this.sequence,
      members: new Map(
        [...this.members].map(([id, member]) => [id, structuredClone(member)]),
      ),
      invites: new Map(
        [...this.invites].map(([id, invite]) => [id, structuredClone(invite)]),
      ),
      events: structuredClone(this.events),
      receipts: new Map(structuredClone([...this.receipts])),
      rateWindows: new Map(structuredClone([...this.rateWindows])),
      pendingGmTransfer: structuredClone(this.pendingGmTransfer),
    };
  }

  private restoreLocalState(state: LocalRoomStateV1): void {
    this.revision = state.revision;
    this.sequence = state.sequence;
    replaceMap(this.members, state.members);
    replaceMap(this.invites, state.invites);
    this.events.splice(0, this.events.length, ...structuredClone(state.events));
    replaceMap(this.receipts, state.receipts);
    replaceMap(this.rateWindows, state.rateWindows);
    this.pendingGmTransfer = structuredClone(state.pendingGmTransfer);
  }

  private async persistNewRoom(): Promise<void> {
    if (!this.persistence) return;
    const snapshot = await this.buildSnapshot(1);
    const stored = await this.persistence.compareAndSwap({
      roomId: this.roomId,
      expectedRevision: null,
      snapshot,
    });
    if (!stored) fail("room_conflict", "房间 ID 已存在");
    this.revision = 1;
  }

  private async persistExistingRoom(): Promise<void> {
    if (!this.persistence) return;
    const snapshot = await this.buildSnapshot(this.revision + 1);
    const stored = await this.persistence.compareAndSwap({
      roomId: this.roomId,
      expectedRevision: this.revision,
      snapshot,
    });
    if (!stored) fail("persistence_conflict", "房间持久化版本冲突，请重新加载");
    this.revision = snapshot.revision;
  }

  private async buildSnapshot(revision: number): Promise<OnlineRoomSnapshotV1> {
    const payload = {
      schema: "storyforge.online-room-snapshot" as const,
      version: 1 as const,
      revision,
      roomId: this.roomId,
      releaseHash: this.releaseHash,
      sequence: this.sequence,
      members: structuredClone([...this.members.values()]),
      invites: structuredClone([...this.invites.values()]),
      events: structuredClone(this.events),
      receipts: structuredClone([...this.receipts]),
      rateWindows: structuredClone([...this.rateWindows]),
      pendingGmTransfer: structuredClone(this.pendingGmTransfer),
      domainCheckpoint: structuredClone(await this.adapter.exportCheckpoint!()),
      updatedAt: this.now(),
    };
    return { ...payload, integrityHash: await hashCanonicalValue(payload) };
  }

  private async appendAuthorityEvent(
    eventType: string,
    publicPayload: unknown,
  ): Promise<StoredRoomEventV1> {
    const sequence = this.sequence + 1;
    const resultingStateHash = await hashCanonicalValue({
      roomId: this.roomId,
      releaseHash: this.releaseHash,
      sequence,
      members: [...this.members.values()].map((member) => ({
        memberId: member.memberId,
        role: member.role,
        actorKey: member.actorKey,
      })),
      domainCheckpoint: this.adapter.exportCheckpoint
        ? await this.adapter.exportCheckpoint()
        : null,
    });
    const event: StoredRoomEventV1 = {
      sequence,
      eventType,
      publicPayload: structuredClone(publicPayload),
      gmPrivatePayload: null,
      privatePayloadByMemberId: undefined,
      resultingStateHash,
      createdAt: this.now(),
    };
    this.sequence = sequence;
    this.events.push(event);
    return event;
  }
}

function assertDurableAdapter(
  adapter: OnlineRoomDomainAdapterV1,
  persistence: OnlineRoomPersistenceV1 | undefined,
): void {
  if (
    persistence &&
    (!adapter.exportCheckpoint || !adapter.restoreCheckpoint)
  ) {
    fail(
      "adapter_not_durable",
      "持久化房间要求领域适配器实现 checkpoint 导出与恢复",
    );
  }
}

function replaceMap<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, structuredClone(value));
}

export async function verifyOnlineRoomSnapshotV1(
  snapshot: OnlineRoomSnapshotV1,
  roomId: string,
): Promise<void> {
  if (
    snapshot.schema !== "storyforge.online-room-snapshot" ||
    snapshot.version !== 1 ||
    snapshot.roomId !== roomId ||
    !Number.isInteger(snapshot.revision) ||
    snapshot.revision < 1 ||
    !Number.isInteger(snapshot.sequence) ||
    snapshot.sequence < 0 ||
    !Array.isArray(snapshot.members) ||
    !Array.isArray(snapshot.invites) ||
    !Array.isArray(snapshot.events) ||
    !Array.isArray(snapshot.receipts) ||
    !Array.isArray(snapshot.rateWindows) ||
    !/^[0-9a-f]{64}$/.test(snapshot.integrityHash)
  ) {
    fail("snapshot_invalid", "房间快照结构无效");
  }
  const { integrityHash, ...payload } = snapshot;
  if ((await hashCanonicalValue(payload)) !== integrityHash)
    fail("snapshot_corrupt", "房间快照完整性校验失败");
  sha(snapshot.releaseHash, "releaseHash");
  if (
    snapshot.events.length !== snapshot.sequence ||
    snapshot.events.some((event, index) => event.sequence !== index + 1)
  ) {
    fail("snapshot_corrupt", "房间事件序列不连续");
  }
  const gmMembers = snapshot.members.filter((member) => member.role === "gm");
  const actorKeys = snapshot.members.flatMap((member) =>
    member.actorKey == null ? [] : [member.actorKey],
  );
  if (
    gmMembers.length !== 1 ||
    gmMembers[0].actorKey != null ||
    new Set(actorKeys).size !== actorKeys.length
  ) {
    fail(
      "snapshot_corrupt",
      "房间必须且只能有一个无角色绑定 GM，玩家角色绑定不得重复",
    );
  }
  const transfer = snapshot.pendingGmTransfer;
  if (transfer != null) {
    const from = snapshot.members.find(
      (member) => member.memberId === transfer.fromGmMemberId,
    );
    const target = snapshot.members.find(
      (member) => member.memberId === transfer.targetMemberId,
    );
    if (
      !/^transfer\.[A-Za-z0-9-]+$/.test(transfer.transferId) ||
      !Number.isInteger(transfer.expiresAt) ||
      !Number.isInteger(transfer.createdAt) ||
      !from ||
      from.role !== "gm" ||
      !target ||
      target.role !== "player" ||
      target.actorKey !== transfer.targetActorKey
    ) {
      fail("snapshot_corrupt", "待确认主持移交引用无效");
    }
  }
}
