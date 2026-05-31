"""Template service — resolve catalog defs to a locale + instantiate as rooms.

The catalog (`hoba_api.templates.catalog`) is the static source of truth.
This layer (a) localizes a `TemplateDef` into the wire schema for a given
locale, and (b) turns a template into a fresh room via `create_room`,
reusing `RoomServiceError` so the REST layer maps codes uniformly.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from hoba_api.models.room import Room
from hoba_api.schemas.template import TemplateOut, TemplateSegmentOut
from hoba_api.services.rooms import RoomServiceError, SegmentDraft, create_room
from hoba_api.templates.catalog import (
    TemplateDef,
    get_template,
    list_templates,
    resolve_locale,
)


def localize_template(template: TemplateDef, locale: str) -> TemplateOut:
    """Resolve a catalog def to the wire schema in one supported locale."""
    loc = resolve_locale(locale)
    return TemplateOut(
        key=template.key,
        category=template.category,
        emoji=template.emoji,
        gradient=template.gradient,
        title=template.title[loc],
        segments=[
            TemplateSegmentOut(
                key=s.key,
                label=s.label[loc],
                emoji=s.emoji,
                color_seed=s.color_seed,
            )
            for s in template.segments
        ],
    )


def localized_templates(locale: str) -> list[TemplateOut]:
    """The whole catalog resolved to one locale, in Home display order."""
    return [localize_template(t, locale) for t in list_templates()]


async def create_room_from_template(
    session: AsyncSession,
    *,
    host_id: int,
    template_key: str,
    locale: str = "en",
    game_mode: str = "classic",
    punishment_deck: str | None = None,
    spin_count: int = 1,
) -> Room:
    """Build a room from a built-in template (canonical, server-resolved)."""
    template = get_template(template_key)
    if template is None:
        raise RoomServiceError("template_not_found")
    loc = resolve_locale(locale)
    drafts = [
        SegmentDraft(
            label=s.label[loc],
            emoji=s.emoji,
            color_seed=s.color_seed,
            weight=1,
        )
        for s in template.segments
    ]
    return await create_room(
        session,
        host_id=host_id,
        question_text=template.title[loc],
        segments=drafts,
        game_mode=game_mode,
        punishment_deck=punishment_deck,
        spin_count=spin_count,
    )
