const KINDS = Object.freeze(["assist", "discover", "recover"]);
const MARKS = Object.freeze({
  assist: "stitch",
  discover: "notch",
  recover: "brace"
});

export function initialBond(agentId = "") {
  return {
    schema: 1,
    creatureId: "marnu-v1",
    agentId,
    lastSeq: 0,
    eventIds: [],
    behavior: { assist: 0, discover: 0, recover: 0 },
    lastKind: null,
    mark: null,
    evidence: null
  };
}

export function classifyChange(change) {
  const type = String(change?.type || "").toLowerCase();
  if (["follow", "poke", "recruit", "karma_transfer"].includes(type)) return "assist";
  if (["new_agent", "new_channel", "new_topic", "profile_update"].includes(type)) return "discover";
  return "recover";
}

export function changeToEvent(change, agentId, seq) {
  if (!change || !change.ts || !change.type) throw new TypeError("change evidence required");
  const kind = classifyChange(change);
  return {
    schema: 1,
    id: `${change.ts}:${change.type}:${agentId}`,
    seq,
    kind,
    amount: 1,
    evidence: {
      type: String(change.type),
      timestamp: String(change.ts),
      agentId
    }
  };
}

export function reduceBond(state, event) {
  if (!KINDS.includes(event?.kind)) throw new TypeError("unknown event kind");
  if (!Number.isInteger(event.seq) || event.seq < 1) throw new TypeError("invalid event sequence");
  if (state.eventIds.includes(event.id)) return state;
  if (event.seq !== state.lastSeq + 1) throw new RangeError("event gap");
  const behavior = { ...state.behavior };
  behavior[event.kind] += event.amount;
  return {
    ...state,
    lastSeq: event.seq,
    eventIds: [...state.eventIds.slice(-19), event.id],
    behavior,
    lastKind: event.kind,
    mark: MARKS[event.kind],
    evidence: event.evidence
  };
}

export function projectBond(state, definition) {
  return {
    name: definition.name,
    corePath: definition.corePath,
    segment: definition.segment,
    pose: state.lastKind || "rest",
    mark: state.mark,
    receipt: state.evidence
      ? `${definition.name} noticed ${state.evidence.type} at ${state.evidence.timestamp}.`
      : `${definition.name} is listening for a real signal.`
  };
}

export function serializeBond(state) {
  const encoded = JSON.stringify(state);
  if (encoded.length > 1024) throw new RangeError("bond state exceeds 1 KiB");
  return encoded;
}
