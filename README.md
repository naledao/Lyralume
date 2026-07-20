# Lyralume

Lyralume 是面向 Windows 11 的本地音乐播放器。当前实现覆盖本地音乐库、原文件播放、同步歌词、歌曲级音频分析与动态视觉，以及本地歌词草稿、校对和确认写入流程。

## 开发环境

- Windows 11 x64
- Node.js 22.12 或更新的兼容版本
- pnpm 10.34.5（已在 `packageManager` 与 lockfile 中固定）

如果系统 Corepack 较旧并出现签名校验错误，可直接使用：

```powershell
npx.cmd --yes pnpm@10.34.5 install
npx.cmd --yes pnpm@10.34.5 dev
```

常用命令：

```powershell
pnpm dev          # 启动 Vite 与 Electron
pnpm typecheck    # 渲染进程及 Electron 进程严格类型检查
pnpm test         # Vitest 单元测试
pnpm test:e2e     # 构建、重建原生依赖并运行 Electron E2E
pnpm build        # 生成生产构建
pnpm package:win  # 生成 Win11 x64 NSIS 安装包
```

播放歌曲并开启视觉效果后，可以从主视觉右上角进入“沉浸视觉”。系统会结合整曲节拍、调性、段落、实时频谱和封面配色，为每首歌生成稳定的 Visual DNA；分析不可用时自动退回实时模式。视觉设置提供质量档位、强度、减少动态和重新分析入口。标记为“纯音乐”的曲目会隐藏歌词栏，让视觉区域铺满整个屏幕。移动鼠标可唤回播放控制，`Space` 控制播放暂停，左右方向键快退或快进 5 秒，`Esc` 退出全屏。

整曲视觉分析需要可执行的 FFmpeg。开发或自定义运行环境可通过 `LYRALUME_FFMPEG_PATH` 指定，或确保 `ffmpeg` 位于 `PATH`；未配置时播放与实时视觉仍可正常工作。正式安装包如需内置 FFmpeg，必须先按 [`THIRD_PARTY_COMPONENTS.md`](THIRD_PARTY_COMPONENTS.md) 完成 LGPL 构建审计和哈希记录。

在线歌词查询通过 LRCLIB，不需要 API Key；没有匹配结果时可改用本地生成。若要使用“写入音频标签”，需单独安装 Kid3，并确保 `kid3-cli` 可以从 `PATH` 启动；Lyralume 当前不会把 Kid3 二进制打进安装包。未安装 Kid3 时，已经保存的同名 LRC 不会丢失。

“中文译配”生成的双语草稿经人工审阅后，可以把同一时间戳下的原文与中文行直接写入原音频的 ID3 SYLT 标签。写入过程使用歌曲级文件锁，播放器会先释放文件句柄；成功后回读逐行验证并优先显示内嵌歌词，外置 LRC 不会被覆盖。

## 本地歌词草稿环境

UVR 与 WhisperX 使用两个隔离的 Python 3.11 环境，不能安装到 Electron 渲染进程或共用同一个虚拟环境。Worker 脚本、固定的顶层依赖版本和 Windows 安装示例位于 [`workers/README.md`](workers/README.md)。默认环境位置为：

```text
%APPDATA%\Lyralume\ai\uvr\.venv\Scripts\python.exe
%APPDATA%\Lyralume\ai\whisperx\.venv\Scripts\python.exe
```

也可用 `LYRALUME_UVR_PYTHON` 和 `LYRALUME_WHISPERX_PYTHON` 指向其他解释器；`LYRALUME_AI_DEVICE=cpu` 可把默认设备切换为 CPU。NVIDIA CUDA 是正式加速路径，CPU 是兼容回退。模型由 [Audio Separator](https://github.com/nomadkaraoke/python-audio-separator) 与 [WhisperX](https://github.com/m-bain/whisperX) 下载到应用用户数据目录，模型管理和缓存清理留在第四阶段。

校对页可选调用本机已经安装并登录的 Codex CLI。Codex 会启用 live web search，按歌曲名、艺术家、专辑和草稿片段查询公开资料辅助校对，并把实际使用的 HTTPS 来源返回到界面；界面通过 `codex exec --json` 的 JSONL 事件实时显示 CLI 启动、联网检索、分析、结构校验、完成或失败流程，只展示操作摘要，不展示模型隐藏推理。Codex 可以修改歌词文字、每行开始/结束时间、整体偏移、行数、行 ID 和顺序，也可以跨行移动文字、拆行或合行。现有行保留原置信度和标记，Codex 新增的行会标记为低置信度；结果不会自动保存，并可在界面中完整撤销。本地草稿校对在 Windows 默认从 `PATH` 查找 npm 安装的 `codex.cmd`，也可用 `LYRALUME_CODEX_PATH` 指定 CLI；中文双语译配通过 `@openai/codex-sdk` 调用安装包内的 Windows Codex CLI，并复用当前用户 `CODEX_HOME`（默认 `~/.codex`）中的登录状态。安装版从 `app.asar.unpacked` 的物理路径启动该 CLI，避免 Windows 无法执行 ASAR 虚拟路径。该能力与 LRCLIB 在线歌词查询相互独立。

## 安全边界

- 渲染进程关闭 `nodeIntegration`，启用 `contextIsolation` 与 sandbox。
- 文件选择、扫描、元数据、SQLite、LRC 读写、LRCLIB 请求、AI Worker 调度和 Kid3 进程均在主进程中进行。
- 预加载层只暴露最小化的类型化 API；播放和封面通过歌曲 ID 映射到受控协议，不向渲染进程泄露音频文件绝对路径。
- 标签写入仅通过参数数组启动 `kid3-cli`，不经过 Shell；写入前释放播放器文件句柄，写入后导出 SYLT 并与 LRC 逐行回读验证。
- 同名 LRC 使用同目录临时文件安全落盘；已有文件必须再次明确确认才允许覆盖。
- 单个损坏文件、LRC 或 Canvas 视觉异常均被隔离，不应导致整个播放器退出。
- UVR 与 WhisperX 仅通过 stdin/stdout JSON Lines 通信，使用参数数组启动；GPU 阶段全局串行，已完成中间结果在失败和取消后保留。
- Codex 校对在独立临时目录、只读沙箱和非交互模式下运行；仅开放 Codex Web Search，应用严格校验结构化结果、唯一行 ID、时间范围与顺序，以及公开 HTTPS 来源。

## 音频格式说明

扫描器会把常见音频扩展名作为候选文件交给 `music-metadata` 与 Electron 媒体栈。扩展名不等于兼容性承诺；目前自动化测试只验证了程序生成的 PCM WAV 样本，正式支持范围仍需使用真实编码样本在目标 Win11 环境逐项验证。

应用不会自动安装 CUDA、Python、FFmpeg、AI 模型或 Kid3；这些均作为可选本地资源配置，不进入核心安装包。
