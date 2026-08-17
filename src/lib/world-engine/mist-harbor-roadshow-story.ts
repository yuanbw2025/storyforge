import type { NarrativeBeatKind, NarrativeNodeKind } from '../types'

export interface MistHarborRoadshowNode {
  key: string
  kind: NarrativeNodeKind
  title: string
  summary: string
  successors: string[]
}

export interface MistHarborRoadshowBeat {
  nodeKey: string
  beatKey: string
  kind: NarrativeBeatKind
  speaker?: '林澈' | '余砚' | '顾潮生'
  text: string
}

export interface MistHarborRoadshowChoice {
  sourceNodeKey: string
  choiceKey: string
  text: string
  description: string
  targetNodeKey: string
  effectsJson?: string
}

export const MIST_HARBOR_ROADSHOW_NODES: MistHarborRoadshowNode[] = [
  { key: 'entry', kind: 'entry', title: '第一幕 · 失潮之夜', summary: '午夜潮汐没有到来，港民的姓名开始从账册与记忆里消失。', successors: ['archive', 'market'] },
  { key: 'archive', kind: 'scene', title: '被删去的潮位', summary: '林澈与余砚进入封闭档案馆，寻找十年前被抽走的黑潮记录。', successors: ['vault'] },
  { key: 'market', kind: 'scene', title: '潮灯下的失名者', summary: '林澈穿过仍未熄灯的集市，收集港民正在遗忘彼此的证言。', successors: ['patrol'] },
  { key: 'vault', kind: 'scene', title: '水线以下的铁匣', summary: '两人在档案馆地下取出校准带，发现黑潮事故曾被人为改写。', successors: ['undercity'] },
  { key: 'patrol', kind: 'scene', title: '巡潮队的十三分钟', summary: '顾潮生封锁集市，林澈从停摆的潮灯中找到被抹去的十三分钟。', successors: ['undercity'] },
  { key: 'undercity', kind: 'choice', title: '第二幕 · 城市的潮心', summary: '两条调查路线在地下泵站汇合，钟机真正的代价浮出水面。', successors: ['pump', 'shrine'] },
  { key: 'pump', kind: 'scene', title: '逆转的泵轮', summary: '林澈选择修复机械旁路，为重启潮汐钟争取一个不会吞没港区的窗口。', successors: ['north-tower'] },
  { key: 'shrine', kind: 'scene', title: '沉没者的名字', summary: '林澈沿旧祭台找回遇难者名录，让被城市抹去的人重新成为证词。', successors: ['north-tower'] },
  { key: 'north-tower', kind: 'choice', title: '北塔最后一盏灯', summary: '顾潮生在灯室坦白当年的选择，林澈必须决定先听父亲还是先取得议会证据。', successors: ['father-log', 'council-seal'] },
  { key: 'father-log', kind: 'scene', title: '父亲留下的第七码', summary: '旧铜灯播放林惟舟的最后记录：他既是事故参与者，也是阻止第二次共振的人。', successors: ['bell'] },
  { key: 'council-seal', kind: 'scene', title: '议会封缄令', summary: '三人取得仍具法律效力的封缄令，确认议会用秩序之名删除遇难者与撤离命令。', successors: ['bell'] },
  { key: 'bell', kind: 'choice', title: '第三幕 · 失声钟楼', summary: '潮位即将越过安全线，真相、秩序与远航只能先保住其中一种。', successors: ['public-square', 'sealed-engine', 'outbound-dock'] },
  { key: 'public-square', kind: 'scene', title: '让全港听见', summary: '钟声与事故原始记录同时广播，雾港在混乱中重新记起被删掉的人。', successors: ['truth'] },
  { key: 'sealed-engine', kind: 'scene', title: '七日之约', summary: '三人先恢复潮汐，再以不可撤销的公开期限换取港口安全撤离。', successors: ['home'] },
  { key: 'outbound-dock', kind: 'scene', title: '灯指向外海', summary: '林澈拒绝再次以记忆驱动钟机，带领船队追向制造异常潮源的黑海。', successors: ['sea'] },
  { key: 'truth', kind: 'ending', title: '结局 · 真相之钟', summary: '雾港付出动荡的代价，但从此没有任何名字可以被安静地删除。', successors: [] },
  { key: 'home', kind: 'ending', title: '结局 · 守灯人的黎明', summary: '潮水归来，三人在七日内完成公开调查，守港成为全城共同承担的职责。', successors: [] },
  { key: 'sea', kind: 'ending', title: '结局 · 向黑潮航行', summary: '雾港暂时失去潮汐钟，却获得选择未来的时间，林澈驶向异常潮汐的源头。', successors: [] },
]

type BeatLine = [NarrativeBeatKind, MistHarborRoadshowBeat['speaker'] | null, string]

function scene(nodeKey: string, lines: BeatLine[]): MistHarborRoadshowBeat[] {
  return lines.map(([kind, speaker, text], index) => ({
    nodeKey,
    beatKey: `${nodeKey}.${String(index + 1).padStart(2, '0')}`,
    kind,
    ...(speaker ? { speaker } : {}),
    text,
  }))
}

export const MIST_HARBOR_ROADSHOW_BEATS: MistHarborRoadshowBeat[] = [
  ...scene('entry', [
    ['system', null, '第一幕：失潮之夜。距离预计涨潮，已经过去十三分钟。'],
    ['narration', null, '雾从防波堤外翻进港湾，搁浅的船腹压在淤泥上，发出像骨头错位一样的闷响。'],
    ['narration', null, '林澈提着旧铜灯走过码头。灯焰没有朝海风倾斜，而是笔直指向沉默的潮汐钟楼。'],
    ['dialogue', '林澈', '潮没来，钟也没响。可真正不对劲的，是所有人都假装这只是一次晚潮。'],
    ['narration', null, '泊位登记员抓住她的袖口。他能背出每艘船的吃水，却怎么也想不起与自己共事二十年的副手姓名。'],
    ['action', null, '登记册上的墨迹正从人名一栏缓慢洇开，像被看不见的潮水一点点冲走。'],
    ['dialogue', '余砚', '林澈，别碰钟楼。先来档案馆。十年前也晚了十三分钟，然后港里少了四十七个名字。'],
    ['dialogue', '林澈', '你在密信里写的是“少了四十七个人”。'],
    ['dialogue', '余砚', '我现在不敢确定。记录说是人，议会说是名字。今夜之前，我以为那只是措辞。'],
    ['narration', null, '潮灯集市方向忽然传来一阵骚动。另一边，旧档案馆最高的窗亮起三短一长的蓝光。两条路都在催她做决定。'],
  ]),
  ...scene('archive', [
    ['narration', null, '档案馆半沉在防洪墙里。余砚从门内放下铁链，水已经漫过他靴子的第一排铜扣。'],
    ['dialogue', '余砚', '公共目录里，黑潮事故只剩天气报告。原始潮位、撤离令和钟机校准表，被同一枚印章借走后再也没有归还。'],
    ['dialogue', '林澈', '借阅人是谁？'],
    ['dialogue', '余砚', '没有名字。只有你父亲的守灯人徽记，以及顾潮生刚加入巡潮队时的编号。'],
    ['narration', null, '一排假书脊后藏着空铁匣。匣底没有文件，只压着一圈比尘埃更干净的纸页轮廓。'],
    ['action', null, '林澈把铜灯贴近匣壁，灯芯忽然分成七股。第七股火焰照出一道通往地下库房的水线。'],
    ['dialogue', '林澈', '父亲教过我：灯焰分叉，说明附近有被钟声反复覆盖的金属。文件还在下面。'],
    ['dialogue', '余砚', '地下库房在黑潮之后就封死了。今晚水位不升，反而给了我们一次进去的机会。'],
    ['narration', null, '他们撬开地板上的检修盖。黑暗里传来的不是流水声，而是一台停转十年的记录机仍在敲击空白纸带。'],
  ]),
  ...scene('market', [
    ['narration', null, '潮灯集市没有收摊。数百盏玻璃灯悬在棚顶，却只有靠近钟楼的一半还记得该按什么节律明灭。'],
    ['narration', null, '卖鱼人把价格牌翻来覆去，像第一次见到自己写下的字；一个孩子握着母亲的手，反复问她该怎么称呼。'],
    ['dialogue', '林澈', '别逼他们回忆名字。先记住衣服、声音、手上的茧。名字不是一个人存在过的唯一证据。'],
    ['narration', null, '她让摊主们把正在遗忘的细节写到潮灯纸罩上。很快，整条街像挂满了互相证明存在的微小证词。'],
    ['action', null, '所有潮灯每隔十三次闪烁，就会同时熄灭一次。熄灭的长度恰好对应事故记录里消失的十三分钟。'],
    ['dialogue', '顾潮生', '停止记录，熄灯回家。巡潮队接管集市，任何人不得靠近钟楼。'],
    ['dialogue', '林澈', '你不是怕人群靠近钟楼。你是怕他们在钟响之前先记住什么。'],
    ['dialogue', '顾潮生', '我怕的是三万人同时想起同一场灾难。恐慌会比黑潮先淹死这座港。'],
    ['narration', null, '顾潮生抬手封锁街口，却把自己的巡潮牌翻到背面。上面刻着一条只有守灯人与校准师看得懂的地下泵站路线。'],
  ]),
  ...scene('vault', [
    ['narration', null, '地下库房的门停在水线以下。林澈用守灯人徽章卡住齿轮，余砚则把一卷空纸带送进记录机。'],
    ['action', null, '机器先打印出四十七个空格，随后吐出一条覆盖着蓝色盐晶的黄铜校准带。'],
    ['dialogue', '余砚', '这是钟机的共振记录。事故当夜，议会把安全上限提高了三次，想用一次钟响推开整片黑潮。'],
    ['dialogue', '林澈', '他们成功了吗？'],
    ['dialogue', '余砚', '成功了一半。内港得救，外堤的撤离信号却被钟声覆盖。四十七名船工没有收到命令。'],
    ['narration', null, '校准带末端有林惟舟的手写字：如果城市只能靠遗忘代价继续运转，这台机器就不配被称作守护。'],
    ['dialogue', '林澈', '父亲不是被黑潮卷走的。他留在钟机旁，切断了下一次共振。'],
    ['narration', null, '记录机最后敲出一行新字：潮心正在地下泵站重新充能。距离不可逆共振，七十二分钟。'],
  ]),
  ...scene('patrol', [
    ['narration', null, '巡潮队把集市围成一个安静的圆。顾潮生命人收走写满姓名与特征的灯罩，却没有下令烧毁。'],
    ['dialogue', '林澈', '你保留这些证词，是因为你也开始忘了，对吗？'],
    ['dialogue', '顾潮生', '我记得事故编号、阵亡数字和封锁程序。我唯独想不起第一个被我从外堤赶回去的人是谁。'],
    ['narration', null, '他摘下手套。掌心用刀刻着两个模糊的字，伤口被反复划开，仍辨不清原来的姓名。'],
    ['dialogue', '顾潮生', '钟机把个人记忆当作校准噪声抹掉。十年前我们以为这是短暂副作用，后来才发现议会把副作用写成了维稳方案。'],
    ['action', null, '林澈将十三次灯闪与巡潮队换岗钟对齐，定位出被隐藏的地下泵站入口。'],
    ['dialogue', '林澈', '给我一小时。我会让钟机停下来，也会把你不敢说的那部分带回来。'],
    ['dialogue', '顾潮生', '我给你四十分钟。不是为了议会——是因为再晚，连我也不会记得该拦住谁。'],
  ]),
  ...scene('undercity', [
    ['system', null, '第二幕：城市的潮心。距离不可逆共振，四十六分钟。'],
    ['narration', null, '地下泵站像一颗倒悬的心脏。六条铸铁水道通向不同港区，中央齿轮却在无水的管道里自行旋转。'],
    ['narration', null, '余砚从档案路线赶来，把黄铜校准带铺在控制台；顾潮生则从集市入口带回写满证词的灯罩。'],
    ['dialogue', '余砚', '钟机没有停。它只是把潮汐从海水转移到了记忆。每抹去一段共同记忆，就能维持一次防潮共振。'],
    ['dialogue', '顾潮生', '今晚议会启动了自动程序。因为外海出现了与十年前相同的黑潮波形。'],
    ['dialogue', '林澈', '所以潮没有消失。它被关在所有人忘掉的事情里。'],
    ['action', null, '控制台显示两条可用旁路：修复西侧泵轮，可以降低重启时的冲击；沿东侧祭渠进入沉没神龛，可以找回被钟机作为噪声删除的姓名索引。'],
    ['dialogue', '余砚', '泵轮给我们安全窗口，名录给我们公开事故的证据。时间只够先走一边。'],
    ['dialogue', '顾潮生', '无论选哪边，最后都要去北塔。你父亲留下的主钥匙在那里。'],
    ['narration', null, '林澈把旧铜灯放在两条水道之间。火焰同时向机械轰鸣与无声祭台倾斜，像在等待她定义什么才算拯救。'],
  ]),
  ...scene('pump', [
    ['narration', null, '西侧泵轮被盐锈焊死。每转动一格，整座泵站都会传来远处房屋地基的震颤。'],
    ['dialogue', '余砚', '旧图上有手动泄压顺序，但缺了最后一步。错一次，内港会在钟响前先被倒灌。'],
    ['dialogue', '林澈', '最后一步不在图上，在灯塔值夜歌里。父亲把检修口令编进了我们每天唱的东西。'],
    ['action', null, '她按“低灯、转风、守到天明”的节律扳动阀门，余砚同步调整校准带。'],
    ['narration', null, '泵轮先发出刺耳尖啸，随后第一次顺着海潮方向缓慢旋转。控制台上的红线退回安全区。'],
    ['dialogue', '余砚', '我们得到二十二分钟缓冲。即使重启失败，港区也有时间撤离。'],
    ['dialogue', '林澈', '把顺序写三份。一份给巡潮队，一份留档，一份贴到市场。以后不能再只有某个人知道怎么救这座城。'],
    ['narration', null, '通往北塔的维修升降梯重新亮起。机械路线没有找回姓名，却让真相不再必须用整座城市作赌注。'],
  ]),
  ...scene('shrine', [
    ['narration', null, '东侧祭渠尽头没有神像，只有四十七块被海水磨平的铜牌。每块牌背后都刻着同一句“身份待核”。'],
    ['dialogue', '顾潮生', '外堤的人没有进入官方死亡名册。议会说没有姓名，就无法确认损失，也就不必承担撤离失败。'],
    ['dialogue', '林澈', '可市场上的潮灯记得他们。船号、口音、戒指、欠下的酒钱——这些都能把人拼回来。'],
    ['action', null, '她把写满证词的灯罩逐一罩在铜牌上。灯火透过纸面，在墙上投出四十七组残缺却彼此吻合的生活。'],
    ['narration', null, '最后一块铜牌亮起时，地下传来真实海水的回声。钟机失去了一部分可供吞噬的匿名记忆。'],
    ['dialogue', '顾潮生', '第一个人叫顾闻洲。我哥哥。我奉命把他的船拦在外堤，然后看着议会从名册上删掉他。'],
    ['dialogue', '林澈', '记住他。等钟响以后，你亲口把他的名字说给全港听。'],
    ['narration', null, '祭台后方打开一条守灵人密道，尽头正是北塔。姓名路线没有带来安全窗口，却让沉默第一次有了具体重量。'],
  ]),
  ...scene('north-tower', [
    ['narration', null, '北塔灯室俯瞰整座雾港。没有潮水的海湾像一只空眼，数千盏窗灯正在按钟机节律依次熄灭。'],
    ['action', null, '林澈把旧铜灯放进主灯座。黄铜底盘弹开，露出一枚录音蜡筒和一枚带议会纹章的封缄钥匙。'],
    ['dialogue', '余砚', '林惟舟把私人记录和法律证据放在一起，却设计成只能先取出一个。'],
    ['dialogue', '顾潮生', '因为他知道，女儿会想听父亲；调查者会想拿证据。无论你先选哪一个，另一个都会被灯火熔毁。'],
    ['dialogue', '林澈', '你当时就在这里。告诉我，他为什么不自己公开？'],
    ['dialogue', '顾潮生', '因为钟机第一次失控，是他同意启动的。我们都以为能救下整座港。等他发现代价，已经来不及让自己只做英雄。'],
    ['narration', null, '灯塔玻璃外掠过一道黑色潮线。远海并非没有潮，而是有一堵比夜色更黑的水墙正在接近。'],
    ['dialogue', '余砚', '还剩二十七分钟。蜡筒能告诉我们主钥匙怎么用，封缄令能证明议会无权继续隐瞒。'],
    ['dialogue', '林澈', '我不需要一个无瑕的父亲，也不需要一份替我做决定的命令。我只需要足够的东西，把选择带到钟楼。'],
    ['narration', null, '她伸手探入灯座。火焰沿着两个机关同时升高，逼她承认任何证据都有被放弃的另一面。'],
  ]),
  ...scene('father-log', [
    ['narration', null, '蜡筒开始转动。林惟舟的声音被十年盐雾磨得沙哑，却仍保持守灯人报时的平稳。'],
    ['dialogue', '林澈', '父亲，我不是来问你是不是英雄。我只想知道钟楼里还有什么选择。'],
    ['narration', null, '录音承认他参与设计了记忆校准层，也承认议会曾以“可逆遗忘”为条件批准试验。事故发生后，所谓可逆从未被验证。'],
    ['narration', null, '林惟舟留下三种主钥匙位置：公开记录会让全港同时恢复记忆；限制共振能先救港但延迟真相；彻底断钟则必须引导船队离港。'],
    ['dialogue', '余砚', '他把答案留给后来的人，是因为任何一种都不干净。'],
    ['dialogue', '顾潮生', '他最后让我保证，等林澈有能力理解代价时，不准只告诉她最容易原谅他的版本。'],
    ['dialogue', '林澈', '那我就带着不能原谅的部分继续走。真相如果只能让人舒服，就和议会的档案没有区别。'],
    ['action', null, '蜡筒熔化前吐出主轴频率。林澈将它记在铜灯内壁，三人离开北塔赶往钟楼。'],
    ['narration', null, '身后的灯焰恢复成一股。她没有得到告别，只得到一个必须由活人完成的选择。'],
  ]),
  ...scene('council-seal', [
    ['narration', null, '林澈转动封缄钥匙，灯座吐出一卷用鲸蜡密封的议会命令。最上方不是事故报告，而是事故发生前两小时签署的删档授权。'],
    ['dialogue', '余砚', '他们在试验前就准备好删除失败记录。这不是灾后恐慌，是预谋好的免责程序。'],
    ['dialogue', '顾潮生', '我的签名在执行人一栏。我当时以为封缄能阻止谣言，没想到它会成为十年的常态。'],
    ['action', null, '封缄令附有钟机紧急接管条款：守灯人、校准师与巡潮官三方一致时，可以越过议会控制主轴。'],
    ['dialogue', '林澈', '所以他们把我们三个人分别困在灯塔、档案馆和巡潮队，就是为了让三方永远无法站在一起。'],
    ['dialogue', '余砚', '现在站在一起，还不算太晚。'],
    ['dialogue', '顾潮生', '我会签。签完之后，巡潮队不再替议会封锁证据，只负责疏散。'],
    ['narration', null, '三枚印记在鲸蜡上合拢，北塔主灯转向钟楼。全港都看见那束本不该出现的白光。'],
    ['narration', null, '他们没有听见林惟舟最后说过什么，却取得了让活人承担责任的权力。'],
  ]),
  ...scene('bell', [
    ['system', null, '第三幕：失声钟楼。距离黑潮抵达，十六分钟。'],
    ['narration', null, '铜钟悬在风暴眼里，主轴每转一圈，城中就有一排门牌失去文字。黄铜钥匙已经与齿轮咬合。'],
    ['action', null, '余砚接入校准带，顾潮生打开全港疏散频道，林澈站在只能转动一次的主钥匙前。'],
    ['dialogue', '余砚', '公开档位会一次性释放被压缩的记忆。钟能推开黑潮，但港民会同时想起事故、失踪者和议会十年的谎言。'],
    ['dialogue', '顾潮生', '限制档位最安全。先恢复潮汐，把所有原始记录锁进七日后自动开启的广播。代价是我们必须要求全港再信一次制度。'],
    ['dialogue', '林澈', '断钟档位呢？'],
    ['dialogue', '余砚', '钟机停止吞噬记忆，黑潮也不会被推开。我们只能点亮外海航道，让能走的船先走，再追查潮源。'],
    ['narration', null, '钟楼下方，潮灯集市的人举起写满姓名的灯罩；巡潮队拆除路障；档案馆把每一页原始记录接入广播。'],
    ['dialogue', '顾潮生', '我以前总把秩序当作没有人争论。现在我只知道，真正的秩序至少要允许人知道自己为何付出。'],
    ['dialogue', '余砚', '记录不会替我们选择。它只保证明天的人知道，我们今晚到底做过什么。'],
    ['dialogue', '林澈', '那就不再问哪条路最正确。问哪一种代价，我们愿意亲自承担，并且不再从档案里删掉。'],
    ['narration', null, '黑潮越过外堤。林澈握住主钥匙，全城的灯在同一秒抬高火焰。'],
  ]),
  ...scene('public-square', [
    ['narration', null, '主钥匙转向公开档位。铜钟第一次响起时，没有声音，只有无数被压缩的记忆穿过街道。'],
    ['narration', null, '第二次钟响，全港听见四十七名外堤船工的名字；第三次钟响，人群想起是谁签署了删档令。'],
    ['action', null, '市场爆发哭喊，议会大厅有人砸碎窗户。顾潮生命巡潮队放下武器，转而保护档案馆与疏散通道。'],
    ['dialogue', '顾潮生', '所有队员听令：不阻止质问，不销毁记录。保护任何愿意作证的人。'],
    ['dialogue', '余砚', '校准值还在上升。林澈，必须让钟声有一个活着的锚点，否则记忆会把每个人重新拖回事故当夜。'],
    ['dialogue', '林澈', '用现在。告诉他们海墙在哪里、孩子在哪里、出口在哪里。记住过去，但先把身边的人带到天亮。'],
    ['narration', null, '全港广播不再只念遇难名录，也开始播报疏散路线。记忆从伤口变成了彼此确认位置的坐标。'],
    ['action', null, '林澈敲响第四次钟。海面猛然升起，黑潮在防波堤前分裂成两道奔向空湾的水墙。'],
    ['narration', null, '黎明前最黑的一刻，雾港终于同时拥有真相和混乱。没有人再能假装二者可以被分开处理。'],
  ]),
  ...scene('sealed-engine', [
    ['narration', null, '主钥匙转入限制档位。余砚把校准带锁进主轴，封缄令自动复制到每一座公共潮灯。'],
    ['action', null, '钟机只抽取三人刚刚共同确认的一段记忆作为锚点：七日后的正午，全部原始记录必须自动广播。'],
    ['dialogue', '余砚', '如果任何一人试图撤销，潮灯会立刻公开副本。这次承诺不再只存在某个好人的良心里。'],
    ['dialogue', '顾潮生', '我会在天亮后拘捕签署旧命令的人，包括我自己。七日够港区撤离，也够议会准备谎言。'],
    ['dialogue', '林澈', '那我们就用七日准备证人。不是为了让真相更温和，是为了让它出现时不会只剩废墟可以倾听。'],
    ['narration', null, '钟声恢复，潮水沿石阶一级级回到港湾。人们只感到短暂眩晕，不知道自己刚刚差点失去哪段记忆。'],
    ['action', null, '顾潮生打开封锁线，余砚将档案转移到北塔，林澈把主钥匙折成三段，分别交给市场、档案馆和巡潮队保管。'],
    ['narration', null, '这不是一个干净的胜利。城市又被要求等待七日，但这一次，等待有期限、证据和无法单方面撕毁的见证。'],
    ['narration', null, '远处第一艘船重新浮起时，北塔旧铜灯照亮了墙上那句誓言：灯未熄，港未沉。'],
  ]),
  ...scene('outbound-dock', [
    ['narration', null, '主钥匙被林澈反向插入，钟机齿轮一节节停下。城中门牌不再褪色，外海黑潮却失去最后一道阻挡。'],
    ['dialogue', '顾潮生', '巡潮队可以在十二分钟内放出六成船只。剩下的人必须去北塔和高墙避险。'],
    ['dialogue', '余砚', '我把档案分成三份：一份随船，一份留在灯塔，一份用浮筒沉入安全水道。只要有一份留下，议会就不能重写今晚。'],
    ['action', null, '林澈将潮汐钟的黄铜主轴拆下，装进最前方领航艇。旧铜灯随之转向从未开放的外海航道。'],
    ['dialogue', '林澈', '钟机把黑潮当成必须被推开的敌人，却从没人去看黑潮从哪里来。我要带它的主轴回到源头。'],
    ['dialogue', '顾潮生', '你父亲当年也想出海。是我用封锁令留下了他。今晚我不会再替任何人决定该留在岸上。'],
    ['narration', null, '船队离港时没有潮水托举，只能靠绞盘和人力拖过淤泥。市场的人把写满姓名的灯罩挂上每一根桅杆。'],
    ['action', null, '黑潮抵达前，最后一艘载着孩子与伤员的驳船越过防波堤。北塔亮起，引导留守者登上高墙。'],
    ['narration', null, '雾港没有等到熟悉的潮声。取而代之的，是数百只船桨第一次按照人的呼喊，而不是钟机的命令，同时落入黑海。'],
  ]),
  ...scene('truth', [
    ['system', null, '结局：真相之钟。'],
    ['narration', null, '黑潮退去后的第三天，港议会大厅仍被抗议者包围。没有新的失踪者，却有无数旧伤第一次获得姓名。'],
    ['dialogue', '余砚', '档案馆今天收到了两千七百份口述记录。它们互相矛盾，但没有一份会再因为不够整齐而被删除。'],
    ['dialogue', '顾潮生', '巡潮队改名为港区救援队。我会接受审判，也会先把每一处旧封锁点画进公开地图。'],
    ['dialogue', '林澈', '父亲的名字可以写在纪念墙上，但旁边也要写明他参与过试验。我们纪念的不是无罪的人，是愿意停止错误的人。'],
    ['narration', null, '正午，潮汐钟再次响起。孩子们在钟声里学习四十七个陌生姓名，也学习为什么一座城市必须保留让自己难堪的记录。'],
    ['narration', null, '雾港从此仍会争吵，仍会犯错，却再也没有任何名字能够被安静地从潮位线上刮去。'],
  ]),
  ...scene('home', [
    ['system', null, '结局：守灯人的黎明。'],
    ['narration', null, '七日里，雾港恢复航运，也完成了有史以来第一次全港撤离演练。每座潮灯都保存着无法撤销的事故副本。'],
    ['dialogue', '余砚', '广播将在十分钟后启动。议会申请延期，被三千四百盏公共潮灯同时拒绝。'],
    ['dialogue', '顾潮生', '救援队已经就位。有人会愤怒，有人会否认，但这次我们不会用封锁替他们做决定。'],
    ['dialogue', '林澈', '守灯从来不是替城市遮住黑暗。是让每个人看见脚下还有路，也看见路旁曾经掉下去的人。'],
    ['narration', null, '正午钟响，完整记录按约公开。港口没有崩溃，反而在漫长沉默后响起一阵从市场传到外堤的掌声。'],
    ['narration', null, '北塔旧誓被改写成新的公共条款：灯未熄，港未沉；记录未失，名字仍在。'],
  ]),
  ...scene('sea', [
    ['system', null, '结局：向黑潮航行。'],
    ['narration', null, '黑潮越过空港时，北塔与高墙承受了第一轮冲击。城市受损，却没有人再因为一份被删除的命令留在错误地点。'],
    ['dialogue', '余砚', '我们离港四十海里，主轴仍在指向西北。黑潮不是风暴，它像某种覆盖整片海域的失控钟场。'],
    ['dialogue', '顾潮生', '雾港发来信号：所有避难点平安。议会想重新接管灯塔，被市场和救援队一起赶了出去。'],
    ['dialogue', '林澈', '那就让他们学会在没有潮汐钟替他们决定时刻的日子里生活。我们去找到源头，也找到不需要拿记忆交换安全的方法。'],
    ['narration', null, '船队在黑色海面上点亮写满姓名的潮灯。每一盏灯既是航标，也是拒绝被钟场抹去的个人证词。'],
    ['narration', null, '黎明从云层裂缝落下时，雾港第一次没有依靠钟声迎接潮汐。林澈则带着一座城市保留下来的记忆，驶向更大的世界。'],
  ]),
]

const setEffect = (path: string, value: string | boolean | number): string => JSON.stringify([{ op: 'set', path, value }])

export const MIST_HARBOR_ROADSHOW_CHOICES: MistHarborRoadshowChoice[] = [
  { sourceNodeKey: 'entry', choiceKey: 'entry.archive', text: '回应蓝灯暗号，先去旧档案馆', description: '从封存记录追查黑潮事故，取得机械与书面证据。', targetNodeKey: 'archive', effectsJson: setEffect('route.first', 'archive') },
  { sourceNodeKey: 'entry', choiceKey: 'entry.market', text: '进入潮灯集市，先保护正在失名的人', description: '从港民证言追查消失的十三分钟，取得公共见证。', targetNodeKey: 'market', effectsJson: setEffect('route.first', 'market') },
  { sourceNodeKey: 'archive', choiceKey: 'archive.vault', text: '沿水线进入地下库房', description: '冒险取回十年前的钟机校准带。', targetNodeKey: 'vault', effectsJson: setEffect('evidence.calibrationTape', true) },
  { sourceNodeKey: 'market', choiceKey: 'market.patrol', text: '留下港民证词，直面巡潮队封锁', description: '迫使顾潮生承认失名现象与旧案有关。', targetNodeKey: 'patrol', effectsJson: setEffect('evidence.publicWitness', true) },
  { sourceNodeKey: 'vault', choiceKey: 'vault.undercity', text: '带着校准带前往地下泵站', description: '在不可逆共振前进入城市的潮心。', targetNodeKey: 'undercity' },
  { sourceNodeKey: 'patrol', choiceKey: 'patrol.undercity', text: '沿巡潮牌暗线进入地下泵站', description: '接受顾潮生给出的四十分钟窗口。', targetNodeKey: 'undercity' },
  { sourceNodeKey: 'undercity', choiceKey: 'undercity.pump', text: '修复西侧泵轮，为全港争取安全窗口', description: '优先降低钟机重启风险，但暂时放弃寻找完整名录。', targetNodeKey: 'pump', effectsJson: setEffect('route.second', 'mechanism') },
  { sourceNodeKey: 'undercity', choiceKey: 'undercity.shrine', text: '进入沉没神龛，找回四十七个名字', description: '优先恢复遇难者证词，但放弃机械缓冲时间。', targetNodeKey: 'shrine', effectsJson: setEffect('route.second', 'memory') },
  { sourceNodeKey: 'pump', choiceKey: 'pump.north', text: '启动维修升降梯，赶往北塔', description: '带着可公开复制的安全操作顺序离开潮心。', targetNodeKey: 'north-tower' },
  { sourceNodeKey: 'shrine', choiceKey: 'shrine.north', text: '沿守灵人密道赶往北塔', description: '带着四十七名遇难者的姓名索引离开潮心。', targetNodeKey: 'north-tower' },
  { sourceNodeKey: 'north-tower', choiceKey: 'north.father', text: '先听父亲留下的最后记录', description: '取得钟机三种档位的操作方法，也承担父亲参与事故的真相。', targetNodeKey: 'father-log', effectsJson: setEffect('evidence.fatherLog', true) },
  { sourceNodeKey: 'north-tower', choiceKey: 'north.council', text: '先取出议会封缄令', description: '取得三方紧急接管权，也永远失去父亲最后的私人告别。', targetNodeKey: 'council-seal', effectsJson: setEffect('evidence.councilSeal', true) },
  { sourceNodeKey: 'father-log', choiceKey: 'father.bell', text: '带着不能原谅的真相前往钟楼', description: '不把林惟舟简化成英雄或罪人。', targetNodeKey: 'bell' },
  { sourceNodeKey: 'council-seal', choiceKey: 'council.bell', text: '以三方印记接管钟楼', description: '让活人共同承担今晚的决定。', targetNodeKey: 'bell' },
  { sourceNodeKey: 'bell', choiceKey: 'bell.truth', text: '公开全部记录，让全港在钟声中恢复记忆', description: '立即推开黑潮并公开真相，代价是全城同时承受记忆与政治震荡。', targetNodeKey: 'public-square', effectsJson: setEffect('ending', 'truth') },
  { sourceNodeKey: 'bell', choiceKey: 'bell.home', text: '限制共振，签下不可撤销的七日公开期限', description: '先恢复潮汐和疏散能力，用制度化期限保证真相不会再次被封存。', targetNodeKey: 'sealed-engine', effectsJson: setEffect('ending', 'home') },
  { sourceNodeKey: 'bell', choiceKey: 'bell.sea', text: '彻底断钟，点亮航道驶向黑潮源头', description: '停止用记忆换取安全，承担撤离与追查未知潮源的风险。', targetNodeKey: 'outbound-dock', effectsJson: setEffect('ending', 'sea') },
  { sourceNodeKey: 'public-square', choiceKey: 'public.truth', text: '敲响第四次钟，带所有人走到天亮', description: '让恢复的记忆成为疏散和互助的坐标。', targetNodeKey: 'truth' },
  { sourceNodeKey: 'sealed-engine', choiceKey: 'sealed.home', text: '折断主钥匙，把守港权交给三方共同保管', description: '完成七日之约，让承诺不再依赖单个守秘者。', targetNodeKey: 'home' },
  { sourceNodeKey: 'outbound-dock', choiceKey: 'dock.sea', text: '带领最后一艘船越过防波堤', description: '保留雾港记忆副本，向异常潮汐的源头启航。', targetNodeKey: 'sea' },
]
