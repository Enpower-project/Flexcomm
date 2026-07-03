import pandas as pd
import torch
import threading
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, Query
from sqlalchemy.orm import Session
from sqlalchemy import text, select
from core.database import get_db, SessionLocal
from core.pilot_config import get_pilot, PilotConfig
from routers import comfort
from real_utils import get_recent_missing_data
from utils.disaggregation_utils import run_disaggregation_for_site_util, run_hvac_disaggregation
from utils.disagg_cache import put as disagg_cache_put, get as disagg_cache_get
from utils.hungary_utils import (
    fetch_sensor_range,
    fetch_weather, upsample_weather_30min, compute_production_shape,
    estimate_production, process_sensor, format_balance_local,
)
import numpy as np
import logging
from datetime import datetime, timedelta, timezone
from core.models import OptimizationRun, OptimizationData, Site
from utils.weather_utils import reconcile_environmental_data, fetch_environmental_data, interpolate_value
from utils.csv_virtual_site import is_virtual_site
from utils.timezone_utils import get_site_timezone, utc_to_local, local_to_utc
from pyomo.environ import (
    ConcreteModel, Var, Objective, Constraint, RangeSet,
    NonNegativeReals, Binary, Reals, SolverFactory, minimize, value
)
from utils.optimization_utils import (
    RCConfig,
    fit_rc_by_thermal_regime,
    optimize_schedule_with_rc,
    repair_to_feasible,
    harden_schedule_until_comfort,
    enforce_min_on_duration, compute_comfort_percent,
    rollout_48_steps_minio,
    relax_schedule_for_efficiency,
    set_debug_log, _dbg,
)
from pydantic import BaseModel, Field
from typing import Optional, Annotated, List
import warnings
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path
from dotenv import load_dotenv
import os

load_dotenv()  # loads .env into environment variables

def get_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"Missing required env variable: {name}")
    return value

class OptimizationRunRequest(BaseModel):
    manual_pv_48: Optional[
        Annotated[
            List[int],
            Field(min_length=48, max_length=48)
        ]
    ] = None

logger = logging.getLogger(__name__)
# logging.basicConfig(
#     level=logging.INFO,
#     format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
# )
logger.setLevel(logging.INFO)

# ensure logs go to terminal even if uvicorn already configured logging
if not logger.handlers:
    h = logging.StreamHandler()  # stdout
    h.setLevel(logging.INFO)
    h.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s"))
    logger.addHandler(h)

logger.propagate = False  # avoid duplicate logs if uvicorn root handlers also print

with warnings.catch_warnings():
    warnings.filterwarnings(
        "ignore",
        message="X does not have valid feature names",
        category=UserWarning,
    )

router = APIRouter(prefix="/optimize", tags=["optimize"])

MAX_CONCURRENT_OPTIMIZATIONS = 2

# ── In-memory store for HU optimization runs (no DB for HU) ─────────────────
_hu_runs_lock = threading.Lock()
_hu_run_counter = 0
_hu_runs: dict[int, dict] = {}   # run_id (negative) → run dict


def _next_hu_run_id() -> int:
    global _hu_run_counter
    _hu_run_counter += 1
    return -_hu_run_counter


def _store_hu_run(run_id: int, run_dict: dict):
    with _hu_runs_lock:
        _hu_runs[run_id] = run_dict


def _get_hu_run(run_id: int) -> dict | None:
    with _hu_runs_lock:
        return _hu_runs.get(run_id)


# ── Cancellation signal for background optimization runs ──────────────────────
_cancelled_runs_lock = threading.Lock()
_cancelled_run_ids: set[int] = set()


def _mark_cancelled(run_id: int):
    with _cancelled_runs_lock:
        _cancelled_run_ids.add(run_id)


def _is_cancelled(run_id: int) -> bool:
    with _cancelled_runs_lock:
        return run_id in _cancelled_run_ids


def _clear_cancelled(run_id: int):
    with _cancelled_runs_lock:
        _cancelled_run_ids.discard(run_id)


class _RunCancelled(Exception):
    pass


def _check_cancel(run_id: int):
    if _is_cancelled(run_id):
        raise _RunCancelled()


def run_hvac_disaggregation_for_site(
    site_id: int,
):
    # -----------------------------
    # 1. Load required data
    # -----------------------------
    db = SessionLocal()  # New session for background task
    try:
        sql = text("""
            SELECT
                cd.timestamp,
                cd.hvac_mode,
                c.value          AS energy_consumption,
                e.tout           AS tout
            FROM comfort_data cd
            JOIN consumption_data c
            ON c.site_id = cd.site_id
            AND c.timestamp = cd.timestamp
            JOIN environmental_data e
            ON e.site_id = cd.site_id
            AND e.timestamp = cd.timestamp
            WHERE cd.site_id = :site_id
            ORDER BY cd.timestamp
        """)

        rows = db.execute(sql, {"site_id": site_id}).mappings().all()

        if not rows:
            logger.warning(
                "HVAC disaggregation: no data available for site %s",
                site_id,
            )
            return

        df = pd.DataFrame(rows)
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        df = df.set_index("timestamp")
        # if df.index.tz is None:
        #     raise RuntimeError("HVAC disaggregation received naive timestamps; expected UTC-aware")
        # -----------------------------
        # 2. Run disaggregation
        # -----------------------------
        site_sql = text("""
            SELECT
                temp_low_band,
                temp_high_band,
                temp_low_bin,
                temp_high_bin,
                is_residential,
                active_ratio,
                high_ratio,
                min_high_abs,
                min_act_abs
                q,
                min_days_per_bin,
            FROM site
            WHERE id = :site_id
        """)

        site_row = db.execute(site_sql, {"site_id": site_id}).mappings().first()
        
        results = run_hvac_disaggregation(
            df,
            load_col="energy_consumption",
            temp_col="tout",
            neutral_band=(site_row["temp_low_band"], site_row["temp_high_band"]),
            temp_bins=np.arange(site_row["temp_low_bin"], site_row["temp_high_bin"], 1),
            is_residential=site_row["is_residential"],
            active_ratio=site_row["active_ratio"],
            high_ratio=site_row["high_ratio"],
            min_high_abs=site_row["min_high_abs"],
            q=site_row["q"],
            min_days_per_bin=site_row["min_days_per_bin"],
            min_act_abs=site_row["min_act_abs"]
        )

        df_out = results["df_with_hvac"]

        # -----------------------------
        # 3. Overwrite hvac_mode in DB
        # -----------------------------
        update_sql = text("""
            UPDATE comfort_data
            SET hvac_mode = :hvac_mode
            WHERE site_id = :site_id
            AND timestamp = :timestamp
        """)

        payload = [
            {
                "site_id": site_id,
                "timestamp": ts,
                "hvac_mode": int(mode),
            }
            for ts, mode in df_out["hvac_mode"].items()
        ]

        if payload:
            db.execute(update_sql, payload)
            db.commit()
        # -----------------------------
    # 4. Return summary
    # -----------------------------
    except Exception as exc:
        db.rollback()
        logger.exception(
            "HVAC disaggregation FAILED for site %s: %s",
            site_id,
            exc,
        )

    finally:
        db.close()

def _es_hPa_from_Tc(Tc: float) -> float:
    """Saturation vapor pressure in hPa at air temperature Tc (°C)."""
    return 6.112 * np.exp((17.67 * Tc) / (Tc + 243.5))

def AH_gm3_from_T_RH(Tc: float, RH_percent: float) -> float:
    """
    Absolute humidity [g/m³] from temperature (°C) and RH (%).
    AH = 216.7 * e / (T+273.15), with e = RH/100 * es(T).
    """
    T = np.asarray(Tc, dtype=np.float32)
    RHf = np.clip(np.asarray(RH_percent, dtype=np.float32) / 100.0, 0.0, 1.0)  # <-- vectorized clamp
    es = _es_hPa_from_Tc(T)  # assumes this already handles vector inputs (it does in your file)
    e = RHf * es
    AH = 216.7 * e / (T + 273.15)
    if isinstance(Tc, pd.Series):
        return pd.Series(AH, index=Tc.index, name="ah")
    return AH

def fit_rc_from_history(history_df: pd.DataFrame) -> dict:
    df = history_df.copy()
    req = {"tin", "tout", "hvac_mode"}
    if not req.issubset(df.columns):
        raise RuntimeError(f"RC fit requires columns {sorted(req)}")

    df = df.dropna(subset=["tin", "tout", "hvac_mode"]).sort_index()
    if len(df) < 50:
        raise RuntimeError("Insufficient clean history for RC fit")

    Tin_t = df["tin"].values[:-1]
    Tin_next = df["tin"].values[1:]
    Tout_t = df["tout"].values[:-1]
    mode_t = df["hvac_mode"].values[:-1].astype(int)

    u_low = (mode_t == 1).astype(float)
    u_high = (mode_t == 2).astype(float)

    X = np.column_stack([Tin_t, Tout_t, u_low, u_high, np.ones_like(Tin_t)])
    theta, *_ = np.linalg.lstsq(X, Tin_next, rcond=None)
    a, b_tout, c_low, c_high, d = theta.tolist()

    a = float(np.clip(a, 0.7, 0.999))
    return {"a": float(a), "b_tout": float(b_tout), "c_low": float(c_low), "c_high": float(c_high), "d": float(d)}

def simulate_rc(*, rc: dict, tin0: float, tout_48: np.ndarray, hvac_mode_48: np.ndarray) -> np.ndarray:
    H = len(tout_48)
    tin = np.zeros(H + 1, dtype=float)
    tin[0] = float(tin0)
    for t in range(H):
        u_low = 1.0 if int(hvac_mode_48[t]) == 1 else 0.0
        u_high = 1.0 if int(hvac_mode_48[t]) == 2 else 0.0
        tin[t + 1] = (
            rc["a"] * tin[t]
            + rc["b_tout"] * float(tout_48[t])
            + rc["c_low"] * u_low
            + rc["c_high"] * u_high
            + rc["d"]
        )
    return tin[1:]

# def enforce_min_on_duration(hvac: np.ndarray, min_len: int = 2) -> np.ndarray:
#     h = np.asarray(hvac, dtype=int).copy()
#     if min_len <= 1:
#         return h
#     n = len(h)
#     i = 0
#     while i < n:
#         if h[i] == 0:
#             i += 1
#             continue
#         j = i
#         while j < n and h[j] == h[i]:
#             j += 1
#         if (j - i) < min_len:
#             h[i:j] = 0
#         i = j
#     return h


def solve_rc_milp_pyomo(
    *,
    tin0: float,
    tout: np.ndarray,          # shape (48,)
    pv: np.ndarray,            # shape (48,), 0/1
    season: float,             
    params: dict,              # RC params
    Tmin: float,
    Tmax: float,
    time_limit_sec: int = 60,
) -> dict:

    H = len(tout)
    assert H == 48, "Expected 48-step horizon"

    m = ConcreteModel()

    m.T = RangeSet(0, H)
    m.K = RangeSet(0, H - 1)

    # ------------------
    # Decision variables
    # ------------------
    m.Tin = Var(m.T, domain=Reals)
    m.u_low = Var(m.K, domain=Binary)
    m.u_high = Var(m.K, domain=Binary)

    # ------------------
    # Initial condition
    # ------------------
    m.Tin[0].fix(tin0)

    # ------------------
    # RC dynamics
    # ------------------
    a = params["a"]
    b = params["b_tout"]
    c_low = params["c_low"]
    c_high = params["c_high"]
    d = params.get("d", 0.0)

    def rc_dyn(m, k):
        return (
            m.Tin[k + 1]
            == a * m.Tin[k]
            + b * tout[k]
            + c_low * m.u_low[k]
            + c_high * m.u_high[k]
            + d
        )

    m.rc_dyn = Constraint(m.K, rule=rc_dyn)

    # ------------------
    # HVAC mode exclusivity
    # ------------------
    def hvac_excl(m, k):
        return m.u_low[k] + m.u_high[k] <= 1

    m.hvac_excl = Constraint(m.K, rule=hvac_excl)

    # ------------------
    # Comfort bounds
    # ------------------
    def comfort_lo(m, k):
        return m.Tin[k + 1] >= Tmin

    def comfort_hi(m, k):
        return m.Tin[k + 1] <= Tmax

    m.comfort_lo = Constraint(m.K, rule=comfort_lo)
    m.comfort_hi = Constraint(m.K, rule=comfort_hi)

    # ------------------
    # Objective (PV utilization)
    # ------------------
    w_high = params.get("w_high", 1.0)
    w_low = params.get("w_low", 0.3)
    w_grid = params.get("w_grid", 1.0)

    def obj(m):
        cost = 0.0
        for k in m.K:
            hvac_power = w_low * m.u_low[k] + w_high * m.u_high[k]
            grid_penalty = (1 - pv[k]) * hvac_power
            cost += w_grid * grid_penalty
        return cost

    m.obj = Objective(rule=obj, sense=minimize)

    # ------------------
    # Solve
    # ------------------
    solver = SolverFactory("highs")
    solver.options["time_limit"] = time_limit_sec

    result = solver.solve(m, tee=False)

    if str(result.solver.termination_condition).lower() not in {"optimal", "feasible"}:
        raise RuntimeError(f"MILP failed: {result.solver.termination_condition}")

    # ------------------
    # Extract solution
    # ------------------
    hvac_mode = np.zeros(H, dtype=int)
    tin_rc = np.zeros(H, dtype=float)

    for k in range(H):
        if value(m.u_high[k]) > 0.5:
            hvac_mode[k] = 2
        elif value(m.u_low[k]) > 0.5:
            hvac_mode[k] = 1
        else:
            hvac_mode[k] = 0

        tin_rc[k] = value(m.Tin[k + 1])

    return {
        "hvac_mode": hvac_mode,
        "Tin_rc": tin_rc,
    }

def load_pv_indicator_48(*, db: Session, site_id: int, horizon_index: pd.DatetimeIndex) -> np.ndarray:
    ts0 = horizon_index[0].to_pydatetime()
    ts1 = (horizon_index[-1] + pd.Timedelta(minutes=30)).to_pydatetime()

    prod_rows = db.execute(
        text("""
            SELECT timestamp, value
            FROM forecasted_production_data
            WHERE site_id = :site_id
              AND timestamp >= :ts0
              AND timestamp < :ts1
        """),
        {"site_id": site_id, "ts0": ts0, "ts1": ts1},
    ).mappings().all()

    cons_rows = db.execute(
        text("""
            SELECT timestamp, value
            FROM forecasted_consumption_data
            WHERE site_id = :site_id
              AND timestamp >= :ts0
              AND timestamp < :ts1
        """),
        {"site_id": site_id, "ts0": ts0, "ts1": ts1},
    ).mappings().all()

    if not prod_rows or not cons_rows:
        return np.zeros(len(horizon_index), dtype=int)

    prod = {pd.to_datetime(r["timestamp"]): float(r["value"]) for r in prod_rows}
    cons = {pd.to_datetime(r["timestamp"]): float(r["value"]) for r in cons_rows}

    pv = np.zeros(len(horizon_index), dtype=int)
    for i, ts in enumerate(horizon_index):
        p = prod.get(ts)
        c = cons.get(ts)
        pv[i] = 1 if (p is not None and c is not None and p >= c) else 0
    return pv

#builds features for optimization model
def build_features(full_timeline: pd.DataFrame, pilot: PilotConfig | None = None) -> pd.DataFrame:
    df = full_timeline.copy()
    # ------------------
    # Absolute humidity
    # ------------------
    df["ah"] = AH_gm3_from_T_RH(df["tin"], df["rh"])
    df["ah_lag1"] = df["ah"].shift(1)
    df["ah_lag2"] = df["ah"].shift(2)
    df["ah_lag3"] = df["ah"].shift(3)

    df["ah_out"] = AH_gm3_from_T_RH(df["tout"], df["rh_out"]) / 100.0


    # ------------------
    # Time encodings
    # ------------------
    idx = df.index
    idx = pd.to_datetime(full_timeline.index)


    hour = idx.hour + idx.minute / 60.0
    df["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)

    df["month"] = idx.month
    df["month_sin"] = np.sin(2 * np.pi * (df["month"] - 1) / 12.0)
    df["month_cos"] = np.cos(2 * np.pi * (df["month"] - 1) / 12.0)
    heating = pilot.heating_months if pilot else frozenset({10, 11, 12, 1, 2, 3, 4, 5})
    df["season"] = df["month"].isin(heating).astype(int)


    # ------------------
    # Solar features
    # ------------------
    # Match training-time solar rollups exactly: rolling means, not sums
    df["SW1h"] = df["sw_out"].rolling(window=2, min_periods=1).mean()
    df["SW3h"] = df["sw_out"].rolling(window=6, min_periods=1).mean()

    # ------------------
    # Diffs & rolling
    # ------------------
    df["tin_diff"] = df["tin"].diff()
    df["tout_diff"] = df["tout"].diff()

    df["tin_ma3"] = df["tin"].rolling(window=3, min_periods=1).mean()
    df["tout_ma3"] = df["tout"].rolling(window=3, min_periods=1).mean()
    return df

def placeholder_optimize_next_24h(
    *,
    horizon_index: pd.DatetimeIndex,
    last_known_tin: float | None,
    last_known_rh: float | None,
    last_known_comfort: float | None,
) -> pd.DataFrame:
    
    tin = float(last_known_tin) if last_known_tin is not None else 22.0
    rh = float(last_known_rh) if last_known_rh is not None else 50.0
    comfort = float(last_known_comfort) if last_known_comfort is not None else 50.0

    df_out = pd.DataFrame(index=horizon_index)
    df_out["hvac_mode"] = 0
    df_out["tin"] = tin
    df_out["rh"] = rh
    df_out["comfort_index"] = comfort
    return df_out


@router.post("/{site_id}/disaggregation", status_code=202)
async def trigger_hvac_disaggregation(
    site_id: int,
    background_tasks: BackgroundTasks,
    pilot: str = Query("gr"),
    db: Session = Depends(get_db),
):
    config = get_pilot(pilot)

    if is_virtual_site(site_id):
        return {"site_id": site_id, "status": "skipped", "message": "Not available for demo sites"}

    # HU has no DB-based HVAC disaggregation
    if config.data_source == "api":
        return {
            "site_id": site_id,
            "status": "skipped",
            "message": "Disaggregation not applicable for API-sourced pilots",
        }

    try:
        # Validate site exists
        exists = db.execute(
            text("SELECT 1 FROM sites WHERE id = :site_id"),
            {"site_id": site_id},
        ).scalar()

        if not exists:
            raise HTTPException(status_code=404, detail="Site not found")

        # IMPORTANT:
        # We pass a NEW session into the background task
        # Never reuse request-scoped session
        background_tasks.add_task(
            run_hvac_disaggregation_for_site,
            site_id,
        )

        return {
            "site_id": site_id,
            "status": "scheduled",
            "message": "HVAC disaggregation started in background",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("trigger_hvac_disaggregation error for site %s: %s", site_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

RES_MIN = 30
HORIZON_STEPS = 48
LSTM_MAX_WINDOW_STEPS = 24
WARMUP_BUFFER_STEPS = 24
SUMMER_MONTHS = {4, 5, 6, 7, 8, 9, 10}   # Apr–Oct
WINTER_MONTHS = {11, 12, 1, 2, 3} 


def reload_rc_history_df(db, site_id, index):
    rows = db.execute(
        text("""
            SELECT
                cd.timestamp,
                cd.tin AS tin,
                cd.hvac_mode,
                e.tout AS tout
            FROM comfort_data cd
            JOIN environmental_data e
              ON e.site_id = cd.site_id
             AND e.timestamp = cd.timestamp
            WHERE cd.site_id = :site_id
              AND cd.timestamp >= :start_ts
              AND cd.timestamp <= :end_ts
            ORDER BY cd.timestamp
        """),
        {
            "site_id": site_id,
            "start_ts": index.min(),
            "end_ts": index.max(),
        },
    ).mappings().all()

    df = pd.DataFrame(rows)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df.set_index("timestamp")

def run_optimization_for_site(run_id: int):
    """
    Background task:
    - loads run + marks running
    - loads required data (history + forecast env)
    - builds features
    - generates schedule
    - persists OptimizationData
    - marks succeeded/failed
    """
    db = SessionLocal()
    run: OptimizationRun | None = None

    _log_path = Path(__file__).parent.parent / f"opt_debug_{run_id}.log"
    set_debug_log(str(_log_path))
    _dbg(f"=== Optimization run {run_id} started ===")

    try:
        # -----------------------------------
        # 1) Load run, validate, mark running
        # -----------------------------------
        run = db.get(OptimizationRun, run_id)
        if run is None:
            logger.error("OptimizationRun %s not found", run_id)
            return

        run.status = "running"
        run.error_message = None
        run.started_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()

        _check_cancel(run_id)

        site_id = run.site_id
        now = datetime.now(timezone.utc).replace(tzinfo=None, minute=0, second=0, microsecond=0)
        history_start = now - timedelta(hours=48 * 2)  # or reuse your warmup logic
        end_time = now

        reconcile_environmental_data(
            db=db,
            site_id=site_id,
            start_ts=history_start,
            end_ts=end_time,
            resolution='30min',
            fill_nulls_only=True,
            dry_run=False,
        )
        # df_comfort = get_recent_missing_data(
        #     site_name="Dimarxeio_sunedriaston",
        #     tin_id=get_env("Dimarxeio_sunedriaston_tin"),
        #     rh_id=get_env("Dimarxeio_sunedriaston_rh"),
        #     data_type='comfort'
        # )

        # # Consumption data
        # df_consumption = get_recent_missing_data(
        #     site_name="Dimarxeio_sunedriaston",
        #     energy_id=get_env("Dimarxeio_sunedriaston_consumption"),
        #     data_type='consumption'
        # )

        run_disaggregation_for_site_util(db, site_id)


        start_time = run.start_time
        end_time = run.end_time

        start_month = start_time.month

        if start_month in SUMMER_MONTHS:
            rc_months = SUMMER_MONTHS
            rc_season = "summer"
        else:
            rc_months = WINTER_MONTHS
            rc_season = "winter"

        # -----------------------------------
        # 2) Define horizon timestamps (30-min)
        # -----------------------------------
        horizon_index = pd.date_range(
            start=start_time,
            end=end_time,
            freq="30min",
            inclusive="left",
            # tz="UTC",
        )

        if len(horizon_index) != 48:
            # Defensive: if start/end were not aligned, this catches it.
            raise RuntimeError(f"Expected 48 steps for 24h@30min, got {len(horizon_index)}")

        # -----------------------------------
        # 3) Load history window (last 12h or 24h)
        # -----------------------------------
        warmup_steps = LSTM_MAX_WINDOW_STEPS + WARMUP_BUFFER_STEPS

        history_start = start_time - timedelta(minutes=RES_MIN * warmup_steps)

        history_rows = db.execute(
            text(
                """
                SELECT
                    cd.timestamp,
                    cd.tin      AS tin,
                    cd.rh       AS rh,
                    cd.comfort_index AS comfort_index,
                    cd.hvac_mode AS hvac_mode,
                    e.tout      AS tout,
                    e.sw_out    AS sw_out,
                    e.rh_out    AS rh_out
                FROM comfort_data cd
                LEFT JOIN environmental_data e
                  ON e.site_id = cd.site_id
                 AND e.timestamp = cd.timestamp
                WHERE cd.site_id = :site_id
                  AND cd.timestamp >= :history_start
                  AND cd.timestamp < :start_time
                ORDER BY cd.timestamp
                """
            ),
            {"site_id": site_id, "history_start": history_start, "start_time": start_time},
        ).mappings().all()

        history_df = pd.DataFrame(history_rows)
        if not history_df.empty:
            history_df["timestamp"] = pd.to_datetime(history_df["timestamp"])
            history_df = history_df.set_index("timestamp")

        if history_df.empty:
            run.status = "failed"
            run.error_message = "No historical data available for optimization"
            db.commit()
            return
        
        if len(history_df) < LSTM_MAX_WINDOW_STEPS:
            run.status = "failed"
            run.error_message = (
                f"Insufficient history for LSTM warmup: "
                f"need {LSTM_MAX_WINDOW_STEPS} timesteps, got {len(history_df)}"
            )
            db.commit()
            return
        _ah_cols = ["tin", "rh", "tout", "rh_out", "sw_out"]
        _nan_counts = {c: int(history_df[c].isna().sum()) for c in _ah_cols if c in history_df.columns}
        if any(v > 0 for v in _nan_counts.values()):
            print("HISTORY NaN counts:", _nan_counts)
            _any_nan = history_df[_ah_cols].isna().any(axis=1)
            print("HISTORY NaN timestamps:\n", history_df.loc[_any_nan, _ah_cols].to_string())

        _dbg(f"\n--- history_df loaded ---")
        _dbg(f"  shape={history_df.shape}  index=[{history_df.index[0]} .. {history_df.index[-1]}]")
        _dbg(f"  NaN counts:\n{history_df.isna().sum().to_string()}")
        _dbg(f"  last 3 rows:\n{history_df[['tin','rh','hvac_mode','tout','sw_out']].tail(3).to_string()}")
        # -----------------------------------
        # 4) Load environmental forecast for horizon
        # -----------------------------------
      
        site_row = db.execute(
            text(
                """
                SELECT latitude, longitude
                FROM sites
                WHERE id = :site_id
                """
            ),
            {"site_id": site_id},
        ).fetchone()

        if site_row is None:
            run.status = "failed"
            run.error_message = "Site not found while fetching weather"
            db.commit()
            return

        latitude = site_row.latitude
        longitude = site_row.longitude
        weather_hourly = fetch_environmental_data(
            latitude=latitude,
            longitude=longitude,
            start_ts=start_time - timedelta(hours=1),
            end_ts=end_time + timedelta(hours=1), 
            source="forecast",
        )
        if not weather_hourly:
            run.status = "failed"
            run.error_message = "No forecast weather data returned for optimization horizon"
            db.commit()
            return
        
        weather_df = (
            pd.DataFrame.from_dict(weather_hourly, orient="index")
            .sort_index()
        )

        weather_df.index = pd.to_datetime(weather_df.index)
        hourly_ts = sorted(weather_hourly.keys())

        if not hourly_ts:
            run.status = "failed"
            run.error_message = "No hourly weather timestamps available for interpolation"
            db.commit()
            return

        hourly_series = {
            "tout": {ts: weather_hourly[ts]["tout"] for ts in hourly_ts},
            "rh_out": {ts: weather_hourly[ts]["rh_out"] for ts in hourly_ts},
            "sw_out": {ts: weather_hourly[ts]["sw_out"] for ts in hourly_ts},
        }

        records = []
     
        for ts in horizon_index:
            records.append(
                {
                    "timestamp": ts,
                    "tout": interpolate_value(
                        target_ts=ts,
                        known_ts=hourly_ts,
                        values=hourly_series["tout"],
                    ),
                    "rh_out": interpolate_value(
                        target_ts=ts,
                        known_ts=hourly_ts,
                        values=hourly_series["rh_out"],
                    ),
                    "sw_out": interpolate_value(
                        target_ts=ts,
                        known_ts=hourly_ts,
                        values=hourly_series["sw_out"],
                    ),
                }
            )

        weather_30min = (
            pd.DataFrame(records)
            .set_index("timestamp")
        )
        if weather_30min["tout"].isna().any():
            run.status = "failed"
            run.error_message = (
                "Forecast Tout missing after interpolation "
                "(hourly weather coverage insufficient)"
            )
            db.commit()
            return
        if weather_30min["rh_out"].isna().any():
            raise RuntimeError(
                "Forecast RH missing after interpolation — cannot run AH model"
            )
            db.commit()
            return
        future_df = weather_30min.copy()

        # Explicitly add columns that will be predicted / decided later
        future_df["tin"] = np.nan
        future_df["rh"] = np.nan
        future_df["comfort_index"] = np.nan
        future_df["hvac_mode"] = np.nan
        future_df['ah_out'] = AH_gm3_from_T_RH(future_df["tout"], future_df["rh_out"])
        full_timeline = pd.concat(
            [history_df, future_df],
            axis=0,
        )
        for _col in ["tin", "rh", "tout", "rh_out", "sw_out"]:
            if _col in full_timeline.columns:
                full_timeline[_col] = full_timeline[_col].ffill().bfill()
        full_timeline = build_features(full_timeline, pilot=get_pilot("gr"))
        start_time = pd.Timestamp(start_time)

        if start_time not in full_timeline.index:
            # snap to nearest 30-min grid safely
            start_time = full_timeline.index[full_timeline.index.searchsorted(start_time)]
        start_idx = full_timeline.index.get_loc(start_time)

        _dbg(f"\n--- full_timeline built ---")
        _dbg(f"  shape={full_timeline.shape}  start_idx={start_idx}  ts={full_timeline.index[start_idx]}")
        _win = full_timeline.iloc[start_idx - 14 : start_idx + 2]
        _dbg(f"  NaN in window [start_idx-14 : start_idx+2]:\n{_win.isna().sum()[_win.isna().sum() > 0].to_string() or '  (none)'}")
        _dbg(f"  tin/ah/ah_lag1 at window:\n{_win[['tin','ah','ah_lag1']].to_string() if 'ah' in _win.columns else '  ah not yet computed'}")

        _check_cancel(run_id)

        if start_idx < 0 or start_idx + 48 > len(full_timeline):
            raise RuntimeError(
                f"Invalid start_idx={start_idx} for horizon=48 "
                f"(len(full_feat)={len(full_timeline)})"
            )

        for ts, row in full_timeline.iterrows():
            nan_cols = row[row.isna()].index.tolist()

        season_48 = (
            full_timeline["season"]
            .iloc[start_idx : start_idx + 48]
            .astype(float)
            .to_numpy()
        )
        if len(season_48) != 48:
            raise RuntimeError(
                f"season_48 length mismatch: expected 48, got {len(season_48)}"
            )

        device = "cuda" if torch.cuda.is_available() else "cpu"
        warmup_feat = full_timeline.loc[full_timeline.index < start_time].tail(LSTM_MAX_WINDOW_STEPS)

        horizon_feat = full_timeline.loc[(full_timeline.index >= start_time) & (full_timeline.index < end_time)]
        tin0 = float(history_df["tin"].iloc[-1])
        rh0 = float(history_df["rh"].iloc[-1]) if pd.notna(history_df["rh"].iloc[-1]) else 50.0
        comfort0 = float(history_df["comfort_index"].iloc[-1]) if pd.notna(history_df["comfort_index"].iloc[-1]) else 50.0

        if run.manual_pv_48 is not None:
            pv_48 = np.asarray(run.manual_pv_48, dtype=int)

            if pv_48.shape != (48,):
                raise RuntimeError("manual_pv_48 must have length 48")

            if not set(np.unique(pv_48)).issubset({0, 1}):
                raise RuntimeError("manual_pv_48 must be binary (0/1)")

            logger.info("Using MANUAL PV override for run %s", run_id)

        else:
            pv_48 = load_pv_indicator_48(
                db=db,
                site_id=site_id,
                horizon_index=horizon_index,
            )
        tout_48 = horizon_feat["tout"].astype(float).values

        season = float(horizon_feat["season"].iloc[0])

        rc_rows = db.execute(
            text("""
                SELECT
                    cd.timestamp,
                    cd.tin,
                    cd.hvac_mode,
                    e.tout
                FROM comfort_data cd
                LEFT JOIN environmental_data e
                ON e.site_id = cd.site_id
                AND e.timestamp = cd.timestamp
                WHERE cd.site_id = :site_id
                AND EXTRACT(MONTH FROM cd.timestamp) = ANY(:rc_months)
                AND cd.timestamp < :start_time
                ORDER BY cd.timestamp
            """),
            {
                "site_id": site_id,
                "rc_months": list(rc_months),
                "start_time": start_time,
            },
        ).mappings().all()
        rc_history_df = pd.DataFrame(rc_rows)

        if not rc_history_df.empty:
            rc_history_df["timestamp"] = pd.to_datetime(
                rc_history_df["timestamp"]
            )
            rc_history_df = rc_history_df.set_index("timestamp")

        if rc_history_df["tout"].isna().any():
            reconcile_environmental_data(
                db=db,
                site_id=site_id,
                start_ts=rc_history_df.index.min(),
                end_ts=rc_history_df.index.max(),
                resolution="30min",
                fill_nulls_only=True,
                dry_run=False,
            )
            rc_history_df = reload_rc_history_df(db, site_id, rc_history_df.index)

        

        # reconcile_environmental_data(
        #     db=db,
        #     site_id=site_id,
        #     start_ts=rc_history_df.index.min(),
        #     end_ts=rc_history_df.index.max(),
        #     resolution=resolution,
        #     fill_nulls_only=True,
        #     dry_run=False,
        # )
        print('NULLS: ', rc_history_df.isna().sum())
        
        nan_tout = rc_history_df[rc_history_df["tout"].isna()]
        if not nan_tout.empty:
            missing_ts = list(nan_tout.index)
            logger.error("[RC DEBUG] Missing tout timestamps (%d): %s", len(missing_ts), missing_ts[:20])

            db_rows = db.execute(
                text("""
                    SELECT timestamp, tout, rh_out, sw_out
                    FROM environmental_data
                    WHERE site_id = :site_id
                    AND timestamp = ANY(:ts)
                    ORDER BY timestamp
                """),
                {"site_id": site_id, "ts": missing_ts},
            ).mappings().all()

            logger.error("[RC DEBUG] Environmental rows for missing timestamps: %s", db_rows[:20])
        nan_rows = rc_history_df[rc_history_df["tout"].isna()]
       
        missing_ts = list(nan_rows.index)

        rows = db.execute(
            text("""
                SELECT timestamp, tout, rh_out, sw_out
                FROM environmental_data
                WHERE site_id = :site_id
                AND timestamp = ANY(:ts)
                ORDER BY timestamp
            """),
            {
                "site_id": site_id,
                "ts": missing_ts,
            },
        ).mappings().all()

        env_df = pd.DataFrame(rows)
       # --- RC HISTORY SANITIZATION ---
        if rc_history_df["tout"].isna().any():
            nan_idx = rc_history_df[rc_history_df["tout"].isna()].index
            total_nans = len(nan_idx)

            if total_nans > 5:
                raise RuntimeError(
                    f"Too many Tout NaNs in RC history ({total_nans}), refusing to proceed"
                )

            logger.warning(
                "[RC FIX] Filling %d missing Tout values inside RC history window via interpolation",
                total_nans,
            )

            # Time interpolation first (best physical assumption)
            rc_history_df["tout"] = rc_history_df["tout"].interpolate(
                method="time",
                limit=5,
            )
            # rc_history_df["sw_out"] = rc_history_df["sw_out"].interpolate(
            #     method="time",
            #     limit=5,
            # )
            # rc_history_df["rh_out"] = rc_history_df["rh_out"].interpolate(
            #     method="time",
            #     limit=5,
            # )

            # If still NaNs (e.g. leading/trailing), forward/backward fill
            rc_history_df["tout"] = rc_history_df["tout"].ffill().bfill()
            # rc_history_df["sw_out"] = rc_history_df["sw_out"].ffill().bfill()
            # rc_history_df["rh_out"] = rc_history_df["rh_out"].ffill().bfill()


            # Final hard check
            if rc_history_df["tout"].isna().any():
                raise RuntimeError("Failed to sanitize Tout for RC fitting")
            
        rc_history_df = rc_history_df.dropna()
        print('NULLS: ', rc_history_df.isna().sum())

        rc_models = fit_rc_by_thermal_regime(rc_history_df)
        Tout_now = float(tout_48[0])

        _check_cancel(run_id)

        regime_now = 'heating' if season == 1 else 'cooling'
        rc = rc_models[regime_now]

        Tmin = 22.0 if regime_now == 'cooling' else 20.0
        Tmax = 25.0 if regime_now == 'cooling' else 24.0

        cfg_rc = RCConfig(
            horizon=48,
            Tmin=Tmin,
            Tmax=Tmax,
            w_low=1.0,
            w_high=2.2,
            lambda_noPV=1.2,
            lambda_slack=80.0,
            lambda_switch=0.05,
            lambda_energy=0.5,
            safety_buffer=0.0,
            solver="highs",
            time_limit_sec=60,
        )

        sol = optimize_schedule_with_rc(
            rc=rc,
            Tin0=tin0,
            Tout_forecast=tout_48,
            pv_forecast=pv_48,
            cfg=cfg_rc,
        )

        hvac_mode = enforce_min_on_duration(sol["hvac_mode"], min_len=2)

        _check_cancel(run_id)

        config_gr = get_pilot("gr")
        db_site = db.query(Site).filter(Site.id == site_id).first()
        db_site_name = db_site.name if db_site else None
        gr_site_info = next((si for si in config_gr.sites.values() if si.name == db_site_name), None)
        minio_site = gr_site_info.minio_key if gr_site_info and gr_site_info.minio_key else f"df_{site_id}"

        def simulate_fn(schedule: np.ndarray):
            return rollout_48_steps_minio(
                df=full_timeline,
                start_idx=start_idx,
                hvac_mode_48=schedule,
                country="gr",
                site=minio_site,
                regime=regime_now,
                device=device,
            )
        def maybe_relax(sched, Tin, RH):
            return relax_schedule_for_efficiency(
                simulate_fn=simulate_fn,
                pv=pv_48,
                sched_in=sched,
                season_seq=season_48,
                comfort_min=80.0,
                relax_threshold=90.0,
                safety_margin=3.0,
                min_on_steps=2,
                prefer_nopv_first=True,
                max_iters=30,
                Tin_initial=Tin,
                RH_initial=RH,
            )

        
        Tin, RH = simulate_fn(hvac_mode)
        print("[COMFORT DEBUG] Tin range: min=%.3f max=%.3f" % (np.nanmin(Tin), np.nanmax(Tin)))
        print("[COMFORT DEBUG] RH  range: min=%.3f max=%.3f" % (np.nanmin(RH), np.nanmax(RH)))

        bad = np.where(~np.isfinite(Tin) | ~np.isfinite(RH))[0]
        if bad.size:
            i = int(bad[0])
            print("[COMFORT DEBUG] Non-finite at i=%d Tin=%r RH=%r" % (i, Tin[i], RH[i]))
            raise RuntimeError("Non-finite Tin/RH before PMV")

        comfort = compute_comfort_percent(Tin, RH, season_48)
        feasible = bool((comfort >= 80.0).all())

        # Walk through repair strategies; best result lands in final_* vars
        final_sched, final_Tin, final_RH = hvac_mode, Tin, RH  # infeasible fallback

        _dbg(f"\n--- initial simulate_fn result ---")
        _dbg(f"  feasible={feasible}")
        _dbg(f"  Tin  min={float(np.nanmin(Tin)):.3f}  max={float(np.nanmax(Tin)):.3f}  nan={int(np.isnan(Tin).sum())}")
        _dbg(f"  RH   min={float(np.nanmin(RH)):.3f}  max={float(np.nanmax(RH)):.3f}  nan={int(np.isnan(RH).sum())}")

        if feasible:
            sched_r, Tin_r, RH_r, _ = maybe_relax(hvac_mode, Tin, RH)
            final_sched, final_Tin, final_RH = sched_r, Tin_r, RH_r
        else:
            sched1, Tin1, RH1, feas1 = repair_to_feasible(
                simulate_fn=simulate_fn,
                pv=pv_48,
                sched_in=hvac_mode,
                season_seq=season_48,
                comfort_min=80.0,
                max_iters=40,
            )
            if feas1:
                sched_r, Tin_r, RH_r, _ = maybe_relax(sched1, Tin1, RH1)
                final_sched, final_Tin, final_RH = sched_r, Tin_r, RH_r
            else:
                sched2, Tin2, RH2, feas2 = harden_schedule_until_comfort(
                    simulate_fn=simulate_fn,
                    pv=pv_48,
                    sched_in=sched1,
                    season_seq=season_48,
                    comfort_min=80.0,
                    min_on_steps=2,
                    max_passes=6,
                )
                if feas2:
                    sched_r, Tin_r, RH_r, _ = maybe_relax(sched2, Tin2, RH2)
                    final_sched, final_Tin, final_RH = sched_r, Tin_r, RH_r

        min_comfort = float(np.min(compute_comfort_percent(final_Tin, final_RH, season_48)))

        out_df = pd.DataFrame(index=horizon_index)

        out_df["hvac_mode"] = final_sched.astype(int)
        out_df["tin"] = final_Tin.astype(float)
        out_df["rh"] = final_RH.astype(float)
        out_df["comfort_index"] = compute_comfort_percent(
            final_Tin,
            final_RH,
            season_48,
        )

        db.execute(text("DELETE FROM optimization_data WHERE run_id = :run_id"), {"run_id": run_id})

        payload = [
            OptimizationData(
                run_id=run_id,
                timestamp=ts.to_pydatetime(),
                tin=float(out_df.at[ts, "tin"]),
                rh=float(out_df.at[ts, "rh"]),
                hvac_mode=int(out_df.at[ts, "hvac_mode"]),
                comfort_index=float(out_df.at[ts, "comfort_index"]),
            )
            for ts in out_df.index
        ]
        db.add_all(payload)

        run.status = "succeeded"
        run.error_message = None
        db.commit()
        return
            

    except _RunCancelled:
        db.rollback()
        logger.info("OptimizationRun %s was cancelled", run_id)
        _dbg(f"\n--- run {run_id} CANCELLED ---")
        if run is not None:
            try:
                run.status = "cancelled"
                run.error_message = "Cancelled by user"
                db.commit()
            except Exception:
                db.rollback()

    except Exception as exc:
        db.rollback()
        logger.exception("OptimizationRun %s FAILED: %s", run_id, exc)
        _dbg(f"\n!!! EXCEPTION: {type(exc).__name__}: {exc}")

        if run is not None:
            try:
                run.status = "failed"
                run.error_message = str(exc)
                db.commit()
            except Exception:
                db.rollback()
                logger.exception("Failed to mark OptimizationRun %s as failed", run_id)

    finally:
        _clear_cancelled(run_id)
        _dbg(f"\n=== run {run_id} finished ===")
        set_debug_log(None)
        db.close()

def ceil_to_half_hour(dt: datetime) -> datetime:
    dt = dt.replace(second=0, microsecond=0)
    minutes = dt.minute
    remainder = minutes % 30

    if remainder == 0:
        return dt

    return dt + timedelta(minutes=(30 - remainder))

@router.post("/{site_id}/run", status_code=202)
async def trigger_optimization_run(
    site_id: int,
    payload: OptimizationRunRequest,
    background_tasks: BackgroundTasks,
    pilot: str = Query("gr"),
    db: Session = Depends(get_db),
):
    config = get_pilot(pilot)

    if is_virtual_site(site_id):
        return _trigger_optimization_virtual(site_id, payload, config)

    if config.data_source == "api":
        return _trigger_optimization_hu(site_id, payload, config)

    return _trigger_optimization_gr(site_id, payload, background_tasks, db)


def _trigger_optimization_hu(
    site_id: int,
    payload: OptimizationRunRequest,
    config: PilotConfig,
) -> dict:
    """
    HU optimization: synchronous data fetch + validation.
    Returns immediately with validation results .
    """
    # ── 1) Validate site exists in pilot config ─────────────────────────────
    site_info = config.sites.get(site_id)
    if not site_info:
        raise HTTPException(status_code=404, detail=f"Site {site_id} not found in {config.code} pilot")

    if not site_info.sensor_uuid:
        raise HTTPException(
            status_code=422,
            detail=f"No sensor UUID configured for site {site_id}. Check .env.",
        )

    # ── 2) Check no HU run already in progress for this site ────────────────
    with _hu_runs_lock:
        for rid, r in _hu_runs.items():
            if r.get("site_id") == site_id and r.get("status") in ("queued", "running"):
                raise HTTPException(
                    status_code=409,
                    detail="Optimization already running for this site",
                )

    run_id = _next_hu_run_id()
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    start_time = ceil_to_half_hour(now_utc)
    end_time = start_time + timedelta(hours=24)

    _store_hu_run(run_id, {
        "site_id": site_id,
        "status": "running",
        "error_message": None,
        "start_time": start_time,
        "end_time": end_time,
        "created_at": now_utc,
        "data": [],
    })

    # ── 3) Fetch sensor data from Békéscsaba API ────────────────────────────
    try:
        today = now_utc.date()

        measured = fetch_sensor_range(
            sensor_id=site_info.sensor_uuid,
            start_month="2025-04",
            end_month=today.strftime("%Y-%m"),
        )

        if measured.empty:
            _store_hu_run(run_id, {
                **_get_hu_run(run_id),
                "status": "failed",
                "error_message": f"No sensor readings returned from API for site {site_id}",
            })
            return {"run_id": run_id, "site_id": site_id, "status": "failed",
                    "error_message": f"No sensor readings from API for site {site_id}"}

        # Normalize to tz-aware UTC so it aligns with weather (also tz-aware UTC)
        if measured.index.tz is None:
            measured.index = measured.index.tz_localize("UTC")

        logger.info(
            "HU opt site=%s: fetched %d resampled rows, range [%s .. %s]",
            site_id, len(measured),
            measured.index.min(), measured.index.max(),
        )

    except Exception as e:
        _store_hu_run(run_id, {
            **_get_hu_run(run_id),
            "status": "failed",
            "error_message": f"Sensor data fetch failed: {e}",
        })
        logger.error("HU opt sensor fetch failed site=%s: %s", site_id, e, exc_info=True)
        return {"run_id": run_id, "site_id": site_id, "status": "failed",
                "error_message": f"Sensor data fetch failed: {e}"}

    # ── 4) Fetch weather from Open-Meteo ────────────────────────────────────
    try:
        weather_start = measured.index.min().date()
        weather_end = (end_time + timedelta(days=1)).date()

        weather = fetch_weather(
            start_date=str(weather_start),
            end_date=str(weather_end),
            lat=config.latitude,
            lon=config.longitude,
        )
        weather_30 = upsample_weather_30min(weather)

        logger.info(
            "HU opt site=%s: weather %d rows [%s .. %s]",
            site_id, len(weather_30),
            weather_30.index.min(), weather_30.index.max(),
        )

    except Exception as e:
        _store_hu_run(run_id, {
            **_get_hu_run(run_id),
            "status": "failed",
            "error_message": f"Weather fetch failed: {e}",
        })
        logger.error("HU opt weather fetch failed site=%s: %s", site_id, e, exc_info=True)
        return {"run_id": run_id, "site_id": site_id, "status": "failed",
                "error_message": f"Weather fetch failed: {e}"}

    # ── 5) Compute energy balance via process_sensor ────────────────────────
    try:
        balance, diag = process_sensor(site_id, measured,
                                       compute_production_shape(weather_30),
                                       weather_30)
        balance = format_balance_local(balance)

        logger.info(
            "HU opt site=%s: energy balance %d rows, cols=%s",
            site_id, len(balance), list(balance.columns),
        )

    except Exception as e:
        _store_hu_run(run_id, {
            **_get_hu_run(run_id),
            "status": "failed",
            "error_message": f"Energy balance computation failed: {e}",
        })
        logger.error("HU opt energy balance failed site=%s: %s", site_id, e, exc_info=True)
        return {"run_id": run_id, "site_id": site_id, "status": "failed",
                "error_message": f"Energy balance computation failed: {e}"}

    # ── 6) Validate: enough recent data for a 24h horizon ───────────────────
    horizon_start = start_time.replace(tzinfo=timezone.utc)
    last_data_ts = measured.index.max()
    gap_hours = (horizon_start - last_data_ts).total_seconds() / 3600

    if gap_hours > 6:
        msg = f"Data too stale: last reading at {last_data_ts}, horizon starts at {horizon_start} ({gap_hours:.1f}h gap)"
        _store_hu_run(run_id, {
            **_get_hu_run(run_id),
            "status": "failed",
            "error_message": msg,
        })
        return {"run_id": run_id, "site_id": site_id, "status": "failed",
                "error_message": msg}

    logger.info(
        "HU opt site=%s: data validation passed ✓ (run_id=%s, %d sensor rows, %.1fh gap)",
        site_id, run_id, len(measured), gap_hours,
    )

    # ── 7) Build history window for RC + ML ─────────────────────────────────
    try:
        # balance has columns: production_kwh, energy_consumption, tout, tin, rh
        # We need: tin, tout, rh, hvac_mode, sw_out, rh_out for feature building
        history_df = balance.copy()

        # Rename to match expected column names
        if "energy_consumption" in history_df.columns:
            history_df = history_df.rename(columns={"energy_consumption": "consumption_kwh"})

        # Run proper HVAC disaggregation on the full balance dataset
        disagg_result = run_hvac_disaggregation(
            history_df,
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
        history_df["hvac_mode"] = disagg_result["df_with_hvac"]["hvac_mode"]

        # Cache full balance + hvac_mode for the forecast endpoint
        disagg_cache_put(config.code, site_id, history_df, history_df["hvac_mode"])

        # Keep full disaggregated balance for RC fitting (before trim)
        rc_ready_df = history_df[["tin", "tout", "consumption_kwh", "hvac_mode"]].copy()

        logger.info(
            "HU opt site=%s: disaggregation complete, hvac_mode distribution: %s",
            site_id, history_df["hvac_mode"].value_counts().to_dict(),
        )

        # Add weather columns that build_features expects
        weather_aligned = weather_30.reindex(history_df.index)
        if "ghi" in weather_aligned.columns:
            history_df["sw_out"] = weather_aligned["ghi"]
        else:
            history_df["sw_out"] = 0.0
        if "temperature_2m" in weather_aligned.columns and "tout" not in history_df.columns:
            history_df["tout"] = weather_aligned["temperature_2m"]
        # rh_out from weather (Open-Meteo relative_humidity_2m)
        if "relative_humidity_2m" in weather_aligned.columns:
            history_df["rh_out"] = weather_aligned["relative_humidity_2m"]
        else:
            history_df["rh_out"] = 50.0
        history_df["rh_out"] = history_df["rh_out"].ffill().bfill().fillna(50.0)

        # Fill NaNs in tin/rh from measured data
        history_df["tin"] = history_df["tin"].ffill().bfill()
        history_df["rh"] = history_df["rh"].ffill().bfill()
        history_df["tout"] = history_df["tout"].ffill().bfill()
        history_df["sw_out"] = history_df["sw_out"].ffill().bfill().fillna(0.0)

        # Comfort index placeholder
        history_df["comfort_index"] = 50.0

        # Trim to last N steps for history (warmup + buffer)
        warmup_steps = LSTM_MAX_WINDOW_STEPS + WARMUP_BUFFER_STEPS
        if len(history_df) > warmup_steps:
            history_df = history_df.tail(warmup_steps)

        if len(history_df) < LSTM_MAX_WINDOW_STEPS:
            msg = f"Insufficient history for ML warmup: need {LSTM_MAX_WINDOW_STEPS}, got {len(history_df)}"
            _store_hu_run(run_id, {
                **_get_hu_run(run_id), "status": "failed", "error_message": msg,
            })
            return {"run_id": run_id, "site_id": site_id, "status": "failed",
                    "error_message": msg}

        logger.info("HU opt site=%s: history window %d rows [%s .. %s]",
                     site_id, len(history_df), history_df.index[0], history_df.index[-1])

    except Exception as e:
        _store_hu_run(run_id, {
            **_get_hu_run(run_id), "status": "failed",
            "error_message": f"History preparation failed: {e}",
        })
        logger.error("HU opt history prep failed site=%s: %s", site_id, e, exc_info=True)
        return {"run_id": run_id, "site_id": site_id, "status": "failed",
                "error_message": f"History preparation failed: {e}"}

    # ── 8) Build weather forecast for horizon ────────────────────────────────
    try:
        horizon_index = pd.date_range(
            start=start_time, end=end_time,
            freq="30min", inclusive="left",
        )
        if horizon_index.tz is None:
            horizon_index = horizon_index.tz_localize("UTC")

        # Get weather for horizon from already-fetched weather_30
        future_weather = weather_30.reindex(horizon_index)
        future_weather = future_weather.ffill().bfill()

        future_df = pd.DataFrame(index=horizon_index)
        future_df["tout"] = future_weather["temperature_2m"].values
        future_df["sw_out"] = future_weather["ghi"].values if "ghi" in future_weather.columns else 0.0
        if "relative_humidity_2m" in future_weather.columns:
            future_df["rh_out"] = future_weather["relative_humidity_2m"].values
        else:
            future_df["rh_out"] = 50.0
        future_df["tin"] = np.nan
        future_df["rh"] = np.nan
        future_df["comfort_index"] = np.nan
        future_df["hvac_mode"] = np.nan
        future_df["ah_out"] = AH_gm3_from_T_RH(future_df["tout"], future_df["rh_out"])

        # Ensure history index is also tz-aware UTC
        if history_df.index.tz is None:
            history_df.index = history_df.index.tz_localize("UTC")

        full_timeline = pd.concat([history_df, future_df], axis=0)

        # Fill exogenous columns
        for col in ["sw_out", "tout", "rh_out"]:
            if col in full_timeline.columns:
                full_timeline[col] = full_timeline[col].ffill().bfill()

        full_timeline = build_features(full_timeline, pilot=config)

        # Deduplicate index (history/future overlap can cause dupes)
        full_timeline = full_timeline[~full_timeline.index.duplicated(keep="last")]

        start_ts = pd.Timestamp(start_time, tz="UTC")
        if start_ts not in full_timeline.index:
            start_ts = full_timeline.index[full_timeline.index.searchsorted(start_ts)]
        start_idx = full_timeline.index.get_loc(start_ts)

        if start_idx + 48 > len(full_timeline):
            raise RuntimeError(f"Invalid start_idx={start_idx} for horizon=48 (len={len(full_timeline)})")

        tout_48 = full_timeline["tout"].iloc[start_idx:start_idx + 48].astype(float).values
        season_48 = full_timeline["season"].iloc[start_idx:start_idx + 48].astype(float).to_numpy()
        tin0 = float(history_df["tin"].iloc[-1])

        logger.info("HU opt site=%s: full_timeline %d rows, start_idx=%d, tin0=%.2f",
                     site_id, len(full_timeline), start_idx, tin0)

    except Exception as e:
        _store_hu_run(run_id, {
            **_get_hu_run(run_id), "status": "failed",
            "error_message": f"Feature building failed: {e}",
        })
        logger.error("HU opt feature building failed site=%s: %s", site_id, e, exc_info=True)
        return {"run_id": run_id, "site_id": site_id, "status": "failed",
                "error_message": f"Feature building failed: {e}"}

    # ── 9) PV indicator ──────────────────────────────────────────────────────
    # Compute PV production forecast for the horizon from weather forecast
    if diag.get("has_pv") and diag.get("k_final"):
        horizon_shape = compute_production_shape(weather_30).reindex(horizon_index).fillna(0)
        horizon_prod = estimate_production(
            horizon_shape,
            k=diag["k_final"],
            pv_kwp=site_info.pv_kwp,
            ac_kw=site_info.ac_kw,
            opening_hour=site_info.pv_opening_hour,
            closing_hour=site_info.pv_closing_hour,
        )
        prod_horizon_kwh = horizon_prod["production_kwh"].values
    else:
        prod_horizon_kwh = np.zeros(48)

    if len(prod_horizon_kwh) != 48:
        prod_horizon_kwh = np.zeros(48)
    prod_max = prod_horizon_kwh.max()
    prod_horizon_pct = (prod_horizon_kwh / prod_max * 100.0) if prod_max > 0 else np.zeros(48)

    if payload.manual_pv_48 is not None:
        pv_48 = np.asarray(payload.manual_pv_48, dtype=int)
        logger.info("HU opt site=%s: using manual PV override", site_id)
    else:
        # Derive from production in balance — if production > threshold, PV is on
        pv_48 = (prod_horizon_kwh > 0.1).astype(int)
        logger.info("HU opt site=%s: PV on for %d/48 steps", site_id, pv_48.sum())

    # ── 10) RC model fitting ─────────────────────────────────────────────────
    try:
        # Use full disaggregated balance (from step 7, before trim) for RC fitting
        rc_df = rc_ready_df.copy()
        rc_df["tin"] = rc_df["tin"].ffill().bfill()
        rc_df["tout"] = rc_df["tout"].ffill().bfill()
        rc_df = rc_df.dropna(subset=["tin", "tout"])

        if len(rc_df) < 200:
            raise RuntimeError(f"Insufficient RC data: {len(rc_df)} rows (need 200+)")

        rc_models = fit_rc_by_thermal_regime(rc_df)

        regime_now = config.thermal_regime(start_time.month)
        rc = rc_models[regime_now]

        Tmin = 22.0 if regime_now == "cooling" else 20.0
        Tmax = 25.0 if regime_now == "cooling" else 24.0

        logger.info("HU opt site=%s: RC fitted (%s regime), Tmin=%.1f Tmax=%.1f",
                     site_id, regime_now, Tmin, Tmax)

    except Exception as e:
        _store_hu_run(run_id, {
            **_get_hu_run(run_id), "status": "failed",
            "error_message": f"RC model fitting failed: {e}",
        })
        logger.error("HU opt RC fitting failed site=%s: %s", site_id, e, exc_info=True)
        return {"run_id": run_id, "site_id": site_id, "status": "failed",
                "error_message": f"RC model fitting failed: {e}"}

    # ── 11) MILP optimization ────────────────────────────────────────────────
    try:
        cfg_rc = RCConfig(
            horizon=48, Tmin=Tmin, Tmax=Tmax,
            w_low=1.0, w_high=2.2,
            lambda_noPV=1.2, lambda_slack=80.0,
            lambda_switch=0.05, lambda_energy=0.5,
            safety_buffer=0.0, solver="highs", time_limit_sec=60,
        )

        sol = optimize_schedule_with_rc(
            rc=rc, Tin0=tin0,
            Tout_forecast=tout_48,
            pv_forecast=pv_48,
            cfg=cfg_rc,
        )

        hvac_mode = enforce_min_on_duration(sol["hvac_mode"], min_len=2)
        logger.info("HU opt site=%s: MILP solved, hvac_on=%d/48 steps",
                     site_id, int((hvac_mode > 0).sum()))

    except Exception as e:
        _store_hu_run(run_id, {
            **_get_hu_run(run_id), "status": "failed",
            "error_message": f"MILP optimization failed: {e}",
        })
        logger.error("HU opt MILP failed site=%s: %s", site_id, e, exc_info=True)
        return {"run_id": run_id, "site_id": site_id, "status": "failed",
                "error_message": f"MILP optimization failed: {e}"}

    # ── 12) ML rollout + repair ──────────────────────────────────────────────
    try:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        minio_site = f"df_{site_id}"
        regime = config.thermal_regime(start_time.month)

        def simulate_fn(schedule: np.ndarray):
            return rollout_48_steps_minio(
                df=full_timeline,
                start_idx=start_idx,
                hvac_mode_48=schedule,
                country=config.code,
                site=minio_site,
                regime=regime,
                device=device,
            )

        def maybe_relax(sched, Tin, RH):
            return relax_schedule_for_efficiency(
                simulate_fn=simulate_fn,
                pv=pv_48, sched_in=sched,
                season_seq=season_48,
                comfort_min=80.0, relax_threshold=90.0,
                safety_margin=3.0, min_on_steps=2,
                prefer_nopv_first=True, max_iters=30,
                Tin_initial=Tin, RH_initial=RH,
            )

        Tin, RH = simulate_fn(hvac_mode)
        comfort = compute_comfort_percent(Tin, RH, season_48)
        feasible = bool((comfort >= 80.0).all())

        final_sched, final_Tin, final_RH = hvac_mode, Tin, RH

        if feasible:
            sched_r, Tin_r, RH_r, _ = maybe_relax(hvac_mode, Tin, RH)
            final_sched, final_Tin, final_RH = sched_r, Tin_r, RH_r
        else:
            sched1, Tin1, RH1, feas1 = repair_to_feasible(
                simulate_fn=simulate_fn,
                pv=pv_48, sched_in=hvac_mode,
                season_seq=season_48,
                comfort_min=80.0, max_iters=40,
            )
            if feas1:
                sched_r, Tin_r, RH_r, _ = maybe_relax(sched1, Tin1, RH1)
                final_sched, final_Tin, final_RH = sched_r, Tin_r, RH_r
            else:
                sched2, Tin2, RH2, feas2 = harden_schedule_until_comfort(
                    simulate_fn=simulate_fn,
                    pv=pv_48, sched_in=sched1,
                    season_seq=season_48,
                    comfort_min=80.0, min_on_steps=2, max_passes=6,
                )
                if feas2:
                    sched_r, Tin_r, RH_r, _ = maybe_relax(sched2, Tin2, RH2)
                    final_sched, final_Tin, final_RH = sched_r, Tin_r, RH_r
                else:
                    final_sched, final_Tin, final_RH = sched2, Tin2, RH2

        final_comfort = compute_comfort_percent(final_Tin, final_RH, season_48)

        logger.info("HU opt site=%s: ML rollout done, min_comfort=%.1f%%",
                     site_id, float(np.min(final_comfort)))

    except Exception as e:
        logger.error(
            "HU opt site=%s: ML model unavailable (%s)",
            site_id, e,
        )
        raise HTTPException(
            status_code=422,
            detail=f"No available model for site_id={site_id}. "
                   "Ensure the ML model service is running before optimizing.",
        )

    # ── 13) Build output + store ─────────────────────────────────────────────
    # Convert horizon timestamps to Budapest local naive (same as other HU endpoints)
    from zoneinfo import ZoneInfo
    budapest = ZoneInfo(config.timezone)

    out_data = []
    for i, ts in enumerate(horizon_index):
        local_ts = ts.to_pydatetime().astimezone(budapest).replace(tzinfo=None)
        out_data.append({
            "timestamp": local_ts.isoformat(),
            "tin": float(final_Tin[i]),
            "rh": float(final_RH[i]),
            "hvac_mode": int(final_sched[i]),
            "comfort_index": float(final_comfort[i]),
            "production_kwh": round(float(prod_horizon_kwh[i]), 4),
            "prod_pct": round(float(prod_horizon_pct[i]), 1),
        })

    _store_hu_run(run_id, {
        "site_id": site_id,
        "status": "succeeded",
        "error_message": None,
        "start_time": start_time,
        "end_time": end_time,
        "created_at": now_utc,
        "data": out_data,
    })

    logger.info(
        "HU opt site=%s: optimization completed ✓ (run_id=%s, hvac_on=%d/48, min_comfort=%.1f%%)",
        site_id, run_id, int((final_sched > 0).sum()), float(np.min(final_comfort)),
    )

    return {
        "run_id": run_id,
        "site_id": site_id,
        "status": "succeeded",
        "horizon": {
            "start_time": start_time.isoformat(),
            "end_time": end_time.isoformat(),
        },
        "message": "HU optimization completed.",
    }


def _trigger_optimization_virtual(
    site_id: int,
    payload: OptimizationRunRequest,
    config: PilotConfig,
) -> dict:
    """
    Virtual (CSV-backed) demo optimization. Mirrors HU's synchronous
    in-memory pattern: stores the run in `_hu_runs` keyed by a negative
    run_id, returns immediately when complete.

    All historical and forecast data is read from the demo CSV (no DB,
    no Open-Meteo). PV must be supplied via `manual_pv_48`.
    """
    from utils.csv_virtual_site import get_virtual_optimizer_df

    site_info = config.sites.get(site_id)
    if not site_info:
        raise HTTPException(
            status_code=404,
            detail=f"Site {site_id} not found in {config.code} pilot",
        )

    if payload.manual_pv_48 is None:
        raise HTTPException(
            status_code=422,
            detail="manual_pv_48 is required for demo sites",
        )

    pv_48 = np.asarray(payload.manual_pv_48, dtype=int)
    if pv_48.shape != (48,):
        raise HTTPException(status_code=422, detail="manual_pv_48 must have length 48")
    if not set(np.unique(pv_48)).issubset({0, 1}):
        raise HTTPException(status_code=422, detail="manual_pv_48 must be binary (0/1)")

    with _hu_runs_lock:
        for rid, r in _hu_runs.items():
            if r.get("site_id") == site_id and r.get("status") in ("queued", "running"):
                raise HTTPException(
                    status_code=409,
                    detail="Optimization already running for this site",
                )

    run_id = _next_hu_run_id()
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    start_time = ceil_to_half_hour(now_utc)
    end_time = start_time + timedelta(hours=24)

    _store_hu_run(run_id, {
        "site_id": site_id,
        "status": "running",
        "error_message": None,
        "start_time": start_time,
        "end_time": end_time,
        "created_at": now_utc,
        "data": [],
    })

    try:
        # ── Load CSV-backed timeline ──────────────────────────────────────
        df_all = get_virtual_optimizer_df()

        warmup_steps = LSTM_MAX_WINDOW_STEPS + WARMUP_BUFFER_STEPS
        history_start = start_time - timedelta(minutes=RES_MIN * warmup_steps)

        history_df = df_all.loc[
            (df_all.index >= history_start) & (df_all.index < start_time)
        ].copy()
        if len(history_df) < LSTM_MAX_WINDOW_STEPS:
            raise RuntimeError(
                f"Insufficient CSV history for ML warmup: need "
                f"{LSTM_MAX_WINDOW_STEPS}, got {len(history_df)}"
            )

        horizon_index = pd.date_range(
            start=start_time, end=end_time, freq="30min", inclusive="left",
        )
        future_csv = df_all.reindex(horizon_index)
        if future_csv["tout"].isna().any():
            raise RuntimeError(
                "Forecast Tout missing in CSV horizon — CSV does not cover "
                f"[{start_time} .. {end_time})"
            )

        future_df = pd.DataFrame(index=horizon_index)
        future_df["tout"]   = future_csv["tout"].values
        future_df["rh_out"] = future_csv["rh_out"].values
        future_df["sw_out"] = future_csv["sw_out"].values
        future_df["tin"] = np.nan
        future_df["rh"] = np.nan
        future_df["hvac_mode"] = np.nan
        future_df["ah_out"] = AH_gm3_from_T_RH(future_df["tout"], future_df["rh_out"])

        full_timeline = pd.concat([history_df, future_df], axis=0)
        for col in ["tin", "rh", "tout", "rh_out", "sw_out"]:
            full_timeline[col] = full_timeline[col].ffill().bfill()
        full_timeline = build_features(full_timeline, pilot=config)
        full_timeline = full_timeline[~full_timeline.index.duplicated(keep="last")]

        start_ts = pd.Timestamp(start_time)
        if start_ts not in full_timeline.index:
            start_ts = full_timeline.index[full_timeline.index.searchsorted(start_ts)]
        start_idx = full_timeline.index.get_loc(start_ts)
        if start_idx + 48 > len(full_timeline):
            raise RuntimeError(
                f"Invalid start_idx={start_idx} for horizon=48 "
                f"(len={len(full_timeline)})"
            )

        tout_48 = full_timeline["tout"].iloc[start_idx:start_idx + 48].astype(float).values
        season_48 = full_timeline["season"].iloc[start_idx:start_idx + 48].astype(float).to_numpy()
        tin0 = float(history_df["tin"].iloc[-1])

        # ── RC fitting on CSV history filtered by regime months ──────────
        if start_time.month in SUMMER_MONTHS:
            rc_months = SUMMER_MONTHS
        else:
            rc_months = WINTER_MONTHS

        rc_df = df_all[df_all.index.month.isin(rc_months) & (df_all.index < start_time)][
            ["tin", "tout", "hvac_mode"]
        ].copy()
        rc_df = rc_df.dropna()
        if len(rc_df) < 200:
            raise RuntimeError(f"Insufficient RC data: {len(rc_df)} rows (need 200+)")

        rc_models = fit_rc_by_thermal_regime(rc_df)
        regime_now = config.thermal_regime(start_time.month)
        rc = rc_models[regime_now]

        Tmin = 22.0 if regime_now == "cooling" else 20.0
        Tmax = 25.0 if regime_now == "cooling" else 24.0

        # ── MILP ────────────────────────────────────────────────────────
        cfg_rc = RCConfig(
            horizon=48, Tmin=Tmin, Tmax=Tmax,
            w_low=1.0, w_high=2.2,
            lambda_noPV=1.2, lambda_slack=80.0,
            lambda_switch=0.05, lambda_energy=0.5,
            safety_buffer=0.0, solver="highs", time_limit_sec=60,
        )
        sol = optimize_schedule_with_rc(
            rc=rc, Tin0=tin0,
            Tout_forecast=tout_48,
            pv_forecast=pv_48,
            cfg=cfg_rc,
        )
        hvac_mode = enforce_min_on_duration(sol["hvac_mode"], min_len=2)

        # ── ML rollout / repair / harden / relax ────────────────────────
        device = "cuda" if torch.cuda.is_available() else "cpu"
        minio_site = site_info.minio_key

        def simulate_fn(schedule: np.ndarray):
            return rollout_48_steps_minio(
                df=full_timeline,
                start_idx=start_idx,
                hvac_mode_48=schedule,
                country=config.code,
                site=minio_site,
                regime=regime_now,
                device=device,
            )

        def maybe_relax(sched, Tin, RH):
            return relax_schedule_for_efficiency(
                simulate_fn=simulate_fn,
                pv=pv_48, sched_in=sched,
                season_seq=season_48,
                comfort_min=80.0, relax_threshold=90.0,
                safety_margin=3.0, min_on_steps=2,
                prefer_nopv_first=True, max_iters=30,
                Tin_initial=Tin, RH_initial=RH,
            )

        Tin, RH = simulate_fn(hvac_mode)
        comfort = compute_comfort_percent(Tin, RH, season_48)
        feasible = bool((comfort >= 80.0).all())

        final_sched, final_Tin, final_RH = hvac_mode, Tin, RH
        if feasible:
            sched_r, Tin_r, RH_r, _ = maybe_relax(hvac_mode, Tin, RH)
            final_sched, final_Tin, final_RH = sched_r, Tin_r, RH_r
        else:
            sched1, Tin1, RH1, feas1 = repair_to_feasible(
                simulate_fn=simulate_fn,
                pv=pv_48, sched_in=hvac_mode,
                season_seq=season_48,
                comfort_min=80.0, max_iters=40,
            )
            if feas1:
                sched_r, Tin_r, RH_r, _ = maybe_relax(sched1, Tin1, RH1)
                final_sched, final_Tin, final_RH = sched_r, Tin_r, RH_r
            else:
                sched2, Tin2, RH2, feas2 = harden_schedule_until_comfort(
                    simulate_fn=simulate_fn,
                    pv=pv_48, sched_in=sched1,
                    season_seq=season_48,
                    comfort_min=80.0, min_on_steps=2, max_passes=6,
                )
                if feas2:
                    sched_r, Tin_r, RH_r, _ = maybe_relax(sched2, Tin2, RH2)
                    final_sched, final_Tin, final_RH = sched_r, Tin_r, RH_r
                else:
                    final_sched, final_Tin, final_RH = sched2, Tin2, RH2

        final_comfort = compute_comfort_percent(final_Tin, final_RH, season_48)

        # ── Output: timestamps in Athens local naive ────────────────────
        from zoneinfo import ZoneInfo
        athens = ZoneInfo(config.timezone)
        out_data = []
        for i, ts in enumerate(horizon_index):
            local_ts = ts.to_pydatetime().replace(tzinfo=timezone.utc).astimezone(athens).replace(tzinfo=None)
            out_data.append({
                "timestamp": local_ts.isoformat(),
                "tin": float(final_Tin[i]),
                "rh": float(final_RH[i]),
                "hvac_mode": int(final_sched[i]),
                "comfort_index": float(final_comfort[i]),
                "pv_indicator": int(pv_48[i]),
            })

        _store_hu_run(run_id, {
            "site_id": site_id,
            "status": "succeeded",
            "error_message": None,
            "start_time": start_time,
            "end_time": end_time,
            "created_at": now_utc,
            "data": out_data,
        })

        logger.info(
            "Virtual opt site=%s: completed (run_id=%s, hvac_on=%d/48, min_comfort=%.1f%%)",
            site_id, run_id, int((final_sched > 0).sum()), float(np.min(final_comfort)),
        )

        return {"run_id": run_id, "site_id": site_id, "status": "succeeded"}

    except Exception as e:
        _store_hu_run(run_id, {
            **_get_hu_run(run_id),
            "status": "failed",
            "error_message": str(e),
        })
        logger.error("Virtual opt site=%s: failed: %s", site_id, e, exc_info=True)
        return {"run_id": run_id, "site_id": site_id, "status": "failed",
                "error_message": str(e)}


def _forecast_virtual(site_id: int, req, config: PilotConfig) -> dict:
    """
    CSV-fed forecast for the demo summer_home site: ML rollout only,
    no MILP, no repair. Returns predicted Tin/RH/comfort for the next 48
    half-hour steps starting at `req.start_time`, given an optional
    `hvac_mode_48` schedule.
    """
    from utils.csv_virtual_site import get_virtual_optimizer_df
    from zoneinfo import ZoneInfo

    site_info = config.sites.get(site_id)
    if not site_info:
        raise HTTPException(404, f"Site {site_id} not found in {config.code} pilot")

    start_time = pd.Timestamp(req.start_time)
    if start_time.tzinfo is not None:
        start_time = start_time.tz_convert("UTC").tz_localize(None)
    else:
        start_time = start_time.replace(tzinfo=None)

    if req.hvac_mode_48 is not None:
        hvac_mode_48 = np.asarray(req.hvac_mode_48, dtype=int)
        if hvac_mode_48.shape != (48,):
            raise HTTPException(400, "hvac_mode_48 must have exactly 48 values")
    else:
        hvac_mode_48 = np.zeros(48, dtype=int)

    df_all = get_virtual_optimizer_df()

    warmup_steps = LSTM_MAX_WINDOW_STEPS + WARMUP_BUFFER_STEPS
    history_start = start_time - timedelta(minutes=RES_MIN * warmup_steps)
    history_df = df_all.loc[
        (df_all.index >= history_start) & (df_all.index < start_time)
    ].copy()
    if len(history_df) < LSTM_MAX_WINDOW_STEPS:
        raise HTTPException(
            422,
            f"Insufficient CSV history for ML warmup at {start_time}: "
            f"need {LSTM_MAX_WINDOW_STEPS}, got {len(history_df)}",
        )

    horizon_index = pd.date_range(start=start_time, periods=48, freq="30min")
    future_csv = df_all.reindex(horizon_index)
    if future_csv["tout"].isna().any():
        raise HTTPException(
            422,
            f"CSV does not cover the requested horizon starting {start_time}",
        )

    future_df = pd.DataFrame(index=horizon_index)
    future_df["tout"]   = future_csv["tout"].values
    future_df["rh_out"] = future_csv["rh_out"].values
    future_df["sw_out"] = future_csv["sw_out"].values
    future_df["tin"] = np.nan
    future_df["rh"] = np.nan
    future_df["hvac_mode"] = hvac_mode_48
    future_df["ah_out"] = AH_gm3_from_T_RH(future_df["tout"], future_df["rh_out"])

    full_timeline = pd.concat([history_df, future_df], axis=0)
    for col in ["tin", "rh", "tout", "rh_out", "sw_out"]:
        full_timeline[col] = full_timeline[col].ffill().bfill()
    full_timeline = build_features(full_timeline, pilot=config)
    full_timeline = full_timeline[~full_timeline.index.duplicated(keep="last")]

    start_ts = pd.Timestamp(start_time)
    if start_ts not in full_timeline.index:
        start_ts = full_timeline.index[full_timeline.index.searchsorted(start_ts)]
    start_idx = full_timeline.index.get_loc(start_ts)
    if start_idx + 48 > len(full_timeline):
        raise HTTPException(500, "Insufficient data for ML rollout horizon")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    minio_site = site_info.minio_key
    regime = config.thermal_regime(start_time.month)

    try:
        Tin, RH = rollout_48_steps_minio(
            df=full_timeline,
            start_idx=start_idx,
            hvac_mode_48=hvac_mode_48,
            country=config.code,
            site=minio_site,
            regime=regime,
            device=device,
        )
    except Exception as e:
        logger.error("Virtual forecast site=%s: rollout failed: %s", site_id, e, exc_info=True)
        raise HTTPException(500, f"ML rollout failed: {e}")

    season_48 = np.array(
        [1 if ts.month in config.heating_months else 0 for ts in horizon_index],
        dtype=int,
    )
    comfort = compute_comfort_percent(Tin, RH, season_48)

    athens = ZoneInfo(config.timezone)
    response = []
    for i, ts in enumerate(horizon_index):
        local_ts = ts.to_pydatetime().replace(tzinfo=timezone.utc).astimezone(athens).replace(tzinfo=None)
        response.append({
            "timestamp": local_ts.isoformat(),
            "tin_pred": round(float(Tin[i]), 2),
            "rh_pred": round(float(RH[i]), 2),
            "hvac_mode": int(hvac_mode_48[i]),
            "comfort_index": round(float(comfort[i]), 1),
        })

    return {"site_id": site_id, "forecast": response}


def _trigger_optimization_gr(
    site_id: int,
    payload: OptimizationRunRequest,
    background_tasks: BackgroundTasks,
    db: Session,
) -> dict:

    try:
        # Expire stale runs stuck in queued/running from old sessions
        stale_cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=2)
        stale_runs = (
            db.query(OptimizationRun)
            .filter(
                OptimizationRun.status.in_(["queued", "running"]),
                OptimizationRun.created_at < stale_cutoff,
            )
            .all()
        )
        for stale in stale_runs:
            stale.status = "failed"
            stale.error_message = "Expired: stuck for over 2 hours"
            logger.warning("Expiring stale optimization run %s (created %s)", stale.id, stale.created_at)
        if stale_runs:
            db.commit()

        # Check per-site: no duplicate runs for the same site
        existing = (
        db.query(OptimizationRun)
        .filter(
            OptimizationRun.site_id == site_id,
            OptimizationRun.status.in_(["queued", "running"]),
        )
        .first()
        )

        if existing:
            raise HTTPException(
                status_code=409,
                detail="Optimization already running for this site",
        )

        # Check global cap across all sites/pilots
        active_count = db.execute(
            text("""
                SELECT COUNT(*) FROM optimization_runs
                WHERE status IN ('queued', 'running')
            """),
        ).scalar()

        if active_count >= MAX_CONCURRENT_OPTIMIZATIONS:
            raise HTTPException(
                status_code=429,
                detail=f"Server busy: {active_count} optimization(s) already running. Max is {MAX_CONCURRENT_OPTIMIZATIONS}. Try again shortly.",
            )

        # Validate site exists
        exists = db.execute(
            text("SELECT 1 FROM sites WHERE id = :site_id"),
            {"site_id": site_id},
        ).scalar()

        if not exists:
            raise HTTPException(status_code=404, detail="Site not found")

        # Horizon: next 24 hours, aligned to half-hour
        # Use UTC for consistent timestamp handling
        start_time = ceil_to_half_hour(datetime.now(timezone.utc).replace(tzinfo=None))

        end_time = start_time + timedelta(hours=24)
        run = OptimizationRun(
            site_id=site_id,
            start_time=start_time,
            end_time=end_time,
            status="queued",
            error_message=None,
            manual_pv_48=payload.manual_pv_48,
        )

        db.add(run)
        db.commit()
        db.refresh(run)

        background_tasks.add_task(run_optimization_for_site, run.id)

        return {
            "run_id": run.id,
            "site_id": site_id,
            "status": run.status,
            "horizon": {"start_time": start_time, "end_time": end_time},
            "message": "Optimization scheduled (placeholder optimizer)",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("trigger_optimization_run error for site %s: %s", site_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("/runs/{run_id}")
def get_run(run_id: int, db: Session = Depends(get_db)):
    # Negative run_id → HU in-memory store
    if run_id < 0:
        return _get_run_hu(run_id)

    try:
        row = db.execute(
            text("""
                SELECT
                    id,
                    site_id,
                    status,
                    error_message,
                    start_time,
                    end_time,
                    created_at
                FROM optimization_runs
                WHERE id = :run_id
            """),
            {"run_id": run_id},
        ).mappings().first()

        if row is None:
            raise HTTPException(status_code=404, detail="Optimization run not found")

        # Get site timezone for timestamp conversion
        site = db.query(Site).filter(Site.id == row["site_id"]).first()
        if not site:
            raise HTTPException(status_code=404, detail="Site not found")

        site_tz = get_site_timezone(site.latitude, site.longitude)

        return {
            "run_id": row["id"],
            "site_id": row["site_id"],
            "status": row["status"],          # queued | running | succeeded | failed
            "error_message": row["error_message"],
            "start_time": utc_to_local(row["start_time"], site_tz) if row["start_time"] else None,
            "end_time": utc_to_local(row["end_time"], site_tz) if row["end_time"] else None,
            "created_at": utc_to_local(row["created_at"], site_tz) if row["created_at"] else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("get_run error for run %s: %s", run_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


def _get_run_hu(run_id: int) -> dict:
    run = _get_hu_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Optimization run not found")

    return {
        "run_id": run_id,
        "site_id": run["site_id"],
        "status": run["status"],
        "error_message": run.get("error_message"),
        "start_time": run.get("start_time", "").isoformat() if run.get("start_time") else None,
        "end_time": run.get("end_time", "").isoformat() if run.get("end_time") else None,
        "created_at": run.get("created_at", "").isoformat() if run.get("created_at") else None,
    }

@router.get("/runs/{run_id}/data")
def get_run_data(run_id: int, db: Session = Depends(get_db)):
    # Negative run_id → HU in-memory store
    if run_id < 0:
        run = _get_hu_run(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Optimization run not found")
        return {
            "run_id": run_id,
            "count": len(run.get("data", [])),
            "data": run.get("data", []),
        }

    try:
        # Get run with site_id for timezone conversion
        run = db.execute(
            text("SELECT id, site_id FROM optimization_runs WHERE id = :run_id"),
            {"run_id": run_id},
        ).mappings().first()

        if not run:
            raise HTTPException(status_code=404, detail="Optimization run not found")

        # Get site timezone
        site = db.query(Site).filter(Site.id == run["site_id"]).first()
        if not site:
            raise HTTPException(status_code=404, detail="Site not found")

        site_tz = get_site_timezone(site.latitude, site.longitude)

        rows = db.execute(
            text("""
                SELECT
                    timestamp,
                    tin,
                    rh,
                    hvac_mode,
                    comfort_index
                FROM optimization_data
                WHERE run_id = :run_id
                ORDER BY timestamp
            """),
            {"run_id": run_id},
        ).mappings().all()

        # Convert timestamps to site's local timezone
        data_with_local_tz = [
            {
                "timestamp": utc_to_local(row["timestamp"], site_tz),
                "tin": row["tin"],
                "rh": row["rh"],
                "hvac_mode": row["hvac_mode"],
                "comfort_index": row["comfort_index"],
            }
            for row in rows
        ]

        return {
            "run_id": run_id,
            "count": len(rows),
            "data": data_with_local_tz,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("get_run_data error for run %s: %s", run_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/{site_id}/runs/{run_id}/cancel")
def cancel_optimization_run(
    site_id: int,
    run_id: int,
    pilot: str = Query("gr"),
    db: Session = Depends(get_db),
):
    config = get_pilot(pilot)

    if is_virtual_site(site_id):
        return _cancel_run_hu(site_id, run_id)

    if config.data_source == "api":
        return _cancel_run_hu(site_id, run_id)

    return _cancel_run_gr(site_id, run_id, db)


def _cancel_run_hu(site_id: int, run_id: int) -> dict:
    run = _get_hu_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Optimization run not found")

    if run.get("site_id") != site_id:
        raise HTTPException(status_code=404, detail="Run does not belong to this site")

    status = run.get("status")
    if status in ("succeeded", "failed", "cancelled"):
        raise HTTPException(
            status_code=409,
            detail=f"Run already finished with status '{status}'",
        )

    _store_hu_run(run_id, {**run, "status": "cancelled", "error_message": "Cancelled by user"})
    logger.info("HU optimization run %s cancelled for site %s", run_id, site_id)

    return {"run_id": run_id, "site_id": site_id, "status": "cancelled"}


def _cancel_run_gr(site_id: int, run_id: int, db: Session) -> dict:
    try:
        run = db.get(OptimizationRun, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Optimization run not found")

        if run.site_id != site_id:
            raise HTTPException(status_code=404, detail="Run does not belong to this site")

        if run.status in ("succeeded", "failed", "cancelled"):
            raise HTTPException(
                status_code=409,
                detail=f"Run already finished with status '{run.status}'",
            )

        if run.status == "queued":
            run.status = "cancelled"
            run.error_message = "Cancelled by user"
            db.commit()
            logger.info("Optimization run %s cancelled (was queued) for site %s", run_id, site_id)
            return {"run_id": run_id, "site_id": site_id, "status": "cancelled"}

        _mark_cancelled(run_id)
        run.status = "cancelled"
        run.error_message = "Cancelled by user"
        db.commit()
        logger.info("Optimization run %s cancel signal sent for site %s", run_id, site_id)

        return {"run_id": run_id, "site_id": site_id, "status": "cancelled"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("cancel_optimization_run error for run %s: %s", run_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


#get a recent successful optimization run for a site (useful for caching data)
@router.get("/{site_id}/latest")
def get_latest_valid_run(
    site_id: int,
    pilot: str = Query("gr"),
    db: Session = Depends(get_db),
):
    config = get_pilot(pilot)

    if is_virtual_site(site_id):
        return _latest_run_hu(site_id)

    if config.data_source == "api":
        return _latest_run_hu(site_id)

    try:
        row = db.execute(
            text("""
                SELECT
                    id,
                    site_id,
                    status,
                    created_at,
                    start_time,
                    end_time
                FROM optimization_runs
                WHERE site_id = :site_id
                  AND status = 'succeeded'
                  AND created_at >= NOW() - INTERVAL '6 hours'
                ORDER BY created_at DESC
                LIMIT 1
            """),
            {"site_id": site_id},
        ).mappings().first()

        if row is None:
            return {
                "has_recent": False,
                "run_id": None,
            }

        # Get site timezone for timestamp conversion
        site = db.query(Site).filter(Site.id == site_id).first()
        if not site:
            raise HTTPException(status_code=404, detail="Site not found")

        site_tz = get_site_timezone(site.latitude, site.longitude)

        return {
            "has_recent": True,
            "run_id": row["id"],
            "created_at": utc_to_local(row["created_at"], site_tz) if row["created_at"] else None,
            "start_time": utc_to_local(row["start_time"], site_tz) if row["start_time"] else None,
            "end_time": utc_to_local(row["end_time"], site_tz) if row["end_time"] else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("get_latest_valid_run error for site %s: %s", site_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


def _latest_run_hu(site_id: int) -> dict:
    """Find most recent succeeded HU run for this site (last 6 hours)."""
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=6)
    best = None

    with _hu_runs_lock:
        for rid, r in _hu_runs.items():
            if (r.get("site_id") == site_id
                    and r.get("status") == "succeeded"
                    and r.get("created_at") and r["created_at"] >= cutoff):
                if best is None or r["created_at"] > best["created_at"]:
                    best = {**r, "run_id": rid}

    if best is None:
        return {"has_recent": False, "run_id": None}

    return {
        "has_recent": True,
        "run_id": best["run_id"],
        "created_at": best["created_at"].isoformat() if best.get("created_at") else None,
        "start_time": best["start_time"].isoformat() if best.get("start_time") else None,
        "end_time": best["end_time"].isoformat() if best.get("end_time") else None,
    }

class ForecastRequest(BaseModel):
    start_time: datetime
    hvac_mode_48: Optional[List[int]] = None

@router.post("/{site_id}/forecast")
def forecast_with_schedule(
    site_id: int,
    req: ForecastRequest,
    pilot: str = Query("gr"),
    db: Session = Depends(get_db),
):
    config = get_pilot(pilot)

    if is_virtual_site(site_id):
        return _forecast_virtual(site_id, req, config)

    if config.data_source == "api":
        from zoneinfo import ZoneInfo

        budapest = ZoneInfo(config.timezone)
        device = "cuda" if torch.cuda.is_available() else "cpu"

        start_time = pd.Timestamp(req.start_time).replace(tzinfo=None)
        end_time = start_time + timedelta(hours=24)

        if req.hvac_mode_48 is not None:
            hvac_mode_48 = np.asarray(req.hvac_mode_48, dtype=int)
            if len(hvac_mode_48) != 48:
                raise HTTPException(400, "hvac_mode_48 must have exactly 48 values")
        else:
            hvac_mode_48 = np.zeros(48, dtype=int)

        site_info = config.sites.get(site_id)
        if not site_info:
            raise HTTPException(404, f"Site {site_id} not found in {config.code} pilot")

        # --- 1) Build history_df for ML warmup ---
        # Prefer the disagg cache (populated by a recent optimization run)
        warmup_steps = LSTM_MAX_WINDOW_STEPS + WARMUP_BUFFER_STEPS
        cached = disagg_cache_get(config.code, site_id)
        if cached is not None and len(cached.balance_df) >= LSTM_MAX_WINDOW_STEPS:
            history_df = cached.balance_df.copy()
            history_df["hvac_mode"] = cached.hvac_mode
            if len(history_df) > warmup_steps:
                history_df = history_df.tail(warmup_steps)
        else:
            # Fall back: fetch last 2 days of sensor data
            now_utc = datetime.now(timezone.utc)
            measured = fetch_sensor_range(
                sensor_id=site_info.sensor_uuid,
                start_month=(now_utc - timedelta(days=2)).strftime("%Y-%m"),
                end_month=now_utc.strftime("%Y-%m"),
            )
            if measured.empty or len(measured) < LSTM_MAX_WINDOW_STEPS:
                raise HTTPException(422, "Insufficient sensor history for ML rollout")
            if measured.index.tz is None:
                measured.index = measured.index.tz_localize("UTC")

            w_start = measured.index.min().strftime("%Y-%m-%d")
            w_end = (now_utc + timedelta(days=2)).strftime("%Y-%m-%d")
            weather_h = fetch_weather(w_start, w_end, config.latitude, config.longitude)
            weather_30_h = upsample_weather_30min(weather_h)

            balance_h, _ = process_sensor(site_id, measured, compute_production_shape(weather_30_h), weather_30_h)
            balance_h = format_balance_local(balance_h)
            balance_h = balance_h.rename(columns={"energy_consumption": "consumption_kwh"})

            disagg_h = run_hvac_disaggregation(
                balance_h, load_col="consumption_kwh", temp_col="tout",
                neutral_band=site_info.neutral_band or (35, 70),
                is_residential=site_info.is_residential,
                active_ratio=site_info.active_ratio or 0.05,
                high_ratio=site_info.high_ratio or 0.55,
                min_high_abs=site_info.min_high_abs or 0.1,
                min_act_abs=site_info.min_active_abs or 0.02,
                q=site_info.disagg_q or 0.1,
            )
            balance_h["hvac_mode"] = disagg_h["df_with_hvac"]["hvac_mode"]

            wa = weather_30_h.reindex(balance_h.index)
            balance_h["sw_out"] = wa["ghi"].values if "ghi" in wa.columns else 0.0
            balance_h["rh_out"] = wa["relative_humidity_2m"].values if "relative_humidity_2m" in wa.columns else 50.0
            balance_h[["sw_out", "rh_out", "tin", "rh", "tout"]] = (
                balance_h[["sw_out", "rh_out", "tin", "rh", "tout"]].ffill().bfill()
            )
            balance_h["comfort_index"] = 50.0

            history_df = balance_h.tail(warmup_steps)

        # --- 2) Build future weather + future_df for horizon ---
        w_start = (start_time - timedelta(hours=1)).strftime("%Y-%m-%d")
        w_end = (start_time + timedelta(hours=25)).strftime("%Y-%m-%d")
        weather_f = fetch_weather(w_start, w_end, config.latitude, config.longitude)
        weather_30_f = upsample_weather_30min(weather_f)

        horizon_index = pd.date_range(start=start_time, periods=48, freq="30min")
        if horizon_index.tz is None:
            horizon_index = horizon_index.tz_localize("UTC")

        future_weather = weather_30_f.reindex(horizon_index).ffill().bfill()

        future_df = pd.DataFrame(index=horizon_index)
        future_df["tout"] = future_weather["temperature_2m"].values
        future_df["sw_out"] = future_weather["ghi"].values if "ghi" in future_weather.columns else 0.0
        future_df["rh_out"] = future_weather["relative_humidity_2m"].values if "relative_humidity_2m" in future_weather.columns else 50.0
        future_df["tin"] = np.nan
        future_df["rh"] = np.nan
        future_df["comfort_index"] = np.nan
        future_df["hvac_mode"] = hvac_mode_48
        future_df["ah_out"] = AH_gm3_from_T_RH(future_df["tout"], future_df["rh_out"])

        # --- 3) Build full timeline ---
        if history_df.index.tz is None:
            history_df.index = history_df.index.tz_localize("UTC")

        full_timeline = pd.concat([history_df, future_df], axis=0)
        for col in ["sw_out", "tout", "rh_out"]:
            if col in full_timeline.columns:
                full_timeline[col] = full_timeline[col].ffill().bfill()
        full_timeline = build_features(full_timeline, pilot=config)
        full_timeline = full_timeline[~full_timeline.index.duplicated(keep="last")]

        start_ts = pd.Timestamp(start_time, tz="UTC")
        if start_ts not in full_timeline.index:
            start_ts = full_timeline.index[full_timeline.index.searchsorted(start_ts)]
        start_idx = full_timeline.index.get_loc(start_ts)

        if start_idx + 48 > len(full_timeline):
            raise HTTPException(500, "Insufficient data for ML rollout horizon")

        # --- 4) ML rollout ---
        try:
            minio_site = f"df_{site_id}"
            regime = config.thermal_regime(start_time.month)

            Tin, RH = rollout_48_steps_minio(
                df=full_timeline,
                start_idx=start_idx,
                hvac_mode_48=hvac_mode_48,
                country=config.code,
                site=minio_site,
                regime=regime,
                device=device,
            )

            season_48 = np.array(
                [1 if ts.month in (11, 12, 1, 2, 3, 4) else 0 for ts in horizon_index],
                dtype=int,
            )
            comfort = compute_comfort_percent(Tin, RH, season_48)

            response = []
            for i, ts in enumerate(horizon_index):
                local_ts = ts.to_pydatetime().astimezone(budapest).replace(tzinfo=None)
                response.append({
                    "timestamp": local_ts.isoformat(),
                    "tin_pred": round(float(Tin[i]), 2),
                    "rh_pred": round(float(RH[i]), 2),
                    "hvac_mode": int(hvac_mode_48[i]),
                    "comfort_index": round(float(comfort[i]), 1),
                })

            return {"site_id": site_id, "forecast": response}

        except Exception as e:
            logger.error("HU forecast_with_schedule error site=%s: %s", site_id, e, exc_info=True)
            raise HTTPException(500, f"ML rollout failed: {e}")

    # Get site for timezone conversion
    site = db.query(Site).filter(Site.id == site_id).first()
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    site_tz = get_site_timezone(site.latitude, site.longitude)

    device = "cuda" if torch.cuda.is_available() else "cpu"

    start_time = pd.Timestamp(req.start_time)
    if start_time.tzinfo is not None:
        start_time = start_time.tz_convert("UTC").tz_localize(None)
    else:
        start_time = start_time.replace(tzinfo=None)

    if req.hvac_mode_48 is not None:
        hvac_mode_48 = np.asarray(req.hvac_mode_48, dtype=int)
        if hvac_mode_48.shape != (48,):
            raise HTTPException(400, "hvac_mode_48 must have exactly 48 values")
    else:
        # Fall back to yesterday's hvac_mode pattern (same approach as consumption forecast)
        prev_start = start_time - timedelta(days=1)
        prev_end = start_time - timedelta(minutes=30)
        rows = db.execute(
            text("""
                SELECT hvac_mode FROM comfort_data
                WHERE site_id = :site_id
                  AND timestamp >= :prev_start
                  AND timestamp <= :prev_end
                ORDER BY timestamp ASC
                LIMIT 48
            """),
            {"site_id": site_id, "prev_start": prev_start, "prev_end": prev_end},
        ).fetchall()
        if len(rows) < 48:
            hvac_mode_48 = np.zeros(48, dtype=int)
        else:
            hvac_mode_48 = np.array(
                [r[0] if r[0] is not None else 0 for r in rows[:48]], dtype=int
            )

    # ---------------------------------------------------
    # 1) Define horizon
    # ---------------------------------------------------
    end_time = start_time + timedelta(hours=24)

    horizon_index = pd.date_range(
        start=start_time,
        end=end_time,
        freq="30min",
        inclusive="left",
    )

    if len(horizon_index) != 48:
        raise HTTPException(500, "Horizon misaligned")

    # ---------------------------------------------------
    # 2) Load history window (same as optimization)
    # ---------------------------------------------------
    warmup_steps = LSTM_MAX_WINDOW_STEPS + WARMUP_BUFFER_STEPS
    history_start = start_time - timedelta(minutes=RES_MIN * warmup_steps)

    history_rows = db.execute(
        text(
            """
            SELECT
                cd.timestamp,
                cd.tin      AS tin,
                cd.rh       AS rh,
                cd.comfort_index AS comfort_index,
                cd.hvac_mode AS hvac_mode,
                e.tout      AS tout,
                e.sw_out    AS sw_out,
                e.rh_out    AS rh_out
            FROM comfort_data cd
            LEFT JOIN environmental_data e
              ON e.site_id = cd.site_id
             AND e.timestamp = cd.timestamp
            WHERE cd.site_id = :site_id
              AND cd.timestamp >= :history_start
              AND cd.timestamp < :start_time
            ORDER BY cd.timestamp
            """
        ),
        {"site_id": site_id, "history_start": history_start, "start_time": start_time},
    ).mappings().all()

    history_df = pd.DataFrame(history_rows)
    if history_df.empty:
        raise HTTPException(400, "No historical data available")

    history_df["timestamp"] = pd.to_datetime(history_df["timestamp"])
    history_df = history_df.set_index("timestamp")

    if len(history_df) < LSTM_MAX_WINDOW_STEPS:
        raise HTTPException(400, "Insufficient history for forecasting")

    # ---------------------------------------------------
    # 3) Load weather forecast 
    # ---------------------------------------------------
    site_row = db.execute(
        text("SELECT latitude, longitude FROM sites WHERE id = :site_id"),
        {"site_id": site_id},
    ).fetchone()

    if site_row is None:
        raise HTTPException(404, "Site not found")

    weather_hourly = fetch_environmental_data(
        latitude=site_row.latitude,
        longitude=site_row.longitude,
        start_ts=start_time - timedelta(hours=1),
        end_ts=end_time + timedelta(hours=1),
        source="forecast",
    )

    if not weather_hourly:
        raise HTTPException(500, "No weather data returned")

    hourly_ts = sorted(weather_hourly.keys())

    hourly_series = {
        "tout": {ts: weather_hourly[ts]["tout"] for ts in hourly_ts},
        "rh_out": {ts: weather_hourly[ts]["rh_out"] for ts in hourly_ts},
        "sw_out": {ts: weather_hourly[ts]["sw_out"] for ts in hourly_ts},
    }
 
    records = []
    for ts in horizon_index:
        records.append(
            {
                "timestamp": ts,
                "tout": interpolate_value(target_ts=ts, known_ts=hourly_ts, values=hourly_series["tout"]),
                "rh_out": interpolate_value(target_ts=ts, known_ts=hourly_ts, values=hourly_series["rh_out"]),
                "sw_out": interpolate_value(target_ts=ts, known_ts=hourly_ts, values=hourly_series["sw_out"]),
            }
        )

    weather_30min = pd.DataFrame(records).set_index("timestamp")

    if weather_30min.isna().any().any():
        raise HTTPException(500, "Weather interpolation failed")

    # ---------------------------------------------------
    # 4) Build future DF (same as optimization)
    # ---------------------------------------------------
    future_df = weather_30min.copy()
    future_df["tin"] = np.nan
    future_df["rh"] = np.nan
    future_df["comfort_index"] = np.nan
    future_df["hvac_mode"] = hvac_mode_48
    future_df["ah_out"] = AH_gm3_from_T_RH(future_df["tout"], future_df["rh_out"])

    # ---------------------------------------------------
    # 5) Build full timeline + features
    # ---------------------------------------------------
    full_timeline = pd.concat([history_df, future_df], axis=0)
    # Fill exogenous columns before build_features so SW1h/SW3h rolling
    # doesn't inherit NaN from recent history rows missing environmental data
    for _col in ["tin", "rh", "sw_out", "tout", "rh_out", "hvac_mode"]:
        if _col in full_timeline.columns:
            full_timeline[_col] = full_timeline[_col].ffill().bfill()
    full_timeline = build_features(full_timeline, pilot=config)

    if start_time not in full_timeline.index:
        start_time = full_timeline.index[full_timeline.index.searchsorted(start_time)]

    start_idx = full_timeline.index.get_loc(start_time)

    if start_idx + 48 > len(full_timeline):
        raise HTTPException(500, "Invalid start index")

    # ---------------------------------------------------
    # 6) Run forecast (your existing engine)
    # ---------------------------------------------------
    try:
        gr_site_info = next((si for si in config.sites.values() if si.name == site.name), None)
        minio_site = gr_site_info.minio_key if gr_site_info and gr_site_info.minio_key else f"df_{site_id}"
        regime = config.thermal_regime(start_time.month)

        tin_pred, rh_pred = rollout_48_steps_minio(
            df=full_timeline,
            start_idx=start_idx,
            hvac_mode_48=hvac_mode_48,
            country=config.code,
            site=minio_site,
            regime=regime,
            device=device,
        )
        season_48 = np.array(
            [1 if ts.month in (11, 12, 1, 2, 3, 4) else 0 for ts in horizon_index],
            dtype=int,
        )

        out_df = pd.DataFrame(index=horizon_index)

        out_df["hvac_mode"] = hvac_mode_48.astype(int)
        out_df["tin"] = tin_pred.astype(float)
        out_df["rh"] = rh_pred.astype(float)
        out_df["comfort_index"] = compute_comfort_percent(
            tin_pred,
            rh_pred,
            season_48,
        )

        # ---------------------------------------------------
        # 7) Response (convert timestamps to site's local timezone)
        # ---------------------------------------------------
        response = [
            {
                "timestamp": utc_to_local(horizon_index[i].to_pydatetime(), site_tz).isoformat(),
                "tin_pred": float(tin_pred[i]),
                "rh_pred": float(rh_pred[i]),
                "hvac_mode": int(hvac_mode_48[i]),
                'comfort_index': float(out_df['comfort_index'].iloc[i])
            }
            for i in range(48)
        ]

        return {"site_id": site_id, "forecast": response}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("forecast_with_schedule error for site %s: %s", site_id, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
