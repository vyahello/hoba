"""Built-in localized templates (spec §8, F2, Phase 9).

Templates are the curated wheels that seed the Home screen — the
"expanded Quick Wheels". They're static, server-owned, and localized
(EN + UK baked in), so they can grow without a client deploy and serve
as the canonical segment set when instantiated as a room
(`POST /rooms/from-template`).
"""

from hoba_api.templates.catalog import (
    SUPPORTED_LOCALES,
    TemplateDef,
    TemplateSegmentDef,
    get_template,
    list_templates,
    resolve_locale,
)

__all__ = [
    "SUPPORTED_LOCALES",
    "TemplateDef",
    "TemplateSegmentDef",
    "get_template",
    "list_templates",
    "resolve_locale",
]
