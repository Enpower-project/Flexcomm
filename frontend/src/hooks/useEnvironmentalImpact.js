import { useState, useEffect } from 'react';
import { fetchTotalEmissionReduction } from '../services/api';

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export const useEnvironmentalImpact = () => {
  const [impactData, setImpactData] = useState(null);
  const [impactLoading, setImpactLoading] = useState(true);
  const [impactError, setImpactError] = useState(null);

  useEffect(() => {
    let isMounted = true;

    const fetchImpact = async () => {
      if (!isMounted) return;
      setImpactLoading(true);
      console.log("Using hardcoded environmental impact data...");

      // TEMPORARY: Using hardcoded values instead of API call
      // Uncomment the lines below to restore API functionality
      /*
      try {
        const data = await fetchTotalEmissionReduction();

        console.log('Raw API Impact Response:', data);

        if (isMounted) {
          if (data) {
            const mappedData = {
              co2Saved: data.co2_emissions_saved_tons ?? 0,
              treeEquivalent: data.equivalent_trees_planted ?? 0,
              coalSavings: data.lignite_saved_tons ?? 0
            };
            console.log('Mapped Impact Data for State:', mappedData);
            setImpactData(mappedData);
            setImpactError(null);
            console.log("Total environmental impact data fetched successfully.");
          } else {
            console.warn("API returned null/undefined impact data.");
            setImpactError('Received invalid impact data from server.');
            setImpactData(null);
          }
        }
      } catch (err) {
        console.error("Error fetching total impact data:", err);
        if (isMounted) {
          setImpactError(err.message || 'Failed to fetch impact data.');
          setImpactData(null);
        }
      } finally {
        if (isMounted) {
          setImpactLoading(false);
        }
      }
      */

      // Hardcoded values as requested
      if (isMounted) {
        const hardcodedData = {
          co2Saved: 7631.8,
          treeEquivalent: 416695,
          coalSavings: 3092.36
        };
        console.log('Using hardcoded Impact Data:', hardcodedData);
        setImpactData(hardcodedData);
        setImpactError(null);
        setImpactLoading(false);
        console.log("Hardcoded environmental impact data loaded successfully.");
      }
    };

    fetchImpact();

    const impactIntervalId = setInterval(fetchImpact, REFRESH_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(impactIntervalId);
    };
  }, []);

  return { impactData, impactLoading, impactError };
};