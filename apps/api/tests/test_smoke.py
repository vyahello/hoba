"""Phase 1 smoke tests — the runnable shell must answer /health and /docs."""

from __future__ import annotations

from fastapi.testclient import TestClient

from hoba_api.main import app


def test_health_returns_ok() -> None:
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "hoba_api"


def test_docs_available() -> None:
    client = TestClient(app)
    response = client.get("/docs")
    assert response.status_code == 200


def test_openapi_schema_published() -> None:
    client = TestClient(app)
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert schema["info"]["title"] == "Hoba! API"
