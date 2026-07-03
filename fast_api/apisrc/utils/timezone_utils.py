from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from functools import lru_cache
from typing import Optional
from timezonefinder import TimezoneFinder
from core.models import Site

# Global TimezoneFinder instance (thread-safe)
_tf = TimezoneFinder()


@lru_cache(maxsize=128)
def get_site_timezone(latitude: float, longitude: float) -> ZoneInfo:
    """Get timezone for a site based on its coordinates.
    """
    if not (-90 <= latitude <= 90):
        raise ValueError(f"Invalid latitude: {latitude}. Must be between -90 and 90.")
    if not (-180 <= longitude <= 180):
        raise ValueError(f"Invalid longitude: {longitude}. Must be between -180 and 180.")

    tz_name = _tf.timezone_at(lat=latitude, lng=longitude)

    if tz_name is None:
        raise ValueError(
            f"Could not determine timezone for coordinates ({latitude}, {longitude}). "
            "Coordinates may be in ocean or invalid location."
        )

    return ZoneInfo(tz_name)


def get_site_timezone_from_db(site_id: int, session) -> ZoneInfo:
    """Fetch site from database and get its timezone.
    """

    site = session.query(Site).filter(Site.id == site_id).first()

    if site is None:
        raise ValueError(f"Site with id {site_id} not found in database")

    return get_site_timezone(site.latitude, site.longitude)


def utc_to_local(dt: datetime, site_tz: ZoneInfo) -> datetime:
    """Convert UTC datetime to site's local timezone.
    """
    # If naive, assume it's UTC (as all DB timestamps are)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    # If already aware but not UTC, convert to UTC first
    elif dt.tzinfo != timezone.utc:
        dt = dt.astimezone(timezone.utc)

    # Convert to target timezone
    return dt.astimezone(site_tz)


def local_to_utc(dt: datetime, site_tz: ZoneInfo) -> datetime:
    """Convert site's local datetime to UTC (timezone-naive for DB storage).

    """
    # If naive, assume it's in the site's local timezone
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=site_tz)

    # If already aware but not in site_tz, convert to site_tz first
    elif dt.tzinfo != site_tz:
        dt = dt.astimezone(site_tz)

    # Convert to UTC and strip timezone for DB storage
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def format_timestamp_with_tz(dt: datetime, tz: ZoneInfo) -> str:
    """Format datetime with timezone offset for API responses.
    """
    dt_local = utc_to_local(dt, tz)
    return dt_local.isoformat()


def ensure_utc_naive(dt: datetime) -> datetime:
    """Ensure datetime is timezone-naive UTC for database storage.
    """
    if dt.tzinfo is None:
        return dt  # Already naive, assume UTC

    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def make_utc_aware(dt: datetime) -> datetime:
    """Convert naive datetime to UTC-aware datetime.
    """
    if dt.tzinfo is not None:
        return dt  # Already aware

    return dt.replace(tzinfo=timezone.utc)


# Convenience function for API responses
def convert_timestamps_to_local(timestamps: list, site_tz: ZoneInfo) -> list:
    """Convert a list of UTC timestamps to local timezone.
    """
    return [utc_to_local(ts, site_tz) for ts in timestamps]
