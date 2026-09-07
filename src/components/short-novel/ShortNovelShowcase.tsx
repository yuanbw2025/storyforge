import { useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight, BookOpenText, Download, X } from 'lucide-react'
import fourAmStory from '../../../showcase/short-novel/four-am-lost-and-found/story.md?raw'
import rainStory from '../../../showcase/short-novel/rain-on-pier-seven/story.md?raw'
import saltStory from '../../../showcase/short-novel/salt-grows-from-memory/story.md?raw'
import tideStory from '../../../showcase/short-novel/tide-radio/story.md?raw'
import './short-novel-showcase.css'

interface ShowcaseStory {
  slug: string
  title: string
  genre: string
  chapters: number
  length: string
  promise: string
  source: string
  accent: string
}

export const SHORT_NOVEL_SHOWCASES: ShowcaseStory[] = [
  {
    slug: 'salt-grows-from-memory',
    title: '盐从记忆里长出来',
    genre: '近未来现实主义 · 家庭伦理',
    chapters: 5,
    length: '5,344 字',
    promise: '当痛苦记忆可以析成盐，一位治疗师必须决定是否替失智的母亲删除亡子留下的创伤。',
    source: saltStory,
    accent: '#b7744e',
  },
  {
    slug: 'rain-on-pier-seven',
    title: '雨落在第七码头',
    genre: '气候科幻 · 社会悬疑',
    chapters: 5,
    length: '5,697 字',
    promise: '城市开始出售晴朗后，被算法视作空地的旧码头必须接住整座城市的雨。',
    source: rainStory,
    accent: '#467d8c',
  },
  {
    slug: 'four-am-lost-and-found',
    title: '凌晨四点的失物招领处',
    genre: '都市奇幻 · 亲情悬疑',
    chapters: 5,
    length: '5,072 字',
    promise: '一张必须在失主意识到丢失以前送达的订单，带一对姐弟完成三次归还与一次告别。',
    source: fourAmStory,
    accent: '#9d6842',
  },
  {
    slug: 'tide-radio',
    title: '潮汐电台',
    genre: '现实主义科幻 · 海岸悬疑',
    chapters: 4,
    length: '5,080 字',
    promise: '失踪十年的妹妹仍在无线电里准确报出实时潮位，姐姐必须在风暴登陆前查明声音的来源。',
    source: tideStory,
    accent: '#48658a',
  },
]

function downloadStory(story: ShowcaseStory): void {
  const url = URL.createObjectURL(new Blob([story.source], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${story.title}.md`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function StoryDocument({ source }: { source: string }) {
  const blocks = useMemo(() => source.trim().split(/\n{2,}/), [source])
  return <div className="short-showcase-document">
    {blocks.map((block, index) => {
      const heading = block.match(/^(#{1,3})\s+(.+)$/s)
      if (heading) {
        const Tag = heading[1].length === 1 ? 'h2' : 'h3'
        return <Tag key={`${index}-${heading[2]}`}>{heading[2]}</Tag>
      }
      return <p key={index}>{block.split('\n').map((line, lineIndex) => <span key={lineIndex}>{line}{lineIndex < block.split('\n').length - 1 && <br />}</span>)}</p>
    })}
  </div>
}

export default function ShortNovelShowcase() {
  const [selected, setSelected] = useState<ShowcaseStory | null>(null)

  return <section className="short-showcase" data-testid="short-novel-showcase" aria-labelledby="short-showcase-title">
    <header className="short-showcase-heading">
      <div><span>COMMUNITY SELECTION</span><h2 id="short-showcase-title">从完整成品开始感受短篇能力</h2></div>
      <p>四种题材、四套叙事机制。每篇都经过分章生产、全篇审校和冻结发布，不是提示词片段。</p>
    </header>
    <div className="short-showcase-grid">
      {SHORT_NOVEL_SHOWCASES.map((story, index) => <article
        className="short-showcase-card"
        key={story.slug}
        style={{ '--showcase-accent': story.accent } as CSSProperties}
      >
        <div className="short-showcase-cover" aria-hidden="true"><span>{String(index + 1).padStart(2, '0')}</span><BookOpenText /><strong>{story.title}</strong></div>
        <div className="short-showcase-copy"><span>{story.genre}</span><h3>{story.title}</h3><p>{story.promise}</p><small>{story.chapters} 章 · {story.length} · 完整终稿</small></div>
        <button type="button" onClick={() => setSelected(story)} aria-label={`阅读完整样例《${story.title}》`}>阅读完整样例<ArrowRight /></button>
      </article>)}
    </div>
    {selected && <div className="short-showcase-modal" role="dialog" aria-modal="true" aria-labelledby="short-showcase-reader-title" onMouseDown={event => { if (event.currentTarget === event.target) setSelected(null) }}>
      <article>
        <header><div><span>{selected.genre}</span><h2 id="short-showcase-reader-title">《{selected.title}》</h2><small>{selected.chapters} 章 · {selected.length}</small></div><div><button type="button" onClick={() => downloadStory(selected)}><Download />下载 Markdown</button><button type="button" className="icon" aria-label="关闭阅读器" onClick={() => setSelected(null)}><X /></button></div></header>
        <StoryDocument source={selected.source} />
      </article>
    </div>}
  </section>
}
