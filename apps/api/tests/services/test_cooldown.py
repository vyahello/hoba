"""Tests for the `cooldown_take` Redis primitive — Stage B B1.

`cooldown_take(key, ttl_ms)` claims a short-lived lock; the next call
within the TTL window returns False, after the TTL it returns True
again. Used to throttle `spin:trigger` per room so thumb-mashing the
SPIN hub can't shower duplicate spins.
"""

from __future__ import annotations

import asyncio

import pytest

from hoba_api.redis_client import cooldown_take


@pytest.mark.asyncio
async def test_first_take_succeeds() -> None:
    assert await cooldown_take("test:cooldown:a", ttl_ms=500) is True


@pytest.mark.asyncio
async def test_second_take_inside_window_fails() -> None:
    await cooldown_take("test:cooldown:b", ttl_ms=500)
    assert await cooldown_take("test:cooldown:b", ttl_ms=500) is False


@pytest.mark.asyncio
async def test_take_succeeds_again_after_ttl_expires() -> None:
    assert await cooldown_take("test:cooldown:c", ttl_ms=60) is True
    # Sleep slightly past the TTL — Redis MUST drop the key.
    await asyncio.sleep(0.1)
    assert await cooldown_take("test:cooldown:c", ttl_ms=60) is True


@pytest.mark.asyncio
async def test_different_keys_are_independent() -> None:
    await cooldown_take("test:cooldown:room1", ttl_ms=500)
    assert await cooldown_take("test:cooldown:room2", ttl_ms=500) is True
