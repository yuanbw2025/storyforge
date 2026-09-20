# Local data, models, and privacy

## Where content is stored

Core creation primarily uses the browser's local database. After binding a disk workspace, author-confirmed synchronization can store supported content there. This does not automatically cloud-sync across browsers, addresses, or devices.

## When content leaves the device

- AI generation, analysis, or review sends task-required material to your configured model provider.
- External image/audio services may receive related requests and assets.
- Submitting official feedback sends your description and attachments into the official feedback workflow.

Local-first does not mean fully offline when using cloud models. Consult each provider's own retention and use policies.

## API keys

Enter credentials only in model settings and understand storage options such as Remember. Never put keys in prose, Prompts, screenshots, or feedback attachments, or share settings files containing credentials.

## Is feedback public?

Official feedback creates GitHub Issues. Prepare descriptions and attachments as public content. Do not submit private manuscripts, personal information, or keys. Attachments are temporarily stored by the official feedback system and automatically removed after about 10 days; this does not mean the Issue text is deleted.

## Offline use and cost

Manual editing, local checks of existing content, and backups need no cloud model. Whether the app itself loads offline depends on installation, cache, and browser state. Remote models require network access; local models require a running local service.

Continue: [Backup and recovery](/en/guides/backup-restore) · [Model configuration](/en/getting-started/model-config).
