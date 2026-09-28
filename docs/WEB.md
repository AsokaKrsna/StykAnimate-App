# Web build (Cloudflare)

The editor also runs as a static website. It is the same code as the desktop app
plus an in-browser Pivot codec; nothing about a project is sent to a server.

```bash
npm ci
npm run web:build       # build/web  (614 files, about 25 MiB)
npm run web:verify      # checks the build before it is deployed
npm run web:preview     # build, then serve build/web on http://127.0.0.1:47850
npm run test:web        # end to end in a real browser, under the production headers
```

## Deploying

The editor is its own Cloudflare Worker (`web/wrangler.jsonc`, static assets only),
separate from the public site in `cloud/`, so the two deploy and roll back
independently.

```bash
npm ci --prefix cloud                   # once: installs the pinned wrangler
npx --prefix cloud wrangler login       # or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
npm run web:deploy -- --dry-run         # build, verify, let wrangler validate the config
npm run web:deploy                      # deploy to <name>.<account>.workers.dev
STYK_WEB_URL=https://... npm run test:web   # run the end-to-end test against the deployment
```

`web:deploy` refuses to deploy a site that fails `web:verify`. To serve the editor
from your own domain, add a route on a zone you control to `web/wrangler.jsonc`
(the file shows the line). Cloudflare applies `web/_headers` to every response.

## How it is built

There is no bundler. The site is the desktop app's web resources (the file set
comes from the `web` filter in `package.json`, so the two builds cannot drift),
the Pyodide runtime in `vendor/pyodide/`, and the codec's Python sources as one
JSON file in `python/`. `index.html` is marked `<meta name="styk-codec"
content="browser">`, which is what selects the in-browser codec.

Modules are not content-hashed, so `_headers` tells browsers to revalidate them;
Cloudflare answers with `304` and an ETag, and the large runtime is not
downloaded again. A cold load is about 530 requests; measured with the local
development server it took 3.9 s on localhost and 5.9 s at 50 ms latency and
20 Mbps, uncompressed. Cloudflare compresses text and serves over HTTP/2. If cold
load ever matters more than simplicity, bundling is a build-only change.

`web:verify` fails the build for: a module the app imports that was not shipped, a
file over Cloudflare's 25 MiB limit or more than 20,000 files, a `_headers` file
Cloudflare would reject or without a script policy, a page that does not select the
in-browser codec, and any private file (`desktop/`, `backend/`, `.env`, keys).

## Security

`_headers` sends the policy `index.html` already declares in its own tag, plus the
directives a tag cannot carry: `script-src 'self' 'wasm-unsafe-eval'` (WebAssembly
compiles; `eval` does not), `worker-src 'self' blob:`, `object-src 'none'`,
`frame-ancestors 'none'`, `nosniff`, `no-referrer`, and a Permissions-Policy with
camera, microphone, geolocation and payment off. The browser build sends no
telemetry and has no feedback channel, update check or server codec.
Never deploy `backend/server.py` publicly: it can read the folder it runs in.

## The in-browser Pivot codec

Pivot (`.piv`, `.stk`) files use a binary format whose reader and writer are the
Python codec in `codecs/` and `backend/`. In the browser that same code runs in
[Pyodide](https://pyodide.org) (CPython on WebAssembly) in a worker:

- `src/codec-request.mjs`: the import and export workers ask for `/api/import`,
  `/api/export` and `/api/source` through one function. Over HTTP it is `fetch`;
  in the browser it is a `MessagePort` to the codec worker. Either way the caller
  gets a `Response`, so import and export logic is identical on both.
- `src/codec-web-host.mjs` (page) and `src/codec-web-worker.mjs` (worker) own the
  worker, its queue and cancellation; `src/codec-web-engine.mjs` boots Pyodide.
- `backend/browser_service.py` serves the same routes without HTTP, over the same
  `ProjectStore`, size rules and error mapping as `server.py` (which now exports
  those pieces). Parity tests send identical requests through the real HTTP
  server and through it, and check that WebAssembly and native CPython return the
  same document.

The runtime (about 13 MiB) loads on the first Pivot import or export, never at
startup, and is then cached by the browser. Native projects (`.styk`, `.stkz`,
`.stykmov`), Stick Nodes files and every image, GIF and WebM export do not need it.

Differences from the desktop codec, all deliberate:

- Limits are lower because WebAssembly memory is shared and 32-bit: 96 MiB for a
  Pivot source, 128 MiB for a native document, a 160 MiB cache (the desktop
  allows 128, 256 and 384 MiB).
- One request runs at a time. Python cannot be interrupted, so cancelling the
  running import stops the interpreter and the next request starts a fresh one,
  which drops the imported-source cache exactly as restarting the desktop codec
  does; exporting a Pivot file imported before that asks to reopen it. If other
  jobs are waiting on the interpreter, the cancelled job is skipped instead, so
  nobody else's request is lost.
- There is no workspace: no sample listing and no opening by path.
- No native scanner or `orjson`; the standard-library paths the desktop also has
  as fallbacks are used.

## What works in the browser

| | Web |
| --- | --- |
| Editing, animating, drawing, timeline, undo, IK, effects | Same code as the desktop app |
| Rendering | WebGPU, or the Canvas 2D compatibility renderer |
| `.styk` / `.stkz` / `.stykmov` save and open | Yes (a download on save, the file dialog on open) |
| Pivot `.piv` / `.stk` import and export | Yes, in-browser codec; an unchanged import re-exports byte for byte |
| Stick Nodes import | Yes |
| PNG, SVG, GIF, APNG, PNG/JPEG/GIF/SVG sequences | Yes |
| WebM video | Yes, WebCodecs (opaque background) |
| MP4, AVI, WMV, installed Windows codecs | Desktop only, offered with a reason |
| Crash recovery | IndexedDB |
| Personal and public library | Desktop only |
| System fonts | Where the browser offers local fonts (Chromium); otherwise open a font file |
| Feedback, telemetry, updates | Not present |

`tests/web-build.browser.mjs` runs the built site in a real browser, including
under Cloudflare's own runtime (`wrangler dev`), and covers boot and rendering,
native save and open, the Pivot export/reopen/re-export round trip, the PNG, SVG,
GIF, WebM and sequence exports, and the desktop-only formats being offered with a
reason. It fails on any console error, page error or CSP violation. Stick Nodes
import, crash recovery and local fonts use the same code as before in the browser
and are not part of that test.
