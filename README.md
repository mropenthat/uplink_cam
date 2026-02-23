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
Open http://localhost:8080 — feeds will load.

**Option B – Deploy app + server together**
Deploy this repo to a host that runs Python (e.g. [Render](https://render.com), [Railway](https://railway.app), [Fly.io](https://fly.io)):

- Set the start command to: `python3 server.py` (or `python server.py`)
- Expose the default port (8080) or the `PORT` env var your host sets
- The same server serves the static files and the `/feed-proxy`, `/snapshot-proxy`, and `/ipinfo` endpoints

Then open your app’s HTTPS URL — feeds will load via the proxy.

**Option C – GitHub Pages only**
If you host only on GitHub Pages (no server), the feed proxy isn’t available and **feeds will not load** because of mixed content. The rest of the site (legal modal, comms, matrix, etc.) still works.

## Run locally

```bash
pip install -r requirements.txt   # if you use the scraper
python3 server.py
```
Open http://localhost:8080

## Scraper (optional)

```bash
python3 uplink_scrape.py --add 200   # append 200 new feeds, no duplicates
python3 uplink_scrape.py 5           # overwrite cams.json with 5 pages
```
