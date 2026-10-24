import {useEffect, useRef, useState} from 'react'
import {CHAT_CARD_FILE_LIMIT, confirmChatCharacterCardPreviewV1, previewChatCharacterCardV2, type ChatCharacterCardPreviewV1} from '../../lib/character-interaction/character-card'
import type {ChatPrivateCharacterV1} from '../../lib/character-interaction/private-character'

export default function CharacterCardImport({disabled, onImport}: {disabled: boolean; onImport: (character: ChatPrivateCharacterV1) => void}) {
  const [preview, setPreview] = useState<ChatCharacterCardPreviewV1 | null>(null), [identity, setIdentity] = useState('')
  const [error, setError] = useState(''), [reading, setReading] = useState(false)
  const generation = useRef(0), confirmed = useRef(false)
  useEffect(() => () => {generation.current++}, [])
  const read = async (file: File | undefined) => {
    const id = ++generation.current
    setPreview(null); setIdentity(''); setError(''); confirmed.current = false
    if (!file) {setReading(false); return}
    setReading(true)
    try {
      if (file.size > CHAT_CARD_FILE_LIMIT) throw new Error('角色卡文件不能超过 16 MiB')
      const next = await previewChatCharacterCardV2({bytes: await file.arrayBuffer(), fileName: file.name})
      if (id === generation.current) setPreview(next)
    } catch (cause) {if (id === generation.current) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {if (id === generation.current) setReading(false)}
  }
  return <details className="rounded border border-border p-3" aria-label="外部角色卡转换">
    <summary>从 Character Card V2 转换角色草稿</summary>
    <p className="my-3">选择本地 V2 JSON 或 PNG，先核对字段，再加入本体验。原文件不会修改；这不是世界原作的证据。PNG 图片不会同时导入为立绘。</p>
    <label>角色卡文件<input type="file" accept=".json,.png,application/json,image/png" disabled={disabled || reading} onChange={event => {const file = event.target.files?.[0]; event.target.value = ''; void read(file)}}/></label>
    {reading && <p role="status">正在本地读取角色卡…</p>}
    {error && <p role="alert">{error}</p>}
    {preview && <div className="mt-3 space-y-3" data-testid="chat-card-preview">
      <h4>{preview.name} · 外部卡片设定</h4>
      <p>卡片署名：{preview.origin.creator || '未提供'} · 卡片版本：{preview.origin.characterVersion || '未提供'}</p>
      <p>署名不代表已取得使用或再分发许可，请保留原文件及许可说明。</p>
      {preview.origin.creatorNotes && <details><summary>原卡作者说明（仅供作者查看）</summary><p className="whitespace-pre-wrap break-words">{preview.origin.creatorNotes}</p></details>}
      <dl className="space-y-3">{[
        ['姓名 → 姓名', preview.name], ['description → 经历与目标', preview.background],
        ['personality → 性格与顾虑', preview.personality], ['mes_example → 说话方式参考', preview.voice],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-border p-2">{value || '空'}</dd></div>)}</dl>
      {preview.scenario && <details><summary>原卡场景（未转换）</summary><p className="whitespace-pre-wrap break-words">{preview.scenario}</p></details>}
      <p>系统提示词、历史追加指令、世界书、扩展、开场台词及宏不会自动执行或写入聊天。</p>
      {!!preview.origin.unsupportedFields.length && <p className="break-words">未转换字段：{preview.origin.unsupportedFields.join('、')}。这些内容不会随角色草稿保存，请保留原卡。</p>}
      <label className="block">本体验中的人物身份（必填）<textarea aria-label="导入角色的身份" maxLength={2000} value={identity} disabled={disabled} onChange={event => setIdentity(event.target.value)}/></label>
      <p className="break-all text-xs">原文件 SHA-256：{preview.origin.contentHash}</p>
      <button className="lf-action" type="button" disabled={disabled || reading || !identity.trim()} onClick={() => {
        if (disabled || confirmed.current || !identity.trim()) return
        try {
          const character = confirmChatCharacterCardPreviewV1(preview, identity)
          confirmed.current = true; onImport(character); setPreview(null); setIdentity('')
        } catch (cause) {setError(cause instanceof Error ? cause.message : String(cause))}
      }}>确认映射并加入角色草稿</button>
      <button className="lf-action" type="button" onClick={() => {generation.current++; setPreview(null); setIdentity(''); setError('')}}>取消转换</button>
      <p>加入后仍需保存方案、确认资料用途与知情范围；正式制作还需要选定冻结世界并明确开始。</p>
    </div>}
  </details>
}
