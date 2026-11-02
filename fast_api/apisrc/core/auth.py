"""Keycloak bearer-token authentication for the API routes.

Every router is mounted with `Depends(require_user)` (see service.py), so a
request needs a valid access token issued by the configured Keycloak realm.
The docs (/docs, /redoc, /openapi.json) stay public; Swagger's "Authorize"
button logs in through Keycloak using the same scheme defined here.
"""
import logging
import os

import jwt
from dotenv import load_dotenv
from fastapi import HTTPException, Security, status
from fastapi.security import OAuth2AuthorizationCodeBearer

load_dotenv()

KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "").rstrip("/")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "")
# Client used by Swagger UI's login (a public client, same as the frontend's).
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "")
# Optional comma-separated list of clients whose tokens are accepted (the
# token's `azp` claim). Empty = any client in the realm.
KEYCLOAK_ALLOWED_CLIENTS = {
    c.strip() for c in os.getenv("KEYCLOAK_ALLOWED_CLIENTS", "").split(",") if c.strip()
}

ISSUER = f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}"
_OIDC = f"{ISSUER}/protocol/openid-connect"

oauth2_scheme = OAuth2AuthorizationCodeBearer(
    authorizationUrl=f"{_OIDC}/auth",
    tokenUrl=f"{_OIDC}/token",
    refreshUrl=f"{_OIDC}/token",
    scopes={"openid": "OpenID Connect"},
    # Shown in Swagger's "Authorize" dialog
    description=(
        "**Log in with your ENPOWER (Keycloak) account to call the API.**\n\n"
        "Click **Authorize** below — you'll be taken to the Keycloak login page "
        "and brought back here once you're signed in."
    ),
)

# Fetches and caches the realm's signing keys; refetches on an unknown key id.
_jwks_client = jwt.PyJWKClient(f"{_OIDC}/certs", cache_keys=True) if KEYCLOAK_URL and KEYCLOAK_REALM else None

logger = logging.getLogger(__name__)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_user(token: str = Security(oauth2_scheme)) -> dict:
    """Validate the Keycloak access token and return its claims.

    Sync on purpose: fetching the signing keys is a blocking HTTP call, so
    FastAPI runs this in its threadpool.
    """
    if _jwks_client is None:
        logger.error("KEYCLOAK_URL / KEYCLOAK_REALM not set — rejecting request")
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Authentication is not configured")

    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token).key
    except jwt.PyJWKClientConnectionError:
        logger.error("Could not reach Keycloak to fetch signing keys", exc_info=True)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Authentication service unavailable")
    except (jwt.PyJWKClientError, jwt.DecodeError):
        raise _unauthorized("Invalid token")

    try:
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=ISSUER,
            # Keycloak access tokens don't reliably carry our client in `aud`;
            # the issuer + signature pin the realm, `azp` pins the client.
            options={"verify_aud": False, "require": ["exp", "iat", "iss"]},
        )
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Token expired")
    except jwt.InvalidTokenError:
        raise _unauthorized("Invalid token")

    if KEYCLOAK_ALLOWED_CLIENTS and claims.get("azp") not in KEYCLOAK_ALLOWED_CLIENTS:
        raise _unauthorized("Token not issued for this application")

    return claims
