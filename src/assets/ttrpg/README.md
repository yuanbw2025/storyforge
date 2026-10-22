# 跑团旁白试听素材

`narration-preview.wav` 是固定原创示例文本的中文合成音频，仅用于进入游戏前选择本机收听语速。未使用真人录音或音色克隆，不包含作品、玩家或世界私有内容；不作为任何团局的已采用音轨。

原文：雨停以后，你们沿着石阶走到旧码头。守夜人抬起灯，仔细看了看每个人的脸，却没有立刻开口。远处传来两下缓慢的钟声，一只小船正从黑暗里靠近。你可以先问清来人的身份，再决定是否登船。

原 WAV：单声道 PCM16 / 44100 Hz / 13.560454 秒；SHA-256 `315c6c8c0db734b5f03237f1e8c4cccfe57d78f689cf065b279afcc5286a49d9`。实际试听默认 0.90 倍速并保持音高；文件字节保持原样。

生成来源：仓库 `scripts/ttrpg-local-tts/selection.json` 固定的 [MeloTTS](https://github.com/myshell-ai/MeloTTS/tree/209145371cff8fc3bd60d7be902ea69cbdb7965a) 和 [中文语音模型](https://huggingface.co/myshell-ai/MeloTTS-Chinese/tree/af5d207a364ea4208c6f589c89f57f88414bdd16)（MIT）；生成时使用的 [BERT 文本编码模型](https://huggingface.co/google-bert/bert-base-multilingual-uncased/tree/7cbf9a625e29989f6b9c6c2fa68234c304f7e38f) 标注 Apache-2.0。仅分发这段生成样本，不把模型、权重或 Python 依赖打入前端。原始生成记录、WAV 与评测回执留存本地。


Qwen 主方向（用户已明确偏好此组）：`narration-qwen-uncle_fu-v1.wav` 与 `narration-qwen-serena-v1.wav` 是同一公开原创段落的两个原生说话人，分别为 24 kHz / PCM16 / 25.440 秒与 19.120 秒。原样保留真实输出，不以升降调或变速制造新声线。准确模型、代码、音频哈希、codec 帧数与调用身份见 `narration-qwen-source-v1.json`；每个有效码（含零码）对应 1920 样本，并观察真实 EOS。

模型来源为 [社区 Qwen CustomVoice 8bit 准确版本](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit/tree/049ef77fe8816b536193c0c25f9a214d17921282)，模型卡标注 Apache-2.0；适用声明保留在 `public/licenses/ttrpg-qwen-Apache-2.0.txt`（随应用静态文件分发）。运行器来自 [MLX Audio 准确版本](https://github.com/Blaizzy/mlx-audio/tree/1865f49cc9a40de9b5e4fcf55952b9812d751f1d)，MIT 声明另保留于 `scripts/ttrpg-local-tts/MLX-Audio-LICENSE`。仅分发固定合成试听，不分发模型/环境或真人录音，不含克隆参考声音。发布方的来源说明与用户组别偏好不作为独立声音权利合同、团局音轨采用或完整产品验收。

试听页默认不加载/播放声音；仅明确播放时读取已打包 WAV，不调用模型。选择保存在本浏览器，旧 Melo 样本、旧音轨和旧请求保持原样。新生成动作沿原受治理配音链冻结所选 Qwen 或明确兼容 Melo；已有音轨和请求保留原声线。固定试听不是正式音轨采用，具体接入与验证见方案 §35.164。
