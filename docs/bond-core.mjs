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
    schema: 3,
    creatureId: "marnu-v1",
    agentId: normalizeAgentId(agentId) || "",
    lastSeq: 0,
    seen: [],
    behavior: { assist: 0, discover: 0, presence: 0 },
    lastKind: null,
    mark: null,
    firstMark: null,
    evidence: null,
    firstMarkEvidence: null,
    meaningfulCursor: null,
    presenceCursor: null
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

function sourceDiscriminator(change) {
  return [
    change?.target,
    change?.slug,
    change?.discussion,
    change?.submission,
    change?.name
  ].filter(Boolean).join("|");
}

export function sourceFingerprint(change, rawAgentId) {
  const agentId = normalizeAgentId(rawAgentId);
  if (!agentId || !change?.ts || !change?.type) return null;
  return fingerprint(
    `${change.ts}|${change.type}|${agentId}|${sourceDiscriminator(change)}`
  );
}

function cursorFor(change, agentId) {
  return {
    timestamp: String(change.ts),
    type: String(change.type),
    fingerprint: sourceFingerprint(change, agentId)
  };
}

function compareCursor(left, right) {
  if (!right) return 1;
  const leftTime = Date.parse(left.timestamp);
  const rightTime = Date.parse(right.timestamp);
  if (leftTime !== rightTime) return leftTime > rightTime ? 1 : -1;
  const leftKey = `${left.type}|${left.fingerprint}`;
  const rightKey = `${right.type}|${right.fingerprint}`;
  return leftKey === rightKey ? 0 : leftKey > rightKey ? 1 : -1;
}

function stateSelectionContext(stateOrSeen) {
  if (Array.isArray(stateOrSeen)) {
    return {
      seen: stateOrSeen,
      meaningfulCursor: null,
      presenceCursor: null
    };
  }
  return stateOrSeen || initialBond();
}

export function selectLatestAgentChange(changes, rawAgentId, stateOrSeen = []) {
  const agentId = normalizeAgentId(rawAgentId);
  if (!agentId || !Array.isArray(changes)) return null;
  if (changes.length > 4096) throw new RangeError("feed entry limit exceeded");
  const context = stateSelectionContext(stateOrSeen);
  const seen = new Set(context.seen || []);
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
    const cursor = cursorFor(change, agentId);
    if (seen.has(id)) {
      if (!duplicate || compareCursor(cursor, cursorFor(duplicate, agentId)) > 0) {
        duplicate = change;
      }
    } else if (kind === "presence") {
      if (
        compareCursor(cursor, context.presenceCursor) > 0
        && (!presence || compareCursor(cursor, cursorFor(presence, agentId)) > 0)
      ) presence = change;
    } else if (
      compareCursor(cursor, context.meaningfulCursor) > 0
      && (!meaningful || compareCursor(cursor, cursorFor(meaningful, agentId)) > 0)
    ) {
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
    cursor: cursorFor(change, agentId),
    evidence: Object.freeze({
      type: String(change.type),
      timestamp: String(change.ts),
      fingerprint: eventId,
      sourceUrl: SOURCE_URL,
      disposition: "pending"
    })
  };
}

function canApply(state, event) {
  if (!KINDS.includes(event?.kind)) throw new TypeError("unknown event kind");
  if (!Number.isInteger(event.seq) || event.seq < 1) throw new TypeError("invalid event sequence");
  if (state.seen.includes(event.id)) return false;
  if (event.seq !== state.lastSeq + 1) throw new RangeError("event gap");
  const current = event.kind === "presence"
    ? state.presenceCursor
    : state.meaningfulCursor;
  return compareCursor(event.cursor, current) > 0;
}

function appendSeen(state, event) {
  return [...state.seen.slice(-19), event.id];
}

export function reduceBond(state, event) {
  if (!canApply(state, event)) return state;
  const behavior = { ...state.behavior };
  behavior[event.kind] += 1;
  if (event.kind === "presence") {
    return {
      ...state,
      lastSeq: event.seq,
      seen: appendSeen(state, event),
      behavior,
      presenceCursor: event.cursor
    };
  }
  const earnedMark = MARKS[event.kind];
  const keptEvidence = { ...event.evidence, disposition: "kept" };
  return {
    ...state,
    lastSeq: event.seq,
    seen: appendSeen(state, event),
    behavior,
    lastKind: event.kind,
    mark: earnedMark || state.mark,
    firstMark: state.firstMark || earnedMark,
    evidence: keptEvidence,
    firstMarkEvidence: state.firstMarkEvidence || keptEvidence,
    meaningfulCursor: event.cursor
  };
}

export function waitBond(state, event) {
  if (event.kind === "presence") return reduceBond(state, event);
  if (!canApply(state, event)) return state;
  return {
    ...state,
    lastSeq: event.seq,
    seen: appendSeen(state, event),
    evidence: { ...event.evidence, disposition: "waited" },
    meaningfulCursor: event.cursor
  };
}

export function projectBond(state, definition) {
  const evidence = state.evidence;
  const first = state.firstMarkEvidence;
  const label = evidence
    ? `${evidence.type} at ${evidence.timestamp}`
    : "no sourced signal yet";
  const verb = evidence?.disposition === "waited" ? "left unmarked" : "kept";
  return {
    name: definition.name,
    corePath: definition.corePath,
    segment: definition.segment,
    pose: state.lastKind || "rest",
    mark: state.firstMark || state.mark,
    firstMark: state.firstMark,
    receipt: evidence
      ? `Public evidence for ${state.agentId}: ${label}; ${verb}.`
      : `No supported public signal is stored for ${state.agentId || "this browser"}.`,
    firstReceipt: first
      ? `First mark: ${first.type} at ${first.timestamp} [${first.fingerprint}].`
      : null,
    sourceUrl: evidence?.sourceUrl || null,
    fingerprint: evidence?.fingerprint || null
  };
}

function migrateV1(record) {
  const next = initialBond(record.agentId);
  next.lastSeq = Number.isInteger(record.lastSeq) ? record.lastSeq : 0;
  const migratedIds = [];
  for (const legacyId of Array.isArray(record.eventIds) ? record.eventIds : []) {
    const match = String(legacyId).match(/^(.+Z):([^:]+):(.+)$/);
    if (match) {
      migratedIds.push(sourceFingerprint(
        { ts: match[1], type: match[2] },
        match[3]
      ));
    } else {
      migratedIds.push(fingerprint(legacyId));
    }
  }
  next.seen = [...new Set(migratedIds)].slice(-20);
  next.behavior = {
    assist: Number(record.behavior?.assist) || 0,
    discover: Number(record.behavior?.discover) || 0,
    presence: 0
  };
  next.lastKind = KINDS.includes(record.lastKind) ? record.lastKind : null;
  next.mark = ["stitch", "notch"].includes(record.mark) ? record.mark : null;
  next.firstMark = next.mark;
  if (record.evidence && record.evidence.type && record.evidence.timestamp) {
    const legacyChange = {
      timestamp: record.evidence.timestamp,
      ts: record.evidence.timestamp,
      type: record.evidence.type
    };
    const currentId = sourceFingerprint(legacyChange, next.agentId);
    next.seen = [...new Set([...next.seen, currentId])].slice(-20);
    next.evidence = {
      type: String(record.evidence.type),
      timestamp: String(record.evidence.timestamp),
      fingerprint: currentId,
      sourceUrl: SOURCE_URL,
      disposition: "kept"
    };
    next.firstMarkEvidence = next.mark ? next.evidence : null;
    const kind = classifyChange(legacyChange);
    const cursor = cursorFor(legacyChange, next.agentId);
    if (kind === "presence") next.presenceCursor = cursor;
    else next.meaningfulCursor = cursor;
  }
  return next;
}

function migrateV2(record) {
  const next = initialBond(record.agentId);
  next.lastSeq = Number.isInteger(record.lastSeq) ? record.lastSeq : 0;
  next.seen = Array.isArray(record.seen)
    ? record.seen.filter(value => /^[0-9a-f]{8}$/.test(value)).slice(-20)
    : [];
  next.behavior = {
    assist: Math.max(0, Number(record.behavior?.assist) || 0),
    discover: Math.max(0, Number(record.behavior?.discover) || 0),
    presence: Math.max(0, Number(record.behavior?.presence) || 0)
  };
  next.lastKind = KINDS.includes(record.lastKind) ? record.lastKind : null;
  next.mark = ["stitch", "notch"].includes(record.mark) ? record.mark : null;
  next.firstMark = ["stitch", "notch"].includes(record.firstMark)
    ? record.firstMark
    : next.mark;
  if (record.evidence && record.evidence.type && record.evidence.timestamp) {
    const legacyChange = {
      ts: record.evidence.timestamp,
      type: record.evidence.type
    };
    next.evidence = {
      type: String(record.evidence.type),
      timestamp: String(record.evidence.timestamp),
      fingerprint: String(record.evidence.fingerprint || sourceFingerprint(legacyChange, next.agentId)),
      sourceUrl: SOURCE_URL,
      disposition: "kept"
    };
    next.firstMarkEvidence = next.firstMark ? next.evidence : null;
    const kind = classifyChange(legacyChange);
    const cursor = {
      timestamp: next.evidence.timestamp,
      type: next.evidence.type,
      fingerprint: next.evidence.fingerprint
    };
    if (kind === "presence") next.presenceCursor = cursor;
    else next.meaningfulCursor = cursor;
  }
  return next;
}

function validCursor(cursor) {
  return cursor === null || (
    typeof cursor === "object"
    && Number.isFinite(Date.parse(cursor.timestamp))
    && typeof cursor.type === "string"
    && /^[0-9a-f]{8}$/.test(cursor.fingerprint)
  );
}

function compactEvidence(evidence) {
  return evidence
    ? [
      evidence.type,
      evidence.timestamp,
      evidence.fingerprint,
      evidence.disposition
    ]
    : null;
}

function expandEvidence(value) {
  if (!Array.isArray(value) || value.length < 3) return null;
  return {
    type: String(value[0] || ""),
    timestamp: String(value[1] || ""),
    fingerprint: String(value[2] || ""),
    sourceUrl: SOURCE_URL,
    disposition: value[3] === "waited" ? "waited" : "kept"
  };
}

function compactCursor(cursor) {
  return cursor
    ? [cursor.timestamp, cursor.type, cursor.fingerprint]
    : null;
}

function expandCursor(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const cursor = {
    timestamp: String(value[0] || ""),
    type: String(value[1] || ""),
    fingerprint: String(value[2] || "")
  };
  return validCursor(cursor) ? cursor : null;
}

function decodeCompact(record) {
  const state = initialBond(record.a);
  state.lastSeq = Number.isInteger(record.q) ? record.q : 0;
  state.seen = Array.isArray(record.i)
    ? record.i.filter(value => /^[0-9a-f]{8}$/.test(value)).slice(-20)
    : [];
  state.behavior = {
    assist: Math.max(0, Number(record.b?.[0]) || 0),
    discover: Math.max(0, Number(record.b?.[1]) || 0),
    presence: Math.max(0, Number(record.b?.[2]) || 0)
  };
  state.lastKind = KINDS.includes(record.k) ? record.k : null;
  state.mark = ["stitch", "notch"].includes(record.m) ? record.m : null;
  state.firstMark = ["stitch", "notch"].includes(record.f)
    ? record.f
    : state.mark;
  state.evidence = expandEvidence(record.e);
  state.firstMarkEvidence = expandEvidence(record.x);
  state.meaningfulCursor = expandCursor(record.u);
  state.presenceCursor = expandCursor(record.p);
  return state;
}

export function decodeBond(raw) {
  if (!raw) return {
    state: initialBond(), issue: "empty", writable: true, needsRewrite: false
  };
  try {
    const record = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (record?.s === 3) return {
      state: decodeCompact(record), issue: "ok", writable: true, needsRewrite: false
    };
    if (record?.schema === 1) return {
      state: migrateV1(record), issue: "migrated", writable: true, needsRewrite: true
    };
    if (record?.schema === 2) return {
      state: migrateV2(record), issue: "migrated", writable: true, needsRewrite: true
    };
    if (record?.schema !== 3) return {
      state: initialBond(), issue: "future-version", writable: false, needsRewrite: false
    };
    const state = migrateV2(record);
    state.schema = 3;
    state.meaningfulCursor = validCursor(record.meaningfulCursor)
      ? record.meaningfulCursor
      : state.meaningfulCursor;
    state.presenceCursor = validCursor(record.presenceCursor)
      ? record.presenceCursor
      : state.presenceCursor;
    if (record.firstMarkEvidence && typeof record.firstMarkEvidence === "object") {
      state.firstMarkEvidence = {
        type: String(record.firstMarkEvidence.type || ""),
        timestamp: String(record.firstMarkEvidence.timestamp || ""),
        fingerprint: String(record.firstMarkEvidence.fingerprint || ""),
        sourceUrl: SOURCE_URL,
        disposition: "kept"
      };
    }
    return { state, issue: "migrated", writable: true, needsRewrite: true };
  } catch {
    return {
      state: initialBond(), issue: "corrupt", writable: false, needsRewrite: false
    };
  }
}

export function encodeBond(state) {
  const encoded = JSON.stringify({
    s: 3,
    c: state.creatureId,
    a: state.agentId,
    q: state.lastSeq,
    i: state.seen,
    b: [
      state.behavior.assist,
      state.behavior.discover,
      state.behavior.presence
    ],
    k: state.lastKind,
    m: state.mark,
    f: state.firstMark,
    e: compactEvidence(state.evidence),
    x: compactEvidence(state.firstMarkEvidence),
    u: compactCursor(state.meaningfulCursor),
    p: compactCursor(state.presenceCursor)
  });
  if (new TextEncoder().encode(encoded).byteLength > 1024) {
    throw new RangeError("bond state exceeds 1 KiB");
  }
  return encoded;
}

export const serializeBond = encodeBond;
