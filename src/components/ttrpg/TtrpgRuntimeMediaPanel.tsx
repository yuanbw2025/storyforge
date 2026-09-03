import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageIcon, Loader2, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { resolveProductRuntimeSource } from "../../lib/product-production/preview-source";
import {
  cancelTtrpgRuntimeAssetRequestV1,
  readTtrpgRuntimeMediaBlobV1,
  readVisibleTtrpgRuntimeMediaRequestsV1,
  requestConfiguredTtrpgRuntimeAssetV1,
  retryConfiguredTtrpgRuntimeAssetRequestV1,
} from "../../lib/ttrpg/runtime-media";
import type {
  ProductRuntimePackageV1,
  ProductRuntimeSourceV1,
  TtrpgRuntimeAssetRequestRecordV1,
  WorkspaceScope,
} from "../../lib/types";
import type { TtrpgViewerProjectionV1 } from "../../lib/ttrpg/viewer-projection";

type MediaProjection = NonNullable<TtrpgViewerProjectionV1["media"]>;
type VisibleRequest = Omit<
  TtrpgRuntimeAssetRequestRecordV1,
  | "prompt"
  | "negativePrompt"
  | "processorLeaseId"
  | "processorLeaseExpiresAt"
  | "lastErrorDetail"
>;

const KIND_LABELS: Record<MediaProjection["slots"][number]["kind"], string> = {
  scene: "场景图",
  map: "地图",
  "character-portrait": "角色立绘",
  "character-expression": "角色表情",
  token: "桌面 Token",
  "item-icon": "物品图标",
  handout: "玩家讲义",
};
const STATUS_LABELS: Record<
  MediaProjection["slots"][number]["status"],
  string
> = {
  placeholder: "文字 fallback",
  queued: "排队中",
  available: "可用",
  failed: "生成失败",
  cancelled: "已取消",
};

function requestKey(sessionId: number): string {
  return `runtime.${sessionId}.${Date.now().toString(36)}.${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export default function TtrpgRuntimeMediaPanel(props: {
  sessionId: number;
  scope: WorkspaceScope;
  runtimePackage: ProductRuntimePackageV1;
  source: ProductRuntimeSourceV1;
  media: MediaProjection;
  viewerKey: string;
  disabled: boolean;
  onChanged: () => Promise<void>;
}) {
  const [requests, setRequests] = useState<VisibleRequest[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [promptAddition, setPromptAddition] = useState("");
  const [workingSlotKey, setWorkingSlotKey] = useState("");
  const [error, setError] = useState("");
  const onChanged = props.onChanged;

  const refreshRequests = useCallback(async () => {
    const rows = await readVisibleTtrpgRuntimeMediaRequestsV1({
      sessionId: props.sessionId,
      viewerKey: props.viewerKey,
    });
    setRequests(rows);
    return rows;
  }, [props.sessionId, props.viewerKey]);

  useEffect(() => {
    let cancelled = false;
    void refreshRequests().catch((cause) => {
      if (!cancelled)
        setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
    };
  }, [props.media.generatedCount, props.media.slots, refreshRequests]);

  const mediaSignature = useMemo(
    () =>
      JSON.stringify(
        props.media.slots.map((slot) => [
          slot.slotKey,
          slot.status,
          slot.assetKey,
          slot.mediaAssetId,
          slot.mediaContentHash,
        ]),
      ),
    [props.media.slots],
  );

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    let resolver: Awaited<ReturnType<typeof resolveProductRuntimeSource>>["mediaResolver"] | null = null;
    void (async () => {
      const next: Record<string, string> = {};
      const prebuiltKeys = props.media.slots.flatMap((slot) => {
        if (slot.mediaAssetId != null) return [];
        return slot.status === "available" && slot.assetKey ? [slot.assetKey] : [];
      });
      if (prebuiltKeys.length) {
        resolver = (await resolveProductRuntimeSource({
          scope: props.scope,
          source: props.source,
        })).mediaResolver;
        const catalog = await resolver.preload({
          assetKeys: prebuiltKeys,
          maximumBytes: 100 * 1024 * 1024,
        });
        for (const slot of props.media.slots) {
          const key = slot.assetKey;
          if (key && catalog.urls[key]) next[slot.slotKey] = catalog.urls[key];
        }
      }
      for (const slot of props.media.slots) {
        if (slot.status !== "available" || slot.mediaAssetId == null) continue;
        try {
          const blob = await readTtrpgRuntimeMediaBlobV1({
            scope: props.scope,
            sessionId: props.sessionId,
            mediaAssetId: slot.mediaAssetId,
            viewerKey: props.viewerKey,
          });
          const url = URL.createObjectURL(blob);
          objectUrls.push(url);
          next[slot.slotKey] = url;
        } catch {
          // A broken or unauthorized byte binding remains playable through fallback text.
        }
      }
      if (!cancelled) setUrls(next);
    })().catch((cause) => {
      if (!cancelled)
        setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
      resolver?.dispose();
    };
  }, [
    mediaSignature,
    props.runtimePackage,
    props.source,
    props.scope,
    props.sessionId,
    props.viewerKey,
    props.media.slots,
  ]);

  const pending = requests.some(
    (row) => row.status === "queued" || row.status === "generating",
  );
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      void refreshRequests().then((rows) => {
        if (
          rows.every(
            (row) => row.status !== "queued" && row.status !== "generating",
          )
        ) {
          void onChanged();
        }
      });
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [onChanged, pending, refreshRequests]);

  const requestByKey = useMemo(
    () => new Map(requests.map((row) => [row.requestKey, row])),
    [requests],
  );
  const act = async (slotKey: string, action: () => Promise<unknown>) => {
    setWorkingSlotKey(slotKey);
    setError("");
    try {
      await action();
      await refreshRequests();
      await props.onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorkingSlotKey("");
    }
  };

  return (
    <section
      className="rounded border border-border bg-bg-base p-4"
      data-testid="ttrpg-runtime-media-panel"
      aria-label="跑团动态美术与视觉素材"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <ImageIcon className="h-4 w-4 text-accent" />
            动态美术与视觉素材
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-text-muted">
            所有素材都绑定冻结视觉圣经和稳定槽位；生成在后台进行，失败、离线或预算不足时继续使用文字
            fallback，不会阻塞行动与规则裁决。
          </p>
        </div>
        <div className="rounded bg-bg-surface px-3 py-2 text-[10px] text-text-muted">
          已生成 {props.media.generatedCount} /{" "}
          {props.media.maximumGeneratedAssets}
        </div>
      </div>
      <label className="mt-3 grid gap-1 text-[10px] text-text-muted">
        本次补充要求（不会改写冻结角色身份与世界锚点）
        <input
          value={promptAddition}
          onChange={(event) => setPromptAddition(event.target.value)}
          maxLength={4000}
          placeholder="例如：突出潮门关闭前的紧迫感"
          className="rounded border border-border bg-bg-surface px-3 py-2 text-xs text-text-primary"
        />
      </label>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {props.media.slots.map((slot) => {
          const row = slot.requestKey
            ? requestByKey.get(slot.requestKey)
            : undefined;
          const working = workingSlotKey === slot.slotKey;
          const url = urls[slot.slotKey];
          return (
            <article
              key={slot.slotKey}
              className="overflow-hidden rounded border border-border bg-bg-surface"
            >
              <div className="aspect-[3/2] bg-bg-hover">
                {url ? (
                  <img
                    src={url}
                    alt={slot.altText}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                    {slot.status === "queued" ||
                    row?.status === "generating" ? (
                      <Loader2 className="h-6 w-6 animate-spin text-accent" />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-text-muted" />
                    )}
                    <p className="line-clamp-4 text-[10px] leading-4 text-text-muted">
                      {slot.fallbackText}
                    </p>
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-xs text-text-primary">
                    {KIND_LABELS[slot.kind]}
                  </strong>
                  <span
                    className={`text-[9px] ${slot.status === "failed" ? "text-danger" : slot.status === "available" ? "text-success" : "text-text-muted"}`}
                  >
                    {url
                      ? slot.mediaAssetId != null ? "运行时可用" : "预制可用"
                      : row?.status === "generating"
                      ? "生成中"
                      : STATUS_LABELS[slot.status]}
                  </span>
                </div>
                <p
                  className="mt-1 truncate text-[9px] text-text-muted"
                  title={slot.slotKey}
                >
                  {slot.slotKey}
                </p>
                {slot.lastErrorCode && (
                  <p className="mt-1 text-[10px] text-danger">
                    错误代码：{slot.lastErrorCode}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {!url && (slot.status === "placeholder" ||
                    slot.status === "cancelled") && (
                    <button
                      disabled={
                        props.disabled ||
                        working ||
                        props.media.generatedCount >=
                          props.media.maximumGeneratedAssets
                      }
                      onClick={() =>
                        void act(slot.slotKey, () =>
                          requestConfiguredTtrpgRuntimeAssetV1({
                            sessionId: props.sessionId,
                            viewerKey: props.viewerKey,
                            slotKey: slot.slotKey,
                            requestKey: requestKey(props.sessionId),
                            promptAddition,
                            onSettled: async () => {
                              await refreshRequests();
                              await props.onChanged();
                            },
                          }),
                        )
                      }
                      className="rounded bg-accent px-2 py-1 text-[10px] text-white disabled:opacity-40"
                    >
                      <Sparkles className="mr-1 inline h-3 w-3" />
                      后台生成
                    </button>
                  )}
                  {slot.status === "failed" &&
                    row &&
                    row.attemptCount < row.maximumAttempts && (
                      <button
                        disabled={props.disabled || working}
                        onClick={() =>
                          void act(slot.slotKey, () =>
                            retryConfiguredTtrpgRuntimeAssetRequestV1({
                              requestId: row.id!,
                              viewerKey: props.viewerKey,
                              onSettled: async () => {
                                await refreshRequests();
                                await props.onChanged();
                              },
                            }),
                          )
                        }
                        className="rounded border border-border px-2 py-1 text-[10px] text-text-secondary disabled:opacity-40"
                      >
                        <RefreshCw className="mr-1 inline h-3 w-3" />
                        重试 {row.attemptCount}/{row.maximumAttempts}
                      </button>
                    )}
                  {(row?.status === "queued" || slot.status === "failed") &&
                    row && (
                      <button
                        disabled={props.disabled || working}
                        onClick={() =>
                          void act(slot.slotKey, () =>
                            cancelTtrpgRuntimeAssetRequestV1({
                              requestId: row.id!,
                              viewerKey: props.viewerKey,
                            }),
                          )
                        }
                        className="rounded border border-danger/40 px-2 py-1 text-[10px] text-danger disabled:opacity-40"
                      >
                        <XCircle className="mr-1 inline h-3 w-3" />
                        取消
                      </button>
                    )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!props.media.slots.length && (
        <p className="mt-3 text-xs text-text-muted">
          当前 viewer 暂无可见视觉槽位。
        </p>
      )}
    </section>
  );
}
