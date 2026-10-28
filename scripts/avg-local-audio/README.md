# 本机音频模型安装基础

仅用于本机实验运行时的显式安装，不执行推理、不读取凭据或浏览器作品、不提供采用/发布入口。配音继续由原逐句生产、HTTP证据、审听/选音与消费绑定工作流接管。

`pinned_model_install.py` 使用各工作流自己的完整仓库revision、文件大小和SHA-256/Git blob清单。最多256文件/32 GiB、单文件16 GiB，安装后保留8 GiB空间；两个下载worker，每文件单次有界curl，显式再次执行才能续传。镜像必须由参数明确选择，接收字节仍须匹配原始冻结hash。模型路径、原有文件/身份、部分下载与并发安装均受校验；失败保留原字节及部分文件，不自动重试或覆盖坏文件。

安装结束逐文件复验，生成与既有Qwen读者相容的`storyforge-model-lock.json`。先完整写入/fsync独立临时seal，再原子替换；中断保留原seal与待检查临时文件。它不代替运行时的模型许可、代码及依赖核查，也不把模型许可转换为作品/角色/参考媒资权利。

测试仅模拟公开文件传输，不下载权重或调用模型：

```sh
python3 -m unittest discover -s scripts/avg-local-audio -p 'test_*.py' -v
python3 -m unittest discover -s scripts/avg-local-voice -p 'test_*.py' -v
```

当前验证环境为本机macOS；其他系统的锁/运行时仍须单独验证。构建缓存可重建，模型权重、原始图声、失败与用户备份不由此安装器清理。
