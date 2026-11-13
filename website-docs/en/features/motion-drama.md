---
productId: independent.motion-drama
status: released
lastVerified: 2026-11-13
---
# Motion-comic materials and preproduction

## November 13: saving, recovery and usage checks

Before adopting shot prompts, verify coverage of every shot in the current episode; duplicate numbers cannot stand in for a complete list. Version conflicts during rapid episode changes preserve the newer selection. Reference-package export verifies the actual selected images, voice assets and other files against that version and original bytes; missing files stop export. It does not silently substitute current drafts, and prompt-only editions do not include media. Sources: [#312](https://github.com/yuanbw2025/storyforge/pull/312), [#385](https://github.com/yuanbw2025/storyforge/pull/385).


Start with a sentence, local novel, or imported source to prepare a series bible, episode scripts, assets, storyboards, and Prompts for external video production. Entry: Motion-comic materials → Library → Production workbench (漫剧素材 → 作品库 → 漫剧制作台).

Delivery stops before external video generation. This workflow does not generate video, select takes, edit, mix audio, or produce a finished film inside StoryForge.


## After a task fails or the page reloads

Check task-list states such as failed, paused, recovering or requiring verification, and inspect the original task evidence. Recover an available saved candidate, review it and explicitly adopt it. Preserve the record when the original request result is unknown. Explicitly starting a new request creates a separate call that may incur charges. A failed recovery read keeps the error available for another inspection. See [PR #255](https://github.com/yuanbw2025/storyforge/pull/255).

## Before starting

Define source scope, work type, target length, visual style, and intended external tools. When using a novel, check the frozen source first. A separate world is not required.

## Production workflow

1. **Novel source:** check input and frozen scope.
2. **Series bible and episode planning:** confirm season dynamics, character arcs, episode turns, and end hooks.
3. **Asset library:** prepare characters, costumes, locations, props, and audio references; record versions and usage rights.
4. **Episode beats and scripts:** develop action, dialogue, sound, and timing episode by episode.
5. **Storyboards and reference frames:** set shot purpose, composition, performance, and transitions; select reference frames.
6. **Image and motion Prompts:** separately check static composition versus action, camera motion, and end state.
7. **Quality review:** check continuity, completeness, rights, and target-tool constraints.
8. **Versions and delivery → Tool adaptation package:** organize per-shot inputs for the target tool, then use them externally.

## Using adaptation packages

The implementation includes Seedance, Runway, LTX, and generic adaptation directions. Inspect each shot's Prompt, reference materials, and input slots in the provided package, then complete settings in the target tool.

A package means content was organized for that direction; it does not guarantee every capability in a third-party platform's current version, plan, or API. Follow that tool's actual size, count, duration, and permission requirements.

## Revision considerations

After changing the series bible or asset versions, inspect affected episodes and shots. Confirm candidates before keeping a new delivery version, and avoid mixing character assets and storyboards from different versions.

Images, audio previews, and text may use different services with separate charges. Organizing existing content or running deterministic adaptation does not itself call a video model.

Continue: [Motion-comic Prompt methods](/en/prompts/d/d-rules) · [Costs and tokens](/en/guides/token-cost).
