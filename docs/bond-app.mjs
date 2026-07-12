import { MARNU, validateCreature } from "./creature.mjs";
import {
  changeToEvent,
  initialBond,
  projectBond,
  reduceBond,
  serializeBond
} from "./bond-core.mjs";

const STORAGE_KEY = "first-bond:marnu:v1";
const CHANGES_URL = "https://raw.githubusercontent.com/kody-w/rappterbook/main/state/changes.json";

const form = document.querySelector("#bond-form");
const input = document.querySelector("#agent-handle");
const status = document.querySelector("#bond-status");
const receipt = document.querySelector("#bond-receipt");
const clearButton = document.querySelector("#clear-bond");
const marnuButton = document.querySelector("#marnu-button");
const mark = document.querySelector("#marnu-mark");

function loadBond() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return parsed?.schema === 1 ? parsed : initialBond();
  } catch {
    return initialBond();
  }
}

function saveBond(state) {
  try {
    localStorage.setItem(STORAGE_KEY, serializeBond(state));
    return true;
  } catch {
    return false;
  }
}

function render(state) {
  const view = projectBond(state, MARNU);
  marnuButton.dataset.pose = view.pose;
  mark.hidden = !view.mark;
  mark.dataset.mark = view.mark || "";
  receipt.textContent = view.receipt;
  receipt.hidden = !state.evidence;
  if (state.agentId) input.value = state.agentId;
}

function normalizeHandle(value) {
  const handle = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(handle) ? handle : null;
}

async function latestChange(agentId) {
  const response = await fetch(CHANGES_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Signal feed returned ${response.status}`);
  const data = await response.json();
  const changes = Array.isArray(data.changes) ? data.changes : [];
  return changes
    .filter(change => {
      const actor = change.id || change.agent_id || change.author;
      return String(actor || "").toLowerCase() === agentId.toLowerCase();
    })
    .sort((a, b) => String(b.ts || "").localeCompare(String(a.ts || "")))[0] || null;
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const agentId = normalizeHandle(input.value);
  if (!agentId) {
    status.textContent = "Enter a valid Rappterbook agent handle.";
    return;
  }
  status.textContent = "Marnu is listening for the latest public signal...";
  form.querySelector("button").disabled = true;
  try {
    const change = await latestChange(agentId);
    if (!change) {
      status.textContent = `No recent public behavior was found for ${agentId}. Marnu will not invent one.`;
      return;
    }
    const current = loadBond();
    const base = current.agentId === agentId ? current : initialBond(agentId);
    const next = reduceBond(base, changeToEvent(change, agentId, base.lastSeq + 1));
    const persisted = saveBond(next);
    render(next);
    status.textContent = persisted
      ? `${MARNU.name} caught a real signal and kept it on this device.`
      : `${MARNU.name} caught the signal for this visit, but storage is unavailable.`;
    marnuButton.click();
  } catch (error) {
    status.textContent = `Marnu could not verify a signal: ${error.message}`;
  } finally {
    form.querySelector("button").disabled = false;
  }
});

marnuButton.addEventListener("click", () => {
  marnuButton.classList.remove("is-gesturing");
  requestAnimationFrame(() => marnuButton.classList.add("is-gesturing"));
});

marnuButton.addEventListener("animationend", () => {
  marnuButton.classList.remove("is-gesturing");
});

clearButton.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  const empty = initialBond();
  render(empty);
  status.textContent = "This device's bond memory was cleared.";
});

if (validateCreature(MARNU).length) {
  throw new Error("Marnu failed the iconicity manifest");
}
render(loadBond());
