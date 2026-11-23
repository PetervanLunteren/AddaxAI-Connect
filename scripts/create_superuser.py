#!/usr/bin/env python3
"""
Create or promote a server-admin user directly, password entered at the
prompt. No email, no invitation token.

Usage:
    python create_superuser.py [email]

Reads DATABASE_URL from the environment. Prompts for email if not passed
as an argument.
"""
import getpass
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "shared"))
sys.path.insert(0, str(Path(__file__).parent.parent / "services" / "api"))

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from fastapi_users.password import PasswordHelper

from shared.models import User
from shared.database import Base


def main():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL environment variable must be set")
        sys.exit(1)

    email = sys.argv[1] if len(sys.argv) > 1 else input("Email: ").strip()
    if not email:
        print("Email required")
        sys.exit(1)

    password = getpass.getpass("Password: ")
    if len(password) < 8:
        print("Password must be at least 8 characters")
        sys.exit(1)
    if password != getpass.getpass("Confirm password: "):
        print("Passwords don't match")
        sys.exit(1)

    engine = create_engine(database_url)
    Base.metadata.create_all(bind=engine)
    pwd_context = PasswordHelper()

    with Session(engine) as db:
        user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()

        if user:
            user.hashed_password = pwd_context.hash(password)
            user.is_active = True
            user.is_superuser = True
            user.is_verified = True
            db.commit()
            print(f"Updated {email}: active, verified, server-admin")
        else:
            user = User(
                email=email,
                hashed_password=pwd_context.hash(password),
                is_active=True,
                is_superuser=True,
                is_verified=True,
            )
            db.add(user)
            db.commit()
            print(f"Created {email}: active, verified, server-admin")


if __name__ == "__main__":
    main()
