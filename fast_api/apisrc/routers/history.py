from fastapi import APIRouter, HTTPException, Depends, Query
from datetime import datetime, timedelta, timezone
import httpx
import logging
import math
import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session
from core.database import get_db
from core.models import Site
from core.pilot_config import get_pilot, PilotConfig
from utils.timezone_utils import get_site_timezone, utc_to_local
from utils.csv_energy import is_csv_energy_site, get_csv_energy_range, get_csv_energy_latest
from utils.csv_virtual_site import is_virtual_site, get_virtual_timeseries, get_virtual_latest
from utils.hungary_utils import (
    fetch_sensor_month,
    parse_sensor_readings,
    fetch_weather,
    upsample_weather_30min,
    compute_production_shape,
    process_sensor,
)
from typing import Dict, Optional, Tuple, List
from collections import defaultdict
from pythermalcomfort.models import pmv_ppd_iso
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/history", tags=["timeseries"])

# Site IDs whose data is time-shifted (synthetic/simulated); query relative to now
SIMULATED_SITE_IDS: set[int] = {11}

METRIC_REGISTRY: Dict[str, Tuple[str, str]] = {
    # Comfort
    "tin": ("comfort_data", "tin"),
    "rh": ("comfort_data", "rh"),
    "comfort_index": ("comfort_data", "comfort_index"),
    "hvac_mode": ("comfort_data", "hvac_mode"),

    # Environmental
    "tout": ("environmental_data", "tout"),
    "rh_out": ("environmental_data", "rh_out"),
    "sw_out": ("environmental_data", "sw_out"),

    # Energy
    "energy_consumption": ("consumption_data", "value"),
    "energy_production": ("production_data", "value"),

    # Forecasts
    "forecasted_consumption": ("forecasted_consumption_data", "value"),
    "forecasted_production": ("forecasted_production_data", "value"),
}

def iso(ts: datetime | None):
    return ts.isoformat() if ts else None

async def fetch_current_tout(lat: float, lon: float) -> float | None:
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m",
    }

    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        data = r.json()

    return data.get("current", {}).get("temperature_2m")

@router.get("/{site_id}/timeseries")
def get_timeseries_window(
    site_id: str,
    metrics: str,
    start_ts: datetime,
    end_ts: datetime,
    pilot: str = Query("gr", description="Pilot code: 'gr' or 'hu'"),
    db: Session = Depends(get_db),
):
    try:
        try:
            pilot_config = get_pilot(pilot)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Unknown pilot: {pilot}")

        requested_metrics = [m.strip() for m in metrics.split(",") if m.strip()]
        if not requested_metrics:
            raise HTTPException(status_code=400, detail="No metrics requested")

        if pilot_config.data_source == "api":
            return _timeseries_hu(int(site_id), requested_metrics, start_ts, end_ts, pilot_config)
        else:
            return _timeseries_gr(site_id, requested_metrics, start_ts, end_ts, db)

    except HTTPException:
        raise
    except Exception as e:
        logging.error("get_timeseries_window error for site %s: %s", site_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


def _timeseries_gr(site_id, requested_metrics, start_ts, end_ts, db):
    if is_virtual_site(int(site_id)):
        return get_virtual_timeseries(requested_metrics, start_ts, end_ts)

    site = db.execute(
        text("SELECT id, latitude, longitude FROM sites WHERE id = :site_id"),
        {"site_id": site_id},
    ).mappings().first()

    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    site_tz = get_site_timezone(site["latitude"], site["longitude"])

    invalid = set(requested_metrics) - set(METRIC_REGISTRY.keys())
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown metrics: {sorted(invalid)}")

    table_groups: Dict[str, List[str]] = defaultdict(list)
    for metric in requested_metrics:
        table, _ = METRIC_REGISTRY[metric]
        table_groups[table].append(metric)

    results_by_timestamp: Dict[datetime, Dict] = {}
    _use_csv = is_csv_energy_site(int(site_id))

    for table_name, table_metrics in table_groups.items():
        if _use_csv and table_name == "consumption_data":
            for row in get_csv_energy_range(int(site_id), start_ts, end_ts):
                ts = row["timestamp"]
                results_by_timestamp[ts] = {
                    "timestamp": utc_to_local(ts, site_tz),
                    "energy_consumption": row["value"],
                }
            continue

        select_cols = []
        for metric in table_metrics:
            _, column = METRIC_REGISTRY[metric]
            select_cols.append(f"{column} AS {metric}")

        sql = text(f"""
            SELECT
                timestamp,
                {", ".join(select_cols)}
            FROM {table_name}
            WHERE site_id = :site_id
              AND timestamp >= :start_ts
              AND timestamp <= :end_ts
            ORDER BY timestamp
        """)

        rows = db.execute(
            sql,
            {
                "site_id": site_id,
                "start_ts": start_ts,
                "end_ts": end_ts,
            },
        ).mappings().all()

        for row in rows:
            ts = row["timestamp"]
            result_entry = {"timestamp": utc_to_local(ts, site_tz)}
            for key, value in row.items():
                if key != "timestamp":
                    result_entry[key] = value
            results_by_timestamp[ts] = result_entry

    return sorted(results_by_timestamp.values(), key=lambda x: x["timestamp"])


def _timeseries_hu(site_id, requested_metrics, start_ts, end_ts, pilot_config):
    from zoneinfo import ZoneInfo

    site_info = pilot_config.sites.get(site_id)
    if not site_info:
        raise HTTPException(status_code=404, detail=f"Site {site_id} not found in {pilot_config.code} pilot")

    site_tz = ZoneInfo(pilot_config.timezone)

    invalid = set(requested_metrics) - HU_SUPPORTED_METRICS
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown metrics for HU pilot: {sorted(invalid)}")

    # Determine which months to fetch
    start_utc = start_ts.replace(tzinfo=None) if start_ts.tzinfo else start_ts
    end_utc = end_ts.replace(tzinfo=None) if end_ts.tzinfo else end_ts

    months_needed = set()
    current = start_utc.replace(day=1)
    while current <= end_utc:
        months_needed.add(current.strftime("%Y-%m"))
        # Move to next month
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1)
        else:
            current = current.replace(month=current.month + 1)

    sensor_id = site_info.sensor_uuid
    all_readings = []
    for month in sorted(months_needed):
        all_readings.extend(fetch_sensor_month(sensor_id, month))

    if not all_readings:
        return []

    # Build DataFrame
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

    # Filter to requested window
    start_aware = start_utc.replace(tzinfo=timezone.utc) if start_utc.tzinfo is None else start_utc
    end_aware = end_utc.replace(tzinfo=timezone.utc) if end_utc.tzinfo is None else end_utc
    measured = measured.loc[start_aware:end_aware]

    if measured.empty:
        return []

    needs_energy = "energy_consumption" in requested_metrics or "energy_production" in requested_metrics

    if needs_energy:
        start_date = measured.index.min().strftime("%Y-%m-%d")
        end_date = measured.index.max().strftime("%Y-%m-%d")

        weather = fetch_weather(start_date, end_date, pilot_config.latitude, pilot_config.longitude)
        weather_30 = upsample_weather_30min(weather)
        shape = compute_production_shape(weather_30)
        balance, _ = process_sensor(site_id, measured, shape, weather_30)
    else:
        balance = None

    # Build response rows
    results = []
    for ts_utc in measured.index:
        ts_naive = ts_utc.to_pydatetime().replace(tzinfo=None)
        local_ts = utc_to_local(ts_naive, site_tz)

        # Strip offset so frontend treats it as wall-clock time
        entry = {"timestamp": local_ts.replace(tzinfo=None).isoformat()}

        if "tin" in requested_metrics:
            val = measured.at[ts_utc, "temp_in"]
            entry["tin"] = None if pd.isna(val) else round(float(val), 2)

        if "rh" in requested_metrics:
            val = measured.at[ts_utc, "hum_in"]
            entry["rh"] = None if pd.isna(val) else round(float(val), 2)

        if balance is not None and ts_utc in balance.index:
            row = balance.loc[ts_utc]
            if "energy_consumption" in requested_metrics:
                entry["energy_consumption"] = round(float(row["consumption_kwh"]), 4)
            if "energy_production" in requested_metrics:
                entry["energy_production"] = round(float(row["production_kwh"]), 4)

        if "tout" in requested_metrics:
            if balance is not None and ts_utc in balance.index:
                val = balance.at[ts_utc, "tout"]
                entry["tout"] = None if pd.isna(val) else round(float(val), 2)

        results.append(entry)

    return results

def clo_from_timestamp(ts: datetime) -> float:
    return 0.5 if ts.month in (5, 6, 7, 8, 9, 10) else 1.0


# ── HU-supported metrics ────────────────────────────────────────────────────

HU_SUPPORTED_METRICS = {
    "tin", "rh", "tout", "comfort_index",
    "energy_consumption", "energy_production",
}


# ── HU latest metrics handler ───────────────────────────────────────────────

async def _latest_metrics_hu(
    site_id: int,
    requested_metrics: List[str],
    pilot: PilotConfig,
) -> JSONResponse:
    """
    Fetch the latest metrics for a Hungarian site entirely from the
    Békéscsaba API + Open-Meteo (no DB).
    """
    site_info = pilot.sites.get(site_id)
    if not site_info:
        raise HTTPException(status_code=404, detail=f"Site {site_id} not found in {pilot.code} pilot")

    invalid = set(requested_metrics) - HU_SUPPORTED_METRICS
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown metrics for HU pilot: {sorted(invalid)}")

    now_utc = datetime.now(timezone.utc)
    current_month = now_utc.strftime("%Y-%m")

    # Fetch current month from Békéscsaba API
    sensor_id = site_info.sensor_uuid
    raw_readings = fetch_sensor_month(sensor_id, current_month)

    if not raw_readings:
        raise HTTPException(status_code=404, detail="No data available for current month")

    # Take the latest reading
    latest = max(raw_readings, key=lambda r: r["ts"])
    latest_ts = datetime.fromisoformat(latest["ts"])

    response: Dict[str, Dict] = {}

    # tin / rh from sensor
    if "tin" in requested_metrics:
        response["tin"] = {"value": latest.get("temp_in"), "timestamp": iso(latest_ts)}
    if "rh" in requested_metrics:
        response["rh"] = {"value": latest.get("hum_in"), "timestamp": iso(latest_ts)}

    # comfort_index from tin + rh
    if "comfort_index" in requested_metrics:
        tin_val = latest.get("temp_in")
        rh_val = latest.get("hum_in")
        if tin_val is not None and rh_val is not None:
            clo = clo_from_timestamp(latest_ts)
            result = pmv_ppd_iso(
                tdb=tin_val, tr=tin_val, vr=0.1,
                rh=rh_val, met=1.1, clo=clo,
            )
            ppd = float(result["ppd"]) if result else None
            comfort_index = 75.0 if ppd is None else float(100.0 - ppd)
            response["comfort_index"] = {"value": comfort_index, "timestamp": iso(latest_ts)}
        else:
            response["comfort_index"] = {"value": None, "timestamp": None}

    # tout from Open-Meteo (same as GR path)
    if "tout" in requested_metrics:
        try:
            tout = await fetch_current_tout(pilot.latitude, pilot.longitude)
            response["tout"] = {"value": tout, "timestamp": iso(now_utc)}
        except Exception:
            response["tout"] = {"value": None, "timestamp": None}

    # energy_consumption / energy_production — compute PV on the fly
    if "energy_consumption" in requested_metrics or "energy_production" in requested_metrics:
        df = pd.DataFrame(raw_readings)
        df["ts"] = pd.to_datetime(df["ts"])
        df = df.drop_duplicates("ts").sort_values("ts").set_index("ts")

        # Resample to 30-min
        energy = df[["imp_delta_kwh", "exp_delta_kwh"]].resample("30min").sum()
        climate = df[["hum_in", "temp_in"]].resample("30min").mean()
        measured = pd.concat([energy, climate], axis=1)

        if measured.empty:
            if "energy_consumption" in requested_metrics:
                response["energy_consumption"] = {"value": None, "timestamp": None}
            if "energy_production" in requested_metrics:
                response["energy_production"] = {"value": None, "timestamp": None}
        else:
            # Localise to Budapest then convert to UTC for alignment with weather
            measured.index = measured.index.tz_localize(
                pilot.timezone, ambiguous="NaT", nonexistent="NaT",
            )
            measured = measured[measured.index.notna()]
            measured.index = measured.index.tz_convert("UTC")

            # Fetch weather for the month and compute PV
            start_date = measured.index.min().strftime("%Y-%m-%d")
            end_date = measured.index.max().strftime("%Y-%m-%d")

            weather = fetch_weather(start_date, end_date, pilot.latitude, pilot.longitude)
            weather_30 = upsample_weather_30min(weather)
            shape = compute_production_shape(weather_30)

            balance, _diag = process_sensor(site_id, measured, shape, weather_30)

            # Latest 30-min row
            last_row = balance.iloc[-1]
            last_ts = balance.index[-1]

            if "energy_consumption" in requested_metrics:
                response["energy_consumption"] = {
                    "value": round(float(last_row["consumption_kwh"]), 4),
                    "timestamp": iso(last_ts),
                }
            if "energy_production" in requested_metrics:
                response["energy_production"] = {
                    "value": round(float(last_row["production_kwh"]), 4),
                    "timestamp": iso(last_ts),
                }

    if not response:
        raise HTTPException(status_code=404, detail="No data found")

    payload = {"site_id": str(site_id), "metrics": response}
    res = JSONResponse(content=payload)
    res.headers["Cache-Control"] = "public, max-age=60"
    res.headers["Vary"] = "Accept-Encoding"
    return res


# ── GR latest metrics handler (existing DB logic) ───────────────────────────

async def _latest_metrics_gr(
    site_id: str,
    requested_metrics: List[str],
    db: Session,
) -> JSONResponse:
    if is_virtual_site(int(site_id)):
        response = get_virtual_latest(requested_metrics)
        if not response:
            raise HTTPException(status_code=404, detail="No data found")
        payload = {"site_id": site_id, "metrics": response}
        res = JSONResponse(content=payload)
        res.headers["Cache-Control"] = "public, max-age=60"
        return res

    site = db.execute(
        text("SELECT id, latitude, longitude FROM sites WHERE id = :site_id"),
        {"site_id": site_id},
    ).mappings().first()

    if not site:
        raise HTTPException(status_code=404, detail="Site not found")
    site_tz = get_site_timezone(site["latitude"], site["longitude"])

    invalid = set(requested_metrics) - set(METRIC_REGISTRY.keys())
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unknown metrics: {sorted(invalid)}")

    table_groups: Dict[str, List[str]] = defaultdict(list)
    for metric in requested_metrics:
        table, column = METRIC_REGISTRY[metric]
        table_groups[table].append((metric, column))
    response: Dict[str, Dict] = {}
    latest_tin = None
    latest_rh = None
    latest_comfort_ts = None

    if int(site_id) in SIMULATED_SITE_IDS:
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        cutoff = now_utc.replace(second=0, microsecond=0)
        cutoff = cutoff.replace(minute=(cutoff.minute // 30) * 30)
    else:
        cutoff = None

    _use_csv = is_csv_energy_site(int(site_id))

    for table_name, metric_specs in table_groups.items():
        if _use_csv and table_name == "consumption_data":
            latest = get_csv_energy_latest(int(site_id), cutoff)
            if latest:
                for metric, _ in metric_specs:
                    response[metric] = {
                        "value": latest["value"],
                        "timestamp": iso(utc_to_local(latest["timestamp"], site_tz)),
                    }
            continue

        select_cols = [
            f"{column} AS {metric}"
            for metric, column in metric_specs
        ]
        if cutoff is not None:
            sql = text(f"""
                SELECT
                    timestamp,
                    {", ".join(select_cols)}
                FROM {table_name}
                WHERE site_id = :site_id
                  AND timestamp <= :cutoff
                ORDER BY timestamp DESC
                LIMIT 1
            """)
            row = db.execute(sql, {"site_id": site_id, "cutoff": cutoff}).mappings().first()
        else:
            sql = text(f"""
                SELECT
                    timestamp,
                    {", ".join(select_cols)}
                FROM {table_name}
                WHERE site_id = :site_id
                ORDER BY timestamp DESC
                LIMIT 1
            """)
            row = db.execute(sql, {"site_id": site_id}).mappings().first()

        if not row:
            continue

        ts = row["timestamp"]

        for metric, _ in metric_specs:
            raw_value = row[metric]
            value = None if isinstance(raw_value, float) and (math.isnan(raw_value) or math.isinf(raw_value)) else raw_value

            response[metric] = {
                "value": value,
                "timestamp": iso(utc_to_local(ts, site_tz)) if ts else None,
            }

            if metric == "tin":
                latest_tin = raw_value if isinstance(raw_value, (int, float)) and not (math.isnan(raw_value) or math.isinf(raw_value)) else None
                latest_comfort_ts = ts
            if metric == "rh":
                latest_rh = raw_value if isinstance(raw_value, (int, float)) and not (math.isnan(raw_value) or math.isinf(raw_value)) else None
                latest_comfort_ts = ts

    if not response:
        raise HTTPException(status_code=404, detail="No data found")

    if "comfort_index" in requested_metrics:
        db_comfort = response.get("comfort_index", {}).get("value")
        if db_comfort is None and latest_tin is not None and latest_rh is not None and latest_comfort_ts:
            # DB value missing/invalid — compute on the fly from tin and rh
            clo = clo_from_timestamp(latest_comfort_ts)
            result = pmv_ppd_iso(
                tdb=latest_tin, tr=latest_tin, vr=0.1,
                rh=latest_rh, met=1.1, clo=clo,
            )
            if result:
                ppd = float(result["ppd"])
                if ppd is None or math.isnan(ppd) or math.isinf(ppd):
                    computed = 25.0
                else:
                    computed = float(100.0 - ppd)
            else:
                computed = 25.0
            response["comfort_index"] = {
                "value": computed,
                "timestamp": iso(utc_to_local(latest_comfort_ts, site_tz)) if latest_comfort_ts else None,
            }
        elif db_comfort is None:
            # No DB value and can't compute — explicit fallback
            response["comfort_index"] = {
                "value": 25.0,
                "timestamp": iso(utc_to_local(latest_comfort_ts, site_tz)) if latest_comfort_ts else None,
            }

    if "tout" in requested_metrics:
        try:
            tout = await fetch_current_tout(site["latitude"], site["longitude"])
            response["tout"] = {"value": tout, "timestamp": iso(datetime.now(timezone.utc))}
        except Exception:
            response["tout"] = {"value": None, "timestamp": None}

    payload = {"site_id": site_id, "metrics": response}
    res = JSONResponse(content=payload)
    res.headers["Cache-Control"] = "public, max-age=60"
    res.headers["Vary"] = "Accept-Encoding"
    return res


# ── Main endpoint (forks on pilot) ──────────────────────────────────────────

@router.get("/{site_id}/metrics/latest")
async def get_latest_metrics(
    site_id: str,
    metrics: str,
    pilot: str = Query("gr", description="Pilot code: 'gr' or 'hu'"),
    db: Session = Depends(get_db),
):
    try:
        requested_metrics = [m.strip() for m in metrics.split(",") if m.strip()]
        if not requested_metrics:
            raise HTTPException(status_code=400, detail="No metrics requested")

        try:
            pilot_config = get_pilot(pilot)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Unknown pilot: {pilot}")

        if pilot_config.data_source == "api":
            return await _latest_metrics_hu(int(site_id), requested_metrics, pilot_config)
        else:
            return await _latest_metrics_gr(site_id, requested_metrics, db)

    except HTTPException:
        raise
    except Exception as e:
        logging.error("get_latest_metrics error for site %s: %s", site_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/{site_id}/timeseries/last-24h")
def get_last_24h_timeseries(
    site_id: int,
    metrics: str,
    db: Session = Depends(get_db),
):
    try:
        # Get site for timezone conversion
        site = db.execute(
            text("SELECT id, latitude, longitude FROM sites WHERE id = :site_id"),
            {"site_id": site_id},
        ).mappings().first()

        if not site:
            raise HTTPException(status_code=404, detail="Site not found")

        site_tz = get_site_timezone(site["latitude"], site["longitude"])

        # -----------------------------
        # Time window (server-defined)
        # -----------------------------
        end_ts = datetime.now(timezone.utc).replace(tzinfo=None)
        start_ts = end_ts - timedelta(hours=24)

        # -----------------------------
        # Parse & validate metrics
        # -----------------------------
        requested_metrics: List[str] = [m.strip() for m in metrics.split(",") if m.strip()]
        if not requested_metrics:
            raise HTTPException(status_code=400, detail="No metrics requested")

        invalid = set(requested_metrics) - set(METRIC_REGISTRY.keys())
        if invalid:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown metrics: {sorted(invalid)}",
            )

        # -----------------------------
        # Group metrics by table
        # -----------------------------
        table_groups: Dict[str, List[str]] = defaultdict(list)
        for metric in requested_metrics:
            table, _ = METRIC_REGISTRY[metric]
            table_groups[table].append(metric)

        # -----------------------------
        # Execute queries
        # -----------------------------
        results_by_timestamp: Dict[datetime, Dict] = {}
        _use_csv = is_csv_energy_site(site_id)

        for table_name, table_metrics in table_groups.items():
            if _use_csv and table_name == "consumption_data":
                for csv_row in get_csv_energy_range(site_id, start_ts, end_ts):
                    ts = csv_row["timestamp"]
                    if ts not in results_by_timestamp:
                        results_by_timestamp[ts] = {"timestamp": utc_to_local(ts, site_tz)}
                    results_by_timestamp[ts]["energy_consumption"] = csv_row["value"]
                continue

            select_cols = []
            for metric in table_metrics:
                _, column = METRIC_REGISTRY[metric]
                select_cols.append(f"{column} AS {metric}")

            sql = text(f"""
                SELECT
                    timestamp,
                    {", ".join(select_cols)}
                FROM {table_name}
                WHERE site_id = :site_id
                  AND timestamp >= :start_ts
                  AND timestamp <= :end_ts
                ORDER BY timestamp
            """)

            rows = db.execute(
                sql,
                {
                    "site_id": site_id,
                    "start_ts": start_ts,
                    "end_ts": end_ts,
                },
            ).mappings().all()

            for row in rows:
                ts = row["timestamp"]
                if ts not in results_by_timestamp:
                    # Convert UTC timestamp to site's local timezone
                    results_by_timestamp[ts] = {"timestamp": utc_to_local(ts, site_tz)}
                results_by_timestamp[ts].update(row)

        # -----------------------------
        # Return merged timeline
        # -----------------------------
        return sorted(results_by_timestamp.values(), key=lambda x: x["timestamp"])
    except HTTPException:
        raise
    except Exception as e:
        logging.error("get_last_24h_timeseries error for site %s: %s", site_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
