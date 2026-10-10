"""Portable identity for text hydraulic network inputs."""

import hashlib
from pathlib import Path

NETWORK_HASH_POLICY = "sha256-lf-v1"


def canonical_network_sha256(path: Path) -> str:
    """Hash identical LF/CRLF input text consistently across Git checkouts."""
    canonical = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(canonical).hexdigest()
