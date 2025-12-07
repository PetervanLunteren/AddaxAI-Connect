"""
Shared library setup for AddaxAI Connect

This makes the shared package installable so services can import it.
"""
from setuptools import setup, find_packages

setup(
    name="addaxai-connect-shared",
    version="0.1.0",
    packages=find_packages(),
    install_requires=[
        "sqlalchemy>=2.0.0",
        "psycopg2-binary>=2.9.0",
        "redis>=5.0.0",
        "boto3>=1.34.0",
        "pydantic>=2.5.0",
        "pydantic-settings>=2.1.0",
        "geoalchemy2>=0.14.0",
    ],
)
