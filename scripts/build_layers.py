#!/usr/bin/env python3
"""
Regenerate the cached preset-layer data under public/layers/.

The curated Wikidata layers are baked to local JSON so the app loads them
instantly with no WDQS rate limits. Run this once a month (or whenever you want
fresh data) and commit the result:

    python3 scripts/build_layers.py

PeriodO layers stay live (a static CDN dump, not rate-limited), so they are not
generated here. The output JSON is already in the app's normalized event shape:
{ id, year, endYear?, title, description?, url?, data: { country? } }.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

WDQS = "https://query.wikidata.org/sparql"
UA = "OpenHistoryLine-layer-builder/1.0 (https://github.com/openhistorymap/openhistoryline)"
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "layers")

# Curated Wikidata layers: id -> list of P31 class QIDs (matches src/app/data.ts).
CLASS_LAYERS = {
    "wars": ["Q198"],
    "battles": ["Q178561", "Q188055"],
    "revolts": ["Q10931", "Q45382", "Q124734"],
    "famine": ["Q168247", "Q43059"],
    "plague": ["Q12184", "Q44512"],
    "quake": ["Q7944"],
    "eruption": ["Q7692360"],
    "flood": ["Q8068"],
    "treaties": ["Q625298"],
}

FROM_YEAR, TO_YEAR, LIMIT = -3000, 2031, 1000


def iso(year):
    sign = "-" if year < 0 else "+"
    return f"{sign}{abs(year):04d}-01-01T00:00:00Z"


def class_query(classes):
    values = " ".join("wd:" + q for q in classes)
    return f"""SELECT ?item ?itemLabel ?itemDescription ?date ?endDate ?classLabel ?countryLabel WHERE {{
  VALUES ?class {{ {values} }}
  ?item wdt:P31 ?class .
  OPTIONAL {{ ?item wdt:P585 ?pit. }}
  OPTIONAL {{ ?item wdt:P580 ?st. }}
  OPTIONAL {{ ?item wdt:P582 ?et. }}
  BIND(COALESCE(?pit, ?st) AS ?date)
  BIND(?et AS ?endDate)
  FILTER(BOUND(?date))
  FILTER(?date >= "{iso(FROM_YEAR)}"^^xsd:dateTime && ?date < "{iso(TO_YEAR)}"^^xsd:dateTime)
  OPTIONAL {{ ?item wdt:P17 ?country. }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "en". }}
}}
ORDER BY ?date
LIMIT {LIMIT}"""


EMPERORS_QUERY = """SELECT ?item ?itemLabel ?date ?endDate WHERE {
  ?item p:P39 ?st . ?st ps:P39 wd:Q842606 .
  OPTIONAL { ?st pq:P580 ?date. } OPTIONAL { ?st pq:P582 ?endDate. }
  FILTER(BOUND(?date))
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} ORDER BY ?date LIMIT 250"""


def parse_year(s):
    if not s:
        return None
    m = re.match(r"^\s*([+-]?)(\d+)-(\d{2})-(\d{2})", s)
    if not m:
        return None
    sign = -1 if m.group(1) == "-" else 1
    y, mo, d = int(m.group(2)), int(m.group(3)), int(m.group(4))
    frac = 0.0
    if mo > 0:
        frac += (mo - 1) / 12
    if d > 0:
        frac += (d - 1) / (12 * 31)
    return round(sign * y + frac, 6)


def run(query):
    url = WDQS + "?" + urllib.parse.urlencode({"query": query, "format": "json"})
    req = urllib.request.Request(url, headers={"Accept": "application/sparql-results+json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)["results"]["bindings"]


def to_events(bindings):
    out, seen = [], set()
    for b in bindings:
        uri = (b.get("item") or {}).get("value", "")
        qid = uri.rsplit("/", 1)[-1] or uri
        if not qid or qid in seen:
            continue
        year = parse_year((b.get("date") or {}).get("value"))
        if year is None:
            continue
        seen.add(qid)
        end = parse_year((b.get("endDate") or {}).get("value"))
        ev = {"id": qid, "year": year, "title": (b.get("itemLabel") or {}).get("value", qid)}
        if end is not None and end > year:
            ev["endYear"] = end
        cls = (b.get("classLabel") or {}).get("value")
        if cls:
            ev["description"] = cls
        if uri:
            ev["url"] = uri
        country = (b.get("countryLabel") or {}).get("value")
        if country and not re.match(r"^Q\d+$", country):
            ev["data"] = {"country": country}
        out.append(ev)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [(lid, class_query(cls)) for lid, cls in CLASS_LAYERS.items()] + [("emperors", EMPERORS_QUERY)]
    total = 0
    for lid, query in jobs:
        try:
            events = to_events(run(query))
        except Exception as e:  # noqa: BLE001
            print(f"  ! {lid}: {e}", file=sys.stderr)
            continue
        path = os.path.join(OUT, f"{lid}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(events, f, ensure_ascii=False, separators=(",", ":"))
        total += len(events)
        print(f"  {lid}: {len(events)} events")
        time.sleep(1)  # be gentle with WDQS
    print(f"Done — {total} events across {len(jobs)} layers in {OUT}")


if __name__ == "__main__":
    main()
