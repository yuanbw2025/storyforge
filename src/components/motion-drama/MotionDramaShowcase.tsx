import { useState } from 'react'
import { ArrowUpRight, Clapperboard, Download, PackageCheck, Volume2, X } from 'lucide-react'
import executionPack from '../../../showcase/motion-drama/last-train-echo/seedance-execution-pack.md?raw'
import './motion-drama-showcase.css'

export const MOTION_DRAMA_SHOWCASE = {
  slug: 'last-train-echo',
  title: '末班车回声',
  genre: '都市悬疑 · 竖屏二维漫剧',
  scale: 'EP01 先导段 · 20 秒 · 2 镜',
  promise: '检票员从废弃车票里听见亡妹未说完的告别，而封闭三年的站台正在迎来一列不存在的末班车。',
  pack: executionPack,
} as const

function downloadPack(): void {
  const url = URL.createObjectURL(new Blob([MOTION_DRAMA_SHOWCASE.pack], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${MOTION_DRAMA_SHOWCASE.title}-Seedance逐镜执行包.md`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export default function MotionDramaShowcase() {
  const [open, setOpen] = useState(false)

  return <section className="motion-showcase" data-testid="motion-drama-showcase" aria-labelledby="motion-showcase-title">
    <header className="motion-showcase-heading">
      <div><span>PRODUCED & VERIFIED IN STORYFORGE</span><h2 id="motion-showcase-title">看到的不是一句提示词，而是一套可执行的逐镜生产包</h2></div>
      <p>原创验收样例《末班车回声》完整保留故事承诺、物料、漫剧剧本、镜间交接、Seedance 时间轴、选片标准与定点返修。</p>
    </header>

    <article className="motion-showcase-feature">
      <div className="motion-showcase-board" aria-label="末班车回声三格分镜预览">
        <div className="ticket"><span>SHOT 01 · 0.0s</span><i /><b>旧票上的名字浮现</b></div>
        <div className="punch"><span>SHOT 01 · 7.5s</span><i /><b>检票钳自行咬合</b></div>
        <div className="train"><span>SHOT 02 · 10.0s</span><i /><b>封闭站台迎来列车</b></div>
      </div>
      <div className="motion-showcase-copy">
        <span>{MOTION_DRAMA_SHOWCASE.genre}</span>
        <h3>《{MOTION_DRAMA_SHOWCASE.title}》</h3>
        <p>{MOTION_DRAMA_SHOWCASE.promise}</p>
        <small>{MOTION_DRAMA_SHOWCASE.scale}<b />Seedance 2.5 执行格式</small>
        <div className="motion-showcase-pipeline" aria-label="样例交付内容">
          <div><Clapperboard /><span><strong>漫剧剧本</strong><em>动作、对白、声音与尾钩</em></span></div>
          <div><PackageCheck /><span><strong>逐镜执行</strong><em>槽位、时间轴与镜间交接</em></span></div>
          <div><Volume2 /><span><strong>音画物料</strong><em>角色音色与音效精确绑定</em></span></div>
        </div>
        <button type="button" onClick={() => setOpen(true)} aria-label="查看《末班车回声》完整漫剧执行包">查看完整生产包<ArrowUpRight /></button>
      </div>
    </article>

    <p className="motion-showcase-boundary">展示的是经过结构与浏览器闭环验证的前期生产成果，不是伪造的视频成片；真实参考素材就绪后，可在工具适配页编译为逐镜可复制执行包。</p>

    {open && <div className="motion-showcase-modal" role="dialog" aria-modal="true" aria-labelledby="motion-showcase-reader-title" onMouseDown={event => { if (event.currentTarget === event.target) setOpen(false) }}>
      <article>
        <header><div><span>{MOTION_DRAMA_SHOWCASE.genre}</span><h2 id="motion-showcase-reader-title">《{MOTION_DRAMA_SHOWCASE.title}》生产执行包</h2><small>{MOTION_DRAMA_SHOWCASE.scale} · 原创验收样例</small></div><div><button type="button" onClick={downloadPack}><Download />下载 Markdown</button><button type="button" className="icon" aria-label="关闭漫剧执行包" onClick={() => setOpen(false)}><X /></button></div></header>
        <pre>{MOTION_DRAMA_SHOWCASE.pack}</pre>
      </article>
    </div>}
  </section>
}
