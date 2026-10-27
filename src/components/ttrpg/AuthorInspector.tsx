import { useEffect, useState } from "react";
import type { WorkspaceScope } from "../../lib/types";
import type { ProductRuntimePackageWithTtrpgV2 } from '../../lib/ttrpg/content-version';
import {
  readProductProductionDetailsV1,
  beginProductProductionEvolutionV1,
} from "../../lib/product-production/service";
import { verifyProductBuildPreviewManifestV1 } from "../../lib/product-production/preview-manifest";
import { createBuildProductMediaResolver } from "../../lib/product-production/media-resolver";
import TtrpgOpenAuthorDiagnostics from './TtrpgOpenAuthorDiagnostics';
export default function AuthorInspector({
  scope,
  productionId,
  page,
  onProduction,
}: {
  scope: WorkspaceScope | null;
  productionId: number | null;
  page: string;
  onProduction: () => void;
}) {
  const [pkg, setPkg] = useState<ProductRuntimePackageWithTtrpgV2 | null>(null),
    [details, setDetails] = useState<Awaited<
      ReturnType<typeof readProductProductionDetailsV1>
    > | null>(null),
    [error, setError] = useState(""),
    [request, setRequest] = useState(""),
    [busy, setBusy] = useState(false),
    [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const created: string[] = [];
    setPkg(null);
    setDetails(null);
    setError("");
    setUrls({});
    if (scope && productionId)
      void (async () => {
        const d = await readProductProductionDetailsV1(scope, productionId, [
          "ttrpg",
        ]);
        if (!active) return;
        setDetails(d);
        if (!d.build?.previewManifestJson) return;
        const p = await verifyProductBuildPreviewManifestV1(
          d.build.previewManifestJson,
          { ttrpgProtocol: 2 },
        );
        if (!active) return;
        setPkg(p.runtimePackage);
        const resolver = await createBuildProductMediaResolver({
          scope,
          productBuildId: d.build.id!,
          preview: p,
        });
        const result: Record<string, string> = {};
        try {
        for (const asset of p.runtimePackage.presentation?.assets ?? []) {
          const blob = await resolver.read(asset.assetKey);
          if (blob) {
            const url = URL.createObjectURL(blob);
            created.push(url);
            result[asset.assetKey] = url;
          }
        }
        if (active) setUrls(result);
        else created.forEach((u) => URL.revokeObjectURL(u));
        } finally { resolver.dispose(); }
      })().catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [scope, productionId, page]);
  useEffect(() => { setRequest(''); }, [scope?.projectId, scope?.worldId, scope?.workId, productionId]);
  const campaign = pkg?.ttrpg?.campaign;
  const collections = campaign
    ? page === "characters"
      ? [["角色卡", campaign.characterTemplates]]
      : page === "scenes"
        ? campaign.version === 2 ? [
            ['局势', campaign.situationTemplates], ['压力时钟', campaign.clocks], ['威胁', campaign.fronts],
            ['冻结事实（作者可见）', campaign.frozenWorldPredicateIndex.entries],
            ['秘密（作者可见）', campaign.secrets], ['阶段闭合', [campaign.stageClosurePolicy]],
          ] : [
            ["场景", campaign.scenes],
            ["线索", campaign.clues],
            ["压力与威胁", campaign.fronts],
            ["秘密（作者可见）", campaign.secrets],
            ["结局", campaign.endings],
          ]
        : [
            ["地图", campaign.tabletop?.maps ?? []],
            ["玩家手册", campaign.handouts],
          ]
    : [];
  return (
    <>
      <section className="lf-paper">
        <h3>
          {page === "characters"
            ? "角色卡"
            : page === "scenes"
              ? "战役与场景"
              : page === "media"
                ? "地图与手册"
                : "素材管理"}
        </h3>
        <p>
          这里读取当前制作版本的真实内容。作者检查包含主持秘密，游玩者只接收自己的可见内容。
        </p>
        {error && <p role="alert">{error}</p>}
        {!campaign ? (
          <>
            <p>
              还没有可检查的制作产物。先准备方案并执行制作；生成失败时可在制作流程查看原始草稿并修复。
            </p>
            <button className="lf-action" onClick={onProduction}>
              查看制作流程
            </button>
          </>
        ) : (
          <>
            {collections.map(([label, list]) => (
              <section key={String(label)}>
                <h4>{String(label)}</h4>
                {(list as unknown as Record<string, unknown>[]).map(
                  (item, i) => (
                    <details key={i} className="ttrpg-object">
                      <summary>
                        {String(item.title ?? item.name ?? `条目 ${i + 1}`)}
                      </summary>
                      {Object.entries(item)
                        .filter(
                          ([k]) => !k.endsWith("Key") && !k.endsWith("Keys"),
                        )
                        .map(([k, v]) => (
                          <div key={k}>
                            <strong>
                              {(
                                {
                                  description: "描述",
                                  truth: "真相",
                                  pitch: "梗概",
                                  epilogue: "尾声",
                                  body: "内容",
                                  goal: "目标",
                                  visibility: "可见范围",
                                  controller: "控制者",
                                  attributes: "属性",
                                  resources: "资源",
                                  revealRule: "揭示规则",
                                  sourceRefs: "来源",
                                  role: "角色",
                                } as Record<string, string>
                              )[k] ?? k}
                            </strong>
                            <p className="ttrpg-object-value">
                              {typeof v === "string"
                                ? v
                                : JSON.stringify(v, null, 2)}
                            </p>
                          </div>
                        ))}
                    </details>
                  ),
                )}
              </section>
            ))}
            {["media", "media-all"].includes(page) && (
              <div className="lf-library-grid">
                {(pkg.presentation?.assets ?? []).map((a) => (
                  <article key={a.assetKey}>
                    <h4>{a.name}</h4>
                    {urls[a.assetKey] && a.mimeType.startsWith("image/") ? (
                      <img src={urls[a.assetKey]} alt={a.name} />
                    ) : null}
                    <p>
                      {a.kind} · {a.source}
                    </p>
                    <p>许可：{a.license}</p>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      {page === 'scenes' && scope && productionId && details && <TtrpgOpenAuthorDiagnostics
        key={`${scope.projectId}:${scope.worldId}:${scope.workId}:${productionId}`}
        scope={scope} productionId={productionId} onRevisionDraft={text => {
          if (request.includes(text)) return true;
          const next = request.trim() ? `${request}\n\n${text}` : text;
          if (next.length > 10000) return false;
          setRequest(next);
          return true;
        }} />}
      {details && (
        <section className="lf-paper">
          <h3>修订这一版</h3>
          <p>
            写明需要修改的场景、角色或素材。确认后创建新的制作轮次，再到制作流程授权执行并检查结果；当前发布与已有存档保持原版本。
          </p>
          <textarea
            aria-label="跑团内容修订要求"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            maxLength={10000}
          />
          <button
            className="lf-action"
            disabled={busy || !request.trim()}
            onClick={() => {
              if (!scope || !productionId || !details) return;
              setBusy(true);
              void beginProductProductionEvolutionV1({
                scope,
                productionId,
                expectedStateRevision: details.production.stateRevision,
                userText: request,
                affectedLanes:
                  page === "media" || page === "media-all"
                    ? ["visual"]
                    : ["content", "product"],
              })
                .then(onProduction)
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            创建修订轮次
          </button>
          <p>若当前生成失败，可在制作流程提交作者校订稿并经过原校验链重试。</p>
        </section>
      )}
    </>
  );
}
