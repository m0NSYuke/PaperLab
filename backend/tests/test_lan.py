from fastapi.testclient import TestClient

from app.main import create_app

KEY = "k7m2x9q4pa"


def lan_client(root, host="192.168.1.20", token=KEY):
    return TestClient(create_app(root, lan_token=token), base_url="http://192.168.1.5:8000",
                      client=(host, 50000), follow_redirects=False)


def test_default_mode_rejects_lan_host(tmp_path):
    client = TestClient(create_app(tmp_path, lan_token=""), base_url="http://192.168.1.5:8000")
    assert client.get("/api/health").status_code == 400


def test_lan_requires_key_then_remembers_it(tmp_path):
    client = lan_client(tmp_path)
    assert client.get("/api/papers").status_code == 401
    assert client.get("/").status_code == 401
    assert client.get("/?key=wrong").status_code == 401
    opened = client.get(f"/?key={KEY}")
    assert opened.status_code == 303 and "key=" not in opened.headers["location"]
    assert client.get("/api/papers").status_code == 200
    assert client.get("/api/health").json()["lan"] is True


def test_lan_rejects_public_clients_and_cross_site_writes(tmp_path):
    assert lan_client(tmp_path, host="8.8.8.8").get(f"/?key={KEY}").status_code == 403
    client = lan_client(tmp_path)
    client.get(f"/?key={KEY}")
    denied = client.post("/api/glossary", json={"en": "x", "zh": "y"}, headers={"origin": "http://evil.example"})
    assert denied.status_code == 403


def test_loopback_needs_no_key_in_lan_mode(tmp_path):
    client = TestClient(create_app(tmp_path, lan_token=KEY), base_url="http://127.0.0.1:8000")
    assert client.get("/api/health").status_code == 200
