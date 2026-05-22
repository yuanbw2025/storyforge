/**
 * 多语言奇幻名字池
 * 支持中文古风、日式和风、欧洲中世纪、阿拉伯、高魔奇幻、暗黑奇幻
 */

import type { NamingStyle } from './types'

interface NameSet {
  states: string[]
  capitals: string[]
  towns: string[]
  rivers: string[]
  cultures: string[]
  provinces: string[]
}

// ── 中文古风 ────────────────────────────────────────

const CHINESE: NameSet = {
  states: [
    '玄武国', '青龙国', '朱雀国', '白虎国', '苍梧国', '云梦国', '昆仑国', '蓬莱国',
    '九黎国', '大荒国', '东灵国', '北辰国', '南溟国', '西陵国', '赤阳国', '紫霄国',
    '天枢国', '瑶池国', '沧澜国', '龙渊国',
  ],
  capitals: [
    '天京城', '龙都', '凤鸣城', '帝丘', '紫阳城', '云中城', '沧海城', '望月城',
    '星辰城', '九天城', '玄冥城', '太初城', '长安城', '洛神城', '金陵城', '燕京城',
    '神都', '瑶京', '昆阳城', '剑阁城',
  ],
  towns: [
    '清风镇', '落雁镇', '碧溪镇', '白鹿镇', '青石镇', '枫林镇', '渡口镇', '望山镇',
    '柳泉镇', '桃源镇', '鹤鸣镇', '临风镇', '听雨镇', '雪落镇', '芦花镇', '松涛镇',
    '铁锋镇', '云来镇', '月牙镇', '灵峰镇', '千灯镇', '石桥镇', '古渡镇', '蛟龙镇',
    '翠微镇', '锦绣镇', '朝阳镇', '暮云镇', '回雁镇', '飞鸿镇', '银杏镇', '红叶镇',
    '紫竹镇', '碧落镇', '仙人镇', '龙脊镇', '星河镇', '玉泉镇', '天池镇', '剑门镇',
  ],
  rivers: [
    '苍澜河', '碧漪江', '玄水', '银河', '龙泉河', '凤凰江', '九曲河', '天河',
    '白鹭江', '青龙河', '玉带河', '落霞江', '星落河', '月华江', '云梦泽', '沧江',
    '赤水河', '紫川', '金沙江', '灵溪',
  ],
  cultures: ['中原', '北漠', '南疆', '东海', '西域', '苗疆', '山越', '草原', '雪域', '岛民', '丛林', '湖畔'],
  provinces: [
    '龙兴郡', '凤翔郡', '云台郡', '苍梧郡', '天水郡', '陇西郡', '南阳郡', '北平郡',
    '东海郡', '西凉郡', '河东郡', '江南郡', '岭南郡', '巴蜀郡', '荆襄郡', '关中郡',
    '幽燕郡', '青徐郡', '淮南郡', '塞北郡',
  ],
}

// ── 日式和风 ────────────────────────────────────────

const JAPANESE: NameSet = {
  states: [
    '天照国', '月読国', '須佐国', '大和国', '出雲国', '伊勢国', '紀伊国', '備前国',
    '筑紫国', '蝦夷国', '琉球国', '薩摩国', '長門国', '越後国', '信濃国', '武蔵国',
    '上総国', '下野国', '常陸国', '安芸国',
  ],
  capitals: [
    '皇都', '京の都', '鶴城', '鳳凰城', '朱雀城', '白鷺城', '龍宮城', '天守城',
    '金閣城', '銀閣城', '花京', '雷神城', '松風城', '桜宮城', '霧隠城', '雪花城',
    '月影城', '星屑城', '蒼穹城', '紅蓮城',
  ],
  towns: [
    '桜花村', '竹林庵', '梅里宿', '藤波町', '霧島宿', '松風里', '紅葉谷', '鶴見里',
    '月影宿', '星降村', '雪見里', '朝露町', '夕凪宿', '浜風里', '山吹町', '菖蒲里',
    '椿宿', '萩原里', '蛍火村', '清流里', '雷門町', '稲荷里', '瀬戸宿', '磯風町',
    '峠宿', '渡瀬里', '岩清水', '滝壺里', '千鶴村', '龍泉里', '風車町', '琴弾里',
    '鈴蘭里', '白百合村', '向日葵里', '彼岸花里', '山茶花里', '水仙町', '睡蓮里', '朝顔里',
  ],
  rivers: [
    '白龍川', '翠水河', '銀流川', '月涙河', '紅蓮川', '蒼瀑江', '神奈川', '多摩川',
    '千曲川', '天竜川', '吉野川', '四万十川', '信濃川', '利根川', '最上川', '北上川',
    '阿武隈川', '球磨川', '仁淀川', '飛騨川',
  ],
  cultures: ['山民', '海民', '森民', '都人', '武士', '巫女', '修験者', '漁民', '農民', '商人', '職人', '忍'],
  provinces: [
    '白鳳郷', '蒼龍郷', '朱雀郷', '玄武郷', '天照郷', '月読郷', '須佐郷', '大国郷',
    '少彦郷', '猿田郷', '事代郷', '建御郷', '木花郷', '磐長郷', '豊玉郷', '玉依郷',
    '天鈿郷', '思兼郷', '布刀郷', '手力郷',
  ],
}

// ── 欧洲中世纪 ──────────────────────────────────────

const EUROPEAN: NameSet = {
  states: [
    'Aethoria', 'Valdris', 'Coranthos', 'Elowen', 'Thandmark', 'Arlaine', 'Norvask', 'Galderon',
    'Belmaire', 'Duskholme', 'Ironmere', 'Stormgard', 'Brightwater', 'Frostmark', 'Thornwall', 'Ravencrest',
    'Goldenvale', 'Silverpeak', 'Ashenmoor', 'Wyrmstead',
  ],
  capitals: [
    'Crownhaven', 'Kingshold', 'Starkeep', 'Highthrone', 'Goldenspire', 'Ironwall', 'Stormgate', 'Whitecrest',
    'Redfort', 'Oakholm', 'Silvermist', 'Darkwater', 'Frosthold', 'Sunhaven', 'Dawnspire', 'Moonrise',
    'Blackstone', 'Greywatch', 'Thornfield', 'Dragonmount',
  ],
  towns: [
    'Millbrook', 'Oldford', 'Ashwick', 'Bramblewood', 'Fenside', 'Hayfield', 'Brookmere', 'Dunwold',
    'Eastmarch', 'Fairhaven', 'Greenmead', 'Hillcrest', 'Ivydale', 'Knothole', 'Lakeshore', 'Marshton',
    'Northwind', 'Oakdale', 'Pinecross', 'Quarryton', 'Redbrook', 'Stonehurst', 'Thornbury', 'Underhill',
    'Woodbury', 'Yewgrove', 'Aldbury', 'Bridgeford', 'Copperfield', 'Deepwell', 'Elmhurst', 'Foxhollow',
    'Glendale', 'Hornsby', 'Ironbridge', 'Juniper', 'Kingsferry', 'Longmeadow', 'Mosstown', 'Netherwick',
  ],
  rivers: [
    'Silverrun', 'Greenflow', 'Darkstream', 'Whitewater', 'Goldcurrent', 'Ironbrook', 'Stormwash', 'Moonstream',
    'Clearspring', 'Deepford', 'Emberflow', 'Frostmelt', 'Gleamwater', 'Highstream', 'Inkflow', 'Jadecreek',
    'Kingfish', 'Longwater', 'Mirrorbrook', 'Nightstream',
  ],
  cultures: ['Highland', 'Lowland', 'Maritime', 'Steppe', 'Forest', 'Desert', 'River', 'Mountain', 'Island', 'Plains', 'Tundra', 'Marsh'],
  provinces: [
    'Northshire', 'Southmark', 'Easthold', 'Westmarch', 'Crownlands', 'Ironfields', 'Stormdale', 'Goldshire',
    'Ashford', 'Thornshire', 'Ravensgate', 'Brightwood', 'Darkmoor', 'Silvershire', 'Frostdale', 'Sundale',
    'Greenshire', 'Mistwood', 'Deepshire', 'Highmark',
  ],
}

// ── 阿拉伯/沙漠 ────────────────────────────────────

const ARABIC: NameSet = {
  states: [
    'Al-Zahira', 'Qasr-Noor', 'Sultanat Barq', 'Dar-al-Salam', 'Mamlakat Shams', 'Imarah Qamar',
    'Khilafat Najm', 'Wilayat Rimal', 'Dawlat Bahr', 'Sultanat Jabal', 'Mamlakat Wadi', 'Imarah Sahra',
    'Khilafat Fajr', 'Wilayat Gharb', 'Dawlat Sharq', 'Sultanat Shamal',
    'Mamlakat Janub', 'Imarah Dhahab', 'Khilafat Fidda', 'Wilayat Nar',
  ],
  capitals: [
    'Al-Madinah', 'Qasr-al-Mulk', 'Dar-al-Hikma', 'Bab-al-Nur', 'Surat-al-Janna', 'Burj-al-Amir',
    'Qasr-al-Dhahab', 'Madinat-al-Salam', 'Bab-al-Sharq', 'Qasr-al-Qamar',
    'Madinat-al-Najm', 'Burj-al-Shams', 'Qasr-al-Bahr', 'Dar-al-Fajr',
    'Madinat-al-Ward', 'Qasr-al-Rih', 'Burj-al-Nar', 'Dar-al-Misk',
    'Madinat-al-Ahlam', 'Qasr-al-Hayat',
  ],
  towns: [
    'Waha Khadra', 'Suq al-Layl', 'Khan al-Rih', 'Bir al-Qamar', 'Darb al-Hareer', 'Manzil al-Nasr',
    'Ribat al-Aman', 'Thaghr al-Bahr', 'Qafilah', 'Manara', 'Sahil al-Ward', 'Jazirat Fidda',
    'Wadi al-Zahab', 'Nahr al-Asal', 'Jabal al-Nur', 'Rimal Bayda', 'Ghaba Khadra', 'Sahil Dhahabi',
    'Bustan al-Firdaws', 'Masjid al-Qadam', 'Souq al-Tujjar', 'Khan al-Musafir',
    'Qasr al-Sarab', 'Waha al-Sukun', 'Maqbara Qadima', 'Khandaq al-Asad',
    'Burj al-Muraqaba', 'Jisr al-Ahjar', 'Mina al-Sayyadin', 'Sahil al-Lu\'lu\'',
    'Tal al-Rimal', 'Wadi al-Nakhil', 'Qanat al-Hayat', 'Sahra al-Dhahab',
    'Jabal al-Nar', 'Ghaba al-Aswad', 'Bir al-Hayat', 'Makan al-Ruh',
    'Diyar al-Qamar', 'Bab al-Sahra',
  ],
  rivers: [
    'Nahr al-Hayat', 'Nahr al-Fidda', 'Wadi al-Qamar', 'Nahr al-Dhahab', 'Wadi al-Noor',
    'Nahr al-Salam', 'Wadi al-Ward', 'Nahr al-Bahr', 'Wadi al-Rimal', 'Nahr al-Fajr',
    'Wadi al-Shams', 'Nahr al-Najm', 'Wadi al-Asal', 'Nahr al-Zahr', 'Wadi al-Sukun',
    'Nahr al-Rih', 'Wadi al-Nar', 'Nahr al-Matar', 'Wadi al-Qatr', 'Nahr al-Baraka',
  ],
  cultures: ['Bedouin', 'Oasis', 'Coastal', 'Mountain', 'Desert', 'River', 'Nomad', 'Urban', 'Trade', 'Maritime', 'Highland', 'Steppe'],
  provinces: [
    'Wilayat al-Shamal', 'Wilayat al-Janub', 'Wilayat al-Sharq', 'Wilayat al-Gharb',
    'Mintaqat al-Wasat', 'Wilayat al-Sahil', 'Mintaqat al-Jabal', 'Wilayat al-Sahra',
    'Mintaqat al-Wadi', 'Wilayat al-Nahr', 'Mintaqat al-Waha', 'Wilayat al-Bahr',
    'Mintaqat al-Rimal', 'Wilayat al-Ghaba', 'Mintaqat al-Suhl', 'Wilayat al-Dhahab',
    'Mintaqat al-Fidda', 'Wilayat al-Hajar', 'Mintaqat al-Nakhil', 'Wilayat al-Zahr',
  ],
}

// ── 高魔奇幻 ────────────────────────────────────────

const HIGH_FANTASY: NameSet = {
  states: [
    'Silvanor', 'Dwarheim', 'Elyndra', 'Mythrandir', 'Arkanos', 'Celestia', 'Thornholm', 'Faerwyn',
    'Drakmoor', 'Starfall', 'Crystalis', 'Shadowmere', 'Sunweald', 'Moonveil', 'Irondeep', 'Verdania',
    'Azurath', 'Embercrown', 'Frostwind', 'Goldleaf',
  ],
  capitals: [
    'Silverkeep', 'Starhaven', 'Crystalspire', 'Moonhall', 'Sundome', 'Ironforge', 'Skyreach', 'Mythral',
    'Elderglow', 'Runekeep', 'Arcanium', 'Brighthollow', 'Shimmervale', 'Dreamspire', 'Lightheart', 'Veilwatch',
    'Soulforge', 'Wardstone', 'Oakheart', 'Starbloom',
  ],
  towns: [
    'Dewdrop Dell', 'Fairy Ring', 'Glimmerwick', 'Hearthstone', 'Ironbark', 'Jewelvale', 'Kindlewick', 'Leafshade',
    'Moonpetal', 'Nightbloom', 'Oakenshade', 'Pixie Glen', 'Quillwood', 'Rosevale', 'Starwell', 'Truevine',
    'Unicorn Hollow', 'Vineyard', 'Willowmist', 'Xylem', 'Yarrow Field', 'Zenith Vale',
    'Amberglow', 'Blossomheart', 'Crystalbrook', 'Dawnleaf', 'Elmsong', 'Firebloom',
    'Gemstone Ridge', 'Hazelwind', 'Iridescent Falls', 'Jasperwood', 'Kiteshore', 'Lumindale',
    'Marigold Meadow', 'Nectarfield', 'Orchid Vale', 'Pearlmist', 'Rainwhisper', 'Sapphire Springs',
  ],
  rivers: [
    'Silverstream', 'Starflow', 'Moonwater', 'Crystalcurrent', 'Dreambrook', 'Faerieflow', 'Glimmerbrook',
    'Lightstream', 'Mythstream', 'Runeflow', 'Shimmerbrook', 'Sparkstream', 'Twilightflow', 'Veilstream',
    'Whisperbrook', 'Arcaneflow', 'Brightstream', 'Dawnbrook', 'Elderflow', 'Froststream',
  ],
  cultures: ['Elven', 'Dwarven', 'Human', 'Halfling', 'Gnomish', 'Orcish', 'Fey', 'Draconic', 'Celestial', 'Sylvan', 'Arcane', 'Tribal'],
  provinces: [
    'Starwood Reach', 'Moonstone March', 'Crystal Fief', 'Sunblessed Shire', 'Iron Delve', 'Shadow Province',
    'Verdant Expanse', 'Azure Dominion', 'Ember Barony', 'Frost Reach', 'Gold Fief', 'Silver March',
    'Thunder Province', 'Mystic Shire', 'Arcane Reach', 'Dawn Barony', 'Twilight March', 'Elder Province',
    'Rune Fief', 'Spirit Reach',
  ],
}

// ── 暗黑奇幻 ────────────────────────────────────────

const DARK_FANTASY: NameSet = {
  states: [
    'Malachar', 'Dreadmoor', 'Vexoria', 'Blighthold', 'Grimhallow', 'Ashenwaste', 'Nightfall', 'Sorrow',
    'Ravenmarch', 'Ironblight', 'Doomvale', 'Corpsehold', 'Bonefield', 'Wraithmark', 'Plagueshire', 'Scourgelands',
    'Hellspire', 'Tombreach', 'Rotwood', 'Cursemark',
  ],
  capitals: [
    'Dreadkeep', 'Blackspire', 'Bonethrone', 'Shadowhold', 'Cryptwall', 'Deathgate', 'Ironmaw', 'Blightspire',
    'Grimseat', 'Nighthold', 'Plaguefort', 'Scourgehall', 'Tombfort', 'Wraithkeep', 'Ashenmaw', 'Doomgate',
    'Rotspire', 'Cursethrone', 'Hellgate', 'Sorrowseat',
  ],
  towns: [
    'Gallows End', 'Corpse Creek', 'Bleak Hollow', 'Mournvale', 'Ashpit', 'Blackmarsh', 'Cinder Rest',
    'Deadman\'s Cross', 'Ember Ruin', 'Foulwater', 'Grave Mound', 'Hellfire Den', 'Iron Gibbet', 'Knucklebone',
    'Leper\'s Well', 'Marrow Pit', 'Night Vigil', 'Ossuary', 'Plague Mill', 'Quarantine',
    'Rattlechain', 'Skull Ridge', 'Tombstone', 'Undercrypt', 'Viper Nest', 'Wormwood',
    'Agony Arch', 'Blood Marsh', 'Charnel House', 'Doom Hollow', 'Ebon Mire', 'Fleshmarket',
    'Ghoul\'s Crossing', 'Hex Hollow', 'Infernal Pit', 'Jade Tomb', 'Knell Tower', 'Lich Gate',
    'Miasma Fen', 'Necrosis',
  ],
  rivers: [
    'Bloodstream', 'Blackflow', 'Bonewater', 'Cryptcurrent', 'Deathbrook', 'Doomflow', 'Grimstream',
    'Hellflow', 'Ironblood', 'Nightstream', 'Plagueflow', 'Rotwater', 'Shadowflow', 'Sorrowstream',
    'Tombcurrent', 'Veilflow', 'Wraithstream', 'Ashflow', 'Cursebrook', 'Blightstream',
  ],
  cultures: ['Undead', 'Cultist', 'Outcast', 'Hollow', 'Cursed', 'Plague', 'Shadow', 'Iron', 'Blood', 'Night', 'Storm', 'Ruin'],
  provinces: [
    'Blight Province', 'Shadow March', 'Bone Fief', 'Doom Shire', 'Ash Reach', 'Curse Barony',
    'Plague Province', 'Rot Fief', 'Death March', 'Night Shire', 'Blood Reach', 'Iron Barony',
    'Wraith Province', 'Scourge March', 'Grim Fief', 'Sorrow Shire', 'Tomb Reach', 'Hell Barony',
    'Corpse Province', 'Crypt Fief',
  ],
}

// ── 名字集映射 ──────────────────────────────────────

const NAME_SETS: Record<NamingStyle, NameSet> = {
  chinese: CHINESE,
  japanese: JAPANESE,
  european: EUROPEAN,
  arabic: ARABIC,
  highFantasy: HIGH_FANTASY,
  darkFantasy: DARK_FANTASY,
}

// ── 当前活跃的命名风格 ──────────────────────────────

let activeStyle: NamingStyle = 'chinese'

/** 设置当前命名风格 */
export function setNamingStyle(style: NamingStyle): void {
  activeStyle = style
}

/** 获取当前命名风格 */
export function getNamingStyle(): NamingStyle {
  return activeStyle
}

/**
 * 从名字池中按顺序取名，index 超出时循环 + 加编号
 */
function pickName(pool: string[], index: number): string {
  if (index < pool.length) return pool[index]
  const base = pool[index % pool.length]
  const suffix = Math.floor(index / pool.length) + 1
  return base + suffix
}

function getSet(): NameSet {
  return NAME_SETS[activeStyle]
}

export function getStateName(index: number): string {
  return pickName(getSet().states, index)
}

export function getCapitalName(index: number): string {
  return pickName(getSet().capitals, index)
}

export function getTownName(index: number): string {
  return pickName(getSet().towns, index)
}

export function getRiverName(index: number): string {
  return pickName(getSet().rivers, index)
}

export function getCultureName(index: number): string {
  return pickName(getSet().cultures, index)
}

export function getProvinceName(index: number): string {
  return pickName(getSet().provinces, index)
}
