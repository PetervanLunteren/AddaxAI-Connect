"""Tests for shared.email_renderer._html_to_text conversion."""
from shared.email_renderer import _html_to_text


class TestHtmlToText:
    """Verify HTML-to-text regex conversions."""

    def test_strips_html_tags(self):
        assert "hello" in _html_to_text("<b>hello</b>")
        assert "<b>" not in _html_to_text("<b>hello</b>")

    def test_removes_style_tags(self):
        html = "<style>body{color:red}</style>Hello"
        result = _html_to_text(html)
        assert "color" not in result
        assert "Hello" in result

    def test_removes_script_tags(self):
        html = "<script>alert('xss')</script>Safe"
        result = _html_to_text(html)
        assert "alert" not in result
        assert "Safe" in result

    def test_converts_links(self):
        html = '<a href="https://example.com">Click here</a>'
        result = _html_to_text(html)
        assert "Click here" in result
        assert "https://example.com" in result

    def test_decodes_html_entities(self):
        html = "Tom &amp; Jerry &lt;3&gt;"
        result = _html_to_text(html)
        assert "Tom & Jerry <3>" in result
