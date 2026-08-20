#!/usr/bin/env python3
"""Refresh course elevation from USGS NED 1/3\" via OpenTopoData."""

from __future__ import annotations

import json
import math
import subprocess
import time
from pathlib import Path

ORIGIN_LAT = 36.5696646
ORIGIN_LON = -121.9497413
M_PER_DEG_LAT = 111320.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(ORIGIN_LAT))
YARD = 0.9144

COURSE = Path(__file__).resolve().parents[1] / "src" / "course" / "pebble-beach.json"


def from_yd(x: float, z: float) -> tuple[float, float]:
    lon = ORIGIN_LON + (x * YARD) / M_PER_DEG_LON
    lat = ORIGIN_LAT - (z * YARD) / M_PER_DEG_LAT
    return lat, lon


def fetch_ned(points: list[tuple[float, float]]) -> list[float | None]:
    out: list[float | None] = []
    for i in range(0, len(points), 100):
        batch = points[i : i + 100]
        locs = "|".join(f"{lat:.6f},{lon:.6f}" for lat, lon in batch)
        url = f"https://api.opentopodata.org/v1/ned10m?locations={locs}"
        raw = subprocess.check_output(["curl", "-sS", "-m", "60", url], text=True)
        data = json.loads(raw)
        if data.get("status") != "OK":
            raise RuntimeError(raw[:300])
        for r in data["results"]:
            out.append(r.get("elevation"))
        print(f"  NED {min(i + 100, len(points))}/{len(points)}")
        if i + 100 < len(points):
            time.sleep(1.05)
    return out


def main() -> None:
    course = json.loads(COURSE.read_text())
    xs = list(range(-250, 2151, 50))
    zs = list(range(-350, 1601, 50))
    print(f"fetching {len(xs)}x{len(zs)} = {len(xs) * len(zs)} NED points")

    pts = [from_yd(x, z) for z in zs for x in xs]
    elev_m = fetch_ned(pts)

    grid = []
    idx = 0
    for _z in zs:
        row = []
        for _x in xs:
            h = elev_m[idx]
            idx += 1
            # meters -> yards; clamp sea/no-data
            if h is None:
                row.append(0.0)
            else:
                row.append(round(max(-2.0, h) / YARD, 2))
        grid.append(row)

    course["elevation"] = {
        "originX": xs[0],
        "originZ": zs[0],
        "stepX": xs[1] - xs[0],
        "stepZ": zs[1] - zs[0],
        "width": len(xs),
        "height": len(zs),
        "heightsYards": grid,
        "source": "USGS NED 1/3 arc-second via OpenTopoData (ned10m)",
    }

    # Report tee/green samples for all 18.
    def sample(x: float, z: float) -> float:
        fx = (x - xs[0]) / (xs[1] - xs[0])
        fz = (z - zs[0]) / (zs[1] - zs[0])
        i = max(0, min(len(xs) - 2, int(fx)))
        j = max(0, min(len(zs) - 2, int(fz)))
        tx = min(1, max(0, fx - i))
        tz = min(1, max(0, fz - j))
        h00 = grid[j][i]
        h10 = grid[j][i + 1]
        h01 = grid[j + 1][i]
        h11 = grid[j + 1][i + 1]
        return h00 * (1 - tx) * (1 - tz) + h10 * tx * (1 - tz) + h01 * (1 - tx) * tz + h11 * tx * tz

    print("\nTee / green elevations (yards, NED):")
    for h in course["holes"]:
        th = sample(*h["tee"])
        gh = sample(*h["greenCenter"])
        print(f"  #{h['number']:2} tee {th:6.1f}  green {gh:6.1f}  delta {gh - th:+6.1f}")

    COURSE.write_text(json.dumps(course))
    print(f"\nwrote {COURSE} ({COURSE.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
