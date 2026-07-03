import React, { useState, useEffect, useMemo } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { Box, Alert, CircularProgress } from '@mui/material';

const HumidityChart = ({ title = 'Humidity Optimization', categories, optimized, forecast, selectedUser }) => {
    const [humidityWithoutData, setHumidityWithoutData] = useState([]);
    const [humidityWithData, setHumidityWithData] = useState([]);
    const [error, setError] = useState(null);
    // const useRealData = selectedUser?.username !== 'Town Hall' && selectedUser?.username !== 'Osmosis Plant';
    const [mockWithout, setMockWithout] = useState([]);
    const [mockWith, setMockWith] = useState([]);

    const parseLocalISOToMs = (iso) => {
        const clean = iso.replace(/([+-]\d{2}:\d{2}|Z)$/, '');
        const [datePart, timePart = "00:00:00"] = clean.split("T");
        const [y, m, d] = datePart.split("-").map(Number);
        const [hh, mm, ss = "0"] = timePart.split(":");
        return new Date(y, m - 1, d, Number(hh), Number(mm), Number(ss)).getTime();
    }

    useEffect(() => {
        const fetchOptimizationData = async () => {
            try {
                const response = await fetch('/data/self-consumption/temp-humidity-optimization.json');
                if (!response.ok) {
                    throw new Error('Failed to fetch humidity optimization data');
                }
                const data = await response.json();

                const humidityWithoutSuggestionsData = data.climate_optimization.map(point => [
                    new Date(point.timestamp).getTime(),
                    point.humidity_without_suggestions
                ]);

                const humidityWithSuggestionsData = data.climate_optimization.map(point => [
                    new Date(point.timestamp).getTime(),
                    point.humidity_with_suggestions
                ]);

                setHumidityWithoutData(humidityWithoutSuggestionsData);
                setHumidityWithData(humidityWithSuggestionsData);
            } catch (err) {
                setError(err.message);
            }
        };

        fetchOptimizationData();
    }, []);

    const seriesData = useMemo(() => {
     
        if (!categories || !optimized || !forecast) return null;
        const timestamps = categories.map(parseLocalISOToMs);

        const n = Math.min(timestamps.length, optimized.length, forecast.length);

        return {
            without: Array.from({ length: n }, (_, i) => [timestamps[i], forecast[i]]),
            with: Array.from({ length: n }, (_, i) => [timestamps[i], optimized[i]])
        };
        
        return {
            without: mockWithout,
            with: mockWith
        };
    }, [categories, optimized, forecast, mockWithout, mockWith]);
    const loading = !seriesData;

    if (loading) {
        return (
        <Box display="flex" justifyContent="center" alignItems="center" sx={{ height: '400px' }}>
            <CircularProgress />
        </Box>
        );
    }

    if (error) {
        return (
        <Box display="flex" justifyContent="center" alignItems="center" sx={{ height: '400px' }}>
            <Alert severity="error" sx={{ width: '100%' }}>
            Error loading comfort metrics: {error}
            </Alert>
        </Box>
        );
    }
    if (!seriesData) return null;

    const chartOptions = {
        time: {
            useUTC: false
        },
        chart: {
            type: 'line',
            height: 450,
            style: {
                fontFamily: 'Inter, sans-serif'
            }
        },
        title: {
            text: title,
            style: {
                fontSize: '16px',
                fontWeight: 'bold',
                color: '#64748b'
            }
        },
        xAxis: {
            type: 'datetime',
            labels: {
                format: '{value:%H:%M}',
                style: {
                    color: '#64748b'
                }
            },
            title: {
                text: 'Time of Day',
                style: {
                    color: '#64748b'
                }
            }
        },
        yAxis: {
            title: {
                text: 'Humidity (%)',
                style: {
                    color: '#64748b'
                }
            },
            labels: {
                style: {
                    color: '#64748b'
                }
            },
            min: 35,
            max: 85,
            plotBands: [{
                from: 40,
                to: 70,
                color: 'rgba(34, 197, 94, 0.1)',
                label: {
                    text: 'Optimal',
                    align: 'center',
                    style: {
                        color: '#64748b',
                        fontWeight: 'bold'
                    }
                }
            }]
        },
        plotOptions: {
            line: {
                marker: {
                    enabled: true,
                    radius: 3,
                    symbol: 'circle'
                },
                lineWidth: 2
            },
            series: {
                animation: false
            }
        },
        tooltip: {
            shared: true,
            crosshairs: true,
            valueDecimals: 1,
            formatter: function () {
                const timeLabel = new Date(this.x).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit'
                });

                let s = `<b>Time:</b> ${timeLabel}<br/>`;
                this.points.forEach(point => {
                    s += `<span style="color:${point.color}">●</span> ${point.series.name}: <b>${point.y.toFixed(1)}%</b><br/>`;
                });
                return s;
            }
        },
        legend: {
            enabled: true,
            align: 'center',
            verticalAlign: 'bottom',
            layout: 'horizontal',
            x: 0,
            y: 0
        },
        series: [
            {
                name: 'Humidity without Suggestions',
                data: seriesData.without,
                color: '#CBD5E1',
                dashStyle: 'solid'
            },
            {
                name: 'Humidity with Suggestions',
                data: seriesData.with,
                color: '#0E7490',
                dashStyle: 'dash'
        }],
        credits: {
            enabled: false
        }
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" sx={{ height: '450px' }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" sx={{ height: '450px' }}>
                <Alert severity="error" sx={{ width: '100%' }}>
                    Error loading humidity data: {error}
                </Alert>
            </Box>
        );
    }

    return (
        <div style={{ width: '100%', height: '100%' }}>
            <HighchartsReact
                highcharts={Highcharts}
                options={chartOptions}
                containerProps={{ style: { height: '100%' } }}
            />
        </div>
    );
};

export default HumidityChart;