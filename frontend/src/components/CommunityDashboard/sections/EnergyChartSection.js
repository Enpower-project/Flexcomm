import React from 'react';
import { Grid, Paper, Typography, Box, CircularProgress, Alert } from '@mui/material';
import CombinedEnergyChart from '../CombinedEnergyChart';

const EnergyChartSection = ({
  chartData,
  historicalData,
  forecastData,
  loading,
  error
}) => {


  const getCurrentFormattedDate = () => {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    return `${day}/${month}/${year}`;
  };

  const chartTitle = `Energy Data for ${getCurrentFormattedDate()}`;

  return (
    <Grid item xs={12}>
      <Paper className="dashboard-large-card-hover" sx={{
        p: 2,
        height: '450px',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
        border: '1px solid #e2e8f0',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
      }}>
        {/* Header with title */}
        <Box sx={{ textAlign: 'center', mb: 2, flexShrink: 0 }}>
          <Typography variant="h6" sx={{
            fontWeight: 600,
            color: '#1e293b',
            fontSize: '1.1rem',
            mb: 0.5
          }}>
            {chartTitle}
          </Typography>
          <Typography variant="body2" sx={{
            color: '#64748b',
            fontSize: '0.85rem'
          }}>
            Live Energy Production & Consumption
          </Typography>
        </Box>

        {/* Loading state */}
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
            <CircularProgress />
          </Box>
        )}

        {/* Error state */}
        {error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
            <Alert severity="error" sx={{ width: '90%' }}>
              {error}
            </Alert>
          </Box>
        )}

        {/* Chart */}
        {!loading && !error && chartData && chartData.hasData && (
          <Box sx={{ flexGrow: 1, width: '100%', height: 'calc(100% - 90px)' }}>
            <CombinedEnergyChart
              productionData={chartData.productionData}
              consumptionData={chartData.consumptionData}
              startOfDay={chartData.startOfDay}
              endOfDay={chartData.endOfDay}
              cutoffTimestamp={chartData.cutoffTimestamp}
            />
          </Box>
        )}

        {/* No data state */}
        {!loading && !error && (!chartData || !chartData.hasData) && (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flexGrow: 1 }}>
            <Typography variant="body1" color="textSecondary">
              No energy data found for {getCurrentFormattedDate()}.
            </Typography>
          </Box>
        )}
      </Paper>
    </Grid>
  );
};

export default EnergyChartSection;