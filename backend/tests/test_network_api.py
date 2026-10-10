"""Network HTTP projection and missing-signature readiness are explicit."""
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.schemas.api import NetworkResponse


def test_real_network_contract_and_no_signature_readiness(tmp_path):
    app = create_app(Settings(signature_auto_build=False, rate_limit_enabled=False,
                             cache_dir=tmp_path))
    with TestClient(app) as client:
        response = client.get("/network")
        assert response.status_code == 200
        network = NetworkResponse.model_validate(response.json())
        assert len(network.nodes) == 97
        assert len(network.pipes) == 119
        assert len(network.default_sensors) == 6
        assert "10" not in network.default_sensors
        assert client.get("/health").json()["signatures_ready"] is False
        assert client.get("/ready").status_code == 503
