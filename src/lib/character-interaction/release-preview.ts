import type {CharacterInteractionProductRuntimePackageV1} from '../types'

/** A player-facing projection of an already verified release. No author draft,
 * role-private knowledge, future possibility or hidden goal enters the preview. */
export function chatReleasePreviewV1(pkg: CharacterInteractionProductRuntimePackageV1) {
  const content = pkg.interaction, story = content.chatNarrative
  const scenes = content.sceneTemplates.filter(scene => !story || scene.sceneKey === story.initialSituation.sceneKey)
  return {
    title: pkg.definition.title,
    description: pkg.definition.description,
    persona: story ? {name: story.persona.name, description: story.persona.description} : null,
    canStartAction: !!story?.permissions.triggers.includes('scene-start'),
    scenes: scenes.map(scene => ({
      sceneKey: scene.sceneKey, title: scene.title, location: scene.location, timeLabel: scene.timeLabel,
      participants: scene.participantKeys.map(key => content.profiles.find(p => p.participantKey === key))
        .filter(p => p != null).map(p => ({participantKey: p.participantKey, name: p.name, roleLabel: p.roleLabel})),
      facts: story ? story.initialSituation.facts.filter(f => f.audienceKeys.includes(content.playerKey)).map(f => f.text) : [],
    })),
  }
}

/** Validate before creating a session, so an invalid or unprepared opening does
 * not leave a new empty save behind. Absence preserves the default start API. */
export function resolveChatOpeningSceneV1(pkg: CharacterInteractionProductRuntimePackageV1, sceneKey?: string) {
  const scenes = chatReleasePreviewV1(pkg).scenes
  const scene = sceneKey === undefined ? scenes[0] : scenes.find(s => s.sceneKey === sceneKey)
  if (!scene) throw new Error('此版本没有已准备好的所选开场，请重新选择作品或开场。')
  return scene.sceneKey
}
