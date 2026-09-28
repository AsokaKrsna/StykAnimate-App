# Linux support

StykAnimate develops and ships for Windows and Linux from one source tree. A
change is not done until it works on both; CI runs the unit suite on both.
macOS packaging exists in `package.json` but is not verified.

## GPU (WebGPU)

Electron's Chromium does not enable WebGPU on Linux by default. Without help the
editor would report "No compatible WebGPU adapter" and use the Canvas 2D
compatibility renderer on a capable GPU. `desktop/gpu-switches.cjs` adds the
Vulkan feature and the WebGPU opt-in on Linux before Electron starts, merging any
`--enable-features` given on the command line. Windows and macOS are unchanged.

- `STYK_GPU_UNSAFE=0` leaves Chromium's own driver allowlist untouched (use it to
  diagnose a driver problem; the app then uses the compatibility renderer).
- `STYK_GPU_UNSAFE=1` forces the WebGPU opt-in on any platform.
- The renderer still rejects software adapters (SwiftShader) and falls back to
  Canvas 2D, so a machine without a working Vulkan driver edits and plays back
  correctly, only more slowly. Virtual displays such as Xvfb have no GPU.

Verified on NVIDIA (proprietary driver) under Wayland. Mesa (Intel/AMD) uses the
same switches but has not been verified here.

## Build and package

```bash
npm ci
uv venv .venv --python 3.12.9          # or: python3.12 -m venv .venv
uv pip install --python .venv/bin/python -r scripts/requirements-build.txt
npm run build:frame-scan               # needs a C++17 compiler (g++ or clang)
npm run build:sidecar                  # freezes the Pivot codec with PyInstaller
npm run verify:sidecar
npm run build:video-encoder            # stages the bundled ffmpeg
npm run dist:linux                     # release/<version>/StykAnimate-<version>-linux-x86_64.AppImage
```

The `build:*` scripts run through `scripts/run-python.mjs`, which uses
`STYK_PYTHON`, then the repository `.venv`, then `python3`/`python`, so a bare
`python` is not required. The native scanner builds into
`native/bin/linux-x64/` (untracked); Windows keeps its tracked
`native/bin/x64/`, so a Linux build never dirties or breaks the Windows one.

### AppImage and the Chromium sandbox

`package.json` selects electron-builder's static-runtime AppImage toolset
(`toolsets.appimage`, currently a beta). Its launcher adds `--no-sandbox` only
when user namespaces are unavailable, and the desktop entry carries no
`--no-sandbox`. The default legacy toolset put `--no-sandbox` in the desktop entry
unconditionally, disabling the renderer sandbox whenever the app was started from
a menu or file association. The static runtime also needs no `libfuse2`, which
recent Ubuntu releases no longer install. On systems that restrict unprivileged
user namespaces (Ubuntu 24.04+ AppArmor) without a profile for the app, the
launcher falls back to `--no-sandbox` rather than failing to start.

The desktop entry registers the document types (`.styk`, `.stkz`, `.stykmov`,
`.piv`, `.stk`, `.nodes`, `.nodemc`, `.stknds`) and the `stykanimate://` scheme,
and `StartupWMClass=stykanimate` groups the window under its launcher.
Passing a document path on the command line opens it.

Automatic updates stay disabled on Linux until Linux builds are published with
their update metadata (see `desktop/updates.cjs`).
