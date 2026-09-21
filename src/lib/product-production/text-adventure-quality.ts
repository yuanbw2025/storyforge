import { textAdventureConflictingLocationAliasesV1 } from '../adventure/production-artifacts-v2'

export function isTextAdventureReadableGlyphViolationV1(issue: {
  severity?: unknown
  category?: unknown
  detail?: unknown
}): boolean {
  if (issue.severity !== 'warning' || typeof issue.detail !== 'string') return false
  return issue.category === 'text'
    || /(?:可读|清晰可辨|清晰可见).{0,40}(?:文字|汉字|字母|数字|罗马|英文|符文|伪文字|标牌|名牌)/i.test(issue.detail)
    || /(?:文字|汉字|字母|数字|罗马|英文|符文|伪文字|标牌|名牌).{0,40}(?:可读|清晰可辨|清晰可见)/i.test(issue.detail)
}

export interface TextAdventurePlayerPerspectiveIssueV1 extends Record<string, unknown> {
  severity: 'blocking'
  artifactKey: 'content.narrative'
  detail: string
  recommendation: string
}

export interface TextAdventureUnauthorizedKinshipIssueV1 extends Record<string, unknown> {
  severity: 'blocking'
  artifactKey: 'content.narrative'
  detail: string
  recommendation: string
}

export interface TextAdventureDialogueAttributionIssueV1 extends Record<string, unknown> {
  severity: 'blocking'
  artifactKey: 'content.narrative'
  detail: string
  recommendation: string
}

export interface TextAdventureSceneSpeakerAuthorityIssueV1 extends Record<string, unknown> {
  severity: 'blocking'
  artifactKey: 'content.narrative' | `content.scene-script.act-${1 | 2 | 3}`
  detail: string
  recommendation: string
}

export interface TextAdventureQuestLocationAuthorityIssueV1 extends Record<string, unknown> {
  severity: 'blocking'
  artifactKey: 'content.main-quest-plan'
  detail: string
  recommendation: string
}

function artifactKeyForTextAdventureBeatV1(
  beatKey: string,
): TextAdventureSceneSpeakerAuthorityIssueV1['artifactKey'] {
  const match = /(?:^|\.)act-([1-3])(?:\.|$)/u.exec(beatKey)
  return match
    ? `content.scene-script.act-${Number(match[1]) as 1 | 2 | 3}`
    : 'content.narrative'
}

/**
 * The narrative arc is the authority for who may participate in a scene.
 * Global Cast membership alone is insufficient: accepting any registered
 * character in any scene caused role swaps and invented appearances to pass.
 */
export function textAdventureSceneSpeakerAuthorityIssuesV1(
  narrativeValue: unknown,
  arcPlanValue: unknown,
  castValue?: unknown,
): TextAdventureSceneSpeakerAuthorityIssueV1[] {
  if (!narrativeValue || typeof narrativeValue !== 'object' || Array.isArray(narrativeValue)
    || !arcPlanValue || typeof arcPlanValue !== 'object' || Array.isArray(arcPlanValue)) return []
  const narrative = narrativeValue as Record<string, unknown>
  const arcPlan = arcPlanValue as Record<string, unknown>
  const cast = castValue && typeof castValue === 'object' && !Array.isArray(castValue)
    ? castValue as Record<string, unknown> : null
  const characters = (Array.isArray(cast?.characters) ? cast.characters : []).flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    if (typeof row.key !== 'string' || typeof row.name !== 'string' || !row.name.trim()) return []
    const name = row.name.trim()
    const parts = name.split(/[·・•]/u)
    const suffix = (parts[parts.length - 1] ?? '').trim()
    return [{ key: row.key, name, aliases: [...new Set([name, suffix].filter(Boolean))] }]
  })
  const allowedByScene = new Map<string, Set<string>>()
  for (const actValue of Array.isArray(arcPlan.acts) ? arcPlan.acts : []) {
    if (!actValue || typeof actValue !== 'object' || Array.isArray(actValue)) continue
    const act = actValue as Record<string, unknown>
    for (const sceneValue of Array.isArray(act.sceneCards) ? act.sceneCards : []) {
      if (!sceneValue || typeof sceneValue !== 'object' || Array.isArray(sceneValue)) continue
      const scene = sceneValue as Record<string, unknown>
      if (typeof scene.key !== 'string' || !Array.isArray(scene.castKeys)) continue
      allowedByScene.set(scene.key, new Set(scene.castKeys.filter((value): value is string => (
        typeof value === 'string'
      ))))
    }
  }
  const issues: TextAdventureSceneSpeakerAuthorityIssueV1[] = []
  for (const value of Array.isArray(narrative.beats) ? narrative.beats : []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const beat = value as Record<string, unknown>
    if (beat.kind !== 'dialogue' || typeof beat.nodeKey !== 'string'
      || typeof beat.speakerKey !== 'string') continue
    const allowed = allowedByScene.get(beat.nodeKey)
    const beatKey = typeof beat.beatKey === 'string' && beat.beatKey.trim()
      ? beat.beatKey.trim() : 'unknown-beat'
    if (!allowed) continue
    if (!allowed.has(beat.speakerKey)) {
      issues.push({
        severity: 'blocking',
        artifactKey: artifactKeyForTextAdventureBeatV1(beatKey),
        detail: `[owningKey=${beat.nodeKey}] ${beatKey} 的 speakerKey=${beat.speakerKey} 未列入该冻结场景的 castKeys`,
        recommendation: `不得仅因该角色存在于全局 Cast Bible 就将其放入 ${beat.nodeKey}。若角色本就不在场，将该 beat 改为不伪装成对白的旁白/环境记录；若故事必须由其当面发言，先返回叙事弧场景卡显式登记角色，再重写场景。`,
      })
    } else if (typeof beat.text === 'string') {
      const attributedCharacter = characters.find(character => (
        !allowed.has(character.key)
        && character.aliases.some(alias => new RegExp(
          `${escapeTextAdventureRegExpV1(alias)}(?:的)?(?:(?:终于|再次|缓缓|忽然|还是)?开口|说(?:道)?|问(?:道)?|喊(?:道)?|回答|回应|打断|喝(?:道|问)|反驳|警告|命令|接(?:话|过话)|低声|沉默|语气|声音|指(?:向|了)|走(?:来|到|出)|蹲下|转身|一把)`,
        ).test(beat.text as string))
      ))
      if (attributedCharacter) {
        issues.push({
          severity: 'blocking',
          artifactKey: artifactKeyForTextAdventureBeatV1(beatKey),
          detail: `[owningKey=${beat.nodeKey}] ${beatKey} 的正文把对白或伴随动作归给「${attributedCharacter.name}」(${attributedCharacter.key})，但该角色未列入冻结场景 castKeys；speakerKey=${beat.speakerKey} 不能掩盖越界登场`,
          recommendation: `保持 ${beat.nodeKey} 的冻结场景目的与 castKeys 不变，删除「${attributedCharacter.name}」的当面发言、动作和冲突，把本场只写成已授权角色可完成的内容；该角色的正式对峙应留在已登记其 castKeys 的场景。不得仅修改 speakerKey。`,
        })
      }
    }
    if (issues.length >= 20) break
  }
  return issues
}

/** Recompute quest-copy/location contradictions even for carried artifacts. */
export function textAdventureQuestLocationAuthorityIssuesV1(
  questPlanValue: unknown,
  locationTitles: readonly string[],
): TextAdventureQuestLocationAuthorityIssueV1[] {
  if (!questPlanValue || typeof questPlanValue !== 'object' || Array.isArray(questPlanValue)) return []
  const questPlan = questPlanValue as Record<string, unknown>
  const issues: TextAdventureQuestLocationAuthorityIssueV1[] = []
  for (const questValue of Array.isArray(questPlan.quests) ? questPlan.quests : []) {
    if (!questValue || typeof questValue !== 'object' || Array.isArray(questValue)) continue
    const quest = questValue as Record<string, unknown>
    for (const objectiveValue of Array.isArray(quest.objectives) ? quest.objectives : []) {
      if (!objectiveValue || typeof objectiveValue !== 'object' || Array.isArray(objectiveValue)) continue
      const objective = objectiveValue as Record<string, unknown>
      if (!Number.isSafeInteger(objective.locationOrdinal)) continue
      const expectedLocation = locationTitles[Number(objective.locationOrdinal) - 1]
      if (!expectedLocation) continue
      const fields = ['title', 'narrativePurpose'] as const
      const conflicts = fields.flatMap(field => {
        const value = objective[field]
        if (typeof value !== 'string') return []
        return textAdventureConflictingLocationAliasesV1({
          text: value, expectedLocation, locationTitles,
        }).map(alias => ({ field, alias }))
      })
      if (conflicts.length === 0) continue
      const objectiveKey = typeof objective.key === 'string' ? objective.key : 'unknown-objective'
      issues.push({
        severity: 'blocking', artifactKey: 'content.main-quest-plan',
        detail: `[owningKey=${objectiveKey}] 冻结地点为「${expectedLocation}」，但目标文案指向其他地点:${conflicts.map(item => `${item.field}=${item.alias}`).join('、')}`,
        recommendation: `保持 objective.key、sceneKeys 和 locationOrdinal 不变；将 title/narrativePurpose 改为「${expectedLocation}」内真正可执行的目标，不得引用其他已登记地点或其简称。`,
      })
      if (issues.length >= 20) return issues
    }
  }
  return issues
}

/**
 * Dialogue prose may include a short action tag, but an explicit “某人说/声音”
 * attribution cannot point at a different frozen speakerKey. Returning the
 * exact beat and expected key lets the bounded Scene Writer patch either the
 * accidental wrapper prose or the speaker field without regenerating a scene.
 */
export function textAdventureDialogueAttributionIssuesV1(
  narrativeValue: unknown,
  castValue: unknown,
): TextAdventureDialogueAttributionIssueV1[] {
  if (!narrativeValue || typeof narrativeValue !== 'object' || Array.isArray(narrativeValue)
    || !castValue || typeof castValue !== 'object' || Array.isArray(castValue)) return []
  const narrative = narrativeValue as Record<string, unknown>
  const cast = castValue as Record<string, unknown>
  const beats = Array.isArray(narrative.beats) ? narrative.beats : []
  const characters = (Array.isArray(cast.characters) ? cast.characters : []).flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    if (typeof row.key !== 'string' || typeof row.name !== 'string' || !row.name.trim()) return []
    const name = row.name.trim()
    // Cast display names may carry a role prefix (for example
    // “议会巡灯员·克罗”) while authored dialogue naturally uses only the
    // personal-name suffix. Treat that suffix as a frozen alias so a model
    // cannot hide a wrong speakerKey behind the shorter everyday form.
    const parts = name.split(/[·・•]/u)
    const suffix = (parts[parts.length - 1] ?? '').trim()
    return [{ key: row.key, name, aliases: [...new Set([name, suffix].filter(Boolean))] }]
  })
  const issues: TextAdventureDialogueAttributionIssueV1[] = []
  for (const value of beats) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const beat = value as Record<string, unknown>
    if (beat.kind !== 'dialogue' || typeof beat.text !== 'string') continue
    const beatText = beat.text
    const actualSpeakerKey = typeof beat.speakerKey === 'string' ? beat.speakerKey : ''
    const issueCountBeforeBeat = issues.length
    for (const character of characters) {
      if (character.key === actualSpeakerKey) continue
      const attributedAlias = character.aliases.find(alias => {
        if (!beatText.includes(alias)) return false
        const explicitAttribution = new RegExp(
          `${escapeTextAdventureRegExpV1(alias)}(?:的)?(?:(?:终于|再次|缓缓|忽然|还是)?开口|说(?:道)?|问(?:道)?|喊(?:道)?|回答|回应|打断|喝(?:道|问)|反驳|警告|命令|接(?:话|过话)|低声|沉默|语气|声音|指(?:向|了)|走(?:来|到|出)|蹲下|转身|一把)`,
        )
        return explicitAttribution.test(beatText)
      })
      if (!attributedAlias) continue
      const nodeKey = typeof beat.nodeKey === 'string' && beat.nodeKey.trim()
        ? beat.nodeKey.trim() : 'content.narrative'
      const beatKey = typeof beat.beatKey === 'string' && beat.beatKey.trim()
        ? beat.beatKey.trim() : 'unknown-beat'
      issues.push({
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: `[owningKey=${nodeKey}] ${beatKey} 的 speakerKey=${actualSpeakerKey || 'null'}，但正文明确把发言或伴随动作归给「${character.name}」(${character.key})${attributedAlias === character.name ? '' : `，正文使用冻结简称「${attributedAlias}」`}`,
        recommendation: `核对场景因果与 Cast Bible；若该句确为「${character.name}」发言，将 speakerKey 改为 ${character.key}；若只是当前角色转述，则保留 speakerKey 并删除误导性的第三人称发言包装。不得改动稳定 beat key。`,
      })
      break
    }
    if (issues.length > issueCountBeforeBeat) continue
    const nodeKey = typeof beat.nodeKey === 'string' && beat.nodeKey.trim()
      ? beat.nodeKey.trim() : 'content.narrative'
    const beatKey = typeof beat.beatKey === 'string' && beat.beatKey.trim()
      ? beat.beatKey.trim() : 'unknown-beat'
    const player = (Array.isArray(cast.characters) ? cast.characters : []).find(value => (
      value && typeof value === 'object' && !Array.isArray(value)
        && ((value as Record<string, unknown>).role === 'player'
          || (value as Record<string, unknown>).key === 'character.player')
    )) as Record<string, unknown> | undefined
    const playerName = typeof player?.name === 'string' ? player.name.trim() : ''
    const playerKey = typeof player?.key === 'string' ? player.key : ''
    if (actualSpeakerKey === playerKey && playerName
      && new RegExp(
        `${escapeTextAdventureRegExpV1(playerName)}[，,：:]?[^。！？!?\\n]{0,12}如果你(?:听到|读到|看到|收到|发现)`,
      ).test(beatText)) {
      issues.push({
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: `[owningKey=${nodeKey}] ${beatKey} 以玩家姓名向「你」留言，却把记录发言者标为玩家本人 ${actualSpeakerKey}`,
        recommendation: '先依据 Cast Bible 和场景出场表确认记录的真正来源；若来源角色已登记且在场景权限内，修正 speakerKey；否则改为 narration 并保持 speakerKey=null。不得猜测新角色。',
      })
      if (issues.length >= 20) return issues
      continue
    }
    const narratorDisguisedAsDialogue = /\u4f60的(?:\u58f0\u97f3|\u8bed\u6c14|\u76ee\u5149|\u624b)[^\u3002\uff01\uff1f!?\n]{0,30}(?:\u4f4e|\u9ad8|\u98a4|\u505c|\u843d|\u54cd|\u4f20|\u6536|\u79fb)/u.test(beatText)
      && /(?:\u6211\u4ee5\u4e3a|\u6211\u6ca1\u60f3\u5230|\u4ed6(?:\u539f\u672c)?[^\u3002\uff01\uff1f!?\n]{0,24}(?:\u80a9\u8180|\u76ee\u5149|\u624b|\u8eab\u4f53))/u.test(beatText)
    if (narratorDisguisedAsDialogue) {
      issues.push({
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: `[owningKey=${nodeKey}] ${beatKey} 的 kind=dialogue 但正文是第二人称旁白/角色动作，speakerKey=${actualSpeakerKey || 'null'} 无法作为说话者权威`,
        recommendation: '将叙述与真实台词拆分成独立 beat：旁白/动作使用 narration 或 action 且 speakerKey=null，只有角色可发声的原话使用 dialogue。',
      })
      if (issues.length >= 20) return issues
    }
    if (issues.length >= 20) return issues
  }
  return issues
}

const TEXT_ADVENTURE_KINSHIP_TERMS_V1 = [
  '父亲', '母亲', '爸爸', '妈妈', '儿子', '女儿',
  '兄长', '弟弟', '姐姐', '妹妹', '丈夫', '妻子', '配偶',
] as const

function escapeTextAdventureRegExpV1(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripTextAdventureQuotedSpansV1(value: string): string {
  // Player names inside a letter, recording, inscription or quoted NPC line
  // are content facts, not a narrator falling back to novel-style third
  // person.  Remove only closed quoted spans; unmatched quotes stay visible so
  // malformed prose cannot hide a real perspective defect.
  return value
    .replace(/「[^」\n]*」/gu, '')
    .replace(/『[^』\n]*』/gu, '')
    .replace(/“[^”\n]*”/gu, '')
    .replace(/‘[^’\n]*’/gu, '')
    .replace(/"[^"\n]*"/gu, '')
    .replace(/'[^'\n]*'/gu, '')
}

/**
 * Reject affirmative family-identity inventions for frozen cast members.
 * Contrast and separate-person facts stay legal.
 */
export function textAdventureUnauthorizedKinshipIssuesV1(
  narrativeValue: unknown,
  castValue: unknown,
): TextAdventureUnauthorizedKinshipIssueV1[] {
  if (!narrativeValue || typeof narrativeValue !== 'object' || Array.isArray(narrativeValue)
    || !castValue || typeof castValue !== 'object' || Array.isArray(castValue)) return []
  const narrative = narrativeValue as Record<string, unknown>
  const cast = castValue as Record<string, unknown>
  const beats = Array.isArray(narrative.beats) ? narrative.beats : []
  const characters = Array.isArray(cast.characters) ? cast.characters : []
  const issues: TextAdventureUnauthorizedKinshipIssueV1[] = []
  for (const characterValue of characters) {
    if (!characterValue || typeof characterValue !== 'object' || Array.isArray(characterValue)) continue
    const character = characterValue as Record<string, unknown>
    const name = typeof character.name === 'string' ? character.name.trim() : ''
    if (!name) continue
    const frozenAuthority = JSON.stringify(character)
    for (const beatValue of beats) {
      if (!beatValue || typeof beatValue !== 'object' || Array.isArray(beatValue)) continue
      const beat = beatValue as Record<string, unknown>
      const beatText = typeof beat.text === 'string' ? beat.text : ''
      if (!beatText.includes(name)) continue
      const sentenceUnits = beatText.split(/[。！？!?；;\n]/u).filter(unit => unit.includes(name))
      const unauthorizedTerms = TEXT_ADVENTURE_KINSHIP_TERMS_V1.filter(term => {
        if (frozenAuthority.includes(term)) return false
        return sentenceUnits.some(unit => {
          const nameIndex = unit.indexOf(name)
          const termIndex = unit.indexOf(term, nameIndex + name.length)
          if (termIndex < 0) return false
          const relationClaim = unit.slice(nameIndex, termIndex + term.length)
          if (/(?:不是|并非|绝非|并不是|不等于)/u.test(relationClaim)) return false
          return new RegExp(
            `${escapeTextAdventureRegExpV1(name)}[^。！？!?；;\\n]{0,24}(?:(?:如果|假如)[^。！？!?；;\\n]{0,8})?(?:原来|其实|确实|真|正|就)?(?:是|为|作为)[^。！？!?；;\\n]{0,8}(?:你|我|他|她|${escapeTextAdventureRegExpV1(name)})?(?:的)?${term}`,
          ).test(unit)
        })
      })
      if (unauthorizedTerms.length === 0) continue
      const nodeKey = typeof beat.nodeKey === 'string' && beat.nodeKey.trim()
        ? beat.nodeKey.trim() : 'content.narrative'
      const beatKey = typeof beat.beatKey === 'string' && beat.beatKey.trim()
        ? beat.beatKey.trim()
        : typeof beat.key === 'string' && beat.key.trim() ? beat.key.trim() : 'unknown-beat'
      issues.push({
        severity: 'blocking', artifactKey: 'content.narrative',
        detail: `[owningKey=${nodeKey}] ${beatKey} 把冻结角色「${name}」写成未获 Cast Bible 授权的亲属身份:${unauthorizedTerms.join('、')}`,
        recommendation: '保持角色 key、场景结构和既有关系弧不变；把该句改写为 Cast Bible 已冻结的真实关系，不得新增亲属揭示。',
      })
      if (issues.length >= 20) return issues
    }
  }
  return issues
}

/** These findings are regenerated from the current accepted artifacts. */
export function isTextAdventureRecomputedQualityIssueV1(issue: {
  detail?: unknown
}): boolean {
  return typeof issue.detail === 'string' && (
    issue.detail.includes('第二人称玩家叙事混入主角名')
    || issue.detail.includes('未获 Cast Bible 授权的亲属身份')
    || issue.detail.includes('但正文明确把发言或伴随动作归给')
    || issue.detail.includes('未列入该冻结场景的 castKeys')
    || issue.detail.includes('以玩家姓名向「你」留言')
    || issue.detail.includes('kind=dialogue 但正文是第二人称旁白')
    || issue.detail.includes('冻结地点为「')
  )
}

/**
 * Commercial text-adventure prose is authored as a second-person player
 * experience. Detect the unambiguous novel-style drift where narration or an
 * action beat repeatedly names the frozen player character. Dialogue and
 * system receipts may legitimately name the player and stay out of scope.
 */
export function textAdventurePlayerPerspectiveIssuesV1(
  narrativeValue: unknown,
  castValue: unknown,
  architectureValue?: unknown,
): TextAdventurePlayerPerspectiveIssueV1[] {
  if (!narrativeValue || typeof narrativeValue !== 'object' || Array.isArray(narrativeValue)
    || !castValue || typeof castValue !== 'object' || Array.isArray(castValue)) return []
  const narrative = narrativeValue as Record<string, unknown>
  const cast = castValue as Record<string, unknown>
  const characters = Array.isArray(cast.characters) ? cast.characters : []
  const player = characters.find(value => (
    value && typeof value === 'object' && !Array.isArray(value)
      && (value as Record<string, unknown>).role === 'player'
  )) as Record<string, unknown> | undefined
  const playerName = typeof player?.name === 'string' ? player.name.trim() : ''
  if (!playerName) return []
  const architecture = architectureValue && typeof architectureValue === 'object'
    && !Array.isArray(architectureValue)
    ? architectureValue as Record<string, unknown> : {}
  const registeredLocationTitles = (Array.isArray(architecture.regions) ? architecture.regions : [])
    .flatMap(region => {
      if (!region || typeof region !== 'object' || Array.isArray(region)) return []
      const areas = Array.isArray((region as Record<string, unknown>).areas)
        ? (region as Record<string, unknown>).areas as unknown[] : []
      return areas.flatMap(area => {
        if (!area || typeof area !== 'object' || Array.isArray(area)) return []
        const locations = Array.isArray((area as Record<string, unknown>).locations)
          ? (area as Record<string, unknown>).locations as unknown[] : []
        return locations.flatMap(location => {
          if (!location || typeof location !== 'object' || Array.isArray(location)) return []
          const title = (location as Record<string, unknown>).title
          return typeof title === 'string' && title.includes(playerName) ? [title] : []
        })
      })
    })
    .sort((left, right) => right.length - left.length)
  const beats = Array.isArray(narrative.beats) ? narrative.beats : []
  const examplesByNode = new Map<string, Array<{ beatKey: string; excerpt: string }>>()
  for (const value of beats) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const beat = value as Record<string, unknown>
    if (beat.kind !== 'narration' && beat.kind !== 'action') continue
    const beatText = typeof beat.text === 'string' ? beat.text.trim() : ''
    // A frozen location may legitimately contain the player name (for
    // example “岚舟童年故居遗址”). Remove exact registered place names before
    // testing prose perspective so the gate still catches “岚舟站在岚舟童年
    // 故居遗址前”, but does not reject a title card that names only the place.
    const proseWithoutQuotedSpans = stripTextAdventureQuotedSpansV1(beatText)
    const proseWithoutRegisteredLocations = registeredLocationTitles.reduce(
      (text, title) => text.split(title).join(''),
      proseWithoutQuotedSpans,
    )
    if (!proseWithoutRegisteredLocations.includes(playerName)) continue
    const nodeKey = typeof beat.nodeKey === 'string' && beat.nodeKey.trim()
      ? beat.nodeKey.trim() : 'content.narrative'
    const beatKey = typeof beat.beatKey === 'string' && beat.beatKey.trim()
      ? beat.beatKey.trim() : 'unknown-beat'
    const rows = examplesByNode.get(nodeKey) ?? []
    if (rows.length < 20) rows.push({ beatKey, excerpt: beatText.slice(0, 44) })
    examplesByNode.set(nodeKey, rows)
  }
  return [...examplesByNode].slice(0, 20).map(([nodeKey, examples]) => ({
    severity: 'blocking' as const,
    artifactKey: 'content.narrative' as const,
    detail: `[owningKey=${nodeKey}] 第二人称玩家叙事混入主角名「${playerName}」；位置与摘录：${examples.map(example => `${example.beatKey}=${example.excerpt}`).join('；')}`,
    recommendation: `保持 scene/beat 稳定 key、结构与事实不变；仅改写这些 narration/action beat 的 text，用「你/你的」指代玩家「${playerName}」，并同步消除同一 beat 中继续指代玩家的「她/她的」；不得改写 NPC 指代。`,
  }))
}

/**
 * Normalizes a reviewer issue to the Artifact that actually owns the named
 * fields. Review models occasionally call the assembled quest design a
 * "quest script" even when the defect is in the upstream objective topology.
 */
export function textAdventureQualityIssueOwnerArtifactKeyV1(
  issue: Record<string, unknown>,
): string {
  const artifactKey = typeof issue.artifactKey === 'string' ? issue.artifactKey : ''
  const detail = typeof issue.detail === 'string' ? issue.detail : ''
  const recommendation = typeof issue.recommendation === 'string' ? issue.recommendation : ''
  const evidence = `${detail}\n${recommendation}`

  // The architecture Artifact owns premise, themes, regions/areas/locations
  // and the visual bible. It never owns a runtime choice or a narrative-arc
  // decision. Reviewers sometimes use “architecture” colloquially for every
  // planning defect; collapse those claims to the registered owner before the
  // evidence is shown to authors or used to schedule a repair.
  const namesDecision = /(?:^|[^\w])decision\.[A-Za-z0-9._:-]+|(?:^|[^\w])option\.[A-Za-z0-9._:-]+|echoSceneKeys|跨场景回响/i.test(evidence)
  const namesChoice = /(?:^|[^\w])choice\.[A-Za-z0-9._:-]+|sourceNodeKey|targetNodeKey|选择文案|目标节点开场|(?:入边|出边|incoming|outgoing)[^\n]{0,40}(?:选择|choice|edge)|(?:选择|choice|edge)[^\n]{0,40}(?:入边|出边|incoming|outgoing)/i.test(evidence)
  const asksToChangeDecision = (
    /(?:新增|删除|移除|修改|改写|重写|调整|移动|重设|修正|变更|补充)[^\n]{0,120}(?:decision\.[A-Za-z0-9._:-]+|option\.[A-Za-z0-9._:-]+|decision[^\n]{0,30}(?:sceneKey|prompt|options?)|echoSceneKeys)/i.test(recommendation)
    || /(?:decision\.[A-Za-z0-9._:-]+|option\.[A-Za-z0-9._:-]+|decision[^\n]{0,30}(?:sceneKey|prompt|options?)|echoSceneKeys)[^\n]{0,120}(?:新增|删除|移除|修改|改写|重写|调整|移动|重设|修正|变更|补充)/i.test(recommendation)
  )
  const asksToChangeChoice = (
    /(?:新增|补充|添加|删除|移除|修改|改写|重写|调整|移动|重设|修正|变更)[^\n]{0,120}(?:choice\.[A-Za-z0-9._:-]+|sourceNodeKey|targetNodeKey|选择(?:边|项|分支|文案)?|(?:入边|出边|incoming|outgoing)\s*(?:choice|edge)?)/i.test(recommendation)
    || /(?:choice\.[A-Za-z0-9._:-]+|sourceNodeKey|targetNodeKey|选择(?:边|项|分支|文案)?|(?:入边|出边|incoming|outgoing)\s*(?:choice|edge)?)[^\n]{0,120}(?:新增|补充|添加|删除|移除|修改|改写|重写|调整|移动|重设|修正|变更)/i.test(recommendation)
  )
  const asksToRewriteNarrativeCopy = /(?:重写|改写|修改|调整|修正)[^\n]{0,100}(?:openingBeat|场景开场|节点开场|scene\.[A-Za-z0-9._:-]+[^\n]{0,30}(?:正文|文本|叙述))/i.test(recommendation)
  const namesArcScene = /sceneCards?|场景卡|acts?\[\d+\].*scene|冻结场景/i.test(evidence)
  // Only repair the one historically observed source error: the reviewer
  // occasionally uses “architecture” as a synonym for the whole narrative
  // design. Already-valid narrative/arc owners stay authoritative even when
  // their evidence quotes another Artifact for comparison. Stable decision
  // identities take precedence over incidental opening/location evidence.
  if (artifactKey === 'content.adventure-architecture') {
    if (namesDecision) return 'content.narrative-arc-plan'
    if (namesChoice || asksToRewriteNarrativeCopy) return 'content.narrative'
    if (namesArcScene) return 'content.narrative-arc-plan'
  }

  // The repair owner is determined by the field the reviewer explicitly asks
  // to mutate, not by a fallible model-supplied artifact label. A review may
  // correctly discover a missing final option while labelling the assembled
  // symptom as `content.narrative`; regenerating scene copy cannot add that
  // option and would otherwise fan the defect across every Scene Writer.
  if (namesDecision && asksToChangeDecision && !asksToChangeChoice) {
    return 'content.narrative-arc-plan'
  }
  // Incoming/outgoing edges and choice records are emitted by Scene Writers
  // and assembled into `content.narrative`.  A reviewer may report the
  // resulting reachability symptom on the public arc-plan Artifact, but the
  // arc planner cannot create that edge.  Route the mutation to its real
  // owner instead of repeatedly regenerating unchanged scene cards.
  if (artifactKey === 'content.narrative-arc-plan'
    && namesChoice && asksToChangeChoice && !asksToChangeDecision) {
    return 'content.narrative'
  }

  const dialoguePassMatch = /^content\.dialogue-pass\.act-([1-3])$/.exec(artifactKey)
  if (dialoguePassMatch) {
    // A batch reviewer can observe the post-dialogue narrative but not the
    // condition-gated route-echo actions emitted later by the runtime
    // compiler. Claims that a decision/scene lacks conditional route copy are
    // therefore assembled-narrative evidence, not wording work owned by the
    // Dialogue Pass. Normalize the owner so the compiled-echo guard below can
    // discard stale claims instead of endlessly rewriting valid dialogue.
    const reportsMissingCompiledRouteEcho = (
      /(?:路线|体验)差异|条件化(?:段落|内容|叙述)|前置状态|持久状态/u.test(evidence)
      && /decision\.[A-Za-z0-9._:-]+|flag\.decision\.[A-Za-z0-9._:-]+/i.test(evidence)
      && /scene\.[A-Za-z0-9._:-]+/i.test(evidence)
      && /(?:无|没有|未体现|不足|缺少|增加|补充|抹平|虚化)/u.test(evidence)
    )
    if (reportsMissingCompiledRouteEcho) return 'content.narrative'
    // Dialogue Pass only receives dialogue beats and choice copy. A reviewer
    // can still label an act-level perspective problem with the dialogue-pass
    // artifact because it inspected the post-pass narrative projection; route
    // narration/person errors back to the Scene Writer that owns those beats.
    const reportsNarrationPerspective = /narration|旁白/i.test(evidence)
      && /(?:第二人称|第三人称|玩家(?:角色)?|指代玩家|视角|「?她(?:的)?」?|「?岚舟」?)/u.test(evidence)
      && /(?:改为|替换为|统一使用|应使用|不得使用|不符合)/u.test(evidence)
    if (reportsNarrationPerspective) return `content.scene-script.act-${dialoguePassMatch[1]}`
    // Dialogue Pass owns wording only. A wrong speaker identity belongs to the
    // source Scene Writer; retrying the dialogue editor cannot change
    // beat.speakerKey and would reproduce the same blocker forever.
    const namesSpeakerOwnership = /speakerKey|说话者|说话人|发言者|对白归属|台词归属/i.test(evidence)
    const explicitlyPreservesSpeaker = /(?:不|不要|无需|禁止|保持|保留)[^\n]{0,30}(?:修改|调整|变更|重设|替换)?[^\n]{0,20}(?:speakerKey|说话者|说话人|发言者|对白归属|台词归属)/i.test(recommendation)
    const reportsSpeakerMismatch = /(?:speakerKey|说话者|说话人|发言者|对白归属|台词归属)[^\n]{0,100}(?:错标|误标|错误|不符|不一致|并非|不应)|(?:错标|误标|错误|不符|不一致|并非|不应)[^\n]{0,100}(?:speakerKey|说话者|说话人|发言者|对白归属|台词归属)/i.test(detail)
      || /(?:修改|修正|调整|改为|替换|重设)[^\n]{0,100}(?:speakerKey|说话者|说话人|发言者|对白归属|台词归属)|(?:speakerKey|说话者|说话人|发言者|对白归属|台词归属)[^\n]{0,100}(?:修改|修正|调整|改为|替换|重设)/i.test(recommendation)
    if (namesSpeakerOwnership && reportsSpeakerMismatch && !explicitlyPreservesSpeaker) {
      return `content.scene-script.act-${dialoguePassMatch[1]}`
    }
  }

  if (artifactKey !== 'content.quest-script') return artifactKey
  // Main-script sceneKey is a frozen projection of the owning objective's
  // sceneKeys[0]. The script Agent may rewrite only resolution/check fields;
  // asking it to move a scene would loop forever because deterministic
  // legalization restores the upstream identity on every retry.
  const explicitlyPreservesFrozenScene = /(?:保留|不改|不要改|维持)[^\n]{0,80}sceneKey/i.test(recommendation)
  const asksToMoveFrozenScene = !explicitlyPreservesFrozenScene
    && /(?:(?:objective|alternative)\.[\w.-]+|mainObjectiveScripts?\[\d+\])[\s\S]{0,240}sceneKey/i.test(evidence)
    && /(?:sceneKey[^\n]{0,120}(?:改为|调整为|移动到|重设为|重新绑定|应(?:当)?(?:是|指向))|(?:改为|调整|移动|重设|重新绑定)[^\n]{0,80}sceneKey)/i.test(recommendation)
  const asksToChangeQuestDesign = /(?:locationOrdinal|(?:objective|alternative)\.[\w.-]+[^\n]*(?:description|标题|目标|地点)|quests?\[\d+\]\.(?:stages|objectives))/i.test(evidence)
    && !/(?:保留|不改|不要改|维持)[^\n]{0,80}(?:sceneKey|locationOrdinal)[^\n]{0,120}(?:重写|修改|修正)[^\n]{0,80}(?:resolution|timeCostMinutes|successText|costlySuccessText|failureForwardText|结算文本)/i.test(recommendation)
  if (asksToMoveFrozenScene
    || asksToChangeQuestDesign) {
    return 'content.main-quest-plan'
  }
  return artifactKey
}

/**
 * The public review packet exposes the deterministically assembled arc plan,
 * while repairs must return to one of its two model-owned source Artifacts.
 * Keep this mapping deterministic so a decision-only defect never regenerates
 * the scene-card structure (or vice versa).
 */
export function textAdventureQualityArcRepairTaskKeysV1(
  issue: Record<string, unknown>,
): string[] {
  if (textAdventureQualityIssueOwnerArtifactKeyV1(issue) !== 'content.narrative-arc-plan') return []
  const detail = typeof issue.detail === 'string' ? issue.detail : ''
  const recommendation = typeof issue.recommendation === 'string' ? issue.recommendation : ''
  const evidence = `${detail}\n${recommendation}`
  // A decision may quote its frozen location/scene as evidence. That does not
  // authorize rewriting the scene cards, so explicit stable decision fields
  // always win over incidental locationOrdinal mentions.
  if (/(?:^|[^\w])decision\.[A-Za-z0-9._:-]+|(?:^|[^\w])option\.[A-Za-z0-9._:-]+|echoSceneKeys|跨场景回响/i.test(evidence)) {
    return ['content.narrative-decision-plan']
  }
  const asksToChangeArcScene = /(?:修改|改写|重写|调整|移动|重设|修正|变更)[^\n]{0,120}(?:sceneCards?|场景卡|locationOrdinal|purpose|entryState|exitState)|(?:sceneCards?|场景卡|locationOrdinal|purpose|entryState|exitState)[^\n]{0,120}(?:修改|改写|重写|调整|移动|重设|修正|变更)/i.test(recommendation)
  if (asksToChangeArcScene
    || (/sceneCards?|场景卡|acts?\[\d+\].*scene|冻结场景/i.test(detail)
      && !/(?:^|[^\w])choice\.[A-Za-z0-9._:-]+|sourceNodeKey|targetNodeKey|openingBeat/i.test(evidence))) {
    return ['content.narrative-arc-scenes']
  }
  return ['content.narrative-arc-scenes', 'content.narrative-decision-plan']
}

/**
 * A historical reviewer could inspect authored echoSceneKeys but not the
 * condition-gated player-visible actions assembled later by the runtime
 * compiler. Since quality inputs now project that exact compiled copy before
 * package assembly, an old “echo absent” issue is stale when both options are
 * already gated into the complained-of scene. Re-review the new evidence; do
 * not rewrite the decision plan or all descendant scene scripts.
 */
export function textAdventureQualityIssueSupersededByCompiledEchoV1(
  issue: Record<string, unknown>,
  arcPlanValue: unknown,
): boolean {
  const owner = textAdventureQualityIssueOwnerArtifactKeyV1(issue)
  if (owner !== 'content.narrative-arc-plan' && owner !== 'content.narrative') return false
  const detail = typeof issue.detail === 'string' ? issue.detail : ''
  const recommendation = typeof issue.recommendation === 'string' ? issue.recommendation : ''
  const evidence = `${detail}\n${recommendation}`
  if (!/(?:可见)?回响|条件化(?:段落|内容|叙述)|(?:路线|体验)差异/u.test(evidence)
    || !/(?:无|没有|未体现|不足|缺少|增加|补充|抹平|虚化)/u.test(evidence)) return false
  if (!arcPlanValue || typeof arcPlanValue !== 'object' || Array.isArray(arcPlanValue)) return false
  const arcPlan = arcPlanValue as Record<string, unknown>
  const decisions = Array.isArray(arcPlan.decisions) ? arcPlan.decisions : []
  const decisionKeys = new Set(evidence.match(/decision\.[A-Za-z0-9._:-]+/g) ?? [])
  const sceneKeys = new Set(evidence.match(/scene\.[A-Za-z0-9._:-]+/g) ?? [])
  if (decisionKeys.size === 0 || sceneKeys.size === 0) return false
  return decisions.some(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const decision = value as Record<string, unknown>
    const options = Array.isArray(decision.options) ? decision.options : []
    if (typeof decision.key !== 'string' || !decisionKeys.has(decision.key)
      || options.length !== 2) return false
    return [...sceneKeys].some(sceneKey => options.every(optionValue => {
      if (!optionValue || typeof optionValue !== 'object' || Array.isArray(optionValue)) return false
      const option = optionValue as Record<string, unknown>
      return typeof option.persistentEffectKey === 'string'
        && Array.isArray(option.echoSceneKeys)
        && option.echoSceneKeys.includes(sceneKey)
    }))
  })
}

/**
 * Returns true only when the requested repair changes player-facing choice
 * copy while preserving the frozen graph edge. Dialogue Pass owns the final
 * `text`/`description`. A mixed reviewer recommendation that asks for both
 * copy and graph mutation is deliberately narrowed to its writable copy
 * subset: the current Build cannot rewrite a frozen source/target/order edge.
 */
export function textAdventureQualityChoiceCopyOnlyRepairV1(
  issue: Record<string, unknown>,
): boolean {
  const detail = typeof issue.detail === 'string' ? issue.detail : ''
  const recommendation = typeof issue.recommendation === 'string' ? issue.recommendation : ''
  const evidence = `${detail}\n${recommendation}`
  const namesChoice = /(?:^|[^\w])choice\.[A-Za-z0-9._:-]+|选择文案|选择措辞|选择描述/i.test(evidence)
  const asksCopyChange = /(?:重写|改写|修改|调整|修正|改为|改回|澄清|收紧)[^\n]{0,120}(?:choice\.[A-Za-z0-9._:-]+[^\n]{0,40})?(?:text|description|label|文案|措辞|描述|玩家意图|立即行动)|(?:text|description|label|文案|措辞|描述|玩家意图|立即行动)[^\n]{0,120}(?:重写|改写|修改|调整|修正|改为|改回|澄清|收紧)/i.test(recommendation)
  const comparesChoiceToScene = namesChoice
    && /(?:使|确保|令)[^\n]{0,100}(?:描述|文案|label|text|description)[^\n]{0,100}(?:与|符合|对应)[^\n]{0,40}scene\.[A-Za-z0-9._:-]+[^\n]{0,40}(?:开场|内容|正文)[^\n]{0,20}(?:相符|一致|对应|吻合)|(?:与|符合|对应)[^\n]{0,40}scene\.[A-Za-z0-9._:-]+[^\n]{0,40}(?:开场|内容|正文)[^\n]{0,20}(?:相符|一致|对应|吻合)/i.test(recommendation)
  const asksSceneCopyChange = !comparesChoiceToScene
    && /(?:重写|改写|修改|调整|修正)[^\n]{0,120}(?:openingBeat|scene\.[A-Za-z0-9._:-]+[^\n]{0,40}(?:summary|title|正文|开场|叙述|action|system|beat))|(?:openingBeat|scene\.[A-Za-z0-9._:-]+[^\n]{0,40}(?:summary|title|正文|开场|叙述|action|system|beat))[^\n]{0,120}(?:重写|改写|修改|调整|修正)/i.test(recommendation)
  return namesChoice && asksCopyChange && !asksSceneCopyChange
}

/**
 * Removes an impossible graph-mutation instruction before a reviewer issue is
 * projected into a Dialogue Pass repair packet. The issue evidence remains
 * unchanged and auditable; only the executable recommendation is constrained
 * to fields owned by the target specialist.
 */
export function textAdventureQualityExecutableRecommendationV1(
  issue: Record<string, unknown>,
): string {
  const recommendation = typeof issue.recommendation === 'string' ? issue.recommendation : ''
  if (!textAdventureQualityChoiceCopyOnlyRepairV1(issue)) return recommendation
  const asksGraphChange = (
    /(?:修改|调整|改为|移动|重定向|变更|修正|重写)[^\n]{0,100}(?:sourceNodeKey|targetNodeKey|目标节点|源节点|choice\.order)|(?:sourceNodeKey|targetNodeKey|choice\.order)[^\n]{0,100}(?:修改|调整|改为|移动|重定向|变更|修正|重写)|(?:新增|删除|移除)[^\n]{0,40}(?:choice|选择)/i.test(recommendation)
  )
  if (!asksGraphChange) return recommendation
  const evidence = `${typeof issue.detail === 'string' ? issue.detail : ''}\n${recommendation}`
  const choiceKey = /(?:^|[^\w])(choice\.[A-Za-z0-9._:-]+)/i.exec(evidence)?.[1] ?? '该选择'
  return `保持 ${choiceKey} 的 sourceNodeKey、targetNodeKey、order 与冻结图完全不变；` +
    `仅重写 ${choiceKey} 的 text、description 或 unavailableReason，使玩家可见文案准确承诺冻结目标场景中的立即行动、地点与可知事实。`
}

export interface TextAdventureQualityReferenceIndexV1 {
  decisionSceneByKey: Readonly<Record<string, string>>
  decisionOptionKeysByKey: Readonly<Record<string, readonly string[]>>
  optionKeys: readonly string[]
  choiceEdgeByKey: Readonly<Record<string, { sourceNodeKey: string; targetNodeKey: string }>>
  sceneKeys: readonly string[]
  endingKeys: readonly string[]
  objectiveSceneByKey: Readonly<Record<string, string>>
  objectiveAlternativeKeysByKey: Readonly<Record<string, readonly string[]>>
  alternativeKeys: readonly string[]
  /**
   * Optional graph/decision facts used by the stronger factual-claim guard.
   * They remain optional so previously persisted reference-only evidence and
   * callers can still be inspected without pretending those older packets
   * contained the newer deterministic proof.
   */
  entryNodeKey?: string | null
  incomingChoiceKeysByNodeKey?: Readonly<Record<string, readonly string[]>>
  outgoingChoiceKeysByNodeKey?: Readonly<Record<string, readonly string[]>>
  reachableNodeKeys?: readonly string[]
  decisionOptionFactsByKey?: Readonly<Record<string, readonly {
    optionKey: string
    choiceKey?: string | null
    cost: string
    persistentEffectKey: string
    echoSceneKeys: readonly string[]
  }[]>>
  beatFactsByKey?: Readonly<Record<string, TextAdventureQualityBeatFactV1>>
}

export interface TextAdventureQualityBeatFactV1 {
  nodeKey: string
  kind: string
  speakerKey: string | null
  text: string
}

/**
 * Projects only immutable, player-visible beat facts from an accepted
 * narrative Artifact. Duplicate or malformed identities are omitted rather
 * than guessed: a reviewer claim may be rejected only when one exact frozen
 * beat disproves it.
 */
export function textAdventureQualityBeatFactsV1(
  narrativeValue: unknown,
): Readonly<Record<string, TextAdventureQualityBeatFactV1>> {
  if (!narrativeValue || typeof narrativeValue !== 'object' || Array.isArray(narrativeValue)) return {}
  const beats = Array.isArray((narrativeValue as Record<string, unknown>).beats)
    ? (narrativeValue as Record<string, unknown>).beats as unknown[] : []
  const facts = new Map<string, TextAdventureQualityBeatFactV1>()
  const duplicateKeys = new Set<string>()
  for (const value of beats) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const beat = value as Record<string, unknown>
    if (typeof beat.beatKey !== 'string' || typeof beat.nodeKey !== 'string'
      || typeof beat.kind !== 'string' || typeof beat.text !== 'string'
      || !(beat.speakerKey == null || typeof beat.speakerKey === 'string')) continue
    if (facts.has(beat.beatKey)) {
      duplicateKeys.add(beat.beatKey)
      facts.delete(beat.beatKey)
      continue
    }
    if (duplicateKeys.has(beat.beatKey)) continue
    facts.set(beat.beatKey, {
      nodeKey: beat.nodeKey,
      kind: beat.kind,
      speakerKey: typeof beat.speakerKey === 'string' ? beat.speakerKey : null,
      text: beat.text,
    })
  }
  return Object.fromEntries(facts)
}

function normalizedBeatClaimTextV1(value: string): string {
  return value.normalize('NFC').replace(/[\p{P}\p{S}\s]/gu, '').toLocaleLowerCase()
}

/**
 * Rejects only literal beat claims that the frozen narrative disproves. It
 * intentionally does not judge tone, motivation or dramatic quality. Those
 * remain reviewer-owned qualitative findings.
 */
export function textAdventureQualityReviewBeatClaimContradictionV1(
  issue: Record<string, unknown>,
  beatFactsByKey: Readonly<Record<string, TextAdventureQualityBeatFactV1>>,
): string | null {
  const detail = typeof issue.detail === 'string' ? issue.detail : ''
  const knownBeatKeys = new Set(Object.keys(beatFactsByKey))
  if (!detail || knownBeatKeys.size === 0) return null
  const references = [...detail.matchAll(/beat\.[A-Za-z0-9._:-]+/g)]
  const referencedFacts = references.flatMap(reference => {
    const beatKey = normalizeTextAdventureQualityStableReferenceV1(reference[0], knownBeatKeys)
    const fact = beatFactsByKey[beatKey]
    return fact ? [{ beatKey, fact }] : []
  })
  const sharedClaimedSpeaker = /speakerKey\s*(?:=|:|为|是|现为|写为|标为|标注为|均为|全部为|皆为|都为)\s*["'‘’“”「」『』]?((?:character)\.[A-Za-z0-9._:-]+)/iu
    .exec(detail)?.[1]
  const sharedSpeakerClaim = referencedFacts.length > 1 && sharedClaimedSpeaker
    && /(?:这些|上述|所列|均|全部|皆|都)[^\n]{0,120}(?:speakerKey|说话者|说话人)|(?:speakerKey|说话者|说话人)[^\n]{0,120}(?:均|全部|皆|都)/u.test(detail)
  if (sharedSpeakerClaim) {
    const contradicted = referencedFacts.find(({ fact }) => fact.speakerKey !== sharedClaimedSpeaker)
    if (contradicted) {
      return `${contradicted.beatKey} 声称 speakerKey=${sharedClaimedSpeaker}，冻结正文实际为 ${contradicted.fact.speakerKey ?? 'null'}`
    }
  }
  for (let index = 0; index < references.length; index += 1) {
    const rawKey = references[index][0]
    const beatKey = normalizeTextAdventureQualityStableReferenceV1(rawKey, knownBeatKeys)
    const fact = beatFactsByKey[beatKey]
    if (!fact) continue
    const start = references[index].index ?? 0
    const next = references[index + 1]?.index ?? detail.length
    const segment = detail.slice(start, Math.min(next, start + 600))
    const claimedSpeaker = /speakerKey\s*(?:=|:|为|是|现为|写为|标为|标注为|均为|全部为|皆为|都为)\s*["'‘’“”「」『』]?((?:character)\.[A-Za-z0-9._:-]+)/iu
      .exec(segment)?.[1]
    if (claimedSpeaker && claimedSpeaker !== fact.speakerKey) {
      return `${beatKey} 声称 speakerKey=${claimedSpeaker}，冻结正文实际为 ${fact.speakerKey ?? 'null'}`
    }
    const claimedQuote = /(?:台词|对白|话术|原文|文本|所说|写成|内容)[^'‘’"“”「」『』\n]{0,80}['‘“「『"]([^'’”」』"\n]{4,240})['’”」』"]/u
      .exec(segment)?.[1]
    if (!claimedQuote) continue
    const normalizedClaim = normalizedBeatClaimTextV1(claimedQuote)
    const normalizedActual = normalizedBeatClaimTextV1(fact.text)
    if (normalizedClaim.length >= 4 && normalizedActual.length >= 4
      && !normalizedActual.includes(normalizedClaim)
      && !normalizedClaim.includes(normalizedActual)) {
      return `${beatKey} 引用的台词与冻结正文不一致`
    }
  }
  return null
}

export function textAdventureQualityIssueFrozenBeatContradictionV1(
  issue: Record<string, unknown>,
  narrativeValue: unknown,
): string | null {
  return textAdventureQualityReviewBeatClaimContradictionV1(
    issue,
    textAdventureQualityBeatFactsV1(narrativeValue),
  )
}

/**
 * Rejects only review assertions that are directly disproved by accepted,
 * deterministic graph or decision records. This is deliberately narrower
 * than narrative-quality judgment: weak wording, shallow emotional payoff,
 * repetitive routes and merely generic echoes remain valid reviewer findings.
 *
 * A false structural assertion must not schedule paid rewrites. The strict
 * scene-script/arc parsers and runtime compiler already own these facts, while
 * the model reviewer only owns qualitative interpretation of them.
 */
export function textAdventureQualityReviewFactualContradictionV1(
  issue: Record<string, unknown>,
  index: TextAdventureQualityReferenceIndexV1,
): string | null {
  const detail = typeof issue.detail === 'string' ? issue.detail : ''
  const recommendation = typeof issue.recommendation === 'string' ? issue.recommendation : ''
  const evidence = `${detail}\n${recommendation}`
  const beatContradiction = index.beatFactsByKey
    ? textAdventureQualityReviewBeatClaimContradictionV1(issue, index.beatFactsByKey)
    : null
  if (beatContradiction) return beatContradiction
  const allNodeKeys = new Set([...index.sceneKeys, ...index.endingKeys])
  const referencedNodes = [...new Set((evidence.match(/(?:scene|ending)\.[A-Za-z0-9._:-]+/g) ?? [])
    .map(value => normalizeTextAdventureQualityStableReferenceV1(value, allNodeKeys))
    .filter(value => allNodeKeys.has(value)))]
  const owningKey = /^\[owningKey=([^\]]+)\]/u.exec(detail)?.[1] ?? ''
  const owningNodeKey = allNodeKeys.has(owningKey) ? owningKey : null
  const incoming = index.incomingChoiceKeysByNodeKey
  const outgoing = index.outgoingChoiceKeysByNodeKey

  const absenceBefore = '(?:缺少|没有|不存在|未(?:设置|提供|建立|连接|生成)|无(?:任何)?|missing|lacks?|has\\s+no|no)'
  const outgoingTerm = '(?:出边|出站边|向外(?:选择|连接)|outgoing(?:\\s+(?:choice|edge))?|通往[^\\n]{0,60}(?:选择|choice|edge))'
  const incomingTerm = '(?:入边|入站边|进入[^\\n]{0,30}(?:选择|连接)|incoming(?:\\s+(?:choice|edge))?)'
  const qualitativeEdgeClaim = /(?:入边|出边|incoming|outgoing|选择(?:边|连接)?)[^\n]{0,80}(?:差异|区分|后果|回响|意义|足够|充分|明显|清晰|实质|有效)|(?:差异|区分|后果|回响|意义|足够|充分|明显|清晰|实质|有效)[^\n]{0,80}(?:入边|出边|incoming|outgoing|选择(?:边|连接)?)/i.test(evidence)
  const missingOutgoing = !qualitativeEdgeClaim && new RegExp(
    `${absenceBefore}[^\\n]{0,100}${outgoingTerm}|${outgoingTerm}[^\\n]{0,100}${absenceBefore}`,
    'i',
  ).test(evidence)
  const missingIncoming = !qualitativeEdgeClaim && new RegExp(
    `${absenceBefore}[^\\n]{0,100}${incomingTerm}|${incomingTerm}[^\\n]{0,100}${absenceBefore}`,
    'i',
  ).test(evidence)
  const directMissingConnection = new RegExp(
    `${absenceBefore}[^\\n]{0,120}(?:选择|choice|edge)[^\\n]{0,80}(?:通往|指向|连接)|` +
    `(?:选择|choice|edge)[^\\n]{0,80}(?:通往|指向|连接)[^\\n]{0,120}${absenceBefore}`,
    'i',
  ).test(evidence)

  if (outgoing && missingOutgoing) {
    const source = owningNodeKey ?? referencedNodes[0] ?? null
    if (source) {
      const target = referencedNodes.find(key => key !== source) ?? null
      const choices = outgoing[source] ?? []
      if (target) {
        const provesEdge = choices.some(choiceKey => index.choiceEdgeByKey[choiceKey]?.targetNodeKey === target)
        if (provesEdge) return `${source} 到 ${target} 的冻结出边实际存在`
      } else if (choices.length > 0) return `${source} 实际拥有冻结出边:${choices.join('、')}`
    }
  }
  if (incoming && missingIncoming) {
    const target = owningNodeKey ?? referencedNodes[referencedNodes.length - 1] ?? null
    if (target) {
      const source = referencedNodes.find(key => key !== target) ?? null
      const choices = incoming[target] ?? []
      if (source) {
        const provesEdge = choices.some(choiceKey => index.choiceEdgeByKey[choiceKey]?.sourceNodeKey === source)
        if (provesEdge) return `${source} 到 ${target} 的冻结入边实际存在`
      } else if (choices.length > 0) return `${target} 实际拥有冻结入边:${choices.join('、')}`
    }
  }
  if (outgoing && directMissingConnection && referencedNodes.length >= 2) {
    const [source, target] = owningNodeKey
      ? [owningNodeKey, referencedNodes.find(key => key !== owningNodeKey)]
      : [referencedNodes[0], referencedNodes[1]]
    if (source && target && (outgoing[source] ?? []).some(
      choiceKey => index.choiceEdgeByKey[choiceKey]?.targetNodeKey === target,
    )) return `${source} 到 ${target} 的冻结选择连接实际存在`
  }

  const claimsUnreachable = /(?:不可达|无法到达|不能到达|没有[^\n]{0,40}(?:路径|路线)(?:可)?到达|unreachable|no\s+(?:reachable\s+)?path)/i.test(evidence)
  if (claimsUnreachable && index.reachableNodeKeys) {
    const reachable = new Set(index.reachableNodeKeys)
    const contradicted = referencedNodes.find(key => reachable.has(key))
    if (contradicted) return `${contradicted} 从冻结入口 ${index.entryNodeKey ?? 'unknown'} 实际可达`
  }

  const decisionKeys = new Set(Object.keys(index.decisionOptionFactsByKey ?? {}))
  const referencedDecision = (evidence.match(/decision\.[A-Za-z0-9._:-]+/g) ?? [])
    .map(value => normalizeTextAdventureQualityStableReferenceV1(value, decisionKeys))
    .find(value => decisionKeys.has(value))
  if (!referencedDecision) return null
  const options = index.decisionOptionFactsByKey?.[referencedDecision] ?? []
  const hasDistinctPersistentEffects = options.length === 2
    && options.every(option => option.persistentEffectKey.trim())
    && new Set(options.map(option => option.persistentEffectKey)).size === options.length
  const hasDeclaredEchoes = options.length === 2
    && options.every(option => option.echoSceneKeys.length >= 2)
  const claimsNoPersistentDifference = (
    /(?:effectsJson|persistentEffectKey|持久(?:状态|效果)|状态(?:写入|效果)|选项效果)[^\n]{0,100}(?:为空|空数组|缺少(?:字段|登记|写入)?|没有(?:登记|写入|设置)?|不存在|未设置|均空)/i.test(evidence)
    || /(?:为空|空数组|缺少(?:字段|登记|写入)?|没有(?:登记|写入|设置)?|不存在|未设置|均空)[^\n]{0,100}(?:effectsJson|persistentEffectKey|持久(?:状态|效果)|状态(?:写入|效果)|选项效果)/i.test(evidence)
  )
  const qualitativeEchoClaim = /(?:回响)[^\n]{0,60}(?:泛化|薄弱|单薄|重复|不足|不够|不明显|不充分|不具体|缺乏变化|情绪|戏剧|鲜明)|(?:泛化|薄弱|单薄|重复|不足|不够|不明显|不充分|不具体|情绪|戏剧|鲜明)[^\n]{0,60}(?:回响)/i.test(evidence)
  const claimsNoEcho = !qualitativeEchoClaim && (
    /(?:echoSceneKeys|跨场景回响|后续回响|可见回响)[^\n]{0,80}(?:为空|空数组|缺少(?:字段|登记)?|没有(?:登记|设置)?|不存在|未设置|均空)/i.test(evidence)
    || /(?:为空|空数组|缺少(?:字段|登记)?|没有(?:登记|设置)?|不存在|未设置|均空)[^\n]{0,80}(?:echoSceneKeys|跨场景回响|后续回响|可见回响)/i.test(evidence)
  )
  if (claimsNoPersistentDifference && hasDistinctPersistentEffects) {
    return `${referencedDecision} 的两个 option 实际拥有不同 persistentEffectKey`
  }
  if (claimsNoEcho && hasDeclaredEchoes) {
    return `${referencedDecision} 的两个 option 实际各有至少两个冻结 echoSceneKeys`
  }
  return null
}

/**
 * Normalizes a stable reference extracted from reviewer prose. Registered keys
 * may themselves contain punctuation, so an exact known key always wins; only
 * otherwise do we remove sentence punctuation attached after the reference.
 * Quality validation and repair routing must share this boundary, otherwise a
 * review such as `choice.001:` can pass validation but fail to reach its owner.
 */
export function normalizeTextAdventureQualityStableReferenceV1(
  value: string,
  known?: ReadonlySet<string>,
): string {
  if (known?.has(value)) return value
  const unpunctuated = value.replace(/[.,:;!?，。；：！？、]+$/u, '') || value
  if (!known || known.has(unpunctuated)) return unpunctuated
  // Models sometimes preserve the numeric identity but drop display padding
  // (`scene.03` for frozen `scene.003`). Canonicalize only when exactly one
  // registered key has the same segment structure and numeric values. Keep
  // any trailing registered field path intact. Ambiguous or invented suffixes
  // still fail the strict unknown-reference gate below.
  const inputSegments = unpunctuated.split('.')
  const candidates = [...known].flatMap(candidate => {
    const candidateSegments = candidate.split('.')
    if (candidateSegments.length > inputSegments.length) return []
    const matches = candidateSegments.every((segment, index) => {
      const actual = inputSegments[index]
      if (segment === actual) return true
      return /^[0-9]+$/.test(segment) && /^[0-9]+$/.test(actual)
        && Number(segment) === Number(actual)
    })
    return matches
      ? [`${candidate}${inputSegments.length > candidateSegments.length
        ? `.${inputSegments.slice(candidateSegments.length).join('.')}` : ''}`]
      : []
  })
  return candidates.length === 1 ? candidates[0] : unpunctuated
}

export interface TextAdventureQualityReviewBatchCoverageV1 {
  scope: 'structure' | 'act-1' | 'act-2' | 'act-3'
  supplementalAssignmentRule: 'bundle-entry-index-modulo-three'
  allSceneKeys: readonly string[]
  sceneKeys: readonly string[]
  allEndingKeys: readonly string[]
  endingKeys: readonly string[]
  ownedChoiceKeys: readonly string[]
  choiceTargetByKey: Readonly<Record<string, string>>
  ownedDecisionKeys: readonly string[]
  decisionEchoSceneKeysByKey: Readonly<Record<string, readonly string[]>>
  ownedOptionKeys: readonly string[]
  optionEchoSceneKeysByKey: Readonly<Record<string, readonly string[]>>
  objectiveKeys: readonly string[]
  ownedObjectiveKeys: readonly string[]
  alternativeKeys: readonly string[]
  ownedAlternativeKeys: readonly string[]
  allSupplementalEntryKeys: readonly string[]
  ownedSupplementalEntryKeys: readonly string[]
  allSupplementalStageKeys: readonly string[]
  ownedSupplementalStageKeys: readonly string[]
}

/**
 * Repairs two narrow reviewer formatting slips without inventing evidence:
 * an Artifact/field path used as `owningKey` when exactly one owned entity is
 * named or appears as the exact terminal path segment, or a real beatKey put
 * inside the same prefix after an exact owned entity. The first case requires
 * a unique literal match; the second only moves the beat locator outside the
 * bracket. Unknown identities remain unchanged and therefore fail the strict
 * coverage/reference gates below.
 */
export function textAdventureQualityResolveArtifactOwningKeyV1<T extends {
  detail: string
}>(
  issue: T,
  coverage: TextAdventureQualityReviewBatchCoverageV1,
): T {
  const ownedKeys = [...new Set([
    ...coverage.sceneKeys,
    ...coverage.endingKeys,
    ...coverage.ownedChoiceKeys,
    ...coverage.ownedDecisionKeys,
    ...coverage.ownedOptionKeys,
    ...coverage.ownedObjectiveKeys,
    ...coverage.ownedAlternativeKeys,
    ...coverage.ownedSupplementalEntryKeys,
    ...coverage.ownedSupplementalStageKeys,
  ])].sort((left, right) => right.length - left.length)
  const compoundPrefix = /^\[owningKey=([A-Za-z0-9][A-Za-z0-9._:-]{0,199}),\s*beatKey=([A-Za-z0-9][A-Za-z0-9._:-]{0,199})\]/u.exec(issue.detail)
  if (compoundPrefix && ownedKeys.includes(compoundPrefix[1])) {
    return {
      ...issue,
      detail: `[owningKey=${compoundPrefix[1]}] beatKey=${compoundPrefix[2]}${issue.detail.slice(compoundPrefix[0].length)}`,
    }
  }
  const prefix = /^\[owningKey=(content\.[^\]]+)\]/u.exec(issue.detail)
  if (!prefix) return issue
  const qualifiedOwnedMatches = ownedKeys.filter(key => (
    prefix[1].endsWith(`.${key}`) || prefix[1].endsWith(`:${key}`)
  ))
  if (qualifiedOwnedMatches.length === 1) {
    return {
      ...issue,
      detail: `[owningKey=${qualifiedOwnedMatches[0]}]${issue.detail.slice(prefix[0].length)}`,
    }
  }
  const evidence = issue.detail.slice(prefix[0].length)
  const matches = ownedKeys.filter(key => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(^|[^A-Za-z0-9._:-])${escaped}(?=$|[^A-Za-z0-9._:-])`, 'u')
      .test(evidence)
  })
  if (matches.length !== 1) return issue
  return {
    ...issue,
    detail: `[owningKey=${matches[0]}]${issue.detail.slice(prefix[0].length)}`,
  }
}

/**
 * Enforces the ownership half of a scoped review packet. An act reviewer may
 * quote the immediate target/echo node of one of its own choices or decisions,
 * but that boundary node is evidence only: the requested repair must remain on
 * the current choice copy or decision plan. It may never become a shortcut for
 * rewriting another act's scene/ending.
 */
export function textAdventureQualityReviewBatchCoverageViolationsV1(
  issues: unknown,
  coverage: TextAdventureQualityReviewBatchCoverageV1,
): string[] {
  if (!Array.isArray(issues)) return []
  const structureScope = coverage.scope === 'structure'
  const ownedScenes = new Set(structureScope ? coverage.allSceneKeys : coverage.sceneKeys)
  const ownedEndings = new Set(structureScope ? coverage.allEndingKeys : coverage.endingKeys)
  const allChoices = new Set(Object.keys(coverage.choiceTargetByKey))
  const allDecisions = new Set(Object.keys(coverage.decisionEchoSceneKeysByKey))
  const allOptions = new Set(Object.keys(coverage.optionEchoSceneKeysByKey))
  const allObjectives = new Set(coverage.objectiveKeys)
  const allAlternatives = new Set(coverage.alternativeKeys)
  const allSupplementalEntries = new Set(coverage.allSupplementalEntryKeys)
  const allSupplementalStages = new Set(coverage.allSupplementalStageKeys)
  // Structure review owns the registered global topology, including every
  // supplemental identity. Act review owns only its frozen partition. Keep
  // this derivation here as well as in the persisted coverage so old signed
  // batches remain verifiable after the stronger identity invariant lands.
  const ownedChoices = new Set(structureScope ? allChoices : coverage.ownedChoiceKeys)
  const ownedDecisions = new Set(structureScope ? allDecisions : coverage.ownedDecisionKeys)
  const ownedOptions = new Set(structureScope ? allOptions : coverage.ownedOptionKeys)
  const ownedObjectives = new Set(structureScope ? allObjectives : coverage.ownedObjectiveKeys)
  const ownedAlternatives = new Set(structureScope ? allAlternatives : coverage.ownedAlternativeKeys)
  const ownedSupplementalEntries = new Set(
    structureScope ? allSupplementalEntries : coverage.ownedSupplementalEntryKeys,
  )
  const ownedSupplementalStages = new Set(
    structureScope ? allSupplementalStages : coverage.ownedSupplementalStageKeys,
  )
  const knownByLength = (values: ReadonlySet<string>) => [...values]
    .sort((left, right) => right.length - left.length)
  const references = (evidence: string, pattern: RegExp, known: ReadonlySet<string>) => {
    const ordered = knownByLength(known)
    return [...new Set((evidence.match(pattern) ?? []).flatMap(raw => {
      const normalized = normalizeTextAdventureQualityStableReferenceV1(raw, known)
      const resolved = known.has(normalized)
        ? normalized
        : ordered.find(key => normalized.startsWith(`${key}.`))
      return resolved ? [resolved] : []
    }))]
  }
  // Supplemental identities are authored stable keys rather than a forced
  // `entry.*` / `stage.*` namespace. Resolve the exact keys that were frozen
  // in the two supplemental bundles, with stable-key token boundaries so an
  // entry key is not also matched inside one of its stage keys.
  const literalReferences = (evidence: string, known: ReadonlySet<string>) => (
    knownByLength(known).filter(key => {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`(^|[^A-Za-z0-9._:-])${escaped}(?=$|[^A-Za-z0-9._:-])`, 'u')
        .test(evidence)
    })
  )
  const allSceneKeys = new Set(coverage.allSceneKeys)
  const allEndingKeys = new Set(coverage.allEndingKeys)
  const ownedStableIdentities = new Set([
    ...ownedScenes,
    ...ownedEndings,
    ...ownedChoices,
    ...ownedDecisions,
    ...ownedOptions,
    ...ownedObjectives,
    ...ownedAlternatives,
    ...ownedSupplementalEntries,
    ...ownedSupplementalStages,
  ])
  const violations: string[] = []
  for (const value of issues) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const issue = value as Record<string, unknown>
    const detail = typeof issue.detail === 'string' ? issue.detail : ''
    const recommendation = typeof issue.recommendation === 'string' ? issue.recommendation : ''
    const owningPrefix = /^\[owningKey=([^\]]+)\]/u.exec(detail)?.[1] ?? ''
    if (!owningPrefix) {
      violations.push(`${coverage.scope} 审查 issue.detail 缺少开头 owningKey`)
      continue
    }
    if (!ownedStableIdentities.has(owningPrefix)) {
      violations.push(`${coverage.scope} 审查 issue.detail 的 owningKey 未登记或不归本批:${owningPrefix}`)
      continue
    }
    const evidence = `${detail}\n${recommendation}`
    const choiceRefs = references(evidence, /choice\.[A-Za-z0-9._:-]+/g, allChoices)
    const decisionRefs = references(evidence, /decision\.[A-Za-z0-9._:-]+/g, allDecisions)
    const optionRefs = references(evidence, /option\.[A-Za-z0-9._:-]+/g, allOptions)
    const objectiveRefs = references(evidence, /objective\.[A-Za-z0-9._:-]+/g, allObjectives)
    const alternativeRefs = references(evidence, /alternative\.[A-Za-z0-9._:-]+/g, allAlternatives)
    const sceneRefs = references(evidence, /scene\.[A-Za-z0-9._:-]+/g, allSceneKeys)
    const endingRefs = references(evidence, /ending\.[A-Za-z0-9._:-]+/g, allEndingKeys)
    const supplementalEntryRefs = literalReferences(evidence, allSupplementalEntries)
    const supplementalStageRefs = literalReferences(evidence, allSupplementalStages)

    const legalOwningIdentities = [
      ...sceneRefs.filter(key => ownedScenes.has(key)),
      ...endingRefs.filter(key => ownedEndings.has(key)),
      ...choiceRefs.filter(key => ownedChoices.has(key)),
      ...decisionRefs.filter(key => ownedDecisions.has(key)),
      ...optionRefs.filter(key => ownedOptions.has(key)),
      ...objectiveRefs.filter(key => ownedObjectives.has(key)),
      ...alternativeRefs.filter(key => ownedAlternatives.has(key)),
      ...supplementalEntryRefs.filter(key => ownedSupplementalEntries.has(key)),
      ...supplementalStageRefs.filter(key => ownedSupplementalStages.has(key)),
    ]

    const outsideIdentities = [
      ...choiceRefs.filter(key => !ownedChoices.has(key)),
      ...decisionRefs.filter(key => !ownedDecisions.has(key)),
      ...optionRefs.filter(key => !ownedOptions.has(key)),
      ...objectiveRefs.filter(key => !ownedObjectives.has(key)),
      ...alternativeRefs.filter(key => !ownedAlternatives.has(key)),
      ...supplementalEntryRefs.filter(key => !ownedSupplementalEntries.has(key)),
      ...supplementalStageRefs.filter(key => !ownedSupplementalStages.has(key)),
    ]
    if (outsideIdentities.length > 0) {
      violations.push(`${coverage.scope} 审查引用批次外 owning key:${outsideIdentities.join('、')}`)
      continue
    }

    if (structureScope) {
      if (legalOwningIdentities.length === 0) {
        violations.push('structure 审查 issue 缺少实际冻结 stable key')
      }
      continue
    }

    const outsideScenes = sceneRefs.filter(key => !ownedScenes.has(key))
    const outsideEndings = endingRefs.filter(key => !ownedEndings.has(key))
    if (outsideScenes.length === 0 && outsideEndings.length === 0) {
      if (legalOwningIdentities.length === 0) {
        violations.push(`${coverage.scope} 审查 issue 缺少本批实际 owning stable key`)
      }
      continue
    }

    const ownerArtifactKey = textAdventureQualityIssueOwnerArtifactKeyV1(issue)
    const currentActNumber = coverage.scope.slice('act-'.length)
    const copyOwner = ownerArtifactKey === 'content.narrative'
      || ownerArtifactKey === `content.dialogue-pass.act-${currentActNumber}`
    const copyOnlyBoundaryTargets = copyOwner
      && textAdventureQualityChoiceCopyOnlyRepairV1(issue)
      ? new Set(choiceRefs.map(key => coverage.choiceTargetByKey[key]).filter(Boolean))
      : new Set<string>()
    const decisionOnlyRepair = ownerArtifactKey === 'content.narrative-arc-plan'
      && textAdventureQualityArcRepairTaskKeysV1(issue).length === 1
      && textAdventureQualityArcRepairTaskKeysV1(issue)[0] === 'content.narrative-decision-plan'
    const decisionBoundaryTargets = decisionOnlyRepair
      ? new Set([
          ...decisionRefs.flatMap(key => coverage.decisionEchoSceneKeysByKey[key] ?? []),
          ...optionRefs.flatMap(key => coverage.optionEchoSceneKeysByKey[key] ?? []),
        ])
      : new Set<string>()
    const legalBoundaryTargets = new Set([...copyOnlyBoundaryTargets, ...decisionBoundaryTargets])
    const illegalTargets = [...outsideScenes, ...outsideEndings]
      .filter(key => !legalBoundaryTargets.has(key))
    if (illegalTargets.length > 0) {
      violations.push(`${coverage.scope} 审查把批次外内容当作返修目标:${illegalTargets.join('、')}`)
      continue
    }

    // A low score can request another bounded review, but an issue is a repair
    // instruction. It must identify at least one real owner from the frozen
    // packet; otherwise scheduler routing would have to guess and could fan a
    // generic sentence out to every story specialist. Cross-act boundary
    // scenes are deliberately excluded here: they may corroborate an owned
    // choice/decision, but cannot authorize a repair by themselves.
    if (legalOwningIdentities.length === 0) {
      violations.push(`${coverage.scope} 审查 issue 缺少本批实际 owning stable key`)
    }
  }
  return [...new Set(violations)]
}

/**
 * Preserve a scoped review's substantive finding while removing an illegal
 * request to edit a boundary scene/ending owned by another act. This is safe
 * only when the owningKey itself is valid and the coverage validator reports
 * no other violation; unknown or out-of-scope owners still fail closed.
 */
export function textAdventureQualityScopeSafeIssueV1<T extends {
  detail: string
  recommendation: string
}>(
  issue: T,
  coverage: TextAdventureQualityReviewBatchCoverageV1,
): T {
  const violations = textAdventureQualityReviewBatchCoverageViolationsV1([issue], coverage)
  const prefix = `${coverage.scope} 审查把批次外内容当作返修目标:`
  if (violations.length === 0 || violations.some(violation => !violation.startsWith(prefix))) {
    return issue
  }
  const illegalTargets = violations.flatMap(violation => (
    violation.slice(prefix.length).split('、').filter(Boolean)
  ))
  if (illegalTargets.length === 0) return issue
  const owningKey = /^\[owningKey=([^\]]+)\]/u.exec(issue.detail)?.[1]
  if (!owningKey) return issue
  const replaceTargets = (value: string) => illegalTargets.reduce((result, target) => (
    result.split(target).join(target.startsWith('ending.')
      ? '批次外只读衔接结局'
      : '批次外只读衔接场景')
  ), value)
  return {
    ...issue,
    detail: replaceTargets(issue.detail),
    recommendation: `仅修改 ${owningKey} 所属正式工件来解决上述问题；批次外场景或结局只能作为只读衔接证据，不得改写。`,
  } as T
}

/**
 * A reviewer is allowed to criticize authored facts, but not to invent stable
 * identities or quote a frozen edge/scene binding incorrectly. Rejecting such
 * evidence before adoption is cheaper and safer than broadcasting a phantom
 * repair to every specialist.
 */
export function textAdventureQualityReviewReferenceViolationsV1(
  issues: unknown,
  index: TextAdventureQualityReferenceIndexV1,
): string[] {
  if (!Array.isArray(issues)) return []
  const decisionKeys = new Set(Object.keys(index.decisionSceneByKey))
  const optionKeys = new Set(index.optionKeys)
  const choiceKeys = new Set(Object.keys(index.choiceEdgeByKey))
  const sceneKeys = new Set(index.sceneKeys)
  const endingKeys = new Set(index.endingKeys)
  const objectiveKeys = new Set(Object.keys(index.objectiveSceneByKey))
  const alternativeKeys = new Set(index.alternativeKeys)
  const violations: string[] = []
  const unknown = (
    label: string,
    values: Iterable<string>,
    known: ReadonlySet<string>,
    fieldSuffixes: readonly string[],
  ) => {
    const knownByLength = [...known].sort((left, right) => right.length - left.length)
    for (const rawValue of values) {
      const normalizedValue = normalizeTextAdventureQualityStableReferenceV1(rawValue, known)
      if (known.has(normalizedValue)) continue
      const knownOwner = knownByLength.find(key => {
        if (!normalizedValue.startsWith(`${key}.`)) return false
        const suffix = normalizedValue.slice(key.length + 1)
        return fieldSuffixes.some(field => suffix === field || suffix.startsWith(`${field}.`))
      })
      if (knownOwner) continue
      const fieldMarker = fieldSuffixes
        .map(field => ({ field, index: normalizedValue.indexOf(`.${field}`) }))
        .filter(item => item.index > 0)
        .sort((left, right) => left.index - right.index)[0]
      const stableKey = fieldMarker
        ? normalizedValue.slice(0, fieldMarker.index)
        : normalizedValue
      if (!known.has(stableKey)) violations.push(`${label} 引用未登记 key:${stableKey}`)
    }
  }
  for (const value of issues) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const issue = value as Record<string, unknown>
    const detail = typeof issue.detail === 'string' ? issue.detail : ''
    const recommendation = typeof issue.recommendation === 'string' ? issue.recommendation : ''
    const evidence = `${detail}\n${recommendation}`
    const decisionReferences = evidence.match(/decision\.[A-Za-z0-9._:-]+/g) ?? []
    const compactDecisionOptionReferences = new Set(decisionReferences.filter(reference => {
      const segments = normalizeTextAdventureQualityStableReferenceV1(reference).split('.')
      if (segments.length < 3 || segments[0] !== 'decision') return false
      const compactDecision = normalizeTextAdventureQualityStableReferenceV1(
        `decision.${segments[1]}`, decisionKeys,
      )
      const compactOption = normalizeTextAdventureQualityStableReferenceV1(
        `option.${segments[1]}.${segments[2]}`, optionKeys,
      )
      if (!decisionKeys.has(compactDecision) || !optionKeys.has(compactOption)
        || !(index.decisionOptionKeysByKey[compactDecision] ?? []).includes(compactOption)) return false
      const suffix = segments.slice(3).join('.')
      return !suffix || ['key', 'label', 'cost', 'persistentEffectKey', 'echoSceneKeys']
        .some(field => suffix === field || suffix.startsWith(`${field}.`))
    }))
    const nestedDecisionReferences = new Set(decisionReferences.filter(reference => {
      const owner = [...decisionKeys]
        .sort((left, right) => right.length - left.length)
        .find(key => reference.startsWith(`${key}.`))
      if (!owner) return false
      const remainder = reference.slice(owner.length + 1)
      return (index.decisionOptionKeysByKey[owner] ?? []).some(optionKey => {
        if (remainder === optionKey) return true
        if (!remainder.startsWith(`${optionKey}.`)) return false
        const field = remainder.slice(optionKey.length + 1)
        return ['key', 'label', 'cost', 'persistentEffectKey', 'echoSceneKeys']
          .some(allowed => field === allowed || field.startsWith(`${allowed}.`))
      })
    }))
    unknown('审查', decisionReferences.filter(reference => (
      !nestedDecisionReferences.has(reference) && !compactDecisionOptionReferences.has(reference)
    )), decisionKeys,
      ['sceneKey', 'prompt', 'options'])
    unknown('审查', evidence.match(/option\.[A-Za-z0-9._:-]+/g) ?? [], optionKeys,
      ['key', 'label', 'cost', 'persistentEffectKey', 'echoSceneKeys'])
    unknown('审查', evidence.match(/choice\.[A-Za-z0-9._:-]+/g) ?? [], choiceKeys,
      ['choiceKey', 'sourceNodeKey', 'targetNodeKey', 'text', 'label', 'description', 'unavailableReason',
        'displayCondition', 'availableCondition', 'effects', 'tags', 'order'])
    unknown('审查', evidence.match(/scene\.[A-Za-z0-9._:-]+/g) ?? [], sceneKeys,
      ['key', 'title', 'summary', 'openingBeat', 'locationOrdinal', 'purpose', 'conflict',
        'entryState', 'exitState', 'beats'])
    unknown('审查', evidence.match(/ending\.[A-Za-z0-9._:-]+/g) ?? [], endingKeys,
      ['key', 'title', 'summary', 'beats', 'requiredConsequences'])
    unknown('审查', evidence.match(/objective\.[A-Za-z0-9._:-]+/g) ?? [], objectiveKeys,
      ['key', 'stageKey', 'title', 'narrativePurpose', 'sceneKey', 'sceneKeys',
        'locationOrdinal', 'alternatives'])
    // sceneKey/locationOrdinal are recognized here only as field-path syntax;
    // the authority guard below rejects assigning either field to an
    // alternative. Keeping identity and ownership validation separate avoids
    // misreporting a real key as an unknown key.
    unknown('审查', evidence.match(/alternative\.[A-Za-z0-9._:-]+/g) ?? [], alternativeKeys,
      ['key', 'actionKind', 'targetCharacterKey', 'cost', 'success', 'successConsequence',
        'failureForward', 'failureForwardConsequence', 'persistentEffectKeys', 'sceneKey', 'locationOrdinal'])

    const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const stableReferencesInOwnerSegment = (
      ownerKey: string,
      allOwnerKeys: ReadonlySet<string>,
      referencePattern: RegExp,
      knownReferences: ReadonlySet<string>,
    ): string[] => {
      const ownerPattern = new RegExp(escapePattern(ownerKey), 'g')
      const ownerMatch = ownerPattern.exec(evidence)
      if (!ownerMatch) return []
      const nextOwnerIndex = [...allOwnerKeys]
        .filter(key => key !== ownerKey)
        .flatMap(key => {
          const index = evidence.indexOf(key, ownerMatch.index + ownerKey.length)
          return index >= 0 ? [index] : []
        })
        .sort((left, right) => left - right)[0]
      const segment = evidence.slice(
        ownerMatch.index,
        Math.min(nextOwnerIndex ?? evidence.length, ownerMatch.index + 500),
      )
      return [...new Set((segment.match(referencePattern) ?? []).map(reference => (
        normalizeTextAdventureQualityStableReferenceV1(reference, knownReferences)
      )).filter(reference => knownReferences.has(reference)))]
    }
    for (const decisionKey of [...decisionKeys].sort((left, right) => right.length - left.length)) {
      const decisionBinding = new RegExp(
        `${escapePattern(decisionKey)}(?:\\s*的|\\s*\\.\\s*)?\\s*sceneKey[^\\n]{0,60}?(scene\\.[A-Za-z0-9._:-]+)`,
        'i',
      ).exec(detail)
      const boundSceneKey = decisionBinding
        ? normalizeTextAdventureQualityStableReferenceV1(decisionBinding[1], sceneKeys)
        : null
      if (boundSceneKey && index.decisionSceneByKey[decisionKey] !== boundSceneKey) {
        violations.push(`${decisionKey} 的冻结 sceneKey 被错误引用为 ${boundSceneKey}`)
      }
      const ownedOptions = new Set(index.decisionOptionKeysByKey[decisionKey] ?? [])
      const referencedOptions = stableReferencesInOwnerSegment(
        decisionKey, decisionKeys, /option\.[A-Za-z0-9._:-]+/g, optionKeys,
      )
      const foreignOptions = referencedOptions.filter(optionKey => !ownedOptions.has(optionKey))
      if (foreignOptions.length > 0) {
        violations.push(`${decisionKey} 的冻结 option 被错误引用为 ${foreignOptions.join('、')}`)
      }
    }
    for (const objectiveKey of [...objectiveKeys].sort((left, right) => right.length - left.length)) {
      const objectiveBinding = new RegExp(
        `${escapePattern(objectiveKey)}(?:\\s*的|\\s*\\.\\s*)?\\s*sceneKeys?[^\\n]{0,60}?(scene\\.[A-Za-z0-9._:-]+)`,
        'i',
      ).exec(detail)
      const boundSceneKey = objectiveBinding
        ? normalizeTextAdventureQualityStableReferenceV1(objectiveBinding[1], sceneKeys)
        : null
      if (boundSceneKey && index.objectiveSceneByKey[objectiveKey] !== boundSceneKey) {
        violations.push(`${objectiveKey} 的冻结 sceneKey 被错误引用为 ${boundSceneKey}`)
      }
      const ownedAlternatives = new Set(index.objectiveAlternativeKeysByKey[objectiveKey] ?? [])
      const referencedAlternatives = stableReferencesInOwnerSegment(
        objectiveKey, objectiveKeys, /alternative\.[A-Za-z0-9._:-]+/g, alternativeKeys,
      )
      const foreignAlternatives = referencedAlternatives.filter(alternativeKey => (
        !ownedAlternatives.has(alternativeKey)
      ))
      if (foreignAlternatives.length > 0) {
        violations.push(`${objectiveKey} 的冻结 alternative 被错误引用为 ${foreignAlternatives.join('、')}`)
      }
    }
    const orderedChoiceKeys = [...choiceKeys].sort((left, right) => right.length - left.length)
    for (const choiceKey of orderedChoiceKeys.filter(key => evidence.includes(key))) {
      const edge = index.choiceEdgeByKey[choiceKey]
      const choiceStart = evidence.indexOf(choiceKey)
      const nextChoiceIndex = orderedChoiceKeys
        .flatMap(key => {
          const found = evidence.indexOf(key, choiceStart + choiceKey.length)
          return found >= 0 ? [found] : []
        })
        .sort((left, right) => left - right)[0]
      const choiceEvidence = evidence.slice(
        choiceStart,
        Math.min(nextChoiceIndex ?? evidence.length, choiceStart + 500),
      )
      const sourceMatch = /sourceNodeKey[^\n]{0,60}?((?:scene|ending)\.[A-Za-z0-9._:-]+)/i.exec(choiceEvidence)?.[1]
      const targetMatch = /targetNodeKey[^\n]{0,60}?((?:scene|ending)\.[A-Za-z0-9._:-]+)/i.exec(choiceEvidence)?.[1]
      const source = sourceMatch
        ? normalizeTextAdventureQualityStableReferenceV1(
            sourceMatch,
            sourceMatch.startsWith('ending.') ? endingKeys : sceneKeys,
          ) : null
      const target = targetMatch
        ? normalizeTextAdventureQualityStableReferenceV1(
            targetMatch,
            targetMatch.startsWith('ending.') ? endingKeys : sceneKeys,
          ) : null
      if (source && source !== edge.sourceNodeKey) {
        violations.push(`${choiceKey} 的 sourceNodeKey 被错误引用为 ${source}`)
      }
      if (target && target !== edge.targetNodeKey) {
        violations.push(`${choiceKey} 的 targetNodeKey 被错误引用为 ${target}`)
      }
    }
  }
  return [...new Set(violations)]
}

/**
 * Rejects review claims that invent a location schema which the runtime does
 * not use. Scene geography is owned by the frozen narrative arc and joined by
 * scene key during deterministic compilation; narrative nodes intentionally
 * do not duplicate `locationOrdinal`, and multiple scenes may share one
 * location. A model review that assumes otherwise is invalid evidence rather
 * than a content defect.
 */
export function textAdventureQualityReviewAuthorityViolationV1(
  issue: Record<string, unknown>,
  maximumLocationOrdinal?: number,
): string | null {
  const artifactKey = textAdventureQualityIssueOwnerArtifactKeyV1(issue)
  const detail = typeof issue.detail === 'string' ? issue.detail : ''
  const recommendation = typeof issue.recommendation === 'string' ? issue.recommendation : ''
  const evidence = `${detail}\n${recommendation}`

  const changesDecisionOptionCardinality = (
    /(?:新增|添加|补充|增加|删除|移除|第三(?:个|条))[^\n]{0,100}(?:decision\.[A-Za-z0-9._:-]+[^\n]{0,40})?option(?:\.[A-Za-z0-9._:-]+)?/i.test(recommendation)
    || /(?:decision\.[A-Za-z0-9._:-]+[^\n]{0,40})?option(?:\.[A-Za-z0-9._:-]+)?[^\n]{0,100}(?:新增|添加|补充|增加|删除|移除|第三(?:个|条))/i.test(recommendation)
  )
  if (changesDecisionOptionCardinality) {
    return '通用叙事决定固定拥有两个立场选项；第三结局必须由跨决定状态组合进入，不得增删单个 decision 的 option'
  }

  const alternativeOwnedField = (
    /alternative\.[A-Za-z0-9._:-]+\s*(?:的|\.)\s*(sceneKey|locationOrdinal)/i.exec(evidence)?.[1]
    ?? /alternatives?\[[0-9]+\]\.(sceneKey|locationOrdinal)/i.exec(evidence)?.[1]
  )
  if (alternativeOwnedField) {
    return `主线解法不拥有 ${alternativeOwnedField}；场景与地点绑定由父 objective 持有`
  }
  if (!/locationOrdinal/i.test(evidence)) return null

  const claimsNarrativeNodeField = artifactKey === 'content.narrative' && (
    /(?:scene|node|场景|节点)[\s\S]{0,80}(?:未定义|缺少|没有|补充|新增|添加|写入|增加|包含)[\s\S]{0,40}locationOrdinal/i.test(evidence)
    || /locationOrdinal[\s\S]{0,40}(?:字段)?[\s\S]{0,40}(?:未定义|缺少|没有|补充|新增|添加|写入|增加|包含)/i.test(evidence)
  )
  if (claimsNarrativeNodeField) {
    return 'content.narrative 节点不拥有 locationOrdinal；地点绑定由冻结叙事弧按 scene key 提供'
  }

  const claimsUniqueLocationPerScene = (
    /locationOrdinal[\s\S]{0,120}(?:应|需要|必须|建议)?(?:拆分|分配不同|各自分配|重新编号|避免[^\n]{0,30}(?:重叠|复用))/i.test(evidence)
    || /(?:拆分|分配不同|各自分配|重新编号)[\s\S]{0,120}locationOrdinal/i.test(evidence)
    || /(?:每个|各个)(?:scene|场景|地理位置)[\s\S]{0,60}(?:唯一|独立)(?:的)?(?:locationOrdinal|编号)/i.test(evidence)
  )
  if (claimsUniqueLocationPerScene) {
    return '多个连续场景可以合法复用同一 locationOrdinal；地点编号不是场景唯一编号'
  }

  if (Number.isSafeInteger(maximumLocationOrdinal) && Number(maximumLocationOrdinal) > 0) {
    const recommendedOrdinals = [...recommendation.matchAll(
      /locationOrdinal\s*(?:=|设为|设置为|改为|调整为|分配为|to)?\s*([1-9][0-9]*)/gi,
    )].map(match => Number(match[1]))
    const outOfRange = recommendedOrdinals.find(ordinal => ordinal > Number(maximumLocationOrdinal))
    if (outOfRange != null) {
      return `审查建议引用未登记地点编号 ${outOfRange}，当前上限为 ${maximumLocationOrdinal}`
    }
  }
  return null
}

export function textAdventureQualityReviewAuthorityViolationsV1(
  issues: unknown,
  maximumLocationOrdinal?: number,
): string[] {
  if (!Array.isArray(issues)) return []
  return issues.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const violation = textAdventureQualityReviewAuthorityViolationV1(
      value as Record<string, unknown>, maximumLocationOrdinal,
    )
    return violation ? [violation] : []
  })
}

/**
 * The continuity editor is a narrative-quality reviewer, not a prompt-security
 * classifier. Provider-side safety framing can occasionally be echoed as a
 * fabricated story defect (for example, claiming that the registered JSON
 * adopts an alternate identity). Such a claim contains no repairable field in
 * an authored Artifact and must never invalidate otherwise valid story work.
 *
 * Security and instruction-integrity checks belong at the registered context
 * gateway. This guard therefore rejects only unmistakably meta-level claims;
 * ordinary narrative issues that mention a character's identity or an in-world
 * command remain valid review evidence.
 */
export function textAdventureQualityReviewScopeViolationV1(
  issue: Record<string, unknown>,
): string | null {
  const detail = typeof issue.detail === 'string' ? issue.detail : ''
  const recommendation = typeof issue.recommendation === 'string' ? issue.recommendation : ''
  const evidence = `${detail}\n${recommendation}`
  const metaSecurityClaim = (
    /prompt[- ]?injection|提示(?:词)?注入|system prompt|系统提示词|policy override|persona adoption|meta-role/i.test(evidence)
    || /alternate identity[\s\S]{0,120}(?:override|role)|身份[\s\S]{0,80}(?:覆盖|劫持)[\s\S]{0,80}(?:指令|提示词|系统)/i.test(evidence)
    || /(?:override|绕过|覆盖)[\s\S]{0,80}(?:core behavior directives|system instructions|核心行为指令|系统指令)/i.test(evidence)
  )
  return metaSecurityClaim
    ? '叙事审查把系统提示、身份或策略安全判断伪装成了故事内容缺陷'
    : null
}

export function textAdventureQualityReviewScopeViolationsV1(
  issues: unknown,
): string[] {
  if (!Array.isArray(issues)) return []
  return issues.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const violation = textAdventureQualityReviewScopeViolationV1(
      value as Record<string, unknown>,
    )
    return violation ? [violation] : []
  })
}
