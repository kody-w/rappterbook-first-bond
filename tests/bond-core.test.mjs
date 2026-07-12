import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  MARNU,
  MARNU_IDENTITY_SHA256,
  canonicalIdentity,
  validateCreature
} from "../docs/creature.mjs";
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
  serializeBond,
  waitBond
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

test("Marnu identity fingerprint locks every canonical anchor", () => {
  const digest = createHash("sha256")
    .update(canonicalIdentity(MARNU))
    .digest("hex");
  assert.equal(digest, MARNU_IDENTITY_SHA256);
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
  assert.equal(state.lastKind, null);
  assert.equal(state.mark, null);
  assert.equal(state.evidence, null);
  assert.equal(state.presenceCursor.type, "heartbeat");
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
  const encoded = encodeBond(state);
  assert.ok(new TextEncoder().encode(encoded).byteLength <= 1024);
  assert.deepEqual(decodeBond(encoded).state, state);
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
  const future = decodeBond('{"schema":99}');
  assert.equal(future.issue, "future-version");
  assert.equal(future.writable, false);
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
  assert.deepEqual(next.firstMarkEvidence, first.firstMarkEvidence);
  assert.deepEqual(next.evidence, first.evidence);
  assert.equal(projectBond(next, MARNU).mark, "stitch");
});

test("real frame-one migration aliases the current event fingerprint", () => {
  const legacy = JSON.stringify({
    schema: 1,
    agentId: "agent-a",
    lastSeq: 1,
    eventIds: ["2026-07-12T03:00:00Z:follow:agent-a"],
    behavior: { assist: 1, discover: 0, recover: 0 },
    lastKind: "assist",
    mark: "stitch",
    evidence: {
      type: "follow",
      timestamp: "2026-07-12T03:00:00Z",
      agentId: "agent-a"
    }
  });
  const migrated = decodeBond(legacy);
  const event = changeToEvent(change, "agent-a", 2);
  assert.equal(migrated.issue, "migrated");
  assert.equal(migrated.needsRewrite, true);
  assert.equal(migrated.state.evidence.fingerprint, event.id);
  assert.equal(reduceBond(migrated.state, event), migrated.state);
});

test("feed selection scans beyond 2048 ascending entries", () => {
  const feed = Array.from({ length: 2049 }, (_, index) => ({
    ts: `2026-07-${String(1 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00Z`,
    type: "heartbeat",
    id: index === 2048 ? "agent-a" : "other"
  }));
  feed.push({
    ts: "2026-07-31T23:59:59Z",
    type: "follow",
    id: "agent-a"
  });
  assert.equal(selectLatestAgentChange(feed, "agent-a").type, "follow");
});

test("meaningful unseen evidence outranks newer presence", () => {
  const feed = [
    { ts: "2026-07-12T09:00:00Z", type: "follow", id: "agent-a" },
    { ts: "2026-07-12T10:00:00Z", type: "heartbeat", id: "agent-a" }
  ];
  assert.equal(selectLatestAgentChange(feed, "agent-a").type, "follow");
});

test("seen meaningful evidence falls through to unseen presence", () => {
  const meaningful = {
    ts: "2026-07-12T09:00:00Z",
    type: "follow",
    id: "agent-a"
  };
  const presence = {
    ts: "2026-07-12T10:00:00Z",
    type: "heartbeat",
    id: "agent-a"
  };
  const seen = [changeToEvent(meaningful, "agent-a", 1).id];
  assert.equal(
    selectLatestAgentChange([meaningful, presence], "agent-a", seen).type,
    "heartbeat"
  );
});

test("invalid timestamps are ignored", () => {
  assert.equal(selectLatestAgentChange([
    { ts: "not-a-date", type: "follow", id: "agent-a" }
  ], "agent-a"), null);
});

test("legacy migration canonicalizes every parseable event ID", () => {
  const legacy = decodeBond(JSON.stringify({
    schema: 1,
    agentId: "agent-a",
    lastSeq: 2,
    eventIds: [
      "2026-07-12T03:00:00Z:follow:agent-a",
      "2026-07-12T04:00:00Z:heartbeat:agent-a"
    ],
    behavior: { assist: 1, discover: 0, recover: 1 }
  }));
  const follow = changeToEvent(change, "agent-a", 3);
  const heartbeat = changeToEvent({
    ts: "2026-07-12T04:00:00Z",
    type: "heartbeat",
    id: "agent-a"
  }, "agent-a", 3);
  assert.equal(legacy.state.seen.includes(follow.id), true);
  assert.equal(legacy.state.seen.includes(heartbeat.id), true);
});

test("wait decision consumes evidence without earning a mark", () => {
  const event = changeToEvent(change, "agent-a", 1);
  const waited = waitBond(initialBond("agent-a"), event);
  assert.equal(waited.mark, null);
  assert.equal(waited.firstMark, null);
  assert.equal(waited.evidence.disposition, "waited");
  assert.equal(waitBond(waited, event), waited);
});

test("keep and wait produce distinct persistent consequences", () => {
  const event = changeToEvent(change, "agent-a", 1);
  const kept = reduceBond(initialBond("agent-a"), event);
  const waited = waitBond(initialBond("agent-a"), event);
  assert.equal(kept.mark, "stitch");
  assert.equal(waited.mark, null);
  assert.notDeepEqual(kept, waited);
});

test("meaningful cursor rejects older unseen history", () => {
  const newer = {
    ts: "2026-07-12T10:00:00Z",
    type: "follow",
    id: "agent-a"
  };
  const older = {
    ts: "2026-07-12T09:00:00Z",
    type: "profile_update",
    id: "agent-a"
  };
  const state = reduceBond(
    initialBond("agent-a"),
    changeToEvent(newer, "agent-a", 1)
  );
  assert.equal(selectLatestAgentChange([older], "agent-a", state), null);
});

test("schema two migrates first mark evidence honestly", () => {
  const migrated = decodeBond(JSON.stringify({
    schema: 2,
    agentId: "agent-a",
    lastSeq: 1,
    seen: ["29e3b822"],
    behavior: { assist: 1, discover: 0, presence: 0 },
    lastKind: "assist",
    mark: "stitch",
    firstMark: "stitch",
    evidence: {
      type: "follow",
      timestamp: "2026-07-12T03:00:00Z",
      fingerprint: "29e3b822"
    }
  }));
  assert.equal(migrated.issue, "migrated");
  assert.equal(migrated.state.firstMarkEvidence.type, "follow");
  assert.equal(migrated.state.schema, 3);
});
