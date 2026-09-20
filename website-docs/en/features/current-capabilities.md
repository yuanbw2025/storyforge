# Current capabilities and maturity

> Checked September 20, 2026 · main baseline: 58892a5b. Tagged releases, current main, and live deployments may differ; see [version compatibility](/en/updates/compatibility).

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
| [TTRPG](/en/features/interactive/ttrpg) | Preview | Production, AI hosting, rules, and saves; public online multiplayer is not deployed |
| [Character chat](/en/features/interactive/character-chat) | Preview | Text conversations, relationship memory, and branches; long-term behavior remains under validation |
| [AI town](/en/features/interactive/ai-town) | Preview | Resident life, schedules, relationships, and replay; long-term model and asset quality need validation |
| [Text adventure](/en/features/interactive/text-adventure) | Preview / in development | General-purpose entry is not a formal feature; try built-in works first |
| [AVG](/en/features/interactive/avg) | Preview | Production, presentation, and player saves; general audiovisual quality needs per-work acceptance |
| [Text open world](/en/features/interactive/open-world) | Preview / in development | Production/runtime foundations exist; long-term evolution and the complete experience are unfinished |
| Community marketplace | Experimental | Hidden by default; public accounts, cloud sync, and commercial services are not current commitments |

## Examples are not general-purpose capability

[Fog Harbor: The Lost-Tide Bells (雾港：失潮钟声)](/en/guides/examples) is a prepared, no-API work with text-adventure and AVG modes. Being fully playable does not mean all general-purpose game-production capabilities are complete.

## Shared boundaries

- Core creative data is primarily local; back up before changing environments.
- AI uses your model service and may incur charges; authors review and confirm candidates.
- World/work references have explicit versions; later changes do not automatically synchronize everywhere.
- There is no promise that AI never forgets, works never contradict themselves, or commercial-ready results are automatic.

Engineering evidence: [Product catalog](https://github.com/yuanbw2025/storyforge/blob/58892a5b/src/lib/product/product-catalog.ts) · [Capability baseline](https://github.com/yuanbw2025/storyforge/blob/58892a5b/docs/roadmap/CAPABILITY-BASELINE.md).
