import test from "node:test";
import assert from "node:assert/strict";
import { MARNU, validateCreature } from "../docs/creature.mjs";
import {
  changeToEvent,
  classifyChange,
  decodeBond,
  encodeBond,
  initialBond,
  normalizeAgentId,
  projectBond,
  reduceBond,
  selectLatestAgentChange,
  serializeBond
} from "../docs/bond-core.mjs";

const change = {
  ts: "2026-07-12T03:00:00Z",
  type: "follow",
  id: "agent-a"
};

test("Marnu passes structural iconicity gates", () => {
  assert.deepEqual(validateCreature(MARNU), []);
  assert.equal(MARNU.palette.length, 3);
  assert.equal(MARNU.nameSyllables, 2);
  assert.equal(MARNU.evolutionAnchors.length, 3);
});

test("same trace produces same bond", () => {
  const event = changeToEvent(change, "agent-a", 1);
  assert.deepEqual(
    reduceBond(initialBond("agent-a"), event),
    reduceBond(initialBond("agent-a"), event)
  );
});

test("duplicate evidence is a complete no-op", () => {
  const event = changeToEvent(change, "agent-a", 1);
  const once = reduceBond(initialBond("agent-a"), event);
  assert.equal(reduceBond(once, event), once);
});

test("event gaps fail closed", () => {
  const event = changeToEvent(change, "agent-a", 2);
  assert.throws(() => reduceBond(initialBond("agent-a"), event), /event gap/);
});

test("behavior changes expression, never core identity", () => {
  const event = changeToEvent(change, "agent-a", 1);
  const view = projectBond(reduceBond(initialBond("agent-a"), event), MARNU);
  assert.equal(view.corePath, MARNU.corePath);
  assert.equal(view.pose, "assist");
  assert.equal(view.mark, "stitch");
});

test("persisted bond remains under one KiB", () => {
  const event = changeToEvent(change, "agent-a", 1);
  const encoded = serializeBond(reduceBond(initialBond("agent-a"), event));
  assert.ok(encoded.length < 1024);
});

test("heartbeat is neutral presence and earns no permanent mark", () => {
  const heartbeat = {
    ts: "2026-07-12T04:00:00Z",
    type: "heartbeat",
    id: "agent-a"
  };
  const state = reduceBond(
    initialBond("agent-a"),
    changeToEvent(heartbeat, "agent-a", 1)
  );
  assert.equal(state.lastKind, "presence");
  assert.equal(state.mark, null);
  assert.equal(state.behavior.recover, undefined);
});

test("unsupported events cannot mutate the bond", () => {
  const unsupported = { ts: "2026-07-12T04:00:00Z", type: "audit", id: "agent-a" };
  assert.equal(classifyChange(unsupported), null);
  assert.throws(
    () => changeToEvent(unsupported, "agent-a", 1),
    /supported sourced change/
  );
});

test("latest selection ignores wrong actor and unsupported types", () => {
  const selected = selectLatestAgentChange([
    { ts: "2026-07-12T05:00:00Z", type: "audit", id: "agent-a" },
    { ts: "2026-07-12T04:00:00Z", type: "follow", id: "other-agent" },
    { ts: "2026-07-12T03:00:00Z", type: "heartbeat", id: "Agent-A" }
  ], "@agent-a");
  assert.equal(selected.type, "heartbeat");
});

test("agent identity normalizes case and leading at", () => {
  assert.equal(normalizeAgentId("@Agent-A"), "agent-a");
  assert.equal(initialBond("@Agent-A").agentId, "agent-a");
});

test("twenty events with a maximum handle remain under one KiB", () => {
  const handle = `a${"b".repeat(127)}`;
  let state = initialBond(handle);
  for (let index = 1; index <= 20; index += 1) {
    state = reduceBond(state, changeToEvent({
      ts: `2026-07-12T${String(index).padStart(2, "0")}:00:00Z`,
      type: index % 2 ? "follow" : "heartbeat",
      id: handle
    }, handle, index));
  }
  assert.ok(new TextEncoder().encode(encodeBond(state)).byteLength <= 1024);
});

test("codec migrates schema one and rejects future versions", () => {
  const migrated = decodeBond(JSON.stringify({
    schema: 1,
    agentId: "Agent-A",
    lastSeq: 1,
    eventIds: ["old:event:agent-a"],
    behavior: { assist: 1, discover: 0, recover: 0 },
    mark: "stitch"
  }));
  assert.equal(migrated.issue, "migrated");
  assert.equal(migrated.state.agentId, "agent-a");
  assert.equal(migrated.state.mark, "stitch");
  assert.equal(decodeBond('{"schema":99}').issue, "future-version");
});

test("reducer copies evidence instead of retaining caller object", () => {
  const event = changeToEvent(change, "agent-a", 1);
  const state = reduceBond(initialBond("agent-a"), event);
  assert.notEqual(state.evidence, event.evidence);
  assert.equal(state.evidence.fingerprint, event.evidence.fingerprint);
});

test("first earned mark survives later presence", () => {
  const first = reduceBond(
    initialBond("agent-a"),
    changeToEvent(change, "agent-a", 1)
  );
  const heartbeat = changeToEvent({
    ts: "2026-07-12T06:00:00Z",
    type: "heartbeat",
    id: "agent-a"
  }, "agent-a", 2);
  const next = reduceBond(first, heartbeat);
  assert.equal(next.firstMark, "stitch");
  assert.equal(next.mark, "stitch");
});
