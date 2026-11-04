import { assertCurrentProductEntryV1, evaluateCurrentProductEntryV1 } from '../lib/product/product-catalog'
import BrandIcon from '../components/shared/BrandIcon'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { liveQuery } from "dexie";
import { BookOpen } from "lucide-react";
import { db } from "../lib/db/schema";
import type {
  Project,
  Work,
  WorkspaceScope,
  ProductProductionSourceSelectionV1,
} from "../lib/types";
import {
  defaultAiTownSettings,
  settingsFromAiTownDraft,
  type AiTownAuthoringDraftV1,
  type AiTownAuthoringSettingsV1,
} from "../lib/ai-town/authoring-contract";
import {
  createAiTownDraft,
  saveAiTownDraft,
  selectAiTownWorld,
  readAiTownDraft,
  prepareAiTownBrief,
  saveAiTownSourceSelection,
} from "../lib/ai-town/authoring-service";
import { consultProductProductionStartV1 } from "../lib/product-production/service";
import { listLocalWorldReferenceChoicesV1 } from "../lib/world-engine/reference-cache";
import { updateWorkspace } from "../lib/workspace/works";
import { scopeTransactionTables } from "../lib/workspace/scope";
import { exportProjectJSON, downloadJSON } from "../lib/export/json-export";
import { saveFile } from "../lib/platform/save-file";
import { PRODUCT_NAVIGATION } from "../components/navigation/product-navigation";
import {
  TOWN_PAGES,
  TOWN_PRIMARY,
  TOWN_SETUP_PAGES,
  TOWN_BUILD_PAGES,
  TOWN_PLAY_PAGES,
  townPrimary,
} from "../components/ai-town/author-navigation";
import AuthorSettings from "../components/ai-town/AuthorSettings";
import { parseProductProductionHandoffV1 } from "../lib/product-production/handoff";
import "../components/longform/longform.css";
import "../components/avg/avg.css";
import "../components/ai-town/author.css";
const Studio = lazy(
  () => import("../components/product/ProductProductionStudio"),
);
const Player = lazy(() => import("../components/ai-town/AuthorPlayer"));
const Community = lazy(() => import("../components/community/CommunityPrototypeGallery"));
const Proposal = lazy(() => import("../components/ai-town/Consultation"));
const Inspector = lazy(() => import("../components/ai-town/AuthorInspector"));
const Outlet = lazy(
  () => import("../components/world-engine/WorldResourceBrowser"),
);
import { flushPendingEditsV1 } from "../lib/authoring/pending-edit-coordinator";
const PRODUCTS = ["ai-town"] as const;
type Row = {
  project: Project;
  work: Work;
  draft?: AiTownAuthoringDraftV1;
  productionId?: number;
};
type EditingBasis = {
  scope: WorkspaceScope;
  draftId: number;
  revision: number;
  workTitle: string;
};
type EditingFrame = {
  key: string;
  basis: EditingBasis | null;
  target: Row | null;
  title: string;
  settings: AiTownAuthoringSettingsV1;
  dirty: boolean;
  sourceDirty: boolean;
  selection: ProductProductionSourceSelectionV1 | null;
  suggestionKey: string;
};
type LoadedEditingFrame = EditingFrame & {
  basis: EditingBasis;
  target: Row & { draft: AiTownAuthoringDraftV1 };
};
const scopeKey = (scope: WorkspaceScope) =>
  `${scope.projectId}:${scope.worldId}:${scope.workId}`;
const editingKey = (scope: WorkspaceScope, draftId: number) =>
  `${scopeKey(scope)}:${draftId}`;
function emptyFrame(key: string): EditingFrame {
  return { key, basis: null, target: null, title: "", settings: defaultAiTownSettings(),
    dirty: false, sourceDirty: false, selection: null, suggestionKey: "" };
}
async function readEditingFrame(input: WorkspaceScope): Promise<LoadedEditingFrame> {
  const scope = { ...input };
  return db.transaction("r", scopeTransactionTables(db.aiTownAuthoringDrafts), async () => {
    const draft = await readAiTownDraft(scope);
    const [project, work] = await Promise.all([
      db.projects.get(scope.projectId), db.works.get(scope.workId),
    ]);
    if (!project || !work || draft.id == null) throw new Error("小镇方案已不存在，请重新选择作品");
    return {
      key: editingKey(scope, draft.id),
      basis: { scope, draftId: draft.id, revision: draft.revision, workTitle: work.title },
      target: { project, work, draft }, title: work.title,
      settings: settingsFromAiTownDraft(draft), dirty: false, sourceDirty: false,
      selection: draft.selectionJson ? JSON.parse(draft.selectionJson) : null,
      suggestionKey: draft.suggestionKey ?? "",
    };
  });
}
function comparisonCopy(local: EditingFrame, committed: EditingFrame | null) {
  const copy = (frame: EditingFrame) => ({ basis: frame.basis, title: frame.title,
    settings: frame.settings, selection: frame.selection, suggestionKey: frame.suggestionKey });
  return { version: 1, kind: "ai-town-edit-comparison", local: copy(local),
    committed: committed ? copy(committed) : null };
}
export default function AiTownPage() {
  const catalogEntry = evaluateCurrentProductEntryV1('upper.ai-town')
  const canAuthor = catalogEntry.enterable
  const { pageId = "library" } = useParams(),
    [params] = useSearchParams(),
    navigate = useNavigate();
  const page = TOWN_PAGES.find((p) => p[0] === pageId) ?? TOWN_PAGES[0],
    primary = townPrimary(page[0]);
  const projectId = Number(params.get("project")) || null,
    workId = Number(params.get("work")) || null;
  const [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [innerMenu, setInnerMenu] = useState(false);
  const [settings, setSettings] = useState(defaultAiTownSettings),
    [title, setTitle] = useState(""),
    [dirty, setDirtyState] = useState(false),
    [search, setSearch] = useState("");
  const [worlds, setWorlds] = useState<
    Awaited<ReturnType<typeof listLocalWorldReferenceChoicesV1>>
  >([]);
  const [sources, setSources] = useState<Awaited<
      ReturnType<typeof consultProductProductionStartV1>
    > | null>(null),
    [selection, setSelection] =
      useState<ProductProductionSourceSelectionV1 | null>(null),
    [suggestionKey, setSuggestionKey] = useState("");
  const [sourceDirty,setSourceDirtyState]=useState(false);
  const [sourceReload, setSourceReload] = useState(0);
  const [basis, setBasis] = useState<EditingBasis | null>(null);
  const [editingTarget, setEditingTarget] = useState<Row | null>(null);
  const [formKey, setFormKey] = useState("new");
  const [committed, setCommitted] = useState<EditingFrame | null>(null);
  const retained = useRef(new Map<string, EditingFrame>());
  const [, refreshRetained] = useState(0);
  const copySequence = useRef(0);
  const editVersion = useRef(0), sourceVersion = useRef(0);
  const mounted = useRef(false), readGeneration = useRef(0), actionGeneration = useRef(0);
  const busyOperation = useRef<number | null>(null);
  const setDirty = (value: boolean) => {
    if (value) editVersion.current++;
    setDirtyState(value);
  };
  const setSourceDirty = (value: boolean) => {
    if (value) sourceVersion.current++;
    setSourceDirtyState(value);
  };
  const row = rows.find(
    (r) => r.project.id === projectId && (!workId || r.work.id === workId),
  );
  const rowProjectId = row?.project.id, rowWorldId = row?.work.worldId, rowWorkId = row?.work.id;
  const hasDraft = Boolean(row?.draft);
  const scope = useMemo<WorkspaceScope | null>(() =>
    rowProjectId != null && rowWorldId != null && rowWorkId != null
      ? { projectId: rowProjectId, worldId: rowWorldId, workId: rowWorkId }
      : null,
    [rowProjectId, rowWorldId, rowWorkId],
  );
  const viewKey = scope && row?.draft?.id != null
    ? editingKey(scope, row.draft.id)
    : projectId ? `unavailable:${projectId}:${workId ?? ""}` : "new";
  const viewKeyRef = useRef(viewKey);
  if (viewKeyRef.current !== viewKey) {
    viewKeyRef.current = viewKey;
    actionGeneration.current++;
  }
  const frameRef = useRef<EditingFrame>(emptyFrame("new"));
  frameRef.current = { key: formKey, basis, target: editingTarget, title, settings, dirty,
    sourceDirty, selection, suggestionKey };
  const applyFrame = useCallback((value: EditingFrame, preserveSource = false) => {
    const frame = preserveSource ? { ...value,
      sourceDirty: frameRef.current.sourceDirty, selection: frameRef.current.selection,
      suggestionKey: frameRef.current.suggestionKey } : value;
    frameRef.current = frame;
    setFormKey(frame.key); setBasis(frame.basis); setEditingTarget(frame.target);
    setTitle(frame.title); setSettings(frame.settings); setDirtyState(frame.dirty);
    setSourceDirtyState(frame.sourceDirty); setSelection(frame.selection);
    setSuggestionKey(frame.suggestionKey);
  }, []);
  const formReady = formKey === viewKey && (viewKey === "new" || basis != null);
  const hasRetainedEdits = [...retained.current.values()].some(frame => frame.dirty || frame.sourceDirty);
  const conflict = (dirty || sourceDirty) && basis && committed?.key === formKey && committed.basis
    && (committed.basis.revision > basis.revision || committed.basis.workTitle !== basis.workTitle);
  const productionId =
    Number(params.get("production")) ||
    row?.draft?.productionId ||
    row?.productionId ||
    null;
  const onProductionSelected = useCallback((id: number | null) => {
    if (id == null || id === productionId) return;
    const next = new URLSearchParams(params);
    next.set("production", String(id));
    navigate(`/town/${pageId}?${next}`, { replace: true });
  }, [navigate, params, pageId, productionId]);
  const sessionId = Number(params.get("session")) || null;
  const content = useRef<HTMLElement>(null);
  useEffect(() => {
    const readCounter = readGeneration, actionCounter = actionGeneration;
    mounted.current = true;
    return () => { mounted.current = false; readCounter.current++; actionCounter.current++; };
  }, []);
  useEffect(() => {
    content.current?.scrollTo(0, 0);
  }, [pageId]);
  useEffect(() => {
    const sub = liveQuery(async () => {
      const [projects, works, drafts, productions] = await Promise.all([
        db.projects.toArray(),
        db.works.toArray(),
        db.aiTownAuthoringDrafts.toArray(),
        db.productProductions.toArray(),
      ]);
      return works
        .flatMap((work) => {
          const project = projects.find((p) => p.id === work.projectId),
            production = productions
              .filter((p) => p.workId === work.id && p.productType === "ai-town")
              .sort((a, b) => b.updatedAt - a.updatedAt)[0];
          return project && (work.kind === "ai-town" || production)
            ? [
                {
                  project,
                  work,
                  draft: drafts.find((d) => d.workId === work.id),
                  productionId: production?.id,
                },
              ]
            : [];
        })
        .sort((a, b) => b.work.updatedAt - a.work.updatedAt);
    }).subscribe({
      next: (v) => {
        setRows(v);
        setLoading(false);
      },
      error: (e) => {
        setError(String(e));
        setLoading(false);
      },
    });
    return () => sub.unsubscribe();
  }, []);
  useEffect(() => {
    let active = true;
    const generation = ++readGeneration.current;
    if (frameRef.current.key !== viewKey) {
      const prior = frameRef.current;
      if (prior.dirty || prior.sourceDirty) retained.current.set(prior.key, structuredClone(prior));
      applyFrame(retained.current.get(viewKey) ?? emptyFrame(viewKey));
      setCommitted(null); setBusy(false); setError(""); setNotice("");
    }
    if (scope && hasDraft) {
      void readEditingFrame(scope).then(next => {
        if (!active || !mounted.current || viewKeyRef.current !== viewKey
          || readGeneration.current !== generation) return;
        const current = frameRef.current;
        if (current.key === viewKey && current.basis
          && current.basis.revision > next.basis.revision) return;
        setCommitted(next);
        if (current.key !== viewKey || current.dirty || current.sourceDirty) return;
        applyFrame(next, true);
      }).catch(cause => {
        if (active && mounted.current && viewKeyRef.current === viewKey
          && readGeneration.current === generation) setError(cause instanceof Error ? cause.message : String(cause));
      });
    }
    return () => { active = false; };
  }, [viewKey, scope, hasDraft, row?.draft?.revision, row?.draft?.id, row?.work.title, applyFrame]);
  useEffect(() => {
    let active = true;
    void listLocalWorldReferenceChoicesV1({ purpose: 'ai-town' })
      .then(value => { if (active && viewKeyRef.current === viewKey) setWorlds(value); })
      .catch(e => { if (active && viewKeyRef.current === viewKey) setError(String(e)); });
    return () => { active = false; };
  }, [pageId, viewKey]);
  useEffect(() => {
    let active = true;
    setSources(null);
    if (!frameRef.current.sourceDirty) setSelection(null);
    if (scope && row?.draft?.worldReleaseId)
      void consultProductProductionStartV1({
        scope,
        worldReleaseId: row.draft.worldReleaseId,
      })
        .then((v) => {
          if (!active || viewKeyRef.current !== viewKey) return;
          setSources(v);
          if (frameRef.current.sourceDirty) return;
          const key =
            row.draft?.suggestionKey ??
            v.suggestions.find((s) =>
              s.recommendedProductTypes.includes("ai-town"),
            )?.suggestionKey ??
            v.suggestions[0]?.suggestionKey ??
            "";
          setSuggestionKey(key);
          setSelection(
            row.draft?.selectionJson
              ? JSON.parse(row.draft.selectionJson)
              : (v.selectionDefaults[key] ?? null),
          );
        })
        .catch((e) => {
          if (active && viewKeyRef.current === viewKey) setError(String(e));
        });
    return () => {
      active = false;
    };
  }, [
    scope,
    row?.draft?.worldReleaseId,
    row?.draft?.selectionJson,
    row?.draft?.suggestionKey,
    viewKey,
    sourceReload,
  ]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty || sourceDirty || hasRetainedEdits) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty,sourceDirty,hasRetainedEdits]);
  const path = (id: string, target = row, extra = "") =>
    `/town/${id}${target ? `?project=${target.project.id}&work=${target.work.id}${target.project.id === row?.project.id && target.work.id === row?.work.id && productionId && !extra.includes("production=") ? `&production=${productionId}` : ""}${extra}` : ""}`;
  const run = async (action: () => Promise<void>) => {
    if (busyOperation.current === actionGeneration.current) return;
    const origin = viewKeyRef.current, generation = ++actionGeneration.current;
    busyOperation.current = generation;
    const ownsUi = () => mounted.current && viewKeyRef.current === origin
      && actionGeneration.current === generation;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (ownsUi()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (ownsUi()) { busyOperation.current = null; setBusy(false); }
    }
  };
  const captureEditingFrame = (targetScope?: WorkspaceScope) => {
    const frame = frameRef.current;
    if (frame.key !== viewKeyRef.current || (!frame.basis && frame.key !== "new"))
      throw new Error("作品编辑基准尚未载入，请等待当前作品读取完成");
    if (targetScope && (!frame.basis || scopeKey(frame.basis.scope) !== scopeKey(targetScope)))
      throw new Error("编辑基准不属于当前作品；本地输入仍保留，请重新核对作品");
    return structuredClone(frame);
  };
  const currentAction = () => {
    const key = viewKeyRef.current, generation = actionGeneration.current;
    return () => mounted.current && viewKeyRef.current === key && actionGeneration.current === generation;
  };
  const rememberCommitted = async (scope: WorkspaceScope, isCurrent: () => boolean) => {
    try {
      const latest = await readEditingFrame(scope);
      if (isCurrent()) setCommitted({ ...latest, key: frameRef.current.key });
    } catch { /* Keep the original save failure and the complete local buffer. */ }
  };
  const acknowledgeRevision = (next: AiTownAuthoringDraftV1, captured: EditingFrame,
    isCurrent: () => boolean, savedEdits?: number, savedSource?: number, workTitle = captured.basis?.workTitle) => {
    if (!isCurrent()) throw new Error("操作已在原作品完成；当前页面已切换，请在原作品核对结果");
    const current = frameRef.current;
    if (!captured.basis || current.key !== captured.key || next.id !== captured.basis.draftId)
      throw new Error("保存结果与本次编辑基准不一致，本地输入仍保留");
    const nextTitle = workTitle ?? captured.basis.workTitle;
    const updated = { ...current,
      basis: { ...captured.basis, revision: next.revision, workTitle: nextTitle },
      target: current.target ? { ...current.target, draft: next,
        work: { ...current.target.work, title: nextTitle } } : null,
      settings: savedEdits !== undefined && editVersion.current === savedEdits
        ? settingsFromAiTownDraft(next) : current.settings,
      title: savedEdits !== undefined && editVersion.current === savedEdits ? nextTitle : current.title,
      selection: savedSource !== undefined && sourceVersion.current === savedSource
        ? next.selectionJson ? JSON.parse(next.selectionJson) : null : current.selection,
      suggestionKey: savedSource !== undefined && sourceVersion.current === savedSource
        ? next.suggestionKey ?? "" : current.suggestionKey,
      dirty: savedEdits !== undefined && editVersion.current === savedEdits ? false : current.dirty,
      sourceDirty: savedSource !== undefined && sourceVersion.current === savedSource ? false : current.sourceDirty };
    applyFrame(updated);
    setCommitted({ ...updated, settings: settingsFromAiTownDraft(next), title: nextTitle,
      dirty: false, sourceDirty: false,
      selection: next.selectionJson ? JSON.parse(next.selectionJson) : null,
      suggestionKey: next.suggestionKey ?? "" });
    if (!updated.dirty && !updated.sourceDirty) retained.current.delete(updated.key);
  };
  const save = async () => {
    assertCurrentProductEntryV1('upper.ai-town')

    if (loading || (projectId && !row)) throw new Error("作品正在加载或已不存在，请从作品库重新选择");
    const captured = captureEditingFrame(), isCurrent = currentAction();
    const savedEdits = editVersion.current;
    if (captured.basis && captured.target) {
      const writtenTitle = captured.title || "未命名小镇";
      try {
        const next = await saveAiTownDraft(captured.basis.scope, captured.basis.revision,
          captured.settings, writtenTitle, { expectedWorkTitle: captured.basis.workTitle });
        acknowledgeRevision(next, captured, isCurrent, savedEdits, undefined, writtenTitle.trim());
        return frameRef.current.target!;
      } catch (cause) {
        await rememberCommitted(captured.basis.scope, isCurrent);
        throw cause;
      }
    }
    if (row)
      throw new Error(
        "此作品已有旧制作记录，请在制作流程中继续；新配置请从作品库新建",
      );
    const made = await createAiTownDraft(captured.title || "未命名小镇", captured.settings);
    const fresh = await readEditingFrame(made.scope);
    if (!isCurrent()) throw new Error("新作品已保存；当前页面已切换，请从作品库打开原作品");
    const target = { project: made.project, work: made.work, draft: fresh.target.draft };
    const initialBasis = { scope: { ...made.scope }, draftId: fresh.basis.draftId,
      revision: 0, workTitle: made.work.title };
    const changed = fresh.basis.revision !== 0 || fresh.title !== made.work.title;
    applyFrame({ ...frameRef.current, basis: initialBasis, target,
      dirty: changed || editVersion.current !== savedEdits });
    setCommitted({ ...fresh, key: captured.key });
    if (changed) throw new Error("新作品已在其他页面修改；本地输入仍保留，请先下载比较再决定");
    return target;
  };
  const saveSource = async () => {
    if (!frameRef.current.sourceDirty) return;
    assertCurrentProductEntryV1('upper.ai-town')
    const captured = captureEditingFrame(scope ?? undefined), isCurrent = currentAction();
    if (!captured.basis || !captured.selection) throw new Error("请先选择世界版本");
    const savedSource = sourceVersion.current;
    const next = await saveAiTownSourceSelection(captured.basis.scope, captured.basis.revision,
      captured.suggestionKey, captured.selection);
    acknowledgeRevision(next, captured, isCurrent, undefined, savedSource);
  };
  const downloadComparison = (input = frameRef.current) => void run(async () => {
    const local = structuredClone(input), isCurrent = currentAction();
    let latest: EditingFrame | null = null, unavailable = "";
    if (local.basis) {
      try { latest = await readEditingFrame(local.basis.scope); }
      catch (cause) { unavailable = cause instanceof Error ? cause.message : String(cause); }
    }
    if (!isCurrent()) return;
    await saveFile(new Blob([JSON.stringify({ ...comparisonCopy(local, latest),
      committedReadError: unavailable || null }, null, 2)], { type: "application/json;charset=utf-8" }),
      `${local.title || "AI小镇"}-未保存方案比较.json`);
  });
  const loadCommitted = () => void run(async () => {
    const local = captureEditingFrame(), isCurrent = currentAction();
    if (!local.basis) throw new Error("此方案尚无已提交版本，本地输入仍保留");
    const latest = await readEditingFrame(local.basis.scope);
    if (!isCurrent()) return;
    retained.current.delete(local.key);
    retained.current.set(`copy:${++copySequence.current}`, local);
    const loaded = { ...latest, key: local.key };
    applyFrame(loaded); setCommitted(loaded);
    setSourceReload(value => value + 1);
    setNotice("已载入已提交版本；原本地输入仍保留为内存副本，可下载后自行对照修改。尚未写入任何新方案。");
  });
  const leave = (url: string) => void run(async () => {
    const isCurrent = currentAction();
    await flushPendingEditsV1();
    if (!isCurrent()) return;
    await saveSource();
    if (!isCurrent()) return;
    if (frameRef.current.dirty) await save();
    if (!isCurrent()) return;
    if ([...retained.current.values()].some(frame => frame.dirty || frame.sourceDirty))
      throw new Error("仍有保留的未保存输入。请先下载比较并明确移除内存副本，或返回原作品处理，再离开 AI 小镇。");
    navigate(url);
  });
  const go = (id: string, selectedTarget?: Row) =>
    void run(async () => {
      const isCurrent = currentAction();
      await flushPendingEditsV1();
      if (!isCurrent()) return;
      await saveSource();
      if (!isCurrent()) return;
      const target = frameRef.current.dirty ? await save() : row;
      if (!isCurrent()) return;
      setMenu(false);
      setInnerMenu(false);
      navigate(
        path(
          id,
          selectedTarget ?? target,
          sessionId && TOWN_PLAY_PAGES.some((p) => p[0] === id)
            ? `&session=${sessionId}`
            : "",
        ),
      );
    });
  const step = TOWN_SETUP_PAGES.findIndex((p) => p[0] === page[0]);
  const needsSource = (
    <section className="lf-paper">
      <h3>开始制作，需要一个世界引擎</h3>
      <p>可以继续填写和保存配置。正式制作前，请选择一个已封存的世界版本。</p>
      <button
        className="lf-action lf-action-primary"
        onClick={() => go("source")}
      >
        选择世界引擎
      </button>
    </section>
  );
  const compile = () =>
    void run(async () => {
      const isCurrent = currentAction();
      await saveSource();
      if (!isCurrent()) return;
      const target = frameRef.current.dirty || !row ? await save() : row;
      const targetScope = {
        projectId: target.project.id!,
        worldId: target.work.worldId,
        workId: target.work.id!,
      };
      const captured = captureEditingFrame(targetScope);
      const latest = await readEditingFrame(targetScope);
      if (!isCurrent()) return;
      if (!captured.basis || latest.basis.revision !== captured.basis.revision
        || latest.basis.workTitle !== captured.basis.workTitle)
        throw new Error("方案已在其他页面修改，本地输入仍保留，请先比较再生成审查方案");
      if (!latest.target.draft.worldReleaseId) {
        navigate(path("confirm", target));
        throw new Error("需要一个世界引擎；配置已保存，请到世界引擎页选择版本");
      }
      const prepared = await prepareAiTownBrief(targetScope, captured.basis.revision, { includeSavedDraft: true });
      if (!isCurrent()) return;
      acknowledgeRevision(prepared.draft, captured, isCurrent);
      navigate(path("production", target, `&production=${prepared.productionId}`));
      setNotice("审查方案已保存，核对后明确授权才会开始制作。");
    });
  let handoffId: number | null = null,
    handoffError = "";
  try {
    const raw = params.get("worldHandoff");
    if (raw) {
      const handoff = parseProductProductionHandoffV1(JSON.parse(raw));
      if (handoff.productType !== "ai-town") throw new Error("交接产品不匹配");
      handoffId = handoff.worldReleaseId;
      if (
        worlds.some(
          (w) => w.id === handoffId && w.hash !== handoff.worldContentHash,
        )
      )
        throw new Error("交接版本不一致");
    }
  } catch (e) {
    handoffError = String(e);
  }
  return (
    <div
      className={`longform-app avg-app town-author-app ${menu ? "lf-navigation-open" : ""} ${innerMenu ? "lf-step-menu-open" : ""}`}
      data-testid="town-author-page"
    >
      <header className="lf-top">
        <Link className="lf-brand" to="/" onClick={(event) => { event.preventDefault(); leave("/"); }}>
          <BrandIcon/>
          <span>
            <strong>StoryForge</strong>
            <small>故事熔炉</small>
          </span>
        </Link>
        <nav aria-label="产品导航">
          {PRODUCT_NAVIGATION.map((p) => (
            <Link
              key={p.id}
              to={p.path}
              onClick={(event) => { event.preventDefault(); leave(p.path); }}
              aria-current={p.id === "town" ? "page" : undefined}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </header>
      <aside className="lf-sidebar">
        <small>AFTERSTORY TOWN</small>
        <h1>AI 小镇</h1>
        <p>让故事之后的生活，慢慢生长。</p>
        <button className="lf-current" onClick={() => go("library")}>
          <BookOpen />
          {row?.work.title ?? "选择或新建小镇"}
        </button>
        <nav aria-label="AI 小镇页面导航">
          {TOWN_PRIMARY.map(([id, label, entry]) => (
            <button
              key={id}
              aria-current={primary === id ? "page" : undefined}
              onClick={() => go(entry)}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => leave("/home/settings")}
          >
            通用设置
          </button>
        </nav>
      </aside>
      <section className="lf-main">
        <header className="lf-heading">
          <small>
            AI 小镇 › {TOWN_PRIMARY.find((p) => p[0] === primary)?.[1]} ›{" "}
            {page[1]}
            {row ? ` · ${row.work.title}` : ""}
          </small>
          <h2>{TOWN_PRIMARY.find((p) => p[0] === primary)?.[1]}</h2>
            {!["library", "player", "community"].includes(primary) && (
              <nav className="avg-phases" aria-label="制作阶段">
                {[
                  ["source", "S1 · 世界封存"],
                  ["vision", "S2 · 产品定向"],
                  ["production", "S3 · 产品执行"],
                ].map(([id, label]) => (
                  <button key={id} onClick={() => go(id)}>
                    {label}
                  </button>
                ))}
              </nav>
            )}
          <div className="lf-mobile-controls">
            <button
              onClick={() => {
                setMenu(!menu);
                setInnerMenu(false);
              }}
            >
              AI 小镇目录
            </button>
            {["workbench", "player"].includes(primary) && (
              <button
                onClick={() => {
                  setInnerMenu(!innerMenu);
                  setMenu(false);
                }}
              >
                内容目录
              </button>
            )}
          </div>
        </header>
        <div
          className={`lf-body ${["workbench", "player"].includes(primary) ? "lf-with-steps" : ""}`}
        >
          {["workbench", "player"].includes(primary) && (
            <aside className="lf-steps avg-content-sidebar">
              <nav aria-label="AI 小镇内容导航">
                {(primary === "workbench"
                  ? [
                      {
                        label: "S2 · 方案与配置",
                        pages: [...TOWN_SETUP_PAGES.slice(0, -1), ["agent", "方案会谈"], TOWN_SETUP_PAGES[4]],
                      },
                      { label: "S3 · 制作与检查", pages: TOWN_BUILD_PAGES },
                    ]
                  : [{ label: "游玩与团局", pages: TOWN_PLAY_PAGES }]
                ).map((g) => (
                  <section key={g.label}>
                    <h3>{g.label}</h3>
                    {g.pages.map(([id, label]) => (
                      <button
                        key={id}
                        aria-current={page[0] === id ? "page" : undefined}
                        onClick={() => go(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </section>
                ))}
              </nav>
            </aside>
          )}
          <main className="lf-content" ref={content}>
      {!canAuthor && <p role="status" className="lf-paper">当前产品尚未开放创作；已保存作品、原始内容和发行版本仍可查看。</p>}

            {error && (
              <p className="avg-alert" role="alert">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            {conflict && (
              <section className="lf-paper" data-testid="town-edit-conflict">
                <h3>本地输入与已提交方案不同</h3>
                <p>本地输入仍完整保留。保存只使用载入时的版本，不会自动覆盖其他页面的修改。</p>
                <details><summary>比较本地与已提交的完整方案</summary>
                  <h4>本地未保存方案</h4>
                  <pre>{JSON.stringify(comparisonCopy(frameRef.current, committed).local, null, 2)}</pre>
                  <h4>已提交方案</h4>
                  <pre>{JSON.stringify(comparisonCopy(frameRef.current, committed).committed, null, 2)}</pre>
                </details>
                <button className="lf-action" disabled={busy} onClick={() => downloadComparison()}>
                  下载本地与已提交方案比较
                </button>
                <button className="lf-action" disabled={busy} onClick={loadCommitted}>
                  保留本地副本，载入已提交版本
                </button>
              </section>
            )}
            {retained.current.size > 0 && (
              <details className="lf-paper" data-testid="town-retained-edits">
                <summary>保留的未保存输入（{retained.current.size}）</summary>
                {[...retained.current.entries()].map(([key, frame]) => <article key={key}>
                  <h4>{frame.title || frame.basis?.workTitle || "未命名小镇"}</h4>
                  <p>仅保存在当前页面内存中；请下载后再关闭页面。没有写入其他作品。</p>
                  <button className="lf-action" disabled={busy} onClick={() => downloadComparison(frame)}>下载此本地副本与已提交方案</button>
                  <button className="lf-action" disabled={busy} onClick={() => go("vision", frame.target ?? undefined)}>打开此作品</button>
                  <button className="lf-action" disabled={busy} onClick={() => {
                    retained.current.delete(key); refreshRetained(value => value + 1);
                  }}>仅移除此内存副本</button>
                </article>)}
              </details>
            )}
            {loading ? (
              <p>读取AI 小镇作品…</p>
            ) : (
              <Suspense fallback={<p>打开功能…</p>}>
                {page[0] === "library" ? (
                  <>
                    <section className="lf-paper">
                      <div className="avg-actions">
                        <button disabled={!canAuthor}
                          className="lf-action lf-action-primary"
                          onClick={() => {
                            const prior = frameRef.current;
                            if (prior.dirty || prior.sourceDirty) retained.current.set(
                              prior.key === "new" ? `copy:${++copySequence.current}` : prior.key,
                              structuredClone(prior),
                            );
                            actionGeneration.current++; busyOperation.current = null;
                            applyFrame(emptyFrame("new")); setCommitted(null);
                            setBusy(false); setError(""); setNotice("");
                            navigate("/town/vision");
                          }}
                        >
                          新建小镇
                        </button>
                        <input
                          aria-label="搜索小镇"
                          placeholder="搜索小镇名称"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                      <p>先规划，再制作。作品版本与每一场生活分别保存。</p>
                    </section>
                    <div className="lf-library-grid">
                      {rows
                        .filter((r) => r.work.title.includes(search))
                        .map((r) => (
                          <article className="lf-paper" key={r.work.id}>
                            <small>
                              {r.draft ? "制作方案" : "已有AI 小镇作品"}
                            </small>
                            <h3>{r.work.title}</h3>
                            <p>
                              {r.draft?.worldReleaseId
                                ? "已引用世界版本"
                                : "可先规划小镇"}
                            </p>
                            <div className="avg-actions">
                              <Link
                                className="lf-action"
                                to={path(r.draft ? "vision" : "production", r)}
                              >
                                继续制作
                              </Link>
                              <Link className="lf-action" to={path("play", r)}>
                                游玩与存档
                              </Link>
                            </div>
                          </article>
                        ))}
                    </div>
                    {!rows.length && (
                      <section className="lf-paper">
                        <h3>你的第一场生活</h3>
                        <p>
                          还没有自己的小镇，可以先进入制作台填写，或者游玩社区作品。
                        </p>
                      </section>
                    )}
                    <Community productType="ai-town" onImported={release => navigate(`/town/play?project=${release.projectId}&work=${release.workId}`)} />
                  </>
                ) : step >= 0 ? (
                  <>
                    <section className="lf-paper">
                      <h3>{page[1]}</h3>
                      <p>
                        保存配置不会调用模型或开始制作。未选择世界时也可以填写。
                      </p>
                      <fieldset
                        disabled={(busy || !formReady || Boolean(row && !row.draft)) || !canAuthor}
                        className="avg-form"
                      >
                        <label>
                          小镇名称
                          <input disabled={!canAuthor}
                            aria-label="小镇名称"
                            value={title}
                            maxLength={200}
                            onChange={(e) => {
                              setTitle(e.target.value);
                              setDirty(true);
                            }}
                          />
                        </label>
                        <AuthorSettings settings={settings} page={page[0]} onChange={s=>{setSettings(s);setDirty(true)}}/>
                        <div className="avg-actions">
                          <button disabled={!canAuthor}
                            className="lf-action lf-action-primary"
                            onClick={() =>
                              void run(async () => {
                                const isCurrent = currentAction();
                                const target = await save();
                                if (!isCurrent()) return;
                                navigate(path(page[0], target), {
                                  replace: true,
                                });
                                setNotice("制作配置已保存");
                              })
                            }
                          >
                            保存制作方案
                          </button>
                          {step === 4 ? (
                            <button disabled={!canAuthor} className="lf-action" onClick={compile}>
                              生成或更新审查方案
                            </button>
                          ) : null}
                        </div>
                      </fieldset>
                      {row && !row.draft && (
                        <button
                          className="lf-action"
                          onClick={() => go("production")}
                        >
                          继续已有制作记录
                        </button>
                      )}
                    </section>
                    {step === 4 && row?.draft && !row.draft.worldReleaseId
                      ? needsSource
                      : null}
                    {step === 4 && productionId && (
                      <section className="lf-paper">
                        <p>
                          已有审查方案。修改配置后请先更新方案；正式开始在制作流程中单独授权。
                        </p>
                        <button
                          className="lf-action"
                          onClick={() => go("agent")}
                        >
                          讨论制作方案
                        </button>
                        <button
                          className="lf-action"
                          onClick={() => go("production")}
                        >
                          打开制作流程
                        </button>
                      </section>
                    )}
                  </>
                ) : page[0] === "source" ? (
                  <>
                    <section className="lf-paper">
                      <h3>世界版本与本小镇的数据出口</h3>
                      <p>调整读取范围，不修改原世界；没有世界也可继续配置。</p>
                      <Link className="lf-action" to="/world/worlds">
                        创建或封存世界
                      </Link>
                      {handoffError && <p role="alert">{handoffError}</p>}
                      {worlds.map((w) => (
                        <article className="avg-source" key={w.choiceKey ?? w.id}>
                          <div>
                            <h4>
                              {w.label}
                              {handoffId === w.id ? " · 世界引擎带入" : ""}
                            </h4>
                            <p>
                              {w.worldCode} · v{w.version}
                            </p>{w.authorName && <p className="text-xs">{w.authorName} · {w.license}</p>}{w.attribution && <p className="text-xs">{w.attribution}</p>}{w.contentWarnings?.map((warning, index) => <p key={index} className="text-xs">{warning}</p>)}{w.purposeAllowed === false && <p className="text-xs">此来源未允许本产品使用</p>}
                          </div>
                          <button
                            className="lf-action"
                            disabled={w.purposeAllowed === false ||
                              (busy ||
                              Boolean(row && !row.draft) ||
                              Boolean(handoffError)) || !canAuthor
                            }
                            onClick={() =>
                              void run(async () => {
                                const isCurrent = currentAction();
                                const target =
                                  dirty || !row ? await save() : row;
                                if (!isCurrent()) return;
                                const sc = {
                                  projectId: target.project.id!,
                                  workId: target.work.id!,
                                  worldId: target.work.worldId,
                                };
                                const captured = captureEditingFrame(sc);
                                if (!captured.basis) throw new Error("请先保存当前方案");
                                const savedSource = sourceVersion.current;
                                const next = await selectAiTownWorld(sc, captured.basis.revision, w.id, w.sourceDeclarationHash);
                                acknowledgeRevision(next, captured, isCurrent, undefined, savedSource);
                                navigate(path("source", target));
                                setNotice("世界版本已选择");
                              })
                            }
                          >
                            选择此版本
                          </button>
                        </article>
                      ))}
                      {!worlds.length && (
                        <p>尚无已封存世界。可以先填写小镇方案。</p>
                      )}
                    </section>
                    {scope && row?.draft?.worldReleaseId && (
                      <>
                        <Outlet
                          projectId={scope.projectId}
                          worldId={scope.worldId}
                          initialReleaseId={row.draft.worldReleaseId}
                          onVersions={() => navigate("/world/worlds")}
                        />
                        {sources && selection && (
                          <section className="lf-paper">
                            <h3>选择本小镇读取的资源</h3>
                            <label>
                              建议起点
                              <select disabled={!canAuthor}
                                value={suggestionKey}
                                onChange={(e) => {
                                  setSuggestionKey(e.target.value);setSourceDirty(true);
                                  setSelection(
                                    sources.selectionDefaults[e.target.value],
                                  );
                                }}
                              >
                                {sources.suggestions.map((s) => (
                                  <option
                                    key={s.suggestionKey}
                                    value={s.suggestionKey}
                                  >
                                    {s.title}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {(
                              [
                                ["storyResourceKeys", "storySources", "故事"],
                                ["characterResourceKeys", "characters", "人物"],
                                [
                                  "importantLocationResourceKeys",
                                  "importantLocations",
                                  "地点",
                                ],
                                ["artifactResourceKeys", "artifacts", "物品"],
                                [
                                  "codexEntryResourceKeys",
                                  "codexEntries",
                                  "设定",
                                ],
                                ["storyArcResourceKeys", "storyArcs", "故事线"],
                              ] as const
                            ).map(([key, field, label]) => (
                              <fieldset disabled={!canAuthor} key={key}>
                                <legend>{label}</legend>
                                {sources.sourceOptions[field].map((o) => (
                                  <label
                                    className="town-check"
                                    key={o.resourceKey}
                                  >
                                    <input disabled={!canAuthor}
                                      type="checkbox"
                                      checked={selection[key].includes(
                                        o.resourceKey,
                                      )}
                                      onChange={(e) => {setSourceDirty(true);
                                        setSelection({
                                          ...selection,
                                          [key]: e.target.checked
                                            ? [...selection[key], o.resourceKey]
                                            : selection[key].filter(
                                                (v) => v !== o.resourceKey,
                                              ),
                                        });}
                                      }
                                    />
                                    {o.label}
                                  </label>
                                ))}
                              </fieldset>
                            ))}
                            <button disabled={!canAuthor}
                              className="lf-action"
                              onClick={() =>
                                void run(async () => {
                                  const isCurrent = currentAction();
                                  await saveSource();
                                  if (isCurrent()) setNotice("出口范围已保存");
                                })
                              }
                            >
                              保存出口范围
                            </button>
                          </section>
                        )}
                      </>
                    )}
                  </>
                ) : page[0] === "agent" ? (
                  <><button className="lf-action" disabled={(busy || !formReady) || !canAuthor} onClick={()=>void run(async()=>{
                    const isCurrent = currentAction(), target = await save();
                    if (!isCurrent()) return;
                    navigate(path('agent',target));setNotice('制作方案已保存');
                  })}>保存制作方案</button>
                  <Proposal key={row?.work.id ?? 'new'} scope={scope} draft={row?.draft} settings={settings} onSource={()=>go('source')} onConfirm={value=>void run(async()=>{
                    const captured = captureEditingFrame(scope ?? undefined), isCurrent = currentAction();
                    if (!captured.basis) throw new Error('请先保存方案');
                    const savedEdits = editVersion.current, writtenTitle = captured.title || captured.basis.workTitle;
                    try {
                      const next = await saveAiTownDraft(captured.basis.scope, captured.basis.revision,
                        structuredClone(value), writtenTitle, { expectedWorkTitle: captured.basis.workTitle });
                      acknowledgeRevision(next, captured, isCurrent, savedEdits, undefined, writtenTitle.trim());
                      setNotice('候选已回填，可在各配置页继续编辑');
                    } catch (cause) {
                      await rememberCommitted(captured.basis.scope, isCurrent);
                      throw cause;
                    }
                  })}/></>
                ) : ["production", "review", "release"].includes(page[0]) ? (
                  <>
                    {scope && productionId ? (
                      <>
                        <section className="lf-paper">
                          <h3>{page[1]}</h3>
                          {row?.draft &&
                            row.draft.preparedRevision !==
                              row.draft.revision && (
                              <p>
                                配置已调整；下方仍是之前保存的制作方案。请到确认页生成新方案后再开始。
                              </p>
                            )}
                          <button
                            className="lf-action"
                            onClick={() => go("confirm")}
                          >
                            回到方案确认
                          </button>
                          {!row?.project.productPlatformOptIns
                            ?.productProductionV3 && (
                            <button disabled={!canAuthor}
                              className="lf-action"
                              onClick={() =>
                                void run(async () => {
                                  const isCurrent = currentAction(), project = row!.project;
                                  await updateWorkspace(project.id!, {
                                    productPlatformOptIns: {
                                      ...project.productPlatformOptIns,
                                      productProductionV3: true,
                                    },
                                  });
                                  if (isCurrent()) setNotice("已启用自动制作，仍需单独授权开始");
                                })
                              }
                            >
                              启用本作品的自动制作
                            </button>
                          )}
                        </section>
                        <div className="avg-production">
                          <Studio
                            scope={scope}
                            allowedProducts={PRODUCTS}
                            initialProduct="ai-town"
                            initialProductionId={productionId}
                            onProductionSelected={onProductionSelected}
                            managedCreation
                            view={
                              page[0] as "production" | "review" | "release"
                            }
                            authorOptIn={
                              row?.project.productPlatformOptIns
                                ?.productProductionV3 === true && (!row?.draft || row.draft.preparedRevision === row.draft.revision)
                            }
                            onPreviewStarted={(_, id) =>
                              navigate(path("play", row, `&session=${id}`))
                            }
                            onPublished={() => go("play")}
                          />
                        </div>
                      </>
                    ) : row?.draft && !row.draft.worldReleaseId ? (
                      needsSource
                    ) : (
                      <section className="lf-paper">
                        <h3>{page[1]}</h3>
                        <p>这里将显示实际制作步骤、质量检查与发布版本。</p>
                        <button
                          className="lf-action"
                          onClick={() => go("confirm")}
                        >
                          确认制作方案
                        </button>
                      </section>
                    )}
                    {page[0] === "release" && scope && (
                      <section className="lf-paper">
                        <h3>作品完整备份</h3>
                        <button
                          className="lf-action"
                          onClick={() =>
                            void run(async () =>
                              await downloadJSON(
                                await exportProjectJSON(scope.projectId),
                                `${row?.work.title ?? "AI 小镇"}.json`,
                              ),
                            )
                          }
                        >
                          导出AI 小镇备份
                        </button>
                      </section>
                    )}
                  </>
                ) : primary === "player" ? (
                  <Player
                    scope={scope}
                    project={row?.project}
                    sessionId={sessionId}
                    page={page[0]}
                    onSession={(id) =>
                      navigate(path(page[0], row, `&session=${id}`))
                    }
                  />
                ) : page[0] === "community" ? (
                  <>
                    <section className="lf-paper">
                      <h3>AI 小镇作品与本地生活</h3>
                      <p>
                        可安装已发布作品开始游玩。自己的小镇可在“发布与版本”导出游戏包；公共联机与发行服务是否可用，取决于部署配置。
                      </p>
                      <button
                        className="lf-action"
                        onClick={() => go("release")}
                      >
                        我的发布与版本
                      </button>
                    </section>
                    <Community productType="ai-town" onImported={release => navigate(`/town/play?project=${release.projectId}&work=${release.workId}`)} />
                  </>
                ) : (
                  <Inspector
                    scope={scope}
                    productionId={productionId}
                    page={page[0]}
                    onProduction={() => go("production")}
                  />
                )}
              </Suspense>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}
