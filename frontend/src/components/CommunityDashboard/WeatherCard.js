// src/components/CommunityDashboard/WeatherCard.js
import React from 'react';
import { Card, Typography, Box, Grid } from '@mui/material';
// Consider using more specific icons if available/desired
import { Sun, Droplets, Wind, Thermometer } from 'lucide-react';

const WeatherCard = ({ weatherData }) => {
    if (!weatherData) {
        return null;
    }

    // Map API keys to display metrics
    const metrics = [
        {
            title: 'Temperature',
            value: `${weatherData.temperature_celsius?.toFixed(1) ?? 'N/A'} °C`,
            icon: <Thermometer />,
            color: '#FFB900' // yellow
        },
        {
            title: 'Humidity',
            value: `${weatherData.humidity_percent?.toFixed(0) ?? 'N/A'} %`,
            icon: <Droplets />,
            color: '#3B82F6' // blue
        },
        {
            title: 'Wind Speed',
            value: `${weatherData.wind_speed_kmh?.toFixed(1) ?? 'N/A'} km/h`,
            icon: <Wind />,
            color: '#6B7280' // gray
        },
        {
            title: 'Solar Radiation',
            value: `${weatherData.solar_radiation_ghi_instant?.toFixed(0) ?? 'N/A'} W/m²`,
            icon: <Sun />,
            color: '#F97316' // orange
        }
    ];

    return (
        <Grid container spacing={1}>
            {metrics.map((metric, index) => (
                <Grid item xs={3} key={index}>
                    <Card
                        sx={{
                            display: 'flex',
                            boxShadow: 0,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 2,
                            height: '100px', // Ensure consistent height
                            flexDirection: 'row', // Ensure items are side-by-side
                        }}
                    >
                        <Box
                            sx={{
                                flex: 3,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                                alignItems: 'flex-start', // Align text left
                                padding: 1,
                                pl: 1.5, // Add a bit more left padding
                                overflow: 'hidden', // Prevent text overflow issues
                            }}
                        >
                            <Typography
                                variant="caption" // Smaller title
                                fontWeight="bold"
                                noWrap // Prevent wrapping if too long
                                sx={{ fontSize: '1rem' }}
                            >
                                {metric.title}
                            </Typography>
                            <Typography
                                variant="h6"
                                color="textPrimary"
                                fontWeight="medium"
                                noWrap
                                sx={{ fontSize: '1.3rem' }}
                            >
                                {metric.value}
                            </Typography>
                        </Box>
                        <Box
                            sx={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: 'action.hover', // Subtle background
                                borderTopRightRadius: (theme) => theme.shape.borderRadius * 2, // Match card radius
                                borderBottomRightRadius: (theme) => theme.shape.borderRadius * 2,
                            }}
                        >
                            {React.cloneElement(metric.icon, {
                                size: 20, // Slightly smaller icon
                                color: metric.color
                            })}
                        </Box>
                    </Card>
                </Grid>
            ))}
        </Grid>
    );
};

export default WeatherCard;