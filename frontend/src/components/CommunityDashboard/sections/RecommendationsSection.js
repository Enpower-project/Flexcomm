import React from 'react';
import { Grid, Paper } from '@mui/material';
import LoadRecommendations from '../LoadRecommendations';
// import { useRecommendations } from '../../../hooks/useRecommendations'; // Backup hook
import { useDynamicRecommendations } from '../../../hooks/useDynamicRecommendations';

const RecommendationsSection = ({
  chartData,
  historicalData,
  forecastData,
  loading: energyLoading,
  error: energyError
} = {}) => {
  // Use dynamic recommendations with forecast data
  const {
    recommendations: dynamicRecommendations,
    loading: dynamicLoading
  } = useDynamicRecommendations(forecastData, historicalData);

  // Keep backup hook available (uncomment to use dummy data)
  // const { recommendations: backupRecommendations, loading: backupLoading } = useRecommendations();

  // Use dynamic recommendations as primary, with fallback logic if needed
  const recommendations = dynamicRecommendations;
  const loading = dynamicLoading;

  return (
    <Grid item xs={12}>
      <Paper className="dashboard-large-card-hover" sx={{
        p: 1.5,
        overflow: 'hidden'
      }}>
        <LoadRecommendations
          recommendations={recommendations}
          loading={loading}
        />
      </Paper>
    </Grid>
  );
};

export default RecommendationsSection;