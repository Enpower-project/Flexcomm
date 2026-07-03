import pandas as pd
import numpy as np
import logging
from fastapi import APIRouter, HTTPException, Depends, Query
from sqlalchemy import text
from core.database import SessionLocal
from core.pilot_config import get_pilot
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
from typing import List
from utils.weather_utils import AH_gm3_from_T_RH, RH_percent_from_AH_T
from utils.timezone_utils import get_site_timezone, utc_to_local
from utils.csv_energy import is_csv_energy_site, get_csv_energy_forecast_range
from utils.csv_virtual_site import is_virtual_site, get_virtual_forecast
from utils.hungary_utils import (
    fetch_sensor_month,
    fetch_weather,
    upsample_weather_30min,
    compute_production_shape,
    process_sensor,
)
from utils.disaggregation_utils import run_hvac_disaggregation
from utils.disagg_cache import get as disagg_cache_get
from sqlalchemy.orm import Session
from core.database import get_db
import random
class ForecastRequest(BaseModel):
    start: datetime
    hvac_mode_future: List[int]

 

def add_time_features(df: pd.DataFrame) -> pd.DataFrame:
    ts = pd.to_datetime(df["timestamp"])
    hour = ts.dt.hour + ts.dt.minute / 60.0
    df["hour_sin"] = np.sin(2*np.pi*hour/24.0)
    df["hour_cos"] = np.cos(2*np.pi*hour/24.0)

    month = ts.dt.month.astype(int)
    df["month"] = month
    df["month_sin"] = np.sin(2*np.pi*(month-1)/12.0)
    df["month_cos"] = np.cos(2*np.pi*(month-1)/12.0)

    # simple season encoding (adjust if you already have your own)
    # 0=winter(12-2), 1=spring(3-5), 2=summer(6-8), 3=fall(9-11)
    season = ((month % 12) // 3).astype(int)
    df["season"] = season
    return df

def add_solar_rollups(df: pd.DataFrame) -> pd.DataFrame:
    # assumes SW is instantaneous shortwave radiation at 30-min
    # SW1h = mean of last 2 steps, SW3h = mean of last 6 steps
    df["SW1h"] = df["SW"].rolling(2, min_periods=1).mean()
    df["SW3h"] = df["SW"].rolling(6, min_periods=1).mean()
    return df

def ensure_ah_columns(df: pd.DataFrame) -> pd.DataFrame:
    # If AH_out missing but RH_out+Tout exist
    if "ah_out" not in df.columns and {"rh_out", "tout"} <= set(df.columns):
        df["ah_out"] = AH_gm3_from_T_RH(
            df["tout"].astype(float),
            df["rh_out"].astype(float),
        )

    # Indoor absolute humidity
    if "ah" not in df.columns and {"rh", "tin"} <= set(df.columns):
        df["ah"] = AH_gm3_from_T_RH(
            df["tin"].astype(float),
            df["rh"].astype(float),
        )

    return df

router = APIRouter(prefix="/forecast", tags=["forecast"])

# Next day forecast, if models dont exist return noisier last day consumption
@router.get("/{site_id}/timeseries/consumption")
def getConsumptionForecast(
    site_id,
    start_ts: datetime,
    use_last_day,
    pilot: str = Query("gr", description="Pilot code: 'gr' or 'hu'"),
    db: Session = Depends(get_db),
):
    try:
        try:
            pilot_config = get_pilot(pilot)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Unknown pilot: {pilot}")

        if pilot_config.data_source == "api":
            return _consumption_forecast_hu(int(site_id), start_ts, use_last_day, pilot_config)
        else:
            return _consumption_forecast_gr(site_id, start_ts, use_last_day, db)

    except HTTPException:
        raise
    except Exception as e:
        logging.error("getConsumptionForecast error for site %s: %s", site_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


def _consumption_forecast_gr(site_id, start_ts, use_last_day, db):
    if is_virtual_site(int(site_id)):
        return get_virtual_forecast(start_ts)

    if not use_last_day:
        return []

    site_row = db.execute(
        text("SELECT latitude, longitude FROM sites WHERE id = :site_id"),
        {"site_id": site_id},
    ).fetchone()
    if site_row is None:
        raise HTTPException(status_code=404, detail="Site not found")

    site_tz = get_site_timezone(site_row.latitude, site_row.longitude)

    start_ts_naive = start_ts.replace(tzinfo=None)
    prev_start = start_ts_naive - timedelta(days=1)
    prev_end = start_ts_naive - timedelta(minutes=30)

    if is_csv_energy_site(int(site_id)):
        csv_rows = get_csv_energy_forecast_range(int(site_id), prev_start, prev_end)
        if not csv_rows:
            raise HTTPException(
                status_code=422,
                detail="No historical consumption data available",
            )
        row_map = {r["timestamp"]: (r["value"], r["hvac_mode"]) for r in csv_rows}
        first = csv_rows[0]
    else:
        sql = """
        SELECT cd.timestamp, cd.value,
        c.hvac_mode
        FROM consumption_data cd
        LEFT JOIN comfort_data c
        ON c.site_id = cd.site_id
        AND c.timestamp = cd.timestamp
        WHERE cd.site_id = :site_id
          AND cd.timestamp <= :prev_end
          AND cd.timestamp >= :prev_start
        ORDER BY timestamp ASC
        """

        rows = db.execute(
            text(sql),
            {
                "site_id": site_id,
                "prev_start": prev_start,
                "prev_end": prev_end,
            },
        ).fetchall()

        if len(rows) == 0:
            raise HTTPException(
                status_code=422,
                detail="No historical consumption data available",
            )
        row_map = {r[0]: (r[1], r[2]) for r in rows}
        first = {"value": rows[0][1], "hvac_mode": rows[0][2]}

    horizon = pd.date_range(start=prev_start, end=prev_end, freq="30min")

    filled = []
    last_value = first["value"]
    last_hvac = first["hvac_mode"]
    for ts in horizon:
        ts_naive = ts.to_pydatetime()
        if ts_naive in row_map:
            last_value, last_hvac = row_map[ts_naive]
        noise_factor = 1 + random.uniform(-0.02, 0.02)
        forecast_ts = utc_to_local(ts_naive + timedelta(days=1), site_tz)
        filled.append(
            {
                "timestamp": forecast_ts.isoformat(),
                "value": last_value * noise_factor,
                "hvac_mode": last_hvac,
            }
        )

    return filled


def _consumption_forecast_hu(site_id, start_ts, use_last_day, pilot_config):
    if not use_last_day:
        return []

    site_info = pilot_config.sites.get(site_id)
    if not site_info:
        raise HTTPException(status_code=404, detail=f"Site {site_id} not found in {pilot_config.code} pilot")

    from zoneinfo import ZoneInfo
    site_tz = ZoneInfo(pilot_config.timezone)

    # Previous day window in UTC
    # start_ts arrives as naive local time from frontend — interpret as pilot timezone
    if start_ts.tzinfo:
        start_ts_utc = start_ts.astimezone(timezone.utc)
    else:
        start_ts_utc = start_ts.replace(tzinfo=site_tz).astimezone(timezone.utc)
    prev_start_utc = start_ts_utc - timedelta(days=1)
    prev_end_utc = start_ts_utc - timedelta(minutes=30)

    # Fetch the month(s) covering the previous day from the API
    sensor_id = site_info.sensor_uuid
    months_needed = {prev_start_utc.strftime("%Y-%m"), prev_end_utc.strftime("%Y-%m")}

    all_readings = []
    for month in sorted(months_needed):
        all_readings.extend(fetch_sensor_month(sensor_id, month))

    if not all_readings:
        raise HTTPException(status_code=404, detail="No data from API for previous day")

    # Build DataFrame, localise, convert to UTC
    df = pd.DataFrame(all_readings)
    df["ts"] = pd.to_datetime(df["ts"])
    df = df.drop_duplicates("ts").sort_values("ts").set_index("ts")

    energy = df[["imp_delta_kwh", "exp_delta_kwh"]].resample("30min").sum()
    climate = df[["hum_in", "temp_in"]].resample("30min").mean()
    measured = pd.concat([energy, climate], axis=1)

    measured.index = measured.index.tz_localize(
        pilot_config.timezone, ambiguous="NaT", nonexistent="NaT",
    )
    measured = measured[measured.index.notna()]
    measured.index = measured.index.tz_convert("UTC")

    # Filter to previous day window
    prev_start_naive = prev_start_utc.replace(tzinfo=None)
    prev_end_naive = prev_end_utc.replace(tzinfo=None)
    measured_utc_naive = measured.copy()
    measured_utc_naive.index = measured_utc_naive.index.tz_localize(None)
    day_slice = measured_utc_naive.loc[prev_start_naive:prev_end_naive]

    if len(day_slice) < 48:
        raise HTTPException(
            status_code=422,
            detail=f"Not enough historical data: expected 48, got {len(day_slice)}",
        )

    # Compute PV production + consumption via energy balance
    # Re-localise slice for weather alignment
    day_slice_utc = day_slice.copy()
    day_slice_utc.index = day_slice_utc.index.tz_localize("UTC")

    start_date = day_slice_utc.index.min().strftime("%Y-%m-%d")
    end_date = day_slice_utc.index.max().strftime("%Y-%m-%d")

    weather = fetch_weather(start_date, end_date, pilot_config.latitude, pilot_config.longitude)
    weather_30 = upsample_weather_30min(weather)
    shape = compute_production_shape(weather_30)

    balance, _ = process_sensor(site_id, day_slice_utc, shape, weather_30)

    # Take first 48 rows, add noise, shift forward 1 day
    rows = balance.iloc[:48]

    # --- Derive hvac_mode via disaggregation using cached history ----
    forecast_hvac = pd.Series(dtype=int)
    cached = disagg_cache_get(pilot_config.code, site_id)
    if cached is not None:
        # Append forecast day to the cached full dataset and re-run disaggregation
        forecast_chunk = rows[["consumption_kwh", "tout"]].copy()
        # Convert UTC → local naive to match cached balance (format_balance_local output)
        forecast_chunk.index = forecast_chunk.index.tz_convert(pilot_config.timezone).tz_localize(None)

        combined = pd.concat([
            cached.balance_df[["consumption_kwh", "tout"]],
            forecast_chunk,
        ])
        combined = combined[~combined.index.duplicated(keep="last")]
        combined = combined.sort_index()

        disagg_result = run_hvac_disaggregation(
            combined,
            load_col="consumption_kwh",
            temp_col="tout",
            neutral_band=site_info.neutral_band or (35, 70),
            is_residential=site_info.is_residential,
            active_ratio=site_info.active_ratio or 0.05,
            high_ratio=site_info.high_ratio or 0.55,
            min_high_abs=site_info.min_high_abs or 0.1,
            min_act_abs=site_info.min_active_abs or 0.02,
            q=site_info.disagg_q or 0.1,
        )
        forecast_hvac = disagg_result["df_with_hvac"]["hvac_mode"]

    series = []
    for ts_utc, row in rows.iterrows():
        noise_factor = 1 + random.uniform(-0.05, 0.05)
        noisy_value = float(row["consumption_kwh"]) * noise_factor
        forecast_ts = utc_to_local(ts_utc.to_pydatetime().replace(tzinfo=None) + timedelta(days=1), site_tz)

        # Look up hvac_mode — convert UTC ts to naive local to match disaggregation index
        ts_local_naive = ts_utc.tz_convert(pilot_config.timezone).tz_localize(None) if ts_utc.tzinfo else ts_utc.replace(tzinfo=None)
        mode = int(forecast_hvac.get(ts_local_naive, 0)) if not forecast_hvac.empty else None

        series.append(
            {
                "timestamp": forecast_ts.replace(tzinfo=None).isoformat(),
                "value": round(noisy_value, 4),
                "hvac_mode": mode,
            }
        )

    return series