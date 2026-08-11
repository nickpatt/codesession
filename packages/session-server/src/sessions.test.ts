/**
 * Lightweight tests for SessionStore membership + expiry logic.
 *
 * These use Node's built-in test runner (`node --test`) so we don't pull in a
 * heavyweight framework for Phase 1. Run with:  node --test dist/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionStore } from "./sessions.js";

test("create assigns a unique url-safe id and defaults to python", () => {
  const store = new SessionStore();
  const a = store.create();
  const b = store.create();
  assert.notEqual(a.info.id, b.info.id);
  assert.equal(a.info.language, "python");
  assert.match(a.info.id, /^[2-9a-hjkmnp-z]{10}$/); // no 0/1/l/o/i
});

test("connections keep a session alive; last leaver starts TTL", () => {
  const store = new SessionStore();
  const s = store.create();
  store.addConnection(s.info.id);
  store.addConnection(s.info.id);
  assert.equal(store.get(s.info.id)!.expiresAt, null);

  store.removeConnection(s.info.id, 1000);
  assert.equal(store.get(s.info.id)!.expiresAt, null); // one still connected

  store.removeConnection(s.info.id, 1000);
  assert.ok(store.get(s.info.id)!.expiresAt! > Date.now()); // now counting down
});

test("reconnecting cancels a pending expiry", () => {
  const store = new SessionStore();
  const s = store.create();
  store.addConnection(s.info.id);
  store.removeConnection(s.info.id, 1000);
  assert.notEqual(store.get(s.info.id)!.expiresAt, null);

  store.addConnection(s.info.id);
  assert.equal(store.get(s.info.id)!.expiresAt, null);
});

test("sweepExpired only reaps empty, past-TTL sessions", () => {
  const store = new SessionStore();
  const s = store.create();
  store.addConnection(s.info.id);
  store.removeConnection(s.info.id, -1); // already expired

  const reaped = store.sweepExpired();
  assert.deepEqual(reaped, [s.info.id]);
  assert.equal(store.has(s.info.id), false);
});
