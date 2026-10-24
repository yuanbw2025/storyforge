import { useCompactCategoryScroll } from '../hooks/useCompactCategoryScroll'
import BrandIcon from '../components/shared/BrandIcon'
import {ExperienceInfoForm} from '../components/character-interaction/ExperienceInfo'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { liveQuery } from 'dexie';
import { BookOpen } from 'lucide-react';
import { db } from '../lib/db/schema';
import type { Project, Work, WorkspaceScope } from '../lib/types';
import { DEFAULT_CHAT_SETTINGS_V2 as DEFAULT_CHAT_SETTINGS, type ChatAuthoringDraftV1, type ChatAuthoringSettings } from '../lib/character-interaction/authoring-contract';
import { createChatDraftV2, saveChatDraftV1, selectChatWorldV1, readChatDraftV1 } from '../lib/character-interaction/draft-service';
import { listLocalWorldReferenceChoicesV1 } from '../lib/world-engine/reference-cache';
import { loadProductProductionConsultationSourceV2 } from '../lib/product-production/world-source';
import { updateWorkspace } from '../lib/workspace/works';
import { exportProjectJSON, downloadJSON } from '../lib/export/json-export';
import { PRODUCT_NAVIGATION } from '../components/navigation/product-navigation';
import { CHAT_PAGES, CHAT_PRIMARY, chatPrimary } from '../components/character-interaction/navigation';
import { useAutoBackup } from '../hooks/useAutoBackup';
import '../components/longform/longform.css';
import '../components/avg/avg.css';
import '../components/character-interaction/chat.css';
const Studio = lazy(() => import('../components/product/ProductProductionStudio'));
const Player = lazy(() => import('../components/character-interaction/CharacterInteractionPanel'));
const Consultation = lazy(() => import('../components/character-interaction/Consultation'));
const ConsultationEvidence = lazy(() => import('../components/character-interaction/ConsultationEvidence'));
const PrivateCharacters = lazy(() => import('../components/character-interaction/PrivateCharacters'));
const VisualIntent = lazy(() => import('../components/character-interaction/VisualIntent'));
const StarterExperiences = lazy(() => import('../components/character-interaction/StarterExperiences'));
const SourceReview = lazy(() => import('../components/character-interaction/SourceReview'));
const BackgroundSourceSelection = lazy(() => import('../components/character-interaction/BackgroundSourceSelection'));
const NarrativeSetup = lazy(() => import('../components/character-interaction/NarrativeSetup'));
const Inspector = lazy(() => import('../components/character-interaction/BuildInspector'));
const Outlet = lazy(() => import('../components/world-engine/WorldResourceBrowser'));
const PRODUCTS = ['character-interaction'] as const;
interface Row {
    project: Project;
    work: Work;
    draft?: ChatAuthoringDraftV1;
    productionId?: number;
}
export default function CharacterChatPage() {
    const { pageId = 'library' } = useParams();
    const id = pageId === 'media-all' ? 'media' : pageId;
    const page = CHAT_PAGES.find(p => p[0] === id) ?? CHAT_PAGES[0];
    const primary = chatPrimary(page[0]);
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const contentRef = useRef<HTMLDivElement>(null);
    useEffect(() => { contentRef.current?.scrollTo(0, 0); }, [pageId]);
    useCompactCategoryScroll(contentRef, '.lf-step-nav', page[0]);
    const projectId = Number(params.get('project')) || null, workId = Number(params.get('work')) || null, productionId = Number(params.get('production')) || null, sessionId = Number(params.get('session')) || null;
    const [rows, setRows] = useState<Row[]>([]), [settings, setSettings] = useState<ChatAuthoringSettings>(structuredClone(DEFAULT_CHAT_SETTINGS)), [title, setTitle] = useState(''), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [menu, setMenu] = useState(false);
    const [newTitle,setNewTitle] = useState('');
    const draftCache = useRef(new Map<number|null,{settings:ChatAuthoringSettings;title:string;revision:number|null}>());
    const editingRevision = useRef<number|null>(null);
    const activeDraftKey = useRef<number|null|undefined>(undefined);
    const [worlds, setWorlds] = useState<Awaited<ReturnType<typeof listLocalWorldReferenceChoicesV1>>>([]);
    const [characters, setCharacters] = useState<{
        resourceKey: string;
        name: string;
        description: string;
    }[]>([]);
    const row = rows.find(r => r.project.id === projectId && (!workId || r.work.id === workId));
    const scope = useMemo<WorkspaceScope | null>(() => row ? { projectId: row.project.id!, worldId: row.work.worldId, workId: row.work.id! } : null, [row?.project.id, row?.work.id, row?.work.worldId]); // eslint-disable-line react-hooks/exhaustive-deps
    useAutoBackup(projectId);
    useEffect(() => { const subscription = liveQuery(async () => { const [projects, works, drafts, productions] = await Promise.all([db.projects.toArray(), db.works.toArray(), db.chatAuthoringDrafts.toArray(), db.productProductions.toArray()]); return works.flatMap(work => { const project = projects.find(p => p.id === work.projectId); const production = productions.filter(p => p.productType === 'character-interaction' && p.workId === work.id).sort((a, b) => b.updatedAt - a.updatedAt)[0]; return project && (work.kind === 'character-interaction' || production) ? [{ project, work, draft: drafts.find(d => d.workId === work.id), productionId: production?.id }] : []; }).sort((a, b) => b.work.updatedAt - a.work.updatedAt); }).subscribe({ next: setRows, error: e => setError(String(e)) }); return () => subscription.unsubscribe(); }, []);
    useEffect(() => {
        const key = row?.work.id ?? null;
        if (activeDraftKey.current !== key) {
            if (activeDraftKey.current !== undefined && dirty) draftCache.current.set(activeDraftKey.current,{settings,title,revision:editingRevision.current});
            activeDraftKey.current = key;
            const pending = draftCache.current.get(key);
            editingRevision.current = pending?.revision ?? row?.draft?.revision ?? null;
            setSettings(pending?.settings ?? (row?.draft ? JSON.parse(row.draft.settingsJson) : structuredClone(DEFAULT_CHAT_SETTINGS)));
            setTitle(pending?.title ?? row?.work.title ?? '');
            setDirty(Boolean(pending));
            return;
        }
        if (!dirty) {
            editingRevision.current = row?.draft?.revision ?? null;
            setSettings(row?.draft ? JSON.parse(row.draft.settingsJson) : structuredClone(DEFAULT_CHAT_SETTINGS));
            setTitle(row?.work.title ?? '');
        }
    // Only switch/refresh on identity or committed revision; edits stay local to their Work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row?.draft?.revision,row?.work.id,dirty]);
    useEffect(() => { void listLocalWorldReferenceChoicesV1().then(setWorlds).catch(e => setError(String(e))); }, [pageId]);
    useEffect(() => { let active = true; setCharacters([]); if (scope && row?.draft?.worldReleaseId)
        void loadProductProductionConsultationSourceV2({ scope, worldReleaseId: row.draft.worldReleaseId }).then(v => { if (active)
            setCharacters(v.selectionOptions.characters.map(c => ({ resourceKey: c.resourceKey, name: c.label, description: c.summary }))); }).catch(e => { if (active)
            setError(String(e)); }); return () => { active = false; }; }, [scope, row?.draft?.worldReleaseId]);
    const path = (p: string, target = row, extra = '') => `/chat/${p}${target ? `?project=${target.project.id}&work=${target.work.id}${(target === row ? productionId : null) || target.productionId ? `&production=${(target === row ? productionId : null) || target.productionId}` : ''}${extra}` : ''}`;
    useEffect(() => { const before = (event: BeforeUnloadEvent) => { if (dirty) {
        event.preventDefault();
        event.returnValue = '';
    } }; window.addEventListener('beforeunload', before); return () => window.removeEventListener('beforeunload', before); }, [dirty]);
    const save = async () => { if (!row) {
        const c = await createChatDraftV2(title || '未命名角色聊天', settings);
        draftCache.current.delete(null);
        setDirty(false);
        navigate(path(page[0], { project: c.project, work: c.work }));
        return c.scope;
    } if (!scope || !row.draft)
        throw new Error('此旧制作尚无角色聊天方案，请从作品库建立新方案。'); await saveChatDraftV1(scope, editingRevision.current ?? row.draft.revision, settings, title); draftCache.current.delete(scope.workId); setDirty(false); setNotice('方案已保存'); return scope; };
    const run = async (action: () => Promise<unknown>) => { if (busy)
        return; setBusy(true); setError(''); try {
        await action();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : String(e));
    }
    finally {
        setBusy(false);
    } };
    const go = (p: string) => void run(async () => { if (dirty) {
        const saved = await save();
        navigate(`/chat/${p}?project=${saved.projectId}&work=${saved.workId}`);
    }
    else
        navigate(path(p, row, sessionId ? `&session=${sessionId}` : '')); setMenu(false); });
    const update = <K extends keyof ChatAuthoringSettings>(k: K, v: ChatAuthoringSettings[K]) => { setSettings(s => ({ ...s, [k]: v })); setDirty(true); };
    const field = (k: keyof ChatAuthoringSettings, label: string, numeric = false) => <label>{label}{numeric ? <input type="number" min="1" value={Number(settings[k])} onChange={e => update(k, Number(e.target.value) as never)}/> : <textarea aria-label={label} value={String(settings[k])} maxLength={5000} onChange={e => update(k, e.target.value as never)}/>}</label>;
    const setup = useMemo(() => row?.draft ? { settings: JSON.parse(row.draft.settingsJson) as ChatAuthoringSettings, title: row.work.title, worldReleaseId: row.draft.worldReleaseId } : undefined, [row?.draft, row?.work.title]);
    const onProduction = useCallback((n: number | null) => { if (n && n !== productionId) contentRef.current?.scrollTo(0, 0); const next = new URLSearchParams(params); if (n)
        next.set('production', String(n));
    else
        next.delete('production'); if (next.toString() !== params.toString())
        navigate({ search: next.toString() }, { replace: true }); }, [params, navigate, productionId]);
    const onSession = useCallback((nextSessionId: number | null) => {
        // A store refresh after saving still reports the selected session. Only
        // actual navigation should reset the reader's position or replace the URL.
        if (nextSessionId === sessionId) return;
        if (nextSessionId) contentRef.current?.scrollTo(0, 0);
        const next = new URLSearchParams(params);
        if (nextSessionId) next.set('session', String(nextSessionId));
        else next.delete('session');
        navigate({ search: next.toString() }, { replace: true });
    }, [params, navigate, sessionId]);
    const privateCharacters = settings.version === 3 ? settings.privateCharacters ?? [] : [];
    const castCount = settings.characters.length + privateCharacters.length;
    const pageLinks = CHAT_PAGES.filter(p => chatPrimary(p[0]) === primary);
    return <div className={`longform-app avg-app chat-app ${page[0] === 'play' ? 'chat-play-page' : ''} ${menu ? 'lf-navigation-open' : ''}`} data-testid="character-chat-page"><header className="lf-top"><Link className="lf-brand" to="/"><BrandIcon/><span><strong>StoryForge</strong><small>故事熔炉</small></span></Link><nav aria-label="产品导航">{PRODUCT_NAVIGATION.map(p => <Link key={p.id} to={p.path} aria-current={p.id === 'chat' ? 'page' : undefined}>{p.label}</Link>)}</nav></header>
 <aside className="lf-sidebar"><small>CHARACTER CONVERSATIONS</small><h1>角色聊天</h1><p>每一次对话，都让彼此更近一些。</p><button className="lf-current" onClick={() => go('library')}><BookOpen />{row?.work.title ?? '选择或新建作品'}</button><nav aria-label="角色聊天主导航">{CHAT_PRIMARY.map(([key, label, entry]) => <button key={key} aria-current={primary === key ? 'page' : undefined} onClick={() => go(entry)}>{label}</button>)}<Link to="/community/releases">社区与发行</Link><Link to="/home/settings">通用设置</Link></nav></aside>
 <main className="lf-main"><header className="lf-heading"><h2>{CHAT_PRIMARY.find(p => p[0] === primary)?.[1]}</h2>{primary === 'workbench' && <div className="avg-phases"><button onClick={() => go('source')}>S1 世界来源</button><button onClick={() => go('vision')}>S2 产品定向</button><button onClick={() => go('production')}>S3 制作与运行</button></div>}<div className="lf-mobile-controls"><button onClick={() => setMenu(!menu)} aria-label="打开页面目录" aria-expanded={menu}>目录</button></div></header><div ref={contentRef} className="lf-content">{error && <p role="alert">{error}</p>}{dirty && <p>有尚未保存的方案修改</p>}{notice && <p role="status">{notice}</p>}

 <div className={pageLinks.length > 1 ? 'chat-layout' : ''}>{pageLinks.length > 1 && <nav className="lf-step-nav" aria-label="角色聊天页内目录">{['S2 · 产品定向', 'S3 · 产品执行', '游玩'].map(group => <div key={group}>{pageLinks.some(p => p[2] === group) && <small>{group}</small>}{pageLinks.filter(p => p[2] === group).map(p => <button key={p[0]} aria-current={p[0] === page[0] ? 'page' : undefined} onClick={() => go(p[0])}>{p[1]}</button>)}</div>)}</nav>}
 <section className="chat-content"><Suspense fallback={<p>正在载入…</p>}>
 {page[0] === 'production' && scope && (productionId || row?.productionId) && <Suspense fallback={null}><ConsultationEvidence scope={scope} productionId={(productionId || row?.productionId)!}/></Suspense>}
 {page[0] === 'library' ? <><section className="lf-paper"><h3>新的相遇</h3><label>作品名称<input value={newTitle} onChange={e => setNewTitle(e.target.value)}/></label><button className="lf-action lf-action-primary" disabled={busy} onClick={() => void run(async () => { const c = await createChatDraftV2(newTitle || '未命名角色聊天'); setNewTitle(''); setDirty(false); navigate(`/chat/vision?project=${c.scope.projectId}&work=${c.scope.workId}`); })}>新建角色聊天</button></section><StarterExperiences disabled={busy} onCreated={created => {setDirty(false); navigate(`/chat/vision?project=${created.projectId}&work=${created.workId}`)}}/>{rows.map(r => <article className="lf-paper" key={r.work.id}><h3>{r.work.title}</h3><p>{r.draft ? '方案草稿' : '已有制作'} · {new Date(r.work.updatedAt).toLocaleString()}</p><div className="avg-actions"><Link className="lf-action" to={path(r.draft ? 'vision' : 'production', r)}>继续制作</Link><Link className="lf-action" to={path('play', r)}>游玩与存档</Link><Link className="lf-action" to={path('release', r)}>版本与导出</Link></div></article>)}</> :
            page[0] === 'source' ? <><section className="lf-paper"><h3>选择冻结世界版本</h3><p>选择来源只是制作的一部分。你可以先填写方案，开始制作前再确认世界。</p>{worlds.map(w => <article className="avg-source" key={w.id}><div><h4>{w.label}</h4><p>{w.worldCode} · v{w.version}</p></div><button className="lf-action" disabled={busy} onClick={() => void run(async () => { const target = dirty || !scope ? await save() : scope; const draft = await readChatDraftV1(target); await selectChatWorldV1(target, draft.revision, w.id); setNotice('已引用冻结世界版本'); })}>选择此版本</button></article>)}{!worlds.length && <p>尚无冻结世界版本。<Link to="/world/worlds">前往世界引擎</Link></p>}</section>{scope && setup?.worldReleaseId && <Outlet projectId={scope.projectId} worldId={scope.worldId} initialReleaseId={setup.worldReleaseId} onVersions={() => navigate('/world/worlds')}/>}</> :
                ['vision', 'cast', 'memory'].includes(page[0]) ? <section className="lf-paper"><h3>{page[1]}</h3><div className="avg-form">{page[0] === 'vision' ? <><label>作品名称<input value={title} onChange={e => { setTitle(e.target.value); setDirty(true); }}/></label><label>互动模式<select value={settings.mode} onChange={e => update('mode', e.target.value as 'single' | 'multi')}><option value="single" disabled={castCount > 1}>单角色</option><option value="multi">多角色</option></select></label>{field('playerRole', '玩家身份')}{field('openingSituation', '开场与场景目标')}{field('experience', '体验重点')}{field('targetPlayMinutes', '目标时长（分钟）', true)}{settings.version === 3 && <ExperienceInfoForm value={settings.experienceInfo} disabled={busy} onChange={experienceInfo => {const {experienceInfo: _previousInfo, ...base} = settings; setSettings({...base, ...(experienceInfo ? {experienceInfo} : {})}); setDirty(true);}}/>}{settings.version === 3 && <NarrativeSetup value={settings.narrative} characters={characters} aiCharacterKeys={settings.characters.map(c => c.sourceKey)} hasSourceDiscoveries={!!settings.sourceReview?.classifications.some(c => c.discovery)} sourceUnitsJson={row?.draft?.sourceUnitsJson} onChange={narrative => { setSettings({...settings, narrative}); setDirty(true); }}/>}</> : page[0] === 'cast' ? <>{field('maxTurns', '每场景玩家回合上限', true)}{field('replyBudget', '每场景角色回复预算', true)}{settings.version === 3 && <PrivateCharacters value={privateCharacters} worldCharacterCount={settings.characters.length} mode={settings.mode} disabled={busy} onChange={value => {setSettings({...settings, privateCharacters: value}); setDirty(true);}}/>}{!characters.length && <p>先保存方案并选择世界，即可选择世界人物。场景由开场目标生成，发布前可在“场景与规则”检查。</p>}{characters.map(c => { const override = settings.characters.find(o => o.sourceKey === c.resourceKey) ?? { sourceKey: c.resourceKey, voiceRules: '', privateKnowledge: '', initialTrust: 0 }; const change = (patch: Partial<typeof override>) => update('characters', [...settings.characters.filter(o => o.sourceKey !== c.resourceKey), { ...override, ...patch }]); return <section key={c.resourceKey}><h4>{c.name}</h4><p>{c.description}</p><label><input type="checkbox" disabled={busy || settings.version === 3 && settings.narrative.playerCharacterKey === c.resourceKey || !settings.characters.some(o => o.sourceKey === c.resourceKey) && (settings.mode === 'single' ? privateCharacters.length > 0 : castCount >= 8)} checked={settings.characters.some(o => o.sourceKey === c.resourceKey)} onChange={e => update('characters', e.target.checked ? (settings.mode === 'single' ? [override] : [...settings.characters, override]) : settings.characters.filter(o => o.sourceKey !== c.resourceKey))}/>参与本次聊天</label>{settings.version === 3 && settings.narrative.playerCharacterKey === c.resourceKey && <p>此人物由玩家扮演。</p>}<label>说话与性格约束<textarea disabled={!settings.characters.some(o => o.sourceKey === c.resourceKey)} value={override.voiceRules} onChange={e => change({ voiceRules: e.target.value })}/></label><label>初始信任（-100～100）<input disabled={!settings.characters.some(o => o.sourceKey === c.resourceKey)} type="number" min="-100" max="100" value={override.initialTrust} onChange={e => change({ initialTrust: Number(e.target.value) })}/></label><label>仅此角色知道的秘密<textarea disabled={!settings.characters.some(o => o.sourceKey === c.resourceKey)} value={override.privateKnowledge} onChange={e => change({ privateKnowledge: e.target.value })}/></label></section>; })}</> : <>{field('contentBoundaries', '内容与知识边界')}{field('maxMemoryEntries', '每角色记忆上限', true)}{field('relationshipThreshold', '重大关系变化阈值', true)}<p>关键记忆先成为候选，由你确认；秘密不在玩家视角展示。场景结束时整理可见消息，不改变来源世界。</p></>}</div>{page[0] === 'cast' && scope && row?.draft && <BackgroundSourceSelection scope={scope} worldReleaseId={row.draft.worldReleaseId} settings={settings} disabled={busy} onChange={keys => {if (settings.version !== 1) {setSettings({...settings, backgroundResourceKeys: keys}); setDirty(true);}}}/>}{page[0] === 'cast' && scope && row?.draft && <SourceReview scope={scope} draft={row.draft} settings={settings} dirty={dirty} onConfirmed={() => setNotice('资料可见范围已确认，新制作将按知情范围使用角色资料')}/>}{page[0] === 'cast' && settings.version === 3 && <VisualIntent value={settings.visuals} characters={[...settings.characters.map(character => ({characterKey: character.sourceKey, name: characters.find(item => item.resourceKey === character.sourceKey)?.name ?? '所选人物'})), ...privateCharacters.map(character => ({characterKey: character.characterKey, name: character.name || '未命名新角色'}))]} disabled={busy} onChange={visuals => {const {visuals: _previousVisuals, ...base} = settings; setSettings({...base, ...(visuals ? {visuals} : {})}); setDirty(true);}}/>}<div className="avg-actions"><button className="lf-action lf-action-primary" disabled={busy} onClick={() => void run(save)}>保存方案</button><button className="lf-action" onClick={() => go('agent')}>与主 Agent 讨论</button></div></section> :
                    page[0] === 'agent' ? <><button className="lf-action" disabled={busy} onClick={() => void run(save)}>保存当前方案</button><Consultation scope={scope} draft={row?.draft} dirty={dirty} onSource={() => go('source')} onProduction={() => go('production')}/></> :
                        ['play', 'memory-review', 'history'].includes(page[0]) ? (scope && row ? <Player project={row.project} worldGroupId={null} workspaceScope={scope} initialSessionId={sessionId} view={page[0] === 'history' ? 'history' : page[0] === 'memory-review' ? 'memory' : 'chat'} onSessionSelected={onSession}/> : <section className="lf-paper"><h3>{page[1]}</h3><p>选择作品后，可以开始发布版本的会话或继续存档。</p><button className="lf-action" onClick={() => go('library')}>查看作品库</button></section>) :
                            ['characters', 'scenes', 'media'].includes(page[0]) ? <Inspector scope={scope} productionId={productionId ?? row?.productionId ?? null} page={page[0]} onProduction={() => go('production')}/> :
                                <>{!scope ? <section className="lf-paper"><h3>{page[1]}</h3><p>先保存制作方案，再查看实际制作记录。所有页面均可浏览。</p><button className="lf-action" onClick={() => go('vision')}>填写互动目标</button></section> : row?.draft && !setup?.worldReleaseId ? <section className="lf-paper"><h3>开始制作，需要一个世界引擎</h3><p>已经填写的方案会保留。请选择冻结世界版本。</p><button className="lf-action lf-action-primary" onClick={() => go('source')}>选择世界引擎</button></section> : <>{!row?.project.productPlatformOptIns?.productProductionV3 && <section className="lf-paper"><h3>启用本作品的自动制作</h3><p>使用全局 AI；仍需确认方案并明确开始。</p><button className="lf-action" onClick={() => void run(async () => { await updateWorkspace(scope.projectId, { productPlatformOptIns: { ...row?.project.productPlatformOptIns, productProductionV3: true } }); })}>启用自动制作</button></section>}<div className={`avg-production avg-production-${page[0]}`}><Studio embedded key={`${scope.workId}:${setup?.worldReleaseId}`} scope={scope} allowedProducts={PRODUCTS} initialProduct="character-interaction" chatSetup={setup} view={page[0] as 'confirm' | 'production' | 'review' | 'release'} initialProductionId={productionId ?? row?.productionId} onProductionSelected={onProduction} authorOptIn={row?.project.productPlatformOptIns?.productProductionV3 === true} onPreviewStarted={(_, n) => navigate(path('play', row, `&session=${n}`))} onPublished={() => go('play')}/></div></>}{page[0] === 'release' && scope && <section className="lf-paper"><h3>作品完整备份</h3><button className="lf-action" onClick={() => void run(async () => downloadJSON(await exportProjectJSON(scope.projectId), '角色聊天备份.json'))}>导出制作与存档备份</button></section>}</>}
 </Suspense></section></div></div></main></div>;
}
