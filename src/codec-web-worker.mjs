/** Worker shell around the in-browser Pivot codec (see codec-web-engine.mjs).
 *
 * The page connects one MessagePort per job. Requests from every port join one
 * queue: the interpreter is single-threaded, so exactly one runs at a time, the
 * same admission the desktop codec applies to heavy requests. Between requests
 * the loop yields, so 'skip' and 'release' messages that arrived while Python
 * was busy take effect before the next request starts.
 *
 * Messages from the page:  connect {jobId, port} | skip {jobId} | release {jobId}
 * Messages to the page:    status {state, stage?, message?} | busy {jobId} | idle
 */
import {createCodecEngine} from './codec-web-engine.mjs';

// The web build places the runtime and the Python sources beside the app.
const RUNTIME = new URL('../vendor/pyodide/', import.meta.url);
const BUNDLE = new URL('../python/codec-bundle.json', import.meta.url);

const engine = createCodecEngine({
  onStatus: status => self.postMessage({type: 'status', ...status}),
  async loadRuntime() {
    const {loadPyodide} = await import(new URL('pyodide.mjs', RUNTIME).href);
    return loadPyodide({indexURL: RUNTIME.href});
  },
  async loadBundle() {
    const response = await fetch(BUNDLE);
    if (!response.ok) throw new Error(`the codec sources are unavailable (${response.status})`);
    return response.json();
  },
});

const ports = new Map();
const skipped = new Set();
const queue = [];
let running = false;

function attach(jobId, port) {
  if (!ports.has(jobId)) ports.set(jobId, new Set());
  ports.get(jobId).add(port);
  port.onmessage = ({data}) => { queue.push({jobId, port, request: data}); void pump(); };
}

function reply(port, id, {status, headers, body}) {
  try { port.postMessage({id, status, headers, body: body.buffer}, [body.buffer]); }
  catch { /* The job released this port while the request ran. */ }
}

const yieldToEvents = () => new Promise(resolve => setTimeout(resolve, 0));

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      await yieldToEvents();
      const {jobId, port, request} = queue.shift();
      if (skipped.has(jobId)) {
        const body = new TextEncoder().encode(JSON.stringify({ok: false, error: 'The operation was cancelled.', code: 'cancelled'}));
        reply(port, request.id, {status: 499, headers: {'Content-Type': 'application/json; charset=utf-8'}, body});
        continue;
      }
      self.postMessage({type: 'busy', jobId});
      const result = await engine.handle({method: request.method, path: request.path, headers: request.headers, body: request.body});
      self.postMessage({type: 'idle'});
      reply(port, request.id, result);
    }
  } finally { running = false; }
}

self.addEventListener('message', ({data}) => {
  if (data?.type === 'connect') attach(data.jobId, data.port);
  else if (data?.type === 'skip') skipped.add(data.jobId);
  else if (data?.type === 'release') {
    for (const port of ports.get(data.jobId) ?? []) port.close();
    ports.delete(data.jobId);
    skipped.delete(data.jobId);
  }
});
