# FFmpeg Windows 运行时

运行 `pnpm tools:prepare-music` 会下载并校验固定的 BtbN Windows x64 LGPL 静态构建，从归档中提取 `ffmpeg.exe` 与 `ffprobe.exe`。正式打包会自动执行该步骤。

- 构建：`ffmpeg-n8.1.2-29-g703dcc25b9-win64-lgpl-8.1`
- 来源：https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-07-20-14-10
- 归档 SHA-256：`D4C43716726E4497E49B9FB1778F940C39B24F0B5FC64ADCF3CF1EEA0011F38E`

开发环境仍可通过 `LYRALUME_FFMPEG_PATH` 或系统 `PATH` 覆盖。公开分发前必须复核归档内许可证、LGPL 对应源码与重新链接要求。
