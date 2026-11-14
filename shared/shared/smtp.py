"""
SMTP settings and message headers shared by every service that sends mail.

One rule for the connection: log in only when a username is set. Without one the server must
accept the mail on its own terms, for example Google's SMTP relay, which
accepts the IP addresses of known servers and needs no password at all.

Returns plain keyword arguments for aiosmtplib.send, so shared/ does not
depend on aiosmtplib itself.
"""
from email.message import Message
from email.utils import formatdate, make_msgid, parseaddr
from typing import Any, Dict

from shared.config import Settings


def stamp_headers(message: Message, mail_from: str) -> None:
    """Give the message the Date and Message-ID every real mail client sets.

    A relay passes a message on as it gets it. Without these two, Google
    fills them in and marks the ID SMTPIN_ADDED_MISSING, which spam filters
    count against the sender, Microsoft's most of all. The ID is made on the
    sender's own domain so it lines up with the From address.
    """
    domain = parseaddr(mail_from)[1].rpartition("@")[2] or None
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid(domain=domain)


def smtp_send_kwargs(settings: Settings) -> Dict[str, Any]:
    """Validate the mail settings and return the aiosmtplib.send arguments.

    Raises:
        ValueError: if the server, port or sender is missing, or if only one
            of username and password is set.
    """
    if not all([settings.mail_server, settings.mail_port, settings.mail_from]):
        raise ValueError(
            "Email configuration incomplete. Required: "
            "MAIL_SERVER, MAIL_PORT, MAIL_FROM"
        )

    # An empty MAIL_USERNAME= in .env arrives as "", and aiosmtplib logs in
    # for anything that is not None, so blank values become None here.
    username = settings.mail_username or None
    password = settings.mail_password or None
    if (username is None) != (password is None):
        raise ValueError(
            "Set MAIL_USERNAME and MAIL_PASSWORD together, or leave both "
            "empty for a server that needs no login"
        )

    implicit_tls = settings.mail_port == 465
    return {
        "hostname": settings.mail_server,
        "port": settings.mail_port,
        "username": username,
        "password": password,
        # Google's relay wants a real name in EHLO, not the container id.
        "local_hostname": settings.domain_name or None,
        "use_tls": implicit_tls,
        "start_tls": not implicit_tls,
    }
