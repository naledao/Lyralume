# FFmpeg 可选运行时

本目录默认不包含二进制。开发环境可通过 `LYRALUME_FFMPEG_PATH` 或系统 `PATH` 提供 FFmpeg。

若正式安装包需要内置 `ffmpeg.exe`，必须先完成 LGPL 构建审计，并在 `THIRD_PARTY_COMPONENTS.md` 记录来源、版本、构建配置、许可证与文件 SHA-256。打包配置会把审核后的 `ffmpeg.exe` 和许可证复制到 `resources/tools/ffmpeg/`。
