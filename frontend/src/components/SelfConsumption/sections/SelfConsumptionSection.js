import React, { useState, useEffect} from 'react';
import { Paper, Typography, Box, Button, Snackbar, Alert } from '@mui/material';
import SelfConsumptionChart from '../SelfConsumptionChart';

const SelfConsumptionSection = ({ selectedUser, users, isSimpleView = false, data, onOptimize, optimizationInProgress, optimizationStatus, optimizationError, pilot = 'gr', pilotTimezone = 'Europe/Athens' }) => {
    const username = users.find(u => u.username === selectedUser?.username)?.displayName || selectedUser.username;
    const [isQueueing, setIsQueueing] = useState(false);
    const [toast, setToast] = useState({
        open: false,
        severity: 'info', 
        message: '',
    });

    const showToast = (severity, message) => {
        setToast({ open: true, severity, message });
    };

    const closeToast = (_, reason) => {
        if (reason === 'clickaway') return;
        setToast((t) => ({ ...t, open: false }));
    };
    useEffect(() => {
            if (!optimizationStatus) return;

            switch (optimizationStatus) {
                case 'queued':
                case 'running':
                    showToast('info', 'Optimization is running...');
                    break;
                case 'completed':
                    showToast('success', 'Optimization completed successfully!');
                    break;
                case 'error':
                    showToast('error', optimizationError || 'Optimization failed');
                    break;
                default:
                    break;
            }
        }, [optimizationStatus, optimizationError]);
    

    const toastStylesBySeverity = {
        success: {
            backgroundColor: 'success.main',
        },
        error: {
            backgroundColor: 'error.main',
        },
        warning: {
            backgroundColor: 'warning.main',
            color: 'black',
        },
    };

    const handleOptimizeClick = () => {
        const siteId = selectedUser?.id; 
        if (!siteId) {
            showToast('error', 'Please select a user to optimize.');
            return;
        }
        setIsQueueing(true);
        onOptimize(siteId);
        
        // Reset after a short delay (the parent will set status to 'queued')
        setTimeout(() => setIsQueueing(false), 500);
    };
    
    return (
        <Paper sx={{
            p: 3,
            borderRadius: 2,
            height: '100%',
            minHeight: '400px',
            display: 'flex',
            flexDirection: 'column',
            background: 'white',
            border: '1px solid #e2e8f0',
            boxShadow: '-2px 2px 8px rgba(0, 0, 0, 0.2)'
        }}>
            <Box sx={{ mb: 2, flexShrink: 0, display: 'flex', width: 1, justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                    <Typography variant="h6" sx={{
                        fontWeight: 600,
                        color: 'primary.dark',
                        fontSize: '1.1rem',
                        mb: 0.5
                    }}>
                        Self Consumption Analysis
                    </Typography>
                    <Typography variant="body2" sx={{
                        color: '#64748b',
                        fontSize: '0.85rem'
                    }}>
                        Energy consumption patterns for {username}
                    </Typography>
                </Box>
                <Button 
                    sx={{
                        p:1, 
                        boxShadow:'-1px 1px 6px 1px rgba(0,0,0,0.3)', 
                        borderRadius: '6px', 
                        backgroundColor: 'selection.main', 
                        color: 'white',
                        transition: 'all 0.2s',
                        '&:hover': {
                            transform: 'scale(1.05)',
                        },
                        '&:active': {
                            transform: 'scale(0.95)',
                        },
                        '&.Mui-disabled': { opacity: 0.7, color: 'white' },

                    }} 
                    id="export-self-consumption-chart-btn"
                    onClick={handleOptimizeClick}
                    disabled={isQueueing || optimizationInProgress}
                >
                    {isQueueing || optimizationInProgress ? 'Optimizing…' : 'Optimize'}
                </Button>
            </Box>

            <Box sx={{ flexGrow: 1, backgroundColor: 'transparent' }}>
                <SelfConsumptionChart username={username} data={data} pilot={pilot} pilotTimezone={pilotTimezone} selectedUser={selectedUser} />
            </Box>
            <Snackbar
                open={toast.open}
                autoHideDuration={3500}
                onClose={closeToast}

                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert 
                    onClose={closeToast} 
                    severity={toast.severity} 
                    variant="filled"
                    sx={{ 
                        borderRadius: '6px',
                        ...toastStylesBySeverity[toast.severity],
                        mt: '160px'
                     }}>
                {toast.message}
                </Alert>
            </Snackbar>
        </Paper>
    );
};

export default SelfConsumptionSection;