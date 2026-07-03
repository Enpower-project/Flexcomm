import React, { useMemo } from 'react';
import { Grid, Paper } from '@mui/material';
import DashboardGauge from '../DashboardGauge';

const GaugeSection = ({
  chartData,
  historicalData,
  forecastData,
  loading,
  error
}) => {
  // Calculate gauge data from energy data
  const gaugeData = useMemo(() => {
    if (!chartData || !historicalData || !forecastData) {
      return {
        cumulativeConsumption: 0,
        totalForecastConsumption: 1,
        cumulativeProduction: 0,
        totalForecastProduction: 1
      };
    }

    // Calculate cumulative consumption and production from historical data up to cutoff
    const calculateCumulative = (dataArray, cutoffTimestamp) => {
      return dataArray
        .filter(point => {
          const timestamp = new Date(point.timestamp).getTime();
          return timestamp <= cutoffTimestamp;
        })
        .reduce((sum, point) => sum + (point.value || point.energy || 0), 0);
    };

    // Calculate total forecast for the entire day
    const calculateTotal = (dataArray) => {
      return dataArray.reduce((sum, point) => sum + (point.value || point.energy || 0), 0);
    };

    const cutoffTimestamp = chartData.cutoffTimestamp || Date.now();

    // Calculate PV Energy Wasted (excess production that couldn't be consumed)
    const calculatePVWasted = () => {
      const consumptionMap = new Map();
      historicalData.consumption.forEach(point => {
        const timestamp = new Date(point.timestamp).getTime();
        if (timestamp <= cutoffTimestamp) {
          consumptionMap.set(timestamp, point.value || point.energy || 0);
        }
      });

      let totalWasted = 0;
      historicalData.production.forEach(point => {
        const timestamp = new Date(point.timestamp).getTime();
        if (timestamp <= cutoffTimestamp) {
          const production = point.energy || point.value || 0;
          const consumption = consumptionMap.get(timestamp) || 0;
          const wasted = Math.max(0, production - consumption);
          totalWasted += wasted;
        }
      });

      return totalWasted;
    };

    // Calculate Grid Energy Imported (energy drawn from grid when production insufficient)
    const calculateGridImported = () => {
      const productionMap = new Map();
      historicalData.production.forEach(point => {
        const timestamp = new Date(point.timestamp).getTime();
        if (timestamp <= cutoffTimestamp) {
          productionMap.set(timestamp, point.energy || point.value || 0);
        }
      });

      let totalImported = 0;
      historicalData.consumption.forEach(point => {
        const timestamp = new Date(point.timestamp).getTime();
        if (timestamp <= cutoffTimestamp) {
          const consumption = point.value || point.energy || 0;
          const production = productionMap.get(timestamp) || 0;
          const imported = Math.max(0, consumption - production);
          totalImported += imported;
        }
      });

      return totalImported;
    };

    // Calculate Energy Independence Score (net energy balance for historical data only)
    const calculateEnergyIndependence = () => {
      const totalHistoricalProduction = calculateCumulative(historicalData.production, cutoffTimestamp);
      const totalHistoricalConsumption = calculateCumulative(historicalData.consumption, cutoffTimestamp);

      return totalHistoricalProduction - totalHistoricalConsumption; // Positive = surplus, Negative = deficit
    };

    return {
      cumulativeConsumption: calculateCumulative(historicalData.consumption, cutoffTimestamp),
      totalForecastConsumption: Math.max(1, calculateTotal(forecastData.consumption)),
      cumulativeProduction: calculateCumulative(historicalData.production, cutoffTimestamp),
      totalForecastProduction: Math.max(1, calculateTotal(forecastData.production)),
      pvEnergyWasted: calculatePVWasted(),
      gridEnergyImported: calculateGridImported(),
      energyIndependenceScore: calculateEnergyIndependence()
    };
  }, [chartData, historicalData, forecastData]);

  // Prepare actual data for SCR calculation
  const actualData = useMemo(() => {
    if (!historicalData) {
      return { consumption: [], production: [] };
    }

    // Map the data to the format expected by DashboardGauge
    // Production data expects: {timestamp, energy}
    // Consumption data expects: {timestamp, value}
    const consumption = (historicalData.consumption || []).map(point => ({
      timestamp: point.timestamp,
      value: point.value || point.energy || 0
    }));

    const production = (historicalData.production || []).map(point => ({
      timestamp: point.timestamp,
      energy: point.energy || point.value || 0
    }));

    console.log('🔧 SCR data mapping - consumption sample:', consumption.slice(0, 2));
    console.log('🔧 SCR data mapping - production sample:', production.slice(0, 2));

    return {
      consumption,
      production
    };
  }, [historicalData]);

  return (
    <>
      {/* Gauges */}
      {/* <Grid item xs={12} md={4}>
        <Paper sx={{ p: 1, height: '200px' }}>
          <DashboardGauge
            type="consumption"
            title="Daily Consumption Progress"
            currentValueKWh={gaugeData.cumulativeConsumption}
            maxValueKWh={gaugeData.totalForecastConsumption}
          />
        </Paper>
      </Grid>

      <Grid item xs={12} md={4}>
        <Paper sx={{ p: 1, height: '200px' }}>
          <DashboardGauge
            type="production"
            title="Daily Production Progress"
            currentValueKWh={gaugeData.cumulativeProduction}
            maxValueKWh={gaugeData.totalForecastProduction}
          />
        </Paper>
      </Grid> */}

      <Grid item xs={12} md={3}>
        <Paper className="dashboard-card-hover" sx={{
          p: 1,
          height: '200px',
          background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
        }}>
          <DashboardGauge
            type="pv_wasted"
            title="PV Energy Wasted Today"
            wastedEnergyKWh={gaugeData.pvEnergyWasted}
          />
        </Paper>
      </Grid>

      <Grid item xs={12} md={3}>
        <Paper className="dashboard-card-hover" sx={{
          p: 1,
          height: '200px',
          background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
        }}>
          <DashboardGauge
            type="grid_imported"
            title="Grid Energy Imported Today"
            gridImportedKWh={gaugeData.gridEnergyImported}
          />
        </Paper>
      </Grid>

      <Grid item xs={12} md={3}>
        <Paper className="dashboard-card-hover" sx={{
          p: 1,
          height: '200px',
          background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
        }}>
          <DashboardGauge
            type="energy_independence"
            title="Net Energy Balance Today"
            independenceScoreKWh={gaugeData.energyIndependenceScore}
          />
        </Paper>
      </Grid>

      <Grid item xs={12} md={3}>
        <Paper className="dashboard-card-hover" sx={{
          p: 1,
          height: '200px',
          background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
        }}>
          <DashboardGauge
            type="scr"
            title="Current Self-Consumption Rate"
            consumptionActualsKWh={actualData.consumption}
            productionActualsKWh={actualData.production}
            startOfDayTs={chartData?.startOfDay}
            cutoffTs={chartData?.cutoffTimestamp}
          />
        </Paper>
      </Grid>
    </>
  );
};

export default GaugeSection;