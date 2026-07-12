import test from "node:test";
import assert from "node:assert/strict";
import {
  ICON_STUDY_PROTOCOL,
  makeStudyResult,
  scoreStudyResult,
  validateStudyResult
} from "../docs/icon-study.mjs";

const input = {
  session: "session-1",
  silhouetteChoice: "held-gap",
  characterReading: "character",
  recalledAnchors: [
    "asymmetrical-loop",
    "lower-right-gap",
    "returning-square"
  ],
  franchiseRecall: "",
  completedAt: "2026-07-12T12:00:00Z"
};

test("protocol keeps human graduation thresholds explicit", () => {
  assert.equal(ICON_STUDY_PROTOCOL.thresholds.silhouetteMatch, 0.8);
  assert.equal(ICON_STUDY_PROTOCOL.thresholds.characterOverLogo, 0.7);
  assert.equal(ICON_STUDY_PROTOCOL.thresholds.maximumSingleFranchiseRecall, 0.1);
});

test("result export contains only allowlisted anonymous fields", () => {
  const result = makeStudyResult({ ...input, email: "forbidden@example.com" });
  assert.equal(validateStudyResult(result), true);
  assert.equal("email" in result, false);
  assert.deepEqual(Object.keys(result).sort(), [
    "characterReading",
    "completedAt",
    "franchiseRecall",
    "protocol",
    "recalledAnchors",
    "session",
    "silhouetteChoice"
  ]);
});

test("individual score never claims aggregate validation", () => {
  const score = scoreStudyResult(makeStudyResult(input));
  assert.equal(score.silhouetteMatch, true);
  assert.equal(score.characterOverLogo, true);
  assert.equal(score.anchorRecall, 1);
  assert.equal("validated" in score, false);
});

test("invalid and extra result fields fail closed", () => {
  assert.equal(validateStudyResult({ ...makeStudyResult(input), identity: "x" }), false);
  assert.equal(validateStudyResult({}), false);
});
