import React, { useState, useEffect, useRef } from 'react';
import { Grid, Paper, Typography, Box } from '@mui/material';
import CombinedEnergyChart from '../components/CommunityDashboard/CombinedEnergyChart';

const AnimatedChart = () => {
    const [currentTime, setCurrentTime] = useState(null);
    const [csvData, setCsvData] = useState(null);
    const [loading, setLoading] = useState(true);

    // Load CSV data from the generated subfolder
    const loadCsvData = async () => {
        try {
            setLoading(true);

            // Define file paths in the generated subfolder
            const filePaths = {
                // Historical data (plain files)
                pvHistorical: '/data/animated-chart/pv_park.csv',
                communityHistorical: '/data/animated-chart/community_consumption.csv',
                islandHistorical: '/data/animated-chart/island_consumption.csv',

                // Forecast data (_fc files)
                pvForecast: '/data/animated-chart/pv_park_fc.csv',
                communityForecast: '/data/animated-chart/community_consumption_fc.csv',
                islandForecast: '/data/animated-chart/island_consumption_fc.csv'
            };

            // Load all CSV files with individual error checking
            const responses = await Promise.all([
                fetch(filePaths.pvHistorical),
                fetch(filePaths.communityHistorical),
                fetch(filePaths.islandHistorical),
                fetch(filePaths.pvForecast),
                fetch(filePaths.communityForecast),
                fetch(filePaths.islandForecast)
            ]);

            // Check if all responses are OK
            responses.forEach((response, index) => {
                const fileNames = [
                    'pvHistorical', 'communityHistorical', 'islandHistorical',
                    'pvForecast', 'communityForecast', 'islandForecast'
                ];
                if (!response.ok) {
                    throw new Error(`Failed to load ${fileNames[index]}: ${response.statusText}`);
                }
            });

            // Convert responses to text
            const csvTexts = await Promise.all(responses.map(response => response.text()));

            // Parse CSV data
            const parseCSV = (csvText) => {
                const lines = csvText.trim().split('\n');
                const dataLines = lines.slice(1); // Skip header

                return dataLines
                    .map(line => {
                        const [timestampStr, valueStr] = line.split(',');
                        const timestamp = new Date(timestampStr.trim()).getTime();
                        const value = parseFloat(valueStr.trim());

                        if (isNaN(timestamp) || isNaN(value)) return null;
                        return [timestamp, value];
                    })
                    .filter(entry => entry !== null)
                    .sort((a, b) => a[0] - b[0]);
            };

            // Parse all CSV data
            const [
                pvHistoricalData,
                communityHistoricalData,
                islandHistoricalData,
                pvForecastData,
                communityForecastData,
                islandForecastData
            ] = csvTexts.map(parseCSV);

            // Get time boundaries from all data
            const allTimestamps = [
                ...pvHistoricalData.map(d => d[0]),
                ...communityHistoricalData.map(d => d[0]),
                ...islandHistoricalData.map(d => d[0]),
                ...pvForecastData.map(d => d[0]),
                ...communityForecastData.map(d => d[0]),
                ...islandForecastData.map(d => d[0])
            ];

            const minTimestamp = Math.min(...allTimestamps);
            const maxTimestamp = Math.max(...allTimestamps);

            // Set start of day and end of day
            const startOfDay = new Date(minTimestamp);
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date(maxTimestamp);
            endOfDay.setHours(24, 0, 0, 0);

            const dataStructure = {
                historical: {
                    pv: pvHistoricalData,
                    community: communityHistoricalData,
                    island: islandHistoricalData
                },
                forecast: {
                    pv: pvForecastData,
                    community: communityForecastData,
                    island: islandForecastData
                },
                startOfDay: startOfDay.getTime(),
                endOfDay: endOfDay.getTime(),
                minTimestamp,
                maxTimestamp
            };

            console.log('CSV data loaded:', dataStructure);
            console.log('Historical PV length:', pvHistoricalData.length);
            console.log('Forecast PV length:', pvForecastData.length);

            setCsvData(dataStructure);

            // Start animation from beginning of day (00:00)
            const startTime = new Date(minTimestamp);
            startTime.setHours(0, 0, 0, 0);
            setCurrentTime(startTime.getTime());
            setLoading(false);

        } catch (error) {
            console.error('Error loading CSV data:', error);
            console.error('Error details:', error.message);
            setLoading(false);
        }
    };

    // Load data on component mount
    useEffect(() => {
        loadCsvData();
    }, []);

    // Generate chart data based on current time
    const generateChartData = () => {
        if (!csvData ||
            currentTime === null ||
            !csvData.historical ||
            !csvData.forecast ||
            !csvData.historical.pv ||
            !csvData.forecast.pv) {
            return null;
        }

        // For historical data: only show data up to current time
        const currentPv = csvData.historical.pv.filter(([timestamp]) => timestamp <= currentTime);
        const currentCommunity = csvData.historical.community.filter(([timestamp]) => timestamp <= currentTime);
        const currentIsland = csvData.historical.island.filter(([timestamp]) => timestamp <= currentTime);

        // For forecast data: show all data (static forecast)
        // Reduce PV forecast by 30%
        const forecastPv = csvData.forecast.pv.map(([timestamp, value]) => [timestamp, value * 0.45]);
        const forecastCommunity = csvData.forecast.community;
        const forecastIsland = csvData.forecast.island;

        // Production data (PV only) - Orange colors
        const productionData = [
            {
                name: 'PV Production',
                data: currentPv,
                type: 'area',
                color: '#FF8C00', // Dark Orange
                fillOpacity: 0.5,
                showInLegend: true,
                visible: true
            },
            {
                name: 'PV Forecast',
                data: forecastPv,
                type: 'area',
                color: '#FFA500', // Orange
                fillOpacity: 0.3,
                dashStyle: 'Dash',
                showInLegend: true,
                visible: true
            }
        ];

        // Consumption data (Community + Island)
        const consumptionData = [
            {
                name: 'Island Consumption',
                data: currentIsland,
                type: 'area',
                color: '#1E90FF', // Dodger Blue
                fillOpacity: 0.5,
                showInLegend: true,
                visible: true
            },
            {
                name: 'Island Forecast',
                data: forecastIsland,
                type: 'area',
                color: '#87CEEB', // Sky Blue
                fillOpacity: 0.3,
                dashStyle: 'Dash',
                showInLegend: true,
                visible: true
            },
            {
                name: 'Community Consumption',
                data: currentCommunity,
                type: 'area',
                color: '#32CD32', // Lime Green
                fillOpacity: 0.5,
                showInLegend: true,
                visible: true
            },
            {
                name: 'Community Forecast',
                data: forecastCommunity,
                type: 'area',
                color: '#90EE90', // Light Green
                fillOpacity: 0.3,
                dashStyle: 'Dash',
                showInLegend: true,
                visible: true
            }
        ];

        // Calculate dynamic Y-axis maximum based on data
        const allDataValues = [
            ...currentPv.map(d => d[1]),
            ...forecastPv.map(d => d[1]),
            ...currentCommunity.map(d => d[1]),
            ...forecastCommunity.map(d => d[1]),
            ...currentIsland.map(d => d[1]),
            ...forecastIsland.map(d => d[1])
        ];

        const maxValue = Math.max(...allDataValues);
        const yAxisMax = Math.ceil(maxValue * 1.1 / 10) * 10; // Add 10% buffer and round to nearest 10

        return {
            productionData,
            consumptionData,
            startOfDay: csvData.startOfDay,
            endOfDay: csvData.endOfDay,
            yAxisMax
        };
    };

    // Update the current time every second to animate the time column
    useEffect(() => {
        if (!csvData || currentTime === null) return;

        const interval = setInterval(() => {
            setCurrentTime(prevTime => {
                // Move forward by 15 minutes each second
                const fifteenMinutes = 15 * 60 * 1000;
                const newTime = prevTime + fifteenMinutes;

                // Reset to start (00:00) if we've reached the end
                if (newTime > csvData.maxTimestamp) {
                    const resetTime = new Date(csvData.minTimestamp);
                    resetTime.setHours(0, 0, 0, 0);
                    return resetTime.getTime();
                }

                return newTime;
            });
        }, 1000); // Update every second

        return () => clearInterval(interval);
    }, [csvData, currentTime]);

    const chartData = generateChartData();

    if (loading) {
        return (
            <Box sx={{
                height: '100vh',
                width: '100vw',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: '#f5f5f5'
            }}>
                <Typography variant="h6" color="textSecondary">
                    Loading Generated CSV data...
                </Typography>
            </Box>
        );
    }

    if (!chartData) {
        return (
            <Box sx={{
                height: '100vh',
                width: '100vw',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: '#f5f5f5'
            }}>
                <Typography variant="h6" color="error">
                    Error loading chart data
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{
            height: '100vh',
            width: '100vw',
            padding: 3,
            backgroundColor: '#f5f5f5',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center'
        }}>
            <Grid container justifyContent="center" sx={{ maxWidth: 1200, width: '100%' }}>
                <Grid item xs={12}>
                    <Paper className="dashboard-large-card-hover" sx={{
                        p: 2,
                        height: '500px',
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
                                Energy Data for 11/09/2025
                            </Typography>
                            <Typography variant="body2" sx={{
                                color: '#64748b',
                                fontSize: '0.85rem'
                            }}>
                                Live Energy Production & Consumption
                            </Typography>
                            <Typography variant="caption" sx={{
                                color: '#94a3b8',
                                fontSize: '0.75rem',
                                mt: 0.5,
                                display: 'block'
                            }}>
                                Current Time: {currentTime ? new Date(currentTime).toLocaleTimeString() : 'Loading...'}
                            </Typography>
                        </Box>

                        {/* Chart */}
                        <Box sx={{ flexGrow: 1, width: '100%', height: 'calc(100% - 120px)' }}>
                            <CombinedEnergyChart
                                productionData={chartData.productionData}
                                consumptionData={chartData.consumptionData}
                                startOfDay={chartData.startOfDay}
                                endOfDay={chartData.endOfDay}
                                cutoffTimestamp={currentTime}
                                yAxisMax={chartData.yAxisMax}
                            />
                        </Box>
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default AnimatedChart;