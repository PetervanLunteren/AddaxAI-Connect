"""
Unit tests for the Telegram Markdown escaper.
"""
from text_format import md_escape


class TestMdEscape:
    def test_plain_text_unchanged(self):
        assert md_escape("Duinpoort NW") == "Duinpoort NW"

    def test_asterisk_escaped(self):
        assert md_escape("Site *ZW*") == "Site \\*ZW\\*"

    def test_underscore_escaped(self):
        assert md_escape("cam_01") == "cam\\_01"

    def test_backtick_and_bracket_escaped(self):
        assert md_escape("a`b[c") == "a\\`b\\[c"

    def test_empty_and_none_safe(self):
        assert md_escape("") == ""
        assert md_escape(None) is None

    def test_odd_asterisk_count_is_escaped(self):
        # The case that made Telegram reject the message with HTTP 400
        assert "\\*" in md_escape("Duinpoort *ZW")
        assert "*" not in md_escape("Duinpoort *ZW").replace("\\*", "")
