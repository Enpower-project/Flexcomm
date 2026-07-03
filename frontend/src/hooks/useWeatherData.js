import { useState, useEffect } from 'react';
import { fetchCurrentWeatherData } from '../services/api';

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export const useWeatherData = () => {
  const [currentWeatherData, setCurrentWeatherData] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const fetchAndSetWeather = async () => {
      if (!isMounted) return;
      if (!currentWeatherData) {
        setWeatherLoading(true);
      }
      setWeatherError(null);
      console.log("Fetching current weather data...");

      try {
        const data = await fetchCurrentWeatherData();
        if (!isMounted) return;

        if (data) {
          console.log("Current weather data fetched successfully:", data);
          setCurrentWeatherData(data);
        } else {
          console.warn("fetchCurrentWeatherData returned null.");
          setWeatherError('Failed to retrieve current weather.');
          setCurrentWeatherData(null);
        }
      } catch (err) {
        console.error("Error fetching current weather data in component:", err);
        if (isMounted) {
          setWeatherError(err.message || 'An error occurred fetching weather.');
          setCurrentWeatherData(null);
        }
      } finally {
        if (isMounted) {
          setWeatherLoading(false);
        }
      }
    };

    fetchAndSetWeather();

    const weatherIntervalId = setInterval(fetchAndSetWeather, REFRESH_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(weatherIntervalId);
      console.log("Cleared weather fetch interval.");
    };
  }, []);

  return { currentWeatherData, weatherLoading, weatherError };
};