import { MARNU, validateCreature } from "./creature.mjs";
import {
  changeToEvent,
  decodeBond,
  encodeBond,
  initialBond,
  normalizeAgentId,
  projectBond,
  reduceBond,
  selectLatestAgentChange,
  waitBond
} from "./bond-core.mjs";

const STORAGE_KEY = "first-bond:marnu:v1";
const CHANGES_URL = "https://raw.githubusercontent.com/kody-w/rappterbook/main/state/changes.json";
const FEED_TTL_MS = 300_000;
const FEED_MAX_BYTES = 262_144;
const MARK_PATHS = Object.freeze({
  stitch: "M13 15H16V16H13Z",
  notch: "M14 14H15V17H14Z"
});

const form = document.querySelector("#bond-form");
const input = document.querySelector("#agent-handle");
const status = document.querySelector("#bond-status");
const receipt = document.querySelector("#bond-receipt");
const receiptText = document.querySelector("#bond-receipt-text");
const receiptSource = document.querySelector("#bond-receipt-source");
const firstReceipt = document.querySelector("#bond-first-receipt");
const candidate = document.querySelector("#bond-candidate");
const candidateText = document.querySelector("#bond-candidate-text");
const keepButton = document.querySelector("#keep-proof");
const waitButton = document.querySelector("#wait-proof");
const clearButton = document.querySelector("#clear-bond");
const marnuButton = document.querySelector("#marnu-button");
const mark = document.querySelector("#marnu-mark");
const submitButton = form.querySelector('button[type="submit"]');
const startLink = document.querySelector(".start-link");
let memoryState = initialBond();
let requestController = null;
let requestGeneration = 0;
let gestureTimer = null;
let feedCache = null;
let storageWritable = true;
let pendingEvent = null;
let pendingBase = null;

function loadBond() {
  try {
    const decoded = decodeBond(localStorage.getItem(STORAGE_KEY));
    memoryState = decoded.state;
    storageWritable = decoded.writable;
    if (decoded.needsRewrite) {
      try {
        localStorage.setItem(STORAGE_KEY, encodeBond(memoryState));
      } catch {
        storageWritable = false;
      }
    }
    return decoded;
  } catch {
    memoryState = initialBond();
    storageWritable = false;
    return {
      state: memoryState,
      issue: "storage-unavailable",
      writable: false,
      needsRewrite: false
    };
  }
}

function saveBond(state) {
  memoryState = state;
  if (!storageWritable) return false;
  try {
    localStorage.setItem(STORAGE_KEY, encodeBond(state));
    return true;
  } catch {
    return false;
  }
}

function render(state) {
  const view = projectBond(state, MARNU);
  marnuButton.dataset.pose = view.pose;
  marnuButton.setAttribute(
    "aria-label",
    `${MARNU.name}. ${MARNU.contradiction} Pose: ${view.pose}. First mark: ${view.firstMark || "none"}. Play Almost-Goodbye.`
  );
  mark.toggleAttribute("hidden", !view.mark);
  mark.dataset.mark = view.mark || "";
  if (view.mark) mark.setAttribute("d", MARK_PATHS[view.mark]);
  receiptText.textContent = view.receipt;
  receipt.hidden = !state.evidence;
  receiptSource.hidden = !view.sourceUrl;
  receiptSource.href = view.sourceUrl || "#";
  receiptSource.textContent = view.fingerprint
    ? `View current mutable feed [receipt ${view.fingerprint}] (opens new tab)`
    : "View current mutable feed (opens new tab)";
  firstReceipt.textContent = view.firstReceipt || "";
  firstReceipt.hidden = !view.firstReceipt;
  if (state.agentId) input.value = state.agentId;
}

function clearCandidate() {
  pendingEvent = null;
  pendingBase = null;
  candidate.hidden = true;
  candidateText.textContent = "";
}

function showCandidate(event, base) {
  pendingEvent = event;
  pendingBase = base;
  candidateText.textContent = [
    `Public ${event.evidence.type}`,
    event.evidence.timestamp,
    `event key ${event.evidence.fingerprint}`
  ].join(" · ");
  candidate.hidden = false;
  keepButton.focus();
}

function playGesture(announce = true) {
  clearTimeout(gestureTimer);
  marnuButton.classList.remove("is-gesturing");
  requestAnimationFrame(() => marnuButton.classList.add("is-gesturing"));
  gestureTimer = setTimeout(() => {
    marnuButton.classList.remove("is-gesturing");
  }, 760);
  if (announce) status.textContent = "Almost-Goodbye: away, hesitation, return. tik-tik.";
}

async function loadFeed(signal) {
  if (feedCache && feedCache.expiresAt > Date.now()) return feedCache.changes;
  const response = await fetch(CHANGES_URL, {
    cache: "default",
    referrerPolicy: "no-referrer",
    signal
  });
  if (!response.ok) throw new Error(`source returned ${response.status}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > FEED_MAX_BYTES) throw new Error("source exceeded the byte limit");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > FEED_MAX_BYTES) {
    throw new Error("source exceeded the byte limit");
  }
  const data = JSON.parse(text);
  if (!Array.isArray(data.changes)) throw new TypeError("source shape is invalid");
  const changes = data.changes;
  feedCache = { changes, expiresAt: Date.now() + FEED_TTL_MS };
  return changes;
}

async function latestChange(agentId, signal) {
  const context = memoryState.agentId === agentId
    ? memoryState
    : initialBond(agentId);
  return selectLatestAgentChange(await loadFeed(signal), agentId, context);
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const agentId = normalizeAgentId(input.value);
  if (!agentId) {
    input.setAttribute("aria-invalid", "true");
    input.focus();
    status.textContent = "Use a valid public agent handle: letters, numbers, dot, dash, underscore, colon, slash, or @.";
    return;
  }
  input.removeAttribute("aria-invalid");
  clearCandidate();
  requestController?.abort();
  const controller = new AbortController();
  requestController = controller;
  const generation = ++requestGeneration;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 8_000);
  submitButton.setAttribute("aria-busy", "true");
  submitButton.disabled = true;
  status.textContent = "Marnu is checking the bounded public signal feed...";
  try {
    const change = await latestChange(agentId, controller.signal);
    if (generation !== requestGeneration) return;
    if (!change) {
      status.textContent = `No supported recent public behavior was found for ${agentId}. Marnu invented nothing.`;
      return;
    }
    const current = memoryState.agentId === agentId
      ? memoryState
      : initialBond(agentId);
    const bondEvent = changeToEvent(change, agentId, current.lastSeq + 1);
    if (bondEvent.kind !== "presence" && !current.seen.includes(bondEvent.id)) {
      showCandidate(bondEvent, current);
      status.textContent = "New supported evidence found. Choose whether Marnu keeps a mark or leaves it unmarked.";
      return;
    }
    const next = reduceBond(current, bondEvent);
    if (next === current) {
      render(current);
      status.textContent = `Already held. ${MARNU.name} found no newer supported evidence.`;
      return;
    }
    const persisted = saveBond(next);
    render(next);
    if (bondEvent.kind === "presence") {
      status.textContent = "PRESENCE ONLY · NO MARK KEPT · no gesture played.";
    } else {
      status.textContent = persisted
        ? `${MARNU.name} kept one sourced signal on this device.`
        : `${MARNU.name} kept the signal for this visit; storage is unavailable.`;
    }
    if (bondEvent.kind !== "presence") playGesture(false);
  } catch (error) {
    if (generation !== requestGeneration) return;
    if (timedOut) {
      status.textContent = "The public signal check timed out. Nothing changed.";
    } else if (error?.name === "AbortError") {
      status.textContent = "The public signal check was cancelled. Nothing changed.";
    } else {
      status.textContent = `Marnu could not verify a signal: ${error?.message || "unknown source error"}`;
    }
  } finally {
    clearTimeout(timeout);
    if (generation === requestGeneration) {
      submitButton.removeAttribute("aria-busy");
      submitButton.disabled = false;
    }
  }
});

keepButton.addEventListener("click", () => {
  if (!pendingEvent || !pendingBase) return;
  const next = reduceBond(pendingBase, pendingEvent);
  const persisted = saveBond(next);
  render(next);
  clearCandidate();
  status.textContent = persisted
    ? "KEEP · one public record became a local mark on this browser."
    : "KEEP · mark held for this visit; browser storage is unavailable.";
  playGesture(false);
});

waitButton.addEventListener("click", () => {
  if (!pendingEvent || !pendingBase) return;
  const next = waitBond(pendingBase, pendingEvent);
  const persisted = saveBond(next);
  render(next);
  clearCandidate();
  status.textContent = persisted
    ? "WAIT · evidence acknowledged and left unmarked on this browser."
    : "WAIT · evidence left unmarked for this visit; browser storage is unavailable.";
});

input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
startLink.addEventListener("click", () => setTimeout(() => input.focus(), 0));

marnuButton.addEventListener("click", () => playGesture(true));
marnuButton.addEventListener("animationend", () => {
  clearTimeout(gestureTimer);
  marnuButton.classList.remove("is-gesturing");
});

clearButton.addEventListener("click", () => {
  requestGeneration += 1;
  requestController?.abort("clear");
  clearCandidate();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // In-memory state is still cleared.
  }
  memoryState = initialBond();
  storageWritable = true;
  input.value = "";
  submitButton.removeAttribute("aria-busy");
  submitButton.disabled = false;
  render(memoryState);
  status.textContent = "This device's bond memory was cleared.";
});

if (validateCreature(MARNU).length) {
  throw new Error("Marnu failed the structural iconicity manifest");
}
const loaded = loadBond();
render(loaded.state);
if (loaded.issue === "future-version" || loaded.issue === "corrupt") {
  status.textContent = "Stored memory uses an unreadable or newer format. Clear it explicitly before bonding again.";
} else {
  status.textContent = loaded.state.evidence
    ? `${MARNU.name} remembers one public signal on this device. Check for something newer when ready.`
    : `${MARNU.name} is waiting for a supported public signal.`;
}
