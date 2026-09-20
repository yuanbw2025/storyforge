# Costs, tokens, and saving money

StoryForge uses your configured model services. Costs depend on the provider, actual model, and request. The project does not provide a universal free-model allowance.

## Which operations may cost money?

| Operation | Model cost |
| --- | --- |
| Manual editing or reading existing prose | No model call required |
| File differences, synchronization, structural validation, recovery | Local; no AI tokens |
| AI generation, continuation, extraction, style learning, semantic review | Model calls billed by the provider |
| Image/audio generation | Billed by the respective service; text tokens alone are insufficient |
| Deterministic format conversion and existing-asset packaging | Local processing itself needs no model |

## Understanding tokens

Input includes task requirements and relevant material actually read. Output is generated content. There is no fixed Chinese-character/token conversion valid for every model.

Compare app usage statistics and actual model records with provider bills. Where exact usage or price is missing, estimates are not settled charges. Do not infer current costs from old price tables.

## Control costs in this order

1. Test a small task before a chapter or whole story.
2. Define scope: fixing one dialogue passage need not regenerate a chapter.
3. Check source correctness and sufficient information to reduce ineffective retries.
4. Confirm upstream candidates before generating downstream content.
5. Budget text, images, and audio separately; confirm comic storyboards before images.
6. On errors, first inspect authentication, balance, rate limits, and network state.

Formal creative workflows bound repair and retries, but a complete product flow may contain many tasks. This does not mean an entire work makes at most one or two model calls.

## Models and context

A larger context window does not make every document worth sending. Choose models suited to the task, with accurate chapter goals and confirmed materials. Retrieval helps locate evidence but does not replace author review.

Local models may avoid external per-token bills, but still cost hardware, memory, time, and electricity.

Old WPS prices and experience notes remain in the [historical cost guide](/en/archive/token-cost-2026-07-06) (links to the Chinese original), not as current purchasing advice.

Continue: [Model configuration](/en/getting-started/model-config) · [Troubleshooting](/en/guides/troubleshooting).
