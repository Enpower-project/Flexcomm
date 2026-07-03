# SCOT Backend

Self-Consumption Optimization Tool (SCOT) Backend — a FastAPI-based energy management system for tracking, forecasting, and optimizing HVAC operation across PV-equipped sites.

## Overview

SCOT Backend is a multi-pilot energy data platform that integrates with external sensor APIs, performs automated data collection, generates consumption/production forecasts, and runs HVAC optimization schedules to maximize self-consumption of local PV generation.

Two pilots are currently active:

| Pilot | Location | Data source |
|-------|----------|-------------|
| `gr`  | Chalki Island, Greece | Database (collected from external API via cronjobs) |
| `hu`  | Békéscsaba, Hungary   | Live sensor API (fetched on demand) |

### Key Features

- **Real-time Data Collection**: Automated collection of PV production and consumption data from external APIs
- **Forecasting**: Day-ahead PV production and consumption forecasts
- **HVAC Optimization**: Schedule optimization using RC thermal models and MILP (Pyomo/GLPK), targeting self-consumption while respecting comfort constraints
- **HVAC Disaggregation**: Separates HVAC load from whole-building consumption using calibrated signal processing
- **REST API**: Endpoints for history, forecasts, optimization runs, comfort preferences, and site metadata
- **Timezone Support**: Proper UTC↔local conversion for each pilot's timezone
- **MLflow Integration**: Experiment tracking and model registry for ML pipelines
- **MinIO Storage**: S3-compatible artifact store for trained models and data exports

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  FastAPI application  (fast_api/apisrc/service.py)   │
│                                                       │
│  Routers: weather · history · forecast · comfort      │
│           metadata · optimization                     │
└───────────┬──────────────────┬────────────────────────┘
            │                  │
    ┌───────▼──────┐   ┌───────▼──────────┐
    │  PostgreSQL  │   │  MinIO + MLflow  │
    │  (time-series│   │  (model storage  │
    │   energy DB) │   │   & tracking)    │
    └──────────────┘   └──────────────────┘
```

Cronjobs run independently to collect real-time data and generate forecasts; the API serves pre-computed results from the database.

## Quick Start

### Prerequisites

- Python 3.12+
- PostgreSQL 15+
- Docker & Docker Compose (for MLflow/MinIO stack)
- GLPK solver (`brew install glpk` / `apt install glpk-utils`) — required for optimization

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd scot-backend
   ```

2. **Set up environment variables**
   ```bash
   cp fast_api/.env.example fast_api/.env
   ```
   Edit `fast_api/.env` and fill in your database URL, API keys, and sensor UUIDs.

3. **Install Python dependencies**
   ```bash
   cd fast_api
   pip install -r requirements.txt
   ```

4. **Start the MLflow + MinIO stack**
   ```bash
   cd mlflow-minio
   # Copy and configure the .env for docker-compose
   cp ../fast_api/.env.example .env
   docker-compose up -d
   ```

5. **Run database migrations**

   Create the required tables using the SQLAlchemy models in [fast_api/apisrc/core/models.py](fast_api/apisrc/core/models.py).

6. **Start the FastAPI server**
   ```bash
   cd fast_api/apisrc
   uvicorn service:app --host 0.0.0.0 --port 8000 --reload
   ```

The API will be available at `http://localhost:8000`. Visit `http://localhost:8000/docs` for interactive API documentation.

## API Endpoints

All routes accept an optional `?pilot=gr` (default) or `?pilot=hu` query parameter where relevant.

### History

- `GET /history/{site_id}/timeseries` — Energy time-series (consumption, PV, net load)
- `GET /history/{site_id}/timeseries/last-24h` — Last 24 hours of data
- `GET /history/{site_id}/metrics/latest` — Latest aggregated metrics

### Forecast

- `GET /forecast/{site_id}/timeseries/consumption` — Forecasted consumption time-series

### Optimization

- `POST /optimize/{site_id}/run` — Trigger an HVAC optimization run (returns immediately, executes in background)
- `GET /optimize/runs/{run_id}` — Poll run status and results
- `GET /optimize/runs/{run_id}/data` — Fetch detailed optimization output data
- `POST /optimize/{site_id}/runs/{run_id}/cancel` — Cancel a running optimization
- `GET /optimize/{site_id}/latest` — Fetch the most recent completed run for a site
- `POST /optimize/{site_id}/forecast` — Generate a PV production forecast used by the optimizer
- `POST /optimize/{site_id}/disaggregation` — Trigger HVAC load disaggregation

### Comfort

- `POST /comfort/{site_id}/update_comfort` — Update comfort preferences (temperature bounds, schedule)

### Metadata

- `GET /metadata/get_id` — Resolve a site name to its ID
- `GET /metadata/get_all_buildings` — List all sites for a pilot

### Weather

- `GET /weather/current` — Current weather metrics for a pilot location

## Data Collection

### Automated Cronjobs

**Real-time data collection** (run every 15–30 minutes):
```bash
python fast_api/apisrc/real_import_cronjob.py
```

**Historical data backfill**:
```bash
python fast_api/apisrc/real_import_cronjob_days.py
```

**Daily forecast generation**:
```bash
python fast_api/apisrc/forecast_import_cronjob.py
```

**Dataspace export** (ENPOWER dataspace integration):
```bash
python fast_api/apisrc/dataspace_cronjob.py
```

### Cron Configuration Example

```cron
# Real-time data collection every 15 minutes
*/15 * * * * cd /path/to/scot-backend/fast_api/apisrc && /path/to/python real_import_cronjob.py >> /var/log/scot-realtime.log 2>&1

# Daily forecast generation at 6 AM
0 6 * * * cd /path/to/scot-backend/fast_api/apisrc && /path/to/python forecast_import_cronjob.py >> /var/log/scot-forecast.log 2>&1
```

## Database Schema

### Core Tables

- **sites**: Site definitions (PV installations, consumption points)
- **production_data**: Historical PV production data (kWh, 15-min intervals)
- **consumption_data**: Historical consumption data (kWh, 15-min intervals)
- **forecasted_production_data**: PV production forecasts
- **forecasted_consumption_data**: Consumption forecasts
- **optimization_runs**: HVAC optimization run records and results
- **optimization_data**: Per-timestep optimization output (schedule, temperatures, etc.)

All timestamps are stored in UTC. Time-series tables use composite primary keys `(site_id, timestamp)`.

## Configuration

### Environment Variables

All variables live in `fast_api/.env`. See [fast_api/.env.example](fast_api/.env.example) for the full annotated template. Key groups:

| Group | Variables |
|-------|-----------|
| Application DB | `DATABASE_URL` |
| GR pilot API | `API_KEY` |
| GR sensor UUIDs | `Dimarxeio_sunedriaston_tin/rh`, `Cafeteria_tin/rh`, `*_consumption`, … |
| HU sensor UUIDs | `sensor_id_1` … `sensor_id_9`, `sensor_id_weather` |
| MinIO | `HOST_URL`, `MINIO_PORT`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `BUCKET_NAME` |
| MLflow | `MLFLOW_TRACKING_URI`, `MLFLOW_S3_ENDPOINT_URL`, `MLFLOW_EXPERIMENT_NAME` |
| MLflow AWS shim | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| MLflow stack DB | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` |
| App stack DB | `ENPOWER_HOST`, `ENPOWER_USER`, `ENPOWER_PASS`, `ENPOWER_DB` |
| Dev flags | `RESET_DB_ON_STARTUP`, `CREATE_PARQUETS_ON_STARTUP` |

### Pilot Configuration

Pilots are defined in [fast_api/apisrc/core/pilot_config.py](fast_api/apisrc/core/pilot_config.py). Each pilot specifies its timezone, coordinates, data source strategy, and per-site parameters (PV capacity, AC capacity, HVAC disaggregation calibration). Sensor UUIDs for the HU pilot are resolved from the `.env` at startup.

## Project Structure

```
scot-backend/
├── fast_api/
│   ├── .env.example                # Environment variable template
│   ├── apisrc/
│   │   ├── service.py              # FastAPI app and router registration
│   │   ├── core/
│   │   │   ├── database.py         # SQLAlchemy session management
│   │   │   ├── models.py           # ORM models
│   │   │   ├── schemas.py          # Pydantic schemas
│   │   │   └── pilot_config.py     # Per-pilot configuration (GR / HU)
│   │   ├── routers/
│   │   │   ├── history.py          # Historical time-series endpoints
│   │   │   ├── forecast.py         # Forecast endpoints
│   │   │   ├── optimization.py     # HVAC optimization & disaggregation
│   │   │   ├── comfort.py          # Comfort preference endpoints
│   │   │   ├── metadata.py         # Site metadata endpoints
│   │   │   └── weather.py          # Weather endpoints
│   │   ├── utils/
│   │   │   ├── optimization_utils.py   # RC thermal model, MILP solver helpers
│   │   │   ├── minio_model_store.py    # MinIO model upload/download
│   │   │   ├── disaggregation_utils.py # HVAC load disaggregation
│   │   │   ├── hungary_utils.py        # HU pilot API client & data processing
│   │   │   ├── weather_utils.py        # Weather data reconciliation
│   │   │   └── timezone_utils.py       # UTC ↔ local conversion helpers
│   │   ├── real_utils.py           # GR pilot real-time data collection
│   │   ├── forecast_utils.py       # Forecast generation logic
│   │   ├── real_import_cronjob.py  # GR real-time collection job
│   │   ├── real_import_cronjob_days.py # GR historical backfill job
│   │   ├── forecast_import_cronjob.py  # Daily forecast job
│   │   └── dataspace_cronjob.py    # ENPOWER dataspace export job
│   └── requirements.txt
├── mlflow-minio/
│   ├── docker-compose.yml          # MLflow, MinIO, and PostgreSQL stack
│   └── .env                        # Stack-specific env (mirrors fast_api/.env)
└── README.md
```

## Logging

- **API**: FastAPI/uvicorn logs to stdout
- **Forecast**: `forecast_system.log` in the working directory
- **Data import**: `data_import.log` in the working directory

All cronjob scripts log to both file and stdout for cron compatibility.

## Docker Deployment

### Building the FastAPI Container

```bash
cd fast_api
docker build -t scot-backend:latest .
```

### Running with Docker Compose

The `mlflow-minio` directory contains a docker-compose setup for the full supporting stack (PostgreSQL, MLflow, MinIO). The FastAPI container can join the `enpower` Docker network to communicate with these services using their container hostnames.

## Contributing

1. Code follows existing patterns and conventions
2. All database operations use proper timezone handling (store UTC, display local)
3. API endpoints include proper error handling and validation
4. Cronjob scripts exit with appropriate status codes

## License

MIT — see the LICENSE file for details.

## Acknowledgments

This project is part of the [ENPOWER](https://enpower-project.eu) EU initiative for energy flexibility and self-consumption optimization.
