import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import {
  Check,
  Images,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Unlock,
} from "lucide-react";
import type {
  AdaptationProject,
  AdaptationSourceUnit,
  ComicMediaAsset,
  ComicPage,
  ComicPanel,
  ComicVisualSubject,
  MediaRightsV1,
  Work,
  WorkspaceScope,
} from "../../lib/types";
import type { AdaptationFreshnessReport } from "../../lib/adaptation/source-manifest";
import { db } from "../../lib/db/schema";
import {
  inspectAdaptationFreshness,
  listActiveSourceUnits,
  resyncAdaptationSource,
} from "../../lib/adaptation/source-manifest";
import { reopenAdaptationProductionV1 } from "../../lib/adaptation/completion";
import {
  applyComicPageTemplateV1,
  comicPanelFramesV1,
  createComicPage,
  deleteComicPage,
  listComicPages,
  listComicVisualSubjects,
  reorderComicPages,
  reorderComicPanels,
  saveComicVisualSubject,
  updateComicPage,
  updateComicPanel,
} from "../../lib/comic/service";
import {
  commitUploadedComicAssetV1,
  generateComicPanelCandidatesV1,
  generateComicSubjectCandidatesV1,
  listComicMediaAssets,
  readComicAssetDataUrlV1,
  removeComicMediaAssetV1,
  selectComicMediaAssetV1,
} from "../../lib/comic/media-service";
import {
  inspectComicQualityV1,
  type ComicQualityReportV1,
} from "../../lib/comic/qa";
import {
  renderComicArchiveV1,
  renderComicPageSvgV1,
  renderComicPrintHtmlV1,
} from "../../lib/comic/renderers";
import {
  getAIConfigRequiredMessage,
  isAIConfigReady,
} from "../../lib/ai/config-readiness";
import { useAIConfigStore } from "../../stores/ai-config";
import { useDialog } from "../shared/Dialog";
import ComicPanelInspector from "./ComicPanelInspector";
import ComicQaPanel from "./ComicQaPanel";
import ComicVisualPanel from "./ComicVisualPanel";
import ComicPipelinePanel from "./ComicPipelinePanel";
import {
  EMPTY_COMIC_SUBJECT_DESIGN,
  type ComicPageGroup,
  type ComicSubjectDraft,
} from "./studio-model";
import "./comic-studio.css";

interface Props {
  scope: WorkspaceScope;
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadText(
  filename: string,
  content: string,
  type = "text/plain;charset=utf-8",
): void {
  downloadBlob(filename, new Blob([content], { type }));
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "-").trim() || "comic";
}

export default function ComicStudio({ scope }: Props) {
  const [adaptation, setAdaptation] = useState<AdaptationProject | null>(null);
  const [work, setWork] = useState<Work | null>(null);
  const [units, setUnits] = useState<AdaptationSourceUnit[]>([]);
  const [groups, setGroups] = useState<ComicPageGroup[]>([]);
  const [subjects, setSubjects] = useState<ComicVisualSubject[]>([]);
  const [characterOptions, setCharacterOptions] = useState<
    Array<{ id: number; name: string }>
  >([]);
  const [locationOptions, setLocationOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [assets, setAssets] = useState<ComicMediaAsset[]>([]);
  const [freshness, setFreshness] = useState<AdaptationFreshnessReport | null>(
    null,
  );
  const [quality, setQuality] = useState<ComicQualityReportV1 | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<number | null>(null);
  const [selectedPanelId, setSelectedPanelId] = useState<number | null>(null);
  const [editingPanel, setEditingPanel] = useState<ComicPanel | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(
    null,
  );
  const [subjectDraft, setSubjectDraft] = useState<ComicSubjectDraft>({
    stableKey: "",
    kind: "prop",
    characterId: null,
    locationRefKey: null,
    label: "",
    design: structuredClone(EMPTY_COMIC_SUBJECT_DESIGN),
    sourceUnitIds: [],
    status: "draft",
  });
  const [tab, setTab] = useState<"storyboard" | "visual" | "qa">("storyboard");
  const [newPanelCount, setNewPanelCount] = useState(4);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [rightsDeclaration, setRightsDeclaration] = useState(
    "作者确认拥有该图片的使用权，或已核对生成服务条款。",
  );
  const [commercialUse, setCommercialUse] =
    useState<MediaRightsV1["commercialUse"]>("unknown");
  const [redistribution, setRedistribution] =
    useState<MediaRightsV1["redistribution"]>("unknown");
  const [allowLimitedConsistency, setAllowLimitedConsistency] = useState(false);
  const [imageModel, setImageModel] = useState("gpt-image-1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dragPageId, setDragPageId] = useState<number | null>(null);
  const [dragPanelId, setDragPanelId] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const aiConfig = useAIConfigStore((state) => state.config);
  const dialog = useDialog();

  const reload = useCallback(async () => {
    const [root, targetWork] = await Promise.all([
      db.adaptationProjects.where("workId").equals(scope.workId).first(),
      db.works.get(scope.workId),
    ]);
    if (!root?.id || root.medium !== "comic" || !targetWork)
      throw new Error("当前作品不是有效漫画改编。");
    const [
      sourceUnits,
      pageGroups,
      visualSubjects,
      mediaAssets,
      fresh,
      bindings,
      characters,
      geographies,
    ] = await Promise.all([
      listActiveSourceUnits(root.id),
      listComicPages(scope),
      listComicVisualSubjects(scope),
      listComicMediaAssets(scope),
      inspectAdaptationFreshness(root.id),
      db.workCharacterBindings.where("workId").equals(scope.workId).toArray(),
      db.characters.where("projectId").equals(scope.projectId).toArray(),
      db.geographies.where("projectId").equals(scope.projectId).toArray(),
    ]);
    const boundIds = new Set(bindings.map((binding) => binding.characterId));
    const locations = geographies.flatMap((row) => {
      try {
        const parsed = JSON.parse(row.locations) as Array<{
          id?: unknown;
          name?: unknown;
        }>;
        return Array.isArray(parsed)
          ? parsed.filter(
              (item): item is { id: string; name: string } =>
                typeof item?.id === "string" && typeof item.name === "string",
            )
          : [];
      } catch {
        return [];
      }
    });
    setAdaptation(root);
    setWork(targetWork);
    setUnits(sourceUnits);
    setGroups(pageGroups);
    setSubjects(visualSubjects);
    setAssets(mediaAssets);
    setFreshness(fresh);
    setCharacterOptions(
      characters
        .filter(
          (character) => character.id != null && boundIds.has(character.id),
        )
        .map((character) => ({ id: character.id!, name: character.name })),
    );
    setLocationOptions([
      ...new Map(locations.map((location) => [location.id, location])).values(),
    ]);
    setSelectedPageId((current) =>
      current != null && pageGroups.some((group) => group.page.id === current)
        ? current
        : (pageGroups[0]?.page.id ?? null),
    );
  }, [scope]);

  useEffect(() => {
    void reload().catch((cause) =>
      setError(cause instanceof Error ? cause.message : "读取漫画失败"),
    );
  }, [reload]);
  const currentGroup = useMemo(
    () => groups.find((group) => group.page.id === selectedPageId) ?? null,
    [groups, selectedPageId],
  );
  useEffect(() => {
    if (!currentGroup) {
      setSelectedPanelId(null);
      return;
    }
    setSelectedPanelId((current) =>
      current != null &&
      currentGroup.panels.some((panel) => panel.id === current)
        ? current
        : (currentGroup.panels[0]?.id ?? null),
    );
  }, [currentGroup]);
  useEffect(() => {
    const panel =
      currentGroup?.panels.find((row) => row.id === selectedPanelId) ?? null;
    setEditingPanel(panel ? structuredClone(panel) : null);
  }, [currentGroup, selectedPanelId]);
  useEffect(() => {
    const subject = subjects.find((row) => row.id === selectedSubjectId);
    if (subject)
      setSubjectDraft({
        stableKey: subject.stableKey,
        kind: subject.kind,
        characterId: subject.characterId,
        locationRefKey: subject.locationRefKey,
        label: subject.label,
        design: structuredClone(subject.design),
        sourceUnitIds: [...subject.sourceUnitIds],
        status: subject.status,
      });
  }, [selectedSubjectId, subjects]);

  const visibleAssets = useMemo(
    () =>
      assets.filter(
        (asset) =>
          asset.panelId === selectedPanelId ||
          asset.subjectKey ===
            subjects.find((subject) => subject.id === selectedSubjectId)
              ?.stableKey ||
          currentGroup?.panels.some(
            (panel) => panel.selectedMediaAssetKey === asset.stableKey,
          ),
      ),
    [assets, currentGroup, selectedPanelId, selectedSubjectId, subjects],
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const asset of visibleAssets)
        try {
          next[asset.stableKey] = (
            await readComicAssetDataUrlV1({ scope, assetKey: asset.stableKey })
          ).dataUrl;
        } catch {
          /* QA exposes damaged media. */
        }
      if (!cancelled) setAssetUrls((current) => ({ ...current, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, visibleAssets]);

  const act = async (action: () => Promise<unknown>, success?: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      await reload();
      if (success) setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const rights = (source: MediaRightsV1["source"]): MediaRightsV1 => ({
    version: 1,
    source,
    commercialUse,
    redistribution,
    attribution: "",
    declaration: rightsDeclaration.trim(),
    declaredAt: Date.now(),
  });

  if (!adaptation || !work)
    return (
      <div className="comic-loading">{error || "正在打开漫画工作台…"}</div>
    );
  if (adaptation.medium !== "comic")
    return <div className="comic-loading">当前改编媒介不是漫画。</div>;
  const productionReady = ["producing", "review", "complete"].includes(
    adaptation.status,
  );
  if (!productionReady)
    return (
      <div className="comic-studio">
        <header className="comic-top">
          <div>
            <span>COMIC STUDIO</span>
            <h2>{work.title}</h2>
            <p>先冻结 Brief、章页计划与视觉圣经，再进入页格生产。</p>
          </div>
        </header>
        <ComicPipelinePanel
          scope={scope}
          adaptation={adaptation}
          sourceUnits={units}
          pages={groups.map((group) => group.page)}
          panels={groups.flatMap((group) => group.panels)}
          subjectCount={subjects.length}
          onChanged={reload}
        />
        {error && <p className="comic-error">{error}</p>}
      </div>
    );

  const sourceLabel =
    freshness?.status === "unchanged"
      ? "来源未变化"
      : freshness?.status === "changed"
        ? "来源已变化"
        : freshness?.status === "missing"
          ? "来源已删除，既有成品仍可编辑导出"
          : "已脱离来源";
  const isComplete = adaptation.status === "complete";
  const panelAssets = assets
    .filter(
      (asset) =>
        asset.panelId === selectedPanelId && asset.disposition === "available",
    )
    .sort((left, right) => left.candidateIndex - right.candidateIndex);
  const selectedSubject =
    subjects.find((subject) => subject.id === selectedSubjectId) ?? null;
  const subjectAssets = selectedSubject
    ? assets
        .filter(
          (asset) =>
            asset.subjectKey === selectedSubject.stableKey &&
            asset.disposition === "available",
        )
        .sort((left, right) => left.candidateIndex - right.candidateIndex)
    : [];
  const previewSvg = currentGroup
    ? (() => {
        try {
          return renderComicPageSvgV1({
            page: currentGroup.page,
            panels: currentGroup.panels,
            targetSpec: adaptation.targetSpec,
            assetDataUrls: assetUrls,
            mode: "storyboard",
          });
        } catch {
          return "";
        }
      })()
    : "";

  const createPage = () => {
    const unit =
      units.find((item) => item.sourceKind === "chapter") ?? units[0];
    if (!unit?.id) {
      setError("缺少可用来源单元。");
      return;
    }
    const frames = comicPanelFramesV1(newPanelCount);
    void act(
      () =>
        createComicPage(scope, {
          chapterNumber: Math.min(
            adaptation.targetSpec.chapterCount,
            currentGroup?.page.chapterNumber ?? 1,
          ),
          summary: "新页面：建立节奏、动作与翻页点。",
          panels: frames.map((frame, index) => ({
            frame,
            shot: {
              size: index === 0 ? "wide" : "medium",
              angle: "eye-level",
              movement: "static",
              composition: "",
            },
            action: `格 ${index + 1} 的可见动作。`,
            visualPrompt: "",
            negativePrompt: "text, letters, speech bubbles, watermark",
            continuityRefs: [],
            lettering: [],
            sourceUnitIds: [unit.id!],
          })),
        }),
      "已创建页面",
    );
  };
  const savePanel = () =>
    editingPanel?.id &&
    void act(
      () =>
        updateComicPanel({
          scope,
          panelId: editingPanel.id!,
          expectedRevision: editingPanel.revision,
          patch: {
            frame: editingPanel.frame,
            sourceUnitIds: editingPanel.sourceUnitIds,
            shot: editingPanel.shot,
            nextPanelKey: editingPanel.nextPanelKey,
            narrativeFunction: editingPanel.narrativeFunction,
            moment: editingPanel.moment,
            action: editingPanel.action,
            visualPrompt: editingPanel.visualPrompt,
            negativePrompt: editingPanel.negativePrompt,
            continuityRefs: editingPanel.continuityRefs,
            subjectStates: editingPanel.subjectStates,
            protectedAreas: editingPanel.protectedAreas,
            lettering: editingPanel.lettering,
            imageTransform: editingPanel.imageTransform,
            status: editingPanel.status,
          },
        }),
      "格已保存",
    );
  const generateMedia = async (regenerate: boolean, subject = false) => {
    if (busy) return;
    if (!isAIConfigReady(aiConfig)) {
      setError(getAIConfigRequiredMessage(aiConfig));
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (subject) {
        if (!selectedSubject?.id) throw new Error("请先选择视觉条目");
        await generateComicSubjectCandidatesV1({
          scope,
          subjectId: selectedSubject.id,
          expectedSubjectRevision: selectedSubject.revision,
          aiConfig,
          imageModel,
          count: adaptation.targetSpec.renderCandidatesPerPanel,
          rights: rights("provider-generated"),
          allowLimitedConsistency,
          regenerateNonce: regenerate ? nanoid(12) : undefined,
          signal: controller.signal,
        });
      } else {
        if (!editingPanel?.id) throw new Error("请先选择漫画格");
        await generateComicPanelCandidatesV1({
          scope,
          panelId: editingPanel.id,
          expectedPanelRevision: editingPanel.revision,
          aiConfig,
          imageModel,
          count: adaptation.targetSpec.renderCandidatesPerPanel,
          rights: rights("provider-generated"),
          allowLimitedConsistency,
          regenerateNonce: regenerate ? nanoid(12) : undefined,
          signal: controller.signal,
        });
      }
      await reload();
      setMessage("图片候选已验证并提交；尚未自动选片。");
    } catch (cause) {
      setError(
        controller.signal.aborted
          ? "图片生成已取消，未提交候选。"
          : cause instanceof Error
            ? cause.message
            : "图片生成失败",
      );
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };
  const upload = async (file: File, subject = false) => {
    const buffer = await file.arrayBuffer();
    await act(
      () =>
        commitUploadedComicAssetV1({
          scope,
          data: buffer,
          panelId: subject ? undefined : editingPanel?.id,
          subjectId: subject ? selectedSubject?.id : undefined,
          rights: rights("author-upload"),
        }),
      "图片已校验并作为候选导入",
    );
  };
  const selectAsset = (asset: ComicMediaAsset, subject = false) =>
    void act(
      () =>
        selectComicMediaAssetV1({
          scope,
          assetKey: asset.stableKey,
          panelId: subject ? undefined : editingPanel?.id,
          subjectId: subject ? selectedSubject?.id : undefined,
          expectedRevision: subject
            ? selectedSubject!.revision
            : editingPanel!.revision,
        }),
      "已选择图片",
    );
  const removeAsset = async (asset: ComicMediaAsset) => {
    if (
      !(await dialog.confirm({
        title: "删除图片候选？",
        message: "系统会先清理稳定引用，再用两阶段回收删除无引用二进制。",
        confirmText: "删除候选",
        tone: "danger",
      }))
    )
      return;
    await act(
      () =>
        removeComicMediaAssetV1({
          scope,
          assetKey: asset.stableKey,
          clearReferences: true,
        }),
      "候选已删除并完成引用复查",
    );
  };
  const runQuality = async () => {
    setBusy(true);
    setError("");
    try {
      const report = await inspectComicQualityV1(scope);
      setQuality(report);
      setTab("qa");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "QA 失败");
    } finally {
      setBusy(false);
    }
  };
  const book = async () => {
    const report = await inspectComicQualityV1(scope);
    setQuality(report);
    if (!report.canFormalExport)
      throw new Error(
        `正式导出被 QA 阻止：${report.issues
          .filter((issue) => issue.level === "error")
          .map((issue) => issue.message)
          .join("；")}`,
      );
    const urls = new Map<string, string>();
    for (const group of groups)
      for (const panel of group.panels)
        if (
          panel.selectedMediaAssetKey &&
          !urls.has(panel.selectedMediaAssetKey)
        )
          urls.set(
            panel.selectedMediaAssetKey,
            (
              await readComicAssetDataUrlV1({
                scope,
                assetKey: panel.selectedMediaAssetKey,
              })
            ).dataUrl,
          );
    return {
      title: work.title,
      targetSpec: adaptation.targetSpec,
      pages: groups.map((group) => ({ ...group, assetDataUrls: urls })),
    };
  };
  const exportArchive = async (format: "png-zip" | "webp-zip" | "cbz") => {
    setBusy(true);
    setError("");
    try {
      const blob = await renderComicArchiveV1({ ...(await book()), format });
      downloadBlob(
        `${safeName(work.title)}.${format === "cbz" ? "cbz" : "zip"}`,
        blob,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };
  const exportPdf = async () => {
    const popup = window.open("", "_blank");
    if (!popup) {
      setError("浏览器阻止了打印窗口。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      popup.document.write(await renderComicPrintHtmlV1(await book()));
      popup.document.close();
      popup.focus();
      setTimeout(() => popup.print(), 250);
    } catch (cause) {
      popup.close();
      setError(cause instanceof Error ? cause.message : "PDF 打印导出失败");
    } finally {
      setBusy(false);
    }
  };
  const saveSubject = () => {
    const sourceIds = subjectDraft.sourceUnitIds.length
      ? subjectDraft.sourceUnitIds
      : units.flatMap((unit) => (unit.id ? [unit.id] : [])).slice(0, 1);
    void act(
      () =>
        saveComicVisualSubject({
          scope,
          subjectId: selectedSubject?.id,
          expectedRevision: selectedSubject?.revision,
          draft: {
            ...subjectDraft,
            stableKey: subjectDraft.stableKey || `subject_${nanoid(8)}`,
            sourceUnitIds: sourceIds,
          },
        }),
      "视觉条目已保存",
    );
  };

  return (
    <div className="comic-studio">
      <header className="comic-top">
        <div>
          <span>COMIC STUDIO</span>
          <h2>{work.title}</h2>
          <p>
            页漫 · {adaptation.targetSpec.readingDirection.toUpperCase()} ·{" "}
            {adaptation.targetSpec.colorMode} ·{" "}
            {adaptation.targetSpec.pageSize.width}×
            {adaptation.targetSpec.pageSize.height}
            {adaptation.targetSpec.pageSize.unit}
          </p>
        </div>
        <div className={`comic-source ${freshness?.status ?? ""}`}>
          <strong>{isComplete ? "正式完稿 · 当前只读" : sourceLabel}</strong>
          <small>manifest v{adaptation.activeSourceManifestVersion}</small>
          {isComplete ? (
            <button
              onClick={() =>
                void act(
                  () =>
                    reopenAdaptationProductionV1({
                      scope,
                      expectedRevision: adaptation.revision,
                    }),
                  "已重新打开审校",
                )
              }
            >
              <Unlock />
              重新打开审校
            </button>
          ) : (
            freshness?.status === "changed" && (
              <button
                onClick={() =>
                  void act(() =>
                    resyncAdaptationSource({
                      adaptationProjectId: adaptation.id!,
                      expectedRevision: adaptation.revision,
                    }),
                  )
                }
              >
                <RefreshCw />
                确认同步
              </button>
            )
          )}
        </div>
      </header>
      <ComicPipelinePanel
        scope={scope}
        adaptation={adaptation}
        sourceUnits={units}
        pages={groups.map((group) => group.page)}
        panels={groups.flatMap((group) => group.panels)}
        subjectCount={subjects.length}
        onChanged={reload}
      />
      <nav className="comic-toolbar">
        <button
          className={tab === "storyboard" ? "active" : ""}
          onClick={() => setTab("storyboard")}
        >
          <Images />
          页格与排字
        </button>
        <button
          className={tab === "visual" ? "active" : ""}
          onClick={() => setTab("visual")}
        >
          <Sparkles />
          视觉圣经与设定图
        </button>
        <button
          className={tab === "qa" ? "active" : ""}
          onClick={() => void runQuality()}
        >
          <Check />
          QA 与导出
        </button>
        <span />
        <label>
          图片模型
          <input
            value={imageModel}
            onChange={(event) => setImageModel(event.target.value)}
          />
        </label>
        <label className="comic-check">
          <input
            type="checkbox"
            checked={allowLimitedConsistency}
            onChange={(event) =>
              setAllowLimitedConsistency(event.target.checked)
            }
          />
          接受 provider 一致性能力限制
        </label>
      </nav>
      {tab === "storyboard" && (
        <div className="comic-layout">
          <aside className="comic-pages">
            <header>
              <strong>页面</strong>
              <small>
                {groups.length} 页 /{" "}
                {groups.reduce((sum, group) => sum + group.panels.length, 0)} 格
              </small>
            </header>
            <div className="comic-create-page">
              <select
                value={newPanelCount}
                onChange={(event) =>
                  setNewPanelCount(Number(event.target.value))
                }
              >
                {Array.from({ length: 9 }, (_, index) => (
                  <option key={index + 1} value={index + 1}>
                    {index + 1} 格模板
                  </option>
                ))}
              </select>
              <button
                onClick={createPage}
                disabled={busy || freshness?.status !== "unchanged"}
              >
                <Plus />
                新页
              </button>
            </div>
            {groups.map((group, index) => (
              <button
                key={group.page.id}
                draggable
                onDragStart={() => setDragPageId(group.page.id!)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (!dragPageId || dragPageId === group.page.id) return;
                  const ids = groups.map((item) => item.page.id!);
                  ids.splice(
                    ids.indexOf(group.page.id!),
                    0,
                    ids.splice(ids.indexOf(dragPageId), 1)[0],
                  );
                  void act(() =>
                    reorderComicPages({ scope, orderedPageIds: ids }),
                  );
                  setDragPageId(null);
                }}
                className={group.page.id === selectedPageId ? "active" : ""}
                onClick={() => setSelectedPageId(group.page.id!)}
              >
                <span>{index + 1}</span>
                <div>
                  <strong>
                    第 {group.page.chapterNumber} 章 · {group.panels.length} 格
                  </strong>
                  <small>{group.page.summary || "未写页面摘要"}</small>
                </div>
                {group.page.status === "locked" && <Lock />}
              </button>
            ))}
          </aside>
          <main className="comic-canvas-area">
            {currentGroup ? (
              <>
                <div className="comic-page-controls">
                  <input
                    value={currentGroup.page.summary}
                    onChange={(event) =>
                      setGroups((rows) =>
                        rows.map((group) =>
                          group.page.id === currentGroup.page.id
                            ? {
                                ...group,
                                page: {
                                  ...group.page,
                                  summary: event.target.value,
                                },
                              }
                            : group,
                        ),
                      )
                    }
                  />
                  <select
                    value={currentGroup.page.status}
                    onChange={(event) =>
                      void act(() =>
                        updateComicPage({
                          scope,
                          pageId: currentGroup.page.id!,
                          expectedRevision: currentGroup.page.revision,
                          patch: {
                            status: event.target.value as ComicPage["status"],
                          },
                        }),
                      )
                    }
                  >
                    <option value="storyboarded">分镜中</option>
                    <option value="reviewed">已审定</option>
                    <option value="locked">锁定</option>
                  </select>
                  <button
                    onClick={() =>
                      void act(() =>
                        updateComicPage({
                          scope,
                          pageId: currentGroup.page.id!,
                          expectedRevision: currentGroup.page.revision,
                          patch: { summary: currentGroup.page.summary },
                        }),
                      )
                    }
                  >
                    <Save />
                    保存页
                  </button>
                  <button
                    onClick={() =>
                      void act(() =>
                        applyComicPageTemplateV1({
                          scope,
                          pageId: currentGroup.page.id!,
                          expectedPageRevision: currentGroup.page.revision,
                        }),
                      )
                    }
                  >
                    套用模板
                  </button>
                  <button
                    className="danger"
                    onClick={() =>
                      void (async () => {
                        if (
                          await dialog.confirm({
                            title: "删除漫画页？",
                            message:
                              "页内格和图片候选会同时删除；无引用 Blob 将经过两阶段回收。",
                            confirmText: "删除页面",
                            tone: "danger",
                          })
                        )
                          await act(() =>
                            deleteComicPage({
                              scope,
                              pageId: currentGroup.page.id!,
                            }),
                          );
                      })()
                    }
                  >
                    <Trash2 />
                  </button>
                </div>
                {previewSvg && (
                  <div
                    className="comic-page-preview"
                    dangerouslySetInnerHTML={{ __html: previewSvg }}
                  />
                )}
                <div className="comic-panel-strip">
                  {currentGroup.panels.map((panel, index) => (
                    <button
                      key={panel.id}
                      draggable
                      onDragStart={() => setDragPanelId(panel.id!)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (!dragPanelId || dragPanelId === panel.id) return;
                        const ids = currentGroup.panels.map((row) => row.id!);
                        ids.splice(
                          ids.indexOf(panel.id!),
                          0,
                          ids.splice(ids.indexOf(dragPanelId), 1)[0],
                        );
                        void act(() =>
                          reorderComicPanels({
                            scope,
                            pageId: currentGroup.page.id!,
                            orderedPanelIds: ids,
                          }),
                        );
                        setDragPanelId(null);
                      }}
                      className={panel.id === selectedPanelId ? "active" : ""}
                      onClick={() => setSelectedPanelId(panel.id!)}
                    >
                      <span>{index + 1}</span>
                      <small>{panel.shot.size}</small>
                      {panel.selectedMediaAssetKey ? <Check /> : <Images />}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="comic-empty">
                新建页面或让 AI 生成可编辑分镜。
              </div>
            )}
          </main>
          <ComicPanelInspector
            scope={scope}
            groups={groups}
            currentGroup={currentGroup}
            editingPanel={editingPanel}
            setEditingPanel={setEditingPanel}
            units={units}
            subjects={subjects}
            busy={busy}
            savePanel={savePanel}
            rights={{
              declaration: rightsDeclaration,
              setDeclaration: setRightsDeclaration,
              commercialUse,
              setCommercialUse,
              redistribution,
              setRedistribution,
            }}
            generateMedia={generateMedia}
            abortRef={abortRef}
            upload={upload}
            panelAssets={panelAssets}
            assetUrls={assetUrls}
            selectAsset={selectAsset}
            removeAsset={removeAsset}
            act={act}
          />
        </div>
      )}
      {tab === "visual" && (
        <ComicVisualPanel
          scope={scope}
          units={units}
          subjects={subjects}
          selectedSubjectId={selectedSubjectId}
          setSelectedSubjectId={setSelectedSubjectId}
          subjectDraft={subjectDraft}
          setSubjectDraft={setSubjectDraft}
          characterOptions={characterOptions}
          locationOptions={locationOptions}
          selectedSubject={selectedSubject}
          subjectAssets={subjectAssets}
          assetUrls={assetUrls}
          busy={busy}
          saveSubject={saveSubject}
          generateMedia={generateMedia}
          upload={upload}
          selectAsset={selectAsset}
          removeAsset={removeAsset}
          act={act}
        />
      )}
      {tab === "qa" && (
        <ComicQaPanel
          scope={scope}
          work={work}
          adaptation={adaptation}
          groups={groups}
          subjects={subjects}
          assets={assets}
          quality={quality}
          busy={busy}
          runQuality={runQuality}
          exportArchive={exportArchive}
          exportPdf={exportPdf}
          downloadText={downloadText}
          safeName={safeName}
          act={act}
        />
      )}
      {(error || message) && (
        <div
          className={error ? "comic-error" : "comic-message"}
          role={error ? "alert" : "status"}
        >
          {error || message}
        </div>
      )}
    </div>
  );
}
