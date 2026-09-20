# AI generation, candidate confirmation, and recovery

## A normal generation cycle

1. Select the correct work, chapter, or scene and define this task.
2. Check inputs, existing material, model, and task parameters.
3. Start generation; wait for a result or an explicit error.
4. Read the candidate and check facts and scope. Edit, reject, or adopt through permitted actions.
5. Check that official content was written and handle downstream effects.

Formal flows preserve run records and version evidence to explain failures and support recovery. Recovery capabilities differ by entry; follow the current page's guidance.

## Candidate states

| Notice | Suggested action |
| --- | --- |
| Ready for adoption | Still read it and confirm it matches your intent |
| Usable with warnings | Inspect warnings; edit or accept where permitted |
| Manual repair required | Preserve usable text and fix the specific problem |
| Blocked or stale | Resolve source, scope, permission, or version issues first |

A complete model response does not mean saving conditions passed. If you edit the source while a candidate is pending, the old candidate may be blocked from adoption.

## After a failure

Preserve the current result, inspect the failure stage and reason, then decide whether to recover or retry. Balance, authentication, permissions, or an unknown network outcome are not reasons to repeatedly resend.

If the page offers recovery of the same run, first check for existing results and pending candidates. Rerunning the entire flow is not necessarily recovery.

## Effective instructions

State the goal, scope, required preservation, permitted changes, and output form. “Polish only this dialogue, preserving decisions and event order” is easier to check than “improve everything.”

The [Prompt library](/en/prompts/) offers methods. External Prompts do not automatically gain whole-project read access or permission to write official content.

## Literary quality still needs the author

Rule and structure checks catch some problems, but cannot guarantee motivation, causality, voice, or literary effect. Validate the model with a small task before scaling up.

Continue: [Cost control](/en/guides/token-cost) · [Troubleshooting](/en/guides/troubleshooting).
