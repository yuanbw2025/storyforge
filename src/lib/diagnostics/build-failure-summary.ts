import { APP_BUILD_ID } from '../version'
import { readRuntimeDiagnosticErrors } from './runtime-errors'
import { parseFailureSummary, type FailureSummary } from './failure-summary'

export async function buildFailureSummary(): Promise<FailureSummary> {
  const ua = navigator.userAgent
  const platform = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other'
  const browser = ua.match(/Edg\/(\d+)/) ? `Edge ${ua.match(/Edg\/(\d+)/)![1]}`
    : ua.match(/Firefox\/(\d+)/) ? `Firefox ${ua.match(/Firefox\/(\d+)/)![1]}`
      : ua.match(/Chrome\/(\d+)/) ? `Chrome ${ua.match(/Chrome\/(\d+)/)![1]}`
        : ua.match(/Version\/(\d+).*Safari/) ? `Safari ${ua.match(/Version\/(\d+).*Safari/)![1]}` : 'Other'
  let launcher: unknown = null
  if (import.meta.env.MODE === 'portable') {
    try {
      const response = await fetch('/storyforge/local-diagnostics/launcher', { cache: 'no-store', signal: AbortSignal.timeout(2_000) })
      if (response.ok) launcher = await response.json()
    } catch { /* A stopped launcher must not prevent reporting a browser failure. */ }
  }
  const report = parseFailureSummary({ format: 'storyforge-failure-summary', version: 1,
    application: APP_BUILD_ID, platform, browser,
    errors: readRuntimeDiagnosticErrors().slice(-5).map(error => ({ ...error, frames: error.frames.slice(0, 3) })), launcher })
  if (!report) throw new Error('诊断摘要格式不可用')
  return report
}
