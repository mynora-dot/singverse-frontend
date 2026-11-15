#!/usr/bin/env python3
"""Create the complete portable frontend at the version injected by Actions."""
import gzip
import io
import hashlib
import os
import sys
from pathlib import Path
import re
import tarfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_version import build_version
ROOT = Path(__file__).resolve().parents[1]
version = build_version(required=True)
for entry in ("admin/index.html", "party/index.html", "downloads/index.html"):
    if not (ROOT / "dist" / entry).is_file():
        raise SystemExit("Missing frontend entry: " + entry)
out = ROOT / "build" / "release"
out.mkdir(parents=True, exist_ok=True)
archive = out / "singverse-frontend.tar.gz"
with archive.open("wb") as target, gzip.GzipFile(filename="", mode="wb", fileobj=target, mtime=0) as compressed:
    with tarfile.open(fileobj=compressed, mode="w") as tar:
        for path in sorted((ROOT / "dist").rglob("*")):
            if path.is_file():
                data = path.read_bytes()
                entry = tarfile.TarInfo(str(path.relative_to(ROOT / "dist")))
                entry.size = len(data)
                entry.mode = 0o644
                tar.addfile(entry, io.BytesIO(data))
(out / "SHA256SUMS").write_text(hashlib.sha256(archive.read_bytes()).hexdigest() + "  " + archive.name + "\n")
print("Prepared frontend release " + version)
