import { canonicalAuthoringFeatureModule } from '../../lib/workspace/feature-entry-registry'
import BrandIcon from '../shared/BrandIcon'
import { Link } from 'react-router'
import { useState, type ReactNode } from 'react'
import { BookOpen } from 'lucide-react'
import { LONGFORM_SECTIONS, LONGFORM_STEPS, type LongformSection, type LongformMode } from './navigation'
import type { SidebarModule } from '../layout/sidebar-tree'
import { PRODUCT_NAVIGATION } from '../navigation/product-navigation'
import { evaluateCurrentProductEntryV1 } from '../../lib/product/product-catalog'
import './longform.css'

export default function LongformLayout({ children, title, section, mode = 'steps', module = 'info', hiddenModules, onSection, onMode, onModule, onHome, onNavigate }: {
  children: ReactNode; title?: string; section: LongformSection; mode?: LongformMode; module?: SidebarModule;
  hiddenModules?: Set<SidebarModule>; onSection: (section: LongformSection) => void;
  onMode?: (mode: LongformMode) => void; onModule?: (module: SidebarModule) => void; onHome: () => void; onNavigate?: (path: string) => void;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [stepsOpen, setStepsOpen] = useState(false)
  const nodeEntry = evaluateCurrentProductEntryV1('authoring.nodes')
  const selectSection = (next: LongformSection) => { setNavigationOpen(false); setStepsOpen(false); onSection(next) }
  const selectModule = (next: SidebarModule) => { setStepsOpen(false); onModule?.(next) }
  const current = LONGFORM_STEPS.find(step => step.modules.some(([id]) => id === canonicalAuthoringFeatureModule(module)))
  return <div className={`longform-app ${navigationOpen ? 'lf-navigation-open' : ''} ${stepsOpen ? 'lf-step-menu-open' : ''}`}>
    <header className="lf-top"><button className="lf-brand" aria-label="返回首页" onClick={onHome}><BrandIcon/><span><strong>StoryForge</strong><small>故事熔炉</small></span></button><nav aria-label="产品导航">{PRODUCT_NAVIGATION.map(item => <Link key={item.id} to={item.path} aria-current={item.id === 'long' ? 'page' : undefined} onClick={event => {
      if (item.id === 'home') { event.preventDefault(); onHome() }
      else if (item.id === 'long') { event.preventDefault(); selectSection('library') }
      else if (onNavigate) { event.preventDefault(); onNavigate(item.path) }
    }}>{item.label}</Link>)}</nav></header>
    <aside className="lf-sidebar"><small>LONGFORM FICTION</small><h1>长篇创作</h1><p>在长久的叙述里，发现人物的命运。</p>{title && <button className="lf-current" title={title} onClick={() => selectSection('library')}><BookOpen/><span>{title}</span></button>}<nav aria-label="长篇一级导航">{LONGFORM_SECTIONS.map(([id, label]) => <button key={id} aria-current={id === section ? 'page' : undefined} onClick={() => selectSection(id)}>{label}</button>)}</nav></aside>
    <section className="lf-main"><header className="lf-heading"><small>长篇创作 › {LONGFORM_SECTIONS.find(([id]) => id === section)?.[1]}</small><h2>{LONGFORM_SECTIONS.find(([id]) => id === section)?.[1]}</h2>{section === 'workbench' && <nav className="lf-modes" aria-label="工作台创作方式">{([['steps', '分步骤模式'], ['nodes', '节点创作'], ['agent', 'Agent']] as const).filter(([id]) => id !== 'nodes' || nodeEntry.visible).map(([id, label]) => <button key={id} aria-current={id === mode ? 'page' : undefined} onClick={() => onMode?.(id)}>{label}</button>)}</nav>}<div className="lf-mobile-controls"><button type="button" aria-expanded={navigationOpen} onClick={() => { setNavigationOpen(value => !value); setStepsOpen(false) }}>长篇导航</button>{section === 'workbench' && mode === 'steps' && <button type="button" aria-expanded={stepsOpen} onClick={() => { setStepsOpen(value => !value); setNavigationOpen(false) }}>分步骤目录</button>}</div></header>
      <div className={`lf-body ${section === 'workbench' && mode === 'steps' ? 'lf-with-steps' : ''}`}>
        {section === 'workbench' && mode === 'steps' && <nav className="lf-steps" aria-label="长篇工作台二级导航">{[false, true].map(aux => <section key={String(aux)}><h3>{aux ? '写作辅助' : '分步骤创作'}</h3>{LONGFORM_STEPS.filter(step => !!step.auxiliary === aux).map(step => <div key={step.label}><button aria-current={step === current ? 'page' : undefined} onClick={() => selectModule(step.modules[0][0])}>{step.label}</button>{step === current && step.modules.length > 1 && <nav aria-label={`${step.label}三级导航`}>{step.modules.filter(([id]) => !hiddenModules?.has(id)).map(([id, label]) => <button key={id} aria-current={id === module ? 'page' : undefined} onClick={() => selectModule(id)}>{label}</button>)}</nav>}</div>)}</section>)}</nav>}
        <div className="lf-content">{children}</div>
      </div>
    </section>
  </div>
}
