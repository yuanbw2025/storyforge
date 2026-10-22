# 本机中文语音与开发评测

固定台词的离线 CPU 评测，入口登记为 `ttrpg.local-voice.eval`。当前支持中文精简内核的验证；正式团局配音沿施工方案 §35.103 独立接入原叙述、候选试听、确认与异步生命周期。

多声线准入见方案 §35.155：`timbre-evaluate.mjs --check-only` 只核对有限入口。真实执行另需指定已核对的 `--melo-runtime-dir`、`--timbre-runtime-dir` 和原固定 `--source-wav`，使用 `timbre-eval-profile.json` 固定的公开 WAV SHA 与十个官方合成预置向量，不接收原文或参考人声。它共用已有 Python 依赖，原 OpenVoice 代码/权重按 revision/hash 核对，MIT 声明保留在 `OpenVoice-LICENSE`。本工具不安装依赖、联网推理、自动重试、写项目或采纳；多声线尚须真实中文听感与正式产品合同接入，不是播放器的已上线声线列表。

## 安装与执行

环境为 macOS Apple Silicon、Python 3.12、Node.js。依赖和模型只在指定本机目录保存一份，不提交仓库或打进交接包。

```sh
python3.12 scripts/ttrpg-local-tts/prepare.py --runtime-dir "$HOME/.local/share/storyforge-ttrpg-tts/melo-zh-eval-v1"
node scripts/ttrpg-local-tts/evaluate.mjs --check-only --case narration-zh
node scripts/ttrpg-local-tts/evaluate.mjs --runtime-dir "$HOME/.local/share/storyforge-ttrpg-tts/melo-zh-eval-v1" --case narration-zh
```

`prepare.py` 安装固定平台的哈希依赖，下载固定版本的 MIT 内核与模型文件，不调用模型。它保留原 MIT 许可和源码；依赖中的原许可由各安装包保留。安装前预留 4 GiB 预算，并要求安装后至少剩余 8 GiB；两组模型文件合计约 883 MB，Python 运行库另计。模型与源码须通过固定 SHA-256 或 Git blob 核验。中断的权重保留为 `.part`，再次明确运行安装命令时可续传，完整核验后才转为正式文件。

模型传输固定 HTTP/1.1，保留证书校验与 600 秒单次下载时限。每次传输记录断点/字节进度、退出码及本地 stderr（最多 64 KiB）；诊断可能带本机代理信息，仅本机保留。已完整校验的文件和准确安装包直接复用。认证、坏哈希或未知错误须核查，不把安装重试与语音推理重试混用。

`--check-only` 仅验证固定台词和合同，无需模型。实际执行须等待固定运行库安装完成，使用 CPU 两线程、最长 60 秒音频和单次 120 秒执行期限；推理禁止网络，只读已核验本地权重。没有付费 API、自动降级或隐藏重发。

固定输入合同 v2 保留原四个用例的原文及预期，新增阿拉伯数字和分段：可选 case 为 `narration-zh`、`numbers-zh`、`long-zh`、`mixed-script-rejection`、`numbers-arabic`、`paragraphs-zh`。每个音频用例同时冻结精确的归一文本，子进程在加载模型权重前核对，主进程收到结果后再核对；删词、错读数字的文本转换或不同标点不能蒙混通过。原始文本和换段始终保留，换段的实际朗读归一沿已固定的上游规则转为句点。本阶段混合英文明确拒绝，不静默删词。任意台词、提示词、作者项目路径、重复或未知参数均不接受。

## 输出与恢复

每次执行在本机目录的 `evaluations/run-*` 留独立 `attempt.json`、原进程输出和 `result.json`；成功生成保留实际 PCM WAV、文件 SHA-256、原台词与归一文本、时长、增益、真实 PCM RMS、耗时及峰值内存。引擎生成与主进程复核分别完成；坏原文、错误版本、静音、损坏 WAV、削波或伪造验收标记均不能成为通过结果。

超时、取消、进程失败或未知结果保留原目录，不自动重试。已有运行锁时先核对原 PID/回执，避免另开任务；不直接删除仍在运行或结果未知的锁。评测文件不进入作者数据库、不自动播放或采用。实际音质和独立真人试听仍需另行验收；工程通过不能代替听感。

2026-10-17 已在本机 macOS ARM64/CPU 两线程实际完成三段中文评测：旁白 4.261 秒音频 / 39.55 秒首次冷启动，中文数字 5.050 / 7.79 秒，长段落 13.560 / 9.43 秒；长段落峰值 RSS 约 3.42 GB。三段都通过原结果/PCM 核验，混合英文反例在模型加载前明确拒绝。它们是固定输入的运行证据，听感仍未验收，不能用这些时长推算所有设备或任意文本。

同日合同 v2 的六个用例全部实际执行：五段音频通过原文、精确归一文本和 PCM 复核，混合英文保持零模型调用拒绝；阿拉伯数字 5.050 秒音频 / 5.77 秒执行、分段 4.435 / 5.76 秒，长段落 13.560 / 8.38 秒。复用原独立运行库及准确权重，没有再安装或复制模型。原合同 v1 的音频与前两次分段预期失败分别保留，失败不回填为通过；任意日期/单位、完整中英、团局正式异步候选与听感仍须独立验证。

## 原文朗读预检（产品接入准备）

`reading-preview.mjs` 是独立的有界 CPU 文字预览；它复用同一份已核验安装，不进入 `evaluate.mjs` 的固定台词模型入口，也不改变其 `productInvocationAllowed:false`。显式传入 `--runtime-dir`，标准输入只接收 `storyforge.ttrpg-local-tts-reading-input` V1 的 `text` 与 `overrides`。这不是正式合成命令，不产生音频、Run、请求预留、媒资或播放权限。

`reading-profile.json` 固定原安装 hash、上游中文前端 hash 和 cn2an 版本。子进程只执行该准确源码内的四个归一定义，禁止网络并核对未导入 torch、transformers 或 melo；不初始化 tokenizer 或模型。原文最多 2000 个 UTF-16 单元，展开读法独立限制 4000；最多 64 处明确读法、10 秒预检和 64 KiB 输入/输出。输入、归一原文、完整源码/版本和权限标记均由主进程复核；超时/取消只停止这次文字检查，不重试。

原文和换段保持完整。编号/前导零、符号数、日期/时间、骰式、英文或生僻字等不被静默删改；未解决时 `needs-reading-choice` 且归一读法为空。人可按**原片段的 UTF-16 位置**明确指定读法，如 `001 → 零零一`、`2d6+3 → 两枚六面骰，加三` 或姓名读音；范围有序不重叠，不能拆开字符或删除为空，原文字与选择同时保留。问题位置则明确参照展开后的 `readingText`；最多展示前 64 条并保留实际 `issueCount`，没有问题才返回完整准确归一文本。

前端的 `ready-for-reading-review` 仍只表示可以核对读法。调用方须从本人真实叙述审阅取得原片段；序列化 JSON 自身不证明模型结果、身份或来源。产品审阅服务重新核验来源、受众及授权，读法仍无生成/采用权限。后续正式语音请求须冻结原文、选择、profile 与预览 hash，由实际 worker 再次复算；未完成这些条件的旧配音意图不能直接执行。本机桥接、生成确认和正式语音 worker 仍须按原方案接通。

## 产品执行合同与当前边界

`product-profile.json` 是独立的中文 CPU 产品执行描述；它只引用同一份已核验资产，不复制或安装运行库，不改变评测 profile 的 `productInvocationAllowed:false` 或读法 profile 的零模型权限。上限为原文 2000 / 展开读法 4000 个 UTF-16 单元、每段 200、最多 64 段、最多各 64 次语音推理/文本编码、900 秒 PCM、原有 100 MiB 文件上限及 30 分钟整次期限。它们是执行保护上限，尚不是完整长文本、时延或音质的验收结果。产品 worker 必须复算已确认读法，禁网络、自动重试和自动采用。

产品内部 `prepareTtrpgOpenLocalVoiceExecutionV1` 仅沿原完成意图创建唯一子 Run，冻结准确原文 Context Manifest、明确读法、完整产品描述和 hash；未确认/不支持的旧读法、导入和祖先意图不能执行。准备不发送模型，原请求预算不重复预留。`dispatchTtrpgOpenLocalVoiceForKernelV1` 是桥接用的一次派发边界：显式动作、准确版本、冻结正式音频入口和真实身份校验后先持久记账，原始返回先保存；丢失返回或重复继续只能核查原 job，不能推断未发送再发。原始返回仍待协议与真实音频校验，不是已通过的候选。

产品 V2 新增 `product-worker.py` 与 `product-jobs.mjs` / `product-bridge.mjs`，原 V1 描述保留为 `product-profile-v1.json`。九项实际实现源码按 SHA-256 冻结；改动相关实现后须明确运行 `node scripts/ttrpg-local-tts/pin-product-profile.mjs`，并用同一命令的 `--check` 核对。旧输入保留原版本，可以查询和请求停止，不取得当前启动权限。

操作者明确设置 `STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR` 为已有运行库目录后，Vite 开发/预览服务与桌面/便携版的本地服务才启用 loopback 同源接口；静态托管没有这个进程。创建、查询和刷新不启动模型，实际启动只能由原已确认意图的内部 `generateTtrpgOpenLocalVoiceV1` 动作经正式 Run 派发。服务保留原输入、永久启动 claim、租约、逐段调用记录、进程输出、部分音频和终态，不自动重试；安装/评测/产品共用单一物理槽位，至少保留 5 GiB 磁盘余量，不复制模型。

worker 在加载模型前复算原确认读法，完整分段且每段最多 60 秒；两线程 CPU、禁网络和嵌套进程，所有实际模型调用和样本时序留证。原文/展开文字、64 段/各 64 次调用、900 秒、100 MiB 和 30 分钟上限保持；64 KiB 进程诊断输出超限即停止并保留前缀。客户端每两秒复查原来源/本人授权，再续约十秒租约；Node 与 worker 以单调时间约束，断连或重启不续命，时钟回拨和迟到续约不复活过期任务。停止请求不等于进程确实终止，完整迟到结果仍保留。状态传输限制 64 KiB /15 秒，原始返回另受 Base64 预算和 120 秒读取期限约束。

原始结果复核真实 PCM、文件 hash、完整归一文字/段落样本覆盖及模型次数。段落样本边界不能冒充逐字对齐；原始返回不是 CreativeArtifact 候选、试听通过或采用证据。当前真实产品 worker 验收尚待执行，paused/unknown 证据恢复、桌面 UI、候选试听、独立 E16 采用与发行安装继续施工。显式隔离验收用例为 `tests/e2e/ttrpg-open-real-local-voice.spec.ts`，还须同时设置 `VITE_ENABLE_TTRPG_OPEN_PREVIEW=1`、`STORYFORGE_TTRPG_REAL_VOICE_ACCEPTANCE=1` 和上述运行库变量；默认 E2E 移除运行库变量且不会加载模型。旧固定评测和 CPU 预检保留各自权限，不能把合成 PCM 或注入进程当作真实语音或真人听感。

## 原任务的服务端控制与恢复

停止先保存准确 jobKey/input hash 的屏障，即使创建尚未到达也保留；缺失任务只报告 `stop-requested-without-job`，不声称实际停止。后到创建和 spawn 前竞争均检查原屏障，跨控制器续约不能绕过停止；只有实际子进程关闭或本控制器确定未发起 spawn 时才确认相应停止，完整迟到输出保留。

`POST /jobs/:jobKey/recover-raw` 要求明确 `recover-original-complete-raw-without-resending` 和原 input hash。它不创建或启动任务；已知成功关闭沿原输出读取，未知完整输出须核实原控制器/worker 启动身份已结束、无实际 worker，并验证全部文件。恢复类别 `verified-result-worker-absent` 没有伪造退出码。普通 GET 不恢复，缺失证明、活跃/不明进程、损坏文件及已知失败均保留原状。V2 原描述独立归档，读取同一物理合同的旧结果保留原实现 hash，不给旧输入执行权。原始 UTF-8/BOM 与 stdout/stderr 合计 64 KiB 前缀保持明确边界。

这些是服务端原始证据接口；本人正式 Run 查询/停止与检查点恢复、严格候选、试听和 E16 尚须继续接入，不能把本机文件或协议测试当作正式采用或独立听感验收。

## 来源与许可

- MeloTTS：固定官方代码 `209145371cff8fc3bd60d7be902ea69cbdb7965a`，MIT。只取神经网络内核和中文前端，保留原源码、许可、导数哈希和补丁说明。
- 官方中文权重：`myshell-ai/MeloTTS-Chinese@af5d207a364ea4208c6f589c89f57f88414bdd16`，官方模型卡标注 MIT。
- 文本编码模型：`google-bert/bert-base-multilingual-uncased@7cbf9a625e29989f6b9c6c2fa68234c304f7e38f`，独立 Apache-2.0。
- `runtime-profile.json` 固定 41 个 Python 包及其发布许可元数据/文件哈希；包含 Apache、BSD、MIT 等依赖，tqdm 保留 MPL-2.0/MIT 原许可。整个依赖链不能被称为均为 MIT。

完整上游多语言安装列表未准入：本工具不引入日文/其他语言前端、`pykakasi`、`Unidecode`、`num2words`、`g2p_en`、Web UI、训练或音频编解码栈。MeloTTS 的中文入口明确裁剪未使用的分派；CPU 特征读取与超长输出拒绝由评测引擎负责。不会通过 `weights_only=False`、远程自定义模型代码或下载回退绕过固定权重校验。

## 原生中文多说话人固定试音

用户否决 OpenVoice A/B 的区分度与听感后，新增 `native-voice-evaluate.mjs`，仅登记为 `ttrpg.local-voice.native-fixture-eval` 的离线有限入口。它复用原公开中文长段落，固定 Kokoro v1.1-zh 的 `zm_010 / zf_001 / zm_011 / zf_017` 四个官方说话人；不接受任意台词、项目、参考人声或自定义声线，不授予产品执行、采用或自动播放权限。正式配音、原请求、原音轨和世界数据保持原 owner。

`native-voice-eval-profile.json` 冻结代码、权重、声线、最小依赖和原/导数哈希。Kokoro `dfb907a0`、Misaki `fba12365` 为 Apache-2.0，保留其原代码及 StyleTTS2 MIT 来源声明；权重 `hexgrad/Kokoro-82M-v1.1-zh@01e7505b` 模型卡为 Apache-2.0。全部必要模型文件共 329,353,685 字节。现有 Python/Torch 不重装；仅在候选私有目录加载已核对的 loguru / addict MIT wheel 文件，不写共享环境。原语言 pipeline、英文依赖及来源混合的 `pypinyin_dict.large_pinyin` 不加载；后者的底层来源不能由包上的 MIT 标签一概覆盖。此固定台词前端不表示任意中文、多音字或数字已验收。

本机准备资产后运行：

```bash
node scripts/ttrpg-local-tts/native-voice-evaluate.mjs --check-only
node scripts/ttrpg-local-tts/native-voice-evaluate.mjs --melo-runtime-dir /absolute/existing-melo-runtime --native-runtime-dir /absolute/prepared-native-assets
```

两份运行库共用原 `.eval.lock` 物理槽位；保留已有/未知任务，失败只释放本次准确 claim。四次推理、CPU 两线程、整次 240 秒及每段 60 秒上限，加载和推理均禁网络/子进程，逐次调用留证，不截断文本或丢弃未知音素。最新上游为 ONNX 导出新增的 affine InstanceNorm 与此权重不符，评测导数明确还原为非 affine 的 eager 结构，完整严格加载所有权重；没有使用 `strict=False` 或放开 pickle。下载超时和首轮零推理加载失败均保留，核明原因后才显式开始新评测，不隐藏重试。

2026-10-19 原生四声线实际生成通过：24 kHz/单声道 PCM，语速统一 0.9，分别为 18.600、18.425、18.200、19.700 秒；整次 24.13 秒，峰值 RSS 约 3.87 GB。原文/音素覆盖、真实 PCM/哈希和调用证据核对通过，未冒充逐字对齐或语义听感证明。新候选已交付试听，独立听感待用户反馈；尚未替代正式 Melo 产品 profile，开局声线选择和真实旁白生成的一致接入继续施工。


## Qwen 原生预置固定试音

同一有限入口增加闭合 `--engine kokoro|qwen`；默认仍为原 Kokoro 四说话人及原 profile/worker。Qwen 只接受固定公开中文段落与 `uncle_fu / serena` 两个原生预置，不接受任意模型路径、台词、指令、参考人声或新声线。`--check-only --engine qwen` 只检查静态描述，不读取运行库或模型；显式执行继续使用原共享物理槽位和本次私有候选槽位。正式产品 profile、旧请求及游戏媒资不因这个选项改变。

准确代码为 MLX Audio `1865f49cc9a40de9b5e4fcf55952b9812d751f1d`，仓库内保留原 `MLX-Audio-LICENSE`，适用于评测导数与 profile 中的补丁片段。私有 MLX/MLX Metal 0.32.4 wheel 覆盖层不安装进现有 Python/Torch。保留 MLX Audio、Apple vendored lm、Kyutai Mimi Python 的 MIT 原始声明，以及 bundled metal_cpp 与 Qwen Apache-2.0；不能将整个链条称为纯 MIT。社区转换权重 `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit@049ef77fe8816b536193c0c25f9a214d17921282` 模型卡 Apache-2.0，来源声称使用 MLX Audio 0.3.0 转换官方 Qwen；未提供原始权重 commit attestation，因此不把发布方来源说明扩张为独立授权保证。完整必要文件 1,973,575,388 字节，所有文件均按 Git blob/LFS SHA-256 固定。

原上游 initializer 会导入多种无关 codec，候选导数只保留准确 Qwen/Mimi 闭包。worker 不调用上游吞掉 tokenizer/codec 加载失败的 post-load hook；按准确索引与量化描述显式、严格加载主模型，单独取固定权重中的 decoder 并严格加载全部 decoder 参数，不实例化克隆参考 encoder。文本 tokenizer 只读本地准确文件、禁止远程自定义代码，原公开台词须 encode/decode 往返一致。现有 Transformers 5.20.1 会在 tokenizer 导入时加载已有 Torch 模块，记录此事实；不加载 Torch 神经网络权重，也不覆盖为官方另一路径要求的 4.57.3。

每次最多两个完整语音生成、每个最多 512 个 codec token，必须实际观察 EOS；耗尽 token 上限不能把截断语音当成功。Metal 分配目标 6 GiB、逐阶段实际峰值准入阈值 6 GiB（不是操作系统硬上限）、整次 300 秒、每段最多 60 秒，禁网络、嵌套进程、自动重试、播放与采用。语音按原生速度生成，Qwen 0.6B 不支持 instruct；个人试听语速继续是独立播放器偏好，不通过后期升降调给同一人声改名。设备、最小导入与固定中文真实生成已执行；听感和正式接入仍需独立证据。

```bash
node scripts/ttrpg-local-tts/native-voice-evaluate.mjs --engine qwen --check-only
node scripts/ttrpg-local-tts/native-voice-evaluate.mjs --engine qwen --melo-runtime-dir /absolute/existing-melo-runtime --native-runtime-dir /absolute/prepared-qwen-assets
```


首轮 V1 实际生成了两段音频，但复核实际 Metal 峰值为 7,296,809,999 字节，超过预设 6 GiB；MLX 官方 `set_memory_limit` 仅是分配指导，不能冒充硬上限。原进程通过状态、音频、源码和哈希均保留，资源准入另记失败。`qwen-native-eval-profile-v1.json` 保留该历史合同；当前 V2 保留同一 6 GiB 阈值，将原解码分块从 300 降至 100 codec token、保持原 25-token 左上下文，并逐块立即求值释放中间计算图。主模型/codec 加载、逐步生成、每个解码块和最终结果均检查真实累计峰值，主进程还独立拒绝缺失或超限的资源回执；没有重置峰值来掩盖此前占用，也不承诺系统在单次原生分配期间不会瞬时超出。

V2 的显式新固定评测实际完成两次生成、575 次资源观测；Uncle_Fu 318 个 codec token / 25.360 秒，Serena 239 / 19.040 秒，均真实观察 EOS。整次 28.02 秒、进程峰值 RSS 约 2.93 GB、Metal 累计峰值 5,631,002,983 字节，通过原 6 GiB 准入阈值；WAV/样本/源码/权重核验通过。分块解码不删除原文、样本或时间，不宣称与历史 300-token 解码音频逐字节相同。独立浏览器已核对新 WAV 解码/播放、默认 0.9 倍保持音高、切换暂停及零外部请求；用户听感仍待反馈，正式配音 profile 与开局所选声线的一致接入继续施工。


后续 V3 还修正 MLX 移植 decoder 将合法零号音频码当作填充的问题：官方 Qwen 使用 `-1` 表示 padding，原移植的 `>0` 条件会使这两段各少 1920 个样本（80ms）。V2 原文件保留，只能证明当时 PCM 自身格式/资源检查通过，完整 codec 时序准入另撤销。当前按官方 `>-1` 语义计算，先把 mask 通道转 signed int32，兼容生成端 uint32 零号码，原 dtype 溢出失败与一条已请求调用的回执保留；明确修正后才新评测，不自动重试原任务。

V3 worker 和主进程双重核对固定单条、无 padding 的实际 `codecTokens × 1920` 完整样本数与 EOS。实际新试音保留 318/239 个 codec token，完整 PCM 为 610560/458880 样本，即 25.440/19.120 秒；两次生成、575 次资源观测，实际 Metal 峰值仍为 5,631,002,983 字节，整次 40.08 秒。原文 tokenizer 往返、音频帧完整与实际听感是不同证据；这些计时核验不冒充 ASR、逐字对齐或真人音质验收。没有再次下载模型或改共享环境，历史源码、失败和所有 WAV 保留。

用户随后明确选择 Qwen 组为主要接入方向（Uncle_Fu / Serena）；此组别反馈不等于正式音轨采用、使用权或完整产品验收。开局声线选择与受治理正式生成继续接通，旧音轨和旧请求不自动改声线。


## 当前产品接入：Qwen 两个原生说话人

方案 §35.164 已把所选声线接回原 `ttrpg.open.local-voice` durable 链。它与上面的固定台词评测是不同权限，不能用 native-fixture CLI 合成作者内容。新 Qwen product profile V3 / raw result V2 / 24k timeline V2 与原 Melo profile V1/V2 / raw result V1 / 44.1k timeline V1 分开，旧请求与音轨不自动升级。默认 API 无声线参数仍沿旧 Melo；正常界面在明确新生成时捕获浏览器选择，可明确改选基础中文旁白。

运营者先按固定资产描述准备并核对原单份缓存，再执行仅资产准入（无模型调用），保留旧评测 owner。示例中的路径是运营者本机路径，不能由浏览器请求指定：

```bash
/absolute/existing-melo-runtime/venv/bin/python3 -I scripts/ttrpg-local-tts/qwen-product.py --admit-assets /absolute/prepared-qwen-assets --shared-runtime /absolute/existing-melo-runtime
```

同一 loopback 服务同时配置 `STORYFORGE_TTRPG_LOCAL_TTS_RUNTIME_DIR` 和 `STORYFORGE_TTRPG_QWEN_TTS_RUNTIME_DIR`。未配置/未准入 Qwen 时拒绝它的 profile，不悄悄改成其他声线，也不预留正常界面的新配音意图。普通冻结 E2E 移除两个环境变量；真实模型用例另需 `STORYFORGE_TTRPG_REAL_VOICE_ACCEPTANCE=1`，Qwen 还需 `STORYFORGE_TTRPG_REAL_QWEN_ACCEPTANCE=1`，只在独立数据中显式执行。

worker 保留原确认读法复算、授权租约、取消/未知结果、一次永久启动与音频预算。Qwen 每段 100 UTF-16 单位/少于 512 codec token、真实 EOS、原生 24k PCM；零码合法，实际帧数乘 1920 必须等于真实样本数。最多 64 次完整语音调用，没有独立文本编码模型调用；逐步观测实际 Metal 累计峰值，不扩大原 6 GiB 准入、不重置峰值。数学库请求两线程不等于 OS 进程硬线程限额。仅释放真实终态且归自己的 shared/native 两个 claim，安装/他人/未知锁保留。

首轮正常主持 UI 真实生成双声线均返回可试听候选并手动播放，原 raw/WAV/调用/资源/终态保留；源码冻结期间两个用例均通过且零重试。团局机械状态与媒资数量未改变，质量确认/使用权/E16 没有自动执行。Qwen 当前 MLX 路径仅在本机 Mac 验证；其他平台发行安装、独立真人与完整产品 CI/作者长局继续分开验收，不能把 Apache-2.0 模型卡与用户声线偏好当作无争议或自动采用证明。
