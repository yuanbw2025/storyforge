import BrandIcon from '../shared/BrandIcon'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Menu } from 'lucide-react'
import { PRODUCT_NAVIGATION } from './product-navigation'
import '../longform/longform.css'
import './product-frame.css'

/** Shared application frame for cross-product tools and development-only players. */
export default function ProductFrame({ product, title, page, navigation, productPath, navigationLabel, className = '', children }: {
  product: string; title: string; page: string;
  navigation: readonly { label: string; path: string; active?: boolean }[];
  productPath?: string; navigationLabel?: string; className?: string;
  children: ReactNode;
}) {
  const [menu, setMenu] = useState(false)
  return <div className={`longform-app product-frame ${className} ${menu ? 'product-frame-menu-open' : ''}`}>
    <header className="lf-top"><Link className="lf-brand" to="/" aria-label="返回首页"><BrandIcon/><span><strong>StoryForge</strong><small>故事熔炉</small></span></Link><nav aria-label="产品导航">{PRODUCT_NAVIGATION.map(item => <Link key={item.id} to={item.id === product && productPath ? productPath : item.path} aria-current={item.id === product ? 'page' : undefined}>{item.label}</Link>)}</nav></header>
    <aside className="lf-sidebar"><small>STORYFORGE</small><h1>{title}</h1><nav aria-label={navigationLabel ?? `${title}导航`}>{navigation.map(item => <Link key={item.path} to={item.path} aria-current={item.active ? 'page' : undefined} onClick={() => setMenu(false)}>{item.label}</Link>)}</nav></aside>
    <main className="lf-main"><header className="lf-heading"><button className="product-frame-menu lf-action" aria-expanded={menu} onClick={() => setMenu(!menu)}><Menu size={18}/>页面目录</button><small>{title} › {page}</small><h2>{page}</h2></header><div className="product-frame-content">{children}</div></main>
  </div>
}
