import { useState, useEffect } from 'react';

export const useRecommendations = () => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Generate dummy recommendations (could be replaced with real logic later)
    const dummyRecommendations = [
      {
        startTime: new Date(new Date().setHours(9, 30, 0, 0)),
        endTime: new Date(new Date().setHours(11, 0, 0, 0)),
        availableCapacity: 84,
        expectedProduction: 120,
        durationHours: 1.5,
        score: 65,
        recommendation: {
          primary: `Recommended time slot: 9:30 AM - 11:00 AM`,
          secondary: `Expected available energy: 84kWh`,
          details: [
            `Duration: 1.5 hours`,
            `Solar production score: 85%`,
            `Best for: Heavy Loads (e.g., EV charging, Water Heater, Oven)`
          ]
        }
      },
      {
        startTime: new Date(new Date().setHours(11, 15, 0, 0)),
        endTime: new Date(new Date().setHours(13, 30, 0, 0)),
        availableCapacity: 166,
        expectedProduction: 200,
        durationHours: 2.25,
        score: 80,
        recommendation: {
          primary: `Recommended time slot: 11:15 AM - 1:30 PM`,
          secondary: `Expected available energy: 166kWh`,
          details: [
            `Duration: 2.25 hours`,
            `Solar production score: 92%`,
            `Best for: Heavy Loads (e.g., EV charging, Water Heater, Oven)`
          ]
        }
      },
      {
        startTime: new Date(new Date().setHours(13, 45, 0, 0)),
        endTime: new Date(new Date().setHours(14, 45, 0, 0)),
        availableCapacity: 45,
        expectedProduction: 70,
        durationHours: 1,
        score: 44,
        recommendation: {
          primary: `Recommended time slot: 1:45 PM - 2:45 PM`,
          secondary: `Expected available energy: 45kWh`,
          details: [
            `Duration: 1 hours`,
            `Solar production score: 72%`,
            `Best for: Medium Loads (e.g., Washing Machine, Dryer, Dishwasher)`
          ]
        }
      }
    ];

    setRecommendations(dummyRecommendations);
    setLoading(false);
  }, []);

  return { recommendations, loading };
};