import type {ChatVisualIntentV1} from '../../lib/character-interaction/visual-intent'

export default function VisualIntent({value, characters, disabled, onChange}: {
  value?: ChatVisualIntentV1
  characters: Array<{characterKey: string; name: string}>
  disabled: boolean
  onChange: (value: ChatVisualIntentV1 | undefined) => void
}) {
  const current = value ?? {version: 1, characters: [], openingBackground: ''}
  const known = new Set(characters.map(character => character.characterKey))
  const changeCharacter = (characterKey: string, description: string) => {
    const existing = current.characters.find(row => row.characterKey === characterKey)
    onChange({...current, characters: !description.trim() ? current.characters.filter(row => row.characterKey !== characterKey)
      : existing ? current.characters.map(row => row.characterKey === characterKey ? {...row, description} : row)
        : [...current.characters, {characterKey, description}]})
  }
  return <details className="col-span-full space-y-3" aria-label="公开画面描述">
    <summary>公开画面描述（实验草稿）</summary>
    <p>填写你愿意用于玩家画面的外观和背景。后续启用图片制作时，这些描述会发送给所选图片服务；请勿填写人物秘密或未来剧情。</p>
    <p>这里保存画面草稿，不会调用图片服务。可在制作页明确选择图片目标；生成后还需检查原图并确认用途。</p>
    {characters.map(character => <label key={character.characterKey} className="block">{character.name} · 公开外观
      <textarea className="w-full" disabled={disabled} maxLength={4000} aria-label={`${character.name} · 公开外观`}
        placeholder="只描述外貌、服饰和可见特征；留空则不制作此人物图片"
        value={current.characters.find(row => row.characterKey === character.characterKey)?.description ?? ''}
        onChange={event => changeCharacter(character.characterKey, event.target.value)}/>
    </label>)}
    {current.characters.filter(row => !known.has(row.characterKey)).map(row => <div key={row.characterKey} className="rounded border border-warning p-2">
      <p role="status">此人物已不在当前聊天中。描述仍保留，制作前需要重新选择人物或移除。</p>
      <p>{row.description}</p>
      <button type="button" className="lf-action" disabled={disabled} onClick={() => changeCharacter(row.characterKey, '')}>移除旧人物画面描述</button>
    </div>)}
    <label className="block">开场背景
      <textarea className="w-full" disabled={disabled} maxLength={4000} aria-label="开场背景画面描述"
        placeholder="只描述开场地点的可见环境；留空则不制作背景"
        value={current.openingBackground} onChange={event => onChange({...current, openingBackground: event.target.value})}/>
    </label>
    {value && <button type="button" className="lf-action" disabled={disabled} onClick={() => onChange(undefined)}>移除画面草稿</button>}
  </details>
}
