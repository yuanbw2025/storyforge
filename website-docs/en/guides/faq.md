# Frequently asked questions

## Must I create a world before writing fiction?

No. Longform and short fiction work independently. Explicitly derive a world later if reuse is needed. See [Projects, works, and worlds](/en/concepts/work-world).

## Can I use it without an API?

You can organize/edit manually and play the no-API Fog Harbor: The Lost-Tide Bells (雾港：失潮钟声). AI generation, analysis, and some interactions require your own model service.

## Why do two versions labeled 3.9.1 have different interfaces?

A tagged release is fixed at publication, while main has continued changing. An unchanged version number does not imply identical code. Include the build commit and address when troubleshooting. See [Versions](/en/updates/compatibility).

## Why are works missing after changing addresses or browsers?

Sites and browsers have separate storage. Return to the original address, port, and browser, then export a backup. Do not clear original site data. See [Backup and recovery](/en/guides/backup-restore).

## Why confirm AI output after generation?

Output usually starts as a candidate and becomes official after author confirmation. Structural problems or stale versions may also need handling. See [AI workflow](/en/guides/ai-workflow).

## Why did editing a world not change an existing game?

Games reference sealed versions; existing products and saves preserve their evidence. Editing a world draft does not automatically rewrite old works. See [Sealing and release](/en/concepts/versions).

## Does publishing automatically upload to a community?

Usually not. Product publishing primarily preserves immutable versions for export or play. Public communities, accounts, and cloud sync must not be assumed live.

## Why can a task fail after a successful model test?

A successful connection does not prove all capabilities, input lengths, quotas, and output formats meet task requirements. Test small and inspect the specific error. See [Troubleshooting](/en/guides/troubleshooting).

## Why can't the comic workflow directly use a reference image?

Whether an image is actually sent depends on the image-service adapter. Mentioning it in a Prompt does not mean the model received it. See [Comic guide](/en/features/comic).

## Can motion-comic materials generate a complete video directly?

Delivery currently stops before external video generation: scripts, storyboards, materials, and tool Prompt packages. Video generation and postproduction happen externally.

## What is the difference between system and user Prompts?

System Prompts usually express task rules and role requirements; user Prompts express the current goal. Neither guarantees absolute model compliance. Check results and start with [Prompt usage](/en/guides/using-prompts).

## How do I report problems?

Use the [official feedback center](/en/feedback/), providing version, steps, and error text. Remove keys, private manuscripts, and sensitive personal content before submitting.
