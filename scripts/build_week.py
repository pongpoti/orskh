#!/usr/bin/env python3
"""Turn the OR system export (.xls) into src/data/week-data.ts.

Usage:  python3 scripts/build_week.py path/to/workdays.xls
Needs:  pandas, xlrd

Only what the board shows is kept: day, department hint, status, procedure
name, surgeon and shift. Patient fields (HN, AN, name, age, rights, diagnosis,
costs) are never read into the output.

Rules, from the FY2569 utilisation report:
  * dressing cases are found by keyword (d/s, ds and dw only as whole words) and
    are not dressing when the name also holds debridement / db, scrub, graft,
    suture, closure, escharotomy, fasciotomy, excision, incision or amputation;
  * Tha Chalom hospital cases are cut, and so is vascular surgery Tue-Thu
    (that is Tha Chalom's quota);
  * ORs and departments are matched later, in src/lib/week.ts, from the weekly
    allocation table.
Local rules:
  * rows whose `วันที่` equals `วันที่ผ่าตัด` are dropped (same-day entries, as
    the hospital asked);
  * only urgency Emergency / Stat counts as an emergency case.
"""
import collections
import json
import re
import sys

import pandas as pd

if len(sys.argv) != 2:
    sys.exit(__doc__)

OUT = "src/data/week-data.ts"
raw = pd.read_excel(sys.argv[1], header=None)
header = [str(h) for h in raw.iloc[0]]
rows = raw.iloc[1:].reset_index(drop=True)


def col(name: str, nth: int = 0) -> int:
    return [i for i, h in enumerate(header) if h == name][nth]


C = {
    "status": col("สถานะภาพ"),
    "proc": col("ชื่อการผ่าตัด"),
    "surgeon": col("แพทย์ผู้สั่ง"),
    "urgency": col("ความเร่งด่วน"),
    "booked": col("วันที่"),
    "dept_name": col("แผนก"),
    "kind": col("ชนิด"),
    "shift": col("เวร"),
    "day": col("วันที่ผ่าตัด"),
    "room": col("ห้องผ่าตัด"),
}


def cell(row, key):
    value = row[C[key]]
    return None if pd.isna(value) else value


def text(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


STATUS = {
    "ผ่าตัดเสร็จแล้ว": "done",
    "ยกเลิกการผ่าตัด": "cancelled",
    "กำลังผ่าตัด": "in-progress",
    "รอผ่าตัด": "scheduled",
}
KIND = {
    "GEN": "GENSX", "Ortho": "ORTHO", "EYE": "EYE", "URO": "URO", "ENT": "ENT",
    "Plastic": "PLASTIC", "GYN": "OBGYN", "OBS": "OBGYN", "OBS/Ped": "OBGYN",
    "CVT": "CVT", "Maxillo": "MAXILLO",
}
SPECIFIC = {
    "ศัลยกรรมกระดูก": "ORTHO", "จักษุ": "EYE", "ศัลยกรรมทางเดินปัสสาวะ": "URO",
    "ศัลยกรรมหลอดเลือด": "VAS", "โสต ศอ นาสิก": "ENT", "นรีเวชกรรม": "OBGYN",
    "สูติกรรม": "OBGYN", "ศัลยกรรมตกแต่ง": "PLASTIC", "ศัลยกรรมหัวใจและหลอดเลือด": "CVT",
    "ศัลยกรรมหัวใจและทรวงอก": "CVT", "ศัลยกรรมทรวงอก": "CVT",
}
SCOPE = re.compile(r"(egd|colonoscop|gastroscop|sigmoidoscop|endoscop|ercp|panendoscop)", re.I)
DRESSING = re.compile(
    r"(dressing|(?<![a-z])d/s(?![a-z])|(?<![a-z])ds(?![a-z])|(?<![a-z])dw(?![a-z])|ทำแผล|ล้างแผล|เปลี่ยนแผล|change\s*vac|vac\s*d)",
    re.I,
)
NOT_DRESSING = re.compile(
    r"(debridement|(?<![a-z])db(?![a-z])|scrub|graft|suture|closure|escharotomy|fasciotomy|excision|incision|amputation)",
    re.I,
)
# Anything that could name a patient is stripped from free text and listed for review.
PERSONAL = re.compile(r"((?:นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.)\s*\S+(?:\s+\S+)?|\b\d{6,}\b|\bHN\s*\d+|\bAN\s*\d+)", re.I)

booked = pd.to_datetime(rows[C["booked"]]).dt.normalize()
done_on = pd.to_datetime(rows[C["day"]]).dt.normalize()
days = sorted(done_on.dropna().unique())
dropped = collections.Counter()
scrubbed = []
out = []

for i, row in rows.iterrows():
    if booked[i] == done_on[i]:
        dropped["same-day entry"] += 1
        continue
    proc_raw = text(cell(row, "proc"))
    if "ท่าฉลอม" in " ".join(text(cell(row, k)) for k in ("dept_name", "room", "proc")):
        dropped["Tha Chalom hospital"] += 1
        continue
    day = days.index(done_on[i])
    kind, name = text(cell(row, "kind")), text(cell(row, "dept_name"))
    dept = SPECIFIC.get(name) or KIND.get(kind) or ("GENSX" if name == "ศัลยกรรม" else None)
    if dept == "GENSX" and SCOPE.search(proc_raw):
        dept = "SCOPE"
    if dept == "VAS" and day in (1, 2, 3):
        dropped["vascular Tue-Thu (Tha Chalom quota)"] += 1
        continue

    m = re.match(r"^(.*?)\s*\(([^)]*)\)\s*$", text(cell(row, "surgeon")))
    surgeon, title = (m.group(1), m.group(2)) if m else (text(cell(row, "surgeon")), "")
    title = {"น.พ.": "นพ.", "พ.ญ.": "พญ."}.get(title.strip(), title.strip())

    proc = proc_raw
    hits = PERSONAL.findall(proc)
    if hits:
        scrubbed.append((proc_raw, hits))
        proc = text(PERSONAL.sub("", proc))

    shift = text(cell(row, "shift"))
    out.append({
        "day": day,
        "dept": dept,
        "surgeon": text(surgeon),
        "title": title,
        "proc": proc,
        "status": STATUS.get(text(cell(row, "status")), "scheduled"),
        "shift": "out" if shift.startswith("นอกเวลา") else "in" if shift.startswith("ในเวลา") else None,
        "dressing": bool(DRESSING.search(proc_raw) and not NOT_DRESSING.search(proc_raw)),
        "emergency": text(cell(row, "urgency")) in ("Emergency", "Stat"),
    })

# A case with no department takes the one its surgeon works in most often.
usual = collections.defaultdict(collections.Counter)
for item in out:
    if item["dept"] and item["dept"] != "SCOPE":
        usual[item["surgeon"]][item["dept"]] += 1
for item in out:
    if not item["dept"] and usual[item["surgeon"]]:
        item["dept"] = usual[item["surgeon"]].most_common(1)[0][0]

meta = {
    "days": [pd.Timestamp(d).strftime("%Y-%m-%d") for d in days],
    "rows": len(rows),
    "kept": len(out),
    "dropped": dict(dropped),
}
with open(OUT, "w", encoding="utf-8") as f:
    f.write("// Generated by scripts/build_week.py from the OR system export. Do not edit by hand.\n")
    f.write("// Holds no patient fields: only day, department, status, procedure, surgeon and shift.\n")
    f.write('import type { WeekFile } from "@/lib/week";\n\n')
    f.write("export const WEEK_DATA: WeekFile = ")
    json.dump({"meta": meta, "cases": out}, f, ensure_ascii=False, indent=1)
    f.write(";\n")
print(json.dumps(meta, ensure_ascii=False, indent=1))
print("no department:", sum(1 for c in out if not c["dept"]))
print("dressing:", sum(c["dressing"] for c in out), "| emergency:", sum(c["emergency"] for c in out))
print("free text scrubbed:", len(scrubbed))
for before, hits in scrubbed:
    print("  ", repr(before), "->", hits)
