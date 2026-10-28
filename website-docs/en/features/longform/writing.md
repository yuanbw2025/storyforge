# Longform: outlines, scene beats, and prose

![Current longform outline workbench: authoring steps on the left, volume/chapter structure on the right](/assets/current/longform-outline-current.png)

## Three levels

| Level | Question | Recommended content |
| --- | --- | --- |
| Volume and chapter plans | How does the story progress? | Volume goal, chapter events, turns, and continuity |
| Scene beats | How does this chapter unfold? | Character actions, conflict, scene changes, and exit state |
| Prose | What does the reader actually read? | Narration, action, dialogue, and concrete detail |

## Recommended sequence

The optional scene tasks, whole-chapter review, and scoped revision below apply to source versions containing [PR #141](https://github.com/yuanbw2025/storyforge/pull/141), merged into main on October 20, 2026.

1. Select a volume or chapter in Outline and chapter plans (大纲与章纲); establish the current level.
2. Write or generate outline candidates; check continuity with completed content before confirming.
3. In Scene beats (场景细纲), check characters, locations, conflicts, turns, and the chapter ending.
4. In Prose (正文), select the correct chapter; inspect this round's requirements and visible generation evidence.
5. Review the candidate, edit unsuitable passages, then confirm writing it back.
6. Check the actual prose and save state, then perform [post-chapter review](/en/features/longform/continuity).

## Add chapter instructions before generating prose

After choosing generation or continuation, use Prose generation instructions (正文生成提示) for this chapter's focus, pace, viewpoint, or length. The text shares the chapter's custom instruction; leaving it blank uses existing material. Confirmation enters the existing save, budget, and generation flow. Cancelling retains temporary input for the chapter without a model request.

Check the chapter name and instructions after switching chapters. Results still require review and explicit adoption. A custom template omitting the hint variable still receives the current instructions. Source: [PR #209](https://github.com/yuanbw2025/storyforge/pull/209).

## Scene outlines and chapter tasks

Select the chapter in Outline and chapter plans, then open the separate Scene beats page. Expand optional scene tasks (场景任务) to record the entering state, scene goal, key choice, consequences, leaving state, and scene function / reader expectations. Fields may remain blank. Everyday, transition, and closing scenes are supported without requiring a punishment, enemy, or reward in every scene.

Use Edit this chapter’s scene outline (编辑本章细纲), Write this chapter (写本章正文), and View this chapter’s scene outline (查看本章细纲) to move within the same chapter. Wait for current edits to save. Check requirements, sources, and target length before generation; requested length is not an exact guarantee.

## Whole-chapter review and scoped revision

1. Save the prose, open Quality review (质量审校), and choose Review, Expression and repetition, or Read-on appeal. Optionally enter Review instructions (本轮评审补充要求), then choose Start detection (开始检测). Incomplete chapter coverage blocks review; complete coverage can still miss or misjudge issues.
2. Check quotations and select the issues to address. By default, only issue paragraphs may change. Expand Select other editable paragraphs (选择其它可改段落) when needed. In Protected quotations (保护原句), enter one exact original quotation per line; each must occur only once in the original.
3. Optionally enter Revision instructions (本轮修稿要求), including actions, character expression, or closure to preserve. Choose Generate revision and recheck (生成修订并复核). A round permits one revision and one recheck, at most two additional model requests.
4. Wait for the saved candidate and complete recheck, compare the versions, then confirm adoption or discard. A failed recheck retains a read-only preview and preserves the original. Authors must judge improvement even when the model reports it.
5. Refreshing restores reports, instructions, and decisions without resending. Changed prose or sources can invalidate older reports and candidates. Inspect changes before explicitly starting another round.

Node mode uses the same workflow. Connect Whole-chapter review and revision (全文评审与修订) and Scoped revision and recheck (定向修订与复核); select issues, scope, prompt, temperature, output limit, and AI configuration. Wait for official output before adopting or rejecting, then verify the same prose and formatting in step mode. Continuing after upstream adoption rereads current sources. Changed targets, sources, or links can still invalidate older candidates. Node mode as a whole remains a preview.

These controls improve source handoff and author control; they do not guarantee a more engaging story or platform acceptance. Independent reader review and author timing are optional follow-up evaluations for this delivery. No questionnaire is required to use the features.

## Continuation and rewriting

Continuation should follow the existing ending; polishing focuses on expression; rewriting may change events and characterization. Define the scope before calling AI, and keep the original or a version record.

If important facts change, do not judge only the revised passage's fluency. Check effects on later chapter plans, foreshadowing, and character states.

## When continuation preparation or outline dismissal fails

If saving current edits, preparing continuity material, or assembling generation context fails after you choose Continue, the prose area shows the reason. Preserve the current text, address the indicated saving, material, or configuration issue, then explicitly retry. Generation not starting is not a save or completion acknowledgment.

When dismissing a scene-outline or batch-outline candidate, a failed save of the rejection shows an error and retains the pending candidate for inspection and retry. The candidate is cleared only after rejection succeeds; failure is not recorded as successful dismissal. Preserve useful content rather than clearing the work.

Both fixes are documented in [PR #166](https://github.com/yuanbw2025/storyforge/pull/166).

## Recovering malformed story-arc stages

A Stage data format error preserves the original data. Pause AI generation for that story arc and export a complete backup first. Open the affected arc and choose Inspect and repair stage data (检查并修复阶段数据), comparing each stage and its key events with the original JSON.

Keep valid stage IDs, existing events, and other content. Use an empty array only when there were no key events; do not erase events merely to remove an error. Once checked, choose Confirm stage repair save (确认保存阶段修复). A failed save or changed original is not a completed repair: review the error and current content. Discard edit draft (放弃编辑稿) restores the original content. Deleting a stage detaches associated progress references, so check its effects first. Preserve the original and report uncertainty when the format cannot be determined.

This addresses malformed reads and explicit author recovery. The original malformed writer remains unconfirmed, and the repair does not resolve native exits or every longform issue. Source: [PR #226](https://github.com/yuanbw2025/storyforge/pull/226).

## After outline changes

After moving or editing chapters, check order, prose correspondence, foreshadowing links, and the story timeline. Existing prose is important evidence; regenerating an outline should not make you disregard the story already written.

## Why generation was not saved directly

Formal AI results usually require candidate confirmation. The end of streaming only means generation ended; adoption determines whether content became official. If a result fails or becomes stale, preserve usable text and read the reason first.

Details: [AI candidates and recovery](/en/guides/ai-workflow) · [Export and delivery](/en/guides/export).

## Scene generation has ended but the candidate is still being saved

After “Split into scenes” or “Improve scene outline” stops streaming, the interface may still say that it is validating and saving the candidate or establishing a recoverable candidate. Wait: editing, adoption, dismissal, and retry are not yet available. Review and confirm only after the candidate is successfully saved. Fully displayed text is not a save acknowledgment that makes it safe to close the page.

This waiting-state protection entered main on October 5, 2026 through [PR #107](https://github.com/yuanbw2025/storyforge/pull/107). It does not adopt the candidate for you.

## Saving, dragging, and switching chapters

Work-information and story-core editors preserve the current draft; use the displayed save action and verify persisted content. Dragging a chapter near a list edge scrolls the list. Check ownership after moving between volumes. When switching chapters quickly, generation status and recoverable candidates should match the current target, not the previous chapter.

Read streaming output progressively. Edit prose candidates before adoption while retaining revision evidence. Generation, adoption, and persistence are separate states; check the save acknowledgment before leaving or refreshing.

The October 4 mainline fix corrects cases where existing material was incorrectly reported as a missing mandatory resource, and reduces false conflicts between events that can coexist. Actual missing information and conflicting states still require attention; do not delete facts to bypass a block.

## Adopting outline Agent candidates and stale notices

Give the main Agent an outline goal, choose “Discuss and plan” (讨论与规划), review the proposed plan, then choose “Confirm plan and start” (确认计划并开始). Review candidate titles and content; only “Adopt” (采纳) writes them into the work. Refreshing should restore a still-pending candidate without automatically generating or adopting it again.

[PR #158](https://github.com/yuanbw2025/storyforge/pull/158), merged on October 16, 2026 in China, fixes a mismatch between the generation and adoption policy identities during automatic volume/chapter outline composition that incorrectly marked valid candidates as stale. Actual changes to sources, permissions, or content still invalidate candidates. Preserve useful text and inspect the reason; do not clear the work or disable freshness checks to bypass a notice.


## Search, bulk replacement, and saving

Prose search/replace and the global replacement tool share one interface. Text replacement (文字替换) handles the current chapter or whole book; Entity rename (智能实体改名) updates character, location, and entry references; Across setting fields (跨设定字段) edits descriptive text in selected areas.

Preview each record's before/after text, then confirm snapshot creation and replacement. HTML tags, entity names, entry references, numeric fields, and option fields are not ordinary text targets. Multiple text fields in one entry save together. Changes after preview stop the replacement; preview again. Undo refuses to overwrite later edits. After closing the page, find the pre-replacement snapshot in version history.

Scene-outline and emotion-beat coordination reports the actual save result. Pending saves do not report success early; failures preserve the original and allow retry.

In generation previews and run details, expand Prompt and style sources / overrides (提示词与文风来源、覆盖关系) to inspect the frozen template, parameters, and whether creative rules or style profiles were included. Missing evidence does not establish that a source was read.

## Continuing after detailed outline generation stops

When generating detailed chapter plans in chunks from Outline and chapter plans, preserve existing candidates. If a predecessor snapshot or source notice appears, read the error, check the target chapter and related content, address the cause, then explicitly retry from the original action. Do not clear the work or disable validation. Review and adopt the completed candidate explicitly.

[PR #171](https://github.com/yuanbw2025/storyforge/pull/171) preserves the predecessor candidate text needed by chunked generation, fixing interruptions caused by missing snapshots after context truncation. Actual candidate or source changes still block the operation and require another review.
