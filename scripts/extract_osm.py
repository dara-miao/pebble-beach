#!/usr/bin/env python3
"""Convert OSM Pebble Beach golf features into a local-yard JSON course file."""

from __future__ import annotations

import json
import math
import subprocess
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ORIGIN_LAT = 36.5696646
ORIGIN_LON = -121.9497413
M_PER_DEG_LAT = 111320.0
M_PER_DEG_LON = 111320.0 * math.cos(math.radians(ORIGIN_LAT))
YARD = 0.9144

# Published scorecards (yards to center of green).
SCORECARD = {
    "championship": {
        "name": "Championship / U.S. Open",
        "total": 7040,
        "rating": 75.5,
        "slope": 145,
        "holes": [380, 502, 404, 331, 195, 523, 109, 428, 505, 495, 390, 202, 445, 580, 397, 403, 208, 543],
    },
    "blue": {
        "name": "Blue",
        "total": 6802,
        "rating": 74.9,
        "slope": 144,
        "holes": [378, 509, 397, 333, 189, 498, 107, 416, 483, 444, 370, 202, 401, 559, 393, 400, 182, 541],
    },
    "gold": {
        "name": "Gold",
        "total": 6472,
        "rating": 73.4,
        "slope": 137,
        "holes": [349, 491, 381, 308, 145, 490, 98, 388, 463, 428, 349, 187, 390, 545, 375, 378, 176, 531],
    },
    "white": {
        "name": "White",
        "total": 6083,
        "rating": 71.7,
        "slope": 135,
        "holes": [337, 458, 340, 295, 134, 465, 94, 364, 436, 408, 338, 176, 370, 490, 338, 368, 166, 506],
    },
}

PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5]
HANDICAPS = [8, 10, 12, 16, 14, 2, 18, 6, 4, 7, 5, 17, 9, 1, 13, 11, 15, 3]

NOTES = {
    1: "Slight dogleg right inland from the Lodge. Tree-lined driving hole; two bunkers guard the right side of the fairway.",
    2: "Par 5 playing inland. A barranca / trench cuts across about 80 yards short of a well-bunkered green.",
    3: "Dogleg-left par 4. The corner can be challenged, but trees and bunkers punish a miss.",
    4: "Short par 4 toward the ocean. A tiny cliff-top green is ringed by bunkers; ocean is a red penalty area long and right.",
    5: "Jack Nicklaus par 3 (1998) playing toward Stillwater Cove, angled green, bunkers short and sides.",
    6: "Par 5 along the cliffs. Uphill second shot; green sits on a promontory with ocean right.",
    7: "The famous downhill 107-yard par 3. Green is almost surrounded by bunkers and the Pacific.",
    8: "One of golf's great holes: tee shot inland, then a mid-iron over a chasm to a green on the next headland.",
    9: "Long downhill par 4 along the ocean. Everything missing right is in Carmel Bay.",
    10: "Another cliff-side par 4, ocean all down the right, small green exposed to wind.",
    11: "Turns inland. Approach must find a small, well-bunkered green.",
    12: "Uphill par 3 to an angled green with bunkers short and left.",
    13: "Slight dogleg par 4. Alister MacKenzie worked this green complex.",
    14: "The longest hole and often the hardest. Elevated, heavily bunkered green; a ridge front-right sheds balls.",
    15: "Par 4 heading back toward the ocean. Bunkers pinch the landing area.",
    16: "Approach toward the water. Ocean and bunkers await anything long.",
    17: "Iconic par 3 to an hourglass green. Deep bunker short, ocean long.",
    18: "The finishing par 5 along the sea wall back to the Lodge. Ocean left, trees right, green in front of the clubhouse.",
}

OSM_FILES = [Path("/tmp/pebble-west.xml"), Path("/tmp/pebble-east.xml")]
OUT = Path(__file__).resolve().parents[1] / "src" / "course" / "pebble-beach.json"

HAY_NAMES = {"Hay", "Seven", "Watson", "Bing", "Grace", "Lanny", "Jack", "Kite", "Tiger"}


def to_yd(lat: float, lon: float) -> list[float]:
    x = (lon - ORIGIN_LON) * M_PER_DEG_LON / YARD
    z = -(lat - ORIGIN_LAT) * M_PER_DEG_LAT / YARD
    return [round(x, 2), round(z, 2)]


def from_yd(x: float, z: float) -> tuple[float, float]:
    lon = ORIGIN_LON + (x * YARD) / M_PER_DEG_LON
    lat = ORIGIN_LAT - (z * YARD) / M_PER_DEG_LAT
    return lat, lon


def dist(a: list[float], b: list[float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def centroid(pts: list[list[float]]) -> list[float]:
    if not pts:
        return [0.0, 0.0]
    return [
        round(sum(p[0] for p in pts) / len(pts), 2),
        round(sum(p[1] for p in pts) / len(pts), 2),
    ]


def path_len(pts: list[list[float]]) -> float:
    return round(sum(dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)), 1)


def point_to_polyline(p: list[float], line: list[list[float]]) -> tuple[float, float]:
    """Return (min distance, arc length along line to closest point)."""
    best = 1e9
    along = 0.0
    walked = 0.0
    for i in range(len(line) - 1):
        ax, az = line[i]
        bx, bz = line[i + 1]
        vx, vz = bx - ax, bz - az
        len2 = vx * vx + vz * vz or 1e-9
        t = max(0.0, min(1.0, ((p[0] - ax) * vx + (p[1] - az) * vz) / len2))
        qx, qz = ax + t * vx, az + t * vz
        d = math.hypot(p[0] - qx, p[1] - qz)
        if d < best:
            best = d
            along = walked + t * math.hypot(vx, vz)
        walked += math.hypot(vx, vz)
    return best, along


def side_of_path(p: list[float], line: list[list[float]]) -> str:
    # Use first segment direction vs vector to point.
    ax, az = line[0]
    bx, bz = line[min(1, len(line) - 1)]
    cross = (bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax)
    if abs(cross) < 8:
        return "center"
    return "right" if cross > 0 else "left"


def load_osm():
    nodes: dict[str, tuple[float, float, dict]] = {}
    ways = []
    seen = set()
    for path in OSM_FILES:
        root = ET.parse(path).getroot()
        for n in root.findall("node"):
            nid = n.get("id")
            tags = {t.get("k"): t.get("v") for t in n.findall("tag")}
            nodes[nid] = (float(n.get("lat")), float(n.get("lon")), tags)
        for w in root.findall("way"):
            wid = w.get("id")
            if wid in seen:
                continue
            seen.add(wid)
            tags = {t.get("k"): t.get("v") for t in w.findall("tag")}
            nds = [nd.get("ref") for nd in w.findall("nd")]
            ways.append((wid, tags, nds))
    return nodes, ways


def coords(nodes, nds):
    pts = []
    for i in nds:
        if i in nodes:
            lat, lon, _ = nodes[i]
            pts.append(to_yd(lat, lon))
    return pts


def fetch_elevation_grid(xs, zs):
    lats = []
    lons = []
    for z in zs:
        for x in xs:
            lat, lon = from_yd(x, z)
            lats.append(f"{lat:.5f}")
            lons.append(f"{lon:.5f}")
    heights = []
    # Open-Meteo allows many points; batch by 80 to be safe.
    for i in range(0, len(lats), 80):
        qlat = ",".join(lats[i : i + 80])
        qlon = ",".join(lons[i : i + 80])
        url = f"https://api.open-meteo.com/v1/elevation?latitude={qlat}&longitude={qlon}"
        raw = subprocess.check_output(["curl", "-sS", "-m", "30", url], text=True)
        data = json.loads(raw)
        elev = data.get("elevation") or []
        heights.extend(elev)
        print(f"  elevation {min(i + 80, len(lats))}/{len(lats)}")
    # Convert meters to yards, sea level ~0.
    grid = []
    idx = 0
    for z in zs:
        row = []
        for x in xs:
            h_m = heights[idx] if idx < len(heights) else 10.0
            idx += 1
            row.append(round((h_m or 0.0) / YARD, 2))
        grid.append(row)
    return {
        "originX": xs[0],
        "originZ": zs[0],
        "stepX": xs[1] - xs[0] if len(xs) > 1 else 100,
        "stepZ": zs[1] - zs[0] if len(zs) > 1 else 100,
        "width": len(xs),
        "height": len(zs),
        "heightsYards": grid,
    }


def main():
    nodes, ways = load_osm()
    print("nodes", len(nodes), "ways", len(ways))

    holes_raw = []
    greens = []
    tees = []
    fairways = []
    bunkers = []
    roughs = []
    cartpaths = []
    coast = []
    water = []
    woods = []
    trees: list[list[float]] = []
    pins = []

    for nid, (lat, lon, tags) in nodes.items():
        pt = to_yd(lat, lon)
        if tags.get("golf") == "pin":
            pins.append({"center": pt, "ref": tags.get("ref")})
        if tags.get("natural") == "tree":
            trees.append(pt)

    for wid, tags, nds in ways:
        pts = coords(nodes, nds)
        if len(pts) < 2:
            continue
        g = tags.get("golf")
        if g == "hole":
            holes_raw.append({"ref": tags.get("ref"), "par": tags.get("par"), "name": tags.get("name"), "path": pts})
        elif g == "green":
            greens.append({"ref": tags.get("ref"), "polygon": pts, "center": centroid(pts)})
        elif g == "tee":
            tees.append({"ref": tags.get("ref"), "polygon": pts, "center": centroid(pts)})
        elif g == "fairway":
            fairways.append({"polygon": pts, "center": centroid(pts)})
        elif g == "bunker":
            bunkers.append({"polygon": pts, "center": centroid(pts)})
        elif g == "rough":
            roughs.append({"polygon": pts})
        elif g == "cartpath":
            cartpaths.append(pts)
        if tags.get("natural") == "coastline":
            coast.append(pts)
        if tags.get("natural") == "water" or tags.get("water"):
            water.append(pts)
        if tags.get("natural") in {"wood", "scrub"} or tags.get("landuse") == "forest":
            woods.append(pts)

    pebble = []
    for h in holes_raw:
        if h["name"] in HAY_NAMES:
            continue
        try:
            n = int(h["ref"])
        except (TypeError, ValueError):
            continue
        if 1 <= n <= 18:
            pebble.append(h)

    pebble.sort(key=lambda h: int(h["ref"]))
    print("pebble holes", [h["ref"] for h in pebble])

    assigned_green = set()
    assigned_fairway = set()
    assigned_tee = set()
    assigned_bunker = set()

    holes_out = []
    for h in pebble:
        n = int(h["ref"])
        path = h["path"]
        tee_pt = path[0]
        green_pt = path[-1]

        # Green: matching ref, else nearest unused centroid to path end.
        green = None
        for i, g in enumerate(greens):
            if g["ref"] and str(g["ref"]) == str(n):
                green = g
                assigned_green.add(i)
                break
        if green is None:
            best_i, best_d = None, 1e9
            for i, g in enumerate(greens):
                if i in assigned_green:
                    continue
                d = dist(g["center"], green_pt)
                if d < best_d:
                    best_d, best_i = d, i
            if best_i is not None and best_d < 60:
                green = greens[best_i]
                assigned_green.add(best_i)

        hole_tees = []
        for i, t in enumerate(tees):
            if i in assigned_tee:
                continue
            d = dist(t["center"], tee_pt)
            # Also allow tees along the first 80 yards of the hole (forward tees).
            d_path, along = point_to_polyline(t["center"], path)
            if d < 90 or (d_path < 35 and along < 90):
                hole_tees.append(t)
                assigned_tee.add(i)
        hole_tees.sort(key=lambda t: dist(t["center"], green_pt), reverse=True)

        hole_fw = []
        for i, f in enumerate(fairways):
            if i in assigned_fairway:
                continue
            d_path, _ = point_to_polyline(f["center"], path)
            if d_path < 70:
                hole_fw.append(f)
                assigned_fairway.add(i)

        hole_bk = []
        for i, b in enumerate(bunkers):
            if i in assigned_bunker:
                continue
            d_path, along = point_to_polyline(b["center"], path)
            if d_path < 75:
                side = side_of_path(b["center"], path)
                yards_from_tee = round(along, 0)
                yards_to_green = round(max(0.0, dist(b["center"], green["center"] if green else green_pt)), 0)
                hole_bk.append(
                    {
                        **b,
                        "side": side,
                        "yardsFromTee": yards_from_tee,
                        "yardsToGreen": yards_to_green,
                    }
                )
                assigned_bunker.add(i)
        hole_bk.sort(key=lambda b: b["yardsFromTee"])

        pin = None
        best_d = 1e9
        for p in pins:
            d = dist(p["center"], green["center"] if green else green_pt)
            if d < best_d:
                best_d = d
                pin = p["center"]

        holes_out.append(
            {
                "number": n,
                "par": PARS[n - 1],
                "handicap": HANDICAPS[n - 1],
                "note": NOTES[n],
                "yards": {k: v["holes"][n - 1] for k, v in SCORECARD.items()},
                "path": path,
                "osmPathYards": path_len(path),
                "tee": tee_pt,
                "greenCenter": green["center"] if green else green_pt,
                "pin": pin or (green["center"] if green else green_pt),
                "green": green,
                "tees": hole_tees,
                "fairways": hole_fw,
                "bunkers": hole_bk,
            }
        )

    # Elevation grid covering the course with padding.
    xs = list(range(-250, 2151, 80))
    zs = list(range(-350, 1601, 80))
    print("fetching elevation", len(xs) * len(zs), "points")
    elevation = fetch_elevation_grid(xs, zs)

    out = {
        "name": "Pebble Beach Golf Links",
        "location": "Pebble Beach, California",
        "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON, "note": "The Lodge at Pebble Beach"},
        "units": "yards",
        "axes": {"x": "east", "y": "up", "z": "south"},
        "par": 72,
        "scorecard": SCORECARD,
        "holes": holes_out,
        "unassignedBunkers": [b for i, b in enumerate(bunkers) if i not in assigned_bunker],
        "rough": roughs,
        "cartpaths": cartpaths,
        "coastline": coast,
        "water": water,
        "woods": woods,
        "trees": trees,
        "elevation": elevation,
        "source": "OpenStreetMap contributors (ODbL) + published scorecards. Layout is a 3D reconstruction, not an official survey.",
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out))
    kb = OUT.stat().st_size / 1024
    print(f"wrote {OUT} ({kb:.1f} KB)")
    print("bunkers assigned", sum(len(h["bunkers"]) for h in holes_out), "unassigned", len(out["unassignedBunkers"]))
    print("greens", sum(1 for h in holes_out if h["green"]), "fairways", sum(len(h["fairways"]) for h in holes_out))


if __name__ == "__main__":
    main()
