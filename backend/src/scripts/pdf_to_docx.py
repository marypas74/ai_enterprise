#!/usr/bin/env python3
"""Convert PDF to DOCX preserving layout, images, fonts and formatting using pdf2docx."""

import sys
from pdf2docx import Converter


def pdf_to_docx(pdf_path: str, docx_path: str) -> None:
    cv = Converter(pdf_path)
    cv.convert(docx_path)
    cv.close()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.pdf> <output.docx>", file=sys.stderr)
        sys.exit(1)

    pdf_to_docx(sys.argv[1], sys.argv[2])
    print(f"Converted {sys.argv[1]} -> {sys.argv[2]}")
