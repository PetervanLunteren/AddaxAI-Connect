"""Guards on docker-compose.yml that a review can miss.

Docker writes its own iptables rules and bypasses ufw, so a port published
as "8000:8000" is open to the internet even when the firewall says no. That
is how the API and the frontend ended up reachable over plain HTTP on every
server until Nov 2026. Every published port must be bound to 127.0.0.1;
nginx on the host is the only way in.

Read as text on purpose, so this needs no YAML library in CI.
"""
import re
from pathlib import Path

COMPOSE = Path(__file__).resolve().parents[2] / "docker-compose.yml"


def service_blocks() -> dict[str, list[str]]:
    """The lines of each service under the top-level `services:` key."""
    blocks: dict[str, list[str]] = {}
    section = None
    current = None
    for line in COMPOSE.read_text().splitlines():
        if re.match(r"^[a-z]", line):
            section = line.rstrip(":")
            current = None
            continue
        if section != "services":
            continue
        name = re.match(r"^  ([a-z0-9-]+):$", line)
        if name:
            current = name.group(1)
            blocks[current] = []
        elif current:
            blocks[current].append(line)
    return blocks


def published_ports(lines: list[str]) -> list[str]:
    """The entries under a service's `ports:` key, comments skipped."""
    ports, inside = [], False
    for line in lines:
        if re.match(r"^    ports:\s*$", line):
            inside = True
            continue
        if inside:
            entry = re.match(r'^      - "?([^"#\s]+)"?', line)
            if entry:
                ports.append(entry.group(1))
            elif re.match(r"^      #", line) or not line.strip():
                continue
            else:
                inside = False
    return ports


def test_parser_finds_the_services():
    blocks = service_blocks()
    assert {"api", "frontend", "minio", "postgres"} <= blocks.keys()


def test_every_published_port_is_loopback_only():
    found = 0
    for name, lines in service_blocks().items():
        for port in published_ports(lines):
            found += 1
            assert port.startswith("127.0.0.1:"), (
                f"{name} publishes {port} on all interfaces. Docker bypasses ufw, "
                f"so bind it to 127.0.0.1 and let nginx proxy it."
            )
    # The api, frontend and minio publish ports; if none are found the parser broke.
    assert found >= 3

