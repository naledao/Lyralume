# Lyralume

Lyralume 是面向 Windows 11 的本地音乐播放器。当前实现覆盖第一阶段闭环：导入音乐文件夹、建立 SQLite 音乐库、播放原始本地文件、同步显示同名 LRC，以及独立可关闭的音乐响应式视觉效果。

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

## 安全边界

- 渲染进程关闭 `nodeIntegration`，启用 `contextIsolation` 与 sandbox。
- 文件选择、扫描、元数据、SQLite、LRC 读取均在主进程中进行。
- 预加载层只暴露最小化的类型化 API；播放和封面通过歌曲 ID 映射到受控协议，不向渲染进程泄露音频文件绝对路径。
- 播放器只读取原始音乐，不写标签、不修改内容，也不重新编码。
- 单个损坏文件、LRC 或 Canvas 视觉异常均被隔离，不应导致整个播放器退出。

## 音频格式说明

扫描器会把常见音频扩展名作为候选文件交给 `music-metadata` 与 Electron 媒体栈。扩展名不等于兼容性承诺；目前自动化测试只验证了程序生成的 PCM WAV 样本，正式支持范围仍需使用真实编码样本在目标 Win11 环境逐项验证。

第一阶段刻意不包含 LRCLIB、Kid3、UVR、WhisperX、CUDA 或模型下载。
