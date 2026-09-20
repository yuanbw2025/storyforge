# Style learning and interactive calibration

Entry: Longform workbench → Style learning (文风学习). It summarizes writing habits you approve into a style profile for the current work, which later generation can reference. It does not train or fine-tune a model, and does not automatically rewrite completed prose.

## What it learns from

The corpus comes from polished chapters and saved before/after revision samples. Chapters must be marked Modified, Polished, or Final (已修改 / 已润色 / 定稿); a raw draft may not represent the style you want to retain.

Revision samples contain the before text, after text, and author notes. “Remove explanatory narration; express emotion through action” explains your choices better than two texts alone. Currently, up to eight sample pairs can be saved; samples with author notes are prioritized. Each learning run has count and length limits shown in the UI.

## The profile and its switch are separate

“Learn my style” or “Relearn my style” first produces a pending profile. Before confirmation, it neither replaces the official profile nor enables downstream injection.

After confirmation, edit My style profile (我的文风画像); edits save on blur. The Injecting/Off (注入中 / 已关闭) switch controls use in supported later generation. Turning it off preserves the profile; deleting it also deletes the current work's revision samples and calibration feedback.

A saved profile does not mean every AI call uses it. Task purpose and actual context still determine use.

## Test it with interactive calibration

Interactive calibration (互动校准) accepts a short passage, currently up to 1,600 characters. Generation rewrites only that passage to test the profile; it does not directly overwrite a chapter.

Compare the rewrite with the original, mark Closer or Needs adjustment, and explain why. Approved edits can be saved as revision samples for the next relearning run. Saving feedback does not itself regenerate the profile.

## Division of responsibilities

| Feature | Main purpose |
| --- | --- |
| Creative rules | Viewpoint, tone, prohibitions, and requirements for the work |
| Style profile | Approved language and expression habits |
| Project reference analysis | Structure, techniques, and research from a particular work |
| Current generation instructions | What this call may change and must preserve |

Resolve conflicting requirements before repeated test generations. Learning and calibration call models; a small representative corpus makes results easier to judge than indiscriminate repeated analysis.

Related: [Project references](/en/features/longform/references) · [Costs](/en/guides/token-cost).
