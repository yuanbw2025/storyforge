import { useState, useSyncExternalStore } from 'react'
import { Check } from 'lucide-react'
import { applyStoryForgeTheme, getStoryForgeTheme, subscribeStoryForgeTheme, THEME_OPTIONS } from '../../lib/theme'
import './theme-selector.css'

export default function ThemeSelector() {
  const current = useSyncExternalStore(subscribeStoryForgeTheme, getStoryForgeTheme)
  const [group, setGroup] = useState('全部')
  const themes = THEME_OPTIONS.filter(theme => group === '全部' || theme.group === group)
  return <section className="theme-selector" aria-labelledby="theme-selector-heading">
    <div className="theme-toolbar">
      <h3 id="theme-selector-heading">主题外观</h3>
      <p className="theme-hint">切换即生效，并记住这台设备上的选择。正文保持清晰的纸面背景。</p>
      <select className="theme-filter" value={group} onChange={event => setGroup(event.target.value)} aria-label="主题分类">{['全部', '浅色', '深色', '混合'].map(value => <option key={value}>{value}</option>)}</select>
      <span className="theme-count">共 {THEME_OPTIONS.length} 套</span>
    </div>
    <div className="theme-options" role="group" aria-label="主题皮肤">
      {themes.map(theme => <button key={theme.id} type="button" className="theme-option"
        aria-label={theme.name} aria-pressed={current === theme.id}
        onClick={() => applyStoryForgeTheme(theme.id)}>
        <span className="theme-sample" data-theme-swatch={theme.id} aria-hidden="true">
          <span className="theme-sample-nav"><i /><i /><i /></span>
          <span className="theme-sample-paper"><b>山水之间，故事生长。</b><i /><i /><i /><em /></span>
        </span>
        <span className="theme-option-title">{theme.name}{current === theme.id && <Check size={16} aria-hidden="true" />}</span>
        <span className="theme-option-description" title={theme.description}>{theme.description}</span>
      </button>)}
    </div>
    <p className="theme-current" role="status">当前主题：{THEME_OPTIONS.find(theme => theme.id === current)?.name}</p>
  </section>
}
