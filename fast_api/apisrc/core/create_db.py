from sqlalchemy import create_engine
from pathlib import Path
import os
import sys

# Add project root to path (same as in models.py)
ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.database import Base
from core.models import (  # adjust import path as needed
    Site, ConsumptionData, ComfortData, EnvironmentalData,
    SiteModel, OptimizationRun, OptimizationData,
    ProductionData, ForecastedConsumptionData, ForecastedProductionData
)

# Database connection (importing core.database above loads the .env)
DATABASE_URL = os.getenv("DATABASE_URL")

def setup_database():
    engine = create_engine(DATABASE_URL)
    Base.metadata.create_all(engine)
    print("Database schema created successfully")

if __name__ == "__main__":
    setup_database()