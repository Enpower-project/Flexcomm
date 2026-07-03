import logging
import numpy as np
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pandas as pd

logger = logging.getLogger(__name__)

VIRTUAL_SITE_ID = -1
VIRTUAL_SITE_TZ = "Europe/Athens"

_CSV_PATH = Path(__file__).resolve().parent.parent / "House_07_processed.csv"

_CSV_COL_MAP = {
    "tin": "Tin",
    "rh": "RH",
    "hvac_mode": "hvac_mode",
    "tout": "Tout",
    "rh_out": "RH_out",
    "sw_out": "SW_out",
    "energy_consumption": "energy_consumption",
}

_df_cache: Optional[pd.DataFrame] = None


def is_virtual_site(site_id: int) -> bool:
    return int(site_id) == VIRTUAL_SITE_ID


def _load() -> pd.DataFrame:
    global _df_cache
    if _df_cache is not None:
        return _df_cache

    df = pd.read_csv(_CSV_PATH)
    df["timestamp"] = pd.to_datetime(df["timestamp"])

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    csv_end = df["timestamp"].max()
    csv_start = df["timestamp"].min()

    shift_years = now.year - csv_end.year
    shifted_start = csv_start + pd.DateOffset(years=shift_years)
    if now < shifted_start:
        shift_years -= 1

    df["timestamp"] = df["timestamp"] + pd.DateOffset(years=shift_years)
    df = df.sort_values("timestamp").reset_index(drop=True)

    logger.info(
        "Virtual site CSV loaded: %d rows, shifted +%d years, range %s to %s",
        len(df), shift_years, df["timestamp"].iloc[0], df["timestamp"].iloc[-1],
    )

    _df_cache = df
    return df


def get_virtual_optimizer_df() -> pd.DataFrame:
    """
    CSV mapped to the optimizer's column names, indexed by naive timestamp.
    Columns: tin, rh, hvac_mode, tout, sw_out, rh_out, energy_consumption.
    energy_consumption is converted Wh -> kWh.
    """
    df = _load()
    out = pd.DataFrame({
        "tin":                df["Tin"].values,
        "rh":                 df["RH"].values,
        "hvac_mode":          df["hvac_mode"].astype(int).values,
        "tout":               df["Tout"].values,
        "sw_out":             df["SW_out"].values,
        "rh_out":             df["RH_out"].values,
        "energy_consumption": (df["energy_consumption"] / 1000.0).values,
    }, index=pd.DatetimeIndex(df["timestamp"], name="timestamp"))
    return out


def _compute_comfort(tin: float, rh: float, month: int) -> float:
    from pythermalcomfort.models import pmv_ppd_iso
    from core.pilot_config import get_pilot

    gr = get_pilot("gr")
    if month in {6, 7, 8, 9}:
        clo = 0.5
    elif month in gr.cooling_months:
        clo = 0.7
    else:
        clo = 1.0
    result = pmv_ppd_iso(tdb=tin, tr=tin, vr=0.1, rh=rh, met=1.1, clo=clo)
    if result:
        ppd = float(result["ppd"])
        if ppd is None or np.isnan(ppd) or np.isinf(ppd):
            return 25.0
        return float(100.0 - ppd)
    return 25.0


def _strip_tz(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt


def get_virtual_timeseries(
    metrics: list[str],
    start_ts: datetime,
    end_ts: datetime,
) -> list[dict]:
    from utils.timezone_utils import get_site_timezone, utc_to_local

    site_tz = get_site_timezone(36.2333, 27.5667)
    df = _load()
    start_ts, end_ts = _strip_tz(start_ts), _strip_tz(end_ts)
    mask = (df["timestamp"] >= start_ts) & (df["timestamp"] <= end_ts)
    subset = df.loc[mask]

    need_comfort = "comfort_index" in metrics
    results = []
    for _, row in subset.iterrows():
        ts_py = row["timestamp"].to_pydatetime()
        entry = {"timestamp": utc_to_local(ts_py, site_tz)}
        for metric in metrics:
            if metric == "comfort_index":
                continue
            csv_col = _CSV_COL_MAP.get(metric)
            if csv_col and csv_col in df.columns:
                val = row[csv_col]
                if pd.isna(val):
                    entry[metric] = None
                elif metric == "energy_consumption":
                    entry[metric] = val / 1000.0
                else:
                    entry[metric] = val
        if need_comfort:
            tin = row.get("Tin")
            rh = row.get("RH")
            if pd.notna(tin) and pd.notna(rh):
                entry["comfort_index"] = _compute_comfort(float(tin), float(rh), ts_py.month)
            else:
                entry["comfort_index"] = None
        results.append(entry)

    return results


def get_virtual_latest(metrics: list[str]) -> dict:
    from utils.timezone_utils import get_site_timezone, utc_to_local

    site_tz = get_site_timezone(36.2333, 27.5667)
    df = _load()
    now = _strip_tz(datetime.now(timezone.utc))
    past = df[df["timestamp"] <= now]
    if past.empty:
        return {}

    row = past.iloc[-1]
    ts = row["timestamp"].to_pydatetime()
    ts_iso = utc_to_local(ts, site_tz).isoformat() if ts else None
    response = {}
    for metric in metrics:
        if metric == "comfort_index":
            continue
        csv_col = _CSV_COL_MAP.get(metric)
        if csv_col and csv_col in df.columns:
            val = row[csv_col]
            if pd.isna(val):
                val = None
            elif metric == "energy_consumption":
                val = val / 1000.0
            response[metric] = {"value": val, "timestamp": ts_iso}

    if "comfort_index" in metrics:
        tin = row.get("Tin")
        rh = row.get("RH")
        if pd.notna(tin) and pd.notna(rh):
            val = _compute_comfort(float(tin), float(rh), ts.month)
        else:
            val = None
        response["comfort_index"] = {"value": val, "timestamp": ts_iso}

    return response


def get_virtual_forecast(start_ts: datetime) -> list[dict]:
    import random
    from datetime import timedelta
    from utils.timezone_utils import get_site_timezone, utc_to_local

    site_tz = get_site_timezone(36.2333, 27.5667)
    df = _load()
    start_ts = _strip_tz(start_ts)
    prev_start = start_ts - timedelta(days=1)
    prev_end = start_ts - timedelta(minutes=30)

    mask = (df["timestamp"] >= prev_start) & (df["timestamp"] <= prev_end)
    subset = df.loc[mask]
    if subset.empty:
        return []

    horizon = pd.date_range(start=prev_start, end=prev_end, freq="30min")
    row_map = {
        r["timestamp"].to_pydatetime(): (r["energy_consumption"] / 1000.0, r["hvac_mode"])
        for _, r in subset.iterrows()
    }

    last_value = subset.iloc[0]["energy_consumption"] / 1000.0
    last_hvac = subset.iloc[0]["hvac_mode"]
    filled = []
    for ts in horizon:
        ts_naive = ts.to_pydatetime()
        if ts_naive in row_map:
            last_value, last_hvac = row_map[ts_naive]
        noise_factor = 1 + random.uniform(-0.02, 0.02)
        forecast_ts = utc_to_local(ts_naive + timedelta(days=1), site_tz)
        filled.append({
            "timestamp": forecast_ts.isoformat(),
            "value": last_value * noise_factor,
            "hvac_mode": last_hvac,
        })

    return filled
