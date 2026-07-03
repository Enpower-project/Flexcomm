import React from 'react';
import Highcharts from 'highcharts';
import HighchartsMore from 'highcharts/highcharts-more';
import SolidGauge from 'highcharts/modules/solid-gauge';
import { useKeycloak } from '@react-keycloak/web';

import { useEnergyData } from '../hooks/useEnergyData';
import { useDemoEnergyData } from '../hooks/useDemoEnergyData';
import { useEnvironmentalImpact } from '../hooks/useEnvironmentalImpact';
import { useWeatherData } from '../hooks/useWeatherData';

import DashboardLayout from '../components/CommunityDashboard/DashboardLayout';
import EnergyChartSection from '../components/CommunityDashboard/sections/EnergyChartSection';
import GaugeSection from '../components/CommunityDashboard/sections/GaugeSection';
import InfoCardsSection from '../components/CommunityDashboard/sections/InfoCardsSection';
import RecommendationsSection from '../components/CommunityDashboard/sections/RecommendationsSection';

HighchartsMore(Highcharts);
SolidGauge(Highcharts);

const DEMO_USERNAME = 'demo_pilot';

const DEMO_WEATHER_FALLBACK = {
  temperature_celsius: 32,
  humidity_percent: 55,
  wind_speed_kmh: 12,
  solar_radiation_ghi_instant: 750,
};


const DashboardContent = ({ energyData, impactData, impactLoading, impactError, currentWeatherData, weatherLoading, weatherError }) => (
  <DashboardLayout>
    <EnergyChartSection {...energyData} />
    <GaugeSection {...energyData} />
    <InfoCardsSection
      currentWeatherData={currentWeatherData}
      weatherLoading={weatherLoading}
      weatherError={weatherError}
      impactData={impactData}
      impactLoading={impactLoading}
      impactError={impactError}
    />
    <RecommendationsSection {...energyData} />
  </DashboardLayout>
);

const LiveDashboard = () => {
  const energyData = useEnergyData();
  const { impactData, impactLoading, impactError } = useEnvironmentalImpact();
  const { currentWeatherData, weatherLoading, weatherError } = useWeatherData();
  return (
    <DashboardContent
      energyData={energyData}
      impactData={impactData} impactLoading={impactLoading} impactError={impactError}
      currentWeatherData={currentWeatherData} weatherLoading={weatherLoading} weatherError={weatherError}
    />
  );
};

const DemoDashboard = () => {
  const energyData = useDemoEnergyData();
  const { impactData, impactLoading, impactError } = useEnvironmentalImpact();
  const { currentWeatherData, weatherLoading, weatherError } = useWeatherData();
  const weatherData = !weatherLoading && !currentWeatherData ? DEMO_WEATHER_FALLBACK : currentWeatherData;
  return (
    <DashboardContent
      energyData={energyData}
      impactData={impactData} impactLoading={impactLoading} impactError={impactError}
      currentWeatherData={weatherData} weatherLoading={weatherLoading} weatherError={null}
    />
  );
};

const CommunityDashboard = () => {
  const { keycloak } = useKeycloak();
  const isDemo = keycloak.tokenParsed?.preferred_username === DEMO_USERNAME;
  return isDemo ? <DemoDashboard /> : <LiveDashboard />;
};

export default CommunityDashboard;
