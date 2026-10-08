---
productId: authoring.nodes
status: preview
lastVerified: 2026-10-08
---
# Node authoring

> Preview. Full cross-mode interoperability and real user paths are still being validated.

Entry: Longform → Workbench → Node authoring (长篇 → 长篇工作台 → 节点创作). Nodes place inputs, generation steps, and intermediate results on a canvas for inspection and composition.

## When to use it

Once familiar with step-by-step longform, try a small workflow to break down a generation, reuse intermediate materials, or inspect upstream/downstream inputs.

For daily writing, you can continue using [step-by-step longform](/en/features/longform/).

## Recommended trial

1. Save a full backup and choose a small task.
2. Check input requirements of official nodes/templates and connect required materials.
3. Execute incrementally, checking actual inputs and outputs at each step.
4. Use permitted candidate-confirmation entries to write to the official work.
5. Return to the step-by-step interface and check the official result.

Official nodes reuse longform capabilities, works, and memory. Experimental-node drafts cannot directly become official settings.

## Current limitations

A connected graph does not guarantee semantic correctness. The preview canvas is not a second independent work database. Correct invalid connections, stale inputs, or missing permissions as prompted before execution.

Continue: [AI candidates and recovery](/en/guides/ai-workflow).

## Two node entry points

Node authoring in the longform workbench uses formal domain nodes. The workflow editor in the prompt library provides This node's template (本节点模板), material bindings, and AI hints (给 AI 的提示). These are separate entries: updates to prompt workflows do not establish that the domain canvas was updated.

Prompt workflows can use [Forge Writing Workshop](/en/guides/using-prompts) templates. Specify variables when connecting upstream material; a connection alone does not supply missing inputs.

## Maintenance in the October 8 development branch

The following changes are being validated in an independent development branch. They do not yet establish an online deployment:

- Single-field nodes offer generation requirements (生成要求). The node library supports search, with experimental drafts hidden by default.
- Run to this node (运行到此节点) handles the selected node and its required ancestors. Other unfinished branches can remain drafts.
- Candidate edits and version selections save automatically. Mode changes wait for saving; failures retain input. Rejecting a candidate does not write to the work. Adopted and rejected results remain read-only.
- Nodes with a fixed target character offer adoption into that same character, visible in step mode. Changes to the original content or target prevent old candidates from overwriting it.
- After an interrupted refresh, recover saved results first. Recovery itself does not call a model; continuing production is a separate action.
- On phones, the library, canvas, node settings, and candidates/evidence have separate views. Switching views retains edits.

Automated tests use isolated model responses and do not establish literary quality. Full cross-mode acceptance of every official longform template remains pending. See [development status](/en/updates/development-status).
