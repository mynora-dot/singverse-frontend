#!/usr/bin/env python3
"""Create the complete portable frontend; VERSION is the only product version."""
import gzip
import io
import hashlib
import os
from pathlib import Path
import re
import tarfile
ROOT = Path(__file__).resolve().parents[1]
version = (ROOT / "VERSION").read_text().strip()
if not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version):
    raise SystemExit("Release VERSION must be stable SemVer")
tag = os.environ.get("GITHUB_REF_NAME")
if tag and tag != "v" + version:
    raise SystemExit("Release tag must equal v${VERSION}")
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
