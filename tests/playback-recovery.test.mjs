import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { PlaybackCache } from '../src/playback.mjs';
import { createDemo } from '../src/demo.mjs';

// Real playback workers whose crash can be triggered from the test.
function crashableWorkers() {
  const created = [];
  const factory = () => {
    const worker = new Worker(new URL('./playback-node-worker.mjs', import.meta.url)), listeners = {};
    const client = {
      postMessage: (message, transfer) => worker.postMessage(message, transfer),
      terminate: () => worker.terminate(),
      addEventListener: (name, callback) => {
        (listeners[name] ??= []).push(callback);
        worker.on(name, value => callback(name === 'message' ? { data: value } : value));
      },
      crash: () => { worker.terminate(); for (const callback of listeners.error || []) callback({ message: 'simulated worker crash' }); },
    };
    created.push(client); return client;
  };
  return { factory, created };
}

test('a crashed playback worker is replaced on the next preparation request', async () => {
  const { factory, created } = crashableWorkers(), errors = [];
  const cache = new PlaybackCache({ workerFactory: factory, onError: error => errors.push(error) });
  try {
    cache.load(createDemo(), { revision: 1 });
    await cache.prepareRange([0]); assert.ok(cache.get(0));
    created.at(-1).crash();
    assert.match(cache.failure?.message, /simulated worker crash/); assert.equal(errors.length, 1);
    await cache.prepareRange([1]);
    assert.ok(cache.get(1), 'the replacement worker reloads the document and prepares frames');
    assert.equal(cache.failure, null); assert.equal(created.length, 2); assert.equal(cache.stats.workerRestarts, 1);
  } finally { cache.dispose(); }
});

test('consecutive crashes are bounded per document revision and an edit earns another attempt', async () => {
  const { factory, created } = crashableWorkers();
  const cache = new PlaybackCache({ workerFactory: factory });
  try {
    const report = createDemo();
    cache.load(report, { revision: 1 });
    created.at(-1).crash();
    // A scene that kills every fresh pool before it delivers a frame.
    for (let restart = 0; restart < 2; restart++) {
      const request = cache.prepareRange([0]);
      created.at(-1).crash();
      await assert.rejects(request);
    }
    await assert.rejects(cache.prepareRange([0]), /simulated worker crash/);
    await assert.rejects(cache.planLayerMigration({}), /simulated worker crash/);
    assert.equal(created.length, 3, 'the same revision does not spawn a fourth pool');
    cache.load(report, { revision: 2 });
    await cache.prepareRange([0]); assert.ok(cache.get(0));
    assert.equal(created.length, 4);
  } finally { cache.dispose(); }
});
