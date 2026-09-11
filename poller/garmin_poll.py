#!/usr/bin/env python3
"""Poll Garmin Connect and write a stats JSON feed for the Display web app.

Auth: prefers long-lived OAuth tokens (GARMIN_TOKENS env, base64 of the
tokenstore file). Falls back to GARMIN_USERNAME/GARMIN_PASSWORD for the
first run, which may hit Garmin MFA -- in that case mint tokens locally
once (see README) and store them as the GARMIN_TOKENS secret.

Every metric fetch is wrapped so one failing endpoint never kills the feed.
"""
import argparse
import base64
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone


def eprint(*a):
    print(*a, file=sys.stderr)


def safe(name, fn, *args):
    try:
        return fn(*args)
    except Exception as exc:  # noqa: BLE001 - one bad endpoint must not kill the feed
        eprint(f"warn: {name} failed: {exc}")
        return None


def get_client(tokenstore_path):
    from garminconnect import Garmin  # noqa: PLC0415

    tokens_b64 = os.environ.get("GARMIN_TOKENS")
    if tokens_b64:
        # garminconnect >= 0.2.x uses a tokenstore *directory* containing
        # garmin_tokens.json; the secret holds the base64 of that JSON file.
        os.makedirs(tokenstore_path, exist_ok=True)
        with open(os.path.join(tokenstore_path, "garmin_tokens.json"), "wb") as fh:
            fh.write(base64.b64decode(tokens_b64))
    try:
        client = Garmin()
        client.login(tokenstore_path)
        eprint("auth: token login ok")
        return client, tokenstore_path
    except Exception as exc:  # noqa: BLE001
        eprint(f"auth: token login failed ({exc}), trying password login")

    username = os.environ.get("GARMIN_USERNAME")
    password = os.environ.get("GARMIN_PASSWORD")
    if not username or not password:
        raise SystemExit("No usable tokens and GARMIN_USERNAME/GARMIN_PASSWORD not set")
    client = Garmin(username, password)
    client.login(tokenstore_path)  # raises on MFA -- mint tokens locally instead
    eprint("auth: password login ok")
    return client, tokenstore_path


def build_feed(client):
    today = date.today().isoformat()
    feed = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "date": today,
    }

    stats = safe("get_stats", client.get_stats, today) or {}
    feed["steps"] = stats.get("totalSteps")
    feed["step_goal"] = stats.get("dailyStepGoal")
    feed["distance_km"] = round((stats.get("totalDistanceMeters") or 0) / 1000, 1)
    feed["active_min"] = round((stats.get("highlyActiveSeconds") or 0) / 60)

    hr = safe("get_heart_rates", client.get_heart_rates, today) or {}
    feed["resting_hr"] = hr.get("restingHeartRate")

    bb = safe("get_body_battery", client.get_body_battery, today) or []
    bb_vals = []
    for point in bb:
        if isinstance(point, (list, tuple)) and len(point) >= 2:
            v = point[1]
        elif isinstance(point, dict):
            v = point.get("bodyBatteryValue", point.get("value"))
        else:
            v = None
        if isinstance(v, (int, float)):
            bb_vals.append(v)
    feed["body_battery"] = bb_vals[-1] if bb_vals else None
    # downsample intraday curve to <= 48 points for the chart
    if len(bb_vals) > 48:
        step = len(bb_vals) / 48
        bb_vals = [bb_vals[int(i * step)] for i in range(48)]
    feed["bb_curve"] = bb_vals

    sleep = safe("get_sleep_data", client.get_sleep_data, today) or {}
    secs = sleep.get("sleepTimeSeconds")
    feed["sleep_hours"] = round(secs / 3600, 1) if secs else None

    readiness = safe("get_training_readiness", client.get_training_readiness, today)
    if isinstance(readiness, dict):
        # shape varies by API version; probe common keys
        feed["readiness"] = (
            readiness.get("score") or readiness.get("readinessScore")
        )
        feed["readiness_label"] = (
            readiness.get("level") or readiness.get("readinessLevel") or ""
        )
    else:
        feed["readiness"] = readiness if isinstance(readiness, (int, float)) else None
        feed["readiness_label"] = ""

    tstatus = safe("get_training_status", client.get_training_status, today) or {}
    feed["vo2max"] = tstatus.get("vo2maxRunning") or tstatus.get("vo2Max")

    # 7-day history for charts (oldest first)
    days = [(date.today() - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    steps_7d, rhr_7d = [], []
    for d in days:
        s = safe(f"get_stats[{d}]", client.get_stats, d) or {}
        steps_7d.append(s.get("totalSteps"))
        h = safe(f"get_heart_rates[{d}]", client.get_heart_rates, d) or {}
        rhr_7d.append(h.get("restingHeartRate"))
    feed["steps_7d"] = steps_7d
    feed["rhr_7d"] = rhr_7d
    feed["day_labels"] = [
        datetime.strptime(d, "%Y-%m-%d").strftime("%a") for d in days
    ]

    return feed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="path to write latest.json")
    ap.add_argument("--probe", action="store_true",
                    help="dump raw endpoint responses for field calibration")
    ap.add_argument("--tokenstore", default=os.path.expanduser("~/.garmin-tokens"))
    args = ap.parse_args()

    client, tokenstore_path = get_client(args.tokenstore)

    if args.probe:
        today = date.today().isoformat()
        dump = {
            "stats": safe("get_stats", client.get_stats, today),
            "heart_rates": safe("get_heart_rates", client.get_heart_rates, today),
            "body_battery_head": (safe("get_body_battery", client.get_body_battery, today) or [])[:3],
            "training_readiness": safe("get_training_readiness", client.get_training_readiness, today),
            "training_status": safe("get_training_status", client.get_training_status, today),
        }
        print(json.dumps(dump, indent=2, default=str))
        return

    feed = build_feed(client)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    tmp = args.out + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(feed, fh)
    os.replace(tmp, args.out)
    eprint(f"wrote {args.out}")

    # If we authenticated with a password this run, refresh the stored tokens
    # so the next run can use them (caller persists GARMIN_TOKENS separately).
    if not os.environ.get("GARMIN_TOKENS"):
        refreshed = os.path.join(tokenstore_path, "garmin_tokens.json")
        if os.path.exists(refreshed):
            eprint("tokenstore refreshed; re-encode to update the GARMIN_TOKENS secret if needed")


if __name__ == "__main__":
    main()
