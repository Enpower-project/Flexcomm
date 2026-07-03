// CombinedEnergyChart.js
import React from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';



const CombinedEnergyChart = ({
    productionData,  // Expects array: [ { name: 'Actual...', data: [...] }, { name: 'Forecast...', data: [...] } ]
    consumptionData, // Expects array: [ { name: 'Actual...', data: [...] }, { name: 'Forecast...', data: [...] } ]
    startOfDay,      // Timestamp for 00:00 of the current day
    endOfDay,        // Timestamp for 24:00 (start of next day)
    cutoffTimestamp, // Optional cutoff timestamp for filtering data
    yAxisMax         // Optional max value for Y-axis
}) => {

    // Ensure we have valid arrays
    const validProductionData = Array.isArray(productionData) ? productionData : [];
    const validConsumptionData = Array.isArray(consumptionData) ? consumptionData : [];

    // Filter data to create a 15-minute gap after the cutoff timestamp
    const filterDataWithGap = (seriesArray) => {
        if (!cutoffTimestamp) return seriesArray;

        const GAP_DURATION = 15 * 60 * 1000; // 15 minutes in milliseconds
        const historicalEndTime = cutoffTimestamp;
        const forecastStartTime = cutoffTimestamp + GAP_DURATION;

        return seriesArray.map(series => {
            if (series.name && series.name.includes('Forecast')) {
                // Filter forecast data to start after the gap
                const filteredData = series.data.filter(point => {
                    return point[0] >= forecastStartTime;
                });
                return {
                    ...series,
                    data: filteredData
                };
            } else if (series.name && series.name.includes('Historical')) {
                // Filter historical data to end before the gap
                const filteredData = series.data.filter(point => {
                    return point[0] <= historicalEndTime;
                });
                return {
                    ...series,
                    data: filteredData
                };
            }
            return series;
        });
    };

    // Apply filtering to both production and consumption data
    const filteredProductionData = filterDataWithGap(validProductionData);
    const filteredConsumptionData = filterDataWithGap(validConsumptionData);

    // Combine all series data
    const combinedSeries = [
        ...filteredProductionData,
        ...filteredConsumptionData
    ];

    // If no data, return a placeholder
    if (combinedSeries.length === 0 || combinedSeries.every(series => !series.data || series.data.length === 0)) {
        return (
            <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                color: '#666',
                fontSize: '14px'
            }}>
                No data available for chart
            </div>
        );
    }

    const options = {
        time: {
            useUTC: false, // Use local time instead of UTC for the chart display
        },
        chart: {
            type: 'area', // Default type, can be overridden by series
        },
        title: {
            text: null // Set to null to use parent's title
        },
        xAxis: {
            type: 'datetime',
            min: startOfDay, // Set the fixed start time
            max: endOfDay,   // Set the fixed end time
            title: {
                text: 'Time of Day'
            },
            dateTimeLabelFormats: {
                hour: '%H:%M',
                day: '%H:%M', // Show hours/minutes even if zoomed out slightly
            },
            tickInterval: 1 * 3600 * 1000, // Tick every 2 hours (adjust as needed)

            // --- Add Plot Line  ---
            plotLines: cutoffTimestamp ? [{ // Only add if cutoffTimestamp is valid
                color: '#DC143C', // Crimson color for visibility
                dashStyle: 'Dot', // Or 'Dash', 'Dot', etc.
                width: 2,         // Line thickness
                value: cutoffTimestamp, // The timestamp value where the line is drawn
                zIndex: 5,
                label: {
                    text: 'Time', // Updated label
                    align: 'right',
                    style: {
                        color: 'gray',
                        fontWeight: 'bold'
                    },
                    y: 30,
                    x: 5
                }
            }] : [], // Empty array if no valid cutoff timestamp
        },
        yAxis: {
            title: {
                text: 'Energy (kWh)' // More specific unit
            },
            max: yAxisMax !== undefined ? yAxisMax : null,
            min: 0, // Assuming power doesn't go negative
            opposite: false
        },
        tooltip: {
            shared: true,
            valueDecimals: 2,
            valueSuffix: ' kWh',
            xDateFormat: '%H:%M', // Format time in tooltip
        },
        plotOptions: {
            area: {
                // fillOpacity: 0.3, // Default opacity
                marker: {
                    enabled: false,
                },
                connectNulls: true
            },
            series: {
            }
        },
        legend: {
            layout: 'horizontal',
            align: 'center',
            verticalAlign: 'bottom',
            borderWidth: 0
        },
        series: combinedSeries, // Use the combined series data
        credits: {
            enabled: false // Hide Highcharts credits
        }
    };

    return (
        <HighchartsReact
            highcharts={Highcharts}
            options={options}
            containerProps={{ style: { height: '100%', width: '100%' } }}
        />
    );
};

export default CombinedEnergyChart;