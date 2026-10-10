import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { liveQuery } from 'dexie'
import { Puzzle, Download, Package, BookOpen, ShieldCheck } from 'lucide-react'
import ProductFrame from '../components/navigation/ProductFrame'
import PluginRecovery from '../components/extensions/PluginRecovery'
import { MAX_PACKAGE_BYTES } from '../lib/extensions/package'
import ExtensionSurface from '../components/extensions/ExtensionSurface'
import { useDialog } from '../components/shared/Dialog'
import { db } from '../lib/db/schema'
import { defaultCatalogUrl, installFromCatalog, readCatalog, type ExtensionCatalog } from '../lib/extensions/catalog'
import { disablePackage, enablePackage, extensionScope, installPackage, uninstallPackage, upgradePackage } from '../lib/extensions/store'
import { loadDefinition, safeStartup, setSafeStartup } from '../lib/extensions/runtime'
import type { ExtensionPackage, ExtensionProfile, ExtensionRecord } from '../lib/extensions/types'
import type { Project, Work, World } from '../lib/types'
import '../components/extensions/extensions.css'

const WorkshopHelp = lazy(() => import('../components/extensions/WorkshopHelp'))
const PluginTools = lazy(() => import('../components/extensions/PluginTools'))
const PluginAITasks = lazy(() => import('../components/extensions/PluginAITasks'))
type InstalledPackageSummary = Omit<ExtensionPackage, 'bytes'>
async function packageSummaries(): Promise<InstalledPackageSummary[]> {
  const rows: InstalledPackageSummary[] = []
  await db.extensionPackages.each(pkg => { const {bytes: _bytes, ...summary} = pkg; rows.push(summary) })
  return rows
}
async function installedBytes(summary: InstalledPackageSummary): Promise<ExtensionPackage> {
  const pkg = await db.extensionPackages.get(summary.id!)
  if (!pkg || pkg.digest !== summary.digest) throw new Error('安装状态已变化，请刷新后重试')
  return pkg
}
const labels = { feature: '功能插件', content: '内容包', bundle: '组合包' }
export default function WorkshopPage() {
  const navigate = useNavigate()
  const { pageId = 'discover' } = useParams(), [params, setParams] = useSearchParams(), dialog = useDialog()
  const [catalog, setCatalog] = useState<ExtensionCatalog | null>(null), [address, setAddress] = useState(defaultCatalogUrl), [packages, setPackages] = useState<InstalledPackageSummary[]>([]), [profiles, setProfiles] = useState<ExtensionProfile[]>([]), [records, setRecords] = useState<ExtensionRecord[]>([]), [projects, setProjects] = useState<Project[]>([]), [works, setWorks] = useState<Work[]>([]), [worlds, setWorlds] = useState<World[]>([])
  const [preview, setPreview] = useState(() => localStorage.getItem('storyforge.plugins.preview') === '1')
  const [search, setSearch] = useState(''), [kind, setKind] = useState('all'), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [safe, setSafe] = useState(safeStartup)
  const projectId = Number(params.get('project')) || 0, owner = params.get('owner') === 'world' ? 'world' : 'work', workId = Number(params.get('work')) || undefined
  const selectedProject = projects.find(project => project.id === projectId)
  const selectedWork = works.find(work => work.id === (workId ?? selectedProject?.activeWorkId))
  const selectedWorld = worlds.find(world => world.id === selectedProject?.activeWorldId)
  const ownerKey = owner === 'world' ? `world:${selectedWorld?.code}` : `work:${selectedWork?.code}`
  const currentProfiles = profiles.filter(profile => profile.projectId === projectId && profile.ownerKey === ownerKey)
  const query = params.size ? `?${params}` : ''
  useEffect(() => {
    const sub = liveQuery(async () => ({ packages: await packageSummaries(), profiles: await db.extensionProfiles.toArray(), projects: await db.projects.toArray(), works: await db.works.toArray(), worlds: await db.worlds.toArray(), records: projectId ? await db.extensionRecords.where('projectId').equals(projectId).toArray() : [] })).subscribe({ next: value => { setPackages(value.packages); setProfiles(value.profiles); setProjects(value.projects); setWorks(value.works); setWorlds(value.worlds); setRecords(value.records) }, error: e => setError(String(e)) })
    return () => sub.unsubscribe()
  }, [projectId])
  useEffect(() => { let active = true; readCatalog().then(value => active && setCatalog(value)).catch(e => active && setError(`目录暂时不可用；仍可从本地文件安装。${String(e)}`)); return () => { active = false } }, [])
  async function act(action: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); setMessage(''); try { await action() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  async function enable(summary: InstalledPackageSummary) {
    const pkg = await installedBytes(summary)
    const scope = await extensionScope(projectId, pkg.manifest.owner, workId)
    const names = Object.keys(pkg.manifest.dependencies)
    const confirmed = await dialog.confirm({ title: `在当前${pkg.manifest.owner === 'world' ? '世界' : '作品'}启用“${pkg.manifest.name}”？`, message: `作者：${pkg.manifest.author}\n声明能力：${pkg.manifest.permissions.join('、') || '无额外能力'}\n依赖：${names.join('、') || '无'}\n${pkg.manifest.kind === 'feature' || names.length ? '功能插件属于可信本地代码，可访问同一浏览器中的数据。只启用你信任的作者和文件。' : '此内容包不执行代码。'}\n数据归当前作用域，停用和卸载都会保留。`, confirmText: '信任并启用' })
    if (!confirmed) return
    await enablePackage(pkg, scope); setMessage('已启用。进入“插件工作台”，或打开它替换的正式功能查看效果。')
  }
  async function upgrade(profile: ExtensionProfile, summary: InstalledPackageSummary) {
    const pkg = await installedBytes(summary)
    if (!await dialog.confirm({ title: `升级到 ${pkg.version}？`, message: '插件必须处于停用状态。升级会执行此版本的迁移代码，校验成功后切换到新数据代；失败时保留原数据。请先保存完整作品备份。', confirmText: '信任并升级' })) return
    const loaded = await loadDefinition(pkg)
    try { await upgradePackage(profile, pkg, loaded.definition); setMessage('升级完成；请重新启用。旧数据代已保留。') } finally { loaded.dispose() }
  }
  async function createExample(owner: 'work' | 'world') {
    if (!await dialog.confirm({title:'创建独立体验内容？',message:'将新建一部测试作品或一个测试世界，下载并启用官方参考插件。插件属于可信本地代码；不会调用 AI 或消耗模型额度。原有作品不受影响。',confirmText:'创建并启用参考插件'})) return
    const {createWorkshopExample} = await import('../lib/extensions/examples')
    const id = await createWorkshopExample(owner)
    navigate(owner === 'world' ? `/world/history?project=${id}` : `/workshop/workbench?project=${id}&owner=work`)
    setMessage('体验内容已创建。点击上方功能标签开始；之后可在“已安装”中停用插件，比较原有界面。')
  }
  const navigation = [{ label: '使用指南', path: `/workshop/help${query}`, active: pageId === 'help' }, { label: '外部工具记录', path: `/workshop/tools${query}`, active: pageId === 'tools' }, { label: 'AI 任务历史', path: `/workshop/ai${query}`, active: pageId === 'ai' }, { label: '发现插件', path: `/workshop/discover${query}`, active: pageId === 'discover' }, { label: '已安装', path: `/workshop/installed${query}`, active: pageId === 'installed' }, { label: '插件工作台', path: `/workshop/workbench${query}`, active: pageId === 'workbench' }, { label: '开发与发布', path: `/workshop/develop${query}`, active: pageId === 'develop' }]
  if (!preview) return <ProductFrame product="" title="创意工坊" page="开发预览" navigation={[]}><section className="lf-paper"><h3>试用插件与创意工坊</h3><p>独立插件包、作品数据保存和管理入口已在此分支提供 1.0 试用。此入口默认隐藏；开启后可在首页进入。请先在测试作品体验。</p><button className="lf-action" onClick={() => { localStorage.setItem('storyforge.plugins.preview', '1'); setPreview(true) }}>开启工坊开发预览</button></section></ProductFrame>
  return <ProductFrame product="" title="创意工坊" page={pageId === 'help' ? '使用指南' : pageId === 'tools' ? '外部工具记录' : pageId === 'ai' ? 'AI 任务历史' : pageId === 'installed' ? '已安装' : pageId === 'workbench' ? '插件工作台' : pageId === 'develop' ? '开发与发布' : '发现插件'} navigation={navigation}><div className="sf-workshop" data-testid="plugin-workshop">
    <section className="sf-workshop-hero"><small>STORYFORGE WORKSHOP · 开发预览</small><h3>让你的熔炉，多一种可能</h3><p>发现独立功能、内容和组合包。按作品或世界启用；你的创作仍保存在本地。</p><div className="sf-extension-actions"><Link className="lf-action" to={`/workshop/help${query}`}>安装与使用教程</Link><Link className="lf-action" to={`/workshop/develop${query}`}>用 AI 开发插件</Link><label className="lf-action"><Download size={16}/> 从文件安装<input aria-label="安装插件文件" type="file" accept=".sfplugin,.zip" disabled={busy} hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void act(async () => { if (file.size > MAX_PACKAGE_BYTES) throw new Error('插件包不能超过 16 MB'); const pkg = await installPackage(await file.arrayBuffer()); setMessage(`${pkg.manifest.name} 已安装，尚未执行；请在“已安装”中选择作用域后启用。`) }) }}/></label><button className="lf-action" onClick={() => { setSafeStartup(!safe); setSafe(!safe); const next = new URLSearchParams(params); next.delete('safe-plugins'); location.href = `${import.meta.env.BASE_URL}workshop/installed?${next}` }}><ShieldCheck size={16}/>{safe ? '退出安全模式' : '安全模式'}</button></div></section>
    {safe && <p className="sf-extension-error">安全模式已开启：当前标签页不会加载任何插件代码。你可以停用故障插件后退出。</p>}
    <div className="sf-workshop-filters"><label>使用范围 <select aria-label="插件工作区" value={projectId || ''} onChange={e => { const next = new URLSearchParams(params); next.set('project', e.target.value); next.delete('work'); setParams(next) }}><option value="">选择工作区</option>{projects.map(project => <option key={project.id} value={project.id}>{works.find(work => work.id === project.activeWorkId)?.title || worlds.find(world => world.id === project.activeWorldId)?.name || project.name}</option>)}</select></label><select aria-label="插件数据归属" value={owner} onChange={e => { const next = new URLSearchParams(params); next.set('owner', e.target.value); setParams(next) }}><option value="work">当前作品</option><option value="world">当前世界</option></select>{owner === 'work' && selectedProject && <select aria-label="插件作品" value={selectedWork?.id ?? ''} onChange={e => { const next = new URLSearchParams(params); next.set('work', e.target.value); setParams(next) }}>{works.filter(work => work.projectId === projectId).map(work => <option key={work.id} value={work.id}>{work.title}</option>)}</select>}</div>
    {busy && <p role="status">正在校验并处理，请保持页面打开…</p>}{error && <p className="sf-extension-error" role="alert">{error}</p>}{message && <p className="sf-workshop-status" role="status">{message}</p>}
    {pageId === 'discover' && <><section className="lf-paper"><h3>先试一部作品，或一个世界</h3><p>新建独立体验内容，自动装好参考插件，比较新增功能和模块替换的效果。</p><div className="sf-extension-actions"><button className="lf-action" disabled={busy || safe} onClick={() => void act(() => createExample('work'))}>创建体验作品</button><button className="lf-action" disabled={busy || safe} onClick={() => void act(() => createExample('world'))}>创建体验世界</button></div></section><div className="sf-workshop-filters"><input aria-label="搜索插件" placeholder="搜索名称、作者或功能" value={search} onChange={e => setSearch(e.target.value)}/><select aria-label="插件类别" value={kind} onChange={e => setKind(e.target.value)}><option value="all">全部类别</option>{Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div><div className="sf-workshop-grid">{catalog?.entries.filter(entry => (kind === 'all' || kind === entry.kind) && `${entry.name} ${entry.description} ${entry.author}`.includes(search)).map(entry => <article className="sf-workshop-card" key={`${entry.id}@${entry.version}`}><span className="sf-extension-tag">{labels[entry.kind]} · {entry.owner === 'world' ? '世界' : '作品'}</span><Puzzle size={24}/><h3>{entry.name}</h3><p>{entry.description}</p><small>{entry.author} · v{entry.version}</small><button disabled={busy || packages.some(pkg => pkg.pluginId === entry.id && pkg.digest === entry.digest)} onClick={() => void act(async () => { const installed = await installFromCatalog(entry, catalog); setMessage(`已安装 ${installed.length} 个包；在“已安装”中启用。`) })}>{packages.some(pkg => pkg.pluginId === entry.id && pkg.digest === entry.digest) ? '已安装此版本' : '下载并安装'}</button><details><summary>版本与依赖</summary><small>{entry.id}<br/>SHA-256 {entry.digest}</small><p>{Object.entries(entry.dependencies).map(([id, version]) => `${id}@${version}`).join('、') || '没有插件依赖'}</p></details></article>)}</div><details><summary>添加社区目录</summary><p>目录是作者维护的静态 JSON；读取目录和安装文件不会自动启用代码。</p><input aria-label="社区目录地址" value={address} onChange={e => setAddress(e.target.value)}/><button className="lf-action" disabled={busy} onClick={() => void act(async () => { setCatalog(await readCatalog(address)); setMessage('已加载社区目录。') })}>读取目录</button></details></>}
    {pageId === 'installed' && <><p>安装保存在本机，启用只对选定作品或世界生效。升级前先停用；卸载保留作品里的数据。</p><div className="sf-workshop-grid">{packages.map(pkg => { const profile = currentProfiles.find(row => row.pluginId === pkg.pluginId); const selected = profile?.digest === pkg.digest; return <article className="sf-workshop-card" key={pkg.id}><span className="sf-extension-tag">{labels[pkg.manifest.kind]} · {pkg.manifest.owner === 'world' ? '世界' : '作品'} · {selected && profile.enabled ? '已启用' : '未启用'}</span><Package size={24}/><h3>{pkg.manifest.name}</h3><small>v{pkg.version} · {pkg.manifest.author}</small><p>{pkg.manifest.description}</p><div className="sf-extension-actions">{selected && profile.enabled ? <button disabled={busy} onClick={() => void act(async () => { await disablePackage(profile); setMessage('已停用，原有数据保留。') })}>停用</button> : profile && !selected ? <button disabled={busy || profile.enabled || safe} onClick={() => void act(() => upgrade(profile, pkg))}>切换到此版本</button> : <button disabled={busy || !projectId || owner !== pkg.manifest.owner || safe} onClick={() => void act(() => enable(pkg))}>启用</button>}<button disabled={busy} onClick={() => void act(async () => { if (await dialog.confirm({ title: '卸载安装包？', message: '作品中的插件记录、旧数据代和契约会保留。重新安装相同版本后可继续使用。', confirmText: '卸载' })) { await uninstallPackage(await installedBytes(pkg)); setMessage('安装包已卸载，数据保留。') } })}>卸载</button></div><details><summary>接口与能力</summary><pre>{JSON.stringify(pkg.manifest, null, 2)}</pre></details>{selected && profile && <PluginRecovery profile={profile} busy={busy} act={act}/>}</article> })}</div>{!packages.length && <section className="lf-paper"><h3>从一个小功能开始</h3><p>先去“发现插件”安装创作便笺，或导入作者提供的 .sfplugin 文件。</p></section>}{currentProfiles.filter(profile => !packages.some(pkg => pkg.digest === profile.digest)).map(profile => <section key={profile.id} className="sf-extension-error"><strong>缺少安装包：{profile.pluginId}@{profile.version}</strong><p>数据仍然保留；重新安装相同文件即可恢复。</p><PluginRecovery profile={profile} busy={busy} act={act}/>{profile.enabled && <button onClick={() => void act(() => disablePackage(profile))}>停用缺失插件</button>}</section>)}</>}
    {pageId === 'tools' && projectId > 0 && <Suspense fallback={<p>读取工具记录…</p>}><PluginTools projectId={projectId} workId={workId}/></Suspense>}
    {pageId === 'ai' && projectId > 0 && <Suspense fallback={<p>读取任务历史…</p>}><PluginAITasks projectId={projectId} workId={workId}/></Suspense>}
    {pageId === 'workbench' && (projectId ? <><ExtensionSurface key={`${projectId}/${owner}/${workId}`} projectId={projectId} owner={owner} workId={workId}/><section className="lf-paper"><h3><BookOpen size={18}/> 保存的插件内容</h3><p>停用或缺少插件时，仍可在这里查看当前数据代的原始内容。完整备份会保存这些记录。</p>{currentProfiles.map(profile => <details key={profile.id}><summary>{profile.pluginId} · 数据代 {profile.generation}</summary>{records.filter(record => record.profileId === profile.id && record.generation === profile.generation).map(record => <article key={record.id}><h4>{record.key}</h4><pre>{JSON.stringify(record.payload, null, 2)}</pre></article>)}</details>)}</section>{selectedProject && <Link className="lf-action" to={owner === 'world' ? `/world/history?project=${projectId}` : `/workspace/${projectId}?module=story-timeline`}>打开{owner === 'world' ? '世界历史' : '故事进程'}功能</Link>}</> : <section className="lf-paper"><h3>先选择作品或世界</h3><p>插件会在明确的数据范围内运行。上方选择工作区后即可打开。</p></section>)}
    {(pageId === 'develop' || pageId === 'help') && <Suspense fallback={<p>读取工坊指南…</p>}><WorkshopHelp develop={pageId === 'develop'} query={query}/></Suspense>}
  </div></ProductFrame>
}
