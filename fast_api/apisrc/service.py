# --- Existing imports ---
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Depends, FastAPI, Request
from fastapi.openapi.docs import get_swagger_ui_html, get_swagger_ui_oauth2_redirect_html
from fastapi.responses import HTMLResponse, JSONResponse
from dotenv import load_dotenv
import os
import logging
from contextlib import asynccontextmanager
# from fast_api.apisrc.core.reset_db import reset_database


load_dotenv()

from routers import weather, weather_util, history, optimization, comfort, metadata, forecast
from core.auth import KEYCLOAK_CLIENT_ID, require_user
# --- Import routers ---
# try:
#     from routers import weather, analytics, energy
# except ImportError as e:
#     print(f"ERROR: Failed to import routers - {e}")
#     print("Ensure router files are in the routers/ directory.")
#     raise

# --- FastAPI setup ---
tags_metadata = [
    {"name": "Energy Data",
        "description": "Endpoints for retrieving energy consumption and production data"},
    {"name": "Hello World", "description": "REST API for hello word"},
    {"name": "Analytics",
     "description": "Endpoints for derived calculations like emission reductions"},
    {"name": "Weather",
     "description": "Endpoints for retrieving weather forecast and current data"},
]

app = FastAPI(
    title="FLEXIBILITY TOOL API v2",
    description=(
        "Collection of REST APIs for Serving Execution of Self Consumption Optimization tool for ENPOWER EU\n\n"
        "**To try the endpoints, click the Authorize button and log in with your ENPOWER (Keycloak) account.** "
        "Without logging in, every request returns `401 Unauthorized`."
    ),
    version="0.0.1",
    # /docs is served below so the login dialog can be simplified
    docs_url=None,
    openapi_tags=tags_metadata,
    license_info={
        "name": "MIT",
        "url": "https://opensource.org/licenses/MIT",
    },
    # Swagger's "Authorize" button logs in through Keycloak (auth code + PKCE)
    swagger_ui_init_oauth={
        "clientId": KEYCLOAK_CLIENT_ID,
        "usePkceWithAuthorizationCodeGrant": True,
        "scopes": "openid",
    },
)
#update

# --- Swagger UI ---
# Same page FastAPI serves by default, plus CSS that hides the client_id /
# client_secret fields of the login dialog: they're preset (public client +
# PKCE, no secret) and only confuse people logging in.
_DOCS_CSS = """
<style>
.auth-container :has(> label[for^="client_id"]),
.auth-container :has(> label[for^="client_secret"]) { display: none; }
</style>
"""


@app.get("/docs", include_in_schema=False)
async def swagger_ui_html(request: Request) -> HTMLResponse:
    root_path = request.scope.get("root_path", "").rstrip("/")
    page = get_swagger_ui_html(
        openapi_url=root_path + app.openapi_url,
        title=f"{app.title} - Swagger UI",
        oauth2_redirect_url=root_path + app.swagger_ui_oauth2_redirect_url,
        init_oauth=app.swagger_ui_init_oauth,
    )
    return HTMLResponse(page.body.decode().replace("</head>", _DOCS_CSS + "</head>"))


@app.get(app.swagger_ui_oauth2_redirect_url, include_in_schema=False)
async def swagger_ui_redirect() -> HTMLResponse:
    return get_swagger_ui_oauth2_redirect_html()

# --- CORS setup ---
origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# # --- Include routers ---
# Every API route requires a valid Keycloak token; the docs pages stay public.
auth = [Depends(require_user)]
app.include_router(weather.router, dependencies=auth)
# app.include_router(analytics.router)
# app.include_router(energy.router)
app.include_router(weather_util.router, dependencies=auth)
app.include_router(comfort.router, dependencies=auth)
app.include_router(metadata.router, dependencies=auth)
app.include_router(history.router, dependencies=auth)
app.include_router(optimization.router, dependencies=auth)
app.include_router(forecast.router, dependencies=auth)
# --- Global exception handler (last-resort backstop) ---
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logging.error("Unhandled exception on %s: %s", request.url, exc, exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

# --- Root endpoint ---


@app.get("/", tags=['Hello World'])
async def read_root():
    return {"message": "Hello, World!"}
