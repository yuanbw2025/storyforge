import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { create } from 'zustand'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AIStreamOutput from '../../src/components/shared/AIStreamOutput'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

interface StreamState {
  output: string
  isStreaming: boolean
}

const useStreamState = create<StreamState>(() => ({
  output: '',
  isStreaming: true,
}))

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = []

function Harness({ editable = false }: { editable?: boolean }) {
  const output = useStreamState(state => state.output)
  const isStreaming = useStreamState(state => state.isStreaming)
  return createElement(AIStreamOutput, {
    output,
    isStreaming,
    error: null,
    editable,
    onStop: () => undefined,
    onRetry: () => undefined,
  })
}

async function mount(editable = false) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  await act(async () => root.render(createElement(Harness, { editable })))
  return host
}

async function emitRapidStreamUpdates(count = 400) {
  await act(async () => {
    for (let index = 1; index <= count; index += 1) {
      useStreamState.setState({ output: '字'.repeat(index * 12) })
      await Promise.resolve()
    }
  })
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
  useStreamState.setState({ output: '', isStreaming: true })
  vi.restoreAllMocks()
})

describe('AIStreamOutput rapid stream updates', () => {
  it('does not mirror non-editable stream chunks into nested local updates', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await mount()

    let thrown: unknown
    try {
      await emitRapidStreamUpdates()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeUndefined()
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('Maximum update depth exceeded')
  })

  it('initializes the editable buffer once streaming finishes', async () => {
    const host = await mount(true)
    await emitRapidStreamUpdates(80)
    const finalOutput = useStreamState.getState().output

    await act(async () => {
      useStreamState.setState({ isStreaming: false })
    })

    const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="AI 候选可编辑内容"]')
    expect(editor?.value).toBe(finalOutput)
  })
})
