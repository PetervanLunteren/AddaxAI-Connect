"""
Small formatting helpers shared by the notification message builders.
"""


def md_escape(text: str) -> str:
    """Escape a user-controlled string for Telegram legacy Markdown.

    The delivery worker sends with parse_mode 'Markdown'. Legacy Markdown
    treats '_', '*', '`', and '[' as entity markers; an unescaped '*' in a
    site or camera name breaks the bold rendering, and an odd number of
    them makes Telegram reject the whole message with HTTP 400, which
    silently loses the alert. Legacy Markdown supports backslash escaping
    for exactly these four characters, so prepend a backslash to each.

    Only apply to values that come from users (site names, camera device
    ids, project names), never to the static message scaffolding.
    """
    if not text:
        return text
    for ch in ("_", "*", "`", "["):
        text = text.replace(ch, "\\" + ch)
    return text
