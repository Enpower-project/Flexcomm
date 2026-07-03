import { useState, useEffect, useMemo } from 'react';
import { useKeycloak } from "@react-keycloak/web";
import { fetchProductionData, fetchUsers, fetchConsumptionData, fetchUserConsumption, getCurrentPilot, initPilot, isDemoMode } from '../services/api';
import { demoLatestMetrics } from '../services/demoData';
import grNameConfig from '../gr_name_config.json';
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const PV_TARGET_DATE_STR = '2025-03-20';

export const apiClient = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL,
  timeout: 10_000,
});

const mergeUsers = (apiUsers = []) => {
    return apiUsers.map((user) => ({ ...user }));
};

const generateUserSpecificLoadData = (username) => {
    const now = Date.now();
    const hoursAhead = 24;
    let totalLoadPattern, acLoadPattern;

    const generateLoadArray = (patternFn) => {
        return Array.from({ length: hoursAhead }, (_, i) => {
            const time = now + i * 3600000;
            const hour = new Date(time).getHours();
            const value = patternFn(hour) + Math.random() * 5;
            return [time, Math.max(0, value)];
        });
    };

    switch (username) {
        case 'Aretanasa Hotel':
            totalLoadPattern = (hour) => {
                let base = 25; if (hour >= 7 && hour <= 10) base += 30; if (hour >= 18 && hour <= 22) base += 40;
                if (hour >= 12 && hour <= 20) base += 15; return base + Math.sin(hour * Math.PI / 12) * 10;
            };
            acLoadPattern = (totalVal, hour) => (hour >= 12 && hour <= 20) ? totalVal * 0.35 + Math.random() * 2 : 0;
            break;
        case 'Osmosis Plant':
            totalLoadPattern = (hour) => {
                let base = 40; if ((hour >= 2 && hour <= 6) || (hour >= 14 && hour <= 18)) base += 25;
                return base + Math.cos(hour * Math.PI / 6) * 5;
            };
            acLoadPattern = (totalVal, hour) => (hour >= 10 && hour <= 18) ? totalVal * 0.1 + Math.random() : 0;
            break;
        case 'LaPiazza Cafe':
            totalLoadPattern = (hour) => {
                let base = 15; if (hour >= 11 && hour <= 15) base += 35; if (hour >= 18 && hour <= 21) base += 25;
                return base + Math.sin(hour * Math.PI / 10) * 8;
            };
            acLoadPattern = (totalVal, hour) => (hour >= 11 && hour <= 21) ? totalVal * 0.25 + Math.random() * 1.5 : 0;
            break;
        default:
            totalLoadPattern = (hour) => (20 + Math.sin(hour * Math.PI / 12) * 15 +
                (hour >= 17 && hour <= 22 ? 25 : 0) + (hour >= 6 && hour <= 9 ? 15 : 0));
            acLoadPattern = (totalVal, hour) => {
                const activeACHours = [12, 13, 14, 15, 16, 17, 18, 19];
                return activeACHours.includes(hour) ? totalVal * 0.2 + Math.random() : 0;
            };
            break;
    }
    const totalLoadData = generateLoadArray(totalLoadPattern);
    const acLoadData = totalLoadData.map(([time, value]) => {
        const hour = new Date(time).getHours();
        return [time, Math.max(0, Math.min(value, acLoadPattern(value, hour)))];
    });
    return {
        loadData: [
            { name: 'Total Load', data: totalLoadData, color: '#3b82f6', fillOpacity: 0.3, type: 'area' },
            { name: 'AC Load', data: acLoadData, color: '#16a34a', fillOpacity: 0.3, type: 'area' },
        ],
    };
};

const generateUserSpecificMetrics = (username) => {
  let tin, rh, comfort_index, tout;

  switch (username) {
    case "Town Hall":
      tin = 23.2;
      rh = 47;
      comfort_index = 79;
      tout = 15.5;
      break;

    case "Aretanasa Hotel":
      tin = 24.0;
      rh = 60;
      comfort_index = 70;
      tout = 15.5;
      break;

    case "Osmosis Plant":
      tin = 26.0;
      rh = 50;
      comfort_index = 75;
      tout = 15.5;
      break;

    case "LaPiazza Cafe":
      tin = 23.5;
      rh = 58;
      comfort_index = 68;
      tout = 15.5;
      break;

    default:
      tin = 25.5;
      rh = 55;
      comfort_index = 72;
      tout = 15.5;
  }

  return [
    {
      label: "Indoor Temperature",
      value: tin,
      timestamp: null,
    },
    {
      label: "Humidity",
      value: rh,
      timestamp: null,
    },
    {
      label: "Comfort Index",
      value: comfort_index,
      timestamp: null,
    },
     {
      label: "Outdoor Temperature",
      value: tin,
      timestamp: null,
    },
  ];
};

export const useUserConsumptionApi = (siteId) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!siteId) return;

    const controller = new AbortController();
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetchUserConsumption(siteId, {
          signal: controller.signal,
        });

        setData(response);
      } catch (err) {
        if (err.name !== 'AbortError') {
          setError(err);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();

    return () => controller.abort();
  }, [siteId]);

  return { data, loading, error };
};


export const useAvailableUsers = () => {
  const { keycloak } = useKeycloak();
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);


  // Initialize + fetch additional users
  useEffect(() => {
    const controller = new AbortController();

    // Always set fallback immediately
    setUsers([]);

    const loadUsers = async () => {
      try {
        const response = await fetchUsers(keycloak?.token, {
          signal: controller.signal,
        });
        let usersApi = [];
        if (response && response?.length){
          const isGr = getCurrentPilot() === 'gr';
          for (const user of response){
            const nameLower = user.site_name?.toLowerCase();
            const displayName = (isGr && nameLower && grNameConfig[nameLower]) ? grNameConfig[nameLower] : user.site_name;
            usersApi.push({
              id: user.site_id,
              username: user.site_name,
              displayName,
            });
          }
        }
    
        const merged = mergeUsers(usersApi);
        setUsers(merged);
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Failed to fetch users:', err);
        }
      }
    };

    if (keycloak?.authenticated) {
      // Demo user always runs as the gr pilot, regardless of any country
      // attribute on the Keycloak demo account.
      initPilot(isDemoMode() ? undefined : keycloak.tokenParsed?.country?.toLowerCase());
      loadUsers();
    }

    return () => controller.abort();
  }, [keycloak?.authenticated, keycloak?.token, keycloak?.tokenParsed?.country]);

  return {
    users,
    selectedUser,
    setSelectedUser,
  };
};

export const useLatestMetricsApi = (siteId, enabled) => {
  return useQuery({
    queryKey: ["latest-metrics", siteId],
    queryFn: async () => {
      if (isDemoMode()) {
        return demoLatestMetrics();
      }
      const res = await apiClient.get(
        `/history/${siteId}/metrics/latest`,
        {
          params: {
            metrics: "tin,rh,comfort_index,tout",
            pilot: getCurrentPilot(),
          },
          timeout: 10000 // 10 seconds
        }
      );
      return res.data;
    },
    enabled: enabled && siteId != null,
    refetchInterval: 60_000,
    staleTime: 60_000,
  });
};

const adaptLatestMetricsToMetricsData = (apiResponse) => {
  if (!apiResponse?.metrics) return null;

  const m = apiResponse.metrics;

  return [
    {
      label: "Indoor Temperature",
      value: m.tin?.value ?? null,
      timestamp: m.tin?.timestamp ?? null,
    },
    {
      label: "Humidity",
      value: m.rh?.value ?? null,
      timestamp: m.rh?.timestamp ?? null,
    },
    {
      label: "Comfort Index",
      value: m.comfort_index?.value ?? null,
      timestamp: m.comfort_index?.timestamp ?? null,
    },
    {
      label: "Outdoor Temperature",
      value: m.tout?.value ?? null,
      timestamp: m.tout?.timestamp ?? null,
    }
  ];
};

export const useUserConsumption = (username) => {
  const metricsData = useMemo(
    () => generateUserSpecificMetrics(username),
    [username]
  );

  const loadChartSeries = useMemo(() => {
    if (!username) return [];
    return generateUserSpecificLoadData(username).loadData;
  }, [username]);

  return {
    metricsData,
    loadChartSeries,
  };
};

export const usePvProductionData = () => {
  const [pvApiData, setPvApiData] = useState({ actuals: [], forecasts: [] });
  const [pvLoading, setPvLoading] = useState(true);
  const [pvError, setPvError] = useState(null);
  const [currentTimeTick, setCurrentTimeTick] = useState(() => Date.now());

  /* =========================
     Fetch PV data
  ========================== */

  useEffect(() => {
    const controller = new AbortController();

    const loadPvData = async () => {
      try {
        setPvLoading(true);
        setPvError(null);

        const raw = await fetchProductionData(PV_TARGET_DATE_STR, {
          signal: controller.signal,
        });

        setPvApiData({
          actuals: raw?.actuals ?? [],
          forecasts: raw?.forecasts ?? [],
        });
      } catch (err) {
        if (err.name !== 'AbortError') {
          setPvError(err.message || 'Failed to fetch PV data.');
          setPvApiData({ actuals: [], forecasts: [] });
        }
      } finally {
        setPvLoading(false);
      }
    };

    loadPvData();

    const intervalId = setInterval(
      () => setCurrentTimeTick(Date.now()),
      5 * 60 * 1000
    );

    return () => {
      controller.abort();
      clearInterval(intervalId);
    };
  }, []);

  /* =========================
     Derived chart series
  ========================== */

  const pvChartSeries = useMemo(() => {
    const currentTickDate = new Date(currentTimeTick);
    const [y, m, d] = PV_TARGET_DATE_STR.split('-').map(Number);

    const startTs = Date.UTC(y, m - 1, d);
    const endTs = Date.UTC(y, m - 1, d + 1);
    const cutoffTs = Date.UTC(
      y,
      m - 1,
      d,
      currentTickDate.getUTCHours(),
      currentTickDate.getUTCMinutes(),
      currentTickDate.getUTCSeconds()
    );

    const processPoints = (points, isActual) =>
      (points || [])
        .map(p => ({
          ts: new Date(p.timestamp).getTime(),
          value: p.power,
        }))
        .filter(p => {
          if (p.ts < startTs || p.ts >= endTs) return false;
          if (p.value == null) return false;
          return isActual ? p.ts <= cutoffTs : p.ts > cutoffTs;
        })
        .sort((a, b) => a.ts - b.ts)
        .map(p => [p.ts, p.value]);

    const actuals = processPoints(pvApiData.actuals, true);
    const forecasts = processPoints(pvApiData.forecasts, false);

    if (
      actuals.length &&
      forecasts.length &&
      forecasts[0][0] > actuals[actuals.length - 1][0]
    ) {
      forecasts.unshift(actuals[actuals.length - 1]);
    }

    return [
      {
        name: 'PV Production (Actual)',
        data: actuals,
        color: '#eab308',
        fillOpacity: 0.3,
        type: 'area',
      },
      {
        name: 'PV Production (Forecast)',
        data: forecasts,
        color: '#eab308',
        fillOpacity: 0.2,
        dashStyle: 'Dash',
        type: 'area',
      },
    ];
  }, [pvApiData, currentTimeTick]);

  return {
    pvApiData,
    pvChartSeries,
    pvLoading,
    pvError,
    currentTimeTick,
  };
};



export const useSelfConsumptionData = () => {
  const {
    users,
    selectedUser,
    setSelectedUser,
  } = useAvailableUsers();

  const {
    data: consumptionApiData,
    loading: consumptionLoading,
    error: consumptionError,
  } = useUserConsumptionApi(selectedUser?.id);
  const isHouse01 = selectedUser?.username !== 'Town Hall' && selectedUser?.username !== 'Osmosis Plant';

  const {
      metricsData: mockMetricsData,
    loadChartSeries,
  } = useUserConsumption(selectedUser?.username);

    const {
      data: latestMetricsApi,
      isLoading: latestMetricsLoading,
      error: latestMetricsError,
    } = useLatestMetricsApi(selectedUser?.id, isHouse01);


  const pv = usePvProductionData();

  const metricsData = useMemo(() => {
    if (isHouse01 && latestMetricsApi) {
      return adaptLatestMetricsToMetricsData(latestMetricsApi);
    }
    return mockMetricsData;
  }, [isHouse01, latestMetricsApi, mockMetricsData]);

  const handleUserChange = (event) => {
    const username = event.target.value;
    const user = users.find((u) => u.username === username);
    setSelectedUser(user ?? null);
  };

  return {
    users,
    selectedUser,
    setSelectedUser,
    handleUserChange,
    consumptionApiData,
    consumptionLoading,
    consumptionError,

    metricsData,
    loadChartSeries,

    ...pv,
  };
};

