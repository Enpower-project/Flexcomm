import React, { useState, useEffect, useMemo } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { Box, Alert, CircularProgress } from '@mui/material';

const ComfortMetricsChart = ({ title = 'Projected Daily Comfort Forecast', categories, optimized, forecast, selectedUser }) => {
    const [withoutSuggestionsData, setWithoutSuggestionsData] = useState([]);
    const [withSuggestionsData, setWithSuggestionsData] = useState([]);
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
            height: 400,
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
                text: 'Comfort Index (%)',
                style: {
                    color: '#64748b'
                }
            },
            min: 70,
            max: 100,
            labels: {
                style: {
                    color: '#64748b'
                }
            },
            plotLines: [{
                color: '#e96262d5',
                width: 4,
                value: 80,
                dashStyle: 'dash',
                label: {
                    text: 'Low Comfort Threshold',
                    align: 'right',
                    style: {
                        color: '#f86060',
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
            valueSuffix: '%',
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
        series: [{
            name: 'Comfort Index without Suggestions',
            data: seriesData.without,
            color: '#CBD5E1',
            dashStyle: 'solid'
        }, {
            name: 'Comfort Index with Suggestions',
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

export default ComfortMetricsChart;