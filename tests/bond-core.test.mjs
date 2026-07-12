import test from "node:test";
import assert from "node:assert/strict";
import { MARNU, validateCreature } from "../docs/creature.mjs";
import {
  changeToEvent,
  initialBond,
  projectBond,
  reduceBond,
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
