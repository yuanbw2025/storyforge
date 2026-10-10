# Models and APIs

AI generation requires your own model service. You can begin with manual writing and built-in works that need no API.

## First configuration

1. Open “Models and local settings” (模型与本地设置) at the top right of Home, or “General settings” (通用设置) within a product.
2. Select a provider. For API services, enter the API key, base URL, and model supported by your account; for local Codex, follow the subscription steps below.
3. Check context and output settings rather than copying another model's parameters unchanged.
4. Test the connection, then run a small generation task.
5. Inspect the actual model, output, and usage before starting long production tasks.

A successful connection test only confirms that particular test. Balance, permissions, model formats, and output limits can still cause failures.

## Codex with a local ChatGPT login

This feature is delivered in the Codex provider development branch; see [development status](/en/updates/development-status) for merge and deployment status. It provides local text generation and cannot run directly on a hosted static site.

1. Install a Codex CLI that supports the isolation protocol (minimum 0.162.0; currently tested with 0.162.0-alpha.2), and sign in locally with ChatGPT. An existing login can usually be reused; opening the repository in Codex does not replace connection detection.
2. Run `npm run dev` in the StoryForge project directory, or run `npm run build` followed by `npm run preview`. The service must find `codex` on PATH. Otherwise install the CLI or set `STORYFORGE_CODEX_BIN` to its executable path.
3. Select **Codex（本机 ChatGPT 登录）** in settings and wait for the detected account status. No API key or base URL is required.
4. Select a model from the local catalog and run the minimal connection test. The test consumes a small amount of plan usage. Save a preset and assign it to writing, extraction, or other task routes as needed.
5. Only when no login is detected, choose “Sign in with ChatGPT” and open the official OpenAI login page, or run `codex login` in a local terminal. Click connection detection after signing in. Signing in may change the account currently used by local Codex.

Codex manages authentication; StoryForge does not save login tokens. API-key authentication is rejected. Quota exhaustion or connection failure never switches to a paid API automatically. Stopping the connection does not sign out of Codex; the next detection or generation can reconnect.

Subscriptions have usage limits and model permissions; they are not free or unlimited. This channel supports text and structured output only; evaluations that require API cost accounting are not supported yet. Images, audio, and embeddings require separate configuration. Temperature and API output-token limits do not apply; local context budgeting still applies. Long tasks, batch production, and literary quality require separate validation, and subscription selection does not remove monetary budget requirements.

After a reload or disconnection, inspect recent requests before retrying. The local service retains at most 100 request statuses and returned texts for up to 24 hours, without input prompts or credentials. Copied text still requires review and the original adoption workflow. Unfinished requests become “result unknown” after a service restart and are never automatically resubmitted. Transport recovery records are not included in work backups.

Keep the original browser address and port. Changing addresses does not migrate data: IndexedDB manuscripts are separate across origins. Follow the [backup guide](/en/guides/backup-restore) before switching. This integration is limited to local personal/open-source applications, not commercial hosted APIs or shared subscription pools; see [OpenAI app-server documentation](https://learn.chatgpt.com/docs/app-server).

## Local and custom services

A local model or custom OpenAI-compatible service requires a running endpoint and an available model. Try the settings page's model-list lookup; if it fails, enter the name provided by the service.

Local services without authentication and cloud providers have different key requirements. A cloud authentication error does not necessarily mean the software is unsupported. Do not expose a local service to unrelated visitors.

## Task models and media models

Configure writing, extraction, analysis, and review routes where offered in settings. Check the model used by the actual task, not only the global default.

Text settings do not automatically configure images, audio, or external video tools. See the relevant [product guide](/en/features/) for comic and motion-comic services.

## Cross-origin access and proxies

Browsers may restrict direct calls to third-party APIs. When running locally with `npm run dev`, supported providers can use the development server's local proxy through settings. Deployed builds do not include these proxies and do not show the switch-to-local-proxy button.

Semantic retrieval presets in deployed builds use the provider's direct endpoint, which still requires the provider to allow browser cross-origin requests. If your deployment supplies a same-origin reverse proxy, enter its Base URL manually. Saved proxy addresses are preserved, and you can explicitly switch back to direct access; opening settings never automatically rewrites saved configuration.

Never put API keys in work descriptions, Prompts, or public feedback. Your model provider determines billing.

Continue: [Costs and tokens](/en/guides/token-cost) · [Troubleshooting](/en/guides/troubleshooting).
