# Models and APIs

AI generation requires your own model service. You can begin with manual writing and built-in works that need no API.

## First configuration

1. Open “Models and local settings” (模型与本地设置) at the top right of Home, or “General settings” (通用设置) within a product.
2. Select a provider and enter the API key, base URL, and model name supported by your account.
3. Check context and output settings rather than copying another model's parameters unchanged.
4. Test the connection, then run a small generation task.
5. Inspect the actual model, output, and usage before starting long production tasks.

A successful connection test only confirms that particular test. Balance, permissions, model formats, and output limits can still cause failures.

## Local and custom services

A local model or custom OpenAI-compatible service requires a running endpoint and an available model. Try the settings page's model-list lookup; if it fails, enter the name provided by the service.

Local services without authentication and cloud providers have different key requirements. A cloud authentication error does not necessarily mean the software is unsupported. Do not expose a local service to unrelated visitors.

## Task models and media models

Configure writing, extraction, analysis, and review routes where offered in settings. Check the model used by the actual task, not only the global default.

Text settings do not automatically configure images, audio, or external video tools. See the relevant [product guide](/en/features/) for comic and motion-comic services.

## Cross-origin access and proxies

Browsers may restrict direct calls to third-party APIs. Follow settings guidance for a local proxy or a provider-supported access method. The proxy address, network, and service must all work.

Never put API keys in work descriptions, Prompts, or public feedback. Your model provider determines billing.

Continue: [Costs and tokens](/en/guides/token-cost) · [Troubleshooting](/en/guides/troubleshooting).
