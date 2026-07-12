"""Frame-zero invariants for the First Bond organism."""
import json
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class _Parser(HTMLParser):
    """Strict-enough parser for the static shell smoke test."""


class FirstBondFrameZeroTests(unittest.TestCase):
    """Protect the evolutionary contract before creatures hatch."""

    def setUp(self):
        self.evolution = json.loads((ROOT / "evolution.json").read_text())
        self.html = (ROOT / "docs" / "index.html").read_text()

    def test_frame_contract(self):
        self.assertEqual(self.evolution["frame"], 0)
        self.assertEqual(self.evolution["target_frames"], 12)
        self.assertEqual(self.evolution["frames"], [])

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
        self.assertIn("No Rappter has passed the Icon Test yet", self.html)

    def test_site_exposes_all_twelve_frames(self):
        for frame in range(1, 13):
            self.assertIn(f'data-frame="{frame}"', self.html)


if __name__ == "__main__":
    unittest.main()

