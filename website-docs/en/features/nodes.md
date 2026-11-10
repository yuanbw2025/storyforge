---
productId: authoring.nodes
status: preview
lastVerified: 2026-10-19
---
# Node authoring

> Preview. Full cross-mode interoperability and real user paths are still being validated.

See the [longform quality trial](/en/updates/development-status) for development-branch whole-chapter review, independent scoped revision, and downstream continuation after adoption. These changes are unmerged and undeployed, and are not included in existing downloads.

Entry: Longform → Workbench → Node authoring (长篇 → 长篇工作台 → 节点创作). Nodes place inputs, generation steps, and intermediate results on a canvas for inspection and composition.


## Field versions and recovery

Formal world-setting and story-core field production retains candidate versions, author drafts and adoption records. Inspect candidates and actual sources before explicit adoption. Changes limited to node coordinates, titles or other presentation properties preserve recovery against the original execution inputs. Recheck freshness after execution-graph, configuration or source changes. Reconfirming an already confirmed result reuses its receipt. Other node families follow their own available recovery prompts. See [PR #255](https://github.com/yuanbw2025/storyforge/pull/255).

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

## Continuing with old prompt workflows

Formal longform nodes use Workbench → Node authoring. The prompt library retains old workflows under Prompt experiments (提示词实验), with editing, copying, import, and export. Experimental execution is off by default and requires opting in for the current visit. Outputs can be copied or exported but cannot directly write to the official work; useful text can enter the setting-extraction candidate flow for review and confirmation.

Choose Convert to formal nodes (转换为正式节点) and inspect the step and edge mappings. If compatible, Confirm copy as formal nodes (确认复制为正式节点) creates a graph for the current work while preserving the original workflow and configuration. Fixed templates, custom variables, unsupported targets, and unsupported edges are reported individually and block conversion. Retain the original and configure those parts manually in the formal canvas; conversion never silently drops them.

## Node maintenance and recovery

The following changes are delivered through [PR #115](https://github.com/yuanbw2025/storyforge/pull/115). Use its full checks and merge state to assess delivery, and verify online deployment separately:

- Single-field nodes offer generation requirements (生成要求). The node library supports search, with experimental drafts hidden by default.
- Run to this node (运行到此节点) handles the selected node and its required ancestors. Other unfinished branches can remain drafts.
- Candidate edits and version selections save automatically. Mode changes wait for saving; failures retain input. Rejecting a candidate does not write to the work. Adopted and rejected results remain read-only.
- Nodes with a fixed target character offer adoption into that same character, visible in step mode. Changes to the original content or target prevent old candidates from overwriting it.
- After an interrupted refresh, recover saved results first. Recovery itself does not call a model; continuing production is a separate action.
- On phones, the library, canvas, node settings, and candidates/evidence have separate views. Switching views retains edits.

Automated tests use isolated model responses and do not establish literary quality. Full cross-mode acceptance of every official longform template remains pending. See [development status](/en/updates/development-status).

## Free graph editing and prompt selection

These operations are node preview improvements in PR #115; the online version depends on the corresponding deployment result.

1. Click or drag a node from the library, or right-click/double-click empty canvas space to search and create one.
2. Drag backward from an input port or forward from an output port. Release on empty canvas space, search compatible nodes and select one: the chosen port is connected automatically. You can also drag directly to a compatible port on an existing node.
3. Select a node and disconnect an edge under Connected edges (已连接的线) before reconnecting it. Escape cancels the picker. Canvas controls zoom in/out or restore 100%.
4. Drag from a generation node's Prompt input to add a Prompt template (Prompt 模板) node. Search built-in or personal templates, adjust template parameters, fill required variables and supplementary instructions, or expand the node-local prompt editor.
5. The selected version and adjustments save with the graph and do not change global templates. Click Save (保存), confirm Saved (已保存), then refresh. Required inputs must be supplied before model calls.
6. Temperature, output-token limits and candidate-count controls take effect through their corresponding ports. Rerun after upstream changes; old candidates cannot be adopted over new work.

The picker only lists compatible registered nodes. Experimental drafts require explicit opt-in and cannot write directly into the formal work.
