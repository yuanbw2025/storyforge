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

## Problems and failure reports in downloaded builds

Builds containing this feature provide Home → General settings → Problems and failure reports (问题与故障反馈). Rendering failures and blocked startup also offer feedback without requiring the project database. Fixed v4.0.0 archives do not gain the feature automatically; the entry applies to v4.0.1 and later portable builds; check the [latest release](https://github.com/yuanbw2025/storyforge/releases/latest) for published archives.

1. Choose Preview failure summary and give feedback (查看故障摘要并反馈), then inspect the local summary. It contains only the application build, operating-system/browser family, recent error types/code locations, and available launcher failure types/timestamps. It excludes error messages, manuscripts, Prompts, API keys, full URLs, disk paths, and database contents.
2. Choose Open official feedback form with summary (带摘要打开官方反馈表单). A browser fragment carries the summary and is removed after import; the form never submits automatically.
3. Add a title, description, and reproduction steps. Inspect Additional information and remove anything you do not want public before submitting. Feedback enters public project Issues; inspect screenshots and attachments yourself too.
4. If offline, retain the local records and reopen the feedback entry later. There are no unlimited background retries or hidden deferred submissions. You can also fill out the [Bug report](/en/feedback/bug) manually.

The browser retains at most twenty errors from the last seven days, including across refreshes. The summary contains at most the latest five errors and three code locations each. Clear local error records removes only browser diagnostics, not works or model configuration. Complete diagnostic JSON remains a separate download in Data and backup and is not automatically uploaded.

The portable launcher keeps one recent failure and session state under `.storyforge/diagnostics/` in the user directory. If it cannot start, manually open the official form and optionally attach `last-failure.json`. Port conflicts, permission errors, and catchable process exceptions leave bounded type records. A prior session that did not end normally is marked only as an interruption requiring review. Forced termination, power loss, browser-native crashes, and failures before diagnostics load are not guaranteed to be captured; interruptions are not proof of program crashes. Diagnostics do not replace work backups.
