import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchProductionData, fetchConsumptionData } from '../services/api';

const POLLING_INTERVAL = 10 * 60 * 1000; // 15 minutes


const DAILY_FORECAST_REFRESH_TIME = '00:20'; // Daily forecast refresh at 00:20
export const PV_PRODUCTION_MULTIPLIER = 0.7; // Global multiplier for PV production forecasts (accounts for real-world efficiency)

export const useEnergyData = (enablePolling = true) => {
  const [historicalData, setHistoricalData] = useState({ consumption: [], production: [] });
  const [forecastData, setForecastData] = useState({ consumption: [], production: [] });
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const intervalRef = useRef(null);
  const dailyRefreshTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);

  // Helper function to calculate milliseconds until next 00:20
  const getMillisecondsUntilDailyRefresh = useCallback(() => {
    const now = new Date();
    const [hours, minutes] = DAILY_FORECAST_REFRESH_TIME.split(':').map(Number);

    const nextRefresh = new Date();
    nextRefresh.setHours(hours, minutes, 0, 0);

    // If the time has already passed today, schedule for tomorrow
    if (nextRefresh <= now) {
      nextRefresh.setDate(nextRefresh.getDate() + 1);
    }

    return nextRefresh.getTime() - now.getTime();
  }, []);


  // Fetch today's historical data (called every 15 minutes)
  const fetchHistoricalData = useCallback(async (isPolling = false) => {
    if (!isPolling) {
      setLoading(true);
    }
    setError(null);

    const today = new Date().toISOString().split('T')[0];
    let productionData = [];
    let consumptionData = [];
    const errors = [];

    try {
      const productionResponse = await fetchProductionData(today, 'historical', 'Europe/Athens');
      productionData = productionResponse.data || [];
    } catch (productionError) {
      console.warn('Failed to fetch historical production data:', productionError.message);
      errors.push(`Production: ${productionError.message}`);
    }

    try {
      const consumptionResponse = await fetchConsumptionData(today, 2, 'historical', 'Europe/Athens');
      consumptionData = consumptionResponse.data || [];
    } catch (consumptionError) {
      console.warn('Failed to fetch historical consumption data:', consumptionError.message);
      errors.push(`Consumption: ${consumptionError.message}`);
    }

    const historicalDataResult = {
      consumption: consumptionData,
      production: productionData
    };

    if (isMountedRef.current) {
      setHistoricalData(historicalDataResult);

      // Only set error if both APIs failed
      if (errors.length === 2) {
        setError(`Failed to fetch historical data: ${errors.join(', ')}`);
      } else if (errors.length === 1 && !isPolling) {
        // Show warning for partial failure only on initial load, not during polling
        console.warn('Partial data available:', errors[0]);
      }
    }

    if (!isPolling && isMountedRef.current) {
      setLoading(false);
    }
  }, []);

  // Fetch today's forecast data (called once on mount or when needed)
  const fetchForecastData = useCallback(async () => {
    const today = new Date().toISOString().split('T')[0];
    let productionData = [];
    let consumptionData = [];
    const errors = [];

    try {
      const productionResponse = await fetchProductionData(today, 'forecast', 'Europe/Athens');
      productionData = (productionResponse.data || []).map(point => ({
        ...point,
        value: point.value * PV_PRODUCTION_MULTIPLIER
      }));
    } catch (productionError) {
      console.warn('Failed to fetch forecast production data:', productionError.message);
      errors.push(`Production forecast: ${productionError.message}`);
    }

    // Try to fetch consumption forecast data
    try {
      const consumptionResponse = await fetchConsumptionData(today, 2, 'forecast', 'Europe/Athens');
      consumptionData = consumptionResponse.data || [];
    } catch (consumptionError) {
      console.warn('Failed to fetch forecast consumption data:', consumptionError.message);
      errors.push(`Consumption forecast: ${consumptionError.message}`);
    }

    const forecastDataResult = {
      consumption: consumptionData,
      production: productionData
    };

    if (isMountedRef.current) {
      setForecastData(forecastDataResult);

      // Only set error if both APIs failed
      if (errors.length === 2) {
        setError(`Failed to fetch forecast data: ${errors.join(', ')}`);
      } else if (errors.length === 1) {
        console.warn('Partial forecast data available:', errors[0]);
      }
    }
  }, []);

  // Set up daily forecast refresh at 00:20
  const setupDailyForecastRefresh = useCallback(() => {
    // Clear any existing timeout
    if (dailyRefreshTimeoutRef.current) {
      clearTimeout(dailyRefreshTimeoutRef.current);
      dailyRefreshTimeoutRef.current = null;
    }

    const msUntilRefresh = getMillisecondsUntilDailyRefresh();

    dailyRefreshTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        fetchForecastData();
        setupDailyForecastRefresh();
      }
    }, msUntilRefresh);
  }, [getMillisecondsUntilDailyRefresh, fetchForecastData]);

  // Process both historical and forecast data for chart format
  const processChartData = useCallback(() => {

    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const endOfDay = startOfDay + (24 * 60 * 60 * 1000);
    const currentTimestamp = today.getTime();

    const processDataType = (dataArray, valueKey = 'value', multiplier = 1) => {
      return dataArray
        .map(point => {
          // Parse the UTC timestamp and convert to local Athens time for chart display
          const utcDate = new Date(point.timestamp);
          const timestamp = utcDate.getTime();

          return [timestamp, point[valueKey] * multiplier];
        })
        .sort((a, b) => a[0] - b[0]);
    };

    // Process historical data
    const historicalConsumption = processDataType(historicalData.consumption);
    const historicalProduction = processDataType(historicalData.production);

    // Process forecast data
    const forecastConsumption = processDataType(forecastData.consumption);
    const forecastProduction = processDataType(forecastData.production); // Multiplier already applied to forecast data

    // Create energy community consumption (20% of total consumption)
    const historicalCommunityConsumption = historicalConsumption.map(point => [point[0], point[1] * 0.2]);
    const forecastCommunityConsumption = forecastConsumption.map(point => [point[0], point[1] * 0.2]);

    // Find the last historical data timestamp
    const getLastHistoricalTimestamp = () => {
      const allHistoricalTimestamps = [
        ...historicalConsumption.map(point => point[0]),
        ...historicalProduction.map(point => point[0])
      ];

      if (allHistoricalTimestamps.length === 0) {
        return currentTimestamp;
      }

      // Always use current time as cutoff to ensure the boundary line appears
      // at the current time, not at the last data point timestamp
      // This fixes the issue where cutoff was stuck at 00:00
      return currentTimestamp;
    };

    const lastHistoricalTimestamp = getLastHistoricalTimestamp();

    // Chart styling
    const consumptionColor = '#1E90FF';
    const productionColor = '#FF8C00';
    const communityColor = '#32CD32'; // Green for community consumption

    const consumptionChartData = [
      {
        name: 'Historical Consumption',
        data: historicalConsumption,
        color: consumptionColor,
        zIndex: 3,
        type: 'area',
        fillOpacity: 0.4
      },
      {
        name: 'Forecast Consumption',
        data: forecastConsumption,
        color: consumptionColor,
        zIndex: 1,
        type: 'area',
        fillOpacity: 0.2,
        dashStyle: 'dash'
      },
      {
        name: 'Historical Energy Community Consumption',
        data: historicalCommunityConsumption,
        color: communityColor,
        zIndex: 4,
        type: 'area',
        fillOpacity: 0.3
      },
      {
        name: 'Forecast Energy Community Consumption',
        data: forecastCommunityConsumption,
        color: communityColor,
        zIndex: 2,
        type: 'area',
        fillOpacity: 0.15,
        dashStyle: 'dash'
      }
    ];

    const productionChartData = [
      {
        name: 'Historical Production',
        data: historicalProduction,
        color: productionColor,
        zIndex: 2,
        type: 'area',
        fillOpacity: 0.4
      },
      {
        name: 'Forecast Production',
        data: forecastProduction,
        color: productionColor,
        zIndex: 0,
        type: 'area',
        fillOpacity: 0.2,
        dashStyle: 'dash'
      }
    ];

    const result = {
      consumptionData: consumptionChartData,
      productionData: productionChartData,
      startOfDay: startOfDay,
      endOfDay: endOfDay,
      cutoffTimestamp: lastHistoricalTimestamp, // Last historical data timestamp for boundary
      hasData: historicalConsumption.length > 0 || forecastConsumption.length > 0 ||
        historicalProduction.length > 0 || forecastProduction.length > 0
    };

    return result;
  }, [historicalData, forecastData]);

  // Update chart data whenever historical or forecast data changes
  useEffect(() => {
    const hasAnyData = historicalData.consumption.length > 0 || historicalData.production.length > 0 ||
      forecastData.consumption.length > 0 || forecastData.production.length > 0;

    if (hasAnyData) {
      const processedData = processChartData();
      setChartData(processedData);
    } else {
      setChartData(null);
    }
  }, [historicalData, forecastData]);

  // Initial fetch on mount
  useEffect(() => {
    fetchHistoricalData();
    fetchForecastData();
    setupDailyForecastRefresh();
  }, []);

  // Set up polling separately
  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Set up polling if enabled
    if (enablePolling) {
      intervalRef.current = setInterval(() => {
        if (isMountedRef.current) {
          fetchHistoricalData(true);
        }
      }, POLLING_INTERVAL);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enablePolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (dailyRefreshTimeoutRef.current) {
        clearTimeout(dailyRefreshTimeoutRef.current);
      }
    };
  }, []);

  return {
    chartData,
    historicalData,
    forecastData,
    loading,
    error,
    refetchHistorical: fetchHistoricalData,
    refetchForecast: fetchForecastData,
    refetch: useCallback(() => {
      fetchHistoricalData();
      fetchForecastData();
    }, [fetchHistoricalData, fetchForecastData])
  };
};