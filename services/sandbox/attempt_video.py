"""Upload one attempt clip to R2, then delete the local file.

The clip is stopped before the card form. This module never logs a credential,
a card number, or the file's bytes. A missing bucket does not fail the shop.
"""
from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

_KEYS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")


def safe_job_id(job_id: str | None) -> str | None:
    if job_id and len(job_id) <= 64 and all(c.isalnum() or c in "-_" for c in job_id):
        return job_id
    return None


def r2_config() -> dict | None:
    values = {key: os.environ.get(key, "") for key in _KEYS}
    if not all(values.values()):
        return None
    return values


def publish_attempt(path: Path | None, job_id: str, *, put=None) -> str:
    """Store `path` as attempts/{job}.webm. Returns 'stored' or 'skipped'."""
    key_id = safe_job_id(job_id)
    if path is None or not path.is_file() or key_id is None:
        print("    video skipped: no recording")
        return "skipped"
    cfg = r2_config()
    if cfg is None:
        print("    video skipped: r2 unset")
        return "skipped"
    key = f"attempts/{key_id}.webm"
    try:
        (put or _put_r2)(path, key, cfg)
    except Exception as exc:
        print(f"    video skipped: {type(exc).__name__}")
        return "skipped"
    path.unlink(missing_ok=True)
    try:
        path.parent.rmdir()
    except OSError:
        pass
    print(f"    video stored {key}")
    return "stored"


def _sign(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode(), hashlib.sha256).digest()


def _put_r2(path: Path, key: str, cfg: dict) -> None:
    body = path.read_bytes()
    payload = hashlib.sha256(body).hexdigest()
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    day = now.strftime("%Y%m%d")
    host = f"{cfg['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com"
    canonical_uri = "/" + "/".join(quote(part, safe="") for part in (cfg["R2_BUCKET"], *key.split("/")))
    signed = "content-type;host;x-amz-content-sha256;x-amz-date"
    headers = (
        f"content-type:video/webm\n"
        f"host:{host}\n"
        f"x-amz-content-sha256:{payload}\n"
        f"x-amz-date:{amz_date}\n"
    )
    canonical = f"PUT\n{canonical_uri}\n\n{headers}\n{signed}\n{payload}"
    scope = f"{day}/auto/s3/aws4_request"
    to_sign = "AWS4-HMAC-SHA256\n" + amz_date + "\n" + scope + "\n" + hashlib.sha256(canonical.encode()).hexdigest()
    signing = _sign(("AWS4" + cfg["R2_SECRET_ACCESS_KEY"]).encode(), day)
    for piece in ("auto", "s3", "aws4_request"):
        signing = _sign(signing, piece)
    signature = hmac.new(signing, to_sign.encode(), hashlib.sha256).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={cfg['R2_ACCESS_KEY_ID']}/{scope}, "
        f"SignedHeaders={signed}, Signature={signature}"
    )
    request = Request(
        f"https://{host}{canonical_uri}",
        data=body,
        method="PUT",
        headers={
            "Content-Type": "video/webm",
            "Host": host,
            "x-amz-content-sha256": payload,
            "x-amz-date": amz_date,
            "Authorization": authorization,
        },
    )
    with urlopen(request, timeout=60) as response:
        if response.status >= 300:
            raise OSError("r2 rejected the upload")
