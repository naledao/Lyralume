# Local lyrics workers

The UVR and WhisperX workers intentionally use two different Python virtual
environments. They communicate with Electron only through one-request JSON
Lines messages over stdin/stdout. Model and library logs go to stderr.

The pinned top-level versions are:

- Audio Separator 0.44.2
- WhisperX 3.8.6
- PyTorch 2.8.0 with CUDA 12.8
- ONNX Runtime GPU 1.22.0 (CUDA 12.x / cuDNN 9)

For a local development setup on Windows, create the environments outside the
application installation directory, for example under the app user-data
directory:

```powershell
py -3.11 -m venv "$env:APPDATA\Lyralume\ai\uvr\.venv"
& "$env:APPDATA\Lyralume\ai\uvr\.venv\Scripts\python.exe" -m pip install -r workers\uvr\requirements-cuda.txt

py -3.11 -m venv "$env:APPDATA\Lyralume\ai\whisperx\.venv"
& "$env:APPDATA\Lyralume\ai\whisperx\.venv\Scripts\python.exe" -m pip install -r workers\whisperx\requirements.txt
```

Set `LYRALUME_UVR_PYTHON` and `LYRALUME_WHISPERX_PYTHON` when the environments
are stored elsewhere. For CPU fallback, install `requirements-cpu.txt` in the
UVR environment and start a task with the CPU option. NVIDIA GPU remains the
supported accelerated path. FFmpeg must be discoverable by both environments.

Model downloads are performed by the upstream libraries into the app user-data
model cache. A model manager and full cache lifecycle belong to phase four.

For Chinese (`zh`) transcription, the Worker preserves WhisperX's original
output in `raw-transcript.json`, then uses the Win11 NLS conversion tables to
normalize the text to simplified Chinese before alignment and draft creation.
This does not add a Python runtime dependency and does not alter non-Chinese
transcripts.

The CUDA requirement files deliberately pin the PyTorch CUDA build and ONNX
Runtime together. Do not upgrade `onnxruntime-gpu` independently: newer builds
may target a different CUDA major version even though the package name is the
same. Validate both `torch.cuda.is_available()` and an actual ONNX CUDA
inference before accepting a dependency update.
