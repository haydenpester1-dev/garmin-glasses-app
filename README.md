# Garmin Stats for Meta Ray-Ban Display

A glanceable Garmin dashboard as a Meta Ray-Ban Display **Web App**:
standard HTML/CSS/JS, fixed 600×600 viewport, dark additive-display UI,
D-pad / Neural Band navigation. No Mac, Xcode, or App Store needed.

## How it works

- `docs/` is the web app, deployed to GitHub Pages.
- `.github/workflows/poll.yml` runs every 15 minutes: it logs into
  Garmin Connect, writes `docs/feed/<secret-token>/latest.json`, and
  redeploys. The app re-fetches every 5 minutes while open.
- Tiles show big glanceable numbers plus inline SVG charts (no libraries):
  7-day step bars, 7-day resting-HR trend, and today's Body Battery curve.
  The poller fetches 7 days of history for the charts (~15 API calls/run).
- The feed URL contains a secret token so it isn't guessable; the token
  is injected at deploy time and never committed to git.

## Setup (about 10 minutes)

1. **Create a GitHub repo** and push this folder to it.
2. **Repo Settings → Secrets and variables → Actions → New repository secret.**
   Add:
   - `GARMIN_USERNAME` — your Garmin Connect email
   - `GARMIN_PASSWORD` — your Garmin Connect password
   - `FEED_TOKEN` — a random token, e.g. output of `openssl rand -hex 24`
     (letters and numbers only)
3. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
4. **Actions → "Poll Garmin and deploy" → Run workflow** to do the first
   poll immediately.

### First-login MFA

Garmin usually demands an MFA email code on the first login from a new
machine, which a headless Action can't answer. One-time fix on your own
computer:

```bash
pip install -r poller/requirements.txt
GARMIN_USERNAME='you@example.com' GARMIN_PASSWORD='...' \
  python poller/garmin_poll.py --out /tmp/latest.json
# paste the emailed MFA code when prompted
base64 ~/.garmin-tokens   # then save the output as the GARMIN_TOKENS secret
```

After that the Action authenticates with tokens and the password is only
a fallback.

### Calibrating fields

Garmin's API shapes drift over time. Every metric fetch is defensive
(missing = blank tile, never a crash). To inspect raw responses:

```bash
python poller/garmin_poll.py --probe | python -m json.tool
```

## Load it on the glasses

1. On your iPhone: Meta AI app → Settings → About → tap the version
   number **5 times** to enable Developer Mode.
2. In the Meta AI app, add a Web App and paste your Pages URL:
   `https://<you>.github.io/<repo>/`
3. Open it from the glasses. Tiles show the latest synced values and
   each refresh stamps "synced Xm ago" at the top.

## Local preview

```bash
cd docs && python3 -m http.server 8000
# open http://localhost:8000 — mock.json stands in for the live feed
```
