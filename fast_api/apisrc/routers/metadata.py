from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text
import logging

from core.database import SessionLocal
from core.pilot_config import get_pilot

router = APIRouter(prefix="/metadata", tags=["metadata"])

@router.get("/get_id")
def resolve_dataset(
    building_name: str,
    dataset_name: str,
):
    session = SessionLocal()

    try:
        sql = text("""
        SELECT
            b.building_id,
            d.dataset_id
        FROM building b
        JOIN dataset d
            ON d.building_id = b.building_id
        WHERE b.name = :building_name
          AND d.name = :dataset_name
        """)

        row = (
            session.execute(
                sql,
                {
                    "building_name": building_name,
                    "dataset_name": dataset_name,
                },
            )
            .mappings()
            .first()
        )

        if row is None:
            raise HTTPException(
                status_code=404,
                detail="Building or dataset not found",
            )

        return {
            "building_id": row["building_id"],
            "dataset_id": row["dataset_id"],
        }

    except HTTPException:
        raise
    except Exception as e:
        logging.error("resolve_dataset error for %s/%s: %s", building_name, dataset_name, e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        session.close()

@router.get("/get_all_buildings")
def get_all_buildings(pilot: str = Query("gr", description="Pilot code: 'gr' or 'hu'")):
    try:
        pilot_config = get_pilot(pilot)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown pilot: {pilot}")

    if pilot_config.data_source == "api":
        return [
            {
                "site_id": site_id,
                "site_name": site.name,
                "is_residential": site.is_residential,
                "pv_kwp": site.pv_kwp,
            }
            for site_id, site in pilot_config.sites.items()
        ]

    # GR: existing DB path
    EXCLUDED_SITES = {"pv_park", "mesi_tasi"}
    session = SessionLocal()
    try:
        sql = text("""
        SELECT
            id,
            name
        FROM sites
        """)

        rows = session.execute(sql).mappings().all()

        buildings = {}
        for row in rows:
            b_id = row["id"]

            if b_id not in buildings and row["name"] not in EXCLUDED_SITES:
                buildings[b_id] = {
                    "site_id": b_id,
                    "site_name": row["name"],
                }

        summer_home = pilot_config.sites[-1]
        buildings["Summer_Home"] = {
            "site_id": -1,
            "site_name": summer_home.name,
        }

        return list(buildings.values())

    except HTTPException:
        raise
    except Exception as e:
        logging.error("get_all_buildings error: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        session.close()
