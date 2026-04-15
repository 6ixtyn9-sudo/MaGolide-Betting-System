import os
import json
import gspread
from google.oauth2.service_account import Credentials

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

_client_cache = None


def get_client():
    global _client_cache
    if _client_cache is not None:
        return _client_cache, None

    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        return None, "GOOGLE_SERVICE_ACCOUNT_JSON secret not set. Add your service account JSON to Replit Secrets."

    try:
        info = json.loads(raw)
    except json.JSONDecodeError as e:
        return None, f"Invalid JSON in GOOGLE_SERVICE_ACCOUNT_JSON: {e}"

    try:
        creds = Credentials.from_service_account_info(info, scopes=SCOPES)
        client = gspread.authorize(creds)
        _client_cache = client
        return client, None
    except Exception as e:
        return None, f"Google auth failed: {e}"


def reset_client():
    global _client_cache
    _client_cache = None


def is_configured():
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    return bool(raw)
