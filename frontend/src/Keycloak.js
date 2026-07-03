import Keycloak from "keycloak-js";

const my_keycloak = new Keycloak({
    realm: process.env.REACT_APP_KEYCLOAK_REALM,
    url: process.env.REACT_APP_KEYCLOAK_URL,
    clientId: process.env.REACT_APP_KEYCLOAK_CLIENT_ID,
});

export default my_keycloak;
