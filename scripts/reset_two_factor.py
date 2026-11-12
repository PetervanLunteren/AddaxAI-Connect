"""
Switch two-factor login off for an account, from the server.

For the cases the app cannot solve itself:

- A server admin lost the phone and the recovery codes, and there is no other
  server admin to reset it in the app.
- JWT_SECRET changed, for example after a rebuild of the server with a new
  .env. The authenticator secrets are encrypted with a key derived from it
  (services/api/auth/two_factor.py), so no app code works any more. Use --all.

The account keeps its password. A user in a project that requires two-factor
login sets it up again at the next login.

It acts at once, there is no preview: it only ever switches two-factor off,
and the account is named on the command line. It sends no email, whoever runs
this is on the server and tells the user.

Usage (on a server):
    docker compose exec -T api python /app/scripts/reset_two_factor.py someone@example.org
    docker compose exec -T api python /app/scripts/reset_two_factor.py --all
"""
import argparse
import sys

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

# Add parent directory to path for imports (matches the other scripts).
sys.path.insert(0, '/app')

from shared.config import get_settings
from shared.logger import get_logger
from shared.models import User

settings = get_settings()
logger = get_logger("reset_two_factor")


def reset(db: Session, email: str | None) -> list[str]:
    """Clear two-factor for one account, or for every account when email is None.

    Returns the email addresses that had it on. An account with only an
    unfinished setup is cleared too, but not listed.
    """
    query = select(User).where(User.totp_secret.isnot(None))
    if email is not None:
        query = query.where(User.email == email)

    cleared = []
    for user in db.execute(query).scalars():
        if user.two_factor_enabled:
            cleared.append(user.email)
        user.clear_two_factor()
    db.commit()
    return cleared


def main() -> None:
    parser = argparse.ArgumentParser(description="Switch two-factor login off for an account")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("email", nargs="?", help="Email address of the account")
    target.add_argument("--all", action="store_true", help="Every account on this server")
    args = parser.parse_args()

    engine = create_engine(settings.database_url)
    with Session(engine) as db:
        if not args.all and db.execute(
            select(User.id).where(User.email == args.email)
        ).first() is None:
            sys.exit(f"No account with email address {args.email}")
        cleared = reset(db, None if args.all else args.email)

    if not cleared:
        print("Two-factor login was not on, nothing changed")
    for email in cleared:
        print(f"Two-factor login is off for {email}")
    logger.info("Two-factor login reset from the server", accounts=len(cleared), all=args.all)


if __name__ == "__main__":
    main()
