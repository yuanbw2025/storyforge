# Current capabilities and maturity

> Checked October 28, 2026 · main baseline: 46a90c0b. Tagged releases, current main, and live deployments may differ; see [version compatibility](/en/updates/compatibility).

“Released” follows the product catalog: the declared main workflow is available. It does not announce a new semantic version or guarantee model quality. “Preview” has usable implementation but still needs complete-experience validation. “Experimental” is not an everyday-use commitment.

| Product | Status | Current result and boundary |
| --- | --- | --- |
| [Step-by-step longform](/en/features/longform/) | Released | Settings through prose, post-chapter review, memory, and revision impact; literary quality needs author judgment |
| [Short fiction](/en/features/shortform) | Released | Intent through review, targeted rewriting, frozen versions, and export |
| [Novel to screenplay](/en/features/screenplay) | Released | Frozen sources, professional adaptation, dual review, and screenplay-format export |
| [Novel to comic](/en/features/comic) | Released | Script, panels, lettering, visuals, and versions; image capabilities depend on the service |
| [Motion-comic materials](/en/features/motion-drama) | Released | Episodes, storyboards, assets, and per-shot tool packages; no video generation or finished film |
| [World engine](/en/features/world-engine) | Released | Independent semantic editing, derivation, sealed versions, and neutral reading |
| [Node authoring](/en/features/nodes) | Preview | Reuses longform capabilities; full cross-mode interoperability remains under validation |
| [TTRPG](/en/features/interactive/ttrpg) | Preview | Production, open trial, AI hosting, rules, saves, and narration; public online multiplayer is not deployed |
| [Character chat](/en/features/interactive/character-chat) | Preview | Single-character illustrated technical preview, relationship memory, experience packages, and branches; stable multi-turn/cross-image consistency await acceptance |
| [AI town](/en/features/interactive/ai-town) | Preview | Resident life, schedules, relationships, and replay; long-term model and asset quality need validation |
| [Text adventure](/en/features/interactive/text-adventure) | Preview / in development | Professional production, asset review, publishing, and runtime are connected; real-model and human acceptance remain |
| [AVG](/en/features/interactive/avg) | Preview | Image/audio production, local processing, presentation, prototypes, and recovery; professional narrative/audiovisual quality needs per-work acceptance |
| [Text open world](/en/features/interactive/open-world) | Preview / in development | Dedicated production, player UI, runtime AI, and Salt Ridge showcase are connected; real-provider calibration and human acceptance of both endings remain |
| Community marketplace | Experimental | Hidden by default; public accounts, cloud sync, and commercial services are not current commitments |

## Examples are not general-purpose capability

[Fog Harbor: The Lost-Tide Bells (雾港：失潮钟声)](/en/guides/examples) is a prepared, no-API work with text-adventure and AVG modes. Being fully playable does not mean all general-purpose game-production capabilities are complete.

## Shared boundaries

- Core creative data is primarily local; back up before changing environments.
- AI uses your model service and may incur charges; authors review and confirm candidates.
- World/work references have explicit versions; later changes do not automatically synchronize everywhere.
- There is no promise that AI never forgets, works never contradict themselves, or commercial-ready results are automatic.

Engineering evidence: [Product catalog](https://github.com/yuanbw2025/storyforge/blob/46a90c0b/src/lib/product/product-catalog.ts) · [Capability baseline](https://github.com/yuanbw2025/storyforge/blob/46a90c0b/docs/roadmap/CAPABILITY-BASELINE.md).

All local branches were also inspected. [Pending development](/en/updates/development-status) separates unmerged work, local-only changes, and historical changes whose equivalence still needs review; these are not counted as delivered mainline capabilities above.
