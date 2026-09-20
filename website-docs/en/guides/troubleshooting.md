# Troubleshooting

Record your version, address, product, steps, and full error text first. The checks below prioritize preserving works and candidates.

| Symptom | Check first | Next step |
| --- | --- | --- |
| Old works missing | Address, port, browser, and profile changes | Return to the original environment and export a backup |
| AI authentication/permission error | Key, provider, model permissions | Confirm with the provider; avoid repeated resends |
| Insufficient balance/rate limit | Credit, concurrency, returned limit message | Wait or resolve account limits before retrying |
| Connection test passes; generation fails | Model capabilities, input length, output limits | Test a small task; retain error text |
| Browser cross-origin error | Base URL and proxy configuration | Follow settings guidance for a local proxy |
| Interrupted/empty output | Run state, model response, network | Check for recoverable results first |
| Stale candidate cannot be adopted | Source changes while waiting | Check the current version before regenerating/editing |
| Cannot publish | Missing chapters, pending candidates, serious issues, assets | Resolve the checklist item by item |
| Cannot choose a disk folder | Browser capability, permissions, environment | Reauthorize or use a workspace package |
| Old JSON rejected | Backup format and supported window | Preserve the original; read compatibility guidance |
| UI differs from docs | Tagged release, live deployment, current main | Read version guidance and the changelog |

## Do not start by clearing data

Reloading, clearing cache, and clearing site data are different operations. Clearing site data may delete the local database. Check backups and the original environment first; do not delete manuscript storage to fix a UI issue.

## A useful bug report

Use [Bug report](/en/feedback/bug) with version, OS, browser, module, steps, and expected/actual results. Attach screenshots and sanitized logs if useful; never upload API keys or private manuscripts.

If reproduction is unreliable, report that it happened once and describe the conditions rather than guessing the cause.

Continue: [Upgrade and compatibility](/en/updates/compatibility).
