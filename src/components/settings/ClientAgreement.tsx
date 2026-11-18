import { CLIENT_LEGAL_VERSION, CLIENT_TERMS } from '../../lib/feedback/client-legal'

/** Optional, offline-readable footer; opening the document never gates the app. */
export function ClientLegalDocuments() {
  return <details className="mt-6 text-xs text-text-muted">
    <summary className="w-fit cursor-pointer hover:text-text-primary">用户协议</summary>
    <div role="region" aria-label="用户协议正文" tabIndex={0} className="mt-3 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-bg-base p-4 text-sm leading-7 sm:p-5">
      <h2 className="text-center text-base font-semibold">用户协议</h2>
      <p className="mt-2 text-center text-xs text-text-muted">版本：{CLIENT_LEGAL_VERSION} · 可离线阅读</p>
      {CLIENT_TERMS.map(section => <section key={section.title} className="mt-4"><h3 className="font-semibold">{section.title}</h3><p className="mt-1 text-text-secondary">{section.text}</p></section>)}
    </div>
  </details>
}
