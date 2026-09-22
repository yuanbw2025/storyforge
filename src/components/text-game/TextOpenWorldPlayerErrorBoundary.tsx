import { Component, type ErrorInfo, type ReactNode } from 'react'
import { textOpenWorldUnsupportedRuntimeIssueV1 } from '../../lib/open-world/player-resilience'
import TextOpenWorldPlayerStateNotice from './TextOpenWorldPlayerStateNotice'

export interface TextOpenWorldPlayerErrorBoundaryProps {
  resetKey: number | string
  onRecover(): void
  onExit(): void
  children: ReactNode
}

interface TextOpenWorldPlayerErrorBoundaryState {
  failed: boolean
}

/**
 * Last-resort render boundary for a frozen player Session. It deliberately
 * keeps the exception out of the DOM and never attempts to mutate game state.
 */
export default class TextOpenWorldPlayerErrorBoundary extends Component<
  TextOpenWorldPlayerErrorBoundaryProps,
  TextOpenWorldPlayerErrorBoundaryState
> {
  state: TextOpenWorldPlayerErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): TextOpenWorldPlayerErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      // Render exceptions can contain provider text or opaque runtime keys.
      // Keep development telemetry useful without echoing the raw message.
      console.error('[text-open-world-player] render boundary', {
        errorName: error.name,
        componentStack: info.componentStack,
      })
    }
  }

  componentDidUpdate(previous: TextOpenWorldPlayerErrorBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <div
      className="avg-title-screen open-world-launcher open-world-player-boundary"
      data-testid="text-open-world-runtime-render-blocking"
    >
      <main className="avg-title-content open-world-launcher-content">
        <TextOpenWorldPlayerStateNotice
          issue={textOpenWorldUnsupportedRuntimeIssueV1()}
          primaryLabel="重新核对存档"
          onPrimary={this.props.onRecover}
          secondaryLabel="返回游戏库"
          onSecondary={this.props.onExit}
        />
      </main>
    </div>
  }
}
