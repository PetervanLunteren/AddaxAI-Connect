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


class TestLabelsRemovedEmail:
    """The email a rule owner gets when labels left a project."""

    def _render(self, **context):
        from shared.email_renderer import render_email

        values = dict(
            project_name="Namibia", labels=["porcupine"], rules_updated=0, rules_deleted=0,
            notifications_url="https://connect.example.org/projects/4/notifications",
        )
        values.update(context)
        return render_email("labels_removed.html", **values)

    def test_one_label_and_one_updated_rule(self):
        html, text = self._render(rules_updated=1)
        assert "This label no longer exists" in text
        assert "porcupine" in text
        assert "1 of your notifications no longer uses it and still works for its other labels" in text
        assert "deleted" not in text
        assert "https://connect.example.org/projects/4/notifications" in html

    def test_several_labels_and_deleted_rules(self):
        _, text = self._render(labels=["red_deer", "wolf"], rules_updated=2, rules_deleted=3)
        assert "These labels no longer exist" in text
        assert "red deer" in text and "red_deer" not in text
        assert "2 of your notifications no longer use them and still work for their other labels" in text
        assert "3 notifications had no other label and were deleted" in text

    def test_one_deleted_rule(self):
        _, text = self._render(rules_deleted=1)
        assert "1 notification had no other label and was deleted" in text
        assert "of your notifications" not in text
