import type {ChatExperienceInfoV1} from '../../lib/character-interaction/experience-info'
import {CHAT_EXPERIENCE_INFO_LIMITS} from '../../lib/character-interaction/experience-info'

export function ExperienceInfoForm({value, disabled, onChange}: {
  value?: ChatExperienceInfoV1; disabled: boolean
  onChange: (value: ChatExperienceInfoV1 | undefined) => void
}) {
  return <section aria-label="作品署名与使用说明" className="space-y-3">
    <label><input type="checkbox" checked={value !== undefined} disabled={disabled} onChange={event => onChange(event.target.checked
      ? {version: 1, author: '', attribution: '', usageTerms: ''} : undefined)}/>随体验包提供作品署名与使用说明</label>
    <p>这些文字会在发布版本中向玩家公开，并随体验包与备份保存。未填写不代表授予任何使用或再分发许可。</p>
    {value && <>
      <label className="block">作品署名<textarea aria-label="作品署名" disabled={disabled} maxLength={CHAT_EXPERIENCE_INFO_LIMITS.author}
        value={value.author} onChange={event => onChange({...value, author: event.target.value})}/></label>
      <label className="block">素材归属与致谢（可选）<textarea aria-label="素材归属与致谢" disabled={disabled} maxLength={CHAT_EXPERIENCE_INFO_LIMITS.attribution}
        value={value.attribution} onChange={event => onChange({...value, attribution: event.target.value})}/></label>
      <label className="block">使用说明<textarea aria-label="作品使用说明" disabled={disabled} maxLength={CHAT_EXPERIENCE_INFO_LIMITS.usageTerms}
        value={value.usageTerms} onChange={event => onChange({...value, usageTerms: event.target.value})}/></label>
      <p>填写适用的许可或使用限制及来源；此声明不替代图片、外部角色卡或其他第三方材料本身的许可。填写署名和使用说明后保存方案。</p>
    </>}
  </section>
}

export default function ExperienceInfo({value}: {value?: ChatExperienceInfoV1 | null}) {
  return <details className="space-y-2 break-words" aria-label="作者与使用说明">
    <summary>作者与使用说明</summary>
    {value ? <>
      <p className="whitespace-pre-wrap">作品署名：{value.author}</p>
      {value.attribution && <p className="whitespace-pre-wrap">素材归属与致谢：{value.attribution}</p>}
      <p className="whitespace-pre-wrap">使用说明：{value.usageTerms}</p>
      <p>以上是文件提供者的声明，完整性校验不证明作者身份或权利归属，也不由平台额外授予许可。</p>
    </> : <p>本版本未提供作品署名与使用说明；这不表示允许再分发或改编。请向文件提供者核对。</p>}
  </details>
}
