# UPLINK_CAM

Live public camera directory and visualization. Data indexed from public sources.

## Why feeds don’t load on GitHub Pages

GitHub Pages serves your site over **HTTPS**. The camera feed URLs in `cams.json` are **HTTP**. Browsers block loading HTTP images on HTTPS pages (mixed content), so the feed images never load when the site is hosted only on GitHub Pages.

## How to get feeds working

The app uses a **feed proxy** when the page is HTTPS: it requests feeds via `/feed-proxy?url=...` on the same origin. That only works if the **Python server** is running and serving the site.

**Option A – Run the server locally**
```bash
cd UPLINK_SITE
python3 server.py
```
Open http://localhost:8081 — feeds will load.

**Option B – Deploy app + server together**
Deploy this repo to a host that runs Python (e.g. [Render](https://render.com), [Railway](https://railway.app), [Fly.io](https://fly.io)):

- Set the start command to: `python3 server.py` (or `python server.py`)
- Expose the default port (8081) or the `PORT` env var your host sets
- The same server serves the static files and the `/feed-proxy`, `/snapshot-proxy`, `/api/cam-visit`, and `/ipinfo` endpoints

Then open your app’s HTTPS URL — feeds will load via the proxy.

**Option C – GitHub Pages only**
If you host only on GitHub Pages (no server), the feed proxy isn’t available and **feeds will not load** because of mixed content. **Visit counts** (VISITS in the HUD) require the server—they use `/api/cam-visit`. The rest of the site (legal modal, comms, etc.) still works.

## Run locally

```bash
pip install -r requirements.txt   # if you use the scraper
python3 server.py
```
Open http://localhost:8081

## Scraper (optional)

The scraper gets camera data from Insecam: it visits a **listing page** (e.g. by country), collects links to each camera’s **view page** (`/en/view/ID/`), then visits each view page and extracts the **actual stream URL** from that page. Those URLs are what get saved to `cams.json` so “live” opens the real feed.

```bash
python3 uplink_scrape.py --add 200         # append up to 200 new cams (no duplicates)
python3 uplink_scrape.py 5                 # overwrite cams.json with 5 listing pages (byrating)
python3 uplink_scrape.py --country US --limit 6   # test run: 6 US cams only (then remove --limit to scan all)
python3 uplink_scrape.py --country US 10   # overwrite with 10 pages of US cameras
```

### After adding new cameras (recommended)

Run these three steps so new cams have correct locations, known-good streams, and thumbnails for the carousel/matrix:

1. **Correct locations** (fix scraper typos using ipinfo; writes `cams.json`):
   ```bash
   python3 backfill_locations.py --delay 0.6
   ```

2. **Check streams and remove dead cams** (see which feeds are live; remove no-signal cams from `cams.json`):
   ```bash
   python3 check_streams.py              # full report only
   python3 check_streams.py --remove     # check all, then remove no-signal cams from cams.json
   python3 check_streams.py --no-signal  # only list cam ids with no signal (no removal)
   ```

3. **Grab thumbnails** (saves one frame per cam to `thumbnails/` so the main carousel and matrix show static images):
   ```bash
   python3 thumbnail_scraper.py          # only cams that don't have a thumbnail yet
   python3 thumbnail_scraper.py --all     # refresh all thumbnails
   ```
