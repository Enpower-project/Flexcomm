"""
Hungary pilot utilities — Békéscsaba Energy Community
=====================================================
Fetches sensor data from the Békéscsaba API, computes PV production
on the fly from Open-Meteo weather, and derives consumption via
energy balance.

No database involved — all data comes from the external API.
"""

from __future__ import annotations

import os
import warnings
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
import requests

from core.pilot_config import get_pilot, SiteInfo


# ── Constants ────────────────────────────────────────────────────────────────

_HU = get_pilot("hu")

NOCT = 45.0     # °C  (Nominal Operating Cell Temperature)
BETA = 0.004    # 1/°C (temperature coefficient)
T_REF = 25.0    # °C  (reference temperature)

OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast"

# ═════════════════════════════════════════════════════════════════════════════
#  1. FETCH SENSOR DATA FROM BÉKÉSCSABA API
# ═════════════════════════════════════════════════════════════════════════════

def fetch_sensor_month(
    sensor_id: str,
    month: str,
    *,
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
) -> List[dict]:
    """
    Fetch one month of raw readings for a single sensor.

    Parameters
    ----------
    sensor_id : str
        The sensor identifier on the Békéscsaba platform.
    month : str
        "YYYY-MM" format.
    api_key : str, optional
        Bearer token. Falls back to API_KEY env var.
    base_url : str, optional
        API root. Falls back to pilot config.

    Returns
    -------
    list[dict]
        Flat list of reading dicts with keys:
        ts, imp_delta_kwh, exp_delta_kwh, hum_in, temp_in
    """
    api_key = api_key or os.getenv("API_KEY")
    if not api_key:
        raise ValueError("No API_KEY provided or set in environment")

    base_url = base_url or _HU.api_base_url
    url = f"{base_url}/monthly-data"

    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {api_key}"},
        params={"sensor": sensor_id, "month": month},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    # Empty response
    if isinstance(data, list):
        return []

    # Flatten: { sensor_id: { date: { time_range: [reading] } } }
    rows = []
    for _sid, dates in data.items():
        for _date, time_ranges in dates.items():
            for _tr, readings in time_ranges.items():
                for r in readings:
                    rows.append({
                        "ts": r["ts"],
                        "imp_delta_kwh": float(r["imp_delta_kwh"]),
                        "exp_delta_kwh": float(r["exp_delta_kwh"]),
                        "hum_in": float(r["hum_in"]) if r.get("hum_in") is not None else None,
                        "temp_in": float(r["temp_in"]) if r.get("temp_in") is not None else None,
                    })
    return rows


def fetch_sensor_range(
    sensor_id: str,
    start_month: str,
    end_month: str,
    **kwargs,
) -> pd.DataFrame:
    """
    Fetch multiple months for one sensor and return a 30-min resampled
    DataFrame indexed by UTC timestamp.

    Columns: imp_delta_kwh, exp_delta_kwh, hum_in, temp_in
    """
    from dateutil.relativedelta import relativedelta

    current = datetime.strptime(start_month, "%Y-%m")
    end = datetime.strptime(end_month, "%Y-%m")

    all_rows: List[dict] = []
    while current <= end:
        month_str = current.strftime("%Y-%m")
        all_rows.extend(fetch_sensor_month(sensor_id, month_str, **kwargs))
        current += relativedelta(months=1)

    if not all_rows:
        return pd.DataFrame()

    df = pd.DataFrame(all_rows)
    df["ts"] = pd.to_datetime(df["ts"])
    df = df.drop_duplicates("ts").sort_values("ts").set_index("ts")
    return _resample_30min(df)


def parse_sensor_readings(raw_json: dict) -> pd.DataFrame:
    """
    Parse a single API response (one month) into a 30-min resampled DataFrame.

    Parameters
    ----------
    raw_json : dict
        The JSON body from GET /monthly-data, shaped as:
        { sensor_id: { date: { time_range: [reading] } } }

    Returns
    -------
    pd.DataFrame
        30-min resampled, UTC-indexed.
    """
    if isinstance(raw_json, list):
        return pd.DataFrame()

    rows = []
    for _sid, dates in raw_json.items():
        for _date, time_ranges in dates.items():
            for _tr, readings in time_ranges.items():
                for r in readings:
                    rows.append({
                        "ts": r["ts"],
                        "imp_delta_kwh": float(r["imp_delta_kwh"]),
                        "exp_delta_kwh": float(r["exp_delta_kwh"]),
                        "hum_in": float(r["hum_in"]) if r.get("hum_in") is not None else None,
                        "temp_in": float(r["temp_in"]) if r.get("temp_in") is not None else None,
                    })

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df["ts"] = pd.to_datetime(df["ts"])
    df = df.drop_duplicates("ts").sort_values("ts").set_index("ts")
    return _resample_30min(df)


def _resample_30min(df: pd.DataFrame) -> pd.DataFrame:
    """Resample sub-30-min data to 30-min buckets (sum energy, mean climate)."""
    energy = df[["imp_delta_kwh", "exp_delta_kwh"]].resample("30min").sum()
    climate = df[["hum_in", "temp_in"]].resample("30min").mean()
    return pd.concat([energy, climate], axis=1)


# ═════════════════════════════════════════════════════════════════════════════
#  2. WEATHER (Open-Meteo)
# ═════════════════════════════════════════════════════════════════════════════

def fetch_weather(
    start_date: str,
    end_date: str,
    lat: float = _HU.latitude,
    lon: float = _HU.longitude,
) -> pd.DataFrame:
    """
    Fetch hourly GHI + temperature + relative humidity from Open-Meteo.

    Automatically routes to archive vs forecast API based on dates.
    Returns UTC-indexed DataFrame with columns: ghi, temperature_2m, relative_humidity_2m
    """
    hourly_vars = ["shortwave_radiation", "temperature_2m", "relative_humidity_2m"]
    start_dt = date.fromisoformat(start_date)
    end_dt = date.fromisoformat(end_date)
    today = date.today()
    forecast_limit = today - timedelta(days=92)

    chunks: list[pd.DataFrame] = []

    # Archive chunk
    if start_dt < forecast_limit:
        archive_end = min(end_dt, forecast_limit - timedelta(days=1))
        if archive_end >= start_dt:
            chunks.append(_fetch_open_meteo(
                url=OPEN_METEO_ARCHIVE,
                start=start_dt, end=archive_end,
                lat=lat, lon=lon, hourly_vars=hourly_vars,
            ))

    # Forecast chunk
    forecast_start = max(start_dt, forecast_limit)
    if end_dt >= forecast_start:
        chunks.append(_fetch_open_meteo(
            url=OPEN_METEO_FORECAST,
            start=forecast_start, end=end_dt,
            lat=lat, lon=lon, hourly_vars=hourly_vars,
        ))

    if not chunks:
        raise ValueError(f"No weather data fetched for {start_date} → {end_date}")

    df = pd.concat(chunks).sort_index()
    df = df[~df.index.duplicated(keep="first")]
    return df


def _fetch_open_meteo(
    *, url: str, start: date, end: date,
    lat: float, lon: float, hourly_vars: list[str],
) -> pd.DataFrame:
    params = {
        "latitude": lat, "longitude": lon,
        "hourly": ",".join(hourly_vars),
        "timezone": "UTC",
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
    }
    resp = requests.get(url, params=params, timeout=60)
    resp.raise_for_status()
    hourly = resp.json()["hourly"]

    df = pd.DataFrame({
        "ghi": hourly["shortwave_radiation"],
        "temperature_2m": hourly["temperature_2m"],
        "relative_humidity_2m": hourly.get("relative_humidity_2m"),
    }, index=pd.to_datetime(hourly["time"], utc=True))
    df.index.name = "timestamp"
    return df.apply(pd.to_numeric, errors="coerce")


def upsample_weather_30min(weather: pd.DataFrame) -> pd.DataFrame:
    """Interpolate hourly weather to 30-min resolution."""
    return weather.resample("30min").interpolate(method="linear").ffill()


# ═════════════════════════════════════════════════════════════════════════════
#  3. PV PRODUCTION
# ═════════════════════════════════════════════════════════════════════════════

def compute_production_shape(weather_30: pd.DataFrame) -> pd.Series:
    """
    Normalised production shape from weather.

    shape = (GHI / 1000) × temp_factor

    Units: kW per kWp installed (before per-sensor scaling).
    Tilt/azimuth/shading effects are absorbed by calibration factor k.
    """
    ghi = weather_30["ghi"].values
    t_air = weather_30["temperature_2m"].values

    t_cell = t_air + ((NOCT - 20.0) / 800.0) * ghi
    temp_factor = np.maximum(1.0 - BETA * (t_cell - T_REF), 0.0)
    g_norm = np.maximum(ghi / 1000.0, 0.0)

    return pd.Series(
        g_norm * temp_factor,
        index=weather_30.index,
        name="production_shape",
    )


def calibrate_sensor(
    shape: pd.Series,
    measured: pd.DataFrame,
    pv_kwp: float,
    ac_kw: float,
    k_max: float = 2.0,
) -> Tuple[float, dict]:
    """
    Find per-sensor scaling factor k such that:
        production = k × kWp × shape,  clipped at ac_kw

    Uses P75 of export ratios + nighttime base-load correction.
    Returns (k, diagnostics_dict).
    """
    common = shape.index.intersection(measured.index)
    if len(common) == 0:
        warnings.warn("No overlapping timestamps — using k=1.0")
        return 1.0, {"method": "no_overlap", "quality": "no_data"}

    s = shape.loc[common].values
    exp = measured.loc[common, "exp_delta_kwh"].values
    imp = measured.loc[common, "imp_delta_kwh"].values
    s_energy = s * 0.5  # kWh per 30 min per kWp

    sun_and_export = (s_energy > 0.001) & (exp > 0.001)
    if sun_and_export.sum() < 10:
        warnings.warn("Too few export+sun intervals — using k=1.0")
        return 1.0, {"method": "insufficient_data", "quality": "no_data"}

    ratios = exp[sun_and_export] / (pv_kwp * s_energy[sun_and_export])
    k_export_p75 = float(np.percentile(ratios, 75))

    # Nighttime base load
    night = s < 0.001
    base_load_kwh_30min = 0.0
    if night.sum() > 48:
        positive_night = imp[night][imp[night] > 0]
        if len(positive_night) > 10:
            base_load_kwh_30min = float(np.median(positive_night))

    # Adjusted k with base load
    if base_load_kwh_30min > 0:
        ratios_adj = (exp[sun_and_export] + base_load_kwh_30min) / \
                     (pv_kwp * s_energy[sun_and_export])
        k_adjusted = float(np.percentile(ratios_adj, 75))
    else:
        k_adjusted = k_export_p75

    # Sanity check
    quality = "good"
    k_final = k_adjusted
    if k_final > k_max:
        quality = "outlier"
        k_final = k_max
    elif k_final > 1.5:
        quality = "suspect"
    elif k_final < 0.3:
        quality = "suspect_low"

    diagnostics = {
        "method": "export_calibration",
        "k_export_p75": round(k_export_p75, 4),
        "k_with_base_load": round(k_adjusted, 4),
        "k_final": round(k_final, 4),
        "base_load_kw": round(base_load_kwh_30min / 0.5, 3),
        "calibration_intervals": int(sun_and_export.sum()),
        "night_intervals": int(night.sum()),
        "quality": quality,
    }
    return k_final, diagnostics


def estimate_production(
    shape: pd.Series,
    k: float,
    pv_kwp: float,
    ac_kw: float,
    opening_hour: int = 6,
    closing_hour: int = 18,
) -> pd.DataFrame:
    """
    production_kw = k × kWp × shape, clipped at ac_kw, masked by hours.
    Energy = production_kw × 0.5  (30-min intervals).
    """
    p_kw = np.minimum(k * pv_kwp * shape.values, ac_kw)
    p_kw = np.maximum(p_kw, 0.0)

    local_ts = shape.index.tz_convert(_HU.timezone)
    hours = local_ts.hour + local_ts.minute / 60.0
    mask = (hours >= opening_hour) & (hours < closing_hour)
    p_kw = np.where(mask, p_kw, 0.0)

    return pd.DataFrame({
        "production_kw": p_kw,
        "production_kwh": p_kw * 0.5,
    }, index=shape.index)


# ═════════════════════════════════════════════════════════════════════════════
#  4. ENERGY BALANCE
# ═════════════════════════════════════════════════════════════════════════════

def derive_consumption(
    production: pd.DataFrame,
    measured: pd.DataFrame,
    weather_30: pd.DataFrame,
) -> pd.DataFrame:
    """
    Energy balance:
        Consumption = Production + Import - Export
        Self_consumption = Production - Export
    """
    common = production.index.intersection(measured.index)

    prod = np.maximum(
        production.loc[common, "production_kwh"].values,
        measured.loc[common, "exp_delta_kwh"].values,
    )
    imp = measured.loc[common, "imp_delta_kwh"].values
    exp = measured.loc[common, "exp_delta_kwh"].values

    consumption = np.maximum(prod + imp - exp, imp)
    self_consumed = np.maximum(prod - exp, 0.0)

    tout = weather_30.reindex(common)["temperature_2m"].values
    tin = measured.loc[common, "temp_in"].values if "temp_in" in measured.columns else np.full(len(common), np.nan)
    rh = measured.loc[common, "hum_in"].values if "hum_in" in measured.columns else np.full(len(common), np.nan)

    return pd.DataFrame({
        "production_kwh": prod,
        "import_kwh": imp,
        "export_kwh": exp,
        "consumption_kwh": consumption,
        "self_consumed_kwh": self_consumed,
        "tout": tout,
        "tin": tin,
        "rh": rh,
    }, index=common)


def derive_consumption_no_pv(
    measured: pd.DataFrame,
    weather_30: pd.DataFrame,
) -> pd.DataFrame:
    """For sensors without PV: consumption = import."""
    common = measured.index.intersection(weather_30.index)

    tout = weather_30.loc[common, "temperature_2m"].values
    tin = measured.loc[common, "temp_in"].values if "temp_in" in measured.columns else np.full(len(common), np.nan)
    rh = measured.loc[common, "hum_in"].values if "hum_in" in measured.columns else np.full(len(common), np.nan)

    return pd.DataFrame({
        "production_kwh": 0.0,
        "import_kwh": measured.loc[common, "imp_delta_kwh"].values,
        "export_kwh": measured.loc[common, "exp_delta_kwh"].values,
        "consumption_kwh": measured.loc[common, "imp_delta_kwh"].values,
        "self_consumed_kwh": 0.0,
        "tout": tout,
        "tin": tin,
        "rh": rh,
    }, index=common)


# ═════════════════════════════════════════════════════════════════════════════
#  5. FULL PIPELINE — process one sensor end-to-end
# ═════════════════════════════════════════════════════════════════════════════

def process_sensor(
    site_id: int,
    measured: pd.DataFrame,
    shape: pd.Series,
    weather_30: pd.DataFrame,
) -> Tuple[pd.DataFrame, dict]:
    """
    Run the full pipeline for a single HU sensor:
    1. Look up site config from pilot_config
    2. Calibrate k (if PV exists)
    3. Estimate production
    4. Derive consumption via energy balance

    Parameters
    ----------
    site_id : int
        Site key in the HU pilot config (1–9).
    measured : pd.DataFrame
        30-min resampled sensor data (imp_delta_kwh, exp_delta_kwh, ...).
    shape : pd.Series
        Pre-computed production shape from weather.
    weather_30 : pd.DataFrame
        30-min weather with ghi, temperature_2m columns.

    Returns
    -------
    (balance_df, diagnostics)
    """
    site: SiteInfo = _HU.sites[site_id]

    if site.pv_kwp == 0:
        balance = derive_consumption_no_pv(measured, weather_30)
        return balance, {"site_id": site_id, "has_pv": False}

    k, diag = calibrate_sensor(
        shape, measured,
        pv_kwp=site.pv_kwp,
        ac_kw=site.ac_kw,
    )

    production = estimate_production(
        shape, k,
        pv_kwp=site.pv_kwp,
        ac_kw=site.ac_kw,
        opening_hour=site.pv_opening_hour,
        closing_hour=site.pv_closing_hour,
    )

    balance = derive_consumption(production, measured, weather_30)
    diag["site_id"] = site_id
    diag["has_pv"] = True
    return balance, diag


def format_balance_local(balance: pd.DataFrame) -> pd.DataFrame:
    """
    Convert a UTC-indexed balance DataFrame to Budapest local time
    (naive) and select the columns the backend expects:
    production_kwh, energy_consumption, tout, tin, rh
    """
    df = balance.copy()
    df.index = pd.to_datetime(df.index)
    if df.index.tz is None:
        df.index = df.index.tz_localize("UTC")
    df.index = (
        df.index
        .tz_convert(_HU.timezone)
        .tz_localize(None)
    )
    # DST fall-back creates duplicate naive timestamps; keep the last (standard-time) entry
    df = df[~df.index.duplicated(keep="last")]
    df = df.rename(columns={"consumption_kwh": "energy_consumption"})
    return df[["production_kwh", "energy_consumption", "tout", "tin", "rh"]]
