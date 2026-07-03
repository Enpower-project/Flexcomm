import { useState, useEffect, useCallback, useRef } from 'react';

const CALCULATION_TIME = '00:20'; // Time when recommendations should be calculated
const RECOMMENDATION_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

export const useDynamicRecommendations = (forecastData, historicalData) => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastCalculation, setLastCalculation] = useState(null);

  const calculationTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);

  // Helper function to calculate milliseconds until next 00:20
  const getMillisecondsUntilCalculation = useCallback(() => {
    const now = new Date();
    const [hours, minutes] = CALCULATION_TIME.split(':').map(Number);

    const nextCalculation = new Date();
    nextCalculation.setHours(hours, minutes, 0, 0);

    // If the time has already passed today, schedule for tomorrow
    if (nextCalculation <= now) {
      nextCalculation.setDate(nextCalculation.getDate() + 1);
    }

    return nextCalculation.getTime() - now.getTime();
  }, []);

  // Calculate available PV production windows
  const calculatePVOptimizationWindows = useCallback((productionData, consumptionData) => {
    if (!productionData || !consumptionData || productionData.length === 0) {
      console.log('📊 Insufficient data for PV optimization calculation');
      return [];
    }

    console.log('🔄 Calculating PV optimization windows with', productionData.length, 'production points and', consumptionData.length, 'consumption points');

    // Convert data to 15-minute intervals for analysis
    const intervals = [];
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Create 15-minute intervals for the entire day (96 intervals)
    for (let i = 0; i < 96; i++) {
      const timestamp = startOfDay.getTime() + (i * 15 * 60 * 1000);

      // Find closest production data point
      const productionPoint = productionData.find(p =>
        Math.abs(new Date(p.timestamp).getTime() - timestamp) < 7.5 * 60 * 1000 // Within 7.5 minutes
      );

      // Find closest consumption data point
      const consumptionPoint = consumptionData.find(c =>
        Math.abs(new Date(c.timestamp).getTime() - timestamp) < 7.5 * 60 * 1000 // Within 7.5 minutes
      );

      if (productionPoint && consumptionPoint) {
        const production = productionPoint.value; // Value already has multiplier applied from useEnergyData
        const consumption = consumptionPoint.value;
        const surplus = production - consumption;


        intervals.push({
          timestamp,
          production,
          consumption,
          surplus: Math.max(0, surplus), // Only positive surplus
          maxCapacity: production, // Maximum potential energy available
          hour: new Date(timestamp).getHours(),
          minute: new Date(timestamp).getMinutes()
        });
      }
    }

    console.log('📈 Created', intervals.length, 'intervals for analysis');

    // Find optimal time windows (1-3 hours) with highest surplus
    const windows = [];

    // Check 1-hour windows (4 intervals of 15 minutes)
    for (let i = 0; i <= intervals.length - 4; i++) {
      const window = intervals.slice(i, i + 4);
      const totalSurplus = window.reduce((sum, interval) => sum + interval.surplus, 0);
      const totalCapacity = window.reduce((sum, interval) => sum + interval.maxCapacity, 0);
      const avgSurplus = totalSurplus / 4;

      if (avgSurplus > 5) { // Only consider windows with meaningful surplus (>5kW average)

        windows.push({
          startTime: new Date(window[0].timestamp),
          endTime: new Date(window[3].timestamp + 15 * 60 * 1000),
          duration: 1,
          avgSurplus,
          totalSurplus,
          totalCapacity,
          score: avgSurplus * 1.2 // Slightly favor 1-hour windows
        });
      }
    }

    // Check 2-hour windows (8 intervals of 15 minutes)
    for (let i = 0; i <= intervals.length - 8; i++) {
      const window = intervals.slice(i, i + 8);
      const totalSurplus = window.reduce((sum, interval) => sum + interval.surplus, 0);
      const totalCapacity = window.reduce((sum, interval) => sum + interval.maxCapacity, 0);
      const avgSurplus = totalSurplus / 8;

      if (avgSurplus > 3) { // Lower threshold for longer windows
        windows.push({
          startTime: new Date(window[0].timestamp),
          endTime: new Date(window[7].timestamp + 15 * 60 * 1000),
          duration: 2,
          avgSurplus,
          totalSurplus,
          totalCapacity,
          score: avgSurplus * 1.4 // Slightly favor longer windows
        });
      }
    }

    // Check 3-hour windows (12 intervals of 15 minutes)
    for (let i = 0; i <= intervals.length - 12; i++) {
      const window = intervals.slice(i, i + 12);
      const totalSurplus = window.reduce((sum, interval) => sum + interval.surplus, 0);
      const totalCapacity = window.reduce((sum, interval) => sum + interval.maxCapacity, 0);
      const avgSurplus = totalSurplus / 12;

      if (avgSurplus > 2) { // Even lower threshold for 3-hour windows
        windows.push({
          startTime: new Date(window[0].timestamp),
          endTime: new Date(window[11].timestamp + 15 * 60 * 1000),
          duration: 3,
          avgSurplus,
          totalSurplus,
          totalCapacity,
          score: avgSurplus // Base score for 3-hour windows
        });
      }
    }

    // Sort by score and take top 3 non-overlapping windows
    windows.sort((a, b) => b.score - a.score);

    const selectedWindows = [];
    for (const window of windows) {
      // Check if this window overlaps with any already selected
      const overlaps = selectedWindows.some(selected =>
        (window.startTime < selected.endTime && window.endTime > selected.startTime)
      );

      if (!overlaps && selectedWindows.length < 3) {
        selectedWindows.push(window);
      }
    }

    console.log('✅ Found', selectedWindows.length, 'optimal PV windows');
    return selectedWindows;
  }, []);

  // Generate recommendation text based on window characteristics
  const generateRecommendationText = useCallback((window) => {
    const startTime = window.startTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const endTime = window.endTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    // Available energy is the total surplus energy for this time window
    const availableEnergy = Math.round(window.totalSurplus);
    const maxCapacity = Math.round(window.totalCapacity);
    const efficiencyScore = Math.min(95, Math.round((window.avgSurplus / 20) * 100)); // Score out of 100

    // Determine load type recommendation based on available energy
    let loadType = 'Light Loads (e.g., Phone charging, LED lights)';
    if (availableEnergy > 200) {
      loadType = 'Heavy Loads (e.g., EV charging, Water Heater, Oven)';
    } else if (availableEnergy > 100) {
      loadType = 'Medium Loads (e.g., Washing Machine, Dryer, Dishwasher)';
    }

    return {
      primary: `Recommended time slot: ${startTime} - ${endTime}`,
      secondary: `Expected surplus energy: ${availableEnergy}kWh`,
      details: [
        `Duration: ${window.duration} hour${window.duration > 1 ? 's' : ''}`,
        `Solar efficiency score: ${efficiencyScore}%`,
        `Best for: ${loadType}`
      ]
    };
  }, []);

  // Main calculation function
  const calculateRecommendations = useCallback(async () => {
    if (!forecastData?.production || forecastData.production.length === 0) {
      console.log('📊 No forecast production data available for recommendations');
      return;
    }

    console.log('🔄 Calculating dynamic recommendations...');
    setLoading(true);

    try {
      // Use forecast consumption or fallback to forecast production with typical consumption pattern
      const consumptionData = forecastData.consumption.length > 0
        ? forecastData.consumption
        : forecastData.production.map(p => ({
          ...p,
          value: p.value * 0.3 // Assume 30% of production as baseline consumption
        }));

      const optimizationWindows = calculatePVOptimizationWindows(
        forecastData.production,
        consumptionData
      );


      const newRecommendations = optimizationWindows
        .map((window, index) => ({
          startTime: window.startTime,
          endTime: window.endTime,
          availableCapacity: Math.round(window.totalSurplus), // Actual surplus energy available for load shifting
          expectedProduction: Math.round(window.totalCapacity), // Maximum potential energy available (total PV production)
          durationHours: window.duration,
          score: Math.round(window.score),
          recommendation: generateRecommendationText(window)
        }))
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime()); // Sort chronologically

      if (isMountedRef.current) {
        setRecommendations(newRecommendations);
        setLastCalculation(new Date());
        console.log('✅ Generated', newRecommendations.length, 'dynamic recommendations');
      }
    } catch (error) {
      console.error('❌ Error calculating recommendations:', error);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [forecastData, calculatePVOptimizationWindows, generateRecommendationText]);

  // Check if recommendations need to be recalculated
  const shouldRecalculate = useCallback(() => {
    if (!lastCalculation) return true;

    const now = new Date();
    const timeSinceLastCalculation = now.getTime() - lastCalculation.getTime();

    // Recalculate if it's been more than 24 hours or if it's past 00:20 today and we haven't calculated today
    if (timeSinceLastCalculation > RECOMMENDATION_CACHE_DURATION) {
      return true;
    }

    const today = new Date();
    today.setHours(0, 20, 0, 0);

    return now > today && lastCalculation < today;
  }, [lastCalculation]);

  // Set up daily calculation at 00:20
  const setupDailyCalculation = useCallback(() => {
    if (calculationTimeoutRef.current) {
      clearTimeout(calculationTimeoutRef.current);
    }

    const msUntilCalculation = getMillisecondsUntilCalculation();
    console.log('🕐 Setting up daily recommendation calculation in', Math.round(msUntilCalculation / 1000 / 60), 'minutes');

    calculationTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        console.log('🌅 Daily recommendation calculation triggered');
        calculateRecommendations();
        setupDailyCalculation(); // Schedule next day
      }
    }, msUntilCalculation);
  }, [getMillisecondsUntilCalculation, calculateRecommendations]);

  // Effect to trigger calculation when forecast data changes or on mount
  useEffect(() => {
    if (forecastData?.production && forecastData.production.length > 0 && shouldRecalculate()) {
      console.log('🔄 Forecast data available, calculating recommendations...');
      calculateRecommendations();
    }
  }, [forecastData, calculateRecommendations, shouldRecalculate]);

  // Set up daily calculation schedule
  useEffect(() => {
    setupDailyCalculation();

    return () => {
      if (calculationTimeoutRef.current) {
        clearTimeout(calculationTimeoutRef.current);
      }
    };
  }, [setupDailyCalculation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    recommendations,
    loading,
    lastCalculation,
    recalculate: calculateRecommendations
  };
};