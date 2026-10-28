"""Render public simulator facts as explicit diagrams for the edited film."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

facts_path = Path(sys.argv[1])
facts = json.loads(facts_path.read_text(encoding="utf-8"))
root = facts_path.parent
ink, paper, teal, gold, red = "#173e42", "#f8f5e9", "#246b5d", "#e5c086", "#ad583d"
font_file = Path("C:/Windows/Fonts/segoeui.ttf")
if not font_file.is_file():
    raise RuntimeError("Supply a licensed local font before rendering diagrams.")

def font(size):
    return ImageFont.truetype(str(font_file), size)

def page(title, subtitle):
    im = Image.new("RGB", (1920, 1080), paper)
    draw = ImageDraw.Draw(im)
    draw.rectangle((0, 0, 1920, 80), fill=ink)
    draw.text((72, 23), "LIVEWORLD  /  RECOMPUTED ENGINE EVIDENCE · DIAGRAM", font=font(26), fill=paper)
    draw.text((72, 110), title, font=font(52), fill=ink)
    draw.text((72, 186), subtitle, font=font(29), fill=ink)
    return im, draw

def save(im, name):
    im.save(root / name, quality=95)

im, draw = page("The same total can hide a losing home.", "Moved-stick comparison · on-time total stays 20/24; waiting falls 22 → 10.")
headers = [(90, "Home in rescan B"), (900, "A on time"), (1210, "B on time"), (1510, "Change")]
for x, label in headers:
    draw.text((x, 292), label, font=font(29), fill=ink)
for index, h in enumerate(facts["households"]):
    y = 365 + index * 85
    if h["delta"]:
        draw.rounded_rectangle((70, y - 9, 1830, y + 65), radius=8, fill="#f5dccc" if h["delta"] < 0 else "#dfebdf")
    draw.text((90, y), h["label"], font=font(31), fill=ink)
    for x, value in [(960, h["before"]), (1270, h["after"]), (1560, f'{h["delta"]:+d}')]:
        draw.text((x, y), str(value), font=font(35), fill=ink)
draw.text((90, 942), "Per-home floor ≥3: FAIL. Four late units have moved to a different home.", font=font(32), fill=red)
draw.text((90, 1005), "Derived from recorded synthetic input worlds; not a camera-reliability or productivity benchmark.", font=font(24), fill=ink)
save(im, "04-household-evidence.jpg")

im, draw = page("Every delivery has a traceable receipt.", "Middle-right home · A: nearest dispatch; B: balanced dispatch · deadline T80.")
x0, x1, top, row_height = 435, 1760, 340, 140
scale = lambda tick: x0 + (x1 - x0) * tick / 120
for tick in [0, 20, 40, 60, 80, 100, 120]:
    x = scale(tick)
    draw.line((x, top - 28, x, 930), fill="#d8dece", width=2)
    draw.text((x - 18, top - 70), str(tick), font=font(25), fill=ink)
draw.line((scale(80), 285, scale(80), 930), fill=red, width=3)
draw.text((scale(80) - 100, 235), "Deadline T80", font=font(27), fill=red)
for index, (a, b) in enumerate(zip(facts["receipts"]["a"], facts["receipts"]["b"])):
    y = top + index * row_height
    draw.text((80, y + 2), f'Delivery {index + 1}', font=font(29), fill=ink)
    for r, dy, side in [(a, 0, "A"), (b, 48, "B")]:
        color = teal if r["onTime"] else red
        draw.text((270, y + dy), f'{side} T{r["dispatchedAt"]}→{r["deliveredAt"]}', font=font(26), fill=color)
        draw.line((scale(r["dispatchedAt"]), y + dy + 18, scale(r["deliveredAt"]), y + dy + 18), fill=color, width=12)
        x = scale(r["deliveredAt"])
        draw.ellipse((x - 9, y + dy + 9, x + 9, y + dy + 27), fill=color)
    draw.text((80, y + 98), f'B refs: {b["evidenceRefs"][0]} → {b["evidenceRefs"][1]} · outbound wait {b["outboundWaitingTurns"]}', font=font(21), fill=ink)
draw.text((80, 973), "Matched by home and arrival order, not the same parcel or courier. Total waiting also includes return trips.", font=font(25), fill=ink)
draw.text((80, 1020), "Exact arrivals and event references are independently recomputed from the saved project.", font=font(24), fill=ink)
save(im, "05-receipt-evidence.jpg")

im, draw = page("A passing brief has a boundary.", "Shift the lower bridge by the same offset in A and B; keep the confirmed brief fixed.")
for index, c in enumerate(facts["sensitivity"]["cases"]):
    x = 80 + index * 600
    result = c["b"]
    draw.rounded_rectangle((x, 300, x + 560, 880), radius=14, fill="#e5ecdf")
    draw.text((x + 32, 335), f'{c["offset"]:+d} cell' if c["offset"] else "0 · nominal", font=font(42), fill=ink)
    draw.text((x + 32, 435), f'B on time: {result["metrics"]["onTime"]}/24', font=font(33), fill=ink)
    draw.text((x + 32, 510), f'B waiting: {result["metrics"]["waitTicks"]}', font=font(33), fill=ink)
    draw.text((x + 32, 605), "PASS" if result["contract"]["passed"] else "FAIL", font=font(64), fill=teal if result["contract"]["passed"] else red)
    reason = "Every condition met" if result["contract"]["passed"] else "Waiting cap exceeded" if result["metrics"]["waitTicks"] > 10 else "On-time floor missed"
    draw.text((x + 32, 715), reason, font=font(29), fill=ink)
    draw.text((x + 32, 805), f'A on time: {c["a"]["metrics"]["onTime"]}/24 · FAIL', font=font(25), fill=ink)
draw.text((80, 950), "Brief: total ≥20, every home ≥3, total waiting ≤10. One edit per repair; resources remain locked.", font=font(29), fill=ink)
draw.text((80, 1010), "Three selected deterministic conditions. Not a statistical reliability score or a claim beyond this set.", font=font(25), fill=ink)
save(im, "07-limit-evidence.jpg")

im, draw = page("The brief travels with the world.", "Actual UI project export · imported results independently recomputed after opening.")
item = facts["export"]
draw.rounded_rectangle((80, 285, 990, 850), radius=14, fill="#e5ecdf")
for index, text in enumerate(["Executable brief v1", "Total on time ≥20", "Every home ≥3", "Total waiting ≤10", "One permitted edit; resources locked"]):
    draw.text((120, 330 + index * 90), text, font=font(37 if index == 0 else 33), fill=ink)
for index, text in enumerate([f'{item["trials"]} verified trials', f'{item["checkpoints"]} retained checkpoint', f'20/24 on time · wait {item["wait"]}', "Confirmed brief: PASS"]):
    draw.text((1070, 335 + index * 125), text, font=font(42), fill=teal if index == 3 else ink)
draw.text((80, 930), "Matching input artifact: demo/creator-example-project.json", font=font(29), fill=ink)
draw.text((80, 990), f'UI export SHA-256: {item["sha256"][:32]}…', font=font(26), fill=ink)
draw.text((80, 1033), "Imported source labels do not authenticate provider activity. Saved inputs determine the outcome.", font=font(23), fill=ink)
save(im, "08-project-evidence.jpg")
print("Rendered four labelled engine-evidence diagrams; no browser access or API calls.")
