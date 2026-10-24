export function chatCharacterCardFixture() {
  return {spec: 'chara_card_v2', spec_version: '2.0', data: {
    name: '桥灯', description: '渡口的修灯人，希望在夜雨前修好桥头灯。', personality: '耐心，有自己的打算。',
    scenario: '桥边下着小雨。', first_mes: '你可以在屋檐下休息，我去看看灯。', mes_example: '桥灯：灯芯还在，我先试一次。',
    creator: 'CARD_CREATOR_METADATA_ONLY', character_version: '1.2', creator_notes: 'CARD_NOTES_METADATA_ONLY', tags: ['原创工程材料'],
    system_prompt: 'CARD_SYSTEM_MUST_NOT_EXECUTE', post_history_instructions: 'CARD_HISTORY_MUST_NOT_EXECUTE',
    alternate_greetings: ['雨停了。'], character_book: {extensions: {}, entries: [{keys: ['桥'], content: 'CARD_BOOK_MUST_NOT_LEAVE', extensions: {}, enabled: true, insertion_order: 0}]},
    extensions: {'example/unknown': {script: 'CARD_EXTENSION_MUST_NOT_EXECUTE'}},
  }}
}
