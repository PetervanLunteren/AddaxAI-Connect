"""
Unit tests for the Telegram Markdown escaper.
"""
from text_format import md_escape


class TestMdEscape:
    def test_plain_text_unchanged(self):
        assert md_escape("Duinpoort NW") == "Duinpoort NW"

    def test_markup_characters_replaced_with_lookalikes(self):
        out = md_escape("Site *ZW* a_b`c[d")
        # None of the four legacy-Markdown markers survive
        for ch in ("*", "_", "`", "["):
            assert ch not in out

    def test_empty_and_none_safe(self):
        assert md_escape("") == ""
        assert md_escape(None) is None

    def test_odd_asterisk_no_longer_contains_asterisk(self):
        # The exact case that made Telegram reject the message with HTTP 400
        assert "*" not in md_escape("Duinpoort *ZW")

    def test_instar_underscore_device_id_preserved_visually(self):
        # INSTAR device ids carry an underscore; it must not stay a raw '_'
        out = md_escape("lat52.02368_lon12.98290")
        assert "_" not in out
        assert "lat52.02368" in out and "lon12.98290" in out
