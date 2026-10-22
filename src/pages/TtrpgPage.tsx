import BrandIcon from '../components/shared/BrandIcon'
import { useDialog } from '../components/shared/Dialog';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  defaultTtrpgSettings,
  settingsFromTtrpgDraft,
  type TtrpgAuthoringDraftV1,
} from "../lib/ttrpg/authoring-contract";
import { defaultTtrpgSettingsV2 } from '../lib/ttrpg/authoring-contract-v2';
import { ttrpgOpenDesignNeedsInitialFactsV1 } from '../lib/ttrpg/open-authoring-design-contract';
import {
  createTtrpgDraft,
  saveTtrpgDraft,
  selectTtrpgWorld,
  readTtrpgDraft,
  prepareTtrpgBrief,
  saveTtrpgSourceSelection,
} from "../lib/ttrpg/authoring-service";
import { consultProductProductionStartV1 } from "../lib/product-production/service";
import { listLocalWorldReferenceChoicesV1 } from "../lib/world-engine/reference-cache";
import { updateWorkspace } from "../lib/workspace/works";
import { exportProjectJSON, downloadJSON } from "../lib/export/json-export";
import { downloadTextFile } from '../lib/export/text-export';
import { canonicalProductProductionJsonV2 } from '../lib/product-production/hash';
import { PRODUCT_NAVIGATION } from "../components/navigation/product-navigation";
import {
  TTRPG_PAGES,
  TTRPG_PRIMARY,
  TTRPG_SETUP_PAGES,
  TTRPG_BUILD_PAGES,
  TTRPG_PLAY_PAGES,
  ttrpgPrimary,
} from "../components/ttrpg/author-navigation";
import Wizard from "../components/ttrpg/TtrpgProductionWizard";
import { parseProductProductionHandoffV1 } from "../lib/product-production/handoff";
import "../components/longform/longform.css";
import "../components/avg/avg.css";
import "../components/ttrpg/author.css";
const Studio = lazy(
  () => import("../components/product/ProductProductionStudio"),
);
const Session = lazy(() => import("./TtrpgSessionPage").then(module => ({ default: module.TtrpgSessionView })));
const Player = lazy(() => import("../components/ttrpg/AuthorPlayer"));
const Community = lazy(() => import("./TtrpgCommunityPage"));
const Proposal = lazy(() => import("../components/ttrpg/AuthorProposal"));
const OpenAuthoringEditor = lazy(() => import('../components/ttrpg/TtrpgOpenAuthoringEditor'));
const OpenDesignAssistant = lazy(() => import('../components/ttrpg/TtrpgOpenDesignAssistant'));
const OpenSeatApprovalEditor = lazy(() => import('../components/ttrpg/TtrpgOpenSeatApprovalEditor'));
const Inspector = lazy(() => import("../components/ttrpg/AuthorInspector"));
const Outlet = lazy(
  () => import("../components/world-engine/WorldResourceBrowser"),
);
import { flushPendingEditsV1 } from "../lib/authoring/pending-edit-coordinator";
import { acknowledgeSeatApprovalSave, clearSeatApprovalDraft, markSeatApprovalApplied, readSeatApprovalDraft,
  reviewSeatApprovalDraft, setSeatApprovalHost, subscribeSeatApprovalDraft, type SeatApprovalDraft } from '../components/ttrpg/open-seat-approval-draft';
const PRODUCTS = ["ttrpg"] as const;
type Row = {
  project: Project;
  work: Work;
  draft?: TtrpgAuthoringDraftV1;
  productionId?: number;
};
const sameScope = (a: WorkspaceScope | null, b: WorkspaceScope | null) => Boolean(a && b &&
  a.projectId === b.projectId && a.worldId === b.worldId && a.workId === b.workId);
export default function TtrpgPage() {
  const dialog = useDialog();
  const { pageId = "library" } = useParams(),
    [params] = useSearchParams(),
    navigate = useNavigate();
  const page = TTRPG_PAGES.find((p) => p[0] === pageId) ?? TTRPG_PAGES[0],
    primary = ttrpgPrimary(page[0]);
  const projectId = Number(params.get("project")) || null,
    workId = Number(params.get("work")) || null;
  const openPreview = import.meta.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW === '1';
  const newOpen = openPreview && !projectId && !workId && params.get('format') === 'open';
  const [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [innerMenu, setInnerMenu] = useState(false);
  const [settings, setSettings] = useState(() => newOpen ? defaultTtrpgSettingsV2('open') : defaultTtrpgSettings()),
    [title, setTitle] = useState(""),
    [dirty, setDirty] = useState(false),
    [search, setSearch] = useState("");
  // This is the version actually loaded into the form. A liveQuery update must
  // never lend its newer revision to older, unsaved settings.
  const [editBasis, setEditBasis] = useState<{ scope: WorkspaceScope; revision: number } | null>(null);
  // The domain save finishes before BrowserRouter's transition necessarily
  // reaches this component. Bridge only that known creation's navigation;
  // this is neither a selected scope nor permission to save/generate again.
  const createdRouteHandoff = useRef<Pick<Row, 'project' | 'work'> | null>(null);
  const readCreatedRouteHandoff = () => {
    const saved = createdRouteHandoff.current;
    if (!saved) return null;
    const address = new URL(window.location.href);
    return address.pathname.includes('/ttrpg/') &&
      Number(address.searchParams.get('project')) === saved.project.id &&
      Number(address.searchParams.get('work')) === saved.work.id ? saved : null;
  };
  const activeMutation = useRef(false);
  const seatApprovalDraft = useSyncExternalStore(subscribeSeatApprovalDraft, readSeatApprovalDraft);
  const [worlds, setWorlds] = useState<
    Awaited<ReturnType<typeof listLocalWorldReferenceChoicesV1>>
  >([]);
  const [sources, setSources] = useState<Awaited<
      ReturnType<typeof consultProductProductionStartV1>
    > | null>(null),
    [selection, setSelection] =
      useState<ProductProductionSourceSelectionV1 | null>(null),
    [suggestionKey, setSuggestionKey] = useState("");
  const row = rows.find(
    (r) => r.project.id === projectId && (!workId || r.work.id === workId),
  );
  const rowProjectId = row?.project.id, rowWorldId = row?.work.worldId, rowWorkId = row?.work.id;
  const scope = useMemo<WorkspaceScope | null>(() =>
    rowProjectId != null && rowWorldId != null && rowWorkId != null
      ? { projectId: rowProjectId, worldId: rowWorldId, workId: rowWorkId }
      : null,
    [rowProjectId, rowWorldId, rowWorkId],
  );
  const currentScope = useRef(scope); currentScope.current = scope;
  const currentDirty = useRef(dirty); currentDirty.current = dirty;
  const designPreparing = useRef(false);
  const draftConflict = Boolean(dirty && editBasis && (!sameScope(scope, editBasis.scope) ||
    !row?.draft || row.draft.revision !== editBasis.revision));
  useEffect(() => {
    if (scope && editBasis && sameScope(scope, editBasis.scope) && row?.draft?.revision === editBasis.revision && settings.runFormat === 'open')
      return setSeatApprovalHost(scope, editBasis.revision, settings);
  }, [scope, editBasis, row?.draft?.revision, settings]);
  useEffect(() => {
    if (!scope || !row?.draft) return;
    const savedSettings = settingsFromTtrpgDraft(row.draft);
    if (savedSettings.runFormat === 'open') acknowledgeSeatApprovalSave(scope, row.draft.revision, savedSettings);
  }, [scope, row?.draft, seatApprovalDraft]);
  const productionId =
    Number(params.get("production")) ||
    row?.draft?.productionId ||
    row?.productionId ||
    null;
  const onProductionSelected = useCallback((id: number | null) => {
    if (id == null || id === productionId) return;
    const next = new URLSearchParams(params);
    next.set("production", String(id));
    navigate(`/ttrpg/${pageId}?${next}`, { replace: true });
  }, [navigate, params, pageId, productionId]);
  const sessionId = Number(params.get("session")) || null;
  const content = useRef<HTMLElement>(null);
  useEffect(() => {
    content.current?.scrollTo(0, 0);
  }, [pageId]);
  useEffect(() => {
    const sub = liveQuery(async () => {
      const [projects, works, drafts, productions, releases] = await Promise.all([
        db.projects.toArray(),
        db.works.toArray(),
        db.ttrpgAuthoringDrafts.toArray(),
        db.productProductions.toArray(),
        db.productReleases.where("productType").equals("ttrpg").toArray(),
      ]);
      return works
        .flatMap((work) => {
          const project = projects.find((p) => p.id === work.projectId),
            production = productions
              .filter((p) => p.workId === work.id && p.productType === "ttrpg")
              .sort((a, b) => b.updatedAt - a.updatedAt)[0];
          return project && (work.kind === "ttrpg" || production || releases.some(release => release.workId === work.id && release.projectId === work.projectId))
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
    if (!dirty) {
      if (!row && readCreatedRouteHandoff()) return;
      setSettings(
        row?.draft ? settingsFromTtrpgDraft(row.draft) : newOpen ? defaultTtrpgSettingsV2('open') : defaultTtrpgSettings(),
      );
      setTitle(row?.work.title ?? "");
      setEditBasis(scope && row?.draft ? { scope, revision: row.draft.revision } : null);
      if (row && createdRouteHandoff.current?.work.id === row.work.id) createdRouteHandoff.current = null;
    }
  }, [row?.work.id, row?.work.title, row?.draft?.revision, dirty, newOpen, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void listLocalWorldReferenceChoicesV1()
      .then(setWorlds)
      .catch((e) => setError(String(e)));
  }, [pageId]);
  useEffect(() => {
    let active = true;
    setSources(null);
    setSelection(null);
    if (scope && row?.draft?.worldReleaseId)
      void consultProductProductionStartV1({
        scope,
        worldReleaseId: row.draft.worldReleaseId,
      })
        .then((v) => {
          if (!active) return;
          setSources(v);
          const key =
            row.draft?.suggestionKey ??
            v.suggestions.find((s) =>
              s.recommendedProductTypes.includes("ttrpg"),
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
          if (active) setError(String(e));
        });
    return () => {
      active = false;
    };
  }, [
    scope,
    row?.draft?.worldReleaseId,
    row?.draft?.selectionJson,
    row?.draft?.suggestionKey,
  ]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const path = (id: string, target = row, extra = "") => {
    const production = productionId && !extra.includes('production=') ? `&production=${productionId}` : '';
    if (target) return `/ttrpg/${id}?project=${target.project.id}&work=${target.work.id}${target === row ? production : ''}${extra}`;
    const created = readCreatedRouteHandoff();
    if (created) {
      const actualProduction = Number(new URL(window.location.href).searchParams.get('production')) || null;
      return `/ttrpg/${id}?project=${created.project.id}&work=${created.work.id}${actualProduction && !extra.includes('production=') ? `&production=${actualProduction}` : ''}${extra}`;
    }
    // Requested locators survive a late list projection. They grant no record
    // access; the original loaded scope and domain guards still decide that.
    if (projectId) return `/ttrpg/${id}?project=${projectId}${workId ? `&work=${workId}` : ''}${production}${extra}`;
    return `/ttrpg/${id}${newOpen ? '?format=open' : ''}`;
  };
  const run = async (action: () => Promise<void>) => {
    if (busy || activeMutation.current) return;
    activeMutation.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      activeMutation.current = false;
      setBusy(false);
    }
  };
  const save = async (flush = true) => {
    if (flush) await flushPendingEditsV1();
    if (!row && readCreatedRouteHandoff()) throw new Error('刚保存的作品正在载入，请稍后继续；已保留原作品');
    if (loading || (projectId && !row)) throw new Error("作品正在加载或已不存在，请从作品库重新选择");
    if (editBasis && (!sameScope(scope, editBasis.scope) || !row?.draft))
      throw new Error('正在编辑的方案与当前作品不一致，本窗口修改已保留，请先下载修改副本再载入最新方案');
    if (row && scope && row.draft) {
      if (!editBasis) throw new Error('方案尚未载入完成，请稍后再保存');
      const nextTitle = title || '未命名战役';
      const saved = await saveTtrpgDraft(
        scope,
        editBasis.revision,
        settings,
        nextTitle,
      );
      const savedSettings = settingsFromTtrpgDraft(saved);
      if (savedSettings.runFormat === 'open') acknowledgeSeatApprovalSave(scope, saved.revision, savedSettings);
      setSettings(savedSettings);
      setTitle(nextTitle.trim());
      setEditBasis({ scope, revision: saved.revision });
      // Publish our successful snapshot before clearing dirty. Otherwise the
      // still-old liveQuery row can briefly reload the previous form/basis.
      setRows(current => current.map(item => item.work.id === scope.workId &&
        (!item.draft || item.draft.revision <= saved.revision)
        ? { ...item, draft: saved, work: { ...item.work, title: nextTitle.trim() } } : item));
      setDirty(false);
      return row;
    }
    if (row)
      throw new Error(
        "此作品已有旧制作记录，请在制作流程中继续；新配置请从作品库新建",
      );
    const made = await createTtrpgDraft(title || "未命名战役", settings);
    const target = { project: made.project, work: made.work };
    createdRouteHandoff.current = target;
    setDirty(false);
    return target;
  };
  const discardSeatApprovalCopy = (pending: SeatApprovalDraft) => void run(async () => {
    if (!await dialog.confirm({ title: '清除批准配置暂存副本？', message: '清除后无法恢复这份暂存副本。已应用到本窗口表单的修改仍保留；如需放弃表单修改，请先下载副本，再载入最新方案。',
      confirmText: '清除暂存副本', cancelText: '保留副本' })) return;
    clearSeatApprovalDraft(pending);
  });
  const prepareOpenDesign = async (saveEdits: boolean) => {
    // Called by the assistant before any model request or canonical adoption.
    // Flush once; save(false) must not re-enter its own pending-edit barrier.
    if (designPreparing.current || busy || !scope || !row?.draft) throw new Error('请先保存并载入当前作品');
    const captured = scope;
    designPreparing.current = true; setBusy(true);
    try {
      await flushPendingEditsV1();
      if (!sameScope(currentScope.current, captured)) throw new Error('作品已切换，请在当前作品重新操作');
      if (dirty) {
        if (!saveEdits) throw new Error('本窗口尚有人工修改，请先保存并重新检查原候选');
        await save(false);
      }
      const draft = await readTtrpgDraft(captured);
      if (!sameScope(currentScope.current, captured)) throw new Error('作品已切换，未发起新请求');
      if (!draft.selectionJson || !draft.suggestionKey || !selection || suggestionKey !== draft.suggestionKey ||
        canonicalProductProductionJsonV2(selection) !== canonicalProductProductionJsonV2(JSON.parse(draft.selectionJson)))
        throw new Error('请先到世界出口页明确保存读取范围，再起草设计');
      return draft.revision;
    } finally { designPreparing.current = false; setBusy(false) }
  };
  const reloadAdoptedDesign = async () => {
    if (!scope) return;
    const captured = scope;
    const [draft, work] = await Promise.all([readTtrpgDraft(captured), db.works.get(captured.workId)]);
    // Never load a historical receipt post-state over later local edits.
    if (!sameScope(currentScope.current, captured) || currentDirty.current || !work) return;
    setSettings(settingsFromTtrpgDraft(draft)); setTitle(work.title);
    setEditBasis({ scope: captured, revision: draft.revision });
    setRows(current => current.map(item => item.work.id === captured.workId &&
      (!item.draft || item.draft.revision <= draft.revision) ? { ...item, work, draft } : item));
  };
  const leave = (url: string) => void run(async () => {
    await flushPendingEditsV1();
    if (dirty) await save();
    navigate(url);
  });
  const go = (id: string) =>
    void run(async () => {
      await flushPendingEditsV1();
      const target = dirty ? await save() : row;
      setMenu(false);
      setInnerMenu(false);
      navigate(
        path(
          id,
          target,
          sessionId && TTRPG_PLAY_PAGES.some((p) => p[0] === id)
            ? `&session=${sessionId}`
            : "",
        ),
      );
    });
  const step = TTRPG_SETUP_PAGES.findIndex((p) => p[0] === page[0]);
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
      await flushPendingEditsV1();
      const target = dirty || !row ? await save() : row;
      const targetScope = {
        projectId: target.project.id!,
        worldId: target.work.worldId,
        workId: target.work.id!,
      };
      const latest = await readTtrpgDraft(targetScope);
      if (!latest.worldReleaseId) {
        navigate(path("confirm", target));
        throw new Error("需要一个世界引擎；配置已保存，请到世界引擎页选择版本");
      }
      const id = await prepareTtrpgBrief(targetScope, latest.revision);
      navigate(path("agent", target, `&production=${id}`));
      setNotice(settings.runFormat === 'open' ? '开放审查方案已保存，请核对并到制作页明确开始。' : '审查方案已保存，请比较提案并确认。尚未开始制作。');
    });
  let handoffId: number | null = null,
    handoffError = "";
  try {
    const raw = params.get("worldHandoff");
    if (raw) {
      const handoff = parseProductProductionHandoffV1(JSON.parse(raw));
      if (handoff.productType !== "ttrpg") throw new Error("交接产品不匹配");
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
      className={`longform-app avg-app ttrpg-author-app ${menu ? "lf-navigation-open" : ""} ${innerMenu ? "lf-step-menu-open" : ""}`}
      data-testid="ttrpg-author-page"
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
              aria-current={p.id === "ttrpg" ? "page" : undefined}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </header>
      <aside className="lf-sidebar">
        <small>TABLETOP ROLEPLAY</small>
        <h1>跑团</h1>
        <p>让想象，聚在同一张桌上。</p>
        <button className="lf-current" onClick={() => go("library")}>
          <BookOpen />
          {row?.work.title ?? "选择或新建战役"}
        </button>
        <nav aria-label="跑团页面导航">
          {TTRPG_PRIMARY.map(([id, label, entry]) => (
            <button
              key={id}
              aria-current={primary === id ? "page" : undefined}
              onClick={() => go(entry)}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() =>
              void run(async () => {
                await flushPendingEditsV1();
                if (dirty) await save();
                navigate("/home/settings");
              })
            }
          >
            通用设置
          </button>
        </nav>
      </aside>
      <section className="lf-main">
        <header className="lf-heading">
          <small>
            跑团 › {TTRPG_PRIMARY.find((p) => p[0] === primary)?.[1]} ›{" "}
            {page[1]}
            {row ? ` · ${row.work.title}` : ""}
          </small>
          <h2>{TTRPG_PRIMARY.find((p) => p[0] === primary)?.[1]}</h2>
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
              跑团目录
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
              <nav aria-label="跑团内容导航">
                {(primary === "workbench"
                  ? [
                      {
                        label: "S2 · 方案与配置",
                        pages: [
                          ...TTRPG_SETUP_PAGES.slice(0, -1),
                          ["agent", "方案会谈"],
                          TTRPG_SETUP_PAGES[8],
                        ],
                      },
                      { label: "S3 · 制作与检查", pages: TTRPG_BUILD_PAGES },
                    ]
                  : [{ label: "游玩与团局", pages: TTRPG_PLAY_PAGES }]
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

            {error && (
              <p className="avg-alert" role="alert">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            {seatApprovalDraft && <section className="lf-paper" data-testid="ttrpg-seat-approval-recovery" aria-label="批准配置暂存副本">
              <p>“{rows.find(item => item.work.id === seatApprovalDraft.owner.workId && item.project.id === seatApprovalDraft.owner.projectId)?.work.title ?? '原作品'}”有一份 AI 队友批准配置尚待保存。关闭或刷新页面会丢失暂存副本，请先保存或下载。</p>
              <div className="avg-actions">
                <button type="button" className="lf-action" disabled={busy} onClick={() => {
                  // Recovery preserves the existing pending buffer and grants no writes.
                  navigate(`/ttrpg/seats?project=${seatApprovalDraft.owner.projectId}&work=${seatApprovalDraft.owner.workId}`);
                }}>恢复核对批准配置</button>
                <button type="button" className="lf-action" disabled={busy} onClick={() => void run(async () => {
                  await downloadTextFile(JSON.stringify({ purpose: 'unsaved-seat-approval-comparison', ...seatApprovalDraft }, null, 2), '跑团-待确认批准配置.json', 'application/json');
                })}>下载待确认批准配置</button>
                <button type="button" className="lf-action" disabled={busy} onClick={() => discardSeatApprovalCopy(seatApprovalDraft)}>清除批准配置暂存副本</button>
              </div>
            </section>}
            {draftConflict && <section className="lf-paper" data-testid="ttrpg-draft-conflict" aria-label="方案版本冲突">
              <h3>方案已在其他窗口或作品中变化</h3>
              <p>本窗口未保存的修改仍保留，不能直接覆盖最新方案。请先下载修改副本；载入最新方案后可对照副本继续编辑。</p>
              <div className="avg-actions">
                <button className="lf-action" disabled={busy} onClick={() => void run(async () => {
                  await flushPendingEditsV1();
                  await downloadTextFile(JSON.stringify({ productType: 'ttrpg', purpose: 'unsaved-authoring-comparison',
                    scope: editBasis?.scope, baseRevision: editBasis?.revision, title, settings }, null, 2), '跑团-未保存修改.json', 'application/json');
                })}>下载本窗口修改副本</button>
                <button className="lf-action" disabled={busy || !scope || !row?.draft} onClick={() => void run(async () => {
                  await flushPendingEditsV1();
                  if (!await dialog.confirm({ title: '载入最新方案？',
                    message: '这会替换本窗口未保存的修改。请先下载修改副本，再对照最新方案继续编辑。',
                    confirmText: '载入最新方案', cancelText: '保留本窗口修改' })) return;
                  if (!scope) throw new Error('请先选择当前作品');
                  const latest = await readTtrpgDraft(scope), work = await db.works.get(scope.workId);
                  if (!sameScope(currentScope.current, scope)) throw new Error('当前作品已切换，本窗口内容未替换，请重新核对');
                  if (!work || work.projectId !== scope.projectId || work.worldId !== scope.worldId) throw new Error('作品已不存在或不属于当前范围');
                  setRows(current => current.map(item => item.work.id === scope.workId &&
                    (!item.draft || item.draft.revision <= latest.revision) ? { ...item, draft: latest, work } : item));
                  setSettings(settingsFromTtrpgDraft(latest)); setTitle(work.title); setEditBasis({ scope, revision: latest.revision }); setDirty(false);
                  setNotice('最新方案已载入；修改副本可用于人工比对，不是完整作品备份。');
                })}>载入最新方案</button>
              </div>
            </section>}
            {loading ? (
              <p>读取跑团作品…</p>
            ) : (
              <Suspense fallback={<p>打开功能…</p>}>
                {page[0] === "library" ? (
                  <>
                    <section className="lf-paper">
                      <div className="avg-actions">
                        <button
                          className="lf-action lf-action-primary"
                          disabled={busy || draftConflict}
                          onClick={() => {
                            createdRouteHandoff.current = null;
                            setDirty(false);
                            setEditBasis(null);
                            setSettings(defaultTtrpgSettings());
                            setTitle("");
                            navigate("/ttrpg/vision");
                          }}
                        >
                          新建战役
                        </button>
                        {openPreview && <button className="lf-action" disabled={busy || draftConflict} onClick={() => {
                          createdRouteHandoff.current = null;
                          setDirty(false); setEditBasis(null); setSettings(defaultTtrpgSettingsV2('open')); setTitle(''); navigate('/ttrpg/vision?format=open');
                        }}>新建开放跑团（预览）</button>}
                        <input
                          aria-label="搜索战役"
                          placeholder="搜索战役名称"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                      <p>先规划，再制作。作品版本与每一场冒险分别保存。</p>
                    </section>
                    <div className="lf-library-grid">
                      {rows
                        .filter((r) => r.work.title.includes(search))
                        .map((r) => (
                          <article className="lf-paper" key={r.work.id}>
                            <small>
                              {r.draft ? "制作方案" : "已有跑团作品"}
                            </small>
                            <h3>{r.work.title}</h3>
                            <p>
                              {r.draft?.worldReleaseId
                                ? "已引用世界版本"
                                : "可先规划战役"}
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
                        <h3>你的第一场冒险</h3>
                        <p>
                          还没有自己的战役，可以先进入制作台填写，或者游玩社区作品。
                        </p>
                      </section>
                    )}
                    <button className="lf-action" onClick={() => navigate(`/community/market${scope ? `?project=${scope.projectId}&work=${scope.workId}` : ""}`)}>打开社区市场与在线招募</button>
                    <Community embedded />
                  </>
                ) : step >= 0 ? (
                  <>
                    <section className="lf-paper">
                      <h3>{page[1]}</h3>
                      <p>
                        保存配置不会调用模型或开始制作。未选择世界时也可以填写。
                      </p>
                      <fieldset
                        disabled={busy || loading || Boolean(projectId && !row) || Boolean(readCreatedRouteHandoff() && !row) || Boolean(row && !row.draft)}
                        className="avg-form"
                      >
                        <label>
                          战役名称
                          <input
                            aria-label="战役名称"
                            value={title}
                            maxLength={200}
                            onChange={(e) => {
                              setTitle(e.target.value);
                              setDirty(true);
                            }}
                          />
                        </label>
                        {[0, 1].includes(step) && (
                          <>
                            <label>
                              开场与核心目标
                              <textarea
                                value={settings.openingSituation}
                                onChange={(e) => {
                                  setSettings((s) => ({
                                    ...s,
                                    openingSituation: e.target.value,
                                  }));
                                  setDirty(true);
                                }}
                              />
                            </label>
                            <label>
                              玩家身份
                              <input
                                value={settings.playerRole}
                                onChange={(e) => {
                                  setSettings((s) => ({
                                    ...s,
                                    playerRole: e.target.value,
                                  }));
                                  setDirty(true);
                                }}
                              />
                            </label>
                          </>
                        )}
                        <div className="ttrpg-wizard">
                          <Wizard
                            scope={scope}
                            runFormat={settings.runFormat}
                            value={settings.wizard}
                            sourceOptions={sources?.sourceOptions ?? null}
                            sourceSelection={selection}
                            activeStep={step}
                            onStepChange={(i) => go(TTRPG_SETUP_PAGES[i][0])}
                            onChange={(wizard) => {
                              setSettings((s) => ({ ...s, wizard }));
                              setDirty(true);
                            }}
                          />
                        </div>
                        {openPreview && settings.runFormat === 'open' && step === 1 && <OpenAuthoringEditor
                          key={scope ? `${scope.projectId}:${scope.worldId}:${scope.workId}` : 'new-open'} value={settings.openAuthoring}
                          onChange={openAuthoring => { setSettings(current => current.runFormat === 'open' ? { ...current, openAuthoring } : current); setDirty(true) }}/>}
                        {openPreview && settings.runFormat === 'open' && step === 1 && scope && row?.draft && <OpenDesignAssistant
                          key={`design:${scope.projectId}:${scope.worldId}:${scope.workId}`} scope={scope} revision={row.draft.revision}
                          needsInitialFacts={ttrpgOpenDesignNeedsInitialFactsV1(settings.openAuthoring)}
                          hasUnsavedEdits={dirty} beforeGenerate={() => prepareOpenDesign(true)}
                          beforeAdopt={async () => { await prepareOpenDesign(false) }} onAdopted={reloadAdoptedDesign}/>}
                        {openPreview && settings.runFormat === 'open' && step === 3 && (scope && editBasis && row?.draft && sameScope(scope, editBasis.scope) && !draftConflict ? <OpenSeatApprovalEditor
                          key={`approvals:${scope.projectId}:${scope.worldId}:${scope.workId}`} owner={scope} revision={editBasis.revision} value={settings}
                          onVision={() => go('vision')} onDiscard={discardSeatApprovalCopy} onApply={(pending, plan, policy) => {
                            if (!sameScope(currentScope.current, scope) || !sameScope(editBasis.scope, scope) || row.draft?.revision !== editBasis.revision)
                              throw new Error('作品或方案已变化，请先恢复原作品并核对版本');
                            // Recheck in the owner before merging only these two Settings fields.
                            reviewSeatApprovalDraft(pending, scope, editBasis.revision, settings);
                            const next = { ...settings, authoringSeatPlan: plan, openAuthoring: { ...settings.openAuthoring, companionPolicy: policy } };
                            markSeatApprovalApplied(pending, next); setSettings(next); setDirty(true);
                          }}/>
                          : <p>请先保存并载入当前作品，再配置 AI 队友批准关系。</p>)}
                        {step === 7 && (
                          <label>
                            制作质量
                            <select
                              value={settings.qualityProfile}
                              onChange={(e) => {
                                setSettings((s) => ({
                                  ...s,
                                  qualityProfile: e.target
                                    .value as typeof s.qualityProfile,
                                }));
                                setDirty(true);
                              }}
                            >
                              <option value="prototype">
                                原型（占位素材）
                              </option>
                              <option value="internal">内部评审</option>
                              <option value="commercial-candidate">
                                商业候选（须验收）
                              </option>
                            </select>
                          </label>
                        )}
                        <div className="avg-actions">
                          <button
                            className="lf-action lf-action-primary"
                            onClick={() =>
                              void run(async () => {
                                const target = await save();
                                navigate(path(page[0], target), {
                                  replace: true,
                                });
                                setNotice("制作配置已保存");
                              })
                            }
                          >
                            保存制作方案
                          </button>
                          {step === 8 ? (
                            <button className="lf-action" onClick={compile}>
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
                    {step === 8 && row?.draft && !row.draft.worldReleaseId
                      ? needsSource
                      : null}
                    {step === 8 && productionId && (
                      <section className="lf-paper">
                        <p>
                          已有审查方案。修改配置后请先更新方案；正式开始在制作流程中单独授权。
                        </p>
                        <button
                          className="lf-action"
                          onClick={() => go("agent")}
                        >
                          比较战役提案
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
                      <h3>世界版本与本战役的数据出口</h3>
                      <p>调整读取范围，不修改原世界；没有世界也可继续配置。</p>
                      <Link className="lf-action" to="/world/worlds">
                        创建或封存世界
                      </Link>
                      {handoffError && <p role="alert">{handoffError}</p>}
                      {worlds.map((w) => (
                        <article className="avg-source" key={w.id}>
                          <div>
                            <h4>
                              {w.label}
                              {handoffId === w.id ? " · 世界引擎带入" : ""}
                            </h4>
                            <p>
                              {w.worldCode} · v{w.version}
                            </p>
                          </div>
                          <button
                            className="lf-action"
                            disabled={
                              busy ||
                              Boolean(row && !row.draft) ||
                              Boolean(handoffError)
                            }
                            onClick={() =>
                              void run(async () => {
                                const target =
                                  dirty || !row ? await save() : row;
                                const sc = {
                                  projectId: target.project.id!,
                                  workId: target.work.id!,
                                  worldId: target.work.worldId,
                                };
                                const d = await readTtrpgDraft(sc);
                                await selectTtrpgWorld(sc, d.revision, w.id);
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
                        <p>尚无已封存世界。可以先填写战役方案。</p>
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
                            <h3>选择本战役读取的资源</h3>
                            <label>
                              建议起点
                              <select
                                value={suggestionKey}
                                onChange={(e) => {
                                  setSuggestionKey(e.target.value);
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
                              <fieldset key={key}>
                                <legend>{label}</legend>
                                {sources.sourceOptions[field].map((o) => (
                                  <label
                                    className="ttrpg-check"
                                    key={o.resourceKey}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selection[key].includes(
                                        o.resourceKey,
                                      )}
                                      onChange={(e) =>
                                        setSelection({
                                          ...selection,
                                          [key]: e.target.checked
                                            ? [...selection[key], o.resourceKey]
                                            : selection[key].filter(
                                                (v) => v !== o.resourceKey,
                                              ),
                                        })
                                      }
                                    />
                                    {o.label}
                                  </label>
                                ))}
                              </fieldset>
                            ))}
                            <button
                              className="lf-action"
                              onClick={() =>
                                void run(async () => {
                                  await saveTtrpgSourceSelection(
                                    scope,
                                    row.draft!.revision,
                                    suggestionKey,
                                    selection,
                                  );
                                  setNotice("出口范围已保存");
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
                  scope && productionId ? (
                    <Proposal scope={scope} productionId={productionId} onProduction={() => go('production')} />
                  ) : (
                    <section className="lf-paper">
                      <h3>把想法整理成可以比较的战役方案</h3>
                      <p>
                        先填写需求与九步配置，再生成审查方案。这里将提供真实的提案比较、混合与局部重做。
                      </p>
                      <button
                        className="lf-action"
                        onClick={() => go("instruction")}
                      >
                        填写创作指令
                      </button>
                      <button className="lf-action" onClick={compile}>
                        准备审查方案
                      </button>
                    </section>
                  )
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
                            <button
                              className="lf-action"
                              onClick={() =>
                                void run(async () => {
                                  await updateWorkspace(scope.projectId, {
                                    productPlatformOptIns: {
                                      ...row?.project.productPlatformOptIns,
                                      productProductionV3: true,
                                    },
                                  });
                                  setNotice("已启用自动制作，仍需单独授权开始");
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
                            initialProduct="ttrpg"
                            initialProductionId={productionId}
                            onProductionSelected={onProductionSelected}
                            managedCreation
                            view={
                              page[0] as "production" | "review" | "release"
                            }
                            authorOptIn={
                              row?.project.productPlatformOptIns
                                ?.productProductionV3 === true
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
                                `${row?.work.title ?? "跑团"}.json`,
                              ),
                            )
                          }
                        >
                          导出跑团备份
                        </button>
                      </section>
                    )}
                  </>
                ) : page[0] === "play" && sessionId && !row?.draft && !row?.productionId ? (
                  <Session key={sessionId} sessionId={sessionId} embedded />
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
                      <h3>跑团作品与本地冒险</h3>
                      <p>
                        可安装已发布作品开始游玩。自己的战役可在“发布与版本”导出游戏包；公共联机与发行服务是否可用，取决于部署配置。
                      </p>
                      <button
                        className="lf-action"
                        onClick={() => go("release")}
                      >
                        我的发布与版本
                      </button>
                    </section>
                    <button className="lf-action" onClick={() => navigate(`/community/market${scope ? `?project=${scope.projectId}&work=${scope.workId}` : ""}`)}>打开社区市场与在线招募</button>
                    <Community embedded />
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
