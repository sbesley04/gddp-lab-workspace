"""Generate SYNTHETIC test fixtures with openpyxl (an independent writer from the app's reader).

All participants, values and comments here are invented ("DEMO-xx"). Never copy real study data
into fixtures. Run:  python3 -I tools/make_fixtures.py tests/fixtures
"""
import random
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.comments import Comment
from openpyxl.styles import Border, Font, PatternFill, Side
from openpyxl.styles.colors import Color

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "tests/fixtures")
OUT.mkdir(parents=True, exist_ok=True)

BLACK = Font(color="FF000000")
RED = Font(color="FFFF0000")
GREEN = Font(color="FF00B050")
ORANGE = Font(color=Color(theme=5))
DEFAULT_ITALIC = Font(italic=True, color=Color(theme=1))
MEDIUM = Side(style="medium")
THIN = Side(style="thin")


def fill(color):
    return PatternFill("solid", fgColor=color)


SAMPLE_FILL = fill(Color(theme=4, tint=0.7999816888943144))   # legend: sample warning
NEAR_SAMPLE_FILL = fill(Color(theme=4, tint=0.75))            # close to, but not, the legend colour
TARGET_FILL = fill("FFFFD1D1")                                 # legend: target warning
BOTH_FILL = fill(Color(theme=8, tint=0.5999938962981048))     # legend: both
YELLOW_FILL = fill("FFFFFF00")                                 # undocumented ("other highlights")


def demo_workbook(name="demo_workbook.xlsx", revised=False):
    rnd = random.Random(20261011)
    wb = Workbook()
    ws = wb.active
    ws.title = "Synthetic Demo Datasheet"
    headers = [
        ("Subject_ID", DEFAULT_ITALIC), ("Event Name", DEFAULT_ITALIC), ("Biological_Sex", ORANGE), ("Race_Category", ORANGE),
        ("BMI_During_Screen", GREEN), ("Age", ORANGE),
        ("PHQ-9 total score", GREEN), ("BDI-II total score", GREEN), ("Score", GREEN),
        (None, None),  # rich text multi-source header (HVLT raw)
        ("HVLT T-score", RED), ("Dominant hand", RED), ("Trails A time (seconds)", ORANGE),
        ("LP1_1 – Protein, CSF (mg/dL)", GREEN), ("LP1_1 – Glucose, CSF (mg/dL)", GREEN), ("LP1_3 (synthetic, unused)", GREEN),
        ("PBMC_Intact", Font(color=Color(theme=1))),
        ("IL6", BLACK), ("TNF", BLACK), ("CXCL10", BLACK), ("IFNG", BLACK), ("CCL2", BLACK), ("IL10", BLACK),
    ]
    for i, (h, f) in enumerate(headers, start=1):
        c = ws.cell(1, i)
        if h is None:
            c.value = CellRichText(
                TextBlock(InlineFont(b=True, i=True, color=Color(theme=5)), "HVLT Total Recall (raw)"),
                TextBlock(InlineFont(b=True, color="FF000000"), " / "),
                TextBlock(InlineFont(b=True, color="FFFF0000"), "HVLT Sum"),
            )
            c.font = Font(bold=True, italic=True, color=Color(theme=5))
        else:
            c.value = h
            c.font = f
    # Group borders: demographic A-F, depression G-I, NP J-M, LP1 N-P, Accelevir Q, NULISA R-W
    for col in (1, 7, 10, 14, 17, 18):
        ws.cell(1, col).border = Border(left=MEDIUM)
    ws.cell(1, 11).border = Border(left=THIN)

    n = 24
    for r in range(2, n + 2):
        pid = f"DEMO-{r - 1:02d}"
        ws.cell(r, 1, pid)
        ws.cell(r, 2, "Baseline")
        ws.cell(r, 3, rnd.choice(["Female", "Male"]))
        ws.cell(r, 4, rnd.choice(["Category_A", "Category_B", "Category_C"]))
        ws.cell(r, 5, round(rnd.uniform(19, 38), 2))
        ws.cell(r, 6, rnd.randint(35, 70))
        ws.cell(r, 7, rnd.randint(0, 22))
        ws.cell(r, 8, rnd.randint(0, 40) if r % 7 else None)
        ws.cell(r, 9, rnd.randint(0, 10))
        ws.cell(r, 10, rnd.randint(10, 34))
        ws.cell(r, 11, rnd.randint(25, 65))
        ws.cell(r, 12, rnd.choice(["Right", "Right", "Left"]))
        ws.cell(r, 13, round(rnd.uniform(18, 70), 1))
        ws.cell(r, 14, round(rnd.uniform(20, 60), 1) if r % 5 else None)
        ws.cell(r, 15, round(rnd.uniform(45, 80), 1) if r % 5 else None)
        ws.cell(r, 17, rnd.randint(0, 900))
        for col in range(18, 24):
            ws.cell(r, col, round(rnd.lognormvariate(1, 0.8), 3))
    # Mixed-source italic column: per-cell source colour
    for r in range(2, n + 2):
        ws.cell(r, 1).font = ORANGE if r % 3 == 0 else Font(color=Color(theme=1))
    # Edge values (synthetic): zero, censored and a non-numeric entry
    ws.cell(4, 18, 0)
    ws.cell(5, 19, "<0.5")
    ws.cell(6, 20, "QNS")
    ws.cell(7, 17, 0)
    # QC highlights in the NULISA block
    for col in range(18, 24):
        ws.cell(3, col).fill = SAMPLE_FILL       # DEMO-02: sample warning (exact)
        ws.cell(9, col).fill = NEAR_SAMPLE_FILL  # DEMO-08: near-match → possible
    ws.cell(5, 18).fill = TARGET_FILL
    ws.cell(10, 18).fill = TARGET_FILL
    ws.cell(11, 20).fill = BOTH_FILL
    ws.cell(6, 10).fill = YELLOW_FILL           # unresolved highlight in NP
    ws.cell(8, 11).fill = YELLOW_FILL
    # Comments (synthetic)
    ws.cell(1, 9).comment = Comment("Synthetic note: which instrument this 'Score' belongs to is undocumented.", "Demo Curator")
    ws.cell(6, 20).comment = Comment("Synthetic note: QNS = quantity not sufficient.", "Demo Curator")

    lg = wb.create_sheet("Formatting Legend")
    rows = [
        ("FORMAT", "Column Meaning", "Cell Meaning", None, None),
        ("Italicized", "means column data acquired from multiple spreadsheets", "N/A", DEFAULT_ITALIC, None),
        ("Black", "means column data acquired from Synthetic Master Dataset", "means that particular cell's data was acquired from Synthetic Master Dataset in a mixed-source column", Font(color=Color(theme=1)), None),
        ("Red", "means column data wholly acquired from Synthetic Neuropsych Source", "means that particular cell's data was acquired from Synthetic Neuropsych Source in a mixed-source column", RED, None),
        ("Orange", "means column data wholly acquired from Synthetic Scores Source", "means that particular cell's data was acquired from Synthetic Scores Source in a mixed-source column", ORANGE, None),
        ("Green", "means column data wholly acquired from Synthetic Labels Source", "means that particular cell's data was acquired from Synthetic Labels Source in a mixed-source column", GREEN, None),
        ("Bold & Multicolored", "means column data is identical between (color-specified, /-distinguished) sheet (name-specified) variables", "means identical between spreadsheets", Font(bold=True), None),
        (None, None, None, None, None),
        ("BORDERS", "Meaning", None, None, None),
        ("thick box borders", "indicates separation of variable type (left-to-right: demographic, depression, NP, LP1, Accelevir, AQ NULISA)", None, None, None),
        ("thin box borders", "indicates separation of variables within type", None, None, None),
        (None, None, None, None, None),
        ("HIGHLIGHTS", "Meaning", None, None, None),
        ("Warning", "Sample triggered warning in NULISA Sample QC (synthetic)", None, None, SAMPLE_FILL),
        ("Warning", "Target triggered warning in NULISA Target QC (synthetic)", None, None, TARGET_FILL),
        ("Both Warnings", "Sample and Target combination triggered warning in both NULISA Sample QC & Target QC (synthetic)", None, None, BOTH_FILL),
        ("Other Highlights", "Unconfirmed meaning; copied from Synthetic Neuropsych Source", None, None, None),
    ]
    for i, (a, b, c, font, f) in enumerate(rows, start=1):
        if a is not None:
            lg.cell(i, 1, a)
        if b is not None:
            lg.cell(i, 2, b)
        if c is not None:
            lg.cell(i, 3, c)
        if font is not None:
            lg.cell(i, 1).font = font
        if f is not None:
            lg.cell(i, 1).fill = f
    if revised:
        # A corrected source value, as in an updated export of the same study sheet.
        ws.cell(12, 7, 21)
    wb.save(OUT / name)


def edge_values():
    wb = Workbook()
    ws = wb.active
    ws.title = "Edge Cases"
    ws.append(["Subject_ID", "Event Name", "Score", "Score", "Lab value (pg/mL)", "Empty column", "Visit date", "Formula col", None])
    ws.append([9001, "Baseline", 0, 1, "<0.5", None, None, None, "orphan"])
    ws.append([9002, "Baseline", None, 2, 3.25, None, None, None, None])
    ws.append([9003, "Baseline", 5, "N/A", "7", None, None, None, None])
    ws.append([9004, "Baseline", -2, 3, ">100", None, None, None, None])
    ws.append([9005, "Week 4", 4, 4, 0, None, None, None, None])
    for r in range(2, 7):
        ws.cell(r, 7).value = 45000 + r
        ws.cell(r, 7).number_format = "yyyy-mm-dd"
        ws.cell(r, 8).value = f"=C{r}*2"
    wb.save(OUT / "edge_values.xlsx")


def blocking(name, rows):
    wb = Workbook()
    ws = wb.active
    ws.title = "Data"
    ws.append(["Subject_ID", "Event Name", "Measure"])
    for r in rows:
        ws.append(r)
    wb.save(OUT / name)


demo_workbook()
demo_workbook("demo_workbook_v2.xlsx", revised=True)
edge_values()
blocking("duplicate_keys.xlsx", [["DEMO-01", "Baseline", 1], ["DEMO-02", "Baseline", 2], ["DEMO-01", "Baseline", 3]])
blocking("missing_ids.xlsx", [["DEMO-01", "Baseline", 1], [None, "Baseline", 2]])
(OUT / "demo.csv").write_text(
    "Subject_ID,Event Name,Score A,Score B,Group\n"
    "DEMO-01,Baseline,1,10,x\nDEMO-02,Baseline,2,,y\nDEMO-03,Baseline,<1,30,x\nDEMO-04,Baseline,0,40,\n",
    encoding="utf-8",
)
print("fixtures written to", OUT)
