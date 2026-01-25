#!/usr/bin/env python3
"""
Create superuser account(s).

Usage:
    python create_superuser.py

Environment variables required:
    SUPERADMIN_EMAIL - Email address(es) for superuser(s), separated by semicolons (;)
                       Example: "admin@example.com" or "admin1@example.com;admin2@example.com"
    DATABASE_URL - PostgreSQL connection string
"""
import os
import sys
from pathlib import Path

# Add shared module to path
sys.path.insert(0, str(Path(__file__).parent.parent / "shared"))
sys.path.insert(0, str(Path(__file__).parent.parent / "services" / "api"))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from passlib.context import CryptContext

from shared.models import User
from shared.database import Base


# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def create_superuser(email: str, database_url: str) -> None:
    """
    Create superuser account.

    Args:
        email: Superuser email address
        database_url: PostgreSQL connection string

    Raises:
        ValueError: If email not provided or database connection fails
    """
    if not email:
        raise ValueError("SUPERADMIN_EMAIL environment variable must be set")

    if not database_url:
        raise ValueError("DATABASE_URL environment variable must be set")

    # Create engine and session
    engine = create_engine(database_url)

    # Create tables if they don't exist
    Base.metadata.create_all(bind=engine)

    with Session(engine) as db:
        # Check if superuser already exists
        result = db.execute(
            select(User).where(User.email == email)
        )
        existing_user = result.scalar_one_or_none()

        if existing_user:
            print(f"Superuser {email} already exists. Skipping creation.")

            # Ensure is_superuser flag is set
            if not existing_user.is_superuser:
                existing_user.is_superuser = True
                existing_user.is_verified = True
                existing_user.is_active = True
                db.commit()
                print(f"Updated {email} to superuser status.")

            return

        # Generate password (random, user should reset via forgot password)
        import secrets
        # Generate 24 bytes = ~32 chars after base64url encoding
        password = secrets.token_urlsafe(24)

        # Enforce bcrypt's 72-byte limit with explicit guard
        if len(password.encode('utf-8')) > 72:
            password = password[:72]

        # Create superuser
        hashed_password = pwd_context.hash(password)

        superuser = User(
            email=email,
            hashed_password=hashed_password,
            is_active=True,
            is_superuser=True,
            is_verified=True,  # Pre-verified
        )

        db.add(superuser)
        db.commit()
        db.refresh(superuser)

        print(f"✅ Superuser created: {email}")
        print(f"   Temporary password: {password}")
        print(f"   Please use 'Forgot Password' to set a permanent password.")
        print(f"   Note: Superusers are auto-verified and have full system access.")


def main():
    """Main entry point"""
    # Get environment variables
    emails_input = os.getenv("SUPERADMIN_EMAIL")
    database_url = os.getenv("DATABASE_URL")

    if not emails_input:
        print("❌ ERROR: SUPERADMIN_EMAIL environment variable not set")
        print("   Usage: SUPERADMIN_EMAIL=admin@example.com python create_superuser.py")
        print("   Multiple emails: SUPERADMIN_EMAIL='admin1@example.com;admin2@example.com'")
        sys.exit(1)

    if not database_url:
        print("❌ ERROR: DATABASE_URL environment variable not set")
        sys.exit(1)

    # Split by semicolon and strip whitespace
    emails = [email.strip() for email in emails_input.split(';') if email.strip()]

    if not emails:
        print("❌ ERROR: No valid email addresses found in SUPERADMIN_EMAIL")
        sys.exit(1)

    print(f"Creating {len(emails)} superuser(s)...\n")

    # Create each superuser
    failed = []
    for email in emails:
        try:
            create_superuser(email, database_url)
            print()  # Blank line between users
        except Exception as e:
            print(f"❌ ERROR: Failed to create superuser {email}: {e}")
            import traceback
            traceback.print_exc()
            failed.append(email)
            print()

    # Report results
    if failed:
        print(f"⚠️  Warning: {len(failed)} superuser(s) failed to create:")
        for email in failed:
            print(f"   - {email}")
        sys.exit(1)
    else:
        print(f"✅ All {len(emails)} superuser(s) processed successfully")


if __name__ == "__main__":
    main()
