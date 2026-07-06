# FLEXCOMM

**A platform for self-consumption optimization in energy communities through aggregated forecasting and comfort-aware HVAC scheduling.**

FLEXCOMM is a web platform that helps energy communities consume more of their own photovoltaic (PV) production. It combines two complementary services in a single tool:

- **Community-level service** (public) — aggregates community-wide consumption and PV park production into 24-hour measured and forecast curves, computes self-consumption KPIs (self-consumption rate, self-sufficiency rate, wasted energy, avoided CO₂ emissions), and translates windows of surplus PV generation into natural-language load-shifting suggestions.
- **Member-level HVAC service** (authenticated) — runs a non-intrusive, predict-then-optimize pipeline on an individual household's aggregated smart-meter signal: unsupervised HVAC disaggregation, indoor temperature/humidity forecasting (TCN, LightGBM, CNN–LSTM), and a MILP scheduler (Pyomo/HiGHS) that produces a 24-hour, PV-aligned heating/cooling schedule under PMV/PPD thermal-comfort constraints. No appliance-level sub-metering is required — only a standard smart meter and one low-cost indoor temperature/humidity sensor.

FLEXCOMM is developed within the [Horizon Europe ENPOWER project](https://enpower-project.eu) and is deployed on Chalki island, Greece (`gr` pilot), with the member-level service replicated in the BCS Energia community in Békéscsaba, Hungary (`hu` pilot).

## Repository Layout

```
Flexcomm/
├── run.sh               # One-command local setup + launch (no Docker)
├── docker-compose.yml   # Containerized setup (backend + frontend)
├── fast_api/            # Backend: FastAPI + ML/optimization pipelines
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .env.example     # Backend environment template
│   └── apisrc/
│       ├── service.py           # FastAPI app and router registration
│       ├── core/                # DB session, ORM models, schemas, pilot config
│       ├── routers/             # history, forecast, optimization, comfort,
│       │                        #   metadata, weather endpoints
│       └── utils/               # disaggregation, MILP optimization, MinIO
│                                #   model store, weather & timezone helpers
└── frontend/            # React (Create React App) user interface
    ├── Dockerfile
    ├── .env.example     # Frontend environment template (Keycloak, API URL)
    ├── public/data/     # Bundled demo time-series (CSV/JSON)
    └── src/
        ├── pages/       # Homepage, CommunityDashboard,
        │                #   SelfConsumptionOptimization (member-level)
        └── services/    # API client + demo-mode data layer
```

## Quick Start

You can run FLEXCOMM either **locally with `run.sh`** or **with Docker Compose**. Both start the backend on `http://localhost:8000` (interactive API docs at `/docs`) and the frontend on `http://localhost:3000`.

The public community dashboard and the bundled demo data work out of the box with the placeholder values from the `.env` templates — no database or external services are needed for a demo run.

### Prerequisites

| Option | Requirements |
|---|---|
| `run.sh` (local) | **Python 3.12** (see note below), Node.js 20+ with `npm` |
| Docker | Docker with the Compose plugin |

> **Python version note:** the backend requires **Python 3.12** (the repository pins `3.12.9` in `.python-version`; the Docker image uses `python:3.12.3-slim`). Newer interpreters such as Python 3.14 are **not** currently supported because several pinned scientific dependencies do not build against them. If you use `pyenv`, the correct version is selected automatically.

### Option A — one-command local run

```bash
git clone https://github.com/Enpower-project/Flexcomm.git
cd Flexcomm
./run.sh
```

The script creates a virtualenv, installs backend and frontend dependencies, copies both `.env.example` templates to `.env` if missing, and then starts the FastAPI backend (`:8000`) and the React frontend (`:3000`). Use `./run.sh --setup` to prepare everything without starting the servers. Stop both servers with `Ctrl-C`.

### Option B — Docker Compose

```bash
git clone https://github.com/Enpower-project/Flexcomm.git
cd Flexcomm
cp fast_api/.env.example fast_api/.env
cp frontend/.env.example frontend/.env
docker compose up --build
```

### What you can explore

| URL | View | Login required |
|---|---|---|
| `http://localhost:3000/` | Homepage | No |
| `http://localhost:3000/dashboard` | Community-level dashboard (24-h curves, KPIs, load-shifting suggestions) | No |
| `http://localhost:3000/self-consumption-optimization` | Member-level HVAC scheduling dashboard | Yes (Keycloak) |
| `http://localhost:8000/docs` | Interactive REST API documentation (Swagger UI) | No |

To use the authenticated member-level view locally, fill in the `REACT_APP_KEYCLOAK_*` values in `frontend/.env` (see [Configuration](#configuration)).

## Demonstration Access

FLEXCOMM ingests data through automated API connections to the pilot-site infrastructure (smart meters, the PV park, indoor sensors, and weather services) rather than user-supplied datasets, so the **live pilot deployment is the intended entry point for evaluating the software**:

- **Platform:** <!-- TODO: insert live frontend URL -->
- **API documentation:** <https://flexcomm-backend.enpower.epu.ntua.gr/docs>
- **Demo account:** username `demo_pilot`, password `demo`

Logging in as `demo_pilot` activates **demo mode**: the member-level dashboard is served from bundled, anonymized demo data instead of live member data, so the full HVAC-scheduling workflow can be explored without exposing any personal data. The same demo mode works on a local checkout once Keycloak is configured.

## Architecture

```
                       ┌───────────────────────────────┐
   Keycloak (OAuth2) ──►  React frontend (:3000)       │
                       │  Homepage · Community dashboard│
                       │  Member-level HVAC dashboard   │
                       └───────────────┬───────────────┘
                                       │ REST (Axios)
                       ┌───────────────▼───────────────┐
                       │  FastAPI backend (:8000)       │
                       │  Routers: history · forecast   │
                       │   optimization · comfort       │
                       │   metadata · weather           │
                       │                                │
                       │  Pipelines: HVAC disaggregation│
                       │   indoor-environment forecasts │
                       │   MILP scheduling (Pyomo/HiGHS)│
                       └───────┬───────────────┬────────┘
                               │               │
                     ┌─────────▼────┐  ┌───────▼──────────┐
                     │  PostgreSQL  │  │  MinIO + MLflow  │
                     │ (time-series │  │ (model artifacts │
                     │  energy DB)  │  │  & tracking)     │
                     └──────────────┘  └──────────────────┘
```

- **Frontend** — ReactJS with Material UI; charts rendered with Highcharts; asynchronous backend communication via Axios; authentication via Keycloak (OAuth2/JWT).
- **Backend** — FastAPI with SQLAlchemy ORM over PostgreSQL; Pydantic schemas; per-pilot configuration with proper UTC ↔ local timezone handling.
- **ML & optimization** — PyTorch (TCN, CNN–LSTM) and LightGBM forecasters; unsupervised HVAC disaggregation from the aggregated smart-meter signal; MILP scheduling formulated in Pyomo and solved with the open-source [HiGHS](https://highs.dev/) solver (installed automatically via `highspy` — no system solver needed); thermal comfort evaluated with `pythermalcomfort` (PMV/PPD).
- **Model management** — trained forecasters are stored in MinIO and tracked with MLflow, so models are pluggable and can be retrained or swapped without changing the platform (optional; not needed for a demo run).
- **Weather** — external inputs retrieved from [Open-Meteo](https://open-meteo.com).

In the full pilot deployment, data collection jobs run on a schedule to ingest smart-meter, PV-park, and sensor readings into PostgreSQL; the API then serves measured history, forecasts, and on-demand optimization runs.

## REST API Overview

All endpoints are documented interactively at `/docs`. Routes accept an optional `?pilot=gr` (default) or `?pilot=hu` query parameter where relevant.

| Area | Endpoint | Description |
|---|---|---|
| History | `GET /history/{site_id}/timeseries` | Energy time-series (consumption, PV, net load) |
| | `GET /history/{site_id}/timeseries/last-24h` | Last 24 hours of data |
| | `GET /history/{site_id}/metrics/latest` | Latest aggregated metrics |
| Forecast | `GET /forecast/{site_id}/timeseries/consumption` | Day-ahead consumption forecast |
| Optimization | `POST /optimize/{site_id}/run` | Trigger an HVAC optimization run (async, returns `202`) |
| | `GET /optimize/runs/{run_id}` | Poll run status |
| | `GET /optimize/runs/{run_id}/data` | Detailed per-timestep results (schedule, temperatures, comfort) |
| | `POST /optimize/{site_id}/runs/{run_id}/cancel` | Cancel a running optimization |
| | `GET /optimize/{site_id}/latest` | Most recent completed run for a site |
| | `POST /optimize/{site_id}/forecast` | Generate the PV forecast used by the optimizer |
| | `POST /optimize/{site_id}/disaggregation` | Trigger non-intrusive HVAC load disaggregation |
| Comfort | `POST /comfort/{site_id}/update_comfort` | Update comfort preferences (temperature bounds, schedule) |
| Metadata | `GET /metadata/get_id` | Resolve a site name to its ID |
| | `GET /metadata/get_all_buildings` | List all sites for a pilot |
| Weather | `GET /weather/current` | Current weather at the pilot location |
| | `GET /weather/forecast` · `GET /weather/historical` | Weather forecast / historical weather |

## Configuration

### Backend (`fast_api/.env`)

Copy [fast_api/.env.example](fast_api/.env.example) to `fast_api/.env`. The template is fully annotated; the placeholder values are sufficient to start the server and explore the API and demo views. The variables matter only when connecting to real infrastructure:

| Group | Purpose |
|---|---|
| `DATABASE_URL` | Application PostgreSQL database (time-series, sites, optimization runs) |
| `API_KEY`, `SIEMENS_*`, `METEOGEN_*` | External data providers for the `gr` (Chalki) pilot |
| Sensor UUIDs (`*_tin`, `*_rh`, `*_consumption`, `sensor_id_*`) | Per-site indoor sensor and meter identifiers for both pilots |
| `MINIO_*`, `BUCKET_NAME`, `MLFLOW_*`, `AWS_*` | Optional model artifact store and experiment tracking |
| `RESET_DB_ON_STARTUP`, `CREATE_PARQUETS_ON_STARTUP` | Dev-only flags — keep disabled in production |

### Frontend (`frontend/.env`)

Copy [frontend/.env.example](frontend/.env.example) to `frontend/.env`. `REACT_APP_API_BASE_URL` points at the backend (default `http://localhost:8000`). The `REACT_APP_KEYCLOAK_*` values are required only for the authenticated member-level view; the public pages work without them.

### Pilots

Pilot sites are defined in [fast_api/apisrc/core/pilot_config.py](fast_api/apisrc/core/pilot_config.py). Each pilot specifies its timezone, coordinates, data-source strategy, and per-site parameters (PV capacity, HVAC capacity, disaggregation calibration), making it straightforward to add a new site.

| Pilot | Location | Service layers | Data source |
|---|---|---|---|
| `gr` | Chalki Island, Greece | Community + member level | Database (populated from external APIs) |
| `hu` | Békéscsaba, Hungary | Member level | Live sensor API (fetched on demand) |

## Citing FLEXCOMM

If you use FLEXCOMM in your research, please cite:

> E. Sarantinopoulos, V. Michalakopoulos, K. Perifanos, N. Matsagkos, E. Sarmas, V. Marinakis, *FLEXCOMM: A Platform for Self-Consumption Optimization in Energy Communities through Aggregated Forecasting and Comfort-Aware HVAC Scheduling*, SoftwareX (under review).

## Support

Questions and issues: open a [GitHub issue](https://github.com/Enpower-project/Flexcomm/issues) or contact <ssarantinopoulos@epu.ntua.gr>.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

This work is part of the [ENPOWER](https://enpower-project.eu) project, funded by the European Union's Horizon Europe research and innovation programme under Grant Agreement No. 101096354. The content of this repository is the sole responsibility of its authors and does not necessarily reflect the views of the European Commission.

The operational data ingested by the platform (community and household smart-meter time series, PV park production, indoor environmental measurements) are managed by the respective pilot sites under the data-governance provisions of the ENPOWER project and are not publicly available; the bundled demo data and the demonstration account provide interactive access to the platform's functionality without exposing member-level personal data.
