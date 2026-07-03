"""
In-memory cache for HVAC disaggregation results.

Optimization stores the full balance DataFrame + hvac_mode after running
disaggregation.  The forecast endpoint reads it, appends the forecasted day,
and re-runs disaggregation so the new day also gets an hvac_mode.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Optional

import pandas as pd


@dataclass
class SensorCache:
    """Cached disaggregation state for one sensor."""
    balance_df: pd.DataFrame          # full balance: consumption_kwh, tout (+ tin, rh …)
    hvac_mode: pd.Series              # int series aligned to balance_df.index
    updated_at: datetime = field(default_factory=datetime.utcnow)


_lock = threading.Lock()
_store: Dict[str, SensorCache] = {}   # key = "<country>_<site_id>"


def _key(country: str, site_id: int) -> str:
    return f"{country}_{site_id}"


def put(country: str, site_id: int, balance_df: pd.DataFrame, hvac_mode: pd.Series) -> None:
    """Store (or overwrite) cached disaggregation for a sensor."""
    with _lock:
        _store[_key(country, site_id)] = SensorCache(
            balance_df=balance_df.copy(),
            hvac_mode=hvac_mode.copy(),
        )


def get(country: str, site_id: int) -> Optional[SensorCache]:
    """Return cached state, or None if not yet populated."""
    with _lock:
        entry = _store.get(_key(country, site_id))
        if entry is None:
            return None
        # Return copies so callers can mutate freely
        return SensorCache(
            balance_df=entry.balance_df.copy(),
            hvac_mode=entry.hvac_mode.copy(),
            updated_at=entry.updated_at,
        )
