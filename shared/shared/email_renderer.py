"""
Shared email template renderer for AddaxAI Connect.

Provides consistent HTML email generation across all services.
"""
import re
from typing import Tuple
from pathlib import Path
from jinja2 import Environment, FileSystemLoader


# Set up Jinja2 template environment
TEMPLATE_DIR = Path(__file__).parent / "templates"
_jinja_env = Environment(
    loader=FileSystemLoader(str(TEMPLATE_DIR)),
    autoescape=True
)


def render_email(template_name: str, **context) -> Tuple[str, str]:
    """
    Render an email template.

    Args:
        template_name: Template file name (e.g., 'email_verification.html')
        **context: Template variables

    Returns:
        Tuple of (html_content, plain_text_content)
    """
    template = _jinja_env.get_template(template_name)
    html_content = template.render(**context)
    text_content = _html_to_text(html_content)
    return html_content, text_content


def _html_to_text(html: str) -> str:
    """
    Convert HTML email to plain text fallback.

    Simple conversion that preserves readability.
    """
    text = html

    # Remove style tags and content
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)

    # Remove script tags and content
    text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL | re.IGNORECASE)

    # Convert links to text with URL
    text = re.sub(r'<a[^>]*href=["\']([^"\']*)["\'][^>]*>([^<]*)</a>',
                  r'\2 (\1)', text, flags=re.IGNORECASE)

    # Convert headers to text with emphasis
    text = re.sub(r'<h[1-6][^>]*>([^<]*)</h[1-6]>', r'\n\1\n' + '=' * 40 + '\n', text, flags=re.IGNORECASE)

    # Convert paragraphs and divs to newlines
    text = re.sub(r'<(?:p|div)[^>]*>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</(?:p|div)>', '\n', text, flags=re.IGNORECASE)

    # Convert line breaks
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)

    # Convert list items
    text = re.sub(r'<li[^>]*>', '\n- ', text, flags=re.IGNORECASE)

    # Remove all remaining HTML tags
    text = re.sub(r'<[^>]+>', '', text)

    # Decode common HTML entities
    text = text.replace('&nbsp;', ' ')
    text = text.replace('&amp;', '&')
    text = text.replace('&lt;', '<')
    text = text.replace('&gt;', '>')
    text = text.replace('&quot;', '"')
    text = text.replace('&#39;', "'")
    text = text.replace('&mdash;', '-')
    text = text.replace('&ndash;', '-')

    # Clean up whitespace
    text = re.sub(r'[ \t]+', ' ', text)  # Multiple spaces to single
    text = re.sub(r'\n\s*\n\s*\n+', '\n\n', text)  # Multiple newlines to double
    text = text.strip()

    return text
