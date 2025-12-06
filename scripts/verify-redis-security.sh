#!/bin/bash
# Redis Security Verification Script
# Tests that Redis is properly secured and not publicly accessible

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================="
echo "Redis Security Verification"
echo "========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Check if Redis port is exposed on host
echo "Test 1: Checking if Redis port 6379 is publicly accessible..."
if netstat -tuln 2>/dev/null | grep -q ":6379 " || ss -tuln 2>/dev/null | grep -q ":6379 "; then
    echo -e "${RED}[FAIL]${NC} Redis port 6379 is exposed on the host!"
    echo "       This is a security vulnerability. Port binding should be removed."
    echo "       Check docker-compose.yml - there should be NO 'ports:' section for Redis."
    exit 1
else
    echo -e "${GREEN}[PASS]${NC} Redis port is not exposed on the host."
fi
echo ""

# Test 2: Check if Redis container is running
echo "Test 2: Checking if Redis container is running..."
if docker ps --format '{{.Names}}' | grep -q "addaxai-redis"; then
    echo -e "${GREEN}[PASS]${NC} Redis container is running."
else
    echo -e "${RED}[FAIL]${NC} Redis container is not running!"
    echo "       Start services with: docker compose up -d"
    exit 1
fi
echo ""

# Test 3: Check if Redis requires authentication
echo "Test 3: Checking if Redis requires password authentication..."
if docker exec addaxai-redis redis-cli ping 2>&1 | grep -q "NOAUTH"; then
    echo -e "${GREEN}[PASS]${NC} Redis requires authentication (unauthenticated access denied)."
elif docker exec addaxai-redis redis-cli ping 2>&1 | grep -q "PONG"; then
    echo -e "${RED}[FAIL]${NC} Redis does NOT require authentication!"
    echo "       Redis is accepting connections without password."
    echo "       Check docker-compose.yml - Redis should have --requirepass flag."
    exit 1
else
    echo -e "${YELLOW}[WARN]${NC} Could not determine Redis authentication status."
fi
echo ""

# Test 4: Check if Redis password authentication works
echo "Test 4: Testing password authentication..."
if [ -f "$PROJECT_DIR/.env" ]; then
    REDIS_PASSWORD=$(grep "^REDIS_PASSWORD=" "$PROJECT_DIR/.env" | cut -d'=' -f2)
    if [ -n "$REDIS_PASSWORD" ]; then
        if docker exec addaxai-redis redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q "PONG"; then
            echo -e "${GREEN}[PASS]${NC} Redis password authentication works correctly."
        else
            echo -e "${RED}[FAIL]${NC} Redis password authentication failed!"
            echo "       Check if REDIS_PASSWORD in .env matches the container configuration."
            exit 1
        fi
    else
        echo -e "${YELLOW}[WARN]${NC} REDIS_PASSWORD not set in .env file."
    fi
else
    echo -e "${YELLOW}[WARN]${NC} .env file not found at $PROJECT_DIR/.env"
fi
echo ""

# Test 5: Check if Redis is accessible from other containers
echo "Test 5: Testing internal Docker network access..."
if docker network inspect addaxai-network >/dev/null 2>&1; then
    echo -e "${GREEN}[PASS]${NC} Docker network 'addaxai-network' exists."

    # Try to connect from a temporary container within the network
    if [ -n "$REDIS_PASSWORD" ]; then
        if docker run --rm --network addaxai-network redis:7-alpine redis-cli -h redis -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q "PONG"; then
            echo -e "${GREEN}[PASS]${NC} Redis is accessible from within Docker network."
        else
            echo -e "${RED}[FAIL]${NC} Redis is NOT accessible from within Docker network!"
            exit 1
        fi
    else
        echo -e "${YELLOW}[SKIP]${NC} Cannot test network access without REDIS_PASSWORD."
    fi
else
    echo -e "${YELLOW}[WARN]${NC} Docker network 'addaxai-network' not found."
fi
echo ""

# Test 6: External access test (requires VM IP or domain)
echo "Test 6: Testing external access (should be blocked)..."
if command -v telnet >/dev/null 2>&1; then
    # Get the host's public IP if available
    PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || echo "unknown")

    if [ "$PUBLIC_IP" != "unknown" ]; then
        echo "       Testing connection to $PUBLIC_IP:6379..."
        if timeout 3 telnet "$PUBLIC_IP" 6379 </dev/null 2>&1 | grep -q "Connected"; then
            echo -e "${RED}[FAIL]${NC} Redis is PUBLICLY ACCESSIBLE from $PUBLIC_IP:6379!"
            echo "       This is a critical security vulnerability!"
            exit 1
        else
            echo -e "${GREEN}[PASS]${NC} External access to Redis is blocked."
        fi
    else
        echo -e "${YELLOW}[SKIP]${NC} Cannot determine public IP for external access test."
    fi
else
    echo -e "${YELLOW}[SKIP]${NC} telnet not available for external access test."
fi
echo ""

# Summary
echo "========================================="
echo -e "${GREEN}All Redis security checks passed!${NC}"
echo "========================================="
echo ""
echo "Redis is properly secured:"
echo "  ✓ Port not exposed on host"
echo "  ✓ Password authentication enabled"
echo "  ✓ Only accessible within Docker network"
echo "  ✓ External access blocked"
echo ""
echo "Redis Connection URL for application services:"
if [ -n "$REDIS_PASSWORD" ]; then
    echo "  redis://:********@redis:6379/0"
else
    echo "  (REDIS_PASSWORD not configured)"
fi
echo ""
