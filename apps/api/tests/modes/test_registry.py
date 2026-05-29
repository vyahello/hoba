from hoba_api.modes.registry import engine_for


def test_registry_known_modes() -> None:
    assert engine_for("classic").mode_id == "classic"
    assert engine_for("elimination").mode_id == "elimination"
    assert engine_for("punishment").mode_id == "punishment"


def test_registry_unknown_falls_back_to_classic() -> None:
    # chaos/rigged aren't built yet, so they fall back to Classic.
    for mode in ("chaos", "rigged", "nonsense"):
        assert engine_for(mode).mode_id == "classic"
