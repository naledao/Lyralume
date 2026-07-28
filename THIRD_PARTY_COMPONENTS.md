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

## opencc-js

- 用途：在 Electron 主进程内离线执行同步歌词的通用繁体中文到中国大陆简体中文转换。
- 版本：1.4.1，通过 `pnpm-lock.yaml` 精确锁定；词典数据已包含在 npm 包中，不需要运行时联网或额外二进制文件。
- 来源：[nk2028/opencc-js](https://github.com/nk2028/opencc-js)，npm 包 `opencc-js`。
- 许可证：MIT AND Apache-2.0（以 1.4.1 包内许可证及上游仓库为准）。
- 包完整性：`sha512-2lPLcrg7cnh1ATSduOxhnk/jq6KlR6w+5Ihl4wF7Z5e5Rva4vxTyugV5rZ7EiUCOZl+EDOLetIix+BhgYDCC+A==`。

## MinIO JavaScript Client

- 用途：在 Electron 主进程中通过 S3 兼容 API 列出、上传并回读验证远程音乐对象。
- 版本：8.0.7，通过 `pnpm-lock.yaml` 精确锁定。
- 来源：[minio/minio-js](https://github.com/minio/minio-js)，npm 包 `minio`。
- 许可证：Apache-2.0（以 8.0.7 包内 `LICENSE` 与上游仓库为准）。
- 包完整性：`sha512-E737MgufW8CeQAsTAtnEMrxZ9scMSf29kkhZoXzDTKj/Jszzo2SfeZUH9wbDQH2Rsq6TCtl/yQL0+XdVKZansQ==`。

## OkHttp（Android）

- 用途：Android 客户端通过自行实现的只读 AWS Signature V4 请求访问 S3 兼容 API；仅执行 Bucket 检查、对象列表、对象元数据和对象下载，不上传或删除远程对象。
- 版本：5.1.0，通过 Android Gradle 构建文件精确固定。
- 来源：[square/okhttp](https://github.com/square/okhttp)，Maven 包 `com.squareup.okhttp3:okhttp`。
- 许可证：Apache-2.0（以 5.1.0 包内 `LICENSE` 与上游仓库为准）。
- Android 端使用平台自带的 DOM XML API 解析 S3 响应，不依赖 Java SE StAX。

## AndroidX WorkManager（Android）

- 用途：调度安卓端的一键后台音乐下载，在应用离开前台或进程被系统回收后保留任务，并通过前台通知显示长任务进度。
- 版本：2.9.1，通过 Android Gradle 构建文件精确固定；该版本与项目当前的 Android SDK 34 编译配置兼容。
- 来源：[AndroidX WorkManager](https://developer.android.com/jetpack/androidx/releases/work)，Maven 包 `androidx.work:work-runtime-ktx`。
- 许可证：Apache-2.0（以 2.9.1 AAR/POM 及 AndroidX 上游许可证为准）。

## AndroidX Media3（Android）

- 用途：使用 ExoPlayer、MediaSession 和 MediaSessionService 承载 Android 后台音频播放，并向通知栏、锁屏、耳机控制及 HyperOS 系统媒体界面发布标准播放状态和元数据。
- 版本：1.4.1，通过 Android Gradle 构建文件精确固定。
- 来源：[AndroidX Media3](https://developer.android.com/media/media3)，Maven 包 `androidx.media3:media3-exoplayer` 与 `androidx.media3:media3-session`。
- 许可证：Apache-2.0（以 1.4.1 AAR/POM 及 AndroidX 上游许可证为准）。

## FFmpeg

- 用途：将本地音乐只读解码为单声道 PCM，供整曲分析使用；同时把用户明确下载的在线音轨转换为 320 kbps MP3。不会重新编码音乐库中的原始文件。
- 构建：BtbN `ffmpeg-n8.1.2-29-g703dcc25b9-win64-lgpl-8.1`，Windows x64 LGPL 静态构建。
- 来源：[BtbN/FFmpeg-Builds 固定发布](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-07-20-14-10)。
- 固定归档 SHA-256：`D4C43716726E4497E49B9FB1778F940C39B24F0B5FC64ADCF3CF1EEA0011F38E`。
- 许可证：LGPL-2.1-or-later 及构建所含依赖各自许可证，以归档内 `LICENSE.txt` 和对应源码为准。
- 关键构建配置：启用 `--enable-version3`、`--enable-libmp3lame`；禁用 `libx264`、`libx265` 等 GPL-only 依赖，配置中没有 `--enable-gpl`。
- 对应 FFmpeg 版本：`n8.1.2-29-g703dcc25b9-20260720`。
- 打包位置：`resources/tools/ffmpeg/ffmpeg.exe` 与 `ffprobe.exe`。

| 文件 | SHA-256 |
| --- | --- |
| `ffmpeg.exe` | `CEF8C0AC4EEA7702416952E164CCEAFCADFA5D812A69B878192FF3902AA30AB7` |
| `ffprobe.exe` | `783DE3416315C173710604BF4066B4A94FFA60F3435D94CD16F7CEA9E6C67F47` |

## yt-dlp

- 用途：在 Electron 主进程管理下搜索 YouTube 音乐、下载最佳音轨并调用 FFmpeg 导出 MP3。
- 版本：2026.07.04，Windows x64 standalone executable。
- 来源：[yt-dlp 2026.07.04 固定发布](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.07.04)。
- 打包位置：`resources/tools/yt-dlp/yt-dlp.exe`。
- SHA-256：`52FE3C26DCF71FBDC85B528589020BB0B8E383155CFA81B64DD447BBE35E24B8`。
- 许可证：yt-dlp 自身使用 Unlicense；上游说明 PyInstaller 可执行文件包含 GPLv3+ 及其他许可组件。安装包同时携带该版本的 `LICENSE.txt` 和 `THIRD_PARTY_LICENSES.txt`。
- 分发要求：公开发布前必须再次确认 GPLv3+ 对应源码提供方式、NOTICE 和全部第三方许可证义务。应用通过独立进程和参数数组调用该可执行文件，不链接其代码。

本记录不是法律意见；正式发布前仍需复核上游许可证文本、NOTICE 要求和分发义务。
