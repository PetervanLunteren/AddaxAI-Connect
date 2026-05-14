"""
Dev-server detection for the dev-user-purge tooling.

The deny-list lives in source so a wrong .env cannot disable the second gate.
"""
from fastapi import HTTPException, status

PROD_DOMAINS = frozenset({
    "addaxai.com",
    "www.addaxai.com",
    "demo.addaxai.com",
})


def is_dev_server(domain: str | None) -> bool:
    if not domain:
        return False
    d = domain.strip().lower()
    if d in PROD_DOMAINS:
        return False
    return d.startswith("dev")


def assert_dev_server(domain: str | None) -> None:
    if not is_dev_server(domain):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Refusing purge, this is not a dev server",
        )
