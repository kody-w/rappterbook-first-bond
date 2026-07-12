const KINDS = Object.freeze(["assist", "discover", "presence"]);
const MARKS = Object.freeze({
  assist: "stitch",
  discover: "notch",
  presence: null
});
const SOURCE_URL = "https://github.com/kody-w/rappterbook/blob/main/state/changes.json";

export function normalizeAgentId(raw) {
  const value = String(raw || "").trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9][a-z0-9._:@/-]{0,127}$/.test(value) ? value : null;
}

export function fingerprint(text) {
  let hash = 0x811c9dc5;
  for (const character of String(text)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function initialBond(agentId = "") {
  return {
    schema: 2,
    creatureId: "marnu-v1",
    agentId: normalizeAgentId(agentId) || "",
    lastSeq: 0,
    seen: [],
    behavior: { assist: 0, discover: 0, presence: 0 },
    lastKind: null,
    mark: null,
    firstMark: null,
    evidence: null
  };
}

export function classifyChange(change) {
  const type = String(change?.type || "").toLowerCase();
  if (["follow", "poke", "recruit", "karma_transfer"].includes(type)) return "assist";
  if (["new_agent", "new_channel", "new_topic", "profile_update"].includes(type)) return "discover";
  if (["heartbeat", "heartbeat_batch"].includes(type)) return "presence";
  return null;
}

function actorFor(change) {
  return normalizeAgentId(change?.id || change?.agent_id || change?.author);
}

export function selectLatestAgentChange(changes, rawAgentId) {
  const agentId = normalizeAgentId(rawAgentId);
  if (!agentId || !Array.isArray(changes)) return null;
  let selected = null;
  for (const change of changes.slice(0, 2048)) {
    if (actorFor(change) !== agentId || !classifyChange(change) || !change?.ts) continue;
    if (!selected || String(change.ts) > String(selected.ts)) selected = change;
    if (
      selected
      && String(change.ts) === String(selected.ts)
      && String(change.type) < String(selected.type)
    ) {
      selected = change;
    }
  }
  return selected;
}

export function changeToEvent(change, rawAgentId, seq) {
  const agentId = normalizeAgentId(rawAgentId);
  const kind = classifyChange(change);
  if (!agentId || !kind || !change?.ts || !change?.type) {
    throw new TypeError("supported sourced change required");
  }
  const sourceKey = `${change.ts}|${change.type}|${agentId}`;
  return {
    schema: 1,
    id: fingerprint(sourceKey),
    seq,
    kind,
    evidence: Object.freeze({
      type: String(change.type),
      timestamp: String(change.ts),
      fingerprint: fingerprint(sourceKey),
      sourceUrl: SOURCE_URL
    })
  };
}

export function reduceBond(state, event) {
  if (!KINDS.includes(event?.kind)) throw new TypeError("unknown event kind");
  if (!Number.isInteger(event.seq) || event.seq < 1) throw new TypeError("invalid event sequence");
  if (state.seen.includes(event.id)) return state;
  if (event.seq !== state.lastSeq + 1) throw new RangeError("event gap");
  const behavior = { ...state.behavior };
  behavior[event.kind] += 1;
  const earnedMark = MARKS[event.kind];
  return {
    ...state,
    lastSeq: event.seq,
    seen: [...state.seen.slice(-19), event.id],
    behavior,
    lastKind: event.kind,
    mark: earnedMark || state.mark,
    firstMark: state.firstMark || earnedMark,
    evidence: { ...event.evidence }
  };
}

export function projectBond(state, definition) {
  const evidence = state.evidence;
  const label = evidence
    ? `${evidence.type} at ${evidence.timestamp}`
    : "no sourced signal yet";
  return {
    name: definition.name,
    corePath: definition.corePath,
    segment: definition.segment,
    pose: state.lastKind || "rest",
    mark: state.mark,
    firstMark: state.firstMark,
    receipt: evidence
      ? `${definition.name} held public evidence: ${label}.`
      : `${definition.name} is waiting for a supported public signal.`,
    sourceUrl: evidence?.sourceUrl || null,
    fingerprint: evidence?.fingerprint || null
  };
}

function migrateV1(record) {
  const next = initialBond(record.agentId);
  next.lastSeq = Number.isInteger(record.lastSeq) ? record.lastSeq : 0;
  next.seen = Array.isArray(record.eventIds)
    ? record.eventIds.slice(-20).map(fingerprint)
    : [];
  next.behavior = {
    assist: Number(record.behavior?.assist) || 0,
    discover: Number(record.behavior?.discover) || 0,
    presence: 0
  };
  next.lastKind = KINDS.includes(record.lastKind) ? record.lastKind : null;
  next.mark = ["stitch", "notch"].includes(record.mark) ? record.mark : null;
  next.firstMark = next.mark;
  return next;
}

export function decodeBond(raw) {
  if (!raw) return { state: initialBond(), issue: "empty" };
  try {
    const record = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (record?.schema === 1) return { state: migrateV1(record), issue: "migrated" };
    if (record?.schema !== 2) return { state: initialBond(), issue: "future-version" };
    const state = initialBond(record.agentId);
    state.lastSeq = Number.isInteger(record.lastSeq) ? record.lastSeq : 0;
    state.seen = Array.isArray(record.seen)
      ? record.seen.filter(value => /^[0-9a-f]{8}$/.test(value)).slice(-20)
      : [];
    state.behavior = {
      assist: Math.max(0, Number(record.behavior?.assist) || 0),
      discover: Math.max(0, Number(record.behavior?.discover) || 0),
      presence: Math.max(0, Number(record.behavior?.presence) || 0)
    };
    state.lastKind = KINDS.includes(record.lastKind) ? record.lastKind : null;
    state.mark = ["stitch", "notch"].includes(record.mark) ? record.mark : null;
    state.firstMark = ["stitch", "notch"].includes(record.firstMark)
      ? record.firstMark
      : state.mark;
    if (record.evidence && typeof record.evidence === "object") {
      state.evidence = {
        type: String(record.evidence.type || ""),
        timestamp: String(record.evidence.timestamp || ""),
        fingerprint: String(record.evidence.fingerprint || ""),
        sourceUrl: SOURCE_URL
      };
    }
    return { state, issue: "ok" };
  } catch {
    return { state: initialBond(), issue: "corrupt" };
  }
}

export function encodeBond(state) {
  const encoded = JSON.stringify(state);
  if (new TextEncoder().encode(encoded).byteLength > 1024) {
    throw new RangeError("bond state exceeds 1 KiB");
  }
  return encoded;
}

export const serializeBond = encodeBond;
