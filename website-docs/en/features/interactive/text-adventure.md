---
productId: upper.text-adventure
status: preview
lastVerified: 2026-10-28
---
# Text adventure

> Preview. Professional production, asset review, publishing, and deterministic runtime are implemented; real-model content quality, human playtesting, and the first community-recommended finished work still require dedicated acceptance.

Text adventures combine action choices, inventory, abilities, quests, and endings. Each work references a frozen world version and owns its production artifacts, images, releases, and play progress.

## Choose play or production

For immediate play, open [Fog Harbor: The Lost-Tide Bells](/en/guides/examples) from Home → Example works. No model API is needed.

The Text adventure entry includes Works and playtests (作品与试玩), Product direction (产品定向), Automatic production (自动制作), Quality and assets (质量与素材), Publish and export (发布与导出), and Start adventure (开始冒险). Select the correct workspace and work first. Formal production requires explicit authorization and valid world sources. If an older build only shows a development entry, check [versions](/en/updates/compatibility).

## From sources to a playable version

1. Select a world version in Product direction and specify the intended experience, story scope, scale, and budget.
2. Check source sufficiency. Fill gaps or make the explicitly allowed decisions before production.
3. Review story and cast plans, quests, scenes, and dialogue in Automatic production, resolving pending confirmations.
4. In Quality and assets, review visual direction and character/scene images. Authors confirm visual requirements and images; independent review must pass before delivery.
5. Check quest routes, consequences, and endings through automated and actual playtests. Repair failed artifacts and affected dependencies first; follow authorization prompts if the budget is exhausted.
6. Check the frozen release and product package in Publish and export, then start from that version. After importing a product package, verify sources, assets, and the new save. A package serves a different purpose from a complete-project JSON backup.

## Workspace, library, and save navigation

Returning between the library, production workspace, and play through the top Text adventure tab preserves and revalidates the selected workspace. Invalid Work identities or those outside the current work do not load a player. If a target is missing, return to the library and select it again without clearing browser data.

Switching saves or branching within one work updates the route to the actual selected save while retaining player panels. Older asynchronous reads cannot replace a newer list after a quick switch or leaving the page. For local read errors, use the error area's recovery controls and verify work/save names before continuing. This repair does not establish the cause of occasional whole-window exits. Source: [PR #208](https://github.com/yuanbw2025/storyforge/pull/208).

## Play and recovery

Frozen rules explicitly settle quest completion and rewards. Branches retain their own committed actions and prose; hints cannot claim an unfinished ending has occurred. The save panel displays the verified work version; refresh and continued play do not silently switch versions.

The quest journal groups objectives by category. Inventory, equipment, skill points, and action explanations help you decide what to do next. Preconditions and resources constrain choices; actual events determine endings. Generated prose alone is not proof that an objective completed.

Progress binds to a frozen version. Check the version and save when refreshing or recovering. Use supported recovery paths after corruption warnings; do not manually alter frozen data. For failed or paused production, inspect the existing run and retained artifacts before restarting the entire work.

Task-repair input now survives the initial progress load instead of being cleared as that load completes. Switching productions or changing the run-control version still resets the relevant inputs. Unsubmitted drafts are not guaranteed to survive refresh; see [candidate persistence and recovery input](/en/guides/ai-workflow).

## Library, playtests, and local revisions

Works and playtests now groups cover cards by work. Open details to start, continue, or choose a save; historical versions of the same work appear in those details. A Build with valid provenance but no formal publication is explicitly labeled Unpublished playtest (未发布试玩), not a signed product release. If the selected Build changed before starting, refresh the library and confirm again.

Reading offers immersion, font, contrast, and reduced-motion controls. Starting, continuing, branching, and refreshing preserve the corresponding save. Characters in a scene follow its frozen cast list. Unavailable choices explain missing objectives, items, or resources, and completed actions provide explicit feedback.

Production supports version-constrained local revisions to accepted stories, cast, scene plans, prose, dialogue, and routes. Check the impact and rerun affected dependencies. Pause recovery, uploaded image replacements, and visual review retain the existing production flow, old Builds, and saves. Time-capacity revisions may only raise the limit, not reduce the time available in an older version.

These capabilities entered main through [PR #100](https://github.com/yuanbw2025/storyforge/pull/100) on October 4, 2026. The Tidal Bell Isles: The Last Light (潮钟群岛：最后的灯火) remains a local unpublished playtest: merging engineering code does not publish that work or make it available in a fresh installation. Local images and browser saves do not travel with Git. See [Pending development](/en/updates/development-status) for other branches requiring review.

## Revise final text while retaining illustrations

These operations entered main through [PR #119](https://github.com/yuanbw2025/storyforge/pull/119), after the v4.0.0 archive. Check your build against [Compatibility](/en/updates/compatibility) first.

1. In the current text-adventure production, expand Revise final text and retain illustrations (advanced) (修订定稿并保留插图（高级）) and select Download editable current final text (下载可编辑的当前定稿).
2. Keep the JSON version and original-artifact identifiers intact. Edit only allowed text, quests, or choices. This is neither a whole-project backup nor a way to replace characters, places, or art direction.
3. Import the revision file, inspect the changes and retained-image count, and confirm image retention plus the continuing independent visual-review and human-playtest requirements.
4. Select Create revision and review again (创建修订版并重新审校). A new Build checks prose, dialogue, continuity, visual evidence, and automatic play. Older versions and saves remain and do not automatically migrate.

If the original has changed, download its current version again; do not edit version numbers to bypass validation. Review retries and backup recovery still verify image authorization, bytes, and frozen provenance. Missing or invalid evidence blocks progress; retaining images does not waive publication review. Complete the applicable human acceptance after revision.

## Export a standalone web game

The same main-branch update adds Export standalone web game (导出独立网页游戏) alongside the existing full product package in Publish and export. It requires a formal ProductRelease, valid media, and the existing human-playtest and community-candidate eligibility. An unsigned playtest Build cannot be exported as a formal web work.

1. Select a formal version that passes eligibility verification, then choose Export standalone web game.
2. Download and extract the ZIP. Serve the complete directory on an HTTPS static host or through a local HTTP server; do not double-click `index.html`. Hosting beneath a site subdirectory is supported.
3. Players open that directory to play its frozen story and rules without installing StoryForge or connecting to AI services. The package retains required media and licenses, not the entire authoring workspace, private configuration, or production history.
4. Export neither uploads nor publishes the work. Check content and media rights separately and choose hosting explicitly if you intend to publish.

Saves remain in the current browser and site storage, isolated by package identity. Moving addresses, browsers, or exporting a new version does not automatically migrate old saves; keep the old package for existing playthroughs. If the player-template build is missing, use a current build containing it rather than modifying the package to bypass checks. Technical delivery does not establish real-model quality or human acceptance of any particular work.

Evidence: [Production flow](https://github.com/yuanbw2025/storyforge/commit/237f1912) · [Product packages](https://github.com/yuanbw2025/storyforge/commit/ecc178b8) · [Mainline production path](https://github.com/yuanbw2025/storyforge/commit/fdc5b87c).
