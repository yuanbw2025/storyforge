import type { ReactNode } from 'react'
import { workLabel, workPath, type HomeWork } from '../../lib/home/catalog'
import type { HomeOpen } from './HomeTools'
import type { HomeData } from './useHomeData'

const PRODUCT_LABELS: Record<string, string> = {
  ttrpg: '跑团',
  'character-interaction': '角色聊天',
  'ai-town': 'AI 小镇',
  avg: 'AVG',
  'text-adventure': '文字冒险',
  'open-world': '文字开放世界',
}

const PRODUCT_RESULT_ROUTES = new Map<HomeData['products'][number]['productType'], string>([
  ['ttrpg', 'ttrpg/release'],
  ['character-interaction', 'chat/release'],
  ['ai-town', 'town/release'],
  ['avg', 'avg/release'],
  ['text-open-world', 'openworld/runtime'],
])

export function HomeResults({ data, open, renderWorkCard }: {
  data: Pick<HomeData, 'releases' | 'products' | 'rows' | 'works'>
  open: HomeOpen
  renderWorkCard: (row: HomeWork) => ReactNode
}) {
  const completedLongform = data.works.filter(row => workLabel(row.work) === '长篇' && row.work.status === 'completed')

  return (
    <>
      <section className="lf-paper">
        <h3>已发布的创作版本</h3>
        <p>这里只列出真实发布记录。进入所属产品查看该作品的版本、阅读与导出。</p>
        {data.releases.map(release => {
          const row = data.rows.find(work => work.work.id === release.workId)!
          return (
            <article className="home-task" key={release.id}>
              <div>
                <small>{workLabel(row.work)} · {new Date(release.createdAt).toLocaleString()}</small>
                <h4>{row.work.title} · v{release.version}</h4>
                <p>{release.label}</p>
              </div>
              <button className="lf-action" onClick={() => void open(workPath(row, 'versions'), row)}>进入作品版本页</button>
            </article>
          )
        })}
        {!data.releases.length && <p>尚无独立作品发布版本。</p>}
      </section>
      <section className="lf-paper">
        <h3>互动产品发布记录</h3>
        {data.products.map(release => {
          const route = PRODUCT_RESULT_ROUTES.get(release.productType) ?? 'adventure/runtime'
          const path = `/${route}?project=${release.projectId}&work=${release.workId}`
          const row = data.rows.find(work => work.work.id === release.workId)
          return (
            <article className="home-task" key={release.id}>
              <div>
                <h4>{release.label} · v{release.version}</h4>
                <p>{PRODUCT_LABELS[release.productType] || release.productType} · {new Date(release.createdAt).toLocaleString()}</p>
                <small>发布校验 {release.contentHash.slice(0, 16)}</small>
              </div>
              <button className="lf-action" onClick={() => void open(path, row)}>进入所属产品</button>
            </article>
          )
        })}
        {!data.products.length && <p>尚无互动产品发布记录。</p>}
      </section>
      <section className="lf-paper">
        <h3>已完成的长篇</h3>
        {completedLongform.map(renderWorkCard)}
        {!completedLongform.length && <p>还没有标记完成的长篇。</p>}
      </section>
    </>
  )
}
