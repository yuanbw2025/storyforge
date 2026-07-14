import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useOutlineChapterCountEstimate } from '../../src/components/outline/useOutlineChapterCountEstimate'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
let values: Record<string, unknown>
let setValues: React.Dispatch<React.SetStateAction<Record<string, unknown>>>

async function mount(initialValues: Record<string, unknown>, selectedVolumeId: number | null = 1) {
  function Harness() {
    const [parameterValues, setParameterValues] = useState(initialValues)
    values = parameterValues
    setValues = setParameterValues
    useOutlineChapterCountEstimate({
      selectedVolumeId,
      selectedVolumeExists: selectedVolumeId != null,
      targetWordCount: 2_000_000,
      volumeCount: 5,
      parameterValues,
      setParameterValues,
    })
    return createElement('div')
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(Harness)))
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 章节数智能默认 hook', () => {
  it('每章字数变化会更新仍未被用户改写的估算值', async () => {
    await mount({})
    expect(values.chaptersPerVolume).toBe(133)

    await act(async () => setValues(previous => ({ ...previous, wordsPerChapter: 5000 })))
    expect(values.chaptersPerVolume).toBe(80)
  })

  it('用户手动填写章节数后，后续每章字数变化不覆盖用户值', async () => {
    await mount({})
    await act(async () => setValues(previous => ({
      ...previous,
      chaptersPerVolume: 77,
      wordsPerChapter: 4000,
    })))

    expect(values.chaptersPerVolume).toBe(77)
  })

  it('没有有效选中卷时不写入默认值', async () => {
    await mount({}, null)
    expect(values.chaptersPerVolume).toBeUndefined()
  })
})
