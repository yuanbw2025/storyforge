# 本机纯器乐与原音效适配器

本目录提供固定来源安装器、离线单片段评测CLI，以及有界本机音乐/原音效服务。私有声音任务已经接回现有AVG需求、durable Harness、原始响应与作品Blob；公开制作入口仍关闭，作者审听、选用及演出配置继续施工。安装、单个原音频producer或技术解码不代表声音工作台和商业效果验收完成。

候选为官方[ACE-Step 1.5代码](https://github.com/ace-step/ACE-Step-1.5)和[原发布者模型包](https://huggingface.co/ACE-Step/Ace-Step1.5)，准确revision、17个文件及hash保存在`model-source.json`；所选字节共6336686268。只安装turbo DiT、官方VAE及文本编码器，暂不安装额外LM，也不选择社区微调、艺术家/翻唱或参考音频路径。首轮为短片段纯器乐校准，音乐/环境/SFX的适用范围与效果仍须各自验证。

组件分开登记：代码/DiT/官方VAE由发布者标注MIT；[VAE独立模型卡](https://huggingface.co/ACE-Step/ace-step-v1.5-1d-vae-stable-audio-format)单独标明MIT，[固定代码的VAE文档](https://github.com/ace-step/ACE-Step-1.5/blob/ca1e85fe9430179831e6bc6be790c332190a3866/docs/en/ALT_VAE.md)区分官方包与可选社区替换。[Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)另按Apache-2.0记录。当前准确运行时代码/依赖已逐项留源文件和许可证清单，升级或分发仍须重新核对；发布者的训练数据说明不等于独立审计或输出原创性验收。

只把公开固定文件写入明确的实验模型目录，无凭据、推理或自动下载回退：

```sh
python3 scripts/avg-local-music/download_model.py /absolute/evaluation/model-directory
```

如明确选择`--weight-host modelscope`，仅SHA-256文件使用该公开镜像，其余文件仍来自原始完整revision；镜像始终不能改变冻结来源和内容hash。坏字节、余额/权限错误或连接失败不会隐藏重试。安装器至少预留8 GiB；不删除已有模型、作品媒资、失败回执或备份。

## 离线单片段评测（实验）

当前目标环境为macOS arm64/Python3.12，固定二进制包及hash见`requirements-macos-arm64.lock`。在独立虚拟环境中安装，保留原Qwen配音环境：

```sh
python -m pip install --require-hashes --no-deps --only-binary=:all: -r scripts/avg-local-music/requirements-macos-arm64.lock
```

实际运行代码必须来自`ca1e85fe9430179831e6bc6be790c332190a3866`准确Git checkout；`runtime_guard.py`逐项核对代码与模型原字节，拒绝改写、错revision、未登记导入包/缓存字节码及坏seal。专用子进程在导入运行时前禁用Python网络连接/解析，另配离线加载标记；这不是通用操作系统沙箱。`offline_handler.py`直接加载该代码中的固定类和本地权重，不调用上游自动下载/源码同步，也不改写模型包内原Python。LM、参考音频、翻唱、LoRA和训练均不进入该评测配置；本轮仅开放已实际校准的CPU配置，拒绝其它设备，不自动切换。

部分依赖包含MPL/LGPL条款，soundfile二进制也含libsndfile；完整环境按实际安装文件单独留许可证/通知清单，不能宣称整套MIT。当前运行时独立于StoryForge客户端分发。混合小波分发包的来源限制与普通DWT许可分开，当前不用该包，使用`haar_correction.py`自研普通Haar运算；以MIT/BSD的PyWavelets作独立数值参考，校验重建、能量、奇数补零及校正结果。校正后端和准确适配代码hash写入评测回执。

请求JSON只允许`caption/durationSeconds/seed/bpm/keyscale`，纯器乐10～30秒、固定8步、每次评测一个片段；`keyscale`如`A Minor`。输出必须是全新的仓库外目录，保留原float32、48kHz双声道PCM16 WAV、参数/来源/实际执行次数、运行日志及失败。float32是公开API按回执所列归一化/淡入淡出参数返回的准确张量，不是VAE原latent；本地只作声明的PCM16量化。30～900秒超时只终止本次子进程；无终态或遗失/非法回执亦保留结果未知状态，不重新生成。运行中调用次数为未知，终态才报告实际计数，不能用旧初始化的0次代替。父进程重验原请求、单次调用、代码/模型版本、实际WAV和float32原件hash及WAV格式/时长，运行中适配源码变化则拒绝成功。输出的听感、权利和作者采用始终待审。

```sh
python scripts/avg-local-music/calibrate.py --source /absolute/pinned-code-checkout --model /absolute/evaluation/model-directory --request /absolute/original-request.json --output /absolute/new-evaluation-directory --device cpu --timeout-seconds 900
python -m unittest discover -s scripts/avg-local-music -p 'test_*.py' -v
```

此CLI属于外部供应商评测工具，不读写产品数据库或生成可直接采用的工件；正式接线仍须由既有登记Skill/Run Contract/Harness冻结需求、保留原响应并经作者审听/采用。首轮2B校准不替代高质量XL与实际连续场景对照，也不把信号指标或受控测试音频当作真实听感通过。

2026-10-19首轮实际结果：固定模型17文件完整hash/无网络复验通过；1次CPU推理19.268秒，生成12秒、48kHz双声道PCM16 WAV，2304044字节，SHA-256 `52a99d4fae81cc89f582132ca0ed68e89d2a840d2d12bb0cfae6fea05ee5c6a1`。8步Haar均实际执行，原float32与WAV量化逐样本相等。公开API使用-1dB峰值归一化，无淡入/淡出；不据此声明可无缝循环。原音频、执行源码准确字节、参数/失败/许可证均保留在本机评测证据中；供应商费0，不含硬件/用电/人工。听感、纯器乐实际观察、场景连续效果和作者采用仍待验；本结果不能记作正式工作台或商业质量验收。

## 本机生产协议（公开工作台闭环待验）

使用上述准确运行时与已安装原件，显式选择仓库外的专用服务记录目录；重启复用原目录，不能换空目录重置原请求。服务不下载权重或音效、不读写Work，也不拥有作者采用权：

```sh
python scripts/avg-local-music/server.py --model /absolute/model-directory --source /absolute/pinned-code-checkout --data /absolute/new-provider-journal --library /absolute/original-kenney-archives --port 5298 --origin http://127.0.0.1:5196
```

只监听`127.0.0.1`，核对准确Host/Origin；当前客户端只使用`http://127.0.0.1:5298/v1`。`GET /v1/capabilities`返回模型/代码/配方/桥接源码hash和期限声明，不宣称已经加载或通过审听。每次生成前重新核对该身份与Brief冻结绑定，所有请求无凭据、无重定向和自动重试。

新生成必须使用能力/结果协议V2，额外冻结持久`journalId`。空目录获得不同身份，原绑定在POST前拒绝；有记录却缺失身份的目录只读，不重建身份后继续生成。V1原始结果保持V1并可只读复验，不被重标为V2。正式子Run在发送前保存`source-snapshot@2`及实际能力/记录库身份；即使随后断线，也保留本次准确调用对象和请求。旧输入快照@1继续按原字段核验。

`POST /v1/audio/music`只接收准确五字段请求和`x-storyforge-idempotency-key`；先把唯一请求/hash写入私有记录，再启动独立有期限进程。原ID无论成功、失败、重启或断线都不会再次派发，重复POST返回409；相同参数的原请求仍未知时，换新ID也不能重发。`GET /v1/jobs/<id>`及其`/audio`只读取原状态/已验证原件；缺失或无法证明的结果保留unknown，不以初始化0次或旧成功代替。每批最多256个记录、预留8 GiB空间；不自动删除历史记录来重置请求身份。

监督进程与推理子进程共享继承的OS文件锁，监督/HTTP服务退出不释放仍在运行的推理容量。子进程另受内核30～900秒期限约束；完成后重新核对请求、桥接源码、模型/代码、一次实际调用、原float32与WAV及逐样本量化。当前纯器乐配方仍是固定V1，不通过改名升级原评测或替换模型。产品网络等待留出解码/记录余量；断线不重发，原结果可另行只读核验。

`library-source.json`固定原发布者的[Interface Sounds](https://kenney.nl/assets/interface-sounds)和[RPG Audio](https://kenney.nl/assets/rpg-audio)两个CC0包、原ZIP/许可/151个可选成员hash，排除RPG演示混音。`--library`目录应包含准确`interface.zip`与`rpg.zip`；服务不自行下载。`GET /v1/library/catalogue`只给出元数据，`GET /v1/library/audio/<archiveHash>/<memberHash>`须重新核对原ZIP、包内许可及成员字节，保留原OGG、零推理/零供应商费，不静默转码或扩展到其他来源。

产品私有producer仅在本次真实开始/作者方案/编译/Harness claim闭合后调用服务，先持久化原响应，再由现有浏览器解码器/分析器检查准确字节，写入既有作品Blob。接收边界复验原输入/响应的准确顺序、信号测量和物理Blob；原库许可和生成模型权利分别保留。听感、权利确认、作者选择和Stage采用仍是独立后续门。

2026-10-19隔离正式任务实测另有一次真实CPU推理20.589秒，产出12秒、48kHz双声道PCM16、2304044字节，SHA-256 `6d65b5e658730011aa69ee74546f95d5a91339a684751b8b2fc710135e5eaf91`；原CC0点击声4876字节。实际HTTP、作品Blob和完整备份字节一致，真实Chromium对两者分别解码/测量并在接收时复验，原模型float/WAV与单次调用记录保留。文案策划是原创工程夹具，仅在隔离数据中打开未完成feature fence，没有伪造开始/作者/producer回执；本次不签听感、选用、联合播放或商业质量。完整CI、原生兼容与后继闭环按工作包§10.6逐项记录。

补齐V2记录库身份后，仅另做一次明确seed=104的有限验证：CPU21.310秒，仍为12秒双声道，原WAV SHA-256 `d730cec40147c3e0d54ac1bc33c454bfa64c65a03b3ea9c5670fb5b025f356c7`；V2能力、发送前快照、实际claim/结果、原float/WAV、作品Blob及完整备份闭合，真实Chromium再次解码。两次各1次音乐推理、供应商费均0（设备/用电/人工另计），没有重发未知请求。原V1真实备份已由当前V2读者离线导入/remap、核对原响应和Blob、拒绝导入采用权并删除副本，原文件保持；这不代表作者已听过或接受任一片段。
