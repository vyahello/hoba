"""Async Redis client + presence + rate-limit helpers.

The Redis URL is read from `settings.redis_url`. In tests we set
`REDIS_URL=redis://nonexistent` and patch this module's helpers to
no-ops, so the rest of the code base can call them unconditionally.
"""

from __future__ import annotations

import redis.asyncio as redis_async
from redis.asyncio import Redis

from hoba_api.config import settings

_client: Redis | None = None


def get_redis() -> Redis:
    """Lazily construct (and reuse) the async Redis client."""
    global _client
    if _client is None:
        _client = redis_async.from_url(settings.redis_url, decode_responses=True)
    return _client


def set_redis_client_for_testing(client: Redis | None) -> None:
    """Inject a (fake) Redis client. Test-only — production has no callers."""
    global _client
    _client = client


# --- tg_id → user_id cache ----------------------------------------------
#
# Hot-path optimization for the auth dependency and WS connect handler.
# Both look up a user by `tg_id` on every request; with the cache a
# subsequent request inside the TTL window skips the `SELECT FROM users
# WHERE tg_id = ?` and the conditional upsert. Cache misses fall through
# to the normal upsert path. See spec §6.

_USER_ID_CACHE_TTL_SECONDS = 15 * 60


def _user_id_cache_key(tg_id: int) -> str:
    return f"user:tg:{tg_id}"


async def user_id_cache_get(tg_id: int) -> int | None:
    """Return the cached internal `user_id` for a Telegram id, or None."""
    raw = await get_redis().get(_user_id_cache_key(tg_id))
    if raw is None:
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        # Cache poisoning or a stale string entry — drop it and miss.
        await get_redis().delete(_user_id_cache_key(tg_id))
        return None


async def user_id_cache_set(tg_id: int, user_id: int) -> None:
    """Cache `tg_id → user_id` for `_USER_ID_CACHE_TTL_SECONDS`."""
    await get_redis().set(
        _user_id_cache_key(tg_id),
        str(user_id),
        ex=_USER_ID_CACHE_TTL_SECONDS,
    )


async def user_id_cache_invalidate(tg_id: int) -> None:
    """Drop a cache entry (e.g. when a user is deleted in tests)."""
    await get_redis().delete(_user_id_cache_key(tg_id))


# --- Presence ------------------------------------------------------------

_PRESENCE_TTL_SECONDS = 60


def _presence_key(room_id: int, user_id: int) -> str:
    return f"presence:{room_id}:{user_id}"


async def presence_set(room_id: int, user_id: int) -> None:
    """Mark a user as live in a room. Expires after `_PRESENCE_TTL_SECONDS`."""
    await get_redis().set(_presence_key(room_id, user_id), "1", ex=_PRESENCE_TTL_SECONDS)


async def presence_remove(room_id: int, user_id: int) -> None:
    await get_redis().delete(_presence_key(room_id, user_id))


async def presence_user_ids(room_id: int) -> set[int]:
    """Return the set of `user_id`s currently live in a room."""
    pattern = f"presence:{room_id}:*"
    ids: set[int] = set()
    async for key in get_redis().scan_iter(match=pattern):
        try:
            ids.add(int(key.rsplit(":", 1)[-1]))
        except ValueError:
            continue
    return ids


# --- Rate limit ----------------------------------------------------------


async def rate_limit_take(key: str, *, max_in_window: int, window_seconds: int) -> bool:
    """Consume a slot in a fixed-window counter. Returns True if under the cap."""
    r = get_redis()
    count = await r.incr(key)
    if count == 1:
        await r.expire(key, window_seconds)
    return int(count) <= max_in_window


# --- Cooldown lock -------------------------------------------------------
#
# Short-lived "is this action locked right now?" lock. Distinct from
# `rate_limit_take` (a fixed-window counter): cooldown is single-slot
# and the second taker simply waits out the TTL. Used to throttle
# `spin:trigger` per room — 1.5s between spins means thumb-mashing the
# SPIN hub can't fan out duplicate spin events.


async def cooldown_take(key: str, *, ttl_ms: int) -> bool:
    """Try to claim a one-slot lock that expires in `ttl_ms`.

    Returns True if the lock was claimed (caller proceeds), False if the
    lock was already held (caller bails with `rate_limited`).
    """
    # `SET key 1 NX PX <ttl>` is atomic — succeeds with True only when
    # the key didn't exist. redis-py's async client returns the same
    # truthy/None semantics as the raw Redis reply.
    result = await get_redis().set(key, "1", nx=True, px=ttl_ms)
    return bool(result)
