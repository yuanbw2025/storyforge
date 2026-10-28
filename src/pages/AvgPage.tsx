import BrandIcon from '../components/shared/BrandIcon'
import ExampleLibrary from '../components/examples/ExampleLibrary'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { liveQuery } from "dexie";
import { BookOpen } from "lucide-react";
import { db } from "../lib/db/schema";
import type { Project, Work, WorkspaceScope } from "../lib/types";
import {
  DEFAULT_AVG_SETTINGS,
  type AvgAuthoringDraftV1,
  type AvgAuthoringSettingsV1,
} from "../lib/avg/authoring-contract";
import {
  createAvgDraftV1,
  saveAvgDraftV1,
  selectAvgWorldV1,
} from "../lib/avg/draft-service";
import { parseProductProductionHandoffV1 } from "../lib/product-production/handoff";
import { listLocalWorldReferenceChoicesV1 } from "../lib/world-engine/reference-cache";
import { updateWorkspace } from "../lib/workspace/works";
import { exportProjectJSON, downloadJSON } from "../lib/export/json-export";
import { useAutoBackup } from "../hooks/useAutoBackup";
import { useGistAutoBackup } from "../hooks/useGistAutoBackup";
import { PRODUCT_NAVIGATION } from "../components/navigation/product-navigation";
import { AVG_PAGES, AVG_PRIMARY_NAV, AVG_WORKBENCH_GROUPS, AVG_PLAYER_PAGES, avgPrimaryForPage } from "../components/avg/navigation";
import "../components/longform/longform.css";
import "../components/avg/avg.css";
const Studio = lazy(
  () => import("../components/product/ProductProductionStudio"),
);
const Player = lazy(() => import("../components/text-game/AvgGamePlayer"));
const Outlet = lazy(
  () => import("../components/world-engine/WorldResourceBrowser"),
);
const Inspector = lazy(() => import("../components/avg/BuildInspector"));
const AssemblyWorkbench = lazy(() => import('../components/avg/AssemblyWorkbench'));
const Consultation = lazy(() => import("../components/avg/Consultation"));
type Row = {
  project: Project;
  work: Work;
  draft?: AvgAuthoringDraftV1;
  productionId?: number;
};
const PRODUCTS = ["avg"] as const;
export default function AvgPage() {
  const { pageId = "library" } = useParams();
  const page = AVG_PAGES.find((p) => p[0] === pageId) ?? AVG_PAGES[0];
  const primaryId = avgPrimaryForPage(page[0]);
  const primary = AVG_PRIMARY_NAV.find(item => item[0] === primaryId)!;
  const hasContentNav = primaryId === 'workbench' || primaryId === 'player';
  const [contentMenu, setContentMenu] = useState(false);
  const contentNavRef = useRef<HTMLElement>(null);
  useEffect(() => {
    contentNavRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({block:'nearest'});
  }, [pageId, contentMenu]);
  const [params, setParams] = useSearchParams();
  const nativeFlushRef = useRef<(()=>Promise<void>)|null>(null);
  const registerNativeFlush = useCallback((flush:(()=>Promise<void>)|null)=>{nativeFlushRef.current=flush},[]);
  const narrativePreview = import.meta.env.DEV && params.has('narrative-preview');
  const navigate = useNavigate();
  const projectId = Number(params.get("project")) || null;
  const workId = Number(params.get("work")) || null;
  const productionId = Number(params.get("production")) || null;
  const sessionId = Number(params.get("session")) || null;
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [pageId]);
  const [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState<AvgAuthoringSettingsV1>({
      ...DEFAULT_AVG_SETTINGS,
    }),
    [title, setTitle] = useState(""),
    [dirty, setDirty] = useState(false),
    [search, setSearch] = useState("");
  const [worlds, setWorlds] = useState<
    Awaited<ReturnType<typeof listLocalWorldReferenceChoicesV1>>
  >([]);
  const row = rows.find(
    (r) => r.project.id === projectId && (!workId || r.work.id === workId),
  );
  const scope = useMemo<WorkspaceScope | null>(
    () =>
      row
        ? {
            projectId: row.project.id!,
            worldId: row.work.worldId,
            workId: row.work.id!,
          }
        : null,
    // Keep scope identity stable while authoring data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [row?.project.id, row?.work.worldId, row?.work.id],
  );
  const nativeAssembly = useMemo(()=>{
    if(params.get('assembly')==='1')return true;
    try{return !!row?.draft?.editorJson&&JSON.parse(row.draft.editorJson).schema==='storyforge.avg.author-workspace'}catch{return false}
  },[params,row?.draft?.editorJson]);
  useAutoBackup(projectId);
  useGistAutoBackup(projectId);
  useEffect(() => {
    const sub = liveQuery(async () => {
      const [projects, works, drafts, productions] = await Promise.all([
        db.projects.toArray(),
        db.works.toArray(),
        db.avgAuthoringDrafts.toArray(),
        db.productProductions.toArray(),
      ]);
      return works
        .flatMap((work) => {
          const project = projects.find((p) => p.id === work.projectId);
          const production = productions
            .filter((p) => p.productType === "avg" && p.workId === work.id)
            .sort((a, b) => b.updatedAt - a.updatedAt)[0];
          const draft = drafts.find((d) => d.workId === work.id);
          return project && (work.kind === "avg" || production)
            ? [{ project, work, draft, productionId: production?.id }]
            : [];
        })
        .sort((a, b) => b.work.updatedAt - a.work.updatedAt);
    }).subscribe({
      next: (value) => {
        setRows(value);
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
      setSettings(
        row?.draft
          ? JSON.parse(row.draft.settingsJson)
          : { ...DEFAULT_AVG_SETTINGS },
      );
      setTitle(row?.work.title ?? "");
    }
  }, [row?.work.id, row?.draft?.revision, dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    void listLocalWorldReferenceChoicesV1(narrativePreview ? { narrativeProductType: 'avg' } : {})
      .then(setWorlds)
      .catch((e) => setError(String(e)));
  }, [pageId, row?.draft?.worldReleaseId, narrativePreview]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty]);
  const path = (id: string, target = row, extra = "") =>
    `/avg/${id}${target ? `?project=${target.project.id}&work=${target.work.id}${(target === row ? productionId : target.productionId) ? `&production=${target === row ? productionId : target.productionId}` : ""}${extra}` : ""}${narrativePreview ? `${target ? '&' : '?'}narrative-preview=1` : ''}`;
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (scope && row?.draft) {
      await saveAvgDraftV1(scope, row.draft.revision, settings, title);
      setDirty(false);
      setNotice("制作方案已保存");
      return row;
    }
    if (row)
      throw new Error(
        "这是一份已有生产记录，请在制作流程中继续；新方案请从作品库新建 AVG。",
      );
    const created = await createAvgDraftV1(
      title.trim() || "未命名 AVG",
      settings,
    );
    const target = { project: created.project, work: created.work };
    setDirty(false);
    navigate(path(page[0] === "library" ? "vision" : page[0], target));
    return target;
  };
  const go = (id: string) =>
    void run(async () => {
      await nativeFlushRef.current?.();
      const target = dirty ? await save() : row;
      setMenu(false);
      setContentMenu(false);
      navigate(path(id, target, (["play", "history"].includes(id) && sessionId ? `&session=${sessionId}` : "")+(params.get('assembly')==='1'?'&assembly=1':'')));
    });
  const update = <K extends keyof AvgAuthoringSettingsV1>(
    key: K,
    value: AvgAuthoringSettingsV1[K],
  ) => {
    setSettings((s) => ({ ...s, [key]: value }));
    setDirty(true);
  };
  const field = (
    key: keyof AvgAuthoringSettingsV1,
    label: string,
    area = false,
  ) => (
    <label key={key}>
      {label}
      {area ? (
        <textarea
          value={String(settings[key])}
          maxLength={5000}
          onChange={(e) => update(key, e.target.value as never)}
        />
      ) : (
        <input
          value={String(settings[key])}
          maxLength={5000}
          onChange={(e) => update(key, e.target.value as never)}
        />
      )}
    </label>
  );
  const setup = useMemo(
    () =>
      row?.draft
        ? {
            settings: JSON.parse(
              row.draft.settingsJson,
            ) as AvgAuthoringSettingsV1,
            title: row.work.title,
            worldReleaseId: row.draft.worldReleaseId,
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [row?.draft?.settingsJson, row?.draft?.worldReleaseId, row?.work.title],
  );
  const selectProduction = useCallback(
    (id: number | null) => {
      const next = new URLSearchParams(params);
      if (id) next.set("production", String(id));
      else next.delete("production");
      if (next.toString() !== params.toString())
        navigate({ search: next.toString() }, { replace: true });
    },
    [params, navigate],
  );
  const handoff = params.get("worldHandoff");
  let handedOffId: number | null = null;
  let handoffError = "";
  if (handoff) {
    try {
      const v = parseProductProductionHandoffV1(JSON.parse(handoff));
      if (v.productType !== "avg") throw new Error("世界交接的产品类型不匹配");
      const w = worlds.find((w) => w.id === v.worldReleaseId);
      if (w && w.hash !== v.worldContentHash)
        throw new Error("交接世界版本已变化，请重新选择");
      handedOffId = v.worldReleaseId;
    } catch (e) {
      handoffError = String(e);
    }
  }
  const enable = () =>
    void run(async () => {
      if (!row) return;
      await updateWorkspace(row.project.id!, {
        productPlatformOptIns: {
          ...row.project.productPlatformOptIns,
          productProductionV3: true,
        },
      });
      setNotice("已启用本作品的自动制作；仍需确认方案并明确开始。");
    });
  return (
    <div
      className={`longform-app avg-app ${menu ? "lf-navigation-open" : ""} ${contentMenu ? "lf-step-menu-open" : ""}`}
      data-testid="avg-page"
      onClickCapture={event=>{
        if(!nativeFlushRef.current||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
        const anchor=event.target instanceof Element?event.target.closest('a'):null;
        const href=anchor?.getAttribute('href');
        if(!anchor||!href?.startsWith('/')||anchor.hasAttribute('download')||anchor.target==='_blank')return;
        event.preventDefault();event.stopPropagation();
        void run(async()=>{await nativeFlushRef.current?.();navigate(href.replace(/^\/storyforge(?=\/)/,''))});
      }}
    >
      <header className="lf-top">
        <Link className="lf-brand" to="/" aria-label="返回首页">
          <BrandIcon/>
          <span>
            <strong>StoryForge</strong>
            <small>故事熔炉</small>
          </span>
        </Link>
        <nav aria-label="产品导航">
          {PRODUCT_NAVIGATION.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              aria-current={item.id === "avg" ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      <aside className="lf-sidebar">
        <small>VISUAL NOVEL</small>
        <h1>AVG</h1>
        <p>让每一次选择，都有回声。</p>
        <button className="lf-current" disabled={busy} onClick={() => go("library")}>
          <BookOpen />
          {row?.work.title ?? "选择或新建 AVG"}
        </button>
        <nav aria-label="AVG 页面导航">
          {AVG_PRIMARY_NAV.map(([id, label, entry]) => (
            <button key={id} disabled={busy} aria-current={primaryId === id ? 'page' : undefined} onClick={() => go(nativeAssembly&&id==='workbench'?'production':entry)}>{label}</button>
          ))}
          <button disabled={busy} onClick={() => void run(async () => { await nativeFlushRef.current?.(); if (dirty) await save(); navigate('/home/settings'); })}>通用设置</button>
        </nav>
      </aside>
      <section className="lf-main">
        <header className="lf-heading">
          <small>
            AVG › {primary[1]}{hasContentNav ? ` › ${page[1]}` : ''}
            {row ? ` · ${row.work.title}` : ""}
          </small>
          <h2>{primary[1]}</h2>
            {primaryId !== 'library' && primaryId !== 'player' && <nav className="avg-phases" aria-label="制作阶段">
              {[
                ["source", "S1 · 世界封存"],
                ["vision", "S2 · 产品定向"],
                ["production", "S3 · 产品执行"],
              ].map(([id, label]) => (
                <button key={id} disabled={busy} aria-current={(id === 'source' ? page[0] === 'source' : id === 'vision' ? page[2] === 'S2 · 产品定向' : page[2] === 'S3 · 产品执行') ? 'step' : undefined} onClick={() => go(id)}>
                  {label}
                </button>
              ))}
            </nav>}
          <div className="lf-mobile-controls">
            <button aria-expanded={menu} onClick={() => {setMenu(!menu);setContentMenu(false);}}>AVG 目录</button>
            {hasContentNav && <button aria-expanded={contentMenu} onClick={() => {setContentMenu(!contentMenu);setMenu(false);}}>{primaryId === 'workbench' ? '制作目录' : '游玩目录'}</button>}
          </div>
        </header>
        <div className={`lf-body ${hasContentNav ? 'lf-with-steps' : ''}`}>
          {hasContentNav && <aside ref={contentNavRef} className="lf-steps avg-content-sidebar">
            <nav aria-label="AVG 内容导航">
              {primaryId === 'workbench' ? AVG_WORKBENCH_GROUPS.map(group => <section key={group.label}>
                <h3>{group.label}</h3>
                {group.pages.map(item => <button key={item[0]} disabled={busy} aria-current={page[0] === item[0] ? 'page' : undefined} onClick={() => go(item[0])}>{item[1]}</button>)}
              </section>) : <section><h3>游玩与记录</h3>{AVG_PLAYER_PAGES.map(item => <button key={item[0]} disabled={busy} aria-current={page[0] === item[0] ? 'page' : undefined} onClick={() => go(item[0])}>{item[1]}</button>)}</section>}
            </nav>
          </aside>}
          <main ref={contentRef} className="lf-content">

            {primaryId === "workbench" && ["confirm", "production", "review"].includes(page[0]) && <h3 className="avg-page-heading">{page[1]}</h3>}
            {error && (
              <p className="avg-alert" role="alert">
                {error}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            {loading ? (
              <p role="status">读取 AVG 作品…</p>
            ) : (
              <Suspense fallback={<p role="status">打开功能…</p>}>
                {page[0] === "library" ? (
                  <>
                    <section className="lf-paper">
                      <div className="avg-actions">
                        <button
                          className="lf-action lf-action-primary"
                          onClick={() => {
                            setDirty(false);
                            setTitle("");
                            setSettings({ ...DEFAULT_AVG_SETTINGS });
                            navigate("/avg/vision");
                          }}
                        >
                          新建 AVG
                        </button>
                        <input
                          aria-label="搜索 AVG"
                          placeholder="搜索作品名称"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </div>
                      <p>
                        可以先填写方案，再引用世界版本。制作与游玩进度分别保存。
                      </p>
                    </section>
                    <div className="lf-library-grid">
                      {rows
                        .filter((r) => r.work.title.includes(search))
                        .map((r) => (
                          <article className="lf-paper" key={r.work.id}>
                            <small>
                              {r.draft ? "AVG 制作方案" : "已有 AVG 生产记录"}
                            </small>
                            <h3>{r.work.title}</h3>
                            <p>
                              {r.draft?.worldReleaseId
                                ? "已选择冻结世界版本"
                                : "可先规划故事与路线"}
                            </p>
                            <div className="avg-actions">
                              <Link
                                className="lf-action lf-action-primary"
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
                        <h3>你的第一部 AVG</h3>
                        <p>这里尚无作品。可以新建，或先查看制作台各个页面。</p>
                      </section>
                    )}
                    <ExampleLibrary kind="avg"/>
                  </>
                ) : page[0] === "vision" || page[0] === "routes" ? (
                  <section className="lf-paper">
                    <h3>
                      {page[0] === "vision"
                        ? "把想法写成一份制作方案"
                        : "安排路线、选择与结局"}
                    </h3>
                    <p>保存方案不会启动制作。未选择世界时也可以填写。</p>
                    <fieldset
                      disabled={busy || Boolean(row && !row.draft)}
                      className="avg-form"
                    >
                      {(!row || row.draft) && (
                        <label>
                          作品名称
                          <input
                            aria-label="AVG 作品名称"
                            value={title}
                            maxLength={200}
                            onChange={(e) => {
                              setTitle(e.target.value);
                              setDirty(true);
                            }}
                          />
                        </label>
                      )}
                      {page[0] === "vision" ? (
                        <>
                          {field("playerRole", "玩家身份／主角")}
                          {field("openingSituation", "开场与核心目标", true)}
                          {field("experience", "体验重点", true)}
                          <label>
                            画幅
                            <select
                              value={settings.aspectRatio}
                              onChange={(e) =>
                                update(
                                  "aspectRatio",
                                  e.target.value as "16:9" | "4:3",
                                )
                              }
                            >
                              <option>16:9</option>
                              <option>4:3</option>
                            </select>
                          </label>
                          <label>
                            目标游玩时长（分钟）
                            <input
                              type="number"
                              min={1}
                              max={900}
                              value={settings.targetPlayMinutes}
                              onChange={(e) =>
                                update(
                                  "targetPlayMinutes",
                                  Number(e.target.value),
                                )
                              }
                            />
                          </label>
                          <label>
                            视觉素材
                            <select
                              value={settings.visualLevel}
                              onChange={(e) =>
                                update(
                                  "visualLevel",
                                  e.target.value as "none" | "key-scenes",
                                )
                              }
                            >
                              <option value="none">纯文字</option>
                              <option value="key-scenes">
                                背景、角色与关键画面
                              </option>
                            </select>
                          </label>
                          <label>
                            音频目标
                            <select
                              value={settings.audioLevel}
                              onChange={(e) =>
                                update(
                                  "audioLevel",
                                  e.target.value as "none" | "music-sfx",
                                )
                              }
                            >
                              <option value="none">静音</option>
                              <option value="music-sfx">音乐与音效</option>
                            </select>
                          </label>
                          <label>
                            制作质量
                            <select
                              value={settings.qualityProfile}
                              onChange={(e) =>
                                update(
                                  "qualityProfile",
                                  e.target
                                    .value as AvgAuthoringSettingsV1["qualityProfile"],
                                )
                              }
                            >
                              <option value="prototype">
                                原型 · 明确标记的占位素材
                              </option>
                              <option value="internal">
                                内部评审 · 可用时生成图片
                              </option>
                              <option value="commercial-candidate">
                                商业候选 · 正式媒资与验收
                              </option>
                            </select>
                          </label>
                        </>
                      ) : (
                        <>
                          {field("routes", "人物路线与关系", true)}
                          {field("variables", "变量与初始状态目标", true)}
                          {field("endings", "结局方向", true)}
                          <label>
                            目标结局数
                            <input
                              type="number"
                              min={1}
                              max={8}
                              value={settings.targetEndingCount}
                              onChange={(e) =>
                                update(
                                  "targetEndingCount",
                                  Number(e.target.value),
                                )
                              }
                            />
                          </label>
                          {field("choiceBoundaries", "选择与剧情边界", true)}
                        </>
                      )}
                      <div className="avg-actions">
                        <button
                          className="lf-action lf-action-primary"
                          onClick={() =>
                            void run(async () => {
                              await save();
                            })
                          }
                        >
                          保存制作方案
                        </button>
                        <button
                          className="lf-action"
                          onClick={() =>
                            go(page[0] === "vision" ? "routes" : "agent")
                          }
                        >
                          保存并继续
                        </button>
                      </div>
                    </fieldset>
                    {row && !row.draft && (
                      <button
                        className="lf-action"
                        disabled={busy}
                        onClick={() => go("production")}
                      >
                        打开已有制作记录
                      </button>
                    )}
                  </section>
                ) : page[0] === "source" ? (
                  <>
                    <section className="lf-paper">
                      <h3>引用一个已封存世界</h3>
                      <p>
                        选择后保留不可变的来源版本与数据出口；制作内容不会回写世界。没有世界也可继续规划方案。
                      </p>
                      <div className="avg-actions">
                        <Link className="lf-action" to="/world/worlds">
                          创建或封存世界
                        </Link>
                        <button
                          className="lf-action"
                          disabled={busy}
                          onClick={() => go("vision")}
                        >
                          返回制作方案
                        </button>
                      </div>
                      {handoffError && <p role="alert">{handoffError}</p>}
                      {handedOffId && (
                        <p>已从世界引擎带入选择，请确认对应版本后继续。</p>
                      )}
                      {worlds.map((w) => (
                        <article className="avg-source" key={w.id}>
                          <div>
                            <h4>
                              {w.label}
                              {w.id === handedOffId
                                ? " · 来自世界引擎的选择"
                                : ""}
                            </h4>
                            <p>
                              {w.worldCode} · v{w.version}
                              {w.narrative ? ' · 叙事世界接入（实验性）' : ''}
                            </p>
                          </div>
                          <button
                            className="lf-action"
                            disabled={busy || Boolean(row && !row.draft)}
                            onClick={() =>
                              void run(async () => {
                                let target = row;
                                if (target?.draft && scope && dirty) {
                                  await saveAvgDraftV1(
                                    scope,
                                    target.draft.revision,
                                    settings,
                                  );
                                  setDirty(false);
                                }
                                if (!target) {
                                  const made = await createAvgDraftV1(
                                    title || "未命名 AVG",
                                    settings,
                                  );
                                  target = {
                                    project: made.project,
                                    work: made.work,
                                  };
                                  setDirty(false);
                                }
                                const targetScope = {
                                  projectId: target.project.id!,
                                  worldId: target.work.worldId,
                                  workId: target.work.id!,
                                };
                                const draft = await db.avgAuthoringDrafts
                                  .where("workId")
                                  .equals(targetScope.workId)
                                  .first();
                                if (!draft) throw new Error("请新建 AVG 方案");
                                await selectAvgWorldV1(
                                  targetScope,
                                  draft.revision,
                                  w.id,
                                );
                                navigate(path("source", target));
                                setNotice(
                                  "世界版本已引用，可以查看出口并确认制作。",
                                );
                              })
                            }
                          >
                            选择此版本
                          </button>
                        </article>
                      ))}
                      {!worlds.length && (
                        <p>
                          尚无可引用的冻结版本。请先在世界引擎封存一个版本。
                        </p>
                      )}
                    </section>
                    {scope && row?.draft?.worldReleaseId && (
                      <Outlet
                        projectId={scope.projectId}
                        worldId={scope.worldId}
                        initialReleaseId={row.draft.worldReleaseId}
                        onVersions={() => navigate("/world/worlds")}
                      />
                    )}
                  </>
                ) : page[0] === "agent" ? (
                  <Consultation
                    scope={scope}
                    draft={row?.draft}
                    settings={settings}
                    onConfirm={(value) =>
                      void run(async () => {
                        if (!scope || !row?.draft) return;
                        await saveAvgDraftV1(scope, row.draft.revision, value);
                        setSettings(value);
                        setDirty(false);
                        navigate(path("vision"));
                        setNotice("候选方案已确认并保存");
                      })
                    }
                    onSource={() => go("source")}
                  />
                ) : scope&&nativeAssembly&&['confirm','production','narrative','variables','visual','audio','media-all','review','release'].includes(page[0]) ? (
                  <AssemblyWorkbench key={scope.workId} scope={scope} productionId={productionId??row?.draft?.productionId??row?.productionId??null}
                    page={page[0]} onRegisterFlush={registerNativeFlush} onSource={()=>go('source')}
                    onPreviewStarted={id=>navigate(path('play',row,`&session=${id}`))}/>
                ) : ["confirm", "production", "review", "release"].includes(
                    page[0],
                  ) ? (
                  <>
                    {!scope ? (
                      <section className="lf-paper">
                        <h3>{page[1]}</h3>
                        <p>
                          确认方案后，这里显示真实制作步骤、产物、检查与版本。可以先浏览其他页面。
                        </p>
                        <button
                          className="lf-action"
                          disabled={busy}
                          onClick={() => go("vision")}
                        >
                          填写制作方案
                        </button>
                      </section>
                    ) : (
                      <>
                        <section className="lf-paper"><h3>系统与效果组装（实验）</h3><p>使用作者输入和合法导入素材，确认后组装规则、对白、物件与舞台。可先验证系统效果。</p>
                          <button className="lf-action" onClick={()=>void run(async()=>{if(dirty)await save();navigate(path('production',row,'&assembly=1'))})}>打开系统与效果工作台</button>
                        </section>
                        {row?.draft && !row.draft.worldReleaseId ? (
                          <section className="lf-paper">
                            <h3>开始制作，需要一个世界引擎</h3>
                            <p>
                              方案可以继续修改。正式制作前请选择冻结世界版本。
                            </p>
                            <button
                              className="lf-action lf-action-primary"
                              disabled={busy}
                              onClick={() => go("source")}
                            >
                              选择世界引擎
                            </button>
                          </section>
                        ) : (
                          <>
                            {!row?.project.productPlatformOptIns
                              ?.productProductionV3 && (
                              <section className="lf-paper">
                                <h3>启用此作品的自动制作</h3>
                                <p>
                                  制作会使用全局 AI
                                  配置，生成内容与所选媒资。启用后仍需审查方案、授权开始；尚未验收的生成质量会明确标识。
                                </p>
                                <button className="lf-action" onClick={enable}>
                                  启用并继续确认
                                </button>
                              </section>
                            )}
                            <div
                              className={`avg-production avg-production-${page[0]}`}
                            >
                              <Studio
                                key={`${scope.workId}:${setup?.worldReleaseId ?? ""}`}
                                scope={scope}
                                allowedProducts={PRODUCTS}
                                initialProduct="avg"
                                view={
                                  page[0] as
                                    | "confirm"
                                    | "production"
                                    | "review"
                                    | "release"
                                }
                                avgSetup={setup}
                                initialProductionId={
                                  productionId ?? row?.productionId
                                }
                                onProductionSelected={selectProduction}
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
                        )}
                        {page[0] === "release" && (
                          <section className="lf-paper">
                            <h3>作品完整备份</h3>
                            <p>
                              包含方案、冻结来源、制作记录、发布与存档；不覆盖源世界项目。
                            </p>
                            <button
                              className="lf-action"
                              onClick={() =>
                                void run(async () =>
                                  await downloadJSON(
                                    await exportProjectJSON(scope.projectId),
                                    `${row?.work.title ?? "AVG"}.json`,
                                  ),
                                )
                              }
                            >
                              导出 AVG 备份
                            </button>
                          </section>
                        )}
                      </>
                    )}
                  </>
                ) : page[0] === "play" || page[0] === "history" ? (
                  scope && row ? (
                    <Player
                      key={scope.workId}
                      project={row.project}
                      scope={scope}
                      worldGroupId={null}
                      initialSessionId={sessionId}
                      initialPanel={page[0] === "history" ? "saves" : null}
                      onSessionChanged={id=>{const next=new URLSearchParams(params);if(id==null)next.delete('session');else next.set('session',String(id));setParams(next,{replace:true})}}
                      onReturnToWorkbench={nativeAssembly?()=>go('production'):undefined}
                    />
                  ) : (
                    <section className="lf-paper">
                      <h3>{page[1]}</h3>
                      <p>
                        作品发布后可在这里开始游玩，存档绑定具体版本。可以先浏览制作台。
                      </p>
                      <Link className="lf-action" to="/play/mist-harbor">
                        体验内置 AVG《雾港》
                      </Link>
                    </section>
                  )
                ) : (
                  <Inspector
                    scope={scope}
                    productionId={productionId ?? row?.productionId ?? null}
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
