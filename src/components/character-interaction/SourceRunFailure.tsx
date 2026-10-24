import type {CodexTerminalFailureV1} from '../../lib/ai/codex-terminal-failure'

export default function SourceRunFailure({failure, pending}: {failure: CodexTerminalFailureV1; pending: boolean}) {
  return <div className="space-y-2" role="status">
    <p>{failure.providerTurn.status === 'interrupted' ? 'Codex 已确认本次生成中断' : 'Codex 已确认本次生成失败'}，没有可用候选，也没有自动重发。这次调用可能已产生用量。</p>
    {pending && <p>失败回执已保存，运行记录尚未结束；恢复记录不会调用模型。</p>}
    <details><summary>查看失败记录</summary><p className="break-all">请求：{failure.requestId}</p><p>模型：{failure.model}</p></details>
  </div>
}
