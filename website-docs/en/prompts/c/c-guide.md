# Using fiction Prompts in StoryForge

::: tip Source and scope
Translation of the original Word asset's Chinese migration. These methods are separate from current product implementation; task variables and boundaries are preserved.
:::


Use each stage through prepare materials → run Prompt → inspect result → choose adoption, rather than one generation deciding everything.

## 1. Three project parameters

1. **Length mode:** longform, short fiction, or novella/shorter fiction.
2. **Delivery:** complete manuscript, volume-based creation, ongoing serial.
3. **Main genre promise:** one primary genre with supporting genres; do not load every rule.

These decide which Prompts, how much context, and which rules do not belong in the work.

## 2. Stages and workspaces

| Stage | Prepare in StoryForge | Main output | Before adoption |
| --- | --- | --- | --- |
| P00 Brief | Ideas, length, genre, exclusions | Brief, decisions | Faithful to author goal? |
| P01 Inspiration | Notes, references, images, fragments | Idea cards, combinations | Mechanisms retained, fingerprints removed? |
| P02 Positioning | Genre, readers, experience | Promises, differentiation | Concrete and fulfillable? |
| P03 Core | Concepts, characters, world ideas | Conflict, premise, thematic question | Sustained choices/consequences? |
| P04 Research | Questions, rules, fact requirements | Boundaries, conditions, plot effects | Facts separate from assumptions? |
| P05 World | Core, geography, institutions, powers | Causal chains, texture, limits | Affects choices? |
| P06 Characters | Core, world pressure, drafts | Drives, relationships, arcs, states | Behavioral evidence? |
| P07 Plot engine | Goals, conflict, storylines | Escalation, information, collisions | Choices rather than coincidence? |
| P08 Structure | Core, arcs, ending | Turns, climax, payoff route | Serves this story? |
| P09 Length branches | Structure, delivery | Volumes, short compression, serial plans | Only applicable rules enabled? |
| P10 Chapters/scenes | Task, states, foreshadowing, emotion | Tasks, cards, titles | Clear change per scene? |
| P11 Prose | Plans, beats, continuity, style | Opening, continuation, dialogue, action, narration | Respects facts/states? |
| P12 Continuity | Prose and known facts | Summary, handoff, diffs, timeline | Evidence for every change? |
| P13 Macro revision | Outline, summaries, prose, facts | Diagnosis, priorities, route | Diagnose/confirm before rewrite? |
| P14 Language | Selected prose, goal, style | Scene/dialogue/viewpoint/pacing edits | Within allowed scope? |
| P15 Readers | Opening, excerpt, promises | Comprehension, gaps, risks | Simulation treated as risk, not fact? |
| P16 Packaging | Core, outline, summaries | Titles, blurbs, synopsis, tags | Accurate promises/spoiler control? |
| P17 Management | Prompt, I/O, adoption, feedback | Review, comparison, tests | Upgrade supported by varied cases? |

## 3. Minimum prose context

Prioritize material directly related to the chapter:

1. Chapter task and beats.
2. Prior ending, handoff, previous plan reconciliation.
3. Recent summaries and relevant distant prose excerpts.
4. Present characters, relationships, states, confirmed facts.
5. Relevant rules, places, items, ability limits.
6. Foreshadowing/storylines to advance or avoid paying off early.
7. Time, action order, important item ownership.
8. Author style and necessary character-language examples.

If excessive, rank by chapter relevance, certainty, impact of mistakes. Do not retain only recent text or indiscriminately send the whole work.

## 4. Four Prompt types

### Generation

Generate candidates, check structure/facts/format, then let authors adopt. For core, worlds, characters, outlines, prose.

### Extraction

Every result must trace to prose evidence; list conflicts separately. For summaries, states, items, timeline, foreshadowing.

### Diagnosis

Default to problems, evidence, impact, repair direction—not direct factual changes. For structure, continuity, reader validation.

### Revision

Preserve original, specify goal/scope, compare differences, then confirm writeback. For restructuring, scenes, language.

## 5. Recommended routes

### New longform

P00 → P02 → P03 → P05/P06/P07 cycle → P08 → P09L → P10/P11/P12 cycle → P13/P14/P15 → P16.

### Serial longform

Enable P09R within longform. Serial parameters affect rewards, breaks, production rhythm, not character logic, world rules, prose facts.

### Short fiction

P00 → P01/P03 → P09S → simplified P10 → P11 → P14/P15 → P16.

### Existing-prose revision

P13 macro diagnosis → P12 continuity audit → P14 targeted revision → P15 reading validation → P16 packaging.

## 6. Adoption principles

1. Confirmed prose outranks old plans and genre conventions.
2. Explicit author decisions outrank AI candidates.
3. Confirm structured results by character, relationship, foreshadowing, timeline, etc.; do not use one free-text blob to modify many areas.
4. Conflicts, gaps, uncertainty go to review, not automatic facts.
5. Preserve prior versions before important prose/settings writeback for comparison/reversal.
6. For multiple worlds/timelines/viewpoints, verify the correct world, time, and character scope.

## 7. Common mistakes

- Batch chapters before stabilizing the core.
- Sending all settings, characters, history to every prose call.
- Concurrent tasks modifying the same character/chapter.
- Writing diagnosis suggestions as facts.
- Enabling longform, short, and serial rules together.
- Checking attractive wording but not causality, continuity, ownership.
- Revising prose without updating states, timeline, future plans.

## 8. Completion standard

A call is complete only when input scope is clear, format complete, no unauthorized factual changes occurred, conflicts are marked, scope/ownership are correct, the author chose adoption or rejection, and downstream information has been synchronized.
