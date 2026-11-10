---
productId: independent.comic
status: released
lastVerified: 2026-09-20
---
# Novel to comic

Turn a novel into a comic script, pagination, panels, images, and lettering. Entry: Comic → Library (漫画 → 作品库); select or create an adaptation, then enter Comic production (漫画制作台).


## After a task fails or the page reloads

Check task-list states such as failed, paused, recovering or requiring verification, and inspect the original task evidence. Recover an available saved candidate, review it and explicitly adopt it. Preserve the record when the original request result is unknown. Explicitly starting a new request creates a separate call that may incur charges. A failed recovery read keeps the error available for another inspection. See [PR #255](https://github.com/yuanbw2025/storyforge/pull/255).

## Watch a motion-comic sample

Open **The Last Letter (末班来信)** from Comic → Library or Home → Example works → Comic. The 50-second sample plays with sound in a new tab without model configuration. It supports play, pause, seeking, replay, volume, fullscreen, and a still-frame comparison. Landscape viewing with headphones is recommended. Return to the comic examples to read the existing four complete page comics.

This independently prepared sample combines limited animation, camera movement, and atmospheric effects. It does not mean the current comic product can automatically generate equivalent animation, and viewing creates or changes none of your works. Initial viewing requires a network connection to load assets. Sound starts only after you press play; switching tabs pauses playback.

## Recommended sequence

1. **Source and plan:** confirm source scope, reading direction, length, facts, causality, and alteration decisions.
2. **Comic script:** translate narration into visible action and dialogue; plan page rhythm.
3. **Panels and layout:** check shots, panel count, and reading order, then edit dialogue, captions, balloons, and sound effects.
4. **Visuals and assets:** establish character, location, and prop appearance; manage references and panel-image candidates.
5. **Quality review:** check narrative, reading flow, text, and asset completeness; revise issues.
6. **Reading preview:** read through in the actual direction.
7. **Versions and export:** choose storyboard or visual edition; pass its checks, save a version, and export.

## Confirm panels before producing images

Check that panels tell the story before spending on image generation. Dialogue and balloons live in a separate lettering layer; fixing a typo does not require regenerating an entire panel image.

Human reading is still needed to check obscured text and continuity of character actions.

## Image-service limitations

Configuring a text model does not configure an image service. The built-in generic OpenAI-compatible image adapter currently generates from text. Writing “reference image” in a Prompt does not mean an image was sent to the model.

Reference images, fixed seeds, and inpainting depend on the actual adapter. If the UI blocks or downgrades an operation, read its capability notice. Use author-supplied materials you have rights to at permitted entries.

## Two deliverables

- **Storyboard edition:** validates scripts, panels, and reading structure.
- **Visual edition:** also requires valid selected images, lettering, and asset checks.

PNG, WebP, CBZ, and PDF delivery are supported; availability depends on version type and completion state. Frozen versions retain media references. Do not manually clear browser data to free image storage.

The comic and source novel remain separate. Comics do not offer world derivation. Continue: [Export and delivery](/en/guides/export) · [Data and privacy](/en/guides/privacy).
