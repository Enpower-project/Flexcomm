import { createContext, useContext, useState, useEffect } from 'react';
import { useKeycloak } from '@react-keycloak/web';
import { initPilot, getCurrentPilot, getCurrentPilotTimezone, DEMO_USERNAME } from '../services/api';

const PilotContext = createContext({ pilot: 'gr', pilotTimezone: 'Europe/Athens', isAdmin: false, userId: null });

export const PilotProvider = ({ children }) => {
    const { keycloak } = useKeycloak();
    const [pilot, setPilot] = useState('gr');
    const [pilotTimezone, setPilotTimezone] = useState('Europe/Athens');
    const [isAdmin, setIsAdmin] = useState(false);
    const [userId, setUserId] = useState(null);

    useEffect(() => {
        if (keycloak.authenticated) {
            const isDemo = keycloak.tokenParsed?.preferred_username === DEMO_USERNAME;
            if (isDemo) {
                // Demo user: fixed gr pilot, non-admin, userId matching demo_site's
                // site_id in public/data/demo/sites.json — independent of whatever
                // attributes the Keycloak demo account carries.
                initPilot(undefined);
                setPilot(getCurrentPilot());
                setPilotTimezone(getCurrentPilotTimezone());
                setIsAdmin(false);
                setUserId(1);
                return;
            }
            const country = keycloak.tokenParsed?.country?.toLowerCase();
            initPilot(country);
            setPilot(getCurrentPilot());
            setPilotTimezone(getCurrentPilotTimezone());
            setIsAdmin(keycloak.tokenParsed?.is_admin === 'yes');
            setUserId(keycloak.tokenParsed?.user_id ?? null);
        }
    }, [keycloak.authenticated]);

    return (
        <PilotContext.Provider value={{ pilot, pilotTimezone, isAdmin, userId }}>
            {children}
        </PilotContext.Provider>
    );
};

export const usePilot = () => useContext(PilotContext);
