import React from 'react';
import {
  Box,
  Typography,
  Grid,
  Alert,
  AlertTitle,
  LinearProgress,
  Paper,
  CircularProgress
} from '@mui/material';
import {
  Battery as BatteryIcon,
  Sun as SunIcon,
  Clock as ClockIcon,
  Zap as ZapIcon,
  Calendar as CalendarIcon
} from 'lucide-react';

const LoadRecommendations = ({ recommendations, loading = false }) => {
  // Display loading indicator
  if (loading) {
    return (
      <>
        <Typography variant="h6" gutterBottom>
          Load Shifting Recommendations
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 4 }}>
          <CircularProgress />
          <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
            Calculating optimal time slots...
          </Typography>
        </Box>
      </>
    );
  }

  // Handle empty recommendations
  if (!recommendations || recommendations.length === 0) {
    return (
      <>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
            color: 'white'
          }}>
            <CalendarIcon style={{ width: 18, height: 18 }} />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#1e293b', fontSize: '1rem' }}>
              Load Shifting Recommendations
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
              Optimal hours for using electrical appliances
            </Typography>
          </Box>
        </Box>
        <Alert severity="info">
          <AlertTitle>No optimal time slots available</AlertTitle>
          Based on the current forecasts, there are no optimal time periods for load shifting today.
          This could be due to low predicted solar production or high expected consumption.
        </Alert>
      </>
    );
  }

  const getScoreColor = (score) => {
    if (score >= 80) return '#16a34a';
    if (score >= 60) return '#ca8a04';
    return '#2563eb';
  };

  const getScoreBackground = (score) => {
    if (score >= 80) return '#f0fdf4';
    if (score >= 60) return '#fefce8';
    return '#eff6ff';
  };

  // Function to check if recommendations are valid (have all required properties)
  const areRecommendationsValid = (rec) => {
    return rec &&
      rec.startTime instanceof Date &&
      rec.endTime instanceof Date &&
      !isNaN(rec.startTime) &&
      !isNaN(rec.endTime) &&
      typeof rec.availableCapacity === 'number' &&
      typeof rec.score === 'number' &&
      rec.recommendation &&
      rec.recommendation.primary &&
      rec.recommendation.details;
  };

  // Filter out any invalid recommendations
  const validRecommendations = recommendations.filter(areRecommendationsValid);

  if (validRecommendations.length === 0) {
    return (
      <>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
            color: 'white'
          }}>
            <CalendarIcon style={{ width: 18, height: 18 }} />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#1e293b', fontSize: '1rem' }}>
              Load Shifting Recommendations
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
              Optimal hours for using electrical appliances
            </Typography>
          </Box>
        </Box>
        <Alert severity="warning">
          <AlertTitle>Invalid recommendation data</AlertTitle>
          The system generated recommendations, but they contain invalid data. This may be due to incomplete forecast data.
        </Alert>
      </>
    );
  }

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
        <Box sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: '8px',
          background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
          color: 'white'
        }}>
          <CalendarIcon style={{ width: 18, height: 18 }} />
        </Box>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 600, color: '#1e293b', fontSize: '1rem' }}>
            Load Shifting Recommendations
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
            Optimal hours for using electrical appliances
          </Typography>
        </Box>
      </Box>

      <Grid container spacing={2} sx={{ mb: 0 }}>
        {validRecommendations.slice(0, 3).map((rec, index) => (
          <Grid item xs={12} md={4} key={index}>
            <Paper
              elevation={2}
              sx={{
                p: 1.5,
                backgroundColor: getScoreBackground(rec.score),
                height: 'auto',
                transition: 'all 0.2s',
                '&:hover': {
                  boxShadow: 3
                }
              }}
            >
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SunIcon
                    style={{
                      width: 20,
                      height: 20,
                      color: getScoreColor(rec.score)
                    }}
                  />
                  <Typography variant="subtitle1" fontWeight="bold">
                    Time Period {index + 1}
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <ClockIcon style={{ width: 16, height: 16, color: '#6b7280' }} />
                <Typography variant="body2">
                  {rec.recommendation.primary.split(': ')[1]}
                </Typography>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Box sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  mb: 0.5
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <BatteryIcon style={{ width: 16, height: 16, color: '#6b7280' }} />
                    <Typography variant="body2">Available Energy</Typography>
                  </Box>
                  <Typography variant="body2" fontWeight="medium">
                    {rec.availableCapacity}kWh
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={Math.min((rec.availableCapacity / rec.expectedProduction) * 100, 100)} // Show ratio of available energy to total capacity
                  sx={{
                    height: 6,
                    borderRadius: 1,
                    backgroundColor: '#e5e7eb',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: getScoreColor(rec.score)
                    }
                  }}
                />
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Duration: {rec.durationHours} hours
                </Typography>
              </Box>

              <Paper
                variant="outlined"
                sx={{
                  p: 1.5,
                  backgroundColor: 'rgba(255, 255, 255, 0.5)'
                }}
              >
                <Typography variant="body2" fontWeight="medium" color="text.secondary">
                  Recommended for:
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {rec.recommendation.details[2].split(': ')[1]}
                </Typography>
              </Paper>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </>
  );
};

export default LoadRecommendations;