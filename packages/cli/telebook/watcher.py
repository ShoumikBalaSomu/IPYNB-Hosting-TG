"""
Local filesystem watcher for TeleBook.
Monitors directory for .ipynb modifications, computes content hashes,
and triggers automatic encrypted sync.
"""

from __future__ import annotations
import asyncio
import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Callable, Dict, Optional, Set
from watchfiles import awatch, Change

logger = logging.getLogger("telebook.watcher")


def is_valid_ipynb_file(path: Path) -> bool:
    """
    Check if a path is an active .ipynb notebook (and not a checkpoint or temp file).
    """
    if not path.is_file():
        return False
    if not path.name.endswith(".ipynb"):
        return False
    # Ignore checkpoints, swap files, and dotfiles
    parts = path.parts
    if any(p.startswith(".") or "checkpoint" in p.lower() for p in parts[:-1]):
        return False
    if path.name.startswith(".") or "checkpoint" in path.name.lower():
        return False
    return True


def compute_file_sha256(path: Path) -> Optional[str]:
    """
    Compute SHA-256 hash of a file's content.
    Returns None if file cannot be read or is currently being written.
    """
    try:
        data = path.read_bytes()
        # Basic check to see if it's valid JSON
        try:
            json.loads(data.decode("utf-8"))
        except Exception:
            return None
        return hashlib.sha256(data).hexdigest()
    except (OSError, IOError):
        return None


class DirectoryWatcher:
    def __init__(
        self,
        watch_dir: Path | str,
        on_change_callback: Callable[[Path], None],
        debounce_seconds: float = 0.5,
    ):
        self.watch_dir = Path(watch_dir).resolve()
        self.on_change = on_change_callback
        self.debounce_seconds = debounce_seconds
        self._file_hashes: Dict[str, str] = {}
        self._running = False
        self._stop_event = asyncio.Event()

    def scan_initial_hashes(self) -> None:
        """
        Populate baseline hashes of existing notebooks without triggering events.
        """
        if not self.watch_dir.exists():
            return
        for root, dirs, files in os.walk(self.watch_dir):
            # Exclude hidden directories and checkpoint folders in place
            dirs[:] = [d for d in dirs if not d.startswith(".") and "checkpoint" not in d.lower()]
            for file in files:
                p = Path(root) / file
                if is_valid_ipynb_file(p):
                    h = compute_file_sha256(p)
                    if h:
                        self._file_hashes[str(p)] = h

    async def run(self) -> None:
        """
        Asynchronously watch directory for changes using watchfiles.
        """
        self._running = True
        self._stop_event.clear()
        self.scan_initial_hashes()
        logger.info(f"Started watching directory: {self.watch_dir}")

        async for changes in awatch(self.watch_dir, stop_event=self._stop_event):
            # Debounce briefly to let editors finish atomic writes
            await asyncio.sleep(self.debounce_seconds)

            for change_type, raw_path in changes:
                path = Path(raw_path)
                if not is_valid_ipynb_file(path):
                    continue

                if change_type == Change.deleted:
                    self._file_hashes.pop(str(path), None)
                    continue

                if change_type in (Change.added, Change.modified):
                    new_hash = compute_file_sha256(path)
                    if not new_hash:
                        continue

                    old_hash = self._file_hashes.get(str(path))
                    if new_hash != old_hash:
                        self._file_hashes[str(path)] = new_hash
                        try:
                            self.on_change(path)
                        except Exception as e:
                            logger.error(f"Error handling changed file {path}: {e}")

    def stop(self) -> None:
        """
        Signal the watcher loop to terminate.
        """
        self._running = False
        self._stop_event.set()
