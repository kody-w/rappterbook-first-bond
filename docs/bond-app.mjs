import { MARNU, validateCreature } from "./creature.mjs";
import {
  changeToEvent,
  decodeBond,
  encodeBond,
  initialBond,
  normalizeAgentId,
  projectBond,
  reduceBond,
  selectLatestAgentChange
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
const clearButton = document.querySelector("#clear-bond");
const marnuButton = document.querySelector("#marnu-button");
const mark = document.querySelector("#marnu-mark");
let memoryState = initialBond();
let requestController = null;
let requestGeneration = 0;
let gestureTimer = null;
let feedCache = null;

function loadBond() {
  try {
    const decoded = decodeBond(localStorage.getItem(STORAGE_KEY));
    memoryState = decoded.state;
    return decoded;
  } catch {
    memoryState = initialBond();
    return { state: memoryState, issue: "storage-unavailable" };
  }
}

function saveBond(state) {
  memoryState = state;
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
    `${MARNU.name}. ${MARNU.contradiction} Pose: ${view.pose}. Play Almost-Goodbye.`
  );
  mark.hidden = !view.mark;
  mark.dataset.mark = view.mark || "";
  if (view.mark) mark.setAttribute("d", MARK_PATHS[view.mark]);
  receiptText.textContent = view.receipt;
  receipt.hidden = !state.evidence;
  receiptSource.hidden = !view.sourceUrl;
  receiptSource.href = view.sourceUrl || "#";
  receiptSource.textContent = view.fingerprint
    ? `View public source [${view.fingerprint}]`
    : "View public source";
  if (state.agentId) input.value = state.agentId;
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
  const changes = Array.isArray(data.changes) ? data.changes.slice(0, 2048) : [];
  feedCache = { changes, expiresAt: Date.now() + FEED_TTL_MS };
  return changes;
}

async function latestChange(agentId, signal) {
  return selectLatestAgentChange(await loadFeed(signal), agentId);
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
  requestController?.abort();
  requestController = new AbortController();
  const generation = ++requestGeneration;
  const timeout = setTimeout(() => requestController.abort("timeout"), 8_000);
  form.setAttribute("aria-busy", "true");
  form.querySelector("button").disabled = true;
  status.textContent = "Marnu is checking the bounded public signal feed...";
  try {
    const change = await latestChange(agentId, requestController.signal);
    if (generation !== requestGeneration) return;
    if (!change) {
      status.textContent = `No supported recent public behavior was found for ${agentId}. Marnu invented nothing.`;
      return;
    }
    const current = memoryState.agentId === agentId
      ? memoryState
      : initialBond(agentId);
    const next = reduceBond(
      current,
      changeToEvent(change, agentId, current.lastSeq + 1)
    );
    if (next === current) {
      render(current);
      status.textContent = `Already held. ${MARNU.name} found no newer supported evidence.`;
      return;
    }
    const persisted = saveBond(next);
    render(next);
    if (next.lastKind === "presence") {
      status.textContent = `${MARNU.name} noticed public presence. No permanent meaning or mark was invented.`;
    } else {
      status.textContent = persisted
        ? `${MARNU.name} kept one sourced signal on this device.`
        : `${MARNU.name} kept the signal for this visit; storage is unavailable.`;
    }
    playGesture(false);
  } catch (error) {
    if (generation !== requestGeneration) return;
    status.textContent = error.name === "AbortError"
      ? "The public signal check timed out or was cancelled. Nothing changed."
      : `Marnu could not verify a signal: ${error.message}`;
  } finally {
    clearTimeout(timeout);
    if (generation === requestGeneration) {
      form.removeAttribute("aria-busy");
      form.querySelector("button").disabled = false;
    }
  }
});

marnuButton.addEventListener("click", () => playGesture(true));
marnuButton.addEventListener("animationend", () => {
  clearTimeout(gestureTimer);
  marnuButton.classList.remove("is-gesturing");
});

clearButton.addEventListener("click", () => {
  requestGeneration += 1;
  requestController?.abort("clear");
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // In-memory state is still cleared.
  }
  memoryState = initialBond();
  input.value = "";
  form.removeAttribute("aria-busy");
  form.querySelector("button").disabled = false;
  render(memoryState);
  status.textContent = "This device's bond memory was cleared.";
});

if (validateCreature(MARNU).length) {
  throw new Error("Marnu failed the structural iconicity manifest");
}
const loaded = loadBond();
render(loaded.state);
status.textContent = loaded.state.evidence
  ? `${MARNU.name} remembers one public signal on this device. Check for something newer when ready.`
  : `${MARNU.name} is waiting for a supported public signal.`;
