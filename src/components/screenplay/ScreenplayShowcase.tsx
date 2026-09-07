import { useState, type CSSProperties } from 'react'
import { ArrowRight, Clapperboard, Download, X } from 'lucide-react'
import nightPreview from '../../../showcase/screenplay/night-last-stop/screenplay-studio-final.png'
import nightFountain from '../../../showcase/screenplay/night-last-stop/night-last-stop-final.fountain?raw'
import refundPreview from '../../../showcase/screenplay/seven-minute-refund/website-preview.png'
import refundFountain from '../../../showcase/screenplay/seven-minute-refund/seven-minute-refund-final.fountain?raw'
import murderPreview from '../../../showcase/screenplay/one-tael-murder/website-preview.png'
import murderFountain from '../../../showcase/screenplay/one-tael-murder/one-tael-murder-final.fountain?raw'
import tablePreview from '../../../showcase/screenplay/table-zero/website-preview.png'
import tableFountain from '../../../showcase/screenplay/table-zero/table-zero-final.fountain?raw'
import './screenplay-showcase.css'

interface ShowcaseScreenplay {
  slug: string
  title: string
  genre: string
  format: string
  scale: string
  promise: string
  preview: string
  fountain: string
  accent: string
}

export const SCREENPLAY_SHOWCASES: ShowcaseScreenplay[] = [
  {
    slug: 'night-last-stop',
    title: '夜班末站',
    genre: '现实主义都市悬疑',
    format: '25 分钟单集 / 短片',
    scale: '8 场 · 373 行 Fountain',
    promise: '末班车调度员接到死者来电，必须在全线断电前证明电话来自十年前，而不是今晚。',
    preview: nightPreview,
    fountain: nightFountain,
    accent: '#536d7a',
  },
  {
    slug: 'seven-minute-refund',
    title: '七分钟退款',
    genre: '都市科技悬疑',
    format: '8 集竖屏短剧',
    scale: '前钩子 + 集尾反转',
    promise: '退款审核员收到失踪弟弟发来的工单，附件显示同事将在七分钟后死亡。',
    preview: refundPreview,
    fountain: refundFountain,
    accent: '#9b523c',
  },
  {
    slug: 'one-tael-murder',
    title: '一两银子的谋杀',
    genre: '古装悬疑轻喜',
    format: '6 集连续短剧',
    scale: '低成本实拍 · 完整闭环',
    promise: '掌柜从迎亲账里多出的一两银子，追到一桩假婚和十二名失踪女子的共同账本。',
    preview: murderPreview,
    fountain: murderFountain,
    accent: '#987137',
  },
  {
    slug: 'table-zero',
    title: '婚礼第零桌',
    genre: '现代群像喜剧',
    format: '15 分钟短片',
    scale: '12 场 · 群像对白',
    promise: '五名临时亲友的角色卡误上婚礼大屏，所有人必须当众决定还要不要继续扮演。',
    preview: tablePreview,
    fountain: tableFountain,
    accent: '#a6615b',
  },
]

function downloadFountain(screenplay: ShowcaseScreenplay): void {
  const url = URL.createObjectURL(new Blob([screenplay.fountain], { type: 'text/plain;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${screenplay.title}.fountain`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export default function ScreenplayShowcase() {
  const [selected, setSelected] = useState<ShowcaseScreenplay | null>(null)

  return <section className="screenplay-showcase" data-testid="screenplay-showcase" aria-labelledby="screenplay-showcase-title">
    <header className="screenplay-showcase-heading">
      <div><span>PRODUCED IN STORYFORGE</span><h2 id="screenplay-showcase-title">从小说素材，到可以交付的剧本</h2></div>
      <p>电影式短片、竖屏连载、古装短剧与群像喜剧。每套样片都有来源小说、专业 Fountain / FDX 和审查证据。</p>
    </header>
    <div className="screenplay-showcase-grid">
      {SCREENPLAY_SHOWCASES.map((screenplay, index) => <article
        className="screenplay-showcase-card"
        key={screenplay.slug}
        style={{ '--screenplay-accent': screenplay.accent } as CSSProperties}
      >
        <div className="screenplay-showcase-visual">
          <img src={screenplay.preview} alt={`${screenplay.title}剧本样片预览`} />
          <span>{String(index + 1).padStart(2, '0')} / 04</span>
        </div>
        <div className="screenplay-showcase-copy">
          <span>{screenplay.genre}</span>
          <h3>{screenplay.title}</h3>
          <p>{screenplay.promise}</p>
          <small>{screenplay.format}<b />{screenplay.scale}</small>
        </div>
        <button type="button" onClick={() => setSelected(screenplay)} aria-label={`查看专业剧本《${screenplay.title}》`}>查看剧本成品<ArrowRight /></button>
      </article>)}
    </div>
    {selected && <div className="screenplay-showcase-modal" role="dialog" aria-modal="true" aria-labelledby="screenplay-reader-title" onMouseDown={event => { if (event.currentTarget === event.target) setSelected(null) }}>
      <article>
        <header>
          <div><span>{selected.genre} · {selected.format}</span><h2 id="screenplay-reader-title">《{selected.title}》</h2><small>{selected.scale}</small></div>
          <div><button type="button" onClick={() => downloadFountain(selected)}><Download />下载 Fountain</button><button type="button" className="icon" aria-label="关闭剧本预览" onClick={() => setSelected(null)}><X /></button></div>
        </header>
        <div className="screenplay-showcase-reader">
          <figure><img src={selected.preview} alt={`${selected.title}产品界面预览`} /><figcaption><Clapperboard />StoryForge 正式生产样片</figcaption></figure>
          <pre>{selected.fountain}</pre>
        </div>
      </article>
    </div>}
  </section>
}
