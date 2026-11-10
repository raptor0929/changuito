"""Rejected jobs, a hung store fetch, and an attempt clip. No browser and no merchant."""
import asyncio
import os
import tempfile
import unittest
from pathlib import Path

from attempt_video import publish_attempt
from checkout import as_store_timeout, bounded_store, lines_for_search
from server import rejection_reason

_R2 = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")


class RejectionTests(unittest.TestCase):
    def test_a_rejected_body_logs_a_code_and_not_the_value(self):
        secret = "shopper-password"
        pan = "card-number"
        cases = [
            ([{"loc": ("body", "shopper", "dni"), "input": "12"}], "invalid_shopper", "dni"),
            ([{"loc": ("body", "card", "pan"), "input": pan}], "invalid_card", "pan"),
            ([{"loc": ("body", "items", 0, "quantity"), "input": 99}], "invalid_item", "quantity"),
            ([{"loc": ("body", "flow"), "input": "nope"}], "invalid_flow", "flow"),
            ([{"loc": ("body", "shopper", "password"), "input": secret}], "invalid_shopper", "password"),
        ]
        for errors, code, field in cases:
            got = rejection_reason(errors)
            self.assertEqual(got, (code, field))
            self.assertNotIn(secret, "".join(got))
            self.assertNotIn(pan, "".join(got))


class StoreTimeoutTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_hung_fetch_ends_as_store_timeout(self):
        async def hang():
            await asyncio.Event().wait()

        out = await bounded_store(hang(), 0.05)
        self.assertEqual(out["error"], "store_timeout")
        self.assertEqual(as_store_timeout(out)["how"], "store_timeout")
        self.assertFalse(as_store_timeout(out)["ok"])

    async def test_a_fetch_that_returns_is_kept(self):
        async def ok():
            return {"status": 200, "data": {"street": "Riviera"}}

        out = await bounded_store(ok(), 1)
        self.assertEqual(out["status"], 200)
        self.assertIsNone(as_store_timeout(out))


class SearchSplitTests(unittest.TestCase):
    def test_a_refused_sku_is_not_searched(self):
        rest = [
            {"sku": "222", "name": "Azucar"},
            {"name": "Yerba"},
        ]
        search, refused = lines_for_search(rest)
        self.assertEqual([line["name"] for line in search], ["Yerba"])
        self.assertEqual([line["name"] for line in refused], ["Azucar"])


class AttemptVideoTests(unittest.TestCase):
    def setUp(self):
        self.saved = {key: os.environ.pop(key, None) for key in _R2}
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "attempt.webm"
        self.path.write_bytes(b"clip-before-card")

    def tearDown(self):
        try:
            self.tmp.cleanup()
        except FileNotFoundError:
            pass
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_upload_deletes_the_local_file(self):
        for key in _R2:
            os.environ[key] = "fixture"
        seen = {}

        def put(path, key, cfg):
            seen["bytes"] = path.read_bytes()
            seen["key"] = key
            self.assertNotIn("R2_SECRET_ACCESS_KEY", str(key))

        result = publish_attempt(self.path, "abc123", put=put)
        self.assertEqual(result, "stored")
        self.assertEqual(seen["bytes"], b"clip-before-card")
        self.assertEqual(seen["key"], "attempts/abc123.webm")
        self.assertFalse(self.path.exists())

    def test_missing_r2_skips_without_failing(self):
        def put(path, key, cfg):
            raise AssertionError("put")

        result = publish_attempt(self.path, "abc123", put=put)
        self.assertEqual(result, "skipped")
        self.assertTrue(self.path.exists())

    def test_payment_is_outside_the_recording_window(self):
        source = Path(__file__).with_name("agent.py").read_text()
        seal = source.index("await seal_attempt()")
        form = source.index("await checkout.open_payment")
        card = source.index("await checkout.prepare_manual")
        pay = source.index("pay = await checkout.pay")
        self.assertLess(seal, form)
        self.assertLess(seal, card)
        self.assertLess(seal, pay)


if __name__ == "__main__":
    unittest.main()
