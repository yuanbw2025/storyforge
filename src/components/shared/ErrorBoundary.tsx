import { Component, type ReactNode, type ErrorInfo } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { recordRuntimeDiagnosticError } from '../../lib/diagnostics/runtime-errors'
import FailureFeedbackPanel from './FailureFeedbackPanel'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { isModuleLoadFailureV1 as isModuleLoadFailure } from '../../lib/module-load-recovery'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  recovering: boolean
  recoveryError: string | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, recovering: false, recoveryError: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, recovering: false, recoveryError: null }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    recordRuntimeDiagnosticError(error, 'react')
    console.error('[StoryForge ErrorBoundary]', error, errorInfo)
  }

  handleReset = async () => {
    if (this.state.recovering) return
    if (isModuleLoadFailure(this.state.error)) {
      // React.lazy retains a rejected import. Resetting only this boundary
      // cannot retry it; an explicit reload also resets the browser module map.
      this.setState({ recovering: true, recoveryError: null })
      try {
        await flushPendingEditsV1()
        window.location.reload()
      } catch {
        this.setState({ recovering: false, recoveryError: '编辑尚未保存成功，未重新加载。请保留当前页面并重试保存。' })
      }
      return
    }
    this.setState({ hasError: false, error: null, recovering: false, recoveryError: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-warning mb-4" />
          <h2 className="text-lg font-bold text-text-primary mb-2">出了点问题 😅</h2>
          <p className="text-sm text-text-muted mb-4 max-w-md">
            {this.state.error?.message || '发生了未知错误'}
          </p>
          {isModuleLoadFailure(this.state.error) && <p className="text-xs text-text-muted mb-4 max-w-md">重试会先保存编辑，再重新加载页面；尚在运行的任务可能中断。</p>}
          {this.state.recoveryError && <p role="alert" className="text-sm text-error mb-4">{this.state.recoveryError}</p>}
          <button
            onClick={() => void this.handleReset()}
            disabled={this.state.recovering}
            className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent-hover transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> {this.state.recovering ? '正在保存并重新加载…' : '重试'}
          </button>
          <FailureFeedbackPanel />
        </div>
      )
    }

    return this.props.children
  }
}
