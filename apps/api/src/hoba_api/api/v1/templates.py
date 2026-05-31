"""`/api/v1/templates` — built-in localized template catalog (F2/Phase 9)."""

from __future__ import annotations

from fastapi import APIRouter

from hoba_api.auth.dependencies import CurrentUser
from hoba_api.schemas.template import TemplateOut
from hoba_api.services.templates import localized_templates

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("", response_model=list[TemplateOut])
async def list_templates_endpoint(
    user: CurrentUser,
    locale: str = "en",
) -> list[TemplateOut]:
    # `user` gates the call behind initData validation like the rest of the
    # API; the catalog itself is identical for everyone.
    return localized_templates(locale)
