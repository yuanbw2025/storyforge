import {useEffect, useRef, useState} from 'react'
import type {WorkspaceScope} from '../../lib/types'
import {CHAT_EXPERIENCE_FILE_LIMIT, previewChatExperiencePackageV1, installChatExperiencePackageV1,
  exportChatExperiencePackageV1, type ChatExperiencePackagePreviewV1} from '../../lib/character-interaction/experience-package'
import {downloadTextFile} from '../../lib/export/text-export'
import ExperienceInfo from './ExperienceInfo'

const triggerNames: Record<string, string> = {'scene-start': '进入场景', 'player-response': '你说话以后', continue: '你点击继续', return: '你返回聊天', 'player-seed': '你提出新情景'}
function Summary({value}: {value: ChatExperiencePackagePreviewV1['summary']}) {
  return <div className="space-y-2">
    <ExperienceInfo value={value.experienceInfo}/>
    <p>{value.kind} · 人物：{value.actors.map(actor => actor.name).join('、')}</p>
    <p>开场：{value.opening.scenes.map(scene => scene.title).join('、')}</p>
    {value.opening.persona && <p>你的身份：{value.opening.persona.name} · {value.opening.persona.description}</p>}
    {value.maxActions > 0 && <p>角色行动时机：{value.triggers.map(trigger => triggerNames[trigger]).join('、') || '未开启'}；每次最多 {value.maxActions} 步；{value.newSituations ? '可依据已审查的行动发展新情境' : '保持现有情境'}。</p>}
    <p>内含图片 {value.media.length} 张，共 {Math.ceil(value.media.reduce((sum, asset) => sum + asset.bytes, 0) / 1024)} KiB。</p>
    {value.media.length > 0 && <details><summary>图片及许可</summary><ul>{value.media.map((asset, index) => <li key={index}>{asset.name} · {asset.license || '未提供许可说明'}</li>)}</ul></details>}
    {value.credits.length > 0 && <details><summary>外部角色卡署名</summary><ul>{value.credits.map((credit, index) => <li key={index}>{credit.name} · {credit.creator || '未提供署名'} · {credit.version || '未提供版本'}</li>)}</ul></details>}
  </div>
}

export default function ExperiencePackages({scope, disabled, releases, onInstalled}: {
  scope: WorkspaceScope; disabled: boolean
  releases: Array<{id: number; title: string; version: number}>
  onInstalled: () => Promise<void>
}) {
  const [preview, setPreview] = useState<ChatExperiencePackagePreviewV1 | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [releaseId, setReleaseId] = useState('')
  const localConflict = preview?.existing.some(item => item.error && item.releaseHash === preview.releaseHash) === true
  const versionConflict = preview?.existing.some(item => item.localVersion === preview.releaseVersion && item.releaseHash !== preview.releaseHash) === true
  const generation = useRef(0), working = useRef(false)
  useEffect(() => () => {generation.current++}, [])
  const read = async (file?: File) => {
    if (disabled || working.current) return
    const id = ++generation.current
    setPreview(null); setError(''); setNotice('')
    if (!file) return
    working.current = true; setBusy(true)
    try {
      if (!file.size || file.size > CHAT_EXPERIENCE_FILE_LIMIT) throw new Error('请选择不超过 384 MiB 的完整体验包 JSON')
      const next = await previewChatExperiencePackageV1({scope, bytes: await file.arrayBuffer()})
      if (generation.current === id) setPreview(next)
    } catch (cause) {if (generation.current === id) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {if (generation.current === id) {working.current = false; setBusy(false)}}
  }
  const act = async (operation: () => Promise<void>) => {
    if (disabled || working.current) return
    const id = generation.current
    working.current = true; setBusy(true); setError(''); setNotice('')
    try {await operation()}
    catch (cause) {if (generation.current === id) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {if (generation.current === id) {working.current = false; setBusy(false)}}
  }
  return <details className="my-4 min-w-0 rounded border border-border p-3 text-sm" aria-label="角色聊天体验包">
    <summary>安装、比较与导出体验包</summary>
    <p className="my-3">体验包包含已发布的人物、情境与图片。安装后再选择版本开始聊天；现有存档继续使用原版本。</p>
    <label className="block">体验包文件<input className="block max-w-full" type="file" accept=".json,application/json" disabled={disabled || busy}
      onChange={event => {const file = event.target.files?.[0]; event.target.value = ''; void read(file)}}/></label>
    {busy && <p role="status">正在本地检查或保存体验包…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {preview && <section className="mt-3 space-y-3 break-words" aria-label="体验包安装预览">
      <h3>{preview.title}</h3><p className="whitespace-pre-wrap">{preview.description}</p>
      <Summary value={preview.summary}/>
      <p>聊天使用你配置的 AI 服务；安装不会调用模型。设备语音与服务凭据不随体验包提供。</p>
      <p>文件的完整性已核对。文件中的作者声明与图片许可仍来自文件提供者，不代表平台认证或额外授予使用权。</p>
      {preview.existing.length > 0 && <details><summary>比较本机同标识版本（{preview.existing.length}）</summary>
        <p>同标识不证明作者身份或存档兼容。安装保留各版本；可开始新故事，也可选中旧存档检查是否能创建升级副本。</p>
        {preview.existing.map(item => <section key={item.releaseId} className="my-3 rounded border border-border p-2">
          <h4>本机版本 {item.localVersion} · {item.error ? '完整性检查未通过' : item.sameContent ? '内容相同，重复安装将复用' : item.localVersion === preview.releaseVersion ? '同一发行版本号存在内容冲突' : '内容不同，将并列保留'}</h4>
          {item.error && <p>{item.error}</p>}{item.summary && <Summary value={item.summary}/>}<p className="break-all text-xs">版本标识：{item.releaseHash}</p>
        </section>)}
      </details>}
      <p className="break-all text-xs">体验包标识：{preview.bundleHash}</p>
      {localConflict && <p role="alert">这个版本的本机副本已损坏，暂不能复用或覆盖。请先备份原作品并处理损坏副本；现有存档保持不变。</p>}
      {versionConflict && <p role="alert">同一发行版本号已有不同内容，请选择另一部作品安装。不会重编号或覆盖原版本及存档。</p>}
      <button type="button" className="lf-action lf-action-primary" disabled={disabled || busy || localConflict || versionConflict} onClick={() => void act(async () => {
        const id = generation.current
        await installChatExperiencePackageV1(preview)
        if (generation.current !== id) return
        setPreview(null); setNotice('体验包已安装。可以选择版本开始新会话，或继续原来的存档。')
        await onInstalled()
      })}>确认安装此体验包</button>
      <button type="button" className="lf-action" disabled={busy} onClick={() => {generation.current++; setPreview(null); setError('')}}>取消安装</button>
    </section>}
    {releases.length > 0 && <div className="mt-4 space-y-2"><label className="block">导出版本<select className="block max-w-full" aria-label="导出体验包版本" value={releaseId} disabled={disabled || busy} onChange={event => setReleaseId(event.target.value)}>
      <option value="">选择一个已发布版本</option>{releases.map(release => <option key={release.id} value={release.id}>{release.title} · 版本 {release.version}</option>)}
    </select></label><button type="button" className="lf-action" disabled={disabled || busy || !releases.some(release => String(release.id) === releaseId)} onClick={() => void act(async () => {
      const id = generation.current, bundle = await exportChatExperiencePackageV1({scope, productReleaseId: Number(releaseId)})
      if (generation.current !== id) return
      await downloadTextFile(JSON.stringify(bundle), `chat-${bundle.productRelease.contentHash.slice(0, 12)}.game.json`, 'application/json')
      if (generation.current !== id) return
      setNotice('已导出完整体验包；聊天存档与制作草稿请使用作品完整备份保存。')
    })}>导出完整体验包</button></div>}
  </details>
}
