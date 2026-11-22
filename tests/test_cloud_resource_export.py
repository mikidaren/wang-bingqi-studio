"""Checks the private-input/public-output boundary with synthetic source data."""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlsplit


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export-cloud-resources.py"
spec = importlib.util.spec_from_file_location("cloud_resource_export", SCRIPT)
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)

CHECKED = "2026-11-22T20:55:21Z"
PRIVATE_MARKER = "SYNTHETIC_PRIVATE_VALUE_DO_NOT_PUBLISH"


def inputs():
    benefits = {
        "updated": "2026-11-23",
        "items": [
            {"id": "kaggle-gpu", "status": "claimed", "date": "2026-11-11", "proofLevel": "runtime"},
            {"id": "neon-free", "status": "pending", "date": "2026-11-23", "proofLevel": "user-reported"},
            {"id": "cloudflare-d1", "status": "claimed", "date": "2026-11-23", "proofLevel": "user-reported"},
            {"id": "instabox-free", "status": "claimed", "date": "2026-11-21", "proofLevel": "user-screenshot"},
            {"id": "cloudflare-quick-tunnel", "status": "claimed", "date": "2026-11-10", "proofLevel": "runtime"},
            {"id": "github-actions-compute", "status": "claimed", "date": "2026-11-11", "proofLevel": "runtime"},
            {"id": "firecrawl-free", "status": "claimed", "date": "2026-11-23", "proofLevel": "runtime"},
            {"id": "not-claimed", "status": "candidate", "date": "2026-11-10", "proofLevel": "public-only"},
        ],
    }
    acquisition = {
        "kaggle-gpu": "owned", "neon-free": "registered", "cloudflare-d1": "owned",
        "instabox-free": "owned", "cloudflare-quick-tunnel": "historical",
        "github-actions-compute": "blocked", "firecrawl-free": "owned", "not-claimed": "unclaimed",
    }
    catalog = {"items": [{"id": key, "acquisition": value} for key, value in acquisition.items()]}
    usage = {"items": [{
        "id": "firecrawl-free", "source": "connected_plugin", "auth": "accepted",
        "status": "observed", "checkedAtUtc": "2026-11-22T17:52:03Z",
        "metrics": [{"key": "credits", "limit": 1000, "remaining": 1025, "used": None}],
    }]}
    return benefits, catalog, usage


class PublicExportTests(unittest.TestCase):
    def run_export(self, documents=None):
        return exporter.export_resources(*(documents or inputs()), source_checked_at=CHECKED)

    def test_private_free_text_and_nested_fields_never_leave_the_projection(self):
        documents = inputs()
        for document in documents:
            document["privateAccount"] = {"email": PRIVATE_MARKER, "credentials": [PRIVATE_MARKER]}
            for item in document["items"]:
                for field in ("name", "value", "description", "nextAction", "proof", "proofUrl", "issueUrl",
                              "officialUrl", "consoleUrl", "consoleLabel", "note", "quota", "reason",
                              "accountId", "instanceName", "apiKey"):
                    item[field] = PRIVATE_MARKER
                item["extra"] = {"nested": [PRIVATE_MARKER]}
                for metric in item.get("metrics", []):
                    metric["label"] = PRIVATE_MARKER
                    metric["unit"] = PRIVATE_MARKER
        result = self.run_export(documents)
        self.assertNotIn(PRIVATE_MARKER, json.dumps(result))
        self.assertEqual(result["summary"], {"claimed": 6, "registered": 1, "total": 7})
        allowed = {"id", "provider", "name", "category", "initials", "accent", "summary", "officialUrl",
                   "configuration", "claimStatus", "claimLabel", "recordedAt", "evidenceType", "evidenceLabel",
                   "availability", "availabilityLabel", "quota", "consoleUrl", "consoleLabel"}
        for resource in result["resources"]:
            self.assertLessEqual(set(resource), allowed)
            self.assertEqual(set(resource["configuration"][0]), {"label", "value"})

    def test_registered_and_indirect_evidence_do_not_become_running_resources(self):
        cards = {item["id"]: item for item in self.run_export()["resources"]}
        self.assertEqual(cards["neon-free"]["claimStatus"], "registered")
        self.assertEqual(cards["neon-free"]["claimLabel"], "待接入")
        self.assertEqual(cards["neon-free"]["availability"], "awaiting-setup")
        self.assertEqual(cards["cloudflare-d1"]["availability"], "unverified")
        self.assertEqual(cards["instabox-free"]["availability"], "unverified")
        self.assertEqual(cards["cloudflare-quick-tunnel"]["availability"], "historical")
        self.assertEqual(cards["github-actions-compute"]["availability"], "restricted")
        self.assertNotIn("not-claimed", cards)

    def test_console_links_use_reviewed_generic_entries_without_private_identifiers(self):
        for resource_id, (url, label) in exporter.CONSOLES.items():
            self.assertIn(resource_id, exporter.DISPLAY)
            parsed = urlsplit(url)
            self.assertEqual(parsed.scheme, "https")
            self.assertIsNone(parsed.username)
            self.assertIsNone(parsed.password)
            self.assertFalse(parsed.query or parsed.fragment)
            self.assertNotIn("mikidaren", url)
            self.assertNotIn("aiagentuse", url)
            self.assertTrue(label)
        self.assertEqual(exporter.CONSOLES["instabox-free"][0], "https://dashboard.instabox.sh")
        self.assertEqual(exporter.CONSOLES["browserbase-free"][0], "https://www.browserbase.com/overview")
        self.assertNotIn("cloudflare-quick-tunnel", exporter.CONSOLES)
        cards = {item["id"]: item for item in self.run_export()["resources"]}
        self.assertNotIn("consoleUrl", cards["cloudflare-quick-tunnel"])
        self.assertEqual(cards["instabox-free"]["consoleLabel"], "打开控制台")

    def test_usage_retains_its_original_time_and_does_not_invent_consumption(self):
        result = self.run_export()
        quota = next(item["quota"] for item in result["resources"] if item["id"] == "firecrawl-free")
        self.assertEqual(quota["value"], "1,025 credits")
        self.assertEqual(quota["checkedAt"], "2026-11-22T17:52:03Z")
        self.assertNotEqual(quota["checkedAt"], result["sourceCheckedAt"])
        self.assertIn("非当前余额", quota["note"])
        self.assertIn("额外额度来源未核实", quota["note"])
        self.assertEqual(set(quota), {"label", "value", "checkedAt", "note"})

    def test_failed_auth_and_non_numeric_values_cannot_create_a_quota(self):
        for mutation in ({"auth": "rejected"}, {"status": "unavailable"}, {"source": PRIVATE_MARKER}):
            documents = inputs()
            documents[2]["items"][0].update(mutation)
            card = next(item for item in self.run_export(documents)["resources"] if item["id"] == "firecrawl-free")
            self.assertNotIn("quota", card)
        for remaining in (PRIVATE_MARKER, True, -1, float("inf"), float("nan")):
            documents = inputs()
            documents[2]["items"][0]["metrics"][0]["remaining"] = remaining
            card = next(item for item in self.run_export(documents)["resources"] if item["id"] == "firecrawl-free")
            self.assertNotIn("quota", card)

    def test_unreviewed_claims_and_conflicting_inputs_fail_without_echoing_source(self):
        documents = inputs()
        documents[0]["items"][-1].update(id=PRIVATE_MARKER, status="claimed")
        documents[1]["items"][-1].update(id=PRIVATE_MARKER, acquisition="owned")
        with self.assertRaises(exporter.ExportError) as error:
            self.run_export(documents)
        self.assertNotIn(PRIVATE_MARKER, str(error.exception))
        documents = inputs()
        documents[1]["items"][0]["acquisition"] = "registered"
        with self.assertRaises(exporter.ExportError):
            self.run_export(documents)

    def test_dates_and_observation_times_are_validated_not_copied(self):
        for value in (PRIVATE_MARKER, "2026-02-30", "2026-11-23\n" + PRIVATE_MARKER):
            documents = inputs()
            documents[0]["items"][0]["date"] = value
            with self.assertRaises(exporter.ExportError) as error:
                self.run_export(documents)
            self.assertNotIn(PRIVATE_MARKER, str(error.exception))
        documents = inputs()
        documents[2]["items"][0]["checkedAtUtc"] = PRIVATE_MARKER
        with self.assertRaises(exporter.ExportError):
            self.run_export(documents)

    def test_cli_preserves_sources_and_failure_does_not_replace_existing_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = []
            for filename, document in zip(("benefits", "catalog", "usage"), inputs()):
                path = root / (filename + ".json")
                path.write_text(json.dumps(document), encoding="utf-8")
                paths.append(path)
            original_sources = [path.read_bytes() for path in paths]
            output = root / "public.json"
            command = [sys.executable, str(SCRIPT), "--benefits", str(paths[0]), "--catalog", str(paths[1]),
                       "--usage", str(paths[2]), "--output", str(output), "--source-checked-at", CHECKED]
            result = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual([path.read_bytes() for path in paths], original_sources)
            before = output.read_bytes()
            paths[0].write_text('{"items": ' + PRIVATE_MARKER, encoding="utf-8")
            result = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(output.read_bytes(), before)
            self.assertNotIn(PRIVATE_MARKER, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
