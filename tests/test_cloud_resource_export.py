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
        "metrics": [{"key": "credits", "unit": "credits", "limit": 1000,
                     "remaining": 1025, "used": None,
                     "resetAtUtc": "2026-12-08T09:02:09.578Z"}],
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
                   "availability", "availabilityLabel", "quota", "consoleUrl", "consoleLabel",
                   "metrics", "usageStatus"}
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


class VisualMetricTests(unittest.TestCase):
    def resource(self, resource_id="firecrawl-free", documents=None):
        result = exporter.export_resources(*(documents or inputs()), source_checked_at=CHECKED)
        return next(item for item in result["resources"] if item["id"] == resource_id)

    def observed(self, resource_id, metrics, **overrides):
        documents = inputs()
        if not any(item["id"] == resource_id for item in documents[0]["items"]):
            documents[0]["items"].append({"id": resource_id, "status": "pending",
                                         "date": "2026-11-23", "proofLevel": "user-reported"})
            documents[1]["items"].append({"id": resource_id, "acquisition": "registered"})
        snapshot = {"id": resource_id, "source": "provider_api", "auth": "accepted",
                    "status": "observed", "checkedAtUtc": "2026-11-22T17:52:03Z",
                    "metrics": metrics, **overrides}
        documents[2]["items"] = [snapshot]
        return documents

    def metric(self, card, key):
        matches = [metric for metric in card.get("metrics", []) if metric["key"] == key]
        self.assertEqual(len(matches), 1, "A reviewed visual metric must be present exactly once")
        return matches[0]

    def test_hardware_capacity_is_distinct_from_unobserved_utilization(self):
        card = self.resource("instabox-free")
        self.assertEqual([m["kind"] for m in card.get("metrics", [])],
                         ["cpu", "memory", "storage", "gpu"])
        self.assertEqual(card["usageStatus"], "unknown")
        for key, value, unit in (("cpu", 4, "vCPU"), ("memory", 8, "GiB"),
                                 ("storage", 20, "GiB")):
            metric = self.metric(card, key)
            self.assertEqual((metric["value"], metric["unit"]), (value, unit))
            self.assertEqual((metric["mode"], metric["basis"]), ("capacity", "recorded-config"))
            self.assertFalse({"used", "percent", "remaining"} & set(metric))
        self.assertEqual(self.metric(card, "gpu")["mode"], "unknown")

    def test_every_reviewed_card_has_two_to_four_metrics_without_private_profile_parsing(self):
        documents = ({"updated": "2026-11-23", "items": []}, {"items": []}, {"items": []})
        for resource_id in exporter.DISPLAY:
            documents[0]["items"].append({"id": resource_id, "status": "claimed",
                "proofLevel": "user-reported", "date": "2026-11-23", "value": PRIVATE_MARKER})
            documents[1]["items"].append({"id": resource_id, "acquisition": "owned",
                                          "quota": PRIVATE_MARKER})
        result = exporter.export_resources(*documents, source_checked_at=CHECKED)
        self.assertNotIn(PRIVATE_MARKER, json.dumps(result))
        for card in result["resources"]:
            metrics = card.get("metrics", [])
            self.assertGreaterEqual(len(metrics), 2, card["id"])
            self.assertLessEqual(len(metrics), 4, card["id"])
            self.assertEqual(len({metric["key"] for metric in metrics}), len(metrics))
            self.assertTrue(all("percent" not in metric for metric in metrics))

    def test_balance_above_plan_is_not_negative_or_overfull_consumption(self):
        documents = inputs()
        documents[2]["items"][0]["metrics"][0]["used"] = 999
        card = self.resource(documents=documents)
        metric = self.metric(card, "credits")
        self.assertEqual(card["usageStatus"], "observed")
        self.assertEqual((metric["mode"], metric["remaining"], metric["limit"]),
                         ("balance", 1025, 1000))
        self.assertEqual(metric["displayValue"], "1,025 credits")
        self.assertNotIn("used", metric)
        self.assertNotIn("percent", metric)
        self.assertIn("余额高于", metric["note"])

    def test_valid_same_cycle_values_preserve_zero_and_compute_used_percent(self):
        for used, remaining, percentage in ((0, 1000, 0), (250, 750, 25)):
            documents = inputs()
            documents[2]["items"][0]["metrics"][0].update(used=used, remaining=remaining)
            metric = self.metric(self.resource(documents=documents), "credits")
            self.assertEqual((metric["mode"], metric["used"], metric["percent"]),
                             ("usage", used, percentage))
            self.assertEqual(metric["checkedAt"], "2026-11-22T17:52:03Z")

    def test_missing_cycle_limit_or_matching_unit_cannot_create_a_percent(self):
        for mutation in ({"resetAtUtc": None}, {"limit": None}, {"limit": 0},
                         {"unit": "USD"}, {"unit": PRIVATE_MARKER}):
            documents = inputs()
            raw = documents[2]["items"][0]["metrics"][0]
            raw.update(used=250, remaining=750)
            raw.update(mutation)
            card = self.resource(documents=documents)
            self.assertEqual(card.get("usageStatus"), "unknown" if "unit" in mutation else "observed")
            self.assertTrue(all("percent" not in m for m in card.get("metrics", [])))
            self.assertNotIn(PRIVATE_MARKER, json.dumps(card))

    def test_a_known_plan_without_balance_does_not_become_observed_consumption(self):
        documents = inputs()
        documents[2]["items"][0]["metrics"][0].update(remaining=None, used=None)
        card = self.resource(documents=documents)
        self.assertEqual(self.metric(card, "credits")["mode"], "unknown")
        plan = self.metric(card, "plan_credits")
        self.assertEqual((plan["value"], plan["mode"]), (1000, "capacity"))
        self.assertNotIn("percent", plan)

    def test_small_nonzero_measurements_are_not_displayed_as_zero(self):
        documents = self.observed("apify-free", [{"key": "monthly_usage_usd", "unit": "USD",
            "used": 0.00000001, "limit": 100, "resetAtUtc": "2026-12-01T00:00:00Z"}])
        metric = self.metric(self.resource("apify-free", documents), "monthly_usage_usd")
        self.assertNotEqual(metric["displayValue"], "$0")
        self.assertGreater(metric["percent"], 0)

    def test_duplicate_observations_fail_without_disclosing_private_fields(self):
        documents = inputs()
        documents[2]["items"][0]["metrics"].append(
            {"key": "credits", "unit": "credits", "remaining": 500, "label": PRIVATE_MARKER})
        with self.assertRaises(exporter.ExportError) as error:
            self.resource(documents=documents)
        self.assertNotIn(PRIVATE_MARKER, str(error.exception))

    def test_conflicting_measurements_keep_absolute_values_without_progress(self):
        documents = inputs()
        documents[2]["items"][0]["metrics"][0].update(used=250, remaining=500)
        metric = self.metric(self.resource(documents=documents), "credits")
        self.assertEqual(metric["used"], 250)
        self.assertNotIn("percent", metric)
        self.assertIn("不一致", metric["note"])

    def test_failed_refresh_keeps_original_observation_time_and_marks_stale(self):
        documents = inputs()
        documents[2]["items"][0]["status"] = "unavailable"
        card = self.resource(documents=documents)
        self.assertEqual(card.get("usageStatus"), "stale")
        metric = self.metric(card, "credits")
        self.assertEqual(metric["remaining"], 1025)
        self.assertEqual(metric["checkedAt"], "2026-11-22T17:52:03Z")
        self.assertIn("上次", metric["note"])
        self.assertNotIn("quota", card)

    def test_untrusted_snapshots_and_nonfinite_values_do_not_create_observations(self):
        for mutation in ({"auth": "rejected"}, {"source": PRIVATE_MARKER},
                         {"status": PRIVATE_MARKER}):
            documents = inputs()
            documents[2]["items"][0].update(mutation)
            card = self.resource(documents=documents)
            self.assertEqual(card.get("usageStatus"), "unknown")
            self.assertFalse(any(m["basis"] == "observed" for m in card["metrics"]))
        for value in (True, -1, float("inf"), float("nan"), PRIVATE_MARKER):
            documents = inputs()
            documents[2]["items"][0]["metrics"][0].update(limit=value, remaining=value, used=value)
            card = self.resource(documents=documents)
            self.assertEqual(card.get("usageStatus"), "unknown")

    def test_browserbase_absolute_usage_is_not_divided_by_public_plan_quota(self):
        documents = self.observed("browserbase-free", [
            {"key": "browser_minutes", "unit": "minutes", "used": 25, "limit": 60,
             "remaining": 35, "resetAtUtc": "2026-12-01T00:00:00Z"},
            {"key": "proxy_bytes", "unit": "bytes", "used": 2048},
        ])
        card = self.resource("browserbase-free", documents)
        minutes = self.metric(card, "browser_minutes")
        self.assertEqual((minutes["mode"], minutes["used"]), ("usage", 25))
        self.assertFalse({"percent", "limit", "remaining"} & set(minutes))
        self.assertIn("周期未知", minutes["note"])
        self.assertEqual(self.metric(card, "proxy_bytes")["used"], 2048)

    def test_apify_observed_spending_limit_is_separate_from_free_plan_credit(self):
        documents = self.observed("apify-free", [{"key": "monthly_usage_usd", "unit": "USD",
            "used": 25, "limit": 20, "remaining": None, "resetAtUtc": "2026-12-01T00:00:00Z"}])
        card = self.resource("apify-free", documents)
        metric = self.metric(card, "monthly_usage_usd")
        self.assertEqual((metric["used"], metric["limit"], metric["percent"]), (25, 20, 125))
        self.assertIn("账户消费", metric["label"])
        self.assertNotIn("免费", metric["label"])
        self.assertEqual(card["claimStatus"], "registered")

    def test_zenrows_only_exports_reviewed_key_caps_and_their_explicit_scope(self):
        documents = self.observed("zenrows-free", [
            {"key": "key_cap_day_1", "unit": "credits", "used": 20, "limit": 100,
             "remaining": 80, "resetAtUtc": "2026-11-23T00:00:00Z", "label": PRIVATE_MARKER},
            {"key": PRIVATE_MARKER, "unit": "credits", "used": 1, "limit": 100},
        ])
        card = self.resource("zenrows-free", documents)
        metric = self.metric(card, "key_cap_day_1")
        self.assertEqual(metric["percent"], 20)
        self.assertIn("每日", metric["label"])
        self.assertNotIn(PRIVATE_MARKER, json.dumps(card))

    def test_catalog_access_never_implies_account_quota(self):
        documents = self.observed("neon-free", [{"key": "credits", "unit": "credits",
             "used": 0, "limit": 1000, "remaining": 1000,
             "resetAtUtc": "2026-12-01T00:00:00Z"}])
        card = self.resource("neon-free", documents)
        self.assertEqual(card.get("usageStatus"), "unknown")
        self.assertTrue(all("percent" not in m and m["basis"] != "observed"
                            for m in card["metrics"]))


if __name__ == "__main__":
    unittest.main()
