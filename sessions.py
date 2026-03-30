from __future__ import annotations

import threading
import time
import uuid
from pathlib import Path


class SessionStore:
    def __init__(self, tmp_dir: Path, ttl: int = 7200) -> None:
        self._tmp_dir = tmp_dir
        self._ttl = ttl
        self._sessions: dict[str, dict] = {}
        self._lock = threading.Lock()

    def create(self, image_bytes: bytes) -> str:
        session_id = str(uuid.uuid4())
        tmp_path = self._tmp_dir / f"{session_id}.bin"
        tmp_path.write_bytes(image_bytes)
        with self._lock:
            self._sessions[session_id] = {"path": str(tmp_path), "created": time.time()}
        return session_id

    def delete(self, session_id: str) -> None:
        with self._lock:
            session = self._sessions.pop(session_id, None)
        if session:
            try:
                Path(session["path"]).unlink(missing_ok=True)
            except OSError:
                pass

    def cleanup_expired(self) -> None:
        now = time.time()
        with self._lock:
            expired = [sid for sid, s in self._sessions.items() if now - s["created"] > self._ttl]
            for sid in expired:
                try:
                    Path(self._sessions[sid]["path"]).unlink(missing_ok=True)
                except OSError:
                    pass
                del self._sessions[sid]
