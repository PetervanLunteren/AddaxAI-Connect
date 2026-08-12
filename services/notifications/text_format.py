"""
Small formatting helpers shared by the notification message builders.
"""

# Telegram legacy Markdown (parse_mode 'Markdown') treats these four
# characters as entity markers and, unlike MarkdownV2, offers no working
# backslash escape. An unescaped '*' in a site or camera name breaks the
# bold rendering, and an odd count makes Telegram reject the whole message
# with HTTP 400, silently losing the alert. Since the character cannot be
# escaped, it is replaced with a visually identical code point that Telegram
# does not treat as markup, so the label still reads right and always sends.
_TELEGRAM_MD_LOOKALIKES = {
    "*": "∗",  # ∗ asterisk operator
    "_": "ˍ",  # ˍ modifier letter low macron
    "`": "ˋ",  # ˋ modifier letter grave accent
    "[": "［",  # ［ fullwidth left square bracket
}


def md_escape(text: str) -> str:
    """Make a user-controlled string safe for Telegram legacy Markdown.

    Only apply to values that come from users (site names, camera device
    ids, project names), never to the static message scaffolding, whose
    real '*' markers must keep working.
    """
    if not text:
        return text
    for ch, replacement in _TELEGRAM_MD_LOOKALIKES.items():
        text = text.replace(ch, replacement)
    return text
