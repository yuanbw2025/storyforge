import { adopt } from '../registry/adopt'

export interface GeneratedOutlineItem {
  title: string
  summary: string
}

export interface AdoptGeneratedOutlineItemsInput {
  projectId: number
  parentId: number | null
  type: 'volume' | 'chapter'
  items: GeneratedOutlineItem[]
  startingOrder: number
}

export interface AdoptGeneratedOutlineItemsResult {
  writtenCount: number
  firstId: number | null
  skippedReasons: string[]
}

export async function adoptGeneratedOutlineSummary(
  projectId: number,
  recordId: number,
  summary: string,
): Promise<{ written: boolean; reason?: string }> {
  const result = await adopt({
    projectId,
    target: 'outlineNodes',
    recordId,
    mode: 'replace',
    data: { summary },
  })
  return {
    written: result.written.length > 0,
    reason: result.written.length === 0 ? (result.skipped[0]?.reason ?? '结果为空') : undefined,
  }
}

export async function adoptGeneratedOutlineItems(
  input: AdoptGeneratedOutlineItemsInput,
): Promise<AdoptGeneratedOutlineItemsResult> {
  let writtenCount = 0
  let firstId: number | null = null
  const skippedReasons = new Set<string>()

  for (let index = 0; index < input.items.length; index++) {
    const item = input.items[index]
    const result = await adopt({
      projectId: input.projectId,
      target: 'outlineNodes',
      mode: 'add',
      data: {
        parentId: input.parentId,
        type: input.type,
        title: item.title,
        summary: item.summary,
        order: input.startingOrder + index,
      },
    })
    const id = result.written[0]?.id ?? null
    if (id != null) {
      writtenCount++
      if (firstId == null) firstId = id
    } else {
      skippedReasons.add(result.skipped[0]?.reason ?? '未知原因')
    }
  }

  return { writtenCount, firstId, skippedReasons: [...skippedReasons] }
}
