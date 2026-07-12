export const MARNU = Object.freeze({
  schema: 1,
  id: "marnu-v1",
  name: "Marnu",
  pronunciation: "MAR-noo",
  nameSyllables: 2,
  dominantMotif: "held gap",
  contradiction: "Acts self-contained, yet keeps every kindness.",
  signatureGesture: "Almost-Goodbye",
  signatureSound: "tik-tik",
  palette: Object.freeze(["#4A3566", "#FF715B", "#DFFF73"]),
  viewBox: "0 0 32 32",
  corePath: "M8 3H15V8H11V21C11 24 13 26 16 26C20 26 22 24 22 20V10H18V3H26V21C26 27 22 30 16 30C9 30 6 27 6 21V7C6 5 7 4 8 3Z",
  segment: Object.freeze({ x: 23, y: 22, width: 6, height: 6 }),
  evolutionAnchors: Object.freeze([
    "asymmetrical loop",
    "lower-right held gap",
    "square returning segment"
  ])
});

export function canonicalIdentity(definition) {
  return [
    definition.id,
    definition.name,
    definition.viewBox,
    definition.corePath,
    `${definition.segment.x},${definition.segment.y},${definition.segment.width},${definition.segment.height}`,
    definition.palette.join(","),
    definition.dominantMotif,
    definition.contradiction,
    definition.signatureGesture,
    definition.signatureSound,
    definition.evolutionAnchors.join(",")
  ].join("|");
}

export const MARNU_IDENTITY_SHA256 = "bed1929861c141f18d92c00880e47a583e5ef03b7fc121d405eb1878c4721fb3";

export function validateCreature(definition) {
  const errors = [];
  if (!/^[A-Za-z]{4,8}$/.test(definition.name)) errors.push("name");
  if (![2, 3].includes(definition.nameSyllables)) errors.push("syllables");
  if (definition.palette.length < 2 || definition.palette.length > 3) errors.push("palette");
  if (new Set(definition.palette).size !== definition.palette.length) errors.push("palette-unique");
  if (definition.viewBox !== "0 0 32 32") errors.push("silhouette-grid");
  if (!definition.corePath || definition.corePath.length > 300) errors.push("core-path");
  if (!definition.dominantMotif) errors.push("motif");
  if (!definition.contradiction) errors.push("contradiction");
  if (!definition.signatureGesture || !definition.signatureSound) errors.push("signal");
  if (definition.evolutionAnchors.length !== 3) errors.push("evolution-anchors");
  return errors;
}
