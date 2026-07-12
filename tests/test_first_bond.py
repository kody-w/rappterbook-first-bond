"""Cross-frame invariants for the First Bond organism."""
import json
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class _Parser(HTMLParser):
    """Strict-enough parser for the static shell smoke test."""


class FirstBondFrameTests(unittest.TestCase):
    """Protect the evolutionary and iconicity contracts."""

    def setUp(self):
        self.evolution = json.loads((ROOT / "evolution.json").read_text())
        self.html = (ROOT / "docs" / "index.html").read_text()

    def test_frame_contract(self):
        self.assertEqual(self.evolution["frame"], 3)
        self.assertEqual(self.evolution["target_frames"], 12)
        self.assertEqual(len(self.evolution["frames"]), 3)
        self.assertEqual([frame["frame"] for frame in self.evolution["frames"]], [1, 2, 3])

    def test_iconicity_gate_is_complete(self):
        gate = self.evolution["iconicity_gate"]
        expected = {
            "silhouette_32px",
            "dominant_motif",
            "signature_color_count",
            "name_syllables",
            "ten_second_redraw",
            "personality_contradiction",
            "signature_gesture_or_sound",
            "evolution_identity_continuity",
            "no_generic_mashups",
            "non_derivative",
        }
        self.assertEqual(set(gate), expected)

    def test_static_site_parses(self):
        _Parser().feed(self.html)
        self.assertIn("<title>First Bond", self.html)
        self.assertIn("Marnu", self.html)
        self.assertIn("FRAME 03 / 12", self.html)
        self.assertIn('role="status"', self.html)

    def test_site_exposes_all_twelve_frames(self):
        for frame in range(1, 13):
            self.assertIn(f'data-frame="{frame}"', self.html)

    def test_one_candidate_creature_has_locked_identity(self):
        creature = self.evolution["starter_creature"]
        self.assertEqual(creature["name"], "Marnu")
        self.assertEqual(creature["status"], "unvalidated_prototype")
        self.assertEqual(len(creature["palette"]), 3)
        self.assertEqual(len(creature["evolution_anchors"]), 3)

    def test_every_frame_has_eight_ballots_and_three_mutations(self):
        for frame in self.evolution["frames"]:
            self.assertEqual(len(frame["ballots"]), 8)
            self.assertEqual(len(frame["selected_mutations"]), 3)

    def test_dependency_free_modules_are_present(self):
        for filename in ("creature.mjs", "bond-core.mjs", "bond-app.mjs"):
            self.assertTrue((ROOT / "docs" / filename).exists())

    def test_human_iconicity_evidence_is_not_faked(self):
        evidence = self.evolution["iconicity_evidence"]
        self.assertEqual(evidence["automated_structure"], "passed")
        for key in (
            "human_silhouette_recognition",
            "human_delayed_redraw",
            "human_character_over_logo",
            "human_franchise_recall",
        ):
            self.assertEqual(evidence[key], "pending")
        self.assertEqual(evidence["human_test_runner"], "available at docs/icon-lab.html")

    def test_frame_two_visual_truth_contracts_are_present(self):
        self.assertIn(".marnu-mark[hidden] { display: none; }", self.html)
        self.assertIn("UNVALIDATED PROTOTYPE", self.html)
        self.assertIn("Check one public signal", self.html)
        app = (ROOT / "docs" / "bond-app.mjs").read_text()
        self.assertIn("AbortController", app)
        self.assertIn("Already held.", app)

    def test_frame_three_runtime_truth_contracts_are_present(self):
        app = (ROOT / "docs" / "bond-app.mjs").read_text()
        core = (ROOT / "docs" / "bond-core.mjs").read_text()
        self.assertIn('mark.toggleAttribute("hidden"', app)
        self.assertIn("const controller = new AbortController()", app)
        self.assertIn("meaningful || presence || duplicate", core)
        self.assertNotIn("Meet the one<br>that knows you.", self.html)

    def test_unbranded_icon_lab_is_available(self):
        lab = (ROOT / "docs" / "icon-lab.html").read_text()
        self.assertIn("Silhouette Study 01", lab)
        self.assertNotIn("Marnu", lab)
        self.assertNotIn("First Bond", lab)
        for filename in ("icon-lab.mjs", "icon-study.mjs"):
            self.assertTrue((ROOT / "docs" / filename).exists())


if __name__ == "__main__":
    unittest.main()
