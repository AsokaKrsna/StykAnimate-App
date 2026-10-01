import test from 'node:test';
import assert from 'node:assert/strict';
import {createWheelZoom, wheelZoomAmount} from '../src/canvas-wheel-zoom.mjs';

// The app's anchored zoom: the artwork under `point` stays under it.
function canvas(options = {}) {
  const page = {view: {x: 40, y: 30, scale: 1}, steps: []};
  page.zoomBy = (factor, point) => {
    const v = page.view, scale = Math.min(100, Math.max(0.001, v.scale * factor)), k = scale / v.scale;
    page.view = {...v, x: point.x - (point.x - v.x) * k, y: point.y - (point.y - v.y) * k, scale};
    page.steps.push(scale);
  };
  page.glide = createWheelZoom({getScale: () => page.view.scale, zoomBy: page.zoomBy, ...options});
  page.finish = (from = 0) => { let now = from, frames = 0; while (page.glide.advance(now += 16)) assert.ok(++frames < 200, 'the glide ends'); return frames; };
  return page;
}
const at = {x: 250, y: 200};
const under = (view, point = at) => ({x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale});

test('a wheel notch glides to its target in small steps, anchored at the pointer', () => {
  const page = canvas(), artwork = under(page.view), target = Math.exp(wheelZoomAmount(-100));
  page.glide.wheel(-100, at, 0);
  assert.equal(page.glide.active, true);
  assert.ok(page.view.scale > 1 && page.view.scale < 1 + (target - 1) / 2, 'the event itself moves the view, but only part of the way');
  const frames = page.finish();
  assert.ok(frames >= 4 && frames <= 20, `a notch takes a few frames, not one and not a second (${frames})`);
  assert.equal(page.glide.active, false);
  assert.ok(Math.abs(page.view.scale - target) < 1e-12, 'the glide lands exactly on the target');
  for (let i = 1; i < page.steps.length; i++) {
    assert.ok(page.steps[i] > page.steps[i - 1], 'the zoom never reverses');
    // The last step lands on the target: at most the settle threshold, too small to see.
    if (i > 1 && i < page.steps.length - 1) assert.ok(page.steps[i] - page.steps[i - 1] <= page.steps[i - 1] - page.steps[i - 2] + 1e-12, 'each step is no larger than the one before');
  }
  const now = under(page.view);
  assert.ok(Math.abs(now.x - artwork.x) < 1e-9 && Math.abs(now.y - artwork.y) < 1e-9);
  assert.equal(page.glide.advance(10_000), false, 'a finished glide does nothing');
});

test('notches during a glide add up, and a reversed notch turns the glide around', () => {
  const page = canvas();
  page.glide.wheel(-100, at, 0); page.glide.advance(16);
  page.glide.wheel(-100, at, 20); page.glide.advance(32);
  page.glide.wheel(-100, at, 40);
  page.finish(40);
  assert.ok(Math.abs(page.view.scale - Math.exp(3 * wheelZoomAmount(-100))) < 1e-9, 'no notch is lost');

  const back = canvas();
  back.glide.wheel(-100, at, 0); back.glide.advance(16);
  back.glide.wheel(100, at, 20); back.glide.wheel(100, at, 24);
  back.finish(24);
  assert.ok(Math.abs(back.view.scale - Math.exp(wheelZoomAmount(100))) < 1e-9);
});

test('continuous input and reduced motion zoom directly', () => {
  const page = canvas();
  page.glide.wheel(-4, at, 0);
  assert.equal(page.glide.active, false);
  assert.ok(Math.abs(page.view.scale - Math.exp(0.02)) < 1e-12, 'a trackpad pinch keeps its response');

  const still = canvas({reducedMotion: () => true});
  still.glide.wheel(-100, at, 0);
  assert.equal(still.glide.active, false);
  assert.ok(Math.abs(still.view.scale - Math.exp(wheelZoomAmount(-100))) < 1e-12);
});

test('continuous input coalesces one settled detail paint after the last event', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let paints=0;const page=canvas({onSettled:()=>paints++});
  page.glide.wheel(-4,at,0);
  assert.equal(page.glide.interacting,true);
  t.mock.timers.tick(80);
  page.glide.wheel(-4,at,80);
  t.mock.timers.tick(99);
  assert.equal(paints,0);
  assert.equal(page.glide.interacting,true);
  t.mock.timers.tick(1);
  assert.equal(page.glide.interacting,false);
  assert.equal(paints,1);
  t.mock.timers.tick(1000);
  assert.equal(paints,1);
});

test('settlement waits for the glide and cancellation releases pending input', t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let paints=0;const page=canvas({onSettled:()=>paints++});
  page.glide.wheel(-100,at,0);
  t.mock.timers.tick(100);
  assert.equal(page.glide.interacting,true);
  assert.equal(paints,0);
  page.finish(100);
  assert.equal(page.glide.interacting,false);
  assert.equal(paints,1);
  page.glide.wheel(-4,at,300);
  page.glide.cancel();
  assert.equal(page.glide.interacting,false);
  assert.equal(paints,2);
  t.mock.timers.tick(1000);
  page.glide.cancel();
  assert.equal(paints,2);
});

test('a larger wheel delta never zooms less', () => {
  for (let delta = 1; delta <= 400; delta++) {
    assert.ok(wheelZoomAmount(-delta) >= wheelZoomAmount(-(delta - 1)), `delta ${delta}`);
    assert.equal(wheelZoomAmount(delta), -wheelZoomAmount(-delta));
  }
});

test('the glide stops at the zoom limits and yields to another zoom or a cancel', () => {
  const page = canvas();
  page.glide.wheel(-1e6, at, 0); page.finish();
  assert.equal(page.view.scale, 100);
  page.glide.wheel(1e6, at, 0); page.finish();
  assert.equal(page.view.scale, 0.001);

  const fit = canvas();
  fit.glide.wheel(-100, at, 0); fit.glide.advance(16);
  fit.view = {x: 0, y: 0, scale: 0.5}; // Fit, a zoom button or a pinch
  assert.equal(fit.glide.advance(32), false);
  assert.deepEqual(fit.view, {x: 0, y: 0, scale: 0.5}, 'the other zoom is left alone');
  fit.glide.wheel(-100, at, 48); fit.finish(48);
  assert.ok(Math.abs(fit.view.scale - 0.5 * Math.exp(wheelZoomAmount(-100))) < 1e-9, 'the next notch starts from the new zoom');

  const press = canvas();
  press.glide.wheel(-100, at, 0); press.glide.advance(16);
  const held = press.view.scale;
  press.glide.cancel();
  assert.equal(press.glide.advance(32), false);
  assert.equal(press.view.scale, held);
});
