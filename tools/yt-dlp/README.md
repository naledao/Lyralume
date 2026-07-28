# yt-dlp Windows 运行时

运行 `pnpm tools:prepare-music` 会下载并校验固定版本的 Windows x64 `yt-dlp.exe`，同时保存上游许可证与第三方许可证清单。正式打包会自动执行该步骤。

- 固定版本：2026.07.04
- 来源：https://github.com/yt-dlp/yt-dlp/releases/tag/2026.07.04
- `yt-dlp.exe` SHA-256：`52FE3C26DCF71FBDC85B528589020BB0B8E383155CFA81B64DD447BBE35E24B8`

上游说明 PyInstaller Windows 可执行文件包含 GPLv3+ 组件。公开分发前仍需复核对应源码提供方式和全部许可证义务。
