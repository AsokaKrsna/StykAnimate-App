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
