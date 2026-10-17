# 本机中文语音开发评测

固定台词的离线 CPU 评测，入口登记为 `ttrpg.local-voice.eval`。当前支持中文精简内核的验证；正式团局配音沿施工方案 §35.103 独立接入原叙述、候选试听、确认与异步生命周期。

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

## 来源与许可

- MeloTTS：固定官方代码 `209145371cff8fc3bd60d7be902ea69cbdb7965a`，MIT。只取神经网络内核和中文前端，保留原源码、许可、导数哈希和补丁说明。
- 官方中文权重：`myshell-ai/MeloTTS-Chinese@af5d207a364ea4208c6f589c89f57f88414bdd16`，官方模型卡标注 MIT。
- 文本编码模型：`google-bert/bert-base-multilingual-uncased@7cbf9a625e29989f6b9c6c2fa68234c304f7e38f`，独立 Apache-2.0。
- `runtime-profile.json` 固定 41 个 Python 包及其发布许可元数据/文件哈希；包含 Apache、BSD、MIT 等依赖，tqdm 保留 MPL-2.0/MIT 原许可。整个依赖链不能被称为均为 MIT。

完整上游多语言安装列表未准入：本工具不引入日文/其他语言前端、`pykakasi`、`Unidecode`、`num2words`、`g2p_en`、Web UI、训练或音频编解码栈。MeloTTS 的中文入口明确裁剪未使用的分派；CPU 特征读取与超长输出拒绝由评测引擎负责。不会通过 `weights_only=False`、远程自定义模型代码或下载回退绕过固定权重校验。
