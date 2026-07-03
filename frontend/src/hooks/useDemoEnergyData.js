import { useState, useEffect } from 'react';

const PRODUCTION_HISTORICAL_SCALE = 1.5;
const PRODUCTION_FORECAST_SCALE = 1;
const PV_PRODUCTION_MULTIPLIER = 1;

const DEMO_CSV = {
  productionHistorical: '/data/demo/pv_production.csv',
  productionForecast: '/data/demo/pv_production_fc.csv',
  consumptionHistorical: '/data/demo/consumption.csv',
  consumptionForecast: '/data/demo/consumption_fc.csv',
};

const loadDemoCsv = async (csvPath) => {
  const response = await fetch(csvPath);
  if (!response.ok) throw new Error(`Failed to load ${csvPath}: ${response.statusText}`);
  const text = await response.text();
  const today = new Date().toISOString().split('T')[0];
  return text.trim().split('\n').slice(1).map(line => {
    const [tsStr, valStr] = line.split(',');
    const timePart = (tsStr || '').trim().split(' ')[1];
    const value = parseFloat((valStr || '').trim());
    if (!timePart || isNaN(value)) return null;
    return { timestamp: `${today}T${timePart}`, value };
  }).filter(Boolean);
};

const toSeries = (dataArray) =>
  dataArray.map(p => [new Date(p.timestamp).getTime(), p.value]).sort((a, b) => a[0] - b[0]);

const buildChartData = (historicalData, forecastData) => {
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000;

  const histConsumption = toSeries(historicalData.consumption);
  const histProduction = toSeries(historicalData.production);
  const fcConsumption = toSeries(forecastData.consumption);
  const fcProduction = toSeries(forecastData.production);

  const consumptionColor = '#1E90FF';
  const productionColor = '#FF8C00';
  const communityColor = '#32CD32';

  return {
    consumptionData: [
      { name: 'Historical Consumption', data: histConsumption, color: consumptionColor, zIndex: 3, type: 'area', fillOpacity: 0.4 },
      { name: 'Forecast Consumption', data: fcConsumption, color: consumptionColor, zIndex: 1, type: 'area', fillOpacity: 0.2, dashStyle: 'dash' },
      { name: 'Historical Energy Community Consumption', data: histConsumption.map(p => [p[0], p[1] * 0.2]), color: communityColor, zIndex: 4, type: 'area', fillOpacity: 0.3 },
      { name: 'Forecast Energy Community Consumption', data: fcConsumption.map(p => [p[0], p[1] * 0.2]), color: communityColor, zIndex: 2, type: 'area', fillOpacity: 0.15, dashStyle: 'dash' },
    ],
    productionData: [
      { name: 'Historical Production', data: histProduction, color: productionColor, zIndex: 2, type: 'area', fillOpacity: 0.4 },
      { name: 'Forecast Production', data: fcProduction, color: productionColor, zIndex: 0, type: 'area', fillOpacity: 0.2, dashStyle: 'dash' },
    ],
    startOfDay,
    endOfDay,
    cutoffTimestamp: today.getTime(),
    hasData: histConsumption.length > 0 || fcConsumption.length > 0,
  };
};

export const useDemoEnergyData = () => {
  const [historicalData, setHistoricalData] = useState({ consumption: [], production: [] });
  const [forecastData, setForecastData] = useState({ consumption: [], production: [] });
  const [chartData, setChartData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [prodHist, prodFc, consHist, consFc] = await Promise.all([
          loadDemoCsv(DEMO_CSV.productionHistorical),
          loadDemoCsv(DEMO_CSV.productionForecast),
          loadDemoCsv(DEMO_CSV.consumptionHistorical),
          loadDemoCsv(DEMO_CSV.consumptionForecast),
        ]);
        if (cancelled) return;

        const historical = {
          production: prodHist.map(p => ({ ...p, value: p.value * PRODUCTION_HISTORICAL_SCALE })),
          consumption: consHist,
        };
        const forecast = {
          production: prodFc.map(p => ({ ...p, value: p.value * PRODUCTION_FORECAST_SCALE * PV_PRODUCTION_MULTIPLIER })),
          consumption: consFc,
        };

        setHistoricalData(historical);
        setForecastData(forecast);
        setChartData(buildChartData(historical, forecast));
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  return {
    chartData,
    historicalData,
    forecastData,
    loading,
    error,
    refetch: () => {},
    refetchHistorical: () => {},
    refetchForecast: () => {},
  };
};
