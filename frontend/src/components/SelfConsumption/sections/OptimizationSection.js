import {React, useMemo} from 'react';
import { Typography, Box, Paper } from '@mui/material';
import Grid from '@mui/material/Grid2';
import ComfortMetricsChart from '../ComfortMetricsChart';
import TemperatureChart from '../TemperatureChart';
import HumidityChart from '../HumidityChart';

const cardStyle = {
  p: 3,
  borderRadius: 2,
  minHeight: '350px',
  display: 'flex',
  flexDirection: 'column',
  background: 'white',
  border: '1px solid #e2e8f0',
  boxShadow: '-2px 2px 8px rgba(0, 0, 0, 0.2)',
};

const titleStyle = {
  fontWeight: 600,
  color: '#444444',
  fontSize: '1.1rem',
  mb: 0.5,
};

const subtitleStyle = {
  color: '#64748b',
  fontSize: '0.85rem',
};

const OptimizationSection = ({dataOptimized, dataForecasted, selectedUser}) => {
    const series = useMemo(() => {
        if (!Array.isArray(dataOptimized) || !Array.isArray(dataForecasted)) return null;

        const n = Math.min(dataOptimized.length, dataForecasted.length);
        if (n === 0) return null;

        const timestamps = [];
        const tinOpt = [];
        const tinFc = [];
        const rhOpt = [];
        const rhFc = [];
        const comfortOpt = [];
        const comfortFc = [];

        for (let i = 0; i < n; i++) {
            const o = dataOptimized[i];
            const f = dataForecasted[i];

            timestamps.push(o.timestamp); // IMPORTANT: keep raw timestamp

            tinOpt.push(o.tin);
            tinFc.push(f.tin_pred);

            rhOpt.push(o.rh);
            rhFc.push(f.rh_pred);

            comfortOpt.push(o.comfort_index);
            comfortFc.push(f.comfort_index);
        }

        const result = {
            timestamps,
            tinOpt,
            tinFc,
            rhOpt,
            rhFc,
            comfortOpt,
            comfortFc
        };
        return result;
    }, [dataOptimized, dataForecasted]);

    if (!series) return null;

  return (
    <>
      {/* Main Comfort Optimization Chart */}
      <Grid item xs={12}>
        <Paper sx={{ ...cardStyle, minHeight: '400px', mt: 2 }}>
          <Box sx={{ mb: 2, flexShrink: 0 }}>
            <Typography variant="h6" sx={titleStyle}>
              Comfort Optimization
            </Typography>
            <Typography variant="body2" sx={subtitleStyle}>
              Comprehensive comfort metrics analysis and optimization
            </Typography>
          </Box>

          <Box sx={{ flexGrow: 1 }}>
            <ComfortMetricsChart 
                title="Comfort Optimization"  
                categories={series.timestamps}
                optimized={series.comfortOpt}
                forecast={series.comfortFc} 
                selectedUser={selectedUser}
            />
          </Box>
        </Paper>
      </Grid>

      {/* Temperature Optimization Chart */}
      <Grid item xs={12} md={6}>
        <Paper sx={{ ...cardStyle, mt: 2 }}>
          <Box sx={{ mb: 2, flexShrink: 0 }}>
            <Typography variant="h6" sx={{ ...titleStyle, fontSize: '1rem' }}>
              Temperature Optimization
            </Typography>
            <Typography variant="body2" sx={{ ...subtitleStyle, fontSize: '0.8rem' }}>
              Temperature control analysis and recommendations
            </Typography>
          </Box>

          <Box sx={{ flexGrow: 1 }}>
            <TemperatureChart 
                title="Temperature Optimization"
                categories={series.timestamps}
                optimized={series.tinOpt}
                forecast={series.tinFc} 
                selectedUser={selectedUser}
            />
          </Box>
        </Paper>
      </Grid>

      {/* Humidity Optimization Chart */}
      <Grid item xs={12} md={6}>
        <Paper sx={{ ...cardStyle, mt: 2 }}>
          <Box sx={{ mb: 2, flexShrink: 0 }}>
            <Typography variant="h6" sx={{ ...titleStyle, fontSize: '1rem' }}>
              Humidity Optimization
            </Typography>
            <Typography variant="body2" sx={{ ...subtitleStyle, fontSize: '0.8rem' }}>
              Humidity control analysis and recommendations
            </Typography>
          </Box>

          <Box sx={{ flexGrow: 1 }}>
            <HumidityChart 
                title="Humidity Optimization"   
                categories={series.timestamps}
                optimized={series.rhOpt}
                forecast={series.rhFc}
                selectedUser={selectedUser}
            />
          </Box>
        </Paper>
      </Grid>
    </>
  );
};

export default OptimizationSection;
