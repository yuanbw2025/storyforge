---
title: Develop with your AI
lastVerified: 2026-10-09
---
# Develop with your AI

Describe the experience you want; your AI turns it into code, checks and a package. Choose a coding assistant that can read/write local files and run a terminal. A chat-only assistant should deliver source and commands, leaving execution and acceptance to you or a collaborator.

## Download matching rules

- [Download the AI development kit and Skill](/downloads/workshop/storyforge-plugin-author.zip)
- [Download the general development prompt](/downloads/workshop/developer-prompt.txt)
- [Inspect kit versions and file digests](/downloads/workshop/developer-kit.json)

The kit includes `SKILL.md`, the technical contract, API types, six guides in both languages, reference source and a delivery checklist. It is a development reference, not a `.sfplugin`; do not install it in StoryForge. It contains neither the full host nor npm dependencies. Complete [environment setup and checkout](./develop) as well.

## Option one Give the files to your AI

Unzip the kit and provide the entire `storyforge-plugin-author` folder. Copy `developer-prompt.txt`, append your requirements and send it to the assistant. Workshop's **开发与发布** page also copies this prompt. **A prompt without the reference files or matching checkout still leaves room for invented APIs.**

Example request:

> Build a clue-card plugin belonging to the current work. I want to create, edit and delete cards with a name, description and resolved status, filter by status and retain data after reload. No AI or external websites in the first version, and no automatic edits to my novel. Use the attached StoryForge Skill and API contract. Deliver an installable package, source, usage instructions and actual test results.

You do not need to choose a database or framework. Explain the work/world scope, visible UI, button actions, saved content, AI/network needs and what success looks like. Ask the assistant to explain choices where you are unsure.

## Option two Load it as a Skill

If your assistant supports folder-based `SKILL.md`, import the entire extracted folder using that tool's own skill mechanism, not just the entry file. Use **storyforge-plugin-author**. Syntax such as `$storyforge-plugin-author` depends on the assistant and is not universal.

Without Skill support, explicitly ask the AI to read `SKILL.md` and its relevant references. This Skill is for an external coding assistant, not StoryForge's creative Skill registry. It grants no publishing account or upload authorization.

## Expected assistant workflow

1. Check the kit API/SDK against the target host and environment. Explain mismatches; `api=1` alone does not guarantee compatibility across all preview builds.
2. Map the requested outcome to public capabilities. Identify supported, adjusted and unsupported parts. Request missing interfaces instead of modifying private host source and presenting that as a plugin.
3. Choose a relevant example and read only relevant references. Implement in an independent plugin folder.
4. Run `check` and `pack`, then install and test persistence in an isolated work. State which checks were unavailable without a browser or model credentials.
5. Deliver the package, source, README, versions/dependencies, network/cost explanation and test record. Prepare [publication materials](./publish), but obtain your explicit authorization before publishing publicly.

## Recognize a finished result

Expect an importable `.sfplugin`, not merely snippets, screenshots or “build succeeded”. The installed feature should operate as described, with saving, reload, disabling and reinstallation verified. Separate model, real-network and local-service tests; mocks do not prove live service availability.

For clue cards, you should create two cards, change status, filter and recover after reload. That does not imply automatic extraction from an entire novel; that requires separate confirmation of supported context and AI interfaces.
