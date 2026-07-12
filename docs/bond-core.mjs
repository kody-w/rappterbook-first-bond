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

export function sourceFingerprint(change, rawAgentId) {
  const agentId = normalizeAgentId(rawAgentId);
  if (!agentId || !change?.ts || !change?.type) return null;
  return fingerprint(`${change.ts}|${change.type}|${agentId}`);
}

function isNewer(candidate, current) {
  if (!current) return true;
  const candidateTime = Date.parse(candidate.ts);
  const currentTime = Date.parse(current.ts);
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  return String(candidate.type) < String(current.type);
}

export function selectLatestAgentChange(changes, rawAgentId, seen = []) {
  const agentId = normalizeAgentId(rawAgentId);
  if (!agentId || !Array.isArray(changes)) return null;
  if (changes.length > 4096) throw new RangeError("feed entry limit exceeded");
  const seenSet = new Set(seen);
  let meaningful = null;
  let presence = null;
  let duplicate = null;
  for (const change of changes) {
    const kind = classifyChange(change);
    if (
      actorFor(change) !== agentId
      || !kind
      || !Number.isFinite(Date.parse(change?.ts))
    ) continue;
    const id = sourceFingerprint(change, agentId);
    if (seenSet.has(id)) {
      if (isNewer(change, duplicate)) duplicate = change;
    } else if (kind === "presence") {
      if (isNewer(change, presence)) presence = change;
    } else if (isNewer(change, meaningful)) {
      meaningful = change;
    }
  }
  return meaningful || presence || duplicate;
}

export function changeToEvent(change, rawAgentId, seq) {
  const agentId = normalizeAgentId(rawAgentId);
  const kind = classifyChange(change);
  if (!agentId || !kind || !change?.ts || !change?.type) {
    throw new TypeError("supported sourced change required");
  }
  const eventId = sourceFingerprint(change, agentId);
  return {
    schema: 1,
    id: eventId,
    seq,
    kind,
    evidence: Object.freeze({
      type: String(change.type),
      timestamp: String(change.ts),
      fingerprint: eventId,
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
    mark: state.firstMark || state.mark,
    firstMark: state.firstMark,
    receipt: evidence
      ? `Public evidence for ${state.agentId}: ${label}.`
      : `No supported public signal is stored for ${state.agentId || "this device"}.`,
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
  if (record.evidence && record.evidence.type && record.evidence.timestamp) {
    const currentId = fingerprint(
      `${record.evidence.timestamp}|${record.evidence.type}|${next.agentId}`
    );
    next.seen = [...new Set([...next.seen, currentId])].slice(-20);
    next.evidence = {
      type: String(record.evidence.type),
      timestamp: String(record.evidence.timestamp),
      fingerprint: currentId,
      sourceUrl: SOURCE_URL
    };
  }
  return next;
}

export function decodeBond(raw) {
  if (!raw) return {
    state: initialBond(), issue: "empty", writable: true, needsRewrite: false
  };
  try {
    const record = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (record?.schema === 1) return {
      state: migrateV1(record), issue: "migrated", writable: true, needsRewrite: true
    };
    if (record?.schema !== 2) return {
      state: initialBond(), issue: "future-version", writable: false, needsRewrite: false
    };
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
    return { state, issue: "ok", writable: true, needsRewrite: false };
  } catch {
    return {
      state: initialBond(), issue: "corrupt", writable: false, needsRewrite: false
    };
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
