import Keycloak from "keycloak-js";

const my_keycloak = new Keycloak({
    realm: process.env.REACT_APP_KEYCLOAK_REALM,
    url: process.env.REACT_APP_KEYCLOAK_URL,
    clientId: process.env.REACT_APP_KEYCLOAK_CLIENT_ID,
});

// Tokens are kept in sessionStorage so a page refresh keeps the user logged in.
// The silent check-sso iframe alone can't do this in browsers that block
// third-party cookies (e.g. Safari).
const TOKEN_STORAGE_KEY = 'flexcomm_kc_tokens';

export const loadStoredTokens = () => {
    try {
        return JSON.parse(sessionStorage.getItem(TOKEN_STORAGE_KEY)) || {};
    } catch {
        return {};
    }
};

export const saveTokens = ({ token, refreshToken, idToken } = {}) => {
    try {
        if (token) {
            sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, refreshToken, idToken }));
        } else {
            sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        }
    } catch {
        // storage unavailable (e.g. private mode) — login just won't survive a refresh
    }
};

export const logout = () => {
    saveTokens();
    my_keycloak.logout();
};

export default my_keycloak;
