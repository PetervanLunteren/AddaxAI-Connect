"""The bot's reply to /start names the project a chat was linked to.

The Telegram link is per project, and one chat may hold the links of several
projects. A reply that only said "Successfully linked!" made three links in
one chat read as three replacements, so a user split over three projects
reported that he could not link them all to the same chat, while all three
were linked. The replies are sent without a parse_mode, so they must not
carry markdown either.
"""
import os
import sys

_TELEGRAM = os.path.join(
    os.path.dirname(__file__), "..", "..", "services", "notifications-telegram"
)
if _TELEGRAM not in sys.path:
    sys.path.insert(0, _TELEGRAM)

import worker  # noqa: E402


def test_linked_reply_names_the_project(monkeypatch):
    calls = []
    monkeypatch.setattr(
        worker, "handle_link_token",
        lambda token, chat_id: calls.append((token, chat_id)) or "Détection Loup Verviers",
    )
    reply = worker.start_reply("/start abc123", "865750000")
    assert calls == [("abc123", "865750000")]
    assert "Linked to project Détection Loup Verviers." in reply


def test_bad_token_reply(monkeypatch):
    monkeypatch.setattr(worker, "handle_link_token", lambda token, chat_id: None)
    reply = worker.start_reply("/start abc123", "865750000")
    assert "invalid, expired or already used" in reply


def test_plain_start_does_not_link(monkeypatch):
    def fail(token, chat_id):
        raise AssertionError("a /start without a token must not link")
    monkeypatch.setattr(worker, "handle_link_token", fail)
    reply = worker.start_reply("/start", "865750000")
    assert "865750000" in reply


def test_replies_carry_no_markdown(monkeypatch):
    for project_name in ("Verviers", None):
        monkeypatch.setattr(worker, "handle_link_token", lambda token, chat_id, r=project_name: r)
        for text in ("/start abc123", "/start"):
            reply = worker.start_reply(text, "865750000")
            assert "*" not in reply and "`" not in reply
