import assert from "node:assert/strict";
import { test } from "node:test";
import { observeReducedMotion } from "../src/reducedMotion.ts";

function nativeSetting() {
  let resolve, reject, listener;
  const initial = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const changes = [];
  let removed = false;
  const stop = observeReducedMotion(
    {
      isReduceMotionEnabled: () => initial,
      addEventListener: (event, callback) => {
        assert.equal(event, "reduceMotionChanged");
        listener = callback;
        return {
          remove: () => {
            removed = true;
          },
        };
      },
    },
    (value) => changes.push(value),
  );
  return {
    changes,
    resolve,
    reject,
    emit: (value) => listener(value),
    stop,
    removed: () => removed,
  };
}

test("motion stays paused until the initial setting is known", async () => {
  const setting = nativeSetting();
  assert.deepEqual(setting.changes, []);
  setting.resolve(false);
  await Promise.resolve();
  assert.deepEqual(setting.changes, [false]);
  setting.emit(true);
  assert.deepEqual(setting.changes, [false, true]);
  setting.stop();
});

test("a newer accessibility event wins over a delayed initial read", async () => {
  const setting = nativeSetting();
  setting.emit(true);
  setting.resolve(false);
  await Promise.resolve();
  assert.deepEqual(setting.changes, [true]);
  setting.stop();
});

test("failed reads preserve pausing and later events still work", async () => {
  const setting = nativeSetting();
  setting.reject(new Error("native setting unavailable"));
  await Promise.resolve();
  assert.deepEqual(setting.changes, []);
  setting.emit(false);
  assert.deepEqual(setting.changes, [false]);
  setting.stop();
});

test("unmount removes the listener and ignores a pending read", async () => {
  const setting = nativeSetting();
  setting.stop();
  assert.equal(setting.removed(), true);
  setting.resolve(false);
  setting.emit(false);
  await Promise.resolve();
  assert.deepEqual(setting.changes, []);
});
