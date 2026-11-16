# Import existing fiction and references

## Confirming and recovering import parsing

Document parsing first creates a recoverable candidate. Review its target work, original file and content before adopting it. Reloading/opening failed tasks restores the original attempt rather than automatically making another paid send. Replaced files or changed sources require another check. Reference parsing does not automatically merge existing characters; source reference text remains private and local. See [reference analysis](/en/features/longform/references), based on [#307](https://github.com/yuanbw2025/storyforge/pull/307) and [#386](https://github.com/yuanbw2025/storyforge/pull/386).


Choose the entry by the material's purpose. Restoring a backup and asking AI to analyze a novel are different operations.

| Material and goal | Entry | Model calls? |
| --- | --- | --- |
| Restore a StoryForge project | JSON import in data backup/recovery | Data import itself needs no AI |
| Turn existing prose into longform material | Longform → Document import | Analysis and extraction may call AI |
| Study a reference work | Longform workbench → Project references and analysis | AI analysis calls a model |
| Adapt fiction into screenplay, comic, or motion-comic materials | Source entry in that product | Later adaptation generation calls models |

## Before import

Save a complete backup of the current project. Confirm the target work and world, and check for private data, API keys, or material you lack rights to use.

Accepted document formats are shown by the current file picker. Screenplay sources accept TXT, Markdown, DOCX, and PDF. A scanned PDF is not necessarily a text file from which prose can be extracted.

## During import

Inspect extracted text, chapter splitting, and source scope before starting AI steps. Long materials may be analyzed in stages; do not launch concurrent imports merely because one takes time.

Inspect progress, candidates, and reports. Before merging, check same-name characters, duplicate chapters, and ownership; similar names do not necessarily identify the same character.

## After import

Check opening/ending prose, chapter order, key characters, and generated structured material. AI-extracted facts may be wrong; read their evidence before confirming.

For adaptation, preserve source provenance. Do not modify source records merely to pass completion checks.

## Older backups

Import validates backup versions and does not accept arbitrary old formats. Preserve the original backup and runtime environment; read [upgrade and compatibility](/en/updates/compatibility). Do not manually change JSON version numbers to bypass validation.

## When some analysis chunks fail

Retry failed chunks (重试失败块) retries failures and continues unprocessed chunks without writing successful chunks again. Explicit recovery renews the bounded attempt allowance for failed chunks that exhausted it.

Only a clearly retryable HTTP 503 busy-service response is retried automatically, with at most three attempts per chunk. Incomplete JSON, authorization problems, and unknown outcomes stop processing and preserve the failure state. Check model logs and configuration before choosing a manual retry. Partial extraction is not complete success.
