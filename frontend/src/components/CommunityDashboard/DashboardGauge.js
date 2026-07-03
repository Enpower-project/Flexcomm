import React, { useMemo } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { Box, Typography } from '@mui/material';
import { Zap, Battery, Gauge, Import, Leaf, TrendingUp } from 'lucide-react';


const getGaugeIcon = (type) => {
    switch (type) {
        case 'consumption':
            return <Zap size={16} />;
        case 'production':
            return <Battery size={16} />;
        case 'scr':
            return <Gauge size={16} />;
        case 'pv_wasted':
            return <TrendingUp size={16} style={{ transform: 'rotate(180deg)' }} />;
        case 'grid_imported':
            return <Import size={16} />;
        case 'energy_independence':
            return <Leaf size={16} />;
        default:
            return <Gauge size={16} />;
    }
};

const getIconColor = (type) => {
    switch (type) {
        case 'consumption':
            return '#f59e0b';
        case 'production':
            return '#10b981';
        case 'scr':
            return '#3b82f6';
        case 'pv_wasted':
            return '#ef4444';
        case 'grid_imported':
            return '#f97316';
        case 'energy_independence':
            return '#22c55e';
        default:
            return '#6b7280';
    }
};

const DashboardGauge = ({
    type, // 'consumption', 'production', 'scr', 'pv_wasted', 'grid_imported', or 'energy_independence'
    title,
    // Props for consumption/production progress gauges
    currentValueKWh = 0, // Cumulative kWh for the day so far
    maxValueKWh = 1,     // Total forecasted kWh for the day
    // Props for scr (Current Self-Consumption Rate) calculation
    consumptionActualsKWh = [], // Array of {timestamp: string, value: number (kWh or kW for interval)}
    productionActualsKWh = [],  // Array of {timestamp: string, energy: number (kWh or kW for interval)}
    startOfDayTs = null,        // Timestamp for the start of the current/target day
    cutoffTs = null,            // Timestamp for the current simulated time of day
    // Props for new gauge types
    wastedEnergyKWh = 0,        // Total PV energy wasted so far today
    gridImportedKWh = 0,        // Total energy imported from grid so far today
    independenceScoreKWh = 0    // Energy independence score (production - consumption)
}) => {

    const { gaugeValue, gaugeMax, unit, stops, dataLabelFormat, axisLabelFormat } = useMemo(() => {
        let calculatedValue = 0;
        let calculatedMax = 100; // Default for percentage-based gauges
        let displayUnit = '%';   // Default unit
        let colorStops = [       // Default color stops (Yellow to Green)
            [0.0, '#DDDF0D'],
            [1.0, '#55BF3B']
        ];
        let labelFormat = '{y:.1f}'; // Default data label format (center of gauge)
        let axisFormat = '{value}';  // Default y-axis label format (min/max labels)

        if (type === 'consumption' || type === 'production') {
            // --- Logic for Daily Consumption/Production Progress Gauges ---
            const currentValueMWh = currentValueKWh / 1000;
            const maxValueMWh = Math.max(0.001, maxValueKWh / 1000); // Ensure max is at least a small positive value in MWh

            calculatedValue = currentValueMWh;
            calculatedMax = maxValueMWh;
            displayUnit = 'MWh';
            labelFormat = '{y:.2f}'; // Show MWh with 2 decimal places in the center
            axisFormat = '{value:.1f}'; // Format axis labels for MWh (e.g., 1 decimal place)

        } else if (type === 'scr') {
            // --- Logic for CURRENT Self-Consumption Rate (latest interval) ---
            displayUnit = '%';
            calculatedMax = 100; // SCR is always out of 100%
            labelFormat = '{y:.1f}'; // Show % with 1 decimal place
            axisFormat = '{value}%'; // Show % on axis labels
            // colorStops remain default (Yellow if low SCR, Green if high SCR)

            if (!startOfDayTs || !cutoffTs ||
                !productionActualsKWh || productionActualsKWh.length === 0 ||
                !consumptionActualsKWh || consumptionActualsKWh.length === 0) {
                calculatedValue = 0;
            } else {
                // 1. Prepare production data: map to {timestamp (ms), value (energy/power), originalTimestamp}
                const allProductionPoints = productionActualsKWh.map(p => ({
                    timestamp: new Date(p.timestamp).getTime(),
                    value: p.energy,
                    originalTimestamp: p.timestamp
                }));

                // 2. Filter production points for the current day up to cutoffTs
                const relevantProductionPoints = allProductionPoints
                    .filter(p => !isNaN(p.timestamp) && p.timestamp >= startOfDayTs && p.timestamp <= cutoffTs && p.value != null);


                if (relevantProductionPoints.length === 0) {
                    calculatedValue = 0;
                } else {
                    // 3. Sort relevant production points by timestamp to get the latest one
                    relevantProductionPoints.sort((a, b) => b.timestamp - a.timestamp); // Descending order (latest first)
                    const latestProductionPoint = relevantProductionPoints[0];
                    const latestProdTimestamp = latestProductionPoint.timestamp;
                    const latestProdValue = latestProductionPoint.value;

                    // 4. Prepare consumption data: Create a Map for efficient lookup by timestamp
                    const consumptionMap = new Map();
                    consumptionActualsKWh.forEach(c => {
                        const ts = new Date(c.timestamp).getTime();
                        if (!isNaN(ts) && c.value != null) {
                            consumptionMap.set(ts, { value: c.value, originalTimestamp: c.timestamp });
                        }
                    });

                    // 5. Find consumption data for the exact timestamp of the latest production point
                    const consumptionDataAtTimestamp = consumptionMap.get(latestProdTimestamp);
                    const latestConsValue = consumptionDataAtTimestamp ? consumptionDataAtTimestamp.value : null;

                    if (latestProdValue == null) {
                        calculatedValue = 0;
                    } else if (latestConsValue == null) {
                        calculatedValue = (latestProdValue > 0) ? 0 : 0;
                    } else {
                        // 6. Calculate Self-Consumption Rate for this specific interval
                        // SCR = min(Production_Interval, Consumption_Interval) / Production_Interval * 100
                        const directlyConsumedInInterval = Math.min(latestProdValue, latestConsValue);

                        if (latestProdValue > 0) {
                            const rate = (directlyConsumedInInterval / latestProdValue) * 100;
                            calculatedValue = Math.min(rate, 100); // Cap at 100% (e.g., due to floating point issues)
                        } else {
                            // If production in the interval is 0 (or negative, though unlikely), SCR is 0.
                            // If both production and consumption are 0, SCR is typically considered 0 or undefined.
                            calculatedValue = 0;
                        }
                    }
                }
            }
        } else if (type === 'pv_wasted') {
            // --- Logic for PV Energy Wasted Today ---
            const wastedMWh = wastedEnergyKWh / 1000;
            calculatedValue = wastedMWh;
            calculatedMax = Math.max(0.1, wastedMWh * 1.5); // Dynamic max based on current wasted energy
            displayUnit = 'MWh';
            labelFormat = '{y:.2f}'; // Show MWh with 2 decimal places
            axisFormat = '{value:.1f}'; // Format axis labels for MWh
            // Red color scheme for wasted energy (bad = red, better = yellow)
            colorStops = [
                [0.0, '#55BF3B'], // Green for low waste
                [0.5, '#DDDF0D'], // Yellow for medium waste
                [1.0, '#DF5353']  // Red for high waste
            ];

        } else if (type === 'grid_imported') {
            // --- Logic for Grid Energy Imported Today ---
            const importedMWh = gridImportedKWh / 1000;
            calculatedValue = importedMWh;
            calculatedMax = Math.max(0.1, importedMWh * 1.5); // Dynamic max based on current imported energy
            displayUnit = 'MWh';
            labelFormat = '{y:.2f}'; // Show MWh with 2 decimal places
            axisFormat = '{value:.1f}'; // Format axis labels for MWh
            // Orange to red color scheme for grid dependency (more = worse)
            colorStops = [
                [0.0, '#55BF3B'], // Green for low dependency
                [0.5, '#FFA500'], // Orange for medium dependency
                [1.0, '#DF5353']  // Red for high dependency
            ];

        } else if (type === 'energy_independence') {
            // --- Logic for Energy Independence Score ---
            const scoreMWh = independenceScoreKWh / 1000;
            calculatedValue = Math.abs(scoreMWh); // Show absolute value on gauge
            calculatedMax = Math.max(0.1, Math.abs(scoreMWh) * 1.5); // Dynamic max
            displayUnit = 'MWh';
            labelFormat = '{y:.2f}'; // Show MWh with 2 decimal places
            axisFormat = '{value:.1f}'; // Format axis labels for MWh

            // Color scheme based on surplus vs deficit
            if (scoreMWh >= 0) {
                // Surplus - Green (good)
                colorStops = [
                    [0.0, '#55BF3B'],
                    [1.0, '#228B22']
                ];
            } else {
                // Deficit - Red (needs improvement)
                colorStops = [
                    [0.0, '#FFA500'],
                    [1.0, '#DF5353']
                ];
            }
        }

        return {
            gaugeValue: calculatedValue,
            gaugeMax: calculatedMax,
            unit: displayUnit,
            stops: colorStops,
            dataLabelFormat: labelFormat,
            axisLabelFormat: axisFormat
        };
    }, [
        type,
        currentValueKWh, maxValueKWh, // For progress gauges
        consumptionActualsKWh, productionActualsKWh, startOfDayTs, cutoffTs, // For SCR gauge
        title // General dependency
    ]);


    // --- Highcharts Options ---
    const options = {
        chart: {
            type: 'solidgauge',
            height: '200px',
            backgroundColor: 'transparent'
        },
        title: {
            text: null // Remove title from chart since we'll add it as a React component
        },
        pane: {
            center: ['50%', '80%'],
            size: '130%',
            startAngle: -90,
            endAngle: 90,
            background: {
                backgroundColor: Highcharts.defaultOptions.legend?.backgroundColor || '#ECEFF1',
                innerRadius: '60%',
                outerRadius: '100%',
                shape: 'arc',
                borderColor: '#D5D8DC',
                borderWidth: 1
            }
        },
        exporting: { enabled: false },
        tooltip: { enabled: false },
        yAxis: {
            min: 0,
            max: gaugeMax,
            stops: stops,
            lineWidth: 0,
            tickWidth: 0,
            minorTickInterval: null,
            tickAmount: 2, // Show min and max labels (0 and gaugeMax)
            labels: {
                enabled: true,
                y: 16,         // Position labels vertically relative to the arc
                distance: -25, // Distance from the arc, negative is inside
                format: axisLabelFormat,
                style: {
                    fontSize: '10px',
                    color: '#555'
                }
            }
        },
        plotOptions: {
            solidgauge: {
                borderRadius: 3, // Rounded ends for the gauge series
                dataLabels: {
                    y: 0, // Vertically center the data label
                    borderWidth: 0,
                    useHTML: true,
                    // Central data label showing the current value and unit
                    format:
                        '<div style="text-align:center; line-height: 1.2;">' +
                        `<span style="font-size:24px; color: ${Highcharts.defaultOptions.plotOptions?.series?.dataLabels?.color || '#333'};">${dataLabelFormat}</span><br/>` +
                        `<span style="font-size:12px;opacity:0.7; color: #666;">${unit}</span>` +
                        '</div>',
                    style: {
                        // textOutline: 'none' 
                    }
                },
                stickyTracking: false,
                linecap: 'round' // Ensures rounded line caps for the series
            }
        },
        credits: { enabled: false },
        series: [{
            name: title,
            data: [parseFloat(gaugeValue.toFixed(type === 'scr' ? 1 : 2))], // Ensure data is a number, toFixed for display consistency
            tooltip: { // Tooltip for the series point 
                valueSuffix: ` ${unit}`
            }
        }]
    };

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            {/* Title with Icon */}
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: 1,
                mb: -2,
                flexShrink: 0,
                position: 'relative'
            }}>
                <Box sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 32,
                    borderRadius: '8px',
                    backgroundColor: getIconColor(type),
                    color: 'white',
                    flexShrink: 0
                }}>
                    {getGaugeIcon(type)}
                </Box>
                <Typography variant="body2" sx={{
                    fontWeight: 600,
                    color: '#1e293b',
                    fontSize: '1rem',
                    textAlign: 'center',
                    position: 'absolute',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '100%',
                    paddingLeft: '0px' // Small offset to account for icon being on left
                }}>
                    {title}
                </Typography>
            </Box>

            {/* Chart */}
            <Box sx={{ flexGrow: 1 }}>
                <HighchartsReact highcharts={Highcharts} options={options} />
            </Box>
        </Box>
    );
};

export default DashboardGauge;