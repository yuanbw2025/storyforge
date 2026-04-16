import { db } from '../db/schema'
import type { OutlineNode, Chapter } from '../types'
import { isHtml, htmlToPlainText } from '../utils/html'

/** HTML → Markdown（简化规则，覆盖 TipTap StarterKit 产出的常见结构） */
function htmlToMarkdown(html: string): string {
  if (!html) return ''
  if (!isHtml(html)) return html
  let md = html
  // 标题
  md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n')
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n')
  md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n\n#### $1\n\n')
  // 强调
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
  // 引用
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim()
    return text
      .split('\n')
      .map((l: string) => `> ${l}`)
      .join('\n')
  })
  // 列表项
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
  md = md.replace(/<\/?(ul|ol)[^>]*>/gi, '\n')
  // 分割线
  md = md.replace(/<hr[^>]*\/?>/gi, '\n---\n')
  // 段落与换行
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
  md = md.replace(/<br\s*\/?>/gi, '\n')
  // 清理剩余标签
  md = md.replace(/<[^>]+>/g, '')
  // 实体
  md = md
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
  // 规整空行
  md = md.replace(/\n{3,}/g, '\n\n')
  return md.trim()
}

/** 导出为 Markdown 格式 */
export async function exportProjectMarkdown(projectId: number): Promise<string> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('项目不存在')

  const [outlineNodes, chapters] = await Promise.all([
    db.outlineNodes.where('projectId').equals(projectId).toArray(),
    db.chapters.where('projectId').equals(projectId).toArray(),
  ])

  // 按大纲结构组织
  const chapterMap = new Map<number, Chapter>()
  chapters.forEach(ch => { chapterMap.set(ch.outlineNodeId, ch) })

  // 构建树
  const tree = buildTree(outlineNodes)
  let md = `# ${project.name}\n\n`

  for (const volume of tree) {
    md += `## ${volume.node.title}\n\n`
    if (volume.node.summary) {
      md += `> ${volume.node.summary}\n\n`
    }

    for (const child of volume.children) {
      if (child.node.type === 'arc') {
        md += `### ${child.node.title}\n\n`
        for (const chNode of child.children) {
          md += renderChapterMd(chNode.node, chapterMap)
        }
      } else {
        // 直接是章节
        md += renderChapterMd(child.node, chapterMap)
      }
    }
  }

  return md.trim()
}

/** 导出为纯文本格式 */
export async function exportProjectTXT(projectId: number): Promise<string> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('项目不存在')

  const [outlineNodes, chapters] = await Promise.all([
    db.outlineNodes.where('projectId').equals(projectId).toArray(),
    db.chapters.where('projectId').equals(projectId).toArray(),
  ])

  const chapterMap = new Map<number, Chapter>()
  chapters.forEach(ch => { chapterMap.set(ch.outlineNodeId, ch) })

  const tree = buildTree(outlineNodes)
  let txt = `${project.name}\n${'='.repeat(project.name.length * 2)}\n\n`

  for (const volume of tree) {
    txt += `【${volume.node.title}】\n\n`

    for (const child of volume.children) {
      if (child.node.type === 'arc') {
        txt += `  〔${child.node.title}〕\n\n`
        for (const chNode of child.children) {
          txt += renderChapterTxt(chNode.node, chapterMap)
        }
      } else {
        txt += renderChapterTxt(child.node, chapterMap)
      }
    }
  }

  return txt.trim()
}

// --- 辅助函数 ---

interface TreeNode {
  node: OutlineNode
  children: TreeNode[]
}

function buildTree(nodes: OutlineNode[]): TreeNode[] {
  const nodeMap = new Map<number, TreeNode>()
  const roots: TreeNode[] = []

  // 先创建所有 TreeNode
  nodes.forEach(n => {
    nodeMap.set(n.id!, { node: n, children: [] })
  })

  // 构建父子关系
  nodes.forEach(n => {
    const treeNode = nodeMap.get(n.id!)!
    if (n.parentId && nodeMap.has(n.parentId)) {
      nodeMap.get(n.parentId)!.children.push(treeNode)
    } else {
      roots.push(treeNode)
    }
  })

  // 排序
  const sortChildren = (items: TreeNode[]) => {
    items.sort((a, b) => a.node.order - b.node.order)
    items.forEach(item => sortChildren(item.children))
  }
  sortChildren(roots)

  return roots
}

function renderChapterMd(node: OutlineNode, chapterMap: Map<number, Chapter>): string {
  const ch = chapterMap.get(node.id!)
  let md = `#### ${node.title}\n\n`
  if (ch?.content) {
    md += `${htmlToMarkdown(ch.content)}\n\n`
  } else if (node.summary) {
    md += `*（大纲：${node.summary}）*\n\n`
  }
  return md
}

function renderChapterTxt(node: OutlineNode, chapterMap: Map<number, Chapter>): string {
  const ch = chapterMap.get(node.id!)
  let txt = `    ${node.title}\n\n`
  if (ch?.content) {
    txt += `${htmlToPlainText(ch.content)}\n\n`
  }
  return txt
}

/** 下载文本文件 */
export function downloadTextFile(content: string, filename: string, mimeType: string = 'text/plain') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
