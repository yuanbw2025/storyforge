import {createChatPrivateCharacterV1, type ChatPrivateCharacterV1} from '../../lib/character-interaction/private-character'
import CharacterCardImport from './CharacterCardImport'

const FIELDS = [
  ['name', '姓名', 200], ['identity', '身份', 2000], ['background', '经历与目标', 16000],
  ['personality', '性格与顾虑', 8000], ['voice', '说话方式', 8000],
] as const

export default function PrivateCharacters({value, worldCharacterCount, mode, disabled, onChange}: {
  value: ChatPrivateCharacterV1[]; worldCharacterCount: number; mode: 'single' | 'multi'; disabled: boolean
  onChange: (value: ChatPrivateCharacterV1[]) => void
}) {
  const count = worldCharacterCount + value.length
  const full = count >= (mode === 'single' ? 1 : 8)
  return <section aria-label="本体验新角色" className="col-span-full space-y-4">
    <h4>本体验新角色</h4>
    <p>为这段聊天创建新人物。保存后，逐项确认资料用途和知情范围，再用于制作。</p>
    {value.map((character, index) => <fieldset key={character.characterKey} data-testid="chat-private-character" className="space-y-3 rounded border border-border p-3">
      <legend>新角色 {index + 1}</legend>
      {character.cardOrigin && <details><summary>外部卡片来源 · {character.cardOrigin.fileName}</summary>
        <p>卡片署名：{character.cardOrigin.creator || '未提供'} · 版本：{character.cardOrigin.characterVersion || '未提供'}。这是外部卡片设定，没有世界原作证据；署名不代表使用许可。</p>
        <p className="whitespace-pre-wrap break-words">{character.cardOrigin.creatorNotes}</p>
        <p className="break-all">原文件 SHA-256：{character.cardOrigin.contentHash}</p>
        {!!character.cardOrigin.unsupportedFields.length && <p className="break-words">未转换字段：{character.cardOrigin.unsupportedFields.join('、')}</p>}
      </details>}
      {FIELDS.map(([key, label, maxLength]) => <label key={key} className="block">{label}{(key === 'name' || key === 'identity') && '（必填）'}
        <textarea aria-label={`新角色 ${index + 1} ${label}`} className="w-full" disabled={disabled} maxLength={maxLength}
          required={key === 'name' || key === 'identity'} value={character[key]}
          onChange={event => onChange(value.map(row => row.characterKey === character.characterKey ? {...row, [key]: event.target.value} : row))}/>
      </label>)}
      <button type="button" className="lf-action" disabled={disabled} onClick={() => onChange(value.filter(row => row.characterKey !== character.characterKey))}>移除新角色 {index + 1}</button>
    </fieldset>)}
    <button type="button" className="lf-action" disabled={disabled || full} onClick={() => onChange([...value, createChatPrivateCharacterV1()])}>添加本体验新角色</button>
    <CharacterCardImport disabled={disabled || full} onImport={character => onChange([...value, character])}/>
    {full && <p>{mode === 'single' ? '单角色模式已有参与者。可移除当前参与者，或在体验设定中切换为多角色。' : '世界人物与新角色合计最多 8 人。'}</p>}
  </section>
}
