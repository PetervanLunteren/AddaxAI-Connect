"""Every link to the web app goes through Settings.app_url.

A server deployed with enable_ssl: false serves plain http, so a link
written as f"https://{domain}/..." does not open there (issue #83). The
scheme is decided in one place, shared/config.py app_url, and this test
fails when a hand-built link to the domain comes back.

Read as text on purpose, like test_compose_file.py, so it needs nothing
but the files.
"""
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ROOTS = ["services", "shared/shared", "scripts"]

# A scheme followed by an f-string placeholder that names a domain, such as
# {domain}, {domain_name} or {self.settings.domain_name}. Internal service
# addresses ({endpoint}, {settings.minio_endpoint}) are not links people
# open and do not match.
HAND_BUILT_LINK = re.compile(r"https?://\{[^}]*domain")


def python_files():
    for root in ROOTS:
        for path in (REPO / root).rglob("*.py"):
            if "__pycache__" not in path.parts:
                yield path


def test_no_hand_built_links_to_the_web_app():
    offenders = [
        f"{path.relative_to(REPO)}:{number}: {line.strip()}"
        for path in python_files()
        for number, line in enumerate(path.read_text().splitlines(), start=1)
        if HAND_BUILT_LINK.search(line)
    ]
    assert not offenders, (
        "Build links to the web app with settings.app_url(path):\n"
        + "\n".join(offenders)
    )


def test_the_pattern_catches_what_it_should():
    assert HAND_BUILT_LINK.search('f"https://{domain}/login"')
    assert HAND_BUILT_LINK.search('f"https://{self.settings.domain_name}/login"')
    assert HAND_BUILT_LINK.search('f"http://{domain_name}/register"')
    assert not HAND_BUILT_LINK.search('f"http://{settings.minio_endpoint}"')
