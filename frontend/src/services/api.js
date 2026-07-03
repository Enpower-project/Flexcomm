// src/services/api.js (Example)
import axios from 'axios';
import my_keycloak from '../Keycloak';
import {
    demoFetchUsers,
    demoUserConsumption,
    demoProductionData,
    demoLatestOptimizationRun,
    demoOptimizationRunData,
    demoConsumptionForecast,
    demoForecastedMetrics,
    demoTriggerOptimizationRun,
    demoOptimizationRun,
    demoCancelOptimizationRun,
    demoCurrentWeather,
} from './demoData';

const API_BASE_URL = process.env.REACT_APP_API_BASE_URL;

// Demo mode: when the authenticated Keycloak user is `demo_pilot`, every API
// call below is bypassed and served from local JSON (see ./demoData). This lets
// the SelfConsumptionOptimization page run as a fully static demo with no backend.
export const DEMO_USERNAME = 'demo_pilot';
export const isDemoMode = () =>
    my_keycloak?.tokenParsed?.preferred_username === DEMO_USERNAME;

// Pilot code: "gr" for Greek (Chalki), "hu" for Hungarian (Békéscsaba)
let _pilot = 'gr';
let _pilotTimezone = 'Europe/Athens';

// Call once from App.js after keycloak authenticates
export const initPilot = (country) => {
    _pilot = country === 'hungary' ? 'hu' : 'gr';
    _pilotTimezone = _pilot === 'hu' ? 'Europe/Budapest' : 'Europe/Athens';
};

export const getCurrentPilot = () => _pilot;
export const getCurrentPilotTimezone = () => _pilotTimezone;

// Live-binding exports for components that import PILOT / PILOT_TIMEZONE directly
export { _pilot as PILOT, _pilotTimezone as PILOT_TIMEZONE };

// Helper function to get today's date string
const getTodayDateString = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
    // return '2025-03-20'
};


const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 25000,
  headers: {
    Accept: 'application/json',
  },
});


export const fetchUsers = async (token) => {
    if (isDemoMode()) {
        return demoFetchUsers();
    }
    try {
        const config = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
        const response = await axios.get(`${API_BASE_URL}/metadata/get_all_buildings?pilot=${_pilot}`, config);
        return response.data; // Expect either an array or { users: [...] }
    } catch (error) {
        console.error('Error fetching users:', error.response?.data || error.message);
        throw error;
    }
};

export const fetchUserConsumption = async (
  siteId,
  { signal } = {}
) => {
    if (isDemoMode()) {
        return demoUserConsumption(siteId);
    }
    if (!siteId) {
        throw new Error('siteId is required');
    }
    // -----------------------------
    // Compute shifted timestamps
    // -----------------------------

    const endTs = new Date();
    const startTs = new Date(endTs.getTime() - 24 * 60 * 60 * 1000);

    // -----------------------------
    // Build query params
    // -----------------------------
    const response = await apiClient.get(
        `/history/${siteId}/timeseries`,
        {
        params: {
            metrics: _pilot === 'hu'
              ? 'tin,rh,energy_consumption,energy_production'
              : 'tin,rh,energy_consumption',
            start_ts: startTs.toISOString(),
            end_ts: endTs.toISOString(),
            pilot: _pilot,
        },
        signal,
        }
    );

    return response.data;
};

export const fetchTotalEmissionReduction = async () => {
    try {
        const response = await fetch(`${API_BASE_URL}/production/emission-reduction/total`);
        if (!response.ok) {
            // Try to get error details from response if possible
            const errorBody = await response.text();
            console.error("API Error Response:", errorBody);
            throw new Error(`Failed to fetch total emission reduction data: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return data; // Returns the LifecycleEmissionReductionResponse object
    } catch (error) {
        console.error("Error in fetchTotalEmissionReduction:", error);
        throw error; // Re-throw the error to be caught by the component
    }
};

// --- Function for Current Weather Metrics ---
export const fetchCurrentWeatherData = async () => {
    if (isDemoMode()) {
        return demoCurrentWeather();
    }
    try {
        // Calls the backend endpoint /weather/current
        const response = await apiClient.get(`/weather/current`);
        return response.data;
    } catch (error) {
        console.error('Error fetching current weather data:', error.response?.data || error.message);
        // Return null or a specific error object for the component to handle
        return null; // Simplifies error handling in the component
    }
};

// --- Energy Data Functions ---
export const fetchEnergyForecast = async () => {
    try {
        const response = await axios.get(`${API_BASE_URL}/api/energy/forecast`);
        return response.data;
    } catch (error) {
        console.error('Error fetching energy forecast data:', error);
        throw error;
    }
};

export const fetchEnergyRealtime = async () => {
    try {
        const response = await axios.get(`${API_BASE_URL}/api/energy/realtime`);
        return response.data;
    } catch (error) {
        console.error('Error fetching real-time energy data:', error);
        throw error;
    }
};

// --- New Live Energy Data Functions ---
export const fetchActualEnergyData = async (date, siteId, sinceTimestamp = null) => {
    try {
        const params = new URLSearchParams({
            date,
            site_id: siteId,
        });

        if (sinceTimestamp) {
            params.append('since', sinceTimestamp);
        }

        const response = await axios.get(`${API_BASE_URL}/api/energy-data/actual?${params.toString()}`);
        return response.data;
    } catch (error) {
        console.error('Error fetching actual energy data:', error);
        throw error;
    }
};

export const fetchForecastEnergyData = async (date, siteId) => {
    try {
        const params = new URLSearchParams({
            date,
            site_id: siteId,
        });

        const response = await axios.get(`${API_BASE_URL}/api/energy-data/forecast?${params.toString()}`);
        return response.data;
    } catch (error) {
        console.error('Error fetching forecast energy data:', error);
        throw error;
    }
};

// --- Energy Data Functions (Historical & Forecast) ---
export const fetchProductionData = async (date, dataType = 'historical', timezone = 'Europe/Athens') => {
    if (isDemoMode()) {
        return demoProductionData(date, dataType);
    }
    try {
        const params = new URLSearchParams({
            data_type: dataType,
            date: date,
            timezone: timezone
        });

        const response = await axios.get(`${API_BASE_URL}/api/energy/production?${params.toString()}`);
        return response.data;
    } catch (error) {
        console.error(`Error fetching ${dataType} production data:`, error);
        throw error;
    }
};

export const fetchConsumptionData = async (date, siteId = 2, dataType = 'historical', timezone = 'Europe/Athens') => {
    try {
        const params = new URLSearchParams({
            data_type: dataType,
            site_id: siteId,
            date: date,
            timezone: timezone
        });

        const response = await axios.get(`${API_BASE_URL}/api/energy/consumption?${params.toString()}`);
        return response.data;
    } catch (error) {
        console.error(`Error fetching ${dataType} consumption data:`, error);
        throw error;
    }
};

// Backward compatibility aliases
export const fetchHistoricalProductionData = (date, timezone) => fetchProductionData(date, 'historical', timezone);
export const fetchHistoricalConsumptionData = (date, siteId, timezone) => fetchConsumptionData(date, siteId, 'historical', timezone);


export async function triggerDisaggregation(siteId) {
  if (isDemoMode()) {
    return { status: 'ok' };
  }
  const res = await apiClient.post(`/optimize/${siteId}/disaggregation?pilot=${_pilot}`);
  return res.data;
}

export async function triggerOptimizationRun(siteId, pv) {
  if (isDemoMode()) {
    return demoTriggerOptimizationRun(siteId, pv);
  }
  const res = await apiClient.post(`/optimize/${siteId}/run?pilot=${_pilot}`, {
    manual_pv_48: pv,
  });
  return res.data; // contains run_id
}

export async function getOptimizationRun(runId) {
  if (isDemoMode()) {
    return demoOptimizationRun(runId);
  }
  const res = await apiClient.get(`/optimize/runs/${runId}`);
  return res.data;
}

export async function getOptimizationRunData(runId) {
  if (isDemoMode()) {
    return demoOptimizationRunData(runId);
  }
  const res = await apiClient.get(`/optimize/runs/${runId}/data`);
  return res.data;
}

export async function cancelOptimizationRun(siteId, runId) {
  if (isDemoMode()) {
    return demoCancelOptimizationRun();
  }
  const res = await apiClient.post(`/optimize/${siteId}/runs/${runId}/cancel?pilot=${_pilot}`);
  return res.data;
}

export async function getLatestOptimizationRun(siteId) {
  if (isDemoMode()) {
    return demoLatestOptimizationRun(siteId);
  }
  const res = await apiClient.get(`/optimize/${siteId}/latest?pilot=${_pilot}`);
  return res.data;
}

export async function getConsumptionForecast(siteId, start_ts){
    if (isDemoMode()) {
        return demoConsumptionForecast(siteId, start_ts);
    }
    try {
        const params = new URLSearchParams({
            start_ts: start_ts,
            use_last_day: true,
            pilot: _pilot,
        });
        // return null
        const response = await apiClient.get(`/forecast/${siteId}/timeseries/consumption?${params.toString()}`);
        return response.data;
    } catch (error) {
        throw error
    }

}

export async function getForecastedMetricsForOptimization(siteId,forecastData,start_time){
    if (isDemoMode()) {
        return demoForecastedMetrics(siteId, forecastData, start_time);
    }
    const res = await apiClient.post(`/optimize/${siteId}/forecast?pilot=${_pilot}`, {
        start_time: start_time,
        hvac_mode_48: null
    });
    return res.data.forecast;

}
