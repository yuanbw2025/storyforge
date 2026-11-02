# Longform: continuity, post-chapter review, and revision

## Post-chapter review: save selections before confirming writes

Open post-chapter review, check each candidate against the prose, and select only what should be written this time. Wait for confirmation that candidates and saved selections can recover after reload before leaving. Unsaved selections pause confirmation: retry saving the selection, or explicitly discard the unsaved selection and select again. Unchecked rows are not written. The original model response remains available for inspection; malformed output is not adopted by guessing row positions. If the source changed, inspect the current chapter and candidate; no hidden model resend occurs.


Longform continuity combines original prose, confirmed facts, summaries, and retrieval. Models can still miss or misinterpret details, so each chapter needs author review.

## After a chapter

Check proposed changes to relationships and states, inventory, event timing, foreshadowing, facts, and plot/subplot progress. Confirm only content supported by the prose that should guide future writing.

A character's guess is not necessarily an objective fact; a secret known to the author is not necessarily known to every character.

## How the tools fit together

| Tool | What to check |
| --- | --- |
| Foreshadowing board | Setup, responses, payoff, and chapter links |
| Fact library and knowledge | Evidence, who knows what, abnormal or stale records |
| States and inventory | Continuity of character states, acquisition, and consumption |
| Story timeline | Chronological order of plot events |
| Plots and progress | Whether the chapter advances established storylines |
| Revision and impact checks | Which future plans and records an edit affects |

## Recovering malformed state fields

The step-mode stability repair now merged into main identifies malformed state cards in the prose editor while keeping manual editing and saving available. Related generation pauses to avoid writing with incomplete state; damaged records are not cleared or rewritten automatically. See [development status](/en/updates/development-status) for mainline and release availability.

1. Choose “Repair state fields” to open “States and inventory”.
2. Optionally export the original fields before opening the affected card.
3. Enter each field name and text value. Explicitly remove unwanted malformed items. The original-content editor is available when the underlying format needs inspection.
4. Save the repair. Validation or storage failure preserves the original record and current input so it can be corrected and retried.
5. Reload to confirm persistence, then return to prose generation.

If another window has changed the card, the older repair is rejected. Keep your input and reopen the card to compare the new state before proceeding. Use [backup and restore](/en/guides/backup-restore) for complete backups; a state-text export is not a full backup.

## Save candidate edits before reloading

A prose candidate can be saved with “Save candidate edits” before reloading or editing further. Saving updates the candidate only; changing formal prose still requires explicit adoption. Switching steps first attempts to save candidate edits; failure blocks navigation and retains the input. Before a direct reload or close, confirm that the candidate has been saved and has not yet been adopted. On narrow screens, the prose toolbar scrolls with the page so candidate save and adoption controls remain reachable.

Clearing a candidate keeps its editor available for new input. A blank candidate cannot be saved or adopted. Candidate draft saving and state repair merged into main with [PR #215](https://github.com/yuanbw2025/storyforge/pull/215). See [version compatibility](/en/updates/compatibility) for installer availability.

## Revising an early chapter

1. Save a version or complete backup.
2. Edit the prose and confirm it actually saved.
3. Check whether old summaries, facts, or reviews are stale.
4. Read the impact list; decide individually how to adjust later plans, foreshadowing, and settings.
5. Update affected content before generating the next chapter.

One revision does not automatically rewrite the whole novel. Confirmed history, current candidates, and future plans must be handled separately.

## When AI misses an earlier detail

Check whether the detail belongs to this work, is confirmed, precedes this chapter, and still has valid prose/summary evidence. Inspect the current generation's sources; explicitly mention the relevant event in this round's requirements if needed.

Repeated generation may not fix an omission and adds cost. Submit the issue and relevant chapters as [feedback](/en/feedback/bug).

For checking memory files on disk, see the [local memory workspace](/en/features/memory-workspace).
