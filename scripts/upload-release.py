#!/usr/bin/env python3
"""Upload release assets once; retry equal assets and reject changed content."""
import hashlib
import json
import os
import sys
from pathlib import Path
import subprocess
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_version import release_version

ROOT = Path(__file__).resolve().parents[1]
tag = "v" + release_version()
repository = os.environ["GITHUB_REPOSITORY"]
release = json.loads(subprocess.check_output(["gh", "api", "repos/" + repository + "/releases/tags/" + tag]))
if release["draft"] or release["prerelease"]:
    raise SystemExit("Only stable published releases are supported")
existing = {asset["name"] for asset in release["assets"]}
for name in ("singverse-frontend.tar.gz", "SHA256SUMS"):
    source = ROOT / "build/release" / name
    if name in existing:
        with tempfile.TemporaryDirectory(prefix="singverse-release-") as directory:
            subprocess.run(["gh", "release", "download", tag, "--repo", repository,
                            "--pattern", name, "--dir", directory], check=True)
            downloaded = Path(directory) / name
            if hashlib.sha256(downloaded.read_bytes()).digest() != hashlib.sha256(source.read_bytes()).digest():
                raise SystemExit("Existing release asset has different content: " + name)
    else:
        subprocess.run(["gh", "release", "upload", tag, str(source), "--repo", repository], check=True)
print("Frontend release assets verified")
