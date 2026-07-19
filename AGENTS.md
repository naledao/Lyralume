# Lyralume 项目开发约定

## 工具使用约束

- 本项目禁止使用 Computer Use（Windows 图形界面自动化）执行任何操作。
- 启动、停止或重启 Lyralume 等开发操作应使用仓库内脚本或终端命令完成。

## 项目状态

当前仓库处于设计阶段，尚未创建应用源码、依赖清单或构建配置。下述内容是项目后续实现时应遵循的推荐技术栈，不应把其中任何组件描述为已经完成或已经集成。

项目目标是开发一款 Win11 本地音乐播放器，提供本地音乐库、原文件播放、同步歌词、音乐响应式视觉效果，以及在线匹配和本地 AI 生成歌词的能力。详细产品边界参见：

- `Win11本地音乐播放器开发指导.md`
- `第一阶段-播放器基础开发指导.md`

## 核心技术栈

### 桌面端与前端

- 桌面容器：Electron。
- 开发语言：TypeScript；新增 JavaScript 代码应优先改为 TypeScript。
- UI 框架：React。
- 构建及包管理：Vite + pnpm。
- 状态管理：Zustand，用于播放状态、播放队列、当前歌曲和歌词任务状态。
- 样式：CSS Modules + CSS Variables，支持主题和视觉参数调整。
- 动画：GSAP。
- 视觉渲染：优先使用 Canvas 2D；确有性能或效果需要时再引入 WebGL。

选择 Electron 是因为项目需要借鉴或复用 Mineradio 的视觉效果，而 Mineradio 当前采用 Electron、HTML/JavaScript、GSAP 和 electron-builder。除非项目负责人明确改变选型，否则不要擅自替换为 Tauri、WinUI、Flutter 等其他桌面技术。

### 播放、音乐库与歌词

- 播放：`HTMLAudioElement` + Web Audio API。
- 音频分析：使用 Web Audio API 的分析节点提供音量、时域和频域数据。
- 元数据读取：`music-metadata`，读取标题、歌手、专辑、封面和时长。
- 文件扫描与监听：Node.js `fs` + `chokidar`。
- 本地数据：SQLite + `better-sqlite3`。
- LRC：实现项目内的 LRC 解析、时间同步、整体偏移、拆行和合行能力，不为简单解析过早引入大型框架。
- 在线歌词：直接调用 LRCLIB REST API；LRCGET 只作为交互和实现参考，不通过自动化操作其图形界面。
- 标签写入：通过 `kid3-cli` 写入并回读验证 SYLT。
- 音频辅助工具：FFmpeg / ffprobe，仅用于探测或 AI 中间处理，不得重新编码或替换用户原始音乐。

第一阶段支持的具体音频格式应通过测试样本确认，不得仅根据文件扩展名宣称兼容。

### 本地 AI Worker

- 人声分离：Python + Audio Separator/UVR。
- 歌词识别与对齐：Python + WhisperX + PyTorch。
- 硬件策略：正式支持 NVIDIA CUDA，CPU 作为兼容回退；AMD/Intel GPU 初期视为实验能力。
- UVR Worker 与 WhisperX Worker 使用各自独立、锁定版本的 Python 环境。
- Worker 必须作为外部进程运行，不能把 Python、CUDA 或模型运行时嵌入 Electron 渲染进程。
- Electron 与 Worker 优先通过 stdin/stdout 上的 JSON Lines 协议通信，避免无必要地开放本地 HTTP 端口。
- GPU 推理任务默认串行，UVR 阶段结束并释放资源后再启动 WhisperX 阶段。

### 测试、日志和交付

- 单元测试：Vitest + React Testing Library。
- Electron 端到端测试：Playwright 的 Electron 能力。
- Python Worker 测试：pytest。
- 日志：`electron-log` 或 Pino；日志必须能区分主进程、渲染进程、任务 ID 和 Worker。
- Windows 打包：electron-builder + NSIS，目标优先为 Win11 x64。
- 持续集成：GitHub Actions，至少执行类型检查、单元测试和 Windows 构建验证。
- AI 组件和模型应作为可选资源包按需下载，不要塞入核心安装包。

依赖版本应在真正创建项目时选用兼容的稳定版本，并通过 lockfile 精确锁定。不要只依据本文中的工具名称猜测版本。

## 架构边界

推荐进程和模块关系如下：

```text
React 渲染进程
├─ 音乐库 UI
├─ 播放控制与 Web Audio
├─ LRC 歌词显示/编辑
└─ GSAP + Canvas 视觉模块
          │ Typed IPC
Electron 主进程
├─ 音乐文件扫描与元数据读取
├─ SQLite 数据库
├─ 歌词任务调度器
├─ LRCLIB 客户端
└─ 外部进程管理
    ├─ UVR Worker
    ├─ WhisperX Worker
    ├─ FFmpeg / ffprobe
    └─ kid3-cli
```

必须遵守以下边界：

- React 组件不得直接操作任意本地文件、SQLite 或启动外部进程。
- 渲染进程通过 `contextBridge` 暴露的最小化、类型化 IPC API 调用主进程；禁用 `nodeIntegration`，启用上下文隔离。
- 主进程负责文件权限、音乐库、数据库、任务调度和 Worker 生命周期。
- 播放与视觉渲染解耦；禁用或关闭视觉效果不能影响音频播放。
- 视觉模块只消费分析数据，不能修改音频。
- 同一音乐文件不能同时运行多个写入任务。
- 外部进程必须以参数数组启动，不得通过拼接 Shell 命令传递文件路径或用户输入。
- 对音乐文件执行标签写入前必须释放播放句柄、保存播放位置、加任务锁，并在写入后回读验证。
- 任务失败必须保留已有 LRC、草稿和可复用的中间结果。

## 分阶段实施范围

### 第一阶段：播放器基础

只实现以下技术和功能：

- Electron、React、TypeScript、Vite 和 pnpm 项目骨架。
- 本地音乐扫描、元数据读取和 SQLite 音乐库。
- 本地音频播放、进度、音量、切歌和资源释放。
- 同名 LRC 读取、解析、同步高亮和滚动。
- Web Audio 分析数据以及 GSAP/Canvas 基础视觉效果。
- 基础日志、异常隔离和测试。

第一阶段不要接入 LRCLIB、Kid3、UVR、WhisperX、CUDA 或模型下载。

### 第二阶段：在线歌词

- 接入 LRCLIB 查询、评分和候选确认。
- 原子保存同名 LRC，不自动覆盖已有歌词。
- 通过 `kid3-cli` 写入 SYLT 并回读验证。

### 第三阶段：本地歌词草稿

- 接入 Audio Separator/UVR Worker。
- 接入 WhisperX Worker 和词/字级对齐。
- 保存原始转写、对齐 JSON 和 LRC 草稿。
- 实现歌词校对页面，用户确认后才能嵌入标签。

### 第四阶段：工程化完善

- 模型管理、缓存清理、任务恢复和失败重试。
- 纯文本歌词重新对齐。
- 不同语言、曲风、文件格式和硬件环境的测试集。

## 数据与文件安全

- 不得修改、替换或重新编码用户原始音频内容。
- 保存 LRC 时先写临时文件，再使用原子替换。
- 不自动覆盖用户已有 LRC；存在歧义时要求用户确认。
- AI 结果默认标记为草稿，首版必须经用户校对后才能写入标签。
- 标签写入失败时保留外部 LRC 和草稿数据。
- 缓存及中间文件位于应用缓存目录，并提供统一清理入口。
- 应用重启后必须能够识别已完成、未完成和失败任务。

## 许可证约束

- Mineradio 使用 GPL-3.0。直接复制、改造或链接其代码前，必须确认项目采用的分发许可和相应开源义务。
- 如果项目不准备接受直接复用代码带来的许可要求，只能参考功能和视觉思路并独立实现，不能复制其源码。
- Kid3 及随应用分发的第三方二进制、模型和运行库必须逐项记录来源、版本、许可证和文件哈希。
- 任何许可证判断都应在正式发布前复核，本文不构成法律意见。
