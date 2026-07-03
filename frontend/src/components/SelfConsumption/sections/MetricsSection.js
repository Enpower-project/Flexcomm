import React from 'react';
import Grid from '@mui/material/Grid2';
import { Typography, Box, Paper } from '@mui/material';
import { Thermometer, Droplets, Activity, Sun } from 'lucide-react';
import IconCard from '../IconCard';

const MetricsSection = ({ metricsData, isSimpleView = false }) => {
    const getMetricValue = (metricsData, label) => {
        return metricsData?.find((m) => m.label === label)?.value?.toFixed(2) ?? null;
    };
    
    const metricCategories = [
        {
            title: 'Indoor Temperature',
            icon: <Thermometer color="#e7ca8b" />,
            value: getMetricValue(metricsData, 'Indoor Temperature'),
            unit: '°C',
        },
        {
            title: 'Humidity',
            icon: <Droplets color="#bb6dd3" />,
            value: getMetricValue(metricsData, 'Humidity'),
            unit: '%',
        },
        {
            title: 'Comfort Index',
            icon: <Activity color="#9af65c" />,
            value: getMetricValue(metricsData, 'Comfort Index'),
            unit: '%',
        },
        {
            title: 'Outdoor Temperature',
            icon: <Thermometer color="#f18c52" />,
            value: getMetricValue(metricsData, 'Outdoor Temperature'),
            unit: '°C',
        }
    ];

    
    return (
        <Paper sx={{
            p: 3,
            minHeight: '100%',
            borderRadius: 2,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            // justifyContent: 'space-between',
            gap: 1,
            background: 'white',
            backdropFilter: 'blur(16px) saturate(160%)',
            border: '1px solid #e2e8f0',
            boxShadow: '-2px 2px 8px rgba(0, 0, 0, 0.2)'
        }}>
            <Box sx={{ mb: 2, flexShrink: 0 }}>
                <Typography variant="h6" sx={{
                    fontWeight: 600,
                    color: 'primary.dark',
                    fontSize: '1.1rem',
                    mb: 0.5
                }}>
                    Current Comfort Metrics
                </Typography>
                <Typography variant="body2" sx={{
                    color: 'primary.dark',
                    fontSize: '0.85rem'
                }}>
                    Real-time environmental conditions
                </Typography>
            </Box>

            <Grid 
                container spacing={2}
                direction='column'
                sx={{ flexGrow: 1, backgroundColor: 'transparent' }}
            >
                {metricCategories.map((metric, index) => (
                    <Grid size={12} key={index} sx={{ flexGrow: 1, backgroundColor: 'transparent', display: 'flex' }}>
                        <IconCard
                            title={metric.title}
                            description={`${metric.value}${metric.unit}`}
                            icon={metric.icon}
                            showInfoButton={metric.title === 'Comfort Index'}
                            infoTooltip={metric.title === 'Comfort Index' ? 'The comfort index shows the percentage of people that would find the current environment comfortable.' : ''}
                        />
                    </Grid>
                ))}
            </Grid>
        </Paper>
        );
    

    // return (
    //     <Paper sx={{
    //         p: 3,
    //         borderRadius: 2,
    //         minHeight: '200px',
    //         display: 'flex',
    //         flexDirection: 'column',
    //         background: 'white',
    //         border: '1px solid #e2e8f0',
    //         boxShadow: '-2px 2px 8px rgba(0, 0, 0, 0.2)'
    //     }}>
    //         <Box sx={{ mb: 3 }}>
    //             <Typography variant="h6" sx={{
    //                 fontWeight: 600,
    //                 color: '#1e293b',
    //                 fontSize: '1.1rem',
    //                 mb: 0.5
    //             }}>
    //                 Current Comfort Metrics
    //             </Typography>
    //             <Typography variant="body2" sx={{
    //                 color: '#64748b',
    //                 fontSize: '0.85rem'
    //             }}>
    //                 Real-time environmental conditions and comfort analysis
    //             </Typography>
    //         </Box>

    //         <Grid container rowSpacing={{md: 1, lg: 2}} sx={{ flexGrow: 1}} >
    //             {metricCategories.map((metric, index) => (
    //                 <Grid item key={index} size={12} sx={{display: 'flex' }}>
    //                     <IconCard
    //                         title={metric.title}
    //                         description={`${metric.value}${metric.unit}`}
    //                         icon={metric.icon}
    //                         showInfoButton={metric.title === 'Comfort Index'}
    //                         infoTooltip={metric.title === 'Comfort Index' ? 'The comfort index shows the percentage of people that would find the current environment comfortable.' : ''}
    //                     />
    //                 </Grid>
    //             ))}
    //         </Grid>
    //     </Paper>
    // );
};

export default MetricsSection;