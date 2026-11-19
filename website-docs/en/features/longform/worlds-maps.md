# Multiple worlds, locations, and maps

## November 19: 2D atlas and three visual styles

Choose Sketch map / Illustrated map / Continuous painting in the world map. Sketch uses paper and line symbols; Illustrated offers Chinese or European assets. Existing settings produce a bounded geometry candidate for review and explicit adoption. Styles share the layout without adding geographic facts. Based on #493/#495/#501.

Filter 18 layers, zoom/pan, return to the full map, adjust labels and export the current style as PNG. Lake holes/islands, shared coastlines and roads across water use shared geometry; authors must still review the image.

Continuous painting supports reference-image editing, imported images and base-map packages. Results remain view-local until confirmed; map/layout changes isolate old results, and failures are not automatically resent. Natural features are combined in a painted image; use a procedural style for independent natural-layer filtering. **Images are excluded from complete project backups: export a base-map package before leaving and import it later.** Restoration checks geometry fingerprints and actual image data. This is not a 3D or game-publication feature.

## November 13: saving, recovery and usage checks

Wait for worldview/geography drafts to save before switching worlds, works or groups. Failures retain the draft and offer retry; another group's successful save does not clear this draft's error. Empty groups do not show the preceding group's locations. Concept-map preview failures can retry local decoding without replacing the original image. World-rule save failures retain their current draft. Sources: [#332](https://github.com/yuanbw2025/storyforge/pull/332), [#367](https://github.com/yuanbw2025/storyforge/pull/367).


Longform settings serve the current work; independent worlds in the world engine support sealing and reuse. Editing longform settings does not require converting the novel into a separate world.

## When multiple worlds help

If worlds, planes, or eras have different rules, locations, and character affiliations, manage their scopes and passages under Work overview → Multi-world settings (作品概况 → 多世界设置).

Check the current world before editing a module. Identical character names do not imply the same entity; different worlds' power rules must not be mixed automatically. A cross-world passage is an explicit relationship, not universal interoperability.

## Location library, geography, and maps

Open Worlds and settings → Locations and maps (世界与设定 → 地点与地图) to switch between the location library, geography, world map, city entries, and association preview. Old geography and map links still open their corresponding views. Location entities, geographic trees, and map layouts keep their original data; equal names do not trigger automatic merges. City entries can explicitly link to existing locations, and the preview distinguishes those references from unmapped records.

| Entry | Main content |
| --- | --- |
| Location library | Identifiable places and their narrative purpose |
| Geography settings | Environments, regions, and spatial relations |
| World map | Visual geography and entity positions |

A map does not replace location descriptions. Plausible travel also depends on distance, transport, rules, and story time.

## After generating a map

Generation produces a candidate first. Preview its configuration, named entities, and spatial relations. Only Confirm this map (确认使用此地图) replaces the official map; discarding the candidate preserves the original.

Check geography before generation and important locations, adjacency, and connectivity afterward—not just visual appeal. The 3D map remains a Labs feature marked unavailable in the UI.

## When to derive a world

To provide confirmed novel settings to other products, use Derive world (派生世界), specify scope, and inspect the result. Both sides are maintained separately afterward; map, character, or rule changes do not automatically synchronize back to the source work.

Related: [World engine](/en/features/world-engine) · [Sealing and references](/en/concepts/versions).
