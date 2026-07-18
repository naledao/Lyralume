# Lyralume

Lyralume 是面向 Windows 11 的本地音乐播放器。当前实现覆盖本地音乐库、原文件播放、同名 LRC 同步显示，以及第二阶段的 LRCLIB 在线歌词候选确认、安全保存和 Kid3 同步歌词标签写入/回读验证。

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

在线歌词查询不需要 API Key。若要使用“写入音频标签”，需单独安装 Kid3，并确保 `kid3-cli` 可以从 `PATH` 启动；Lyralume 当前不会把 Kid3 二进制打进安装包。未安装 Kid3 时，已经保存的同名 LRC 不会丢失。

## 安全边界

- 渲染进程关闭 `nodeIntegration`，启用 `contextIsolation` 与 sandbox。
- 文件选择、扫描、元数据、SQLite、LRC 读写、LRCLIB 请求和 Kid3 进程均在主进程中进行。
- 预加载层只暴露最小化的类型化 API；播放和封面通过歌曲 ID 映射到受控协议，不向渲染进程泄露音频文件绝对路径。
- 标签写入仅通过参数数组启动 `kid3-cli`，不经过 Shell；写入前释放播放器文件句柄，写入后导出 SYLT 并与 LRC 逐行回读验证。
- 同名 LRC 使用同目录临时文件安全落盘；已有文件必须再次明确确认才允许覆盖。
- 单个损坏文件、LRC 或 Canvas 视觉异常均被隔离，不应导致整个播放器退出。

## 音频格式说明

扫描器会把常见音频扩展名作为候选文件交给 `music-metadata` 与 Electron 媒体栈。扩展名不等于兼容性承诺；目前自动化测试只验证了程序生成的 PCM WAV 样本，正式支持范围仍需使用真实编码样本在目标 Win11 环境逐项验证。

当前阶段不包含 UVR、WhisperX、CUDA 或模型下载。
