import type {
  OnlineRoomCommandKindV1,
  OnlineRoomCommandReceiptV1,
  OnlineRoomCommandV1,
  OnlineRoomMemberV1,
  OnlineRoomVisibleEventV1,
} from "./room-authority";

export type OnlineRoomConnectionStateV1 =
  "offline" | "connecting" | "online" | "recovering" | "error";

export interface OnlineRoomReconnectResultV1 {
  cursor: number;
  member: OnlineRoomMemberV1;
  events: OnlineRoomVisibleEventV1[];
  projection: unknown;
}

export interface OnlineRoomTransportV1 {
  submit(command: OnlineRoomCommandV1): Promise<OnlineRoomCommandReceiptV1>;
  reconnect(input: {
    roomId: string;
    memberId: string;
    authToken: string;
    afterSequence: number;
  }): Promise<OnlineRoomReconnectResultV1>;
  disconnect?(input: {
    roomId: string;
    memberId: string;
    authToken: string;
  }): Promise<void>;
}

export interface OnlineRoomClientProjectionV1 {
  connection: OnlineRoomConnectionStateV1;
  cursor: number;
  member: OnlineRoomMemberV1 | null;
  projection: unknown;
  events: OnlineRoomVisibleEventV1[];
  pendingRequestIds: string[];
  lastErrorCode: string | null;
}

interface PendingCommandV1 {
  command: OnlineRoomCommandV1;
  state: "queued" | "sending";
}

/** A definitive rejection is visible to the caller and is no longer retryable in the outbox. */
export class OnlineRoomCommandRejectedErrorV1 extends Error {
  constructor(
    public readonly requestId: string,
    public readonly code: "domain_rejected" | "forbidden",
    message: string,
    public readonly cause: unknown,
  ) {
    super(message);
    this.name = "OnlineRoomCommandRejectedErrorV1";
  }
}

function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
  return "transport_unavailable";
}

/**
 * Client reliability shell. It never applies optimistic game state: only
 * authority receipts, replay events, and per-viewer projections advance UI.
 */
export class OnlineRoomClientV1 {
  private connection: OnlineRoomConnectionStateV1 = "offline";
  private cursor = 0;
  private projection: unknown = null;
  private member: OnlineRoomMemberV1 | null = null;
  private readonly events: OnlineRoomVisibleEventV1[] = [];
  private readonly pending: PendingCommandV1[] = [];
  private lastErrorCode: string | null = null;
  private operationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly identity: {
      roomId: string;
      releaseHash: string;
      memberId: string;
      authToken: string;
      actorKey: string | null;
    },
    private readonly transport: OnlineRoomTransportV1,
  ) {}

  inspect(): OnlineRoomClientProjectionV1 {
    return {
      connection: this.connection,
      cursor: this.cursor,
      member: this.member == null ? null : structuredClone(this.member),
      projection: structuredClone(this.projection),
      events: structuredClone(this.events),
      pendingRequestIds: this.pending.map((item) => item.command.requestId),
      lastErrorCode: this.lastErrorCode,
    };
  }

  connect(): Promise<OnlineRoomClientProjectionV1> {
    return this.serial(async () => {
      this.connection = "connecting";
      await this.recoverInternal();
      return this.inspect();
    });
  }

  enqueue(input: {
    kind: OnlineRoomCommandKindV1;
    payload: unknown;
    actorKey?: string | null;
    requestId?: string;
  }): Promise<OnlineRoomClientProjectionV1> {
    return this.serial(async () => {
      const requestId = input.requestId ?? `request.${crypto.randomUUID()}`;
      if (this.pending.some((item) => item.command.requestId === requestId)) {
        throw new Error(
          `[online-client:request_conflict] requestId 已在本地 outbox 中`,
        );
      }
      this.pending.push({
        state: "queued",
        command: {
          protocolVersion: 1,
          roomId: this.identity.roomId,
          releaseHash: this.identity.releaseHash,
          requestId,
          memberId: this.identity.memberId,
          authToken: this.identity.authToken,
          expectedSequence: this.cursor,
          kind: input.kind,
          actorKey:
            input.actorKey === undefined
              ? this.identity.actorKey
              : input.actorKey,
          payload: structuredClone(input.payload),
        },
      });
      await this.flushInternal();
      return this.inspect();
    });
  }

  recover(): Promise<OnlineRoomClientProjectionV1> {
    return this.serial(async () => {
      await this.recoverInternal();
      return this.inspect();
    });
  }

  disconnect(): Promise<OnlineRoomClientProjectionV1> {
    return this.serial(async () => {
      try {
        await this.transport.disconnect?.({
          roomId: this.identity.roomId,
          memberId: this.identity.memberId,
          authToken: this.identity.authToken,
        });
      } finally {
        this.connection = "offline";
      }
      return this.inspect();
    });
  }

  private async recoverInternal(): Promise<void> {
    this.connection = "recovering";
    try {
      const recovered = await this.transport.reconnect({
        roomId: this.identity.roomId,
        memberId: this.identity.memberId,
        authToken: this.identity.authToken,
        afterSequence: this.cursor,
      });
      this.consumeEvents(recovered.events);
      if (recovered.cursor !== this.cursor) {
        throw new Error(
          "[online-client:cursor_mismatch] 重连响应 cursor 与事件流不一致",
        );
      }
      this.projection = structuredClone(recovered.projection);
      this.acceptRecoveredMember(recovered.member);
      this.connection = "online";
      this.lastErrorCode = null;
      await this.flushInternal();
    } catch (error) {
      this.connection = error instanceof OnlineRoomCommandRejectedErrorV1 ? "online" : "error";
      this.lastErrorCode = errorCode(error);
      throw error;
    }
  }

  private async flushInternal(): Promise<void> {
    if (this.connection !== "online") return;
    while (this.pending.length) {
      const pending = this.pending[0];
      pending.state = "sending";
      let accepted = false;
      try {
        const receipt = await this.transport.submit(
          structuredClone(pending.command),
        );
        accepted = true;
        this.consumeEvents([receipt.event]);
        this.pending.shift();
        // A receipt proves the event, while the per-viewer projection remains
        // the authority for UI state. Refresh it immediately instead of asking
        // clients to reduce domain events or display stale secrets/turn state.
        const refreshed = await this.transport.reconnect({
          roomId: this.identity.roomId,
          memberId: this.identity.memberId,
          authToken: this.identity.authToken,
          afterSequence: this.cursor,
        });
        this.consumeEvents(refreshed.events);
        if (refreshed.cursor !== this.cursor) {
          throw new Error(
            "[online-client:cursor_mismatch] 命令后投影 cursor 与事件流不一致",
          );
        }
        this.projection = structuredClone(refreshed.projection);
        this.acceptRecoveredMember(refreshed.member);
        this.lastErrorCode = null;
      } catch (error) {
        pending.state = "queued";
        const code = errorCode(error);
        this.lastErrorCode = code;
        // Only explicit pre-acceptance rejection can leave the outbox. A lost
        // receipt, timeout or failed post-acceptance projection stays recoverable.
        if (!accepted && (code === "domain_rejected" || code === "forbidden")) {
          this.pending.shift();
          this.connection = "online";
          throw new OnlineRoomCommandRejectedErrorV1(
            pending.command.requestId,
            code,
            error instanceof Error ? error.message : `房间拒绝了此命令：${code}`,
            error,
          );
        }
        if (code === "stale_cursor") {
          const recovered = await this.transport.reconnect({
            roomId: this.identity.roomId,
            memberId: this.identity.memberId,
            authToken: this.identity.authToken,
            afterSequence: this.cursor,
          });
          this.consumeEvents(recovered.events);
          this.projection = structuredClone(recovered.projection);
          this.acceptRecoveredMember(recovered.member);
          pending.command.expectedSequence = this.cursor;
          continue;
        }
        this.connection =
          code === "transport_unavailable" ? "recovering" : "error";
        break;
      }
    }
  }

  private consumeEvents(incoming: OnlineRoomVisibleEventV1[]): void {
    for (const event of [...incoming].sort(
      (left, right) => left.sequence - right.sequence,
    )) {
      if (event.sequence <= this.cursor) continue;
      if (event.sequence !== this.cursor + 1) {
        throw new Error(
          `[online-client:event_gap] 事件从 #${this.cursor} 跳到 #${event.sequence}`,
        );
      }
      this.events.push(structuredClone(event));
      this.cursor = event.sequence;
    }
  }

  private acceptRecoveredMember(member: OnlineRoomMemberV1): void {
    if (member.memberId !== this.identity.memberId) {
      throw new Error(
        "[online-client:identity_mismatch] 重连返回了其他成员身份",
      );
    }
    this.member = structuredClone(member);
    this.identity.actorKey = member.actorKey;
  }

  private async serial<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.operationTail;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
