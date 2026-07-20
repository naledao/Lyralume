# Lyralume 第三方组件记录

本文件记录随 Windows x64 安装包分发、且需要单独追踪的外部运行时组件。哈希以项目打包产物中的实际文件为准；依赖升级后必须重新核对版本、许可证和 SHA-256。

## OpenAI Codex

- 用途：通过官方 TypeScript SDK 在 Electron 主进程中运行只读、结构化的歌词语境分析和中文译配任务。
- SDK：`@openai/codex-sdk` 0.144.5。
- CLI：`@openai/codex` 0.144.5；Windows x64 平台包 0.144.5-win32-x64。
- 来源：[openai/codex](https://github.com/openai/codex)；npm 包 `@openai/codex-sdk` 与 `@openai/codex`。
- 许可证：Apache-2.0（以对应版本包内许可证及上游仓库为准）。

Windows x64 平台包内可执行文件：

| 文件 | SHA-256 |
| --- | --- |
| `vendor/x86_64-pc-windows-msvc/bin/codex-code-mode-host.exe` | `5D7DB48DEE5E82AE23E98E33C3421F2774DC50C52C53374685D616997844116F` |
| `vendor/x86_64-pc-windows-msvc/bin/codex.exe` | `EFDB3540EF74B9909408C8D38DA79483454797B36F471E3E004FC2BF2B70E22A` |
| `vendor/x86_64-pc-windows-msvc/codex-path/rg.exe` | `DECDD4992F3F1B9A5EF9898F1B40AB16886D579D6516B4EFD3D5EAA19364E408` |
| `vendor/x86_64-pc-windows-msvc/codex-resources/codex-command-runner.exe` | `61578D088B9EA335C7A66BF4B1B0ABE615DD8C2B37DDE28B8618084F353989D7` |
| `vendor/x86_64-pc-windows-msvc/codex-resources/codex-windows-sandbox-setup.exe` | `26D484975FCA809537BF279DE0330BB756047B0B3645C65B5B46930970AE1DFF` |

## fft.js

- 用途：实时与整曲音频分析共用的 FFT 实现。
- 版本：4.0.4，通过 `pnpm-lock.yaml` 精确锁定。
- 来源：[indutny/fft.js](https://github.com/indutny/fft.js)，npm 包 `fft.js`。
- 许可证：MIT（以 4.0.4 包内 `LICENSE` 为准）。
- 包完整性：`sha512-f9c00hphOgeQTlDyavwTtu6RiK8AIFjD6+jvXkNkpeQ7rirK3uFWVpalkoS4LAwbdX7mfZ8aoBfFVQX1Re/8aw==`。

## FFmpeg

- 用途：将音乐文件只读解码为单声道 PCM，供整曲分析使用；不创建、不覆盖或重新编码用户音频。
- 当前分发状态：核心安装包不附带 FFmpeg；开发环境从 `LYRALUME_FFMPEG_PATH` 或 `PATH` 解析。缺失时自动退回实时视觉。
- 预留打包位置：`resources/tools/ffmpeg/ffmpeg.exe`。
- 分发要求：仅可放入审核通过的 LGPL 构建；正式加入安装包时必须补录来源、版本、构建配置、许可证文本及实际文件 SHA-256。

本记录不是法律意见；正式发布前仍需复核上游许可证文本、NOTICE 要求和分发义务。
