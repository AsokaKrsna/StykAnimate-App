import assert from 'node:assert/strict';
import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createFrame, emptyDocument} from '../src/demo.mjs';
import {documentChunks} from '../src/document-transport.mjs';
import {createPlaybackWorkerEndpoint} from '../src/playback-worker.mjs';
import {PlaybackCache} from '../src/playback.mjs';

function endpoint(t, options = {}) {
  const messages = [], waiters = new Set(), report = emptyDocument();
  report.keyframes = Array.from({length: 4}, () => createFrame());
  const receive = createPlaybackWorkerEndpoint(message => {
    messages.push(message);
    for (const check of [...waiters]) check();
  });
  const wait = predicate => new Promise((resolve, reject) => {
    const finish = () => {
      const found = messages.find(predicate);
      if (!found) return;
      clearTimeout(timer); waiters.delete(finish); resolve(found);
    };
    const timer = setTimeout(() => {waiters.delete(finish); reject(new Error('Worker response timed out.'));}, 2000);
    waiters.add(finish); finish();
  });
  const load = revision => receive({type: 'load', revision, report, acknowledgePackets: true, ...options});
  const ack = packet => receive({type: 'packet-ack', revision: packet.revision, deliveryId: packet.deliveryId});
  const packets = () => messages.filter(message => message.type === 'packet');
  t.after(() => receive({type: 'invalidate', revision: 100}));
  load(1);
  return {receive, wait, load, ack, packets, report};
}

test('worker waits for admission and applies retention before allocating the next packet', async t => {
  const worker = endpoint(t);
  worker.receive({type: 'prepare', revision: 1, ticks: [0, 1, 2]});
  const first = await worker.wait(message => message.type === 'packet');
  assert.equal(first.tick, 0); assert.ok(first.deliveryId);
  worker.receive({type: 'packet-ack', revision: 1, deliveryId: first.deliveryId + 1});
  worker.receive({type: 'packet-ack', revision: 2, deliveryId: first.deliveryId});
  await delay(25);
  assert.equal(worker.packets().length, 1, 'Wrong acknowledgements cannot release transferred ownership.');
  worker.receive({type: 'retain', revision: 1, ticks: [2]});
  worker.ack(first);
  const next = await worker.wait(message => message.type === 'packet' && message.tick === 2);
  assert.deepEqual(worker.packets().map(message => message.tick), [0, 2]);
  worker.ack(next);
});

for (const replacement of ['load', 'load-chunk', 'invalidate']) test(`${replacement} releases an obsolete delivery without accepting its late acknowledgement`, async t => {
  const worker = endpoint(t);
  worker.receive({type: 'prepare', revision: 1, ticks: [0, 1]});
  const old = await worker.wait(message => message.type === 'packet');
  if (replacement === 'load') worker.load(2);
  else if (replacement === 'load-chunk') {
    let sequence = 0;
    for (const chunk of documentChunks(worker.report)) worker.receive({type: 'load-chunk', revision: 2,
      sequence: sequence++, chunk, options: {acknowledgePackets: true}});
    worker.receive({type: 'load-complete', revision: 2, sequence});
  }
  else worker.receive({type: 'invalidate', revision: 2, retainDocument: true});
  worker.receive({type: 'prepare', revision: 2, ticks: [2, 3]});
  const current = await worker.wait(message => message.type === 'packet' && message.revision === 2);
  worker.ack(old);
  await delay(25);
  assert.deepEqual(worker.packets().map(message => [message.revision, message.tick]), [[1, 0], [2, 2]]);
  worker.ack(current);
  worker.ack(await worker.wait(message => message.type === 'packet' && message.tick === 3));
});

test('interaction suspension does not lose acknowledged work or resume preparation early', async t => {
  const worker = endpoint(t);
  worker.receive({type: 'prepare', revision: 1, ticks: [0, 1]});
  const first = await worker.wait(message => message.type === 'packet');
  worker.receive({type: 'interaction', active: true});
  worker.ack(first);
  await delay(25);
  assert.equal(worker.packets().length, 1);
  worker.receive({type: 'interaction', active: false});
  worker.ack(await worker.wait(message => message.type === 'packet' && message.tick === 1));
});

test('direct worker consumers can retain the unacknowledged protocol', async t => {
  const worker = endpoint(t, {acknowledgePackets: false});
  worker.receive({type: 'prepare', revision: 1, ticks: [0, 1]});
  await worker.wait(message => message.type === 'packet' && message.tick === 1);
  assert.deepEqual(worker.packets().map(message => message.deliveryId), [undefined, undefined]);
});

test('cache releases stale and unrequested packets before acknowledging and stops acknowledging after disposal', () => {
  const events = [], cache = new PlaybackCache({workerFactory: () => ({
    postMessage: message => events.push(message.type), addEventListener() {}, terminate() {},
  })});
  const deliver = revision => cache._receive({type: 'packet', revision, deliveryId: 1, tick: 0,
    packet: {compatibility: [{bitmap: {close() {events.push('close');}}}]}});
  try {
    deliver(-1); deliver(0);
    assert.deepEqual(events, ['close', 'packet-ack', 'close', 'packet-ack']);
    cache.dispose(); events.length = 0; deliver(0);
    assert.deepEqual(events, ['close']);
  } finally {cache.dispose();}
});

test('a worker pool partitions preparation, retention and acknowledgements by tick parity', async () => {
  const sent = [[], []], fakes = [0, 1].map(index => ({
    postMessage: message => sent[index].push(message), addEventListener() {}, terminate() {},
  }));
  let created = 0;
  const cache = new PlaybackCache({ workerCount: 2, workerFactory: () => fakes[created++] });
  try {
    cache.report = emptyDocument(); cache.totalTicks = 8; cache.revision = 3;
    // Fake workers never deliver; the returned promise settles at dispose.
    cache.prepareRange([0, 1, 2, 3, 4, 5]).catch(() => {});
    await Promise.resolve();
    assert.deepEqual(sent[0].find(m => m.type === 'prepare').ticks, [0, 2, 4]);
    assert.deepEqual(sent[1].find(m => m.type === 'prepare').ticks, [1, 3, 5]);
    sent[0].length = sent[1].length = 0;
    // A packet's ACK must return to the worker that produced it.
    cache._receive({type: 'packet', revision: 3, deliveryId: 7, tick: 1,
      packet: {tick: 1, byteLength: 64, compileMs: 0, compatibility: []}}, cache.workers[1]);
    assert.deepEqual(sent[0].map(m => m.type), []);
    assert.deepEqual(sent[1].map(m => m.type), ['packet-ack']);
    // Queue trimming filters each worker's retain list to its own parity.
    cache._prefetchRanks = new Map([[0, 0], [1, 1], [2, 2], [3, 3]]);
    cache._retainWorkerTicks([0, 3]);
    assert.deepEqual(sent[0].filter(m => m.type === 'retain').at(-1).ticks, [0]);
    assert.deepEqual(sent[1].filter(m => m.type === 'retain').at(-1).ticks, [3]);
    // Invalidate and interaction reach every worker.
    sent[0].length = sent[1].length = 0;
    cache.setInteractionActive(true); cache.setInteractionActive(false);
    assert.deepEqual(sent[0].map(m => m.type), ['interaction', 'interaction']);
    assert.deepEqual(sent[1].map(m => m.type), ['interaction', 'interaction']);
  } finally { cache.dispose(); }
});

test('cache finishes admission and queue trimming before acknowledging a packet', async () => {
  const events = [], cache = new PlaybackCache({workerFactory: () => ({
    postMessage: message => events.push(message.type), addEventListener() {}, terminate() {},
  }), onReady: () => events.push('ready')});
  cache.report = emptyDocument(); cache.totalTicks = 1;
  try {
    const pending = cache.prepareRange([0]); await Promise.resolve();
    const trim = cache._trimQueuedPrefetch.bind(cache);
    cache._trimQueuedPrefetch = () => {trim(); events.push('trim');};
    cache._receive({type: 'packet', revision: 0, deliveryId: 1, tick: 0,
      packet: {tick: 0, byteLength: 128, compileMs: 0, compatibility: []}});
    await pending;
    assert.ok(cache.has(0));
    assert.deepEqual(events.slice(-3), ['trim', 'ready', 'packet-ack']);
  } finally {cache.dispose();}
});
