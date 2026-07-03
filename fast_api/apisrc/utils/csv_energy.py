import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

logger = logging.getLogger(__name__)

_CSV_DIR = Path(__file__).resolve().parent.parent

_SITE_CSV_MAP = {
    "Dimarxeio_rack": "House_03.csv",
    os.getenv("GR_SITE_3_NAME", "gr_site_3"): "House_04.csv",
    os.getenv("GR_SITE_4_NAME", "gr_site_4"): "House_05.csv",
    "Super_market": "House_07.csv",
}

_site_id_to_csv: dict[int, str] | None = None
_df_cache: dict[str, pd.DataFrame] = {}


def _resolve_site_ids() -> dict[int, str]:
    global _site_id_to_csv
    if _site_id_to_csv is not None:
        return _site_id_to_csv

    from core.database import SessionLocal
    from core.models import Site

    db = SessionLocal()
    try:
        rows = db.query(Site.id, Site.name).filter(
            Site.name.in_(_SITE_CSV_MAP.keys())
        ).all()
        _site_id_to_csv = {r[0]: _SITE_CSV_MAP[r[1]] for r in rows}
        logger.info("CSV energy fallback site mappings: %s", _site_id_to_csv)
    finally:
        db.close()

    return _site_id_to_csv


def _load_csv(csv_filename: str) -> pd.DataFrame:
    if csv_filename in _df_cache:
        return _df_cache[csv_filename]

    path = _CSV_DIR / csv_filename
    df = pd.read_csv(path)

    ts_col = "timestamp" if "timestamp" in df.columns else "timestamps"
    df = df.rename(columns={ts_col: "timestamp", "energy_consumption": "value"})
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df[["timestamp", "value", "hvac_mode"]].copy()
    df["value"] = df["value"] / 1000.0

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
        "CSV energy loaded %s: %d rows, shifted +%d years, range %s to %s",
        csv_filename, len(df), shift_years,
        df["timestamp"].iloc[0], df["timestamp"].iloc[-1],
    )

    _df_cache[csv_filename] = df
    return df


def _get_df(site_id: int) -> pd.DataFrame | None:
    mapping = _resolve_site_ids()
    csv_filename = mapping.get(int(site_id))
    if csv_filename is None:
        return None
    return _load_csv(csv_filename)


def _strip_tz(dt: datetime) -> datetime:
    return dt.replace(tzinfo=None) if dt.tzinfo is not None else dt


def is_csv_energy_site(site_id: int) -> bool:
    return int(site_id) in _resolve_site_ids()


def get_csv_energy_range(site_id: int, start_ts: datetime, end_ts: datetime) -> list[dict]:
    df = _get_df(site_id)
    if df is None:
        return []
    start_ts, end_ts = _strip_tz(start_ts), _strip_tz(end_ts)
    mask = (df["timestamp"] >= start_ts) & (df["timestamp"] <= end_ts)
    filtered = df.loc[mask, ["timestamp", "value"]]
    return [
        {"timestamp": r["timestamp"].to_pydatetime(), "value": float(r["value"])}
        for r in filtered.to_dict("records")
    ]


def get_csv_energy_latest(site_id: int, before: datetime | None = None) -> dict | None:
    df = _get_df(site_id)
    if df is None:
        return None
    if before is not None:
        df = df[df["timestamp"] <= _strip_tz(before)]
    if df.empty:
        return None
    row = df.iloc[-1]
    return {"timestamp": row["timestamp"].to_pydatetime(), "value": float(row["value"])}


def get_csv_energy_forecast_range(site_id: int, start_ts: datetime, end_ts: datetime) -> list[dict]:
    df = _get_df(site_id)
    if df is None:
        return []
    start_ts, end_ts = _strip_tz(start_ts), _strip_tz(end_ts)
    mask = (df["timestamp"] >= start_ts) & (df["timestamp"] <= end_ts)
    filtered = df.loc[mask, ["timestamp", "value", "hvac_mode"]]
    return [
        {
            "timestamp": r["timestamp"].to_pydatetime(),
            "value": float(r["value"]),
            "hvac_mode": r["hvac_mode"],
        }
        for r in filtered.to_dict("records")
    ]
