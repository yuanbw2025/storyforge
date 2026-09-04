import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenText,
  Copy,
  Dices,
  Eye,
  Link2,
  MessageSquareText,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ScrollText,
  Target,
  Unplug,
  Users,
  Wifi,
} from "lucide-react";
import {
  configuredOnlineRoomTransportV1,
  type HostedOnlineRoomTransportV1,
  type OnlineRoomCredentialBundleV1,
  type OnlineRoomJoinHandoffV1,
} from "../../lib/online/http-transport";
import {
  OnlineRoomClientV1,
  type OnlineRoomClientProjectionV1,
} from "../../lib/online/room-client";
import type { OnlineRoomMemberV1 } from "../../lib/online/room-authority";
import { parseOnlineTtrpgRoomProjectionV1 } from "../../lib/online/ttrpg-projection";
import {
  currentProductPlatformEnvironmentV1,
  evaluateProductPlatformCapabilityV1,
} from "../../lib/product-platform/capability-status";
import TtrpgTabletopSurface from "./TtrpgTabletopSurface";
import { parseTtrpgDiceExpressionV2 } from "../../lib/ttrpg/dice";

function generatedRoomId(): string {
  return `room.${crypto.randomUUID()}`;
}

function displayError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function pendingGmTransferForMember(
  events: OnlineRoomClientProjectionV1["events"],
  memberId: string,
): { transferId: string; expiresAt: number } | null {
  let pending: { transferId: string; expiresAt: number } | null = null;
  for (const event of events) {
    const payload =
      event.publicPayload &&
      typeof event.publicPayload === "object" &&
      !Array.isArray(event.publicPayload)
        ? (event.publicPayload as Record<string, unknown>)
        : null;
    if (
      event.eventType === "room.gm-transfer.proposed" &&
      payload?.targetMemberId === memberId &&
      typeof payload.transferId === "string" &&
      Number.isInteger(payload.expiresAt)
    ) {
      pending = {
        transferId: payload.transferId,
        expiresAt: Number(payload.expiresAt),
      };
    } else if (
      pending &&
      ["room.gm-transfer.cancelled", "room.gm-transferred"].includes(
        event.eventType,
      ) &&
      payload?.transferId === pending.transferId
    ) {
      pending = null;
    }
  }
  return pending && pending.expiresAt > Date.now() ? pending : null;
}

export default function TtrpgOnlineRoomPanel(props: {
  releaseHash: string;
  selectedCharacterKeys: string[];
  characterNames: Record<string, string>;
  /** Test/embedded-host seam; production uses the configured HTTP service. */
  transport?: HostedOnlineRoomTransportV1 | null;
  initialHandoff?: OnlineRoomJoinHandoffV1 | null;
  onInitialHandoffConsumed?: () => void;
}) {
  const transport = useMemo(
    () =>
      props.transport === undefined
        ? configuredOnlineRoomTransportV1()
        : props.transport,
    [props.transport],
  );
  // Stable for the mounted provisioning attempt. If the server commits a room
  // but the HTTP response is lost, retrying must not silently mint a new create
  // request and strand the GM credential.
  const createRequestIdRef = useRef(`create.${crypto.randomUUID()}`);
  const joinRequestIdRef = useRef(`join.${crypto.randomUUID()}`);
  const clientRef = useRef<OnlineRoomClientV1 | null>(null);
  const credentialsRef = useRef<OnlineRoomCredentialBundleV1 | null>(null);
  const appliedHandoffRef = useRef("");
  const [roomId, setRoomId] = useState(generatedRoomId);
  const [displayName, setDisplayName] = useState("主持人");
  const [creatorAccessToken, setCreatorAccessToken] = useState("");
  const [inviteId, setInviteId] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [inviteRole, setInviteRole] = useState<"player" | "spectator">(
    "player",
  );
  const [inviteActorKey, setInviteActorKey] = useState(
    props.selectedCharacterKeys[0] ?? "",
  );
  const [issuedInvite, setIssuedInvite] = useState<{
    inviteId: string;
    inviteToken: string;
  } | null>(null);
  const [roomMembers, setRoomMembers] = useState<OnlineRoomMemberV1[]>([]);
  const [transferTargetMemberId, setTransferTargetMemberId] = useState("");
  const [issuedGmTransfer, setIssuedGmTransfer] = useState<{
    transferId: string;
    target: OnlineRoomMemberV1;
    expiresAt: number;
  } | null>(null);
  const [incomingGmTransferId, setIncomingGmTransferId] = useState("");
  const [snapshot, setSnapshot] = useState<OnlineRoomClientProjectionV1 | null>(
    null,
  );
  const [chatText, setChatText] = useState("");
  const [diceExpression, setDiceExpression] = useState("1d20");
  const [actionTargetKey, setActionTargetKey] = useState("");
  const [onlineIntentText, setOnlineIntentText] = useState("");
  const [onlineIntentActionKey, setOnlineIntentActionKey] = useState("");
  const [actionDifficulty, setActionDifficulty] = useState("");
  const [situationalModifier, setSituationalModifier] = useState("0");
  const [narrationText, setNarrationText] = useState("");
  const [humanResponseText, setHumanResponseText] = useState("");
  const [humanResponseKind, setHumanResponseKind] = useState<
    "speak" | "act-narratively"
  >("speak");
  const [humanResponseAudience, setHumanResponseAudience] = useState<
    "party" | "gm-only"
  >("party");
  const [clueActorKey, setClueActorKey] = useState(
    props.selectedCharacterKeys[0] ?? "",
  );
  const [selectedOnlineTokenKey, setSelectedOnlineTokenKey] = useState("");
  const [onlineGrantItemKey, setOnlineGrantItemKey] = useState("");
  const [onlineGrantOwnerKey, setOnlineGrantOwnerKey] = useState(
    props.selectedCharacterKeys[0] ?? "",
  );
  const [onlineEffectKind, setOnlineEffectKind] = useState<
    "clock" | "xp" | "relationship" | "resource.gain" | "resource.spend"
  >("clock");
  const [onlineEffectActorKey, setOnlineEffectActorKey] = useState(
    props.selectedCharacterKeys[0] ?? "",
  );
  const [onlineEffectClockKey, setOnlineEffectClockKey] = useState("");
  const [onlineEffectResourceKey, setOnlineEffectResourceKey] = useState("");
  const [onlineEffectAmount, setOnlineEffectAmount] = useState("1");
  const [onlineEffectAudience, setOnlineEffectAudience] = useState<
    "party" | "gm" | "actor"
  >("party");
  const [onlineEffectReason, setOnlineEffectReason] = useState(
    "KP 根据本次判定与当前场景结算后果。",
  );
  const [onlineEffectRequiresChoice, setOnlineEffectRequiresChoice] = useState(false);
  const [onlineAlternativeEffectKind, setOnlineAlternativeEffectKind] = useState<
    "clock" | "xp" | "relationship" | "resource.gain" | "resource.spend"
  >("xp");
  const [onlineAlternativeEffectAmount, setOnlineAlternativeEffectAmount] = useState("1");
  const [onlineSessionTitle, setOnlineSessionTitle] = useState("");
  const [onlineSessionPublicNote, setOnlineSessionPublicNote] = useState("");
  const [onlineSessionMemory, setOnlineSessionMemory] = useState("");
  const [onlineSessionMemoryAudience, setOnlineSessionMemoryAudience] = useState<
    "party" | "gm-only" | `actor:${string}`
  >("party");
  const [onlineAiPlayerObjective, setOnlineAiPlayerObjective] = useState(
    "依据该角色当前可见信息、私人目标与合法行动，做出能推动当前场景的一步。",
  );
  const [onlineAiGmObjective, setOnlineAiGmObjective] = useState(
    "严格依据最近 ActionReceipt 反馈行动、在场角色反应、场景变化与可选下一步，不得改写骰点和机械结果。",
  );
  const [onlineAiGmActorObjective, setOnlineAiGmActorObjective] = useState(
    "依据当前 NPC 的目标、已知信息、现场局势和冻结规则，选择一个合理且不替真人玩家做决定的行动。",
  );
  const [safetyReason, setSafetyReason] =
    useState("需要暂停并重新确认内容边界。");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const diceValidationError = useMemo(() => {
    try {
      parseTtrpgDiceExpressionV2(diceExpression);
      return "";
    } catch (cause) {
      return displayError(cause);
    }
  }, [diceExpression]);

  useEffect(() => {
    const handoff = props.initialHandoff;
    if (!handoff) return;
    const key = `${handoff.roomId}:${handoff.inviteId}:${handoff.expiresAt}`;
    if (appliedHandoffRef.current === key) return;
    appliedHandoffRef.current = key;
    if (handoff.releaseHash !== props.releaseHash) {
      setError(
        "该招募席位绑定了另一份 ProductRelease，请先下载并从对应发布进入。",
      );
      return;
    }
    if (handoff.expiresAt <= Date.now()) {
      setError("该招募席位已经过期，请联系主持人重新分配。");
      return;
    }
    setRoomId(handoff.roomId);
    setInviteId(handoff.inviteId);
    setInviteToken(handoff.inviteToken);
    setDisplayName(handoff.displayName);
    setCreatorAccessToken(handoff.memberAccessToken);
    setInviteActorKey(handoff.actorKey);
    setClueActorKey(handoff.actorKey);
    setError("");
  }, [props.initialHandoff, props.releaseHash]);

  useEffect(() => {
    const credentials = credentialsRef.current;
    const client = clientRef.current;
    if (
      !transport ||
      !credentials ||
      !client ||
      snapshot?.connection !== "online"
    )
      return;
    const controller = new AbortController();
    let stopped = false;
    void (async () => {
      while (!stopped) {
        try {
          const current = client.inspect();
          const signal = await transport.waitForAdvance({
            roomId: credentials.roomId,
            memberId: credentials.member.memberId,
            authToken: credentials.authToken,
            afterSequence: current.cursor,
            timeoutMs: 10_000,
            signal: controller.signal,
          });
          if (stopped) return;
          if (signal.cursor > current.cursor) {
            setSnapshot(await client.recover());
            setError("");
          }
        } catch (cause) {
          if (stopped || controller.signal.aborted) return;
          setError(`实时同步暂时中断：${displayError(cause)}；正在重试。`);
          const code =
            cause && typeof cause === "object" && "code" in cause
              ? String(cause.code)
              : "";
          if (["unauthorized", "forbidden", "room_not_found"].includes(code))
            return;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      }
    })();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [snapshot?.connection, snapshot?.cursor, transport]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(displayError(cause));
    } finally {
      setBusy(false);
    }
  };
  const connectCredentials = async (
    credentials: OnlineRoomCredentialBundleV1,
  ) => {
    if (credentials.releaseHash !== props.releaseHash) {
      throw new Error("该邀请绑定了另一份 ProductRelease，请从对应发布进入。");
    }
    const client = new OnlineRoomClientV1(
      {
        roomId: credentials.roomId,
        releaseHash: credentials.releaseHash,
        memberId: credentials.member.memberId,
        authToken: credentials.authToken,
        actorKey: credentials.member.actorKey,
      },
      transport!,
    );
    credentialsRef.current = credentials;
    clientRef.current = client;
    setRoomId(credentials.roomId);
    setSnapshot(await client.connect());
  };
  const enqueue = async (
    kind: Parameters<OnlineRoomClientV1["enqueue"]>[0]["kind"],
    payload: unknown,
    actorKey?: string | null,
  ) => {
    const client = clientRef.current;
    if (!client) throw new Error("请先创建或加入在线房间。");
    setSnapshot(await client.enqueue({ kind, payload, actorKey }));
  };

  if (!transport) {
    return (
      <section
        className="rounded border border-border bg-bg-base p-4"
        data-testid="ttrpg-online-room-unconfigured"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Wifi className="h-4 w-4 text-text-muted" />
          在线房间
        </div>
        <p className="mt-2 text-xs leading-5 text-text-muted">
          当前构建未配置托管房间服务。设置{" "}
          <code>VITE_STORYFORGE_ONLINE_SERVICE_URL</code>{" "}
          后，这里会启用创建、邀请、加入、重连与权威命令；本地战役仍可完整游玩。
        </p>
      </section>
    );
  }

  const capabilityDecision = evaluateProductPlatformCapabilityV1(
    "online-authoritative-room",
    {
      environment: currentProductPlatformEnvironmentV1(),
      experimentalProject: false,
      authorOptIn: false,
      onlineServiceConfigured: true,
      aiGmBetaGatePassed: false,
    },
  );
  if (!capabilityDecision.enabled) {
    return (
      <section
        className="rounded border border-warning/40 bg-warning/5 p-4"
        data-testid="ttrpg-online-room-rollout-blocked"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Wifi className="h-4 w-4 text-warning" />
          在线房间尚未进入当前环境
        </div>
        <p className="mt-2 text-xs leading-5 text-text-muted">
          {capabilityDecision.capability.reason}
        </p>
        <p className="mt-2 text-[10px] text-warning">
          {capabilityDecision.blockers.join("；")}
        </p>
        <p className="mt-2 text-[10px] text-text-muted">
          本地战役、导出与人类 GM
          主持不受影响；部署通过多人灾备与安全验收后再调整统一状态字典。
        </p>
      </section>
    );
  }

  const member = snapshot?.member ?? credentialsRef.current?.member ?? null;
  let roomProjection: ReturnType<
    typeof parseOnlineTtrpgRoomProjectionV1
  > | null = null;
  let projectionError = "";
  if (snapshot?.projection != null) {
    try {
      roomProjection = parseOnlineTtrpgRoomProjectionV1(snapshot.projection);
    } catch (cause) {
      projectionError = displayError(cause);
    }
  }
  const campaignView = roomProjection?.campaign ?? null;
  const activeActorKey = campaignView?.turn.activeActorKey ?? null;
  const actionActorKey =
    member?.role === "player" ? member.actorKey : activeActorKey;
  const otherActors =
    campaignView?.actors.filter((actor) => actor.actorKey !== actionActorKey) ??
    [];
  const resolvedActionTarget = otherActors.some(
    (actor) => actor.actorKey === actionTargetKey,
  )
    ? actionTargetKey
    : (otherActors[0]?.actorKey ?? "");
  const latestAction =
    campaignView?.recentActions[campaignView.recentActions.length - 1] ?? null;
  const resolvedEffectActorKey =
    campaignView?.actors.some(
      (actor) => actor.actorKey === onlineEffectActorKey && actor.role === "player",
    )
      ? onlineEffectActorKey
      : (campaignView?.actors.find((actor) => actor.role === "player")?.actorKey ?? "");
  const resolvedEffectActor = campaignView?.actors.find(
    (actor) => actor.actorKey === resolvedEffectActorKey,
  );
  const resolvedEffectClockKey = campaignView?.clocks.some(
    (clock) => clock.clockKey === onlineEffectClockKey,
  )
    ? onlineEffectClockKey
    : (campaignView?.clocks[0]?.clockKey ?? "");
  const resolvedEffectResourceKey = resolvedEffectActor?.resources.some(
    (resource) => resource.key === onlineEffectResourceKey,
  )
    ? onlineEffectResourceKey
    : (resolvedEffectActor?.resources[0]?.key ?? "");
  const latestActionHasEffect = !!latestAction && !!campaignView?.effectReceipts.some(
    (receipt) => receipt.sourceEventId === `event.${latestAction.eventSequence}`,
  ) || !!latestAction && !!campaignView?.pendingEffectChoices.some(
    choice => choice.actionSequence === latestAction.eventSequence,
  );
  const buildOnlineEffect = (
    kind: typeof onlineEffectKind,
    amount: number,
    suffix: string,
  ) => {
    const effectKey = `online.effect.${latestAction?.eventSequence ?? 0}.${suffix}.${kind}.${resolvedEffectActorKey}`;
    return kind === "clock"
      ? {
          effectKey, family: "story", operation: "clock.advance",
          targetRef: resolvedEffectActorKey, storyKey: resolvedEffectClockKey, value: amount,
        }
      : kind === "xp"
        ? {
            effectKey, family: "advancement", operation: "xp",
            targetRef: resolvedEffectActorKey, advancementKey: "session-xp", amount,
          }
        : kind === "relationship"
          ? {
              effectKey, family: "social", operation: "relationship",
              targetRef: resolvedEffectActorKey, socialKey: "campaign-relationship", amount,
            }
          : {
              effectKey, family: "numeric", operation: kind,
              targetRef: resolvedEffectActorKey, valueKey: resolvedEffectResourceKey,
              amount: Math.abs(amount),
            };
  };
  const activeOnlineCampaignSession = campaignView?.continuity.activeSessionKey
    ? campaignView.continuity.playSessions.find(
        session => session.sessionKey === campaignView.continuity.activeSessionKey,
      ) ?? null
    : null;
  const activeOnlineActor = campaignView?.actors.find(
    actor => actor.actorKey === campaignView.turn.activeActorKey,
  ) ?? null;
  const pendingHumanResponse =
    member?.role === "player" && member.actorKey
      ? (campaignView?.pendingHumanResponses
          .filter((item) => item.actorKey === member.actorKey)
          .slice(-1)[0] ?? null)
      : null;
  const selectedOnlineIntentAction = campaignView?.availableActions.find(
    action => action.actionKey === onlineIntentActionKey,
  ) ?? null;
  const invitationText = issuedInvite
    ? `${roomId}\n${issuedInvite.inviteId}\n${issuedInvite.inviteToken}`
    : "";
  const incomingTransfer =
    member?.role === "player"
      ? pendingGmTransferForMember(snapshot?.events ?? [], member.memberId)
      : null;
  return (
    <section
      className="rounded border border-accent/30 bg-bg-base p-4"
      data-testid="ttrpg-online-room"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Wifi className="h-4 w-4 text-accent" />
            在线房间
          </div>
          <p className="mt-1 text-xs text-text-muted">
            房间只接受服务端回执推进；身份、角色、骰点、顺序和玩家投影均由权威端验证。
          </p>
        </div>
        <span
          className={`rounded px-2 py-1 text-[10px] ${snapshot?.connection === "online" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}
        >
          {snapshot?.connection ?? "未连接"}
          {snapshot ? ` · #${snapshot.cursor}` : ""}
        </span>
      </div>

      {!member && props.initialHandoff?.releaseHash === props.releaseHash && (
        <p
          className="mt-3 rounded border border-success/30 bg-success/10 p-2 text-xs text-success"
          data-testid="online-room-lfg-handoff"
        >
          已载入被接受招募的在线席位。请核对显示名和房间后，点击“加入并连接”；邀请不会被自动消耗。
        </p>
      )}

      {!member ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <form
            className="rounded border border-border bg-bg-surface p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const credentials = await transport.createRoom({
                  requestId: createRequestIdRef.current,
                  roomId: roomId.trim(),
                  releaseHash: props.releaseHash,
                  selectedCharacterKeys: props.selectedCharacterKeys,
                  creatorAccessToken,
                  gmDisplayName: displayName.trim(),
                });
                setCreatorAccessToken("");
                await connectCredentials(credentials);
              });
            }}
          >
            <strong className="text-xs text-text-primary">创建房间</strong>
            <div className="mt-2 grid gap-2">
              <input
                value={roomId}
                onChange={(event) => setRoomId(event.target.value)}
                aria-label="在线房间 ID"
                placeholder="房间 ID"
                className="rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
              />
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                aria-label="GM 显示名"
                placeholder="GM 显示名"
                className="rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
              />
              <input
                type="password"
                autoComplete="off"
                value={creatorAccessToken}
                onChange={(event) => setCreatorAccessToken(event.target.value)}
                aria-label="托管服务访问凭据"
                placeholder="托管服务访问凭据"
                className="rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
              />
            </div>
            <p className="mt-2 text-[10px] text-text-muted">
              访问凭据和房间凭据只保留在当前页面内存，不写入项目表或浏览器持久存储。
            </p>
            <button
              type="submit"
              disabled={
                busy ||
                !roomId.trim() ||
                !displayName.trim() ||
                !creatorAccessToken.trim()
              }
              className="mt-3 rounded bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-40"
            >
              创建并连接
            </button>
          </form>
          <form
            className="rounded border border-border bg-bg-surface p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const credentials = await transport.joinAuthenticatedRoom({
                  requestId: joinRequestIdRef.current,
                  roomId: roomId.trim(),
                  inviteId: inviteId.trim(),
                  inviteToken,
                  memberAccessToken: creatorAccessToken,
                  displayName: displayName.trim(),
                });
                setInviteToken("");
                setCreatorAccessToken("");
                await connectCredentials(credentials);
                props.onInitialHandoffConsumed?.();
              });
            }}
          >
            <strong className="text-xs text-text-primary">
              通过邀请加入 / 恢复席位
            </strong>
            <div className="mt-2 grid gap-2">
              <input
                value={roomId}
                onChange={(event) => setRoomId(event.target.value)}
                aria-label="加入的房间 ID"
                placeholder="房间 ID"
                className="rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
              />
              <input
                value={inviteId}
                onChange={(event) => setInviteId(event.target.value)}
                aria-label="邀请 ID"
                placeholder="邀请 ID"
                className="rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
              />
              <input
                type="password"
                autoComplete="off"
                value={inviteToken}
                onChange={(event) => setInviteToken(event.target.value)}
                aria-label="邀请凭据"
                placeholder="邀请凭据"
                className="rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
              />
              <input
                type="password"
                autoComplete="off"
                value={creatorAccessToken}
                onChange={(event) => setCreatorAccessToken(event.target.value)}
                aria-label="加入账号访问凭据"
                placeholder="账号访问凭据（用于跨设备恢复）"
                className="rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
              />
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                aria-label="玩家显示名"
                placeholder="显示名"
                className="rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={
                  busy ||
                  !roomId.trim() ||
                  !inviteId.trim() ||
                  !inviteToken ||
                  !creatorAccessToken.trim() ||
                  !displayName.trim()
                }
                className="rounded border border-accent px-3 py-1.5 text-xs text-accent disabled:opacity-40"
              >
                加入并连接
              </button>
              <button
                type="button"
                disabled={busy || !roomId.trim() || !creatorAccessToken.trim()}
                onClick={() =>
                  void run(async () => {
                    const credentials = await transport.resumeAuthenticatedRoom(
                      {
                        roomId: roomId.trim(),
                        memberAccessToken: creatorAccessToken,
                      },
                    );
                    setCreatorAccessToken("");
                    await connectCredentials(credentials);
                  })
                }
                className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary disabled:opacity-40"
              >
                恢复账号席位
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-bg-surface p-3 text-xs text-text-secondary">
            <Users className="h-4 w-4 text-accent" />
            <strong className="text-text-primary">{member.displayName}</strong>
            <span>{member.role}</span>
            {member.actorKey && (
              <span>
                · {props.characterNames[member.actorKey] ?? member.actorKey}
              </span>
            )}
            <span className="font-mono text-[10px] text-text-muted">
              {roomId}
            </span>
            <div className="ml-auto flex gap-1">
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setSnapshot(await clientRef.current!.recover());
                  })
                }
                className="rounded border border-border p-1.5"
                aria-label="重新同步房间"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await clientRef.current!.disconnect();
                    clientRef.current = null;
                    credentialsRef.current = null;
                    setSnapshot(null);
                    setIssuedInvite(null);
                  })
                }
                className="rounded border border-border p-1.5"
                aria-label="离开在线房间"
              >
                <Unplug className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {projectionError && (
            <p
              role="alert"
              className="rounded border border-danger/30 bg-danger/10 p-2 text-xs text-danger"
            >
              权威投影被客户端拒绝：{projectionError}
            </p>
          )}

          {campaignView && (
            <>
              <div
                className="grid gap-3 lg:grid-cols-[1.25fr_.75fr]"
                data-testid="online-ttrpg-authoritative-game-view"
              >
                <section className="rounded border border-border bg-bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Eye className="h-4 w-4 text-accent" />
                    <strong className="text-xs text-text-primary">
                      权威场景
                    </strong>
                    <span className="rounded bg-bg-base px-2 py-1 text-[10px] text-text-muted">
                      第 {campaignView.turn.round} 回合
                    </span>
                    <span className="text-[10px] text-text-muted">
                      当前：
                      {campaignView.actors.find(
                        (actor) => actor.actorKey === activeActorKey,
                      )?.name ?? "等待主持人开场"}
                    </span>
                  </div>
                  {campaignView.turn.initiative.length > 0 && (
                    <div
                      className="mt-2 flex flex-wrap gap-1 text-[9px] text-text-muted"
                      data-testid="online-ttrpg-initiative"
                    >
                      先攻：
                      {campaignView.turn.initiative.map((entry) => (
                        <span
                          key={entry.actorKey}
                          className="rounded bg-bg-base px-2 py-1"
                        >
                          {campaignView.actors.find(
                            (actor) => actor.actorKey === entry.actorKey,
                          )?.name ?? entry.actorKey}{" "}
                          {entry.total}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 space-y-2">
                    {campaignView.scenes
                      .filter((scene) => scene.status !== "locked")
                      .map((scene) => (
                        <article
                          key={scene.sceneKey ?? scene.title}
                          className={`rounded border p-3 ${scene.status === "current" ? "border-accent bg-accent/5" : "border-border bg-bg-base"}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <strong className="text-xs text-text-primary">
                                {scene.title}
                              </strong>
                              <p className="mt-1 text-xs leading-5 text-text-secondary">
                                {scene.description}
                              </p>
                            </div>
                            <span className="text-[10px] text-text-muted">
                              {scene.status === "current" ? "当前" : "已历"}
                            </span>
                          </div>
                          {scene.gmSecret && (
                            <details className="mt-2 text-[10px] text-warning">
                              <summary>GM 私密</summary>
                              <p className="mt-1">{scene.gmSecret}</p>
                            </details>
                          )}
                        </article>
                      ))}
                    {campaignView.scenes.every(
                      (scene) => scene.status === "locked",
                    ) && (
                      <p className="text-xs text-text-muted">
                        等待 GM 打开开场场景。
                      </p>
                    )}
                  </div>
                </section>
                <section className="rounded border border-border bg-bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-accent" />
                    <strong className="text-xs text-text-primary">
                      当前队伍与参战者
                    </strong>
                  </div>
                  <div className="mt-2 space-y-2">
                    {campaignView.actors.map((actor) => (
                      <article
                        key={actor.actorKey}
                        className={`rounded border p-2 ${actor.actorKey === activeActorKey ? "border-accent/50 bg-accent/5" : "border-border bg-bg-base"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <strong className="text-xs text-text-primary">
                            {actor.name}
                          </strong>
                          <span className="text-[9px] text-text-muted">
                            {actor.controlledByViewer ? "可控制" : actor.role}
                          </span>
                        </div>
                        {actor.resources.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {actor.resources.map((resource) => (
                              <span
                                key={resource.key}
                                className="rounded bg-bg-surface px-1.5 py-0.5 text-[9px] text-text-secondary"
                              >
                                {resource.name} {resource.current}/
                                {resource.maximum}
                              </span>
                            ))}
                          </div>
                        )}
                        {actor.conditions.length > 0 && (
                          <div className="mt-1 text-[9px] text-warning">
                            {actor.conditions
                              .map(
                                (condition) =>
                                  `${condition.name}×${condition.stacks}`,
                              )
                              .join(" · ")}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              </div>

              {(member.role === "gm" || member.role === "player") && (
                <section className="rounded border border-accent/30 bg-accent/5 p-3">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-accent" />
                    <strong className="text-xs text-text-primary">
                      按 RulePack 行动
                    </strong>
                  </div>
                  {campaignView.turn.budget && (
                    <div
                      className="mt-2 flex flex-wrap gap-2 text-[10px] text-text-muted"
                      data-testid="online-ttrpg-action-budget"
                    >
                      <span className="rounded bg-bg-surface px-2 py-1">
                        主要行动 {campaignView.turn.budget.actionsRemaining}
                      </span>
                      <span className="rounded bg-bg-surface px-2 py-1">
                        反应 {campaignView.turn.budget.reactionsRemaining}
                      </span>
                      <span className="rounded bg-bg-surface px-2 py-1">
                        自由行动 {campaignView.turn.budget.freeActionsRemaining}
                      </span>
                    </div>
                  )}
                  {campaignView.availableActions.length === 0 ? (
                    <p className="mt-2 text-xs text-text-muted">
                      {activeActorKey
                        ? `等待 ${campaignView.actors.find((actor) => actor.actorKey === activeActorKey)?.name ?? activeActorKey} 行动或可触发反应。`
                        : "等待 GM 打开场景。"}
                    </p>
                  ) : (
                    <>
                    <div
                      className="mt-3 rounded border border-accent/30 bg-accent/5 p-3"
                      data-testid="online-ttrpg-natural-intent"
                    >
                      <strong className="text-xs text-text-primary">
                        用自然语言声明行动
                      </strong>
                      <p className="mt-1 text-[10px] leading-4 text-text-muted">
                        可以先只描述想做什么，由系统返回澄清回执；也可明确选择规则行动。骰点和消耗只在合法性通过后发生。
                      </p>
                      <textarea
                        aria-label="在线自然语言行动"
                        rows={3}
                        maxLength={10_000}
                        value={onlineIntentText}
                        onChange={(event) => setOnlineIntentText(event.target.value)}
                        className="mt-2 w-full rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
                      />
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <select
                          aria-label="在线意图规则行动"
                          value={onlineIntentActionKey}
                          onChange={(event) => setOnlineIntentActionKey(event.target.value)}
                          className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                        >
                          <option value="">暂不选择，请求澄清</option>
                          {campaignView.availableActions.map(action => (
                            <option key={action.actionKey} value={action.actionKey}>{action.name}</option>
                          ))}
                        </select>
                        {selectedOnlineIntentAction && selectedOnlineIntentAction.target !== "self" && selectedOnlineIntentAction.target !== "scene" ? (
                          <select
                            aria-label="在线意图目标"
                            value={resolvedActionTarget}
                            onChange={(event) => setActionTargetKey(event.target.value)}
                            className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                          >
                            {otherActors.map(actor => (
                              <option key={actor.actorKey} value={actor.actorKey}>{actor.name}</option>
                            ))}
                          </select>
                        ) : <span />}
                        <button
                          disabled={
                            busy ||
                            campaignView.safety.status === "paused" ||
                            !onlineIntentText.trim() ||
                            !actionActorKey ||
                            (!!selectedOnlineIntentAction &&
                              (selectedOnlineIntentAction.target === "single-ally" || selectedOnlineIntentAction.target === "single-enemy") &&
                              !resolvedActionTarget)
                          }
                          onClick={() => void run(async () => {
                            const action = selectedOnlineIntentAction;
                            await enqueue("intent.submit", {
                              intentKey: `intent.online.${roomProjection!.roomSequence + 1}`,
                              rawInput: onlineIntentText,
                              actionKey: action?.actionKey ?? null,
                              targetKey: !action
                                ? null
                                : action.target === "self"
                                  ? actionActorKey
                                  : action.target === "scene"
                                    ? null
                                    : resolvedActionTarget,
                              goal: null,
                              method: onlineIntentText,
                              difficulty: action?.defaultDifficulty ?? null,
                              situationalModifier: Number(situationalModifier || 0),
                              rollVisibility: "public",
                            }, actionActorKey);
                            setOnlineIntentText("");
                          })}
                          className="rounded bg-accent px-2 py-1 text-[10px] text-white disabled:opacity-40"
                        >
                          提交行动声明
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                      {campaignView.availableActions.map((action) => (
                        <article
                          key={action.actionKey}
                          className="rounded border border-border bg-bg-surface p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <strong className="text-xs text-text-primary">
                                {action.name}
                              </strong>
                              <p className="mt-1 text-[10px] leading-4 text-text-muted">
                                {action.description}
                              </p>
                            </div>
                            <span className="text-[9px] text-text-muted">
                              {action.phase}
                            </span>
                          </div>
                          {action.target !== "self" &&
                            action.target !== "scene" && (
                              <select
                                value={resolvedActionTarget}
                                onChange={(event) =>
                                  setActionTargetKey(event.target.value)
                                }
                                aria-label={`${action.name}目标`}
                                className="mt-2 w-full rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                              >
                                {otherActors.map((actor) => (
                                  <option
                                    key={actor.actorKey}
                                    value={actor.actorKey}
                                  >
                                    {actor.name}
                                  </option>
                                ))}
                              </select>
                            )}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {action.defaultDifficulty != null && (
                              <input
                                type="number"
                                value={
                                  actionDifficulty ||
                                  String(action.defaultDifficulty)
                                }
                                onChange={(event) =>
                                  setActionDifficulty(event.target.value)
                                }
                                aria-label={`${action.name}难度`}
                                className="w-20 rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                              />
                            )}
                            <input
                              type="number"
                              value={situationalModifier}
                              onChange={(event) =>
                                setSituationalModifier(event.target.value)
                              }
                              aria-label="情境修正"
                              title="情境修正"
                              className="w-20 rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                            />
                            <button
                              disabled={
                                busy ||
                                campaignView.safety.status === "paused" ||
                                !actionActorKey ||
                                ((action.target === "single-ally" ||
                                  action.target === "single-enemy") &&
                                  !resolvedActionTarget)
                              }
                              onClick={() =>
                                void run(() =>
                                  enqueue(
                                    "rule.action",
                                    {
                                      actionKey: action.actionKey,
                                      targetKey:
                                        action.target === "self"
                                          ? actionActorKey
                                          : action.target === "scene"
                                            ? null
                                            : resolvedActionTarget,
                                      difficulty:
                                        action.defaultDifficulty == null
                                          ? null
                                          : Number(
                                              actionDifficulty ||
                                                action.defaultDifficulty,
                                            ),
                                      situationalModifier: Number(
                                        situationalModifier || 0,
                                      ),
                                    },
                                    actionActorKey,
                                  ),
                                )
                              }
                              className="rounded bg-accent px-2 py-1 text-[10px] text-white disabled:opacity-40"
                            >
                              权威结算
                              {action.costResourceName && action.costAmount > 0
                                ? ` · ${action.costResourceName}-${action.costAmount}`
                                : ""}
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                    </>
                  )}
                  {campaignView.recentIntentReceipts.slice(-5).map(receipt => (
                    <div
                      key={receipt.receiptKey}
                      className="mt-2 rounded border border-warning/30 bg-warning/5 p-2 text-[10px]"
                    >
                      <strong className="text-text-primary">{receipt.terminalStatus}</strong>
                      <p className="mt-1 text-text-muted">{receipt.reason}</p>
                      {receipt.suggestedActionKeys.length > 0 && (
                        <p className="mt-1 text-text-muted">
                          可选行动：{receipt.suggestedActionKeys.join("、")}
                        </p>
                      )}
                    </div>
                  ))}
                  {latestAction && (
                    <div className="mt-3 rounded border border-success/30 bg-success/5 p-3 text-xs">
                      <strong className="text-text-primary">
                        最近结果：{latestAction.actionName} ·{" "}
                        {latestAction.outcome}
                      </strong>
                      {latestAction.total != null && (
                        <div className="mt-1 text-text-secondary">
                          {latestAction.dice.join(" + ")}{" "}
                          {latestAction.modifier != null &&
                          latestAction.modifier >= 0
                            ? "+"
                            : ""}
                          {latestAction.modifier ?? ""} = {latestAction.total} /{" "}
                          {latestAction.difficulty}
                        </div>
                      )}
                      {campaignView.recentNarrations.find(
                        (item) =>
                          item.actionSequence === latestAction.eventSequence,
                      ) && (
                        <p className="mt-2 whitespace-pre-wrap leading-5 text-text-secondary">
                          {
                            campaignView.recentNarrations.find(
                              (item) =>
                                item.actionSequence ===
                                latestAction.eventSequence,
                            )!.text
                          }
                        </p>
                      )}
                    </div>
                  )}
                  {campaignView.pendingEffectChoices.length > 0 && (
                    <div
                      className="mt-3 space-y-2 rounded border border-warning/40 bg-warning/5 p-3"
                      data-testid="online-ttrpg-pending-effect-choices"
                    >
                      <strong className="text-xs text-text-primary">待确认的行动后果</strong>
                      {campaignView.pendingEffectChoices.map(choice => {
                        const owner = campaignView.actors.find(actor => actor.actorKey === choice.ownerActorKey);
                        const canResolve = member.role === "player"
                          ? member.actorKey === choice.ownerActorKey
                          : owner?.controller === "ai";
                        return (
                          <article key={choice.choiceKey} className="rounded bg-bg-base p-2 text-[10px]">
                            <p className="text-text-secondary">
                              {owner?.name ?? choice.ownerActorKey} · {choice.reason}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {choice.options.map(option => (
                                <button
                                  key={option.effectKey}
                                  disabled={busy || !canResolve}
                                  onClick={() => void run(() => enqueue(
                                    "effects.choice.resolve",
                                    { choiceKey: choice.choiceKey, selectedEffectKey: option.effectKey },
                                    choice.ownerActorKey,
                                  ))}
                                  className="rounded border border-warning/50 px-2 py-1 text-text-primary disabled:opacity-40"
                                >
                                  选择：{option.detail}
                                </button>
                              ))}
                            </div>
                            {!canResolve && member.role === "gm" && (
                              <p className="mt-1 text-text-muted">等待该真人席位确认；KP 只能代纯 AI 席位选择。</p>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  )}
                  {member.role === "gm" && activeOnlineActor?.controller === "ai" && (
                    <div
                      className="mt-3 rounded border border-purple-500/30 bg-purple-500/5 p-3 text-xs"
                      data-testid="online-ttrpg-ai-player"
                    >
                      <strong className="text-text-primary">
                        AI 玩家回合 · {activeOnlineActor.name}
                      </strong>
                      <p className="mt-1 text-[10px] leading-4 text-text-muted">
                        托管模型只接收该角色的玩家投影并只能提出行动意图；目标、骰点、消耗和结果仍由权威 RulePack 重新校验。
                      </p>
                      <textarea
                        aria-label="在线 AI 玩家目标"
                        rows={2}
                        maxLength={4_000}
                        value={onlineAiPlayerObjective}
                        onChange={(event) => setOnlineAiPlayerObjective(event.target.value)}
                        className="mt-2 w-full rounded border border-border bg-bg-base p-2 text-[10px] text-text-primary"
                      />
                      <button
                        disabled={
                          busy ||
                          campaignView.safety.status === "paused" ||
                          !onlineAiPlayerObjective.trim()
                        }
                        onClick={() => void run(() => enqueue("ai.player.run", {
                          objective: onlineAiPlayerObjective,
                        }, null))}
                        className="mt-2 rounded bg-purple-600 px-3 py-1.5 text-[10px] text-white disabled:opacity-40"
                      >
                        推进 AI 玩家回合
                      </button>
                    </div>
                  )}
                  {member.role === "gm" &&
                    activeOnlineActor?.role === "npc" &&
                    (campaignView.gmController === "ai" ||
                      campaignView.gmController === "hybrid") && (
                      <div
                        className="mt-3 rounded border border-purple-500/30 bg-purple-500/5 p-3 text-xs"
                        data-testid="online-ttrpg-ai-gm-actor"
                      >
                        <strong className="text-text-primary">
                          {campaignView.gmController === "ai"
                            ? "AI KP 的 NPC 回合"
                            : "混合 KP 的 NPC 回合"}
                          · {activeOnlineActor.name}
                        </strong>
                        <p className="mt-1 text-[10px] leading-4 text-text-muted">
                          托管模型只能提出当前 NPC 的合法行动意图；目标、骰点、消耗、状态与回合推进仍由在线房间的冻结 RulePack 权威结算。
                          {campaignView.gmController === "hybrid"
                            ? "点击提交即代表在线真人 KP 确认这次建议。"
                            : "客户端不能用普通行动命令绕过 AI KP。"}
                        </p>
                        <textarea
                          aria-label="在线 AI KP NPC 行动目标"
                          rows={2}
                          maxLength={4_000}
                          value={onlineAiGmActorObjective}
                          onChange={(event) =>
                            setOnlineAiGmActorObjective(event.target.value)
                          }
                          className="mt-2 w-full rounded border border-border bg-bg-base p-2 text-[10px] text-text-primary"
                        />
                        <button
                          disabled={
                            busy ||
                            campaignView.safety.status === "paused" ||
                            !onlineAiGmActorObjective.trim()
                          }
                          onClick={() =>
                            void run(() =>
                              enqueue(
                                "ai.gm.act",
                                { objective: onlineAiGmActorObjective },
                                null,
                              ),
                            )
                          }
                          className="mt-2 rounded bg-purple-600 px-3 py-1.5 text-[10px] text-white disabled:opacity-40"
                        >
                          推进在线 AI KP 的 NPC 回合
                        </button>
                      </div>
                    )}
                  {member.role === "player" && pendingHumanResponse && (
                    <div
                      className="mt-3 rounded border border-accent/30 bg-accent/5 p-3 text-xs"
                      data-testid="online-ttrpg-human-response"
                    >
                      <strong className="text-text-primary">轮到本人回应</strong>
                      <p className="mt-1 leading-5 text-text-muted">
                        这是一条非机械角色回应。若要攻击、施法、移动或消耗资源，请使用上方正式规则行动。
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <select
                          aria-label="在线真人回应类型"
                          value={humanResponseKind}
                          onChange={(event) =>
                            setHumanResponseKind(
                              event.target.value as
                                | "speak"
                                | "act-narratively",
                            )
                          }
                          className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                        >
                          <option value="speak">角色发言</option>
                          <option value="act-narratively">非机械叙事动作</option>
                        </select>
                        <select
                          aria-label="在线真人回应受众"
                          value={humanResponseAudience}
                          onChange={(event) =>
                            setHumanResponseAudience(
                              event.target.value as "party" | "gm-only",
                            )
                          }
                          className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                        >
                          <option value="party">全桌可见</option>
                          <option value="gm-only">仅本人和 GM</option>
                        </select>
                      </div>
                      <textarea
                        aria-label="在线真人角色回应"
                        value={humanResponseText}
                        onChange={(event) => setHumanResponseText(event.target.value)}
                        rows={3}
                        maxLength={10_000}
                        className="mt-2 w-full rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          disabled={busy || !humanResponseText.trim()}
                          onClick={() =>
                            void run(async () => {
                              await enqueue(
                                "human.response",
                                {
                                  actionSequence:
                                    pendingHumanResponse.actionSequence,
                                  actionReceiptKey:
                                    pendingHumanResponse.actionReceiptKey,
                                  responseKind: humanResponseKind,
                                  text: humanResponseText,
                                  audience: humanResponseAudience,
                                },
                                member.actorKey,
                              );
                              setHumanResponseText("");
                            })
                          }
                          className="rounded bg-accent px-2 py-1 text-[10px] text-white disabled:opacity-40"
                        >
                          提交本人回应
                        </button>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              enqueue(
                                "human.response",
                                {
                                  actionSequence:
                                    pendingHumanResponse.actionSequence,
                                  actionReceiptKey:
                                    pendingHumanResponse.actionReceiptKey,
                                  responseKind: "decline",
                                  text: "",
                                  audience: humanResponseAudience,
                                },
                                member.actorKey,
                              ),
                            )
                          }
                          className="rounded border border-border px-2 py-1 text-[10px] text-text-primary disabled:opacity-40"
                        >
                          明确不回应
                        </button>
                      </div>
                    </div>
                  )}
                  {(campaignView?.humanResponses ?? [])
                    .filter(
                      (response) =>
                        latestAction == null ||
                        response.actionSequence === latestAction.eventSequence,
                    )
                    .slice(-10)
                    .map((response) => (
                      <div
                        key={response.responseKey}
                        className="mt-2 rounded border border-border bg-bg-surface p-2 text-xs"
                      >
                        <strong className="text-text-primary">
                          {props.characterNames[response.actorKey] ??
                            response.actorKey}
                          {response.audience === "gm-only"
                            ? " · 仅本人和 GM"
                            : " · 全桌"}
                        </strong>
                        <p className="mt-1 whitespace-pre-wrap text-text-secondary">
                          {response.text}
                        </p>
                      </div>
                    ))}
                </section>
              )}

              {member.role === "gm" && campaignView.gmControls && (
                <section
                  className="rounded border border-warning/30 bg-warning/5 p-3"
                  data-testid="online-ttrpg-gm-controls"
                >
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-warning" />
                    <strong className="text-xs text-text-primary">
                      在线 GM 控制台
                    </strong>
                  </div>
                  <div className="mt-3 grid gap-3 lg:grid-cols-3">
                    <div className="rounded border border-border bg-bg-surface p-2">
                      <strong className="text-[10px] text-text-secondary">
                        推进场景
                      </strong>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {campaignView.gmControls.openableScenes.map((scene) => (
                          <button
                            key={scene.sceneKey}
                            disabled={
                              busy || campaignView.safety.status === "paused"
                            }
                            onClick={() =>
                              void run(() =>
                                enqueue(
                                  "scene.open",
                                  { sceneKey: scene.sceneKey },
                                  null,
                                ),
                              )
                            }
                            className="rounded border border-border px-2 py-1 text-[10px] text-text-primary disabled:opacity-40"
                          >
                            {scene.title}
                          </button>
                        ))}
                        {campaignView.gmControls.openableScenes.length ===
                          0 && (
                          <span className="text-[10px] text-text-muted">
                            无后继场景
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="rounded border border-border bg-bg-surface p-2">
                      <strong className="text-[10px] text-text-secondary">
                        线索公开
                      </strong>
                      <select
                        value={clueActorKey}
                        onChange={(event) =>
                          setClueActorKey(event.target.value)
                        }
                        aria-label="在线线索接收角色"
                        className="mt-2 w-full rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                      >
                        {props.selectedCharacterKeys.map((key) => (
                          <option key={key} value={key}>
                            {props.characterNames[key] ?? key}
                          </option>
                        ))}
                      </select>
                      <div className="mt-2 space-y-1">
                        {campaignView.gmControls.currentClues.map((clue) => (
                          <div
                            key={clue.clueKey}
                            className="rounded bg-bg-base p-2 text-[10px]"
                          >
                            <strong className="text-text-primary">
                              {clue.title}
                            </strong>
                            <p className="mt-1 text-text-muted">
                              {clue.description}
                            </p>
                            {clue.visibility !== "gm-only" && (
                              <div className="mt-1 flex gap-1">
                                <button
                                  disabled={
                                    busy ||
                                    clue.discoveryVisibility != null ||
                                    !clueActorKey
                                  }
                                  onClick={() =>
                                    void run(() =>
                                      enqueue(
                                        "clue.reveal",
                                        {
                                          clueKey: clue.clueKey,
                                          actorKey: clueActorKey,
                                          visibility: "private",
                                        },
                                        clueActorKey,
                                      ),
                                    )
                                  }
                                  className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40"
                                >
                                  私发
                                </button>
                                <button
                                  disabled={
                                    busy ||
                                    clue.discoveryVisibility === "party" ||
                                    !clueActorKey
                                  }
                                  onClick={() =>
                                    void run(() =>
                                      enqueue(
                                        "clue.reveal",
                                        {
                                          clueKey: clue.clueKey,
                                          actorKey: clueActorKey,
                                          visibility: "party",
                                        },
                                        clueActorKey,
                                      ),
                                    )
                                  }
                                  className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40"
                                >
                                  {clue.discoveryVisibility === "private"
                                    ? "升级队伍公开"
                                    : "队伍公开"}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded border border-border bg-bg-surface p-2">
                      <strong className="text-[10px] text-text-secondary">
                        真人主持叙事 / 结局
                      </strong>
                      <textarea
                        value={narrationText}
                        onChange={(event) =>
                          setNarrationText(event.target.value)
                        }
                        rows={3}
                        aria-label="在线真人 GM 叙事"
                        className="mt-2 w-full rounded border border-border bg-bg-base p-2 text-[10px] text-text-primary"
                      />
                      <button
                        disabled={
                          busy ||
                          !latestAction ||
                          !narrationText.trim() ||
                          campaignView.recentNarrations.some(
                            (item) =>
                              item.actionSequence ===
                              latestAction.eventSequence,
                          )
                        }
                        onClick={() =>
                          void run(async () => {
                            await enqueue(
                              "gm.narrate",
                              {
                                actionSequence: latestAction!.eventSequence,
                                text: narrationText,
                              },
                              null,
                            );
                            setNarrationText("");
                          })
                        }
                        className="mt-1 rounded border border-border px-2 py-1 text-[10px] disabled:opacity-40"
                      >
                        提交正式叙事
                      </button>
                      <textarea
                        aria-label="在线 AI GM 主持目标"
                        rows={2}
                        maxLength={4_000}
                        value={onlineAiGmObjective}
                        onChange={(event) => setOnlineAiGmObjective(event.target.value)}
                        className="mt-2 w-full rounded border border-border bg-bg-base p-2 text-[10px] text-text-primary"
                      />
                      <button
                        disabled={
                          busy ||
                          campaignView.safety.status === "paused" ||
                          !latestAction ||
                          !onlineAiGmObjective.trim() ||
                          campaignView.recentNarrations.some(
                            item => item.actionSequence === latestAction.eventSequence,
                          )
                        }
                        onClick={() => void run(() => enqueue("ai.gm.narrate", {
                          objective: onlineAiGmObjective,
                        }, null))}
                        className="mt-1 rounded bg-purple-600 px-2 py-1 text-[10px] text-white disabled:opacity-40"
                      >
                        由 AI KP 反馈最近判定
                      </button>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {campaignView.gmControls.endings.map((ending) => (
                          <button
                            key={ending.endingKey}
                            disabled={busy || !ending.enabled}
                            onClick={() =>
                              void run(() =>
                                enqueue(
                                  "ending.choose",
                                  { endingKey: ending.endingKey },
                                  null,
                                ),
                              )
                            }
                            className="rounded border border-border px-2 py-1 text-[10px] disabled:opacity-40"
                          >
                            {ending.title}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div
                      className="rounded border border-border bg-bg-surface p-2"
                      data-testid="online-ttrpg-effect-plan"
                    >
                      <strong className="text-[10px] text-text-secondary">
                        判定后果账本
                      </strong>
                      <p className="mt-1 text-[9px] leading-4 text-text-muted">
                        每次正式判定只能提交一份后果；奖励、惩罚、关系、资源和时钟会进入可恢复账本。
                      </p>
                      <div className="mt-2 grid gap-1.5">
                        <select
                          aria-label="在线后果类型"
                          value={onlineEffectKind}
                          onChange={(event) => setOnlineEffectKind(event.target.value as typeof onlineEffectKind)}
                          className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                        >
                          <option value="clock">推进剧情时钟</option>
                          <option value="xp">经验 / 成长奖励</option>
                          <option value="relationship">关系 / 声望变化</option>
                          <option value="resource.gain">恢复资源</option>
                          <option value="resource.spend">损失资源</option>
                        </select>
                        <select
                          aria-label="在线后果目标角色"
                          value={resolvedEffectActorKey}
                          onChange={(event) => setOnlineEffectActorKey(event.target.value)}
                          className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                        >
                          {campaignView.actors.filter(actor => actor.role === "player").map(actor => (
                            <option key={actor.actorKey} value={actor.actorKey}>{actor.name}</option>
                          ))}
                        </select>
                        {onlineEffectKind === "clock" && (
                          <select
                            aria-label="在线推进时钟"
                            value={resolvedEffectClockKey}
                            onChange={(event) => setOnlineEffectClockKey(event.target.value)}
                            className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                          >
                            {campaignView.clocks.map(clock => (
                              <option key={clock.clockKey} value={clock.clockKey}>
                                {clock.title} · {clock.current}/{clock.maximum}
                              </option>
                            ))}
                          </select>
                        )}
                        {(onlineEffectKind === "resource.gain" || onlineEffectKind === "resource.spend") && (
                          <select
                            aria-label="在线后果资源"
                            value={resolvedEffectResourceKey}
                            onChange={(event) => setOnlineEffectResourceKey(event.target.value)}
                            className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                          >
                            {(resolvedEffectActor?.resources ?? []).map(resource => (
                              <option key={resource.key} value={resource.key}>
                                {resource.name} · {resource.current}/{resource.maximum}
                              </option>
                            ))}
                          </select>
                        )}
                        <div className="grid grid-cols-2 gap-1.5">
                          <input
                            type="number"
                            aria-label="在线后果数值"
                            value={onlineEffectAmount}
                            onChange={(event) => setOnlineEffectAmount(event.target.value)}
                            className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                          />
                          <select
                            aria-label="在线后果可见性"
                            value={onlineEffectAudience}
                            onChange={(event) => setOnlineEffectAudience(event.target.value as typeof onlineEffectAudience)}
                            className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                          >
                            <option value="party">全桌可见</option>
                            <option value="actor">仅目标与 KP</option>
                            <option value="gm">仅 KP</option>
                          </select>
                        </div>
                        <textarea
                          aria-label="在线后果原因"
                          rows={2}
                          maxLength={4_000}
                          value={onlineEffectReason}
                          onChange={(event) => setOnlineEffectReason(event.target.value)}
                          className="rounded border border-border bg-bg-base p-2 text-[10px] text-text-primary"
                        />
                        <label className="flex items-center gap-2 text-[10px] text-text-secondary">
                          <input
                            type="checkbox"
                            aria-label="在线后果需要玩家选择"
                            checked={onlineEffectRequiresChoice}
                            onChange={(event) => setOnlineEffectRequiresChoice(event.target.checked)}
                          />
                          不立即入账，向目标玩家提供两个互斥选项
                        </label>
                        {onlineEffectRequiresChoice && (
                          <div className="grid grid-cols-2 gap-1.5">
                            <select
                              aria-label="在线备选后果类型"
                              value={onlineAlternativeEffectKind}
                              onChange={(event) => setOnlineAlternativeEffectKind(event.target.value as typeof onlineAlternativeEffectKind)}
                              className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                            >
                              <option value="clock">推进剧情时钟</option>
                              <option value="xp">经验 / 成长奖励</option>
                              <option value="relationship">关系 / 声望变化</option>
                              <option value="resource.gain">恢复资源</option>
                              <option value="resource.spend">损失资源</option>
                            </select>
                            <input
                              type="number"
                              aria-label="在线备选后果数值"
                              value={onlineAlternativeEffectAmount}
                              onChange={(event) => setOnlineAlternativeEffectAmount(event.target.value)}
                              className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                            />
                          </div>
                        )}
                        <button
                          disabled={
                            busy ||
                            campaignView.safety.status === "paused" ||
                            !latestAction ||
                            latestAction.outcome === "hidden" ||
                            latestActionHasEffect ||
                            !resolvedEffectActorKey ||
                            !onlineEffectReason.trim() ||
                            !Number.isFinite(Number(onlineEffectAmount)) ||
                            Number(onlineEffectAmount) === 0 ||
                            (onlineEffectRequiresChoice && (!Number.isFinite(Number(onlineAlternativeEffectAmount)) || Number(onlineAlternativeEffectAmount) === 0)) ||
                            (onlineEffectKind === "clock" && (!resolvedEffectClockKey || !Number.isInteger(Number(onlineEffectAmount)) || Number(onlineEffectAmount) < 1)) ||
                            (onlineEffectRequiresChoice && onlineAlternativeEffectKind === "clock" && (!resolvedEffectClockKey || !Number.isInteger(Number(onlineAlternativeEffectAmount)) || Number(onlineAlternativeEffectAmount) < 1)) ||
                            ((onlineEffectKind === "resource.gain" || onlineEffectKind === "resource.spend") && !resolvedEffectResourceKey)
                          }
                          onClick={() => void run(async () => {
                            const action = latestAction!;
                            const amount = Number(onlineEffectAmount);
                            const effects = [
                              buildOnlineEffect(onlineEffectKind, amount, "primary"),
                              ...(onlineEffectRequiresChoice
                                ? [buildOnlineEffect(onlineAlternativeEffectKind, Number(onlineAlternativeEffectAmount), "alternative")]
                                : []),
                            ];
                            await enqueue(onlineEffectRequiresChoice ? "effects.choice.propose" : "effects.apply", {
                              actionSequence: action.eventSequence,
                              ...(onlineEffectRequiresChoice ? { ownerActorKey: resolvedEffectActorKey } : {}),
                              plan: {
                                schema: "storyforge.ttrpg-effect-plan",
                                version: 2,
                                planKey: `online.effect.${action.eventSequence}`,
                                degree: action.outcome === "automatic" ? "success" : action.outcome,
                                sourceEventId: `event.${action.eventSequence}`,
                                ruleRef: action.actionKey,
                                reason: onlineEffectReason,
                                audience: onlineEffectRequiresChoice
                                  ? `actor:${resolvedEffectActorKey}`
                                  : onlineEffectAudience === "actor"
                                  ? `actor:${resolvedEffectActorKey}`
                                  : onlineEffectAudience,
                                status: onlineEffectRequiresChoice ? "pending-choice" : "immediate",
                                effects,
                              },
                            }, null);
                          })}
                          className="rounded bg-accent px-2 py-1 text-[10px] text-white disabled:opacity-40"
                        >
                          {latestActionHasEffect
                            ? "本次判定已有后果或待选项"
                            : onlineEffectRequiresChoice
                              ? "向玩家提交后果二选一"
                              : "提交权威后果"}
                        </button>
                      </div>
                      <div className="mt-2 space-y-1">
                        {campaignView.effectReceipts.slice(-5).map(receipt => (
                          <div key={receipt.eventSequence} className="rounded bg-bg-base p-1.5 text-[9px] text-text-muted">
                            #{receipt.eventSequence} · {receipt.degree} · {receipt.reason}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div
                      className="rounded border border-border bg-bg-surface p-2"
                      data-testid="online-ttrpg-campaign-session"
                    >
                      <strong className="text-[10px] text-text-secondary">
                        长期战役分场
                      </strong>
                      {!activeOnlineCampaignSession ? (
                        <div className="mt-2 grid gap-1.5">
                          <input
                            aria-label="在线分场标题"
                            value={onlineSessionTitle}
                            onChange={(event) => setOnlineSessionTitle(event.target.value)}
                            placeholder={`第 ${campaignView.continuity.playSessions.length + 1} 场`}
                            className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                          />
                          <button
                            disabled={busy || campaignView.safety.status === "paused"}
                            onClick={() => void run(async () => {
                              const ordinal = campaignView.continuity.playSessions.length + 1;
                              await enqueue("campaign.session.start", {
                                title: onlineSessionTitle.trim() || `第 ${ordinal} 场`,
                              }, null);
                              setOnlineSessionTitle("");
                            })}
                            className="rounded border border-accent/40 bg-accent/5 px-2 py-1 text-[10px] text-accent disabled:opacity-40"
                          >
                            宣布本场开始
                          </button>
                        </div>
                      ) : (
                        <div className="mt-2 grid gap-1.5">
                          <p className="text-[9px] text-text-muted">
                            正在进行：{activeOnlineCampaignSession.title}。结束时由权威端自动生成公开、KP 和各角色隔离回顾。
                          </p>
                          <textarea
                            aria-label="在线分场公开补充"
                            rows={2}
                            value={onlineSessionPublicNote}
                            onChange={(event) => setOnlineSessionPublicNote(event.target.value)}
                            placeholder="可选：全桌都能看到的主持补充"
                            className="rounded border border-border bg-bg-base p-2 text-[10px] text-text-primary"
                          />
                          <textarea
                            aria-label="在线分场跨场记忆"
                            rows={2}
                            value={onlineSessionMemory}
                            onChange={(event) => setOnlineSessionMemory(event.target.value)}
                            placeholder="可选：供下一场 KP/角色引用的记忆"
                            className="rounded border border-border bg-bg-base p-2 text-[10px] text-text-primary"
                          />
                          <select
                            aria-label="在线分场记忆受众"
                            value={onlineSessionMemoryAudience}
                            onChange={(event) => setOnlineSessionMemoryAudience(
                              event.target.value as "party" | "gm-only" | `actor:${string}`,
                            )}
                            className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                          >
                            <option value="party">全队记忆</option>
                            <option value="gm-only">仅 KP</option>
                            {activeOnlineCampaignSession.participantKeys.map(actorKey => (
                              <option key={actorKey} value={`actor:${actorKey}`}>
                                仅角色：{props.characterNames[actorKey] ?? actorKey}
                              </option>
                            ))}
                          </select>
                          <button
                            disabled={busy || campaignView.safety.status === "paused"}
                            onClick={() => void run(async () => {
                              await enqueue("campaign.session.complete", {
                                publicNote: onlineSessionPublicNote,
                                memorySummary: onlineSessionMemory,
                                memoryAudience: onlineSessionMemoryAudience,
                              }, null);
                              setOnlineSessionPublicNote("");
                              setOnlineSessionMemory("");
                              setOnlineSessionMemoryAudience("party");
                            })}
                            className="rounded border border-success/40 bg-success/5 px-2 py-1 text-[10px] text-success disabled:opacity-40"
                          >
                            自动对账并结束本场
                          </button>
                        </div>
                      )}
                      <div className="mt-2 space-y-1">
                        {campaignView.continuity.playSessions.slice(-5).map(session => (
                          <div key={session.sessionKey} className="rounded bg-bg-base p-1.5 text-[9px] text-text-muted">
                            {session.title} · {session.status === "active" ? "进行中" : "已结束"}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {campaignView.tabletop && (
                <TtrpgTabletopSurface
                  tabletop={campaignView.tabletop}
                  viewerRole={member.role}
                  viewerActorKey={member.actorKey}
                  selectedTokenKey={selectedOnlineTokenKey}
                  disabled={busy || campaignView.safety.status === "paused"}
                  resolveEntityName={(entityKey) =>
                    campaignView.actors.find(
                      (actor) => actor.actorKey === entityKey,
                    )?.name ?? entityKey
                  }
                  onSelectToken={setSelectedOnlineTokenKey}
                  onMoveToken={({ tokenKey, x, y, controllerKey }) =>
                    run(() =>
                      enqueue(
                        "tabletop.move",
                        { tokenKey, x, y },
                        controllerKey,
                      ),
                    )
                  }
                  onSetFog={({ fogKey, revealed }) =>
                    run(() =>
                      enqueue("tabletop.fog", { fogKey, revealed }, null),
                    )
                  }
                  onSetLayer={({ layerKey, visible }) =>
                    run(() =>
                      enqueue("tabletop.layer", { layerKey, visible }, null),
                    )
                  }
                  testId="online-ttrpg-tabletop-controls"
                  label="在线战术桌面"
                />
              )}

              <div className="grid gap-3 lg:grid-cols-4">
                <section
                  className="rounded border border-border bg-bg-surface p-3"
                  data-testid="online-ttrpg-inventory"
                >
                  <div className="flex items-center gap-2">
                    <ScrollText className="h-4 w-4 text-accent" />
                    <strong className="text-xs text-text-primary">
                      物品与装备
                    </strong>
                  </div>
                  {member.role === "gm" && campaignView.gmControls && (
                    <div className="mt-2 space-y-2 rounded border border-border bg-bg-base p-2">
                      <select
                        aria-label="在线授予规则物品"
                        value={onlineGrantItemKey}
                        onChange={(event) => setOnlineGrantItemKey(event.target.value)}
                        className="w-full rounded border border-border bg-bg-surface px-2 py-1 text-[10px] text-text-primary"
                      >
                        <option value="">选择授予物品…</option>
                        {campaignView.gmControls.itemDefinitions.map(item => (
                          <option key={item.itemKey} value={item.itemKey}>{item.title}</option>
                        ))}
                      </select>
                      <select
                        aria-label="在线授予物品角色"
                        value={onlineGrantOwnerKey}
                        onChange={(event) => setOnlineGrantOwnerKey(event.target.value)}
                        className="w-full rounded border border-border bg-bg-surface px-2 py-1 text-[10px] text-text-primary"
                      >
                        {campaignView.actors.filter(actor => actor.role === "player").map(actor => (
                          <option key={actor.actorKey} value={actor.actorKey}>{actor.name}</option>
                        ))}
                      </select>
                      <button
                        disabled={busy || !onlineGrantItemKey || !onlineGrantOwnerKey}
                        onClick={() => void run(async () => {
                          await enqueue("item.command", { operation: {
                            kind: "grant",
                            instanceId: `item.online.${roomProjection!.roomSequence + 1}.${onlineGrantItemKey}`,
                            definitionRef: onlineGrantItemKey,
                            ownerRef: onlineGrantOwnerKey,
                            locationRef: null,
                            quantity: 1,
                          } }, null);
                          setOnlineGrantItemKey("");
                        })}
                        className="rounded bg-accent px-2 py-1 text-[10px] text-white disabled:opacity-40"
                      >
                        权威授予
                      </button>
                      <div className="flex flex-wrap gap-1">
                        {(["short-rest", "long-rest"] as const).map(restKind => (
                          <button
                            key={restKind}
                            disabled={busy || campaignView.safety.status === "paused"}
                            onClick={() => void run(() => enqueue("rest.complete", {
                              restKey: `rest.online.${roomProjection!.roomSequence + 1}.${restKind}`,
                              restKind,
                              actorKeys: props.selectedCharacterKeys,
                              reason: restKind === "short-rest"
                                ? "GM 确认队伍获得一次短休整备。"
                                : "GM 确认队伍完成一次安全长休。",
                            }, null))}
                            className="rounded border border-border px-2 py-1 text-[10px] text-text-primary disabled:opacity-40"
                          >
                            {restKind === "short-rest" ? "结算短休" : "结算长休"}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-2 space-y-1">
                    {campaignView.inventory.map((item) => (
                      <div
                        key={item.itemInstanceId}
                        className="rounded bg-bg-base p-2 text-[10px]"
                      >
                        <strong className="text-text-primary">
                          {item.title}
                        </strong>
                        <p className="mt-1 text-text-muted">
                          数量 {item.quantity}
                          {item.charges == null
                            ? ""
                            : ` · 充能 ${item.charges}`}
                          {item.durability == null
                            ? ""
                            : ` · 耐久 ${item.durability}`}
                          {item.equippedSlots.length
                            ? ` · ${item.equippedSlots.join("、")}`
                            : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.canUse && (
                            <button
                              disabled={busy || campaignView.safety.status === "paused"}
                              onClick={() => void run(() => enqueue("item.command", { operation: {
                                kind: "use",
                                instanceId: item.itemInstanceId,
                                expectedOwnerRef: item.ownerRef,
                                amount: 1,
                              } }, member.role === "player" ? member.actorKey : null))}
                              className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40"
                            >使用 1 次</button>
                          )}
                          {item.requiresAttunement && item.attunedToActorRef !== item.ownerRef && item.ownerRef && (
                            <button
                              disabled={busy || campaignView.safety.status === "paused"}
                              onClick={() => void run(() => enqueue("item.command", { operation: {
                                kind: "attune",
                                instanceId: item.itemInstanceId,
                                expectedOwnerRef: item.ownerRef,
                              } }, member.role === "player" ? member.actorKey : null))}
                              className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40"
                            >绑定</button>
                          )}
                          {item.allowedEquipSlots.length > 0 && item.equippedSlots.length === 0 && item.ownerRef && (
                            <button
                              disabled={busy || campaignView.safety.status === "paused" || item.stateTags.includes("broken")}
                              onClick={() => void run(() => enqueue("item.command", { operation: {
                                kind: "equip",
                                instanceId: item.itemInstanceId,
                                expectedOwnerRef: item.ownerRef,
                                slots: item.allowedEquipSlots,
                              } }, member.role === "player" ? member.actorKey : null))}
                              className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40"
                            >装备</button>
                          )}
                          {item.equippedSlots.length > 0 && item.ownerRef && (
                            <button
                              disabled={busy || campaignView.safety.status === "paused"}
                              onClick={() => void run(() => enqueue("item.command", { operation: {
                                kind: "unequip",
                                instanceId: item.itemInstanceId,
                                expectedOwnerRef: item.ownerRef,
                              } }, member.role === "player" ? member.actorKey : null))}
                              className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40"
                            >卸下</button>
                          )}
                          {item.ownerRef && campaignView.actors.filter(actor => actor.role === "player" && actor.actorKey !== item.ownerRef).length > 0 && (
                            <select
                              aria-label={`在线转移${item.title}`}
                              defaultValue=""
                              disabled={busy || campaignView.safety.status === "paused"}
                              onChange={(event) => {
                                const destinationOwnerRef = event.target.value;
                                if (!destinationOwnerRef) return;
                                void run(() => enqueue("item.command", { operation: {
                                  kind: "transfer",
                                  instanceId: item.itemInstanceId,
                                  expectedOwnerRef: item.ownerRef,
                                  destinationOwnerRef,
                                } }, member.role === "player" ? member.actorKey : null));
                              }}
                              className="rounded border border-border bg-bg-surface px-1 py-0.5"
                            >
                              <option value="">转移给…</option>
                              {campaignView.actors.filter(actor => actor.role === "player" && actor.actorKey !== item.ownerRef).map(actor => (
                                <option key={actor.actorKey} value={actor.actorKey}>{actor.name}</option>
                              ))}
                            </select>
                          )}
                          {member.role === "gm" && item.durability != null && item.maximumDurability != null && item.durability < item.maximumDurability && (
                            <button
                              disabled={busy || campaignView.safety.status === "paused"}
                              onClick={() => void run(() => enqueue("item.command", { operation: {
                                kind: "repair", instanceId: item.itemInstanceId, amount: 1,
                              } }, null))}
                              className="rounded border border-border px-1.5 py-0.5 disabled:opacity-40"
                            >修复 1</button>
                          )}
                        </div>
                      </div>
                    ))}
                    {campaignView.inventory.length === 0 && (
                      <p className="text-[10px] text-text-muted">
                        当前视图没有可见物品。
                      </p>
                    )}
                  </div>
                </section>
                <section className="rounded border border-border bg-bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <ScrollText className="h-4 w-4 text-accent" />
                    <strong className="text-xs text-text-primary">
                      已知线索与任务
                    </strong>
                  </div>
                  <div className="mt-2 space-y-1">
                    {campaignView.visibleClues.map((clue) => (
                      <div
                        key={clue.clueKey}
                        className="rounded bg-bg-base p-2 text-[10px]"
                      >
                        <strong className="text-text-primary">
                          {clue.title}
                        </strong>
                        <p className="mt-1 text-text-muted">
                          {clue.description}
                        </p>
                      </div>
                    ))}
                    {campaignView.visibleClues.length === 0 && (
                      <p className="text-[10px] text-text-muted">
                        尚无可见线索。
                      </p>
                    )}
                    {campaignView.quests.map((quest) => (
                      <div
                        key={quest.questKey}
                        className="mt-2 text-[10px] text-text-secondary"
                      >
                        <strong>
                          {quest.status === "completed" ? "✓" : "○"}{" "}
                          {quest.title}
                        </strong>
                        <p className="text-text-muted">{quest.objective}</p>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="rounded border border-border bg-bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <BookOpenText className="h-4 w-4 text-accent" />
                    <strong className="text-xs text-text-primary">
                      已公开讲义
                    </strong>
                  </div>
                  <div className="mt-2 space-y-1">
                    {campaignView.visibleHandouts.map((handout) => (
                      <details
                        key={handout.handoutKey}
                        className="rounded bg-bg-base p-2 text-[10px]"
                      >
                        <summary className="cursor-pointer text-text-primary">
                          {handout.title}
                        </summary>
                        <p className="mt-1 whitespace-pre-wrap text-text-muted">
                          {handout.body}
                        </p>
                      </details>
                    ))}
                  </div>
                </section>
                <section className="rounded border border-border bg-bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <BookOpenText className="h-4 w-4 text-accent" />
                    <strong className="text-xs text-text-primary">
                      规则速查
                    </strong>
                  </div>
                  <div className="mt-2 max-h-48 space-y-1 overflow-auto">
                    {campaignView.ruleReference.map((entry) => (
                      <details
                        key={entry.key}
                        className="rounded bg-bg-base p-2 text-[10px]"
                      >
                        <summary className="cursor-pointer text-text-primary">
                          {entry.title}
                        </summary>
                        <p className="mt-1 text-text-muted">{entry.body}</p>
                      </details>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}

          {member.role === "gm" && (
            <div className="rounded border border-border bg-bg-surface p-3">
              <strong className="text-xs text-text-primary">
                <Link2 className="mr-1 inline h-3.5 w-3.5" />
                签发限时邀请
              </strong>
              <div className="mt-2 flex flex-wrap gap-2">
                <select
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(event.target.value as "player" | "spectator")
                  }
                  aria-label="邀请席位"
                  className="rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                >
                  <option value="player">玩家</option>
                  <option value="spectator">观战</option>
                </select>
                {inviteRole === "player" && (
                  <select
                    value={inviteActorKey}
                    onChange={(event) => setInviteActorKey(event.target.value)}
                    aria-label="邀请角色"
                    className="rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
                  >
                    {props.selectedCharacterKeys.map((key) => (
                      <option key={key} value={key}>
                        {props.characterNames[key] ?? key}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  disabled={
                    busy || (inviteRole === "player" && !inviteActorKey)
                  }
                  onClick={() =>
                    void run(async () => {
                      setIssuedInvite(
                        await transport.issueInvite({
                          roomId,
                          gmMemberId: member.memberId,
                          gmAuthToken: credentialsRef.current!.authToken,
                          role: inviteRole,
                          actorKey:
                            inviteRole === "player" ? inviteActorKey : null,
                          expiresAt: Date.now() + 30 * 60_000,
                          maximumUses: 1,
                        }),
                      );
                    })
                  }
                  className="rounded border border-accent px-3 py-1.5 text-xs text-accent disabled:opacity-40"
                >
                  生成 30 分钟单次邀请
                </button>
              </div>
              {issuedInvite && (
                <div className="mt-2 rounded bg-bg-base p-2">
                  <div className="break-all font-mono text-[10px] text-text-secondary">
                    房间 {roomId}
                    <br />
                    邀请 {issuedInvite.inviteId}
                    <br />
                    凭据 {issuedInvite.inviteToken}
                  </div>
                  <button
                    onClick={() =>
                      void navigator.clipboard?.writeText(invitationText)
                    }
                    className="mt-2 rounded border border-border px-2 py-1 text-[10px] text-text-secondary"
                  >
                    <Copy className="mr-1 inline h-3 w-3" />
                    复制三行邀请
                  </button>
                </div>
              )}
            </div>
          )}

          <div
            className="rounded border border-border bg-bg-surface p-3"
            data-testid="online-gm-transfer"
          >
            <strong className="text-xs text-text-primary">
              双方确认的主持移交
            </strong>
            <p className="mt-1 text-[10px] leading-4 text-text-muted">
              新主持人必须使用自己的房间凭据确认；确认后旧主持人接管该玩家原角色，未使用邀请立即失效，房间事件与骰子承诺保持连续。
            </p>
            {member.role === "gm" ? (
              <>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const rows = await transport.listMembers({
                          roomId,
                          memberId: member.memberId,
                          authToken: credentialsRef.current!.authToken,
                        });
                        setRoomMembers(rows);
                        const eligible = rows.filter(
                          (row) =>
                            row.role === "player" &&
                            row.connected &&
                            row.actorKey,
                        );
                        setTransferTargetMemberId((current) =>
                          eligible.some((row) => row.memberId === current)
                            ? current
                            : (eligible[0]?.memberId ?? ""),
                        );
                      })
                    }
                    className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary disabled:opacity-40"
                  >
                    刷新可移交成员
                  </button>
                  <select
                    value={transferTargetMemberId}
                    onChange={(event) =>
                      setTransferTargetMemberId(event.target.value)
                    }
                    aria-label="新主持人成员"
                    className="rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                  >
                    <option value="">选择在线玩家</option>
                    {roomMembers
                      .filter(
                        (row) =>
                          row.role === "player" &&
                          row.connected &&
                          row.actorKey,
                      )
                      .map((row) => (
                        <option key={row.memberId} value={row.memberId}>
                          {row.displayName} · {row.actorKey}
                        </option>
                      ))}
                  </select>
                  <button
                    disabled={busy || !transferTargetMemberId}
                    onClick={() =>
                      void run(async () => {
                        const transfer = await transport.proposeGmTransfer({
                          roomId,
                          gmMemberId: member.memberId,
                          gmAuthToken: credentialsRef.current!.authToken,
                          targetMemberId: transferTargetMemberId,
                          expiresAt: Date.now() + 5 * 60_000,
                        });
                        setIssuedGmTransfer(transfer);
                        setSnapshot(await clientRef.current!.recover());
                      })
                    }
                    className="rounded border border-warning/60 px-2 py-1 text-[10px] text-warning disabled:opacity-40"
                  >
                    发起 5 分钟移交
                  </button>
                </div>
                {issuedGmTransfer && (
                  <div className="mt-2 rounded bg-bg-base p-2 text-[10px] text-text-secondary">
                    目标：{issuedGmTransfer.target.displayName}
                    <br />
                    移交编号：
                    <span className="font-mono">
                      {issuedGmTransfer.transferId}
                    </span>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await transport.cancelGmTransfer({
                            roomId,
                            gmMemberId: member.memberId,
                            gmAuthToken: credentialsRef.current!.authToken,
                            transferId: issuedGmTransfer.transferId,
                          });
                          setIssuedGmTransfer(null);
                          setSnapshot(await clientRef.current!.recover());
                        })
                      }
                      className="ml-2 rounded border border-danger/40 px-2 py-0.5 text-danger disabled:opacity-40"
                    >
                      取消移交
                    </button>
                  </div>
                )}
              </>
            ) : (
              <form
                className="mt-2 flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const transferId =
                      incomingGmTransferId.trim() ||
                      incomingTransfer?.transferId ||
                      "";
                    if (!transferId)
                      throw new Error("请输入当前主持人发出的移交编号。");
                    await transport.acceptGmTransfer({
                      roomId,
                      memberId: member.memberId,
                      authToken: credentialsRef.current!.authToken,
                      transferId,
                    });
                    setIncomingGmTransferId("");
                    setSnapshot(await clientRef.current!.recover());
                  });
                }}
              >
                {incomingTransfer && (
                  <p
                    className="w-full rounded border border-warning/40 bg-warning/5 p-2 text-[10px] text-warning"
                    data-testid="incoming-gm-transfer"
                  >
                    当前主持人邀请你接任；有效至
                    {new Date(incomingTransfer.expiresAt).toLocaleTimeString()}
                    。 只有点击确认后角色与主持权才会交换。
                  </p>
                )}
                <input
                  value={incomingGmTransferId}
                  onChange={(event) =>
                    setIncomingGmTransferId(event.target.value)
                  }
                  aria-label="主持移交编号"
                  placeholder="由当前主持人发送的移交编号"
                  className="min-w-[260px] flex-1 rounded border border-border bg-bg-base px-2 py-1 text-[10px] text-text-primary"
                />
                <button
                  disabled={
                    busy || (!incomingGmTransferId.trim() && !incomingTransfer)
                  }
                  className="rounded border border-accent px-2 py-1 text-[10px] text-accent disabled:opacity-40"
                >
                  确认接任主持
                </button>
              </form>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <form
              className="rounded border border-border bg-bg-surface p-3"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await enqueue("chat.message", { text: chatText });
                  setChatText("");
                });
              }}
            >
              <strong className="text-xs text-text-primary">
                <MessageSquareText className="mr-1 inline h-3.5 w-3.5" />
                房间文字
              </strong>
              <div className="mt-2 max-h-28 space-y-1 overflow-auto">
                {roomProjection?.recentChat.map((message) => (
                  <div
                    key={message.sequence}
                    className="rounded bg-bg-base px-2 py-1 text-[10px]"
                  >
                    <strong className="text-text-primary">
                      {message.displayName}
                    </strong>
                    <span className="ml-2 text-text-secondary">
                      {message.text}
                    </span>
                  </div>
                ))}
              </div>
              <textarea
                value={chatText}
                onChange={(event) => setChatText(event.target.value)}
                rows={2}
                aria-label="在线房间消息"
                className="mt-2 w-full rounded border border-border bg-bg-base p-2 text-xs text-text-primary"
              />
              <button
                disabled={busy || !chatText.trim()}
                className="mt-2 rounded border border-border px-2 py-1 text-[10px] text-text-secondary disabled:opacity-40"
              >
                发送
              </button>
            </form>
            <form
              className="rounded border border-border bg-bg-surface p-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (diceValidationError) {
                  setError(diceValidationError);
                  return;
                }
                void run(() =>
                  enqueue("dice.request", { expression: diceExpression }),
                );
              }}
            >
              <strong className="text-xs text-text-primary">
                <Dices className="mr-1 inline h-3.5 w-3.5" />
                可验证骰子（d2～d100）
              </strong>
              <input
                value={diceExpression}
                onChange={(event) => setDiceExpression(event.target.value)}
                aria-label="在线骰式"
                aria-invalid={Boolean(diceValidationError)}
                pattern="[0-9]{1,3}[dD][0-9]{1,3}([+-][0-9]{1,5})?"
                title="只支持 1～100 颗 d2～d100，例如 1d20+3"
                className="mt-2 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
              />
              {diceValidationError && (
                <p className="mt-1 text-[9px] text-danger">
                  {diceValidationError}
                </p>
              )}
              <button
                disabled={
                  busy || !diceExpression.trim() || Boolean(diceValidationError)
                }
                className="mt-2 rounded border border-border px-2 py-1 text-[10px] text-text-secondary disabled:opacity-40"
              >
                请求权威掷骰
              </button>
            </form>
            <div className="rounded border border-border bg-bg-surface p-3">
              <strong className="text-xs text-text-primary">安全工具</strong>
              <input
                value={safetyReason}
                onChange={(event) => setSafetyReason(event.target.value)}
                aria-label="在线暂停原因"
                className="mt-2 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
              />
              <div className="mt-2 flex gap-2">
                <button
                  disabled={busy || !safetyReason.trim()}
                  onClick={() =>
                    void run(() =>
                      enqueue("safety.pause", { reason: safetyReason }),
                    )
                  }
                  className="rounded border border-warning px-2 py-1 text-[10px] text-warning disabled:opacity-40"
                >
                  <PauseCircle className="mr-1 inline h-3 w-3" />
                  暂停
                </button>
                {member.role === "gm" && (
                  <button
                    disabled={busy}
                    onClick={() => void run(() => enqueue("safety.resume", {}))}
                    className="rounded border border-success px-2 py-1 text-[10px] text-success disabled:opacity-40"
                  >
                    <PlayCircle className="mr-1 inline h-3 w-3" />
                    恢复
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="rounded border border-border bg-bg-surface p-3">
            <strong className="text-xs text-text-primary">最近权威事件</strong>
            <div className="mt-2 max-h-48 space-y-1 overflow-auto">
              {(snapshot?.events ?? []).slice(-20).map((event) => (
                <div
                  key={event.sequence}
                  className="flex gap-2 rounded bg-bg-base px-2 py-1 text-[10px]"
                >
                  <span className="font-mono text-text-muted">
                    #{event.sequence}
                  </span>
                  <span className="text-text-secondary">{event.eventType}</span>
                  <span className="ml-auto font-mono text-text-muted">
                    {event.resultingStateHash.slice(0, 10)}…
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded border border-danger/30 bg-danger/10 p-2 text-xs text-danger"
        >
          {error}
        </p>
      )}
    </section>
  );
}
