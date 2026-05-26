"""Tests for the `tg_id → user_id` Redis cache wiring.

The cache is the Stage A fix for the deferred Phase 2 TODO — every WS
reconnect previously re-ran the full upsert path. These tests prove:

  * cold path → DB upsert + cache write
  * warm path → cache hit + PK lookup, NO upsert work
  * stale cache (user deleted) → invalidate + fall through
  * TTL is set (we don't probe the exact value, just that EXPIRE is set)
"""

from __future__ import annotations

import fakeredis.aioredis
import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.auth.initdata import TelegramUser
from hoba_api.models.user import User
from hoba_api.redis_client import (
    _user_id_cache_key,
    presence_remove,
    presence_set,
    presence_user_ids,
    user_id_cache_get,
    user_id_cache_set,
)
from hoba_api.services.users import (
    cache_user_after_commit,
    resolve_telegram_user,
)


def _tg(tg_id: int = 100, first_name: str = "Volo") -> TelegramUser:
    return TelegramUser.model_validate(
        {
            "id": tg_id,
            "first_name": first_name,
            "last_name": "Y",
            "username": "vy",
            "language_code": "uk",
            "photo_url": None,
        },
    )


@pytest.mark.asyncio
async def test_cache_miss_falls_through_to_upsert(
    db: AsyncSession,
    fake_redis: fakeredis.aioredis.FakeRedis,
) -> None:
    user = await resolve_telegram_user(db, _tg(tg_id=1))
    await db.commit()
    await cache_user_after_commit(user)

    assert user.tg_id == 1
    cached = await fake_redis.get(_user_id_cache_key(1))
    assert cached == str(user.id)


@pytest.mark.asyncio
async def test_cache_hit_skips_upsert_and_keeps_last_active_at(
    db: AsyncSession,
) -> None:
    first = await resolve_telegram_user(db, _tg(tg_id=2, first_name="Old"))
    await db.commit()
    await cache_user_after_commit(first)

    last_active_before = first.last_active_at

    # Resolve again — should be a cache hit. The Telegram-side mutable
    # fields in our payload (first_name="New") must NOT propagate this
    # call, because we skipped the upsert.
    second = await resolve_telegram_user(db, _tg(tg_id=2, first_name="New"))
    assert second.id == first.id
    assert second.first_name == "Old"
    assert second.last_active_at == last_active_before


@pytest.mark.asyncio
async def test_stale_cache_pointer_invalidates_and_reupserts(
    db: AsyncSession,
    fake_redis: fakeredis.aioredis.FakeRedis,
) -> None:
    # Seed: legitimate user with cached pointer.
    user = await resolve_telegram_user(db, _tg(tg_id=3))
    await db.commit()
    await cache_user_after_commit(user)
    orig_id = user.id

    # Simulate row deletion under our feet (e.g. admin cleanup).
    await db.execute(delete(User).where(User.id == orig_id))
    await db.commit()

    # Cache still points at the dead id. resolve should drop the entry
    # and re-upsert the user (first_name="Reborn" propagates because we
    # now take the cache-miss path). SQLite may reuse the freed PK — we
    # don't pin the id, only the behavioral invariants.
    fresh = await resolve_telegram_user(db, _tg(tg_id=3, first_name="Reborn"))
    await db.commit()
    assert fresh.tg_id == 3
    assert fresh.first_name == "Reborn"

    # And the stale entry was actively invalidated (it gets re-set only
    # when the caller commits + caches — but we did neither yet).
    assert await fake_redis.get(_user_id_cache_key(3)) is None


@pytest.mark.asyncio
async def test_cache_ttl_is_set(
    fake_redis: fakeredis.aioredis.FakeRedis,
) -> None:
    await user_id_cache_set(99, 4242)
    ttl = await fake_redis.ttl(_user_id_cache_key(99))
    # FakeRedis returns -1 for "no TTL", -2 for "no key". Anything > 0
    # confirms an expire was set; we don't pin the exact 15 min value
    # to keep this test resilient to a future tuning change.
    assert ttl > 0


@pytest.mark.asyncio
async def test_cache_get_returns_none_for_missing_key(
    fake_redis: fakeredis.aioredis.FakeRedis,
) -> None:
    assert await user_id_cache_get(9999) is None


@pytest.mark.asyncio
async def test_cache_get_drops_poisoned_non_integer_value(
    fake_redis: fakeredis.aioredis.FakeRedis,
) -> None:
    await fake_redis.set(_user_id_cache_key(7), "not-an-int")
    assert await user_id_cache_get(7) is None
    # Poisoned entry was actively cleaned up.
    assert await fake_redis.get(_user_id_cache_key(7)) is None


@pytest.mark.asyncio
async def test_presence_user_ids_returns_live_users(
    fake_redis: fakeredis.aioredis.FakeRedis,
) -> None:
    room_id = 1234
    await presence_set(room_id, 11)
    await presence_set(room_id, 12)
    await presence_set(room_id, 13)
    await presence_set(room_id + 1, 999)  # different room — must not leak
    live = await presence_user_ids(room_id)
    assert live == {11, 12, 13}


@pytest.mark.asyncio
async def test_presence_remove_drops_user(
    fake_redis: fakeredis.aioredis.FakeRedis,
) -> None:
    room_id = 4242
    await presence_set(room_id, 1)
    await presence_set(room_id, 2)
    await presence_remove(room_id, 1)
    live = await presence_user_ids(room_id)
    assert live == {2}


@pytest.mark.asyncio
async def test_presence_user_ids_ignores_malformed_keys(
    fake_redis: fakeredis.aioredis.FakeRedis,
) -> None:
    # Defensive coverage for the `except ValueError: continue` branch.
    room_id = 5
    await presence_set(room_id, 1)
    # Manually seed a malformed key with the right prefix.
    await fake_redis.set(f"presence:{room_id}:not-an-int", "1")
    live = await presence_user_ids(room_id)
    assert live == {1}


@pytest.mark.asyncio
async def test_warm_cache_does_not_issue_select_by_tg_id(
    db: AsyncSession,
) -> None:
    # Belt-and-braces: prove the second call doesn't trip the
    # "SELECT WHERE tg_id" branch by checking that the existing-user
    # check (which would have run in upsert_from_telegram) didn't fire.
    # We assert this indirectly: any DB write between resolve and the
    # cached fetch would bump last_active_at, so equality there is the
    # signal.
    first = await resolve_telegram_user(db, _tg(tg_id=5))
    await db.commit()
    await cache_user_after_commit(first)
    initial_active = first.last_active_at

    for _ in range(5):
        again = await resolve_telegram_user(db, _tg(tg_id=5))
        assert again.last_active_at == initial_active

    rows = (await db.execute(select(User).where(User.tg_id == 5))).scalars().all()
    assert len(rows) == 1
