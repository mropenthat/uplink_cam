#!/usr/bin/env bash
# Add new cameras and run the full post-add pipeline (README: "After adding new cameras").
# Usage: ./scripts/add_new_cams.sh [N]
#   N = number of new cams to scrape (default 100).

set -e
cd "$(dirname "$0")/.."
ADD="${1:-100}"

echo "=== 1/4 Scrape up to $ADD new cameras (no duplicates) ==="
python3 uplink_scrape.py --add "$ADD"

echo ""
echo "=== 2/4 Backfill locations (ipinfo) ==="
python3 backfill_locations.py --delay 0.6

echo ""
echo "=== 3/4 Check streams and remove no-signal cams ==="
python3 check_streams.py --remove

echo ""
echo "=== 4/4 Grab thumbnails for cams that don't have one ==="
python3 thumbnail_scraper.py

echo ""
echo "Done. New cams added, locations fixed, dead streams removed, thumbnails updated."
