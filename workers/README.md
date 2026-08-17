# Local lyrics workers

The UVR and WhisperX workers intentionally use two different Python virtual
environments. They communicate with Electron only through one-request JSON
Lines messages over stdin/stdout. Model and library logs go to stderr.

The pinned top-level versions are:

- Audio Separator 0.44.2
- WhisperX 3.8.6
- PyTorch 2.8.0 with CUDA 12.8
- ONNX Runtime GPU 1.22.0 (CUDA 12.x / cuDNN 9)

Unless a `LYRALUME_*_PYTHON` variable explicitly selects an interpreter,
Lyralume first uses the dedicated environments under the app user-data
directory at `ai/uvr/.venv` and `ai/whisperx/.venv`. When a dedicated
environment is unavailable, it honors an active `VIRTUAL_ENV` or
`CONDA_PREFIX`, then asks the Windows Python Launcher for Python 3.11, and
finally checks `python`/`python3` on `PATH`. It does not assume a user-specific
installation directory.

For isolated local environments (recommended because UVR and WhisperX pin
different dependencies), create them anywhere on the computer, for example:

```powershell
py -3.11 -m venv "D:\PythonEnvs\lyralume-uvr"
& "D:\PythonEnvs\lyralume-uvr\Scripts\python.exe" -m pip install -r workers\uvr\requirements-cuda.txt

py -3.11 -m venv "D:\PythonEnvs\lyralume-whisperx"
& "D:\PythonEnvs\lyralume-whisperx\Scripts\python.exe" -m pip install -r workers\whisperx\requirements.txt
```

Set `LYRALUME_UVR_PYTHON` and `LYRALUME_WHISPERX_PYTHON` when the environments
should stay independent, or set `LYRALUME_PYTHON` to use one interpreter for
both workers. For CPU fallback, install `requirements-cpu.txt` in the UVR
environment and start a task with the CPU option. NVIDIA GPU remains the
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
