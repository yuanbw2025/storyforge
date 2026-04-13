import { db } from '../db/schema'
import type { OutlineNode, Chapter } from '../types'

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
    md += `${ch.content}\n\n`
  } else if (node.summary) {
    md += `*（大纲：${node.summary}）*\n\n`
  }
  return md
}

function renderChapterTxt(node: OutlineNode, chapterMap: Map<number, Chapter>): string {
  const ch = chapterMap.get(node.id!)
  let txt = `    ${node.title}\n\n`
  if (ch?.content) {
    txt += `${ch.content}\n\n`
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
