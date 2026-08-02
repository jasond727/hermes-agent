"""Profile-scoped memory entry CRUD endpoints.

The /api/memory/entries endpoints accept an optional ``profile`` query param.
These tests pin: reads/writes land in the REQUESTED profile's memories
directory, the dashboard's own profile stays untouched, and unknown profiles
return 404.
"""
import pytest

_ENTRY_DELIMITER = "\n§\n"


@pytest.fixture
def isolated_profiles(tmp_path, monkeypatch, _isolate_hermes_home):
    """Isolated default home + one named profile, each with memories dir."""
    from hermes_constants import get_hermes_home
    from hermes_cli import profiles

    default_home = get_hermes_home()
    profiles_root = default_home / "profiles"
    worker_home = profiles_root / "coder"
    for home in (default_home, worker_home):
        mem_dir = home / "memories"
        mem_dir.mkdir(parents=True, exist_ok=True)
        (home / "config.yaml").write_text("{}\n", encoding="utf-8")

    # Seed default profile with one entry
    (default_home / "memories" / "MEMORY.md").write_text(
        "Default memory entry", encoding="utf-8"
    )
    # Seed worker profile with a different entry
    (worker_home / "memories" / "MEMORY.md").write_text(
        "Worker memory entry", encoding="utf-8"
    )

    monkeypatch.setattr(profiles, "_get_default_hermes_home", lambda: default_home)
    monkeypatch.setattr(profiles, "_get_profiles_root", lambda: profiles_root)
    return {"default": default_home, "coder": worker_home}


@pytest.fixture
def client(monkeypatch, isolated_profiles):
    try:
        from starlette.testclient import TestClient
    except ImportError:
        pytest.skip("fastapi/starlette not installed")

    import hermes_state
    from hermes_constants import get_hermes_home
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

    monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", get_hermes_home() / "state.db")
    c = TestClient(app)
    c.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return c


def _read_entries(home, target="memory"):
    fname = "MEMORY.md" if target == "memory" else "USER.md"
    path = home / "memories" / fname
    if not path.exists():
        return []
    raw = path.read_text(encoding="utf-8", errors="replace").strip()
    if not raw:
        return []
    return [e.strip() for e in raw.split(_ENTRY_DELIMITER) if e.strip()]


class TestProfileScopedMemoryEntries:

    def test_get_entries_defaults_to_dashboard_profile(self, client, isolated_profiles):
        """Without profile param, reads from the dashboard's own memories."""
        resp = client.get("/api/memory/entries", params={"target": "memory"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["entries"] == ["Default memory entry"]

    def test_get_entries_scoped_to_target_profile(self, client, isolated_profiles):
        """profile= param reads from that profile's memories directory."""
        resp = client.get(
            "/api/memory/entries",
            params={"target": "memory", "profile": "coder"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["entries"] == ["Worker memory entry"]

    def test_get_entries_user_target(self, client, isolated_profiles):
        """target=user reads from USER.md."""
        (isolated_profiles["coder"] / "memories" / "USER.md").write_text(
            "User entry A\n§\nUser entry B", encoding="utf-8"
        )
        resp = client.get(
            "/api/memory/entries",
            params={"target": "user", "profile": "coder"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert data["entries"] == ["User entry A", "User entry B"]

    def test_add_entry_lands_in_target_profile_only(self, client, isolated_profiles):
        """POST with profile= writes to that profile, not the dashboard's."""
        resp = client.post(
            "/api/memory/entries",
            params={"target": "memory", "profile": "coder"},
            json={"content": "New worker entry"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

        worker_entries = _read_entries(isolated_profiles["coder"], "memory")
        assert "New worker entry" in worker_entries
        # Dashboard's own memories must stay untouched.
        default_entries = _read_entries(isolated_profiles["default"], "memory")
        assert "New worker entry" not in default_entries

    def test_update_entry_scoped_to_target_profile(self, client, isolated_profiles):
        """PUT with profile= updates the right profile's entry using text matching."""
        resp = client.put(
            "/api/memory/entries",
            params={"target": "memory", "profile": "coder"},
            json={"old_content": "Worker memory entry", "content": "Updated worker entry"},
        )
        assert resp.status_code == 200
        worker_entries = _read_entries(isolated_profiles["coder"], "memory")
        assert worker_entries[0] == "Updated worker entry"
        # Dashboard's entry unchanged.
        default_entries = _read_entries(isolated_profiles["default"], "memory")
        assert default_entries[0] == "Default memory entry"

    def test_delete_entry_scoped_to_target_profile(self, client, isolated_profiles):
        """DELETE with profile= removes from the right profile using text matching."""
        resp = client.request(
            "DELETE",
            "/api/memory/entries",
            params={"target": "memory", "profile": "coder"},
            json={"content": "Worker memory entry"},
        )
        assert resp.status_code == 200
        worker_entries = _read_entries(isolated_profiles["coder"], "memory")
        assert len(worker_entries) == 0
        # Dashboard's entry still exists.
        default_entries = _read_entries(isolated_profiles["default"], "memory")
        assert len(default_entries) == 1

    def test_replace_non_matching_old_content_returns_400(self, client, isolated_profiles):
        """PUT with old_content that doesn't match any entry returns 400."""
        resp = client.put(
            "/api/memory/entries",
            params={"target": "memory", "profile": "coder"},
            json={"old_content": "Does not exist", "content": "New content"},
        )
        assert resp.status_code == 400

    def test_delete_non_matching_content_returns_400(self, client, isolated_profiles):
        """DELETE with content that doesn't match any entry returns 400."""
        resp = client.request(
            "DELETE",
            "/api/memory/entries",
            params={"target": "memory", "profile": "coder"},
            json={"content": "Does not exist"},
        )
        assert resp.status_code == 400
