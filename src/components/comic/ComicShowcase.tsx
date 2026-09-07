import { useState, type CSSProperties } from 'react'
import { ArrowUpRight, Images, X } from 'lucide-react'
import rainPreview from '../../../showcase/comic/before-rain-stops/art/final/community-preview-ui.jpg'
import flamePreview from '../../../showcase/comic/borrowed-flame/art/final/community-preview-ui.jpg'
import gunPreview from '../../../showcase/comic/before-the-gun/art/final/community-preview-ui.jpg'
import moonPreview from '../../../showcase/comic/moon-buys-bread/art/final/community-preview-ui.jpg'
import './comic-showcase.css'

interface ShowcaseComic {
  slug: string
  title: string
  genre: string
  scale: string
  artDirection: string
  promise: string
  preview: string
  accent: string
}

export const COMIC_SHOWCASES: ShowcaseComic[] = [
  {
    slug: 'before-rain-stops',
    title: '雨停之前',
    genre: '近未来都市科幻',
    scale: '1 话 · 6 页 · 23 格',
    artDirection: '冷蓝雨城 / 暖金天光',
    promise: '下了十七年雨的城市里，一名夜班信使和男孩要决定是否把被隐藏的晴天还给所有人。',
    preview: rainPreview,
    accent: '#c68b3d',
  },
  {
    slug: 'borrowed-flame',
    title: '借火',
    genre: '城市民俗 · 手艺传承',
    scale: '1 话 · 5 页 · 20 格',
    artDirection: '砖红旧巷 / 炉火暖橙',
    promise: '老街最后一夜，年轻学徒必须从即将拆除的灶里借走一簇火，也把告别交还给街坊。',
    preview: flamePreview,
    accent: '#ba633e',
  },
  {
    slug: 'before-the-gun',
    title: '枪响以前',
    genre: '运动现实主义',
    scale: '1 话 · 5 页 · 21 格',
    artDirection: '黑白干刷 / 朱红信号',
    promise: '聋人短跑选手的起跑灯失灵，隔道对手叫停发令，六个人重新排出一条公平的起跑线。',
    preview: gunPreview,
    accent: '#b53c32',
  },
  {
    slug: 'moon-buys-bread',
    title: '凌晨四点，月亮来买面包',
    genre: '都市奇幻 · 夜班童话',
    scale: '1 话 · 5 页 · 21 格',
    artDirection: '深靛夜色 / 黄油金光',
    promise: '打烊前，面包师接到坠落的月亮；她们骑车穿过夜城，向每一个还醒着的人借光。',
    preview: moonPreview,
    accent: '#d39b44',
  },
]

export default function ComicShowcase() {
  const [selected, setSelected] = useState<ShowcaseComic | null>(null)

  return <section className="comic-showcase" data-testid="comic-showcase" aria-labelledby="comic-showcase-title">
    <header className="comic-showcase-heading">
      <div><span>COMIC RELEASE GALLERY</span><h2 id="comic-showcase-title">连续成页，才是真正的小说转漫画</h2></div>
      <p>四套完整改编覆盖不同题材与画风。统一视觉圣经、连续页面、确定性中文排字，并交付 PDF 与 CBZ。</p>
    </header>
    <div className="comic-showcase-grid">
      {COMIC_SHOWCASES.map((comic, index) => <article
        className="comic-showcase-card"
        key={comic.slug}
        style={{ '--comic-accent': comic.accent } as CSSProperties}
      >
        <button className="comic-showcase-poster" type="button" onClick={() => setSelected(comic)} aria-label={`放大查看漫画《${comic.title}》`}>
          <img src={comic.preview} alt={`${comic.title}封面与连续漫画页`} loading="lazy" decoding="async" />
          <span>{String(index + 1).padStart(2, '0')}</span>
          <i><Images />完整成品</i>
        </button>
        <div className="comic-showcase-copy">
          <span>{comic.genre}</span><h3>{comic.title}</h3><p>{comic.promise}</p>
          <small>{comic.scale}<b />{comic.artDirection}</small>
          <button type="button" onClick={() => setSelected(comic)} aria-label={`查看完整漫画《${comic.title}》`}>查看完整成品<ArrowUpRight /></button>
        </div>
      </article>)}
    </div>
    {selected && <div className="comic-showcase-modal" role="dialog" aria-modal="true" aria-labelledby="comic-reader-title" onMouseDown={event => { if (event.currentTarget === event.target) setSelected(null) }}>
      <article>
        <header><div><span>{selected.genre} · {selected.artDirection}</span><h2 id="comic-reader-title">《{selected.title}》</h2><small>{selected.scale} · 完整发布</small></div><button type="button" aria-label="关闭漫画预览" onClick={() => setSelected(null)}><X /></button></header>
        <div className="comic-showcase-reader"><img src={selected.preview} alt={`${selected.title}完整社区展示图`} /></div>
      </article>
    </div>}
  </section>
}
