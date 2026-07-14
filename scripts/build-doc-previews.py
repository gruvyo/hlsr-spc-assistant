#!/usr/bin/env python3
"""Build in-app document previews for the viewer page (public/view.html).

For each document in DOCS: convert the source (kb/source) to PDF if needed,
render every page to an optimized JPEG, and write a manifest the viewer reads.
This is what powers the branded "preview + download/share" page for files we
host ourselves (dashboard files are login-gated and can't be previewed).

Run from the app/ directory:  python3 scripts/build-doc-previews.py
Needs: soffice (LibreOffice) for docx->pdf, pdftoppm (poppler) for pdf->jpg.
"""
import json
import os
import subprocess
import glob

HERE = os.path.dirname(os.path.abspath(__file__))          # app/scripts
APP = os.path.dirname(HERE)                                # app
ROOT = os.path.dirname(APP)                                # faq-chatbot
SRC = os.path.join(ROOT, "kb", "source")
OUT = os.path.join(APP, "public", "resources")

# Documents that get an in-app preview. Add entries here to extend the viewer.
DOCS = [
    {
        "id": "template-sales-aid-2026",
        "src": "template-sales-aid-2026.docx",
        "title": "Sales aid with sample ads (2026)",
        "editableUrl": "https://dashboard.rodeospc.com/files/Houston%20Livestock%20Show%20and%20Rodeo%20-%20SPC%20Sales%20tool-Blank.docx",
        "editableLabel": "Editable Word version (to personalize)",
    },
]


def run(cmd):
    subprocess.run(cmd, check=True, capture_output=True)


def main():
    manifest = {}
    for d in DOCS:
        did, src = d["id"], os.path.join(SRC, d["src"])
        pdf = os.path.join(OUT, did + ".pdf")
        # 1) source -> PDF (LibreOffice) unless the source is already a PDF
        if src.lower().endswith(".pdf"):
            run(["cp", src, pdf])
        else:
            run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", OUT, src])
            produced = os.path.join(OUT, os.path.splitext(d["src"])[0] + ".pdf")
            if produced != pdf:
                os.replace(produced, pdf)
        # 2) PDF -> optimized JPEGs, one per page, in a per-doc folder
        pagedir = os.path.join(OUT, did)
        os.makedirs(pagedir, exist_ok=True)
        for f in glob.glob(os.path.join(pagedir, "page-*.jpg")):
            os.remove(f)
        run(["pdftoppm", "-jpeg", "-jpegopt", "quality=82", "-r", "120",
             pdf, os.path.join(pagedir, "page")])
        pages = sorted(glob.glob(os.path.join(pagedir, "page-*.jpg")),
                       key=lambda p: int(p.rsplit("-", 1)[1].split(".")[0]))
        rel = [f"/resources/{did}/{os.path.basename(p)}" for p in pages]
        manifest[did] = {
            "title": d["title"],
            "pdf": f"/resources/{did}.pdf",
            "pages": rel,
            "editableUrl": d.get("editableUrl"),
            "editableLabel": d.get("editableLabel"),
        }
        total_kb = round(sum(os.path.getsize(p) for p in pages) / 1024)
        print(f"  {did}: {len(pages)} pages, {total_kb} KB of images")

    with open(os.path.join(OUT, "viewer-manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"wrote viewer-manifest.json ({len(manifest)} doc(s))")


if __name__ == "__main__":
    main()
