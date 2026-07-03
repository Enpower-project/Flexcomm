"""
Per-pilot configuration.

Usage:
    from core.pilot_config import get_pilot, PILOTS

    pilot = get_pilot("hu")
    print(pilot.sites)          # {1: SiteInfo(...), 2: ...}
    print(pilot.timezone)       # "Europe/Budapest"
    print(pilot.data_source)    # "api"
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, FrozenSet, Literal, Optional, Tuple

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


# ── Per-site metadata ────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SiteInfo:
    name: str
    minio_key: str = ""
    pv_kwp: float = 0.0
    ac_kw: float = 0.0
    is_residential: bool = True
    pv_opening_hour: int = 6
    pv_closing_hour: int = 18
    sensor_uuid: str = ""          # resolved from env at startup (HU only)
    # HVAC disaggregation calibration params (HU only)
    neutral_band: Optional[Tuple[int, int]] = None
    active_ratio: Optional[float] = None
    high_ratio: Optional[float] = None
    min_high_abs: Optional[float] = None
    min_active_abs: Optional[float] = None
    disagg_q: Optional[float] = None


# ── Pilot-level config ───────────────────────────────────────────────────────

@dataclass(frozen=True)
class PilotConfig:
    code: str                                       # "gr" or "hu"
    display_name: str
    timezone: str
    latitude: float
    longitude: float
    data_source: Literal["db", "api"]               # gr reads from DB, hu from API
    api_base_url: str = ""                           # only for api-sourced pilots
    sites: Dict[int, SiteInfo] = field(default_factory=dict)
    cooling_months: FrozenSet[int] = frozenset({6, 7, 8, 9})
    heating_months: FrozenSet[int] = frozenset({1, 2, 3, 4, 5, 10, 11, 12})

    def thermal_regime(self, month: int) -> str:
        """Return 'cooling' or 'heating' for a given month."""
        return "cooling" if month in self.cooling_months else "heating"


# ── Greek pilot (Chalki) ─────────────────────────────────────────────────────

GR = PilotConfig(
    code="gr",
    display_name="Chalki Island",
    timezone="Europe/Athens",
    latitude=36.2333,
    longitude=27.5667,
    data_source="db",
    sites={
        1: SiteInfo(name="Dimarxeio_sunedriaston", minio_key="dimarxeio", is_residential=False),
        2: SiteInfo(name="Dimarxeio_rack",          is_residential=False),
        3: SiteInfo(name=os.getenv("GR_SITE_3_NAME", "gr_site_3")),
        4: SiteInfo(name=os.getenv("GR_SITE_4_NAME", "gr_site_4")),
        5: SiteInfo(name="Super_market",             is_residential=False),
        6: SiteInfo(name="Cafeteria",                is_residential=False),
        7: SiteInfo(name="Osmosi",                is_residential=False),
        8: SiteInfo(name="Hotel",                is_residential=False),
        -1: SiteInfo(name="Summer_Home", minio_key="summer_home", is_residential=True),
    },
    cooling_months=frozenset({5, 6, 7, 8, 9, 10}),
    heating_months=frozenset({1, 2, 3, 4, 11, 12}),
)


# ── Hungarian pilot (Békéscsaba) ──────────────────────────────────────────────

def _hu_sites() -> Dict[int, SiteInfo]:
    """
    Build HU site dict, resolving sensor UUIDs from env vars.
    Falls back to the env-var key name if not set (for testing).
    """
    import os

    # (env_key, pv_kwp, ac_kw, is_residential)
    _defs = {
        1: ("sensor_id_1", 4.75,  5.0,  True),
        2: ("sensor_id_2", 11.0,  10.0, False),
        3: ("sensor_id_3", 4.35,  5.0,  True),
        4: ("sensor_id_4", 5.14,  5.0,  False),
        5: ("sensor_id_5", 5.94,  10.0, True),
        6: ("sensor_id_6", 5.0,   3.0,  True),
        7: ("sensor_id_7", 3.28,  3.0,  True),
        8: ("sensor_id_8", 7.7,   7.0,  False),
        9: ("sensor_id_9", 8.25,  8.2,  False),
    }
    # HVAC disaggregation calibration params per sensor
    # (neutral_band, active_ratio, high_ratio, min_high_abs, min_active_abs, q)
    _disagg = {
        1: ((35, 70), 0.15, 0.55, 0.112,  0.026,  0.1),
        2: ((35, 70), 0.05, 0.55, 0.052,  0.020,  0.1),
        3: ((35, 70), 0.05, 0.55, 0.060,  0.014,  0.1),
        4: ((35, 70), 0.05, 0.55, 0.068,  0.024,  0.1),
        5: ((35, 70), 0.05, 0.55, 0.112,  0.0196, 0.1),
        6: ((35, 70), 0.15, 0.55, 0.112,  0.024,  0.2),
        7: ((35, 70), 0.05, 0.55, 0.049,  0.012,  0.1),
        8: ((35, 70), 0.05, 0.55, 0.12,   0.03,   0.1),
        9: ((35, 70), 0.05, 0.55, 0.108,  0.044,  0.1),
    }
    sites = {}
    for sid, (env_key, kwp, ac, res) in _defs.items():
        uuid = os.getenv(env_key, "")
        nb, ar, hr, mha, maa, q = _disagg[sid]
        sites[sid] = SiteInfo(
            name=env_key, minio_key=f"df_{sid}", pv_kwp=kwp, ac_kw=ac,
            is_residential=res, sensor_uuid=uuid,
            neutral_band=nb, active_ratio=ar, high_ratio=hr,
            min_high_abs=mha, min_active_abs=maa, disagg_q=q,
        )
    return sites


HU = PilotConfig(
    code="hu",
    display_name="Békéscsaba Energy Community",
    timezone="Europe/Budapest",
    latitude=46.6834,
    longitude=21.0887,
    data_source="api",
    api_base_url="https://energiakozosseg.bcsenergia.hu/api",
    sites=_hu_sites(),
)


# ── Registry ──────────────────────────────────────────────────────────────────

PILOTS: Dict[str, PilotConfig] = {"gr": GR, "hu": HU}


def get_pilot(code: str) -> PilotConfig:
    key = code.lower()
    if key not in PILOTS:
        raise ValueError(f"Unknown pilot '{code}'. Available: {list(PILOTS.keys())}")
    return PILOTS[key]
