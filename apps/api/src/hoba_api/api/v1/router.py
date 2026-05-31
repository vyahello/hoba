"""v1 router aggregator — mount sub-routers here as they land."""

from __future__ import annotations

from fastapi import APIRouter

from hoba_api.api.v1 import me, rooms, wheels

router = APIRouter(prefix="/api/v1")
router.include_router(me.router)
router.include_router(rooms.router)
router.include_router(wheels.router)
