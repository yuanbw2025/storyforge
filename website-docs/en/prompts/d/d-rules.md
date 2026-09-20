# Motion-comic Prompt engineering and quality rules

This reference covers staged design, source fidelity, audiovisual executability, review and workflow integration. It is a method library, not a claim that every stage is automated in StoryForge.

## Five core conclusions

1. **Separate script and storyboard.** Source → key events and adaptation decisions → standard script → storyboard production package → image/video/voice/editing. Combining writer, director, shot designer, image-Prompt author and reviewer in one pass causes mismatched fields and timing.
2. **Hooks never outrank the source.** Derive them from danger, status differences, unfinished actions, revelations or emotional breaks. Do not fabricate facts, reveal information early or break the continuation.
3. **Fast pacing does not mean deleting causality.** Keep the prerequisites for dialogue, knowledge and action; remove repetition.
4. **Visualization is not jargon.** Turn psychology into actions, microexpressions, spatial relationships, props and visible consequences. Do not combine contradictory shot sizes, unrenderable abstractions or excessive dialogue/actions in a short shot.
5. **Use validation gates.** Duration, cast, speakers, fidelity and continuity are recurring risks.

## Failure classes and review order

Watch for unfinishable shots; mismatched hooks, pacing and information density; missing fields; dialogue/narrator/speaker mistakes; omitted, altered or expanded facts; inconsistent appearance, state or relationships; broken causality, chronology, space or knowledge; stiff, inaccurate or out-of-character lines; incorrect shot arithmetic; and compliance or production limits.

Review in this order: facts and speakers → causality and continuity → duration and action load → character and visual consistency → rhythm and hooks → formatting and language → compliance and production feasibility.

## Separate the work into stages

1. **Source evidence:** characters, identities, relationships, chronology, locations, props, knowledge, original lines/actions, causal links, foreshadowing and the supplied endpoint. Trace changes to evidence.
2. **Adaptation decisions:** keep, compress, merge, reorder, visualize, permitted completion and prohibited additions. Completion may clarify actions/transitions, never invent plot beyond the endpoint.
3. **Script:** episode/scene headings, cast, actions, dialogue, necessary OS/VO and sound. Do not write image Prompts for individual shots here.
4. **Storyboard:** use the confirmed script for shots, continuity tables, duration, size, viewpoint, composition, action, dialogue, effects, start/end frames and differentiated image Prompts.
5. **Independent review:** diagnose first, then revise only flagged problems.

## Quality rules

- Reduce explanation cost; short durations require simple mechanisms.
- Match genre and audience conflict: sweet romance needs relationship/growth, suspense needs cognitive updates, gratification drama needs pressure/release—not merely more actions.
- Express an arc as starting state → trigger → choice → cost → ending behavior.
- Do not slice evenly. Merge weak episodes and give climax/reward space. Every episode needs a function and handoff state.
- Replace metaphorical descriptions with performable posture, gaze, expression, action and consequence.
- Make dialogue colloquial without losing logic, identity or prerequisite exchanges.
- Adult behavior, procedures, distance, information access and prop use must be credible, not artificially childish.
- Formatting is production quality: wrong speakers, OS/VO or duration are not cosmetic errors.

## Timing model

For clear **Chinese** speech, start at **3.5–4 Chinese characters/second**; emotional delivery, crying and pauses need **3–3.5**, with pauses included. These are not English word-rate targets.

Allow roughly 1–2 seconds for expression/gaze, 2–3 for a simple action, 4–6 for an action with setup and result. Blocking, interaction, prop handling and multiple reactions usually need more than 5 seconds; split when necessary.

Concurrent dialogue/action takes the larger duration; sequential activity adds up. Allow 0.5–1 second for transitions. Split, cut or extend impossible shots—never falsify the total. Every shot needs start, end and duration; sum all rows and compare with the target. Fix content/allocation, not just the total label.

## Visual continuity

Anchor age, build, face, hair, outfit baseline, distinctive marks and colors. Track scene-specific injury, dirt, wetness, props, emotion, position and facing. Keep lighting, weather, time, layout and screen direction consistent.

Give each shot one main visual task. Split major changes of shot size, position or action phase. Separate global constants from shot variables. Describe appearance fully at first, then reference IDs and state changes.

## Reverse-engineering a Prompt from samples

Validate the sample first. Classify observed facts, inferred rules, incidental choices, errors and unknowns; record evidence and confidence. Absence is not prohibition without explicit instructions, repeated patterns or comparison evidence. Treat numbers as variables, not universal constants.

Reproduce capability and structure, not the sample plot. Test unseen material from the same class for structure, style, fidelity, rhythm and format—not verbatim similarity. Human review remains mandatory.

## Acceptance checklist

Check inputs/placeholders; facts versus variables; one stage per task; boundaries; knowledge and speakers; source-derived hooks and endpoint; timing/load; downstream readability; no unwanted preamble; self-checks that diagnose failure rather than fabricate a pass; minimal useful few-shot examples; and independent review of high-risk facts, rights, platform rules and AIGC requirements.

## Asset record

Record asset ID, version, stage, read inputs, write fields, facts, variables, prohibitions, schema, acceptance criteria, failure classes, tests and change history.
