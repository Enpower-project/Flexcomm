import React, { useState, useEffect } from 'react';
import { Typography, Box, Paper } from '@mui/material';
import ACOperationChart from '../ACOperationChart';

const LoadShiftingSection = ({ selectedUser, lastOptimized, optimization, pvData, forecastedData }) => {

    const [loading, setLoading] = useState(true);

    return (
        <Paper 
            sx={{
                // '--Paper-shadow': 'none',
                p: 3,
                borderRadius: 2,
                minHeight: '400px',
                display: 'flex',
                flexDirection: 'column',
                background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
                // border: '1px solid #e2e8f0',
                border: '1px solid #e2e8f0',
                boxShadow: '-2px 2px 8px rgba(0, 0, 0, 0.2)'
            }} 
            elevation={0}
        >
            <Box sx={{ mb: 1, flexShrink: 0 }}>
                <Typography variant="h6" sx={{
                    fontWeight: 600,
                    color: 'primary.dark',
                    fontSize: '1.1rem',
                    // mb: 0.5
                }}>
                    Load Shifting Suggestions
                </Typography>
                <Typography variant="body2" sx={{
                    color: '#64748b',
                    fontSize: '0.85rem'
                }}>
                    Optimal timing recommendations for air conditioning operation
                </Typography>
            </Box>

            <Box sx={{ flexGrow: 1 }}>
                <ACOperationChart acData={optimization.data} startTime={optimization.created_at} pvData={pvData} forecast={forecastedData}/>
            </Box>
            <Typography
                variant="caption"
                sx={{ color: 'text.secondary', fontWeight: 'light' }}
            >
                Last optimized {lastOptimized}
            </Typography>
        </Paper>
    );
};

export default LoadShiftingSection;