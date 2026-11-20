# Troubleshooting

## November 19: feedback forms and screenshot drafts

Problems and suggestions provides complete Bug / Feature forms with screenshot selection/paste, preview and removal. Limits are three images, 2 MiB each and 4 MiB total. Check images for private manuscripts, keys and account data. Cancellation retains the page draft; failure/unknown outcomes retain the ID, text and image bytes. Check the receipt before explicitly retrying; no automatic resend under a new ID. Unsupported older backends block new fields/images rather than reporting success. Based on #488.

The ordinary Clear local error records control is removed; bounded internal retention and expiry continue. Linux abnormal-exit diagnostics retain the exit code without treating normal exits or deliberate termination as crashes. Based on #476/#487. See [compatibility](/en/updates/compatibility) for release scope.

## Desktop folder selection does not create a binding

Record the version, operating system, selected location and error. Retain the existing binding and a complete backup; do not clear app data or automatically move works. The mainline directory-permission fix [#462](https://github.com/yuanbw2025/storyforge/pull/462) displays a folder-permission confirmation for valid requests from the trusted current desktop window. Check the folder and choose Allow, or cancel. Protected locations permit only selecting an ordinary project subfolder or cancelling, without bypassing system protection. Verify the first write in data management after granting permission.

Released v4.0.7 does not include this fix. The original machine's native picker, binding recovery and a subsequent formal client still await acceptance. [#300](https://github.com/yuanbw2025/storyforge/issues/300) and [#458](https://github.com/yuanbw2025/storyforge/issues/458) remain under investigation. Add evidence to the existing issue through the [feedback center](/en/feedback/) instead of creating duplicates.

## Recent-operation traces and failure summaries

Current mainline records up to 20 bounded local page categories, operation codes, and technical error classifications from the last five minutes by default. The former enhanced-diagnostics switch has been removed. An existing explicit opt-out remains authoritative; malformed preferences or storage read failure disable recording. Summaries can include supported native process, reason, and numeric exit-code details. This does not enable automatic failure reporting. See [PR #535](https://github.com/yuanbw2025/storyforge/pull/535).

Inspect the preview before sending under the existing failure-reporting choice. Older backends or failed capability negotiation continue with basic summaries. Public feedback links omit extended traces. Traces exclude input text, button labels, work titles, manuscripts, model responses, URLs and keys. See [PR #301](https://github.com/yuanbw2025/storyforge/pull/301) for delivery scope and backend integration status.

## Interrupted resource loading at startup

Before the application opens, a recognized module or stylesheet load failure may trigger at most one automatic reload. Persistent failure keeps the error and an explicit reload action instead of looping; ordinary errors do not trigger this recovery. Module failures after the app opens still use the save barrier described below and require the author to retry. Recovery neither starts model tasks nor clears work data. The safeguards in [PR #215](https://github.com/yuanbw2025/storyforge/pull/215) do not establish that all native crashes or memory issues are resolved.


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

## Retrying a failed module load

If the error includes `Failed to fetch dynamically imported module`, `Importing a module script failed`, or a CSS preload failure, check the network and address, then choose Retry (重试) on the error page. The app saves pending edits before reloading. Running tasks may be interrupted: inspect the original run and candidates after returning instead of repeatedly generating.

If it reports that edits could not be saved and the page was not reloaded, keep the page open, resolve the save error, and try again. Do not clear site data or assume a failed save has safely refreshed the app. Other rendering errors can still be retried from the error page.

## Do not start by clearing data

Reloading, clearing cache, and clearing site data are different operations. Clearing site data may delete the local database. Check backups and the original environment first; do not delete manuscript storage to fix a UI issue.

## A useful bug report

Use [Bug report](/en/feedback/bug) with version, OS, browser, module, steps, and expected/actual results. Attach screenshots and sanitized logs if useful; never upload API keys or private manuscripts.

If reproduction is unreliable, report that it happened once and describe the conditions rather than guessing the cause.

Continue: [Upgrade and compatibility](/en/updates/compatibility).

## Problems and failure reports in downloaded builds

v4.0.2 provides Home → General settings → Problems and suggestions (问题与建议). Rendering failures and blocked startup also provide feedback without requiring the project database.

### Submit a problem or suggestion inside the application

1. Choose “Report a problem” (报告问题) or “Feature suggestion” (功能建议). A crash is not required: unresponsive buttons, display errors, and requests for improvement can all be reported.
2. Enter a title and description. For a Bug, optionally add reproduction steps and the expected result. The application includes its version, operating-system category, and client type.
3. If diagnostics would help, choose “Preview failure summary and give feedback” (查看故障摘要并反馈), inspect it, then select “Attach the redacted error records previewed below” (附带下方预览的脱敏错误记录). This is optional; a report can be sent without error records.
4. Select “I have checked the content and confirm sending it to the maintainer” (我已检查填写内容，确认发送给维护者), then “Submit feedback” (提交反馈), and wait for the result. In-app feedback enters a private maintainer inbox without automatic publication on GitHub. If submission fails, retain the input and retry as instructed.

### Use the fallback web form

“Give feedback directly” (直接反馈问题) and “Open official feedback form with summary” (带摘要打开官方反馈表单) open the website form. Summary-based feedback in v4.0.1 uses this route too. A browser fragment carries the summary and is removed after import; the form never submits automatically.

Add a title, description, and reproduction steps, then inspect Additional information before submitting. **The web form creates a public GitHub Issue**: do not attach manuscripts, credentials, or screenshots you do not want public. You can directly visit [Bug report](/en/feedback/bug) or [Feature request](/en/feedback/feature).

The summary contains only the application build, operating-system/browser family, error types/code locations, and available launcher failure types/timestamps. It excludes error messages, manuscripts, Prompts, API keys, full URLs, disk paths, and database contents.

The browser retains at most twenty errors from the last seven days, including across refreshes. The summary contains at most the latest five errors and three code locations each. The ordinary clear control is removed; bounded retention and expiry remain. Complete diagnostic JSON remains a separate download in Data and backup and is not automatically uploaded.

When error reporting is enabled, the same native failure is not requeued merely because the local summary rotates or the page refreshes. A new occurrence at a different time remains separate. Turning error reporting off or deleting the records clears the corresponding local deduplication history. This prevents duplicate reports; it does not establish that the native crash itself is fixed.

The portable launcher keeps one recent failure and session state under `.storyforge/diagnostics/` in the user directory. If it cannot start, manually open the official form and optionally attach `last-failure.json`. Port conflicts, permission errors, and catchable process exceptions leave bounded type records. A prior session that did not end normally is marked only as an interruption requiring review. Forced termination, power loss, browser-native crashes, and failures before diagnostics load are not guaranteed to be captured; interruptions are not proof of program crashes. Diagnostics do not replace work backups.
