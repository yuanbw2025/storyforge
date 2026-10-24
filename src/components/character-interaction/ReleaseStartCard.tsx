import {useState} from 'react'
import {Plus} from 'lucide-react'
import type {CharacterInteractionLibraryItem} from '../../stores/character-interaction-player'
import {chatReleasePreviewV1} from '../../lib/character-interaction/release-preview'
import ExperienceInfo from './ExperienceInfo'
import {chatNextActionLimitV1} from '../../lib/character-interaction/narrative-pacing'

export default function ReleaseStartCard({item, disabled, onStart}: {
  item: CharacterInteractionLibraryItem; disabled: boolean
  onStart: (sceneKey: string, participantKey?: string) => void
}) {
  const preview = item.manifest && !item.error ? chatReleasePreviewV1(item.manifest) : null
  const [sceneKey, setSceneKey] = useState(preview?.scenes[0]?.sceneKey ?? '')
  const [actor, setActor] = useState(preview?.canStartAction && preview.scenes[0]?.participants.length === 1 ? preview.scenes[0].participants[0].participantKey : '')
  const scene = preview?.scenes.find(s => s.sceneKey === sceneKey)
  return <article className="rounded border border-border bg-bg-base p-3" aria-label={`${preview?.title ?? item.release.label} · 版本 ${item.release.version}`}>
    <strong className="block text-sm">{preview?.title ?? item.release.label}</strong>
    <span className="mt-1 block text-xs text-text-muted">版本 {item.release.version}</span>
    {item.error && <p className="mt-2 text-xs text-danger">{item.error}</p>}
    {preview && <div className="mt-3 space-y-3 text-sm">
      <p className="whitespace-pre-wrap break-words">{preview.description}</p>
      <ExperienceInfo value={item.manifest?.interaction.chatExperienceInfo}/>
      {item.manifest?.interaction?.chatCardCredits && <details><summary>外部角色卡来源与署名</summary>
        <p className="my-2">以下人物改编自外部卡片，不是世界原作人物。署名仅记录卡片声明，不代表使用或再分发许可。</p>
        {item.manifest.interaction.chatCardCredits.characters.map(credit => <div key={credit.participantKey} className="my-2 break-words">
          <strong>{item.manifest!.interaction.profiles.find(profile => profile.participantKey === credit.participantKey)?.name}</strong>
          <p>卡片署名：{credit.creator || '未提供'} · 卡片版本：{credit.characterVersion || '未提供'}</p>
          <p className="break-all text-xs">原卡 SHA-256：{credit.cardContentHash}</p>
        </div>)}
      </details>}
      {preview.persona && <p className="whitespace-pre-wrap break-words">你将扮演 {preview.persona.name}：{preview.persona.description}</p>}
      {preview.scenes.length > 1 && <label className="block">选择开场<select aria-label="选择开场" className="ml-2 max-w-full rounded border border-border bg-bg-surface p-2" value={sceneKey} disabled={disabled} onChange={e => {
        setSceneKey(e.target.value)
        const next = preview.scenes.find(s => s.sceneKey === e.target.value)
        setActor(preview.canStartAction && next?.participants.length === 1 ? next.participants[0].participantKey : '')
      }}>{preview.scenes.map(s => <option key={s.sceneKey} value={s.sceneKey}>{s.title}</option>)}</select></label>}
      {scene && <><p>开场：{scene.title} · {scene.location} · {scene.timeLabel}</p>
        <p>在场人物：{scene.participants.map(p => `${p.name}（${p.roleLabel}）`).join('、')}</p>
        {scene.facts.length > 0 && <details><summary className="cursor-pointer">你已知道的开场背景</summary><ul className="mt-2 list-disc space-y-1 pl-5">{scene.facts.map((text, i) => <li key={i} className="whitespace-pre-wrap break-words">{text}</li>)}</ul></details>}
        {preview.canStartAction && scene.participants.length > 1 && <label className="block">谁先行动<select aria-label="开场行动角色" disabled={disabled} className="ml-2 max-w-full rounded border border-border bg-bg-surface p-2" value={actor} onChange={e => setActor(e.target.value)}><option value="">开始后再决定</option>{scene.participants.map(p => <option key={p.participantKey} value={p.participantKey}>{p.name}</option>)}</select></label>}
      </>}
      {!scene && <p role="alert">这个版本没有可用的开场。</p>}
      {preview.canStartAction && actor && <p className="text-xs text-text-muted">新建后角色最多连续行动 {chatNextActionLimitV1(item.manifest?.interaction.chatNarrative?.permissions)} 步；需要你决定时会停下，也可以随时打断。</p>}
    </div>}
    <button disabled={disabled || !scene} onClick={() => scene && onStart(scene.sceneKey, preview?.canStartAction && scene.participants.some(p => p.participantKey === actor) ? actor : undefined)} className="mt-3 flex w-full items-center justify-center gap-1 rounded bg-accent px-3 py-2 text-sm text-white disabled:opacity-40"><Plus className="h-4 w-4" />新建会话</button>
  </article>
}
