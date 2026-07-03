import React from 'react';
import { Grid, Paper, Typography, Box, CircularProgress, Alert } from '@mui/material';
import { Cloud, Leaf } from 'lucide-react';
import WeatherCard from '../WeatherCard';
import ImpactCard from '../ImpactCard';

const InfoCardsSection = ({
  currentWeatherData,
  weatherLoading,
  weatherError,
  impactData,
  impactLoading,
  impactError
}) => {
  return (
    <>
      {/* Weather Component */}
      <Grid item xs={12} md={6}>
        <Paper className="dashboard-card-hover" sx={{
          p: 2,
          borderRadius: 2,
          minHeight: '180px',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexShrink: 0 }}>
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              color: 'white'
            }}>
              <Cloud size={16} />
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#1e293b', fontSize: '1rem' }}>
              Current Weather Conditions
            </Typography>
          </Box>
          {weatherLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
              <CircularProgress size={30} />
            </Box>
          )}
          {weatherError && !weatherLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
              <Alert severity="error" sx={{ width: '90%' }}>{weatherError}</Alert>
            </Box>
          )}
          {!weatherLoading && !weatherError && currentWeatherData && (
            <WeatherCard weatherData={currentWeatherData} />
          )}
          {!weatherLoading && !weatherError && !currentWeatherData && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
              <Typography variant="body2" color="textSecondary">Weather data unavailable.</Typography>
            </Box>
          )}
        </Paper>
      </Grid>

      {/* Impact Component */}
      <Grid item xs={12} md={6}>
        <Paper className="dashboard-card-hover" sx={{
          p: 2,
          borderRadius: 2,
          minHeight: '180px',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexShrink: 0 }}>
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: 'white'
            }}>
              <Leaf size={16} />
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 600, color: '#1e293b', fontSize: '1rem' }}>
              Environmental Impact (Total)
            </Typography>
          </Box>
          {impactLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
              <CircularProgress size={30} />
            </Box>
          )}
          {impactError && !impactLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
              <Alert severity="error" sx={{ width: '90%' }}>{impactError}</Alert>
            </Box>
          )}
          {!impactLoading && !impactError && impactData && (
            <ImpactCard impactData={impactData} />
          )}
          {!impactLoading && !impactError && !impactData && (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
              <Typography variant="body2" color="textSecondary">Impact data not available.</Typography>
            </Box>
          )}
        </Paper>
      </Grid>
    </>
  );
};

export default InfoCardsSection;