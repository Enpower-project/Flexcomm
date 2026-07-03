import React from 'react';
import { Box, Typography, Paper, ToggleButton, ToggleButtonGroup, Chip } from '@mui/material';
import { Activity, Settings, Eye, Users } from 'lucide-react';
import UserSelection from '../UserSelection';

const HeaderSection = ({ selectedUser, users, handleUserChange, isAdvancedView, onViewToggle, isAdmin }) => {
    return (
        <Paper
            elevation={1}
            sx={{
                borderRadius: 3,
                mb: 2,
                px: 3,
                py: 2,
                background: 'rgba(255, 255, 255, 0.40)',
                backdropFilter: 'blur(6px) saturate(160%)',
                WebkitBackdropFilter: 'blur(6px) saturate(160%)',
                // border: '1px solid rgba(255, 255, 255, 0.6)',
                boxShadow: '0 12px 30px rgba(15, 23, 42, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 2,
                width: '100%',
                position: 'sticky',
                top: 75,
                zIndex: 100
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 'fit-content' }}>
                <Box sx={{
                    bgcolor: '#017b70',
                    p: 1,
                    borderRadius: 2,
                    display: 'flex',
                    mr: 2,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                }}>
                    <Activity size={22} color="white" />
                </Box>
                <Typography variant="h5" component="h1" fontWeight={600} color="#017b70">
                    Cooling Load Optimization
                </Typography>
            </Box>
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
                gap: 3
            }}>
                <ToggleButtonGroup
                    value={isAdvancedView ? 'advanced' : 'simple'}
                    exclusive
                    onChange={(event, newView) => {
                        if (newView !== null) {
                            onViewToggle();
                        }
                    }}
                    aria-label="view mode"
                    sx={{
                        backgroundColor: 'rgba(255, 255, 255, 0.8)',
                        borderRadius: '6px',
                        boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                        border: '1px solid',
                        borderColor: '#619DBE',
                        '& .MuiToggleButton-root': {
                            px: 3,
                            py: 1,
                            fontSize: '0.875rem',
                            fontWeight: 500,
                            border: 'none',
                            // borderRadius: '6px !important',
                            color: '#619DBE',
                            overflow: 'hidden',
                            borderRadius: isAdvancedView ? '6px 0px 0px 6px !important' : '0px 6px 6px 0px !important',
                            transition: 'all 0.2s ease-in-out',
                            '&:hover': {
                                backgroundColor: '#e2f4fd',
                            },
                            '&.Mui-selected': {
                                bgcolor: '#619DBE',
                                color: 'white',
                                boxShadow: isAdvancedView ? '-2px 0px 16px rgba(0, 0, 0, 0.25)' : '2px 0px 16px rgba(0, 0, 0, 0.25)',
                                '&:hover': {
                                    bgcolor: '#346179',
                                    
                                },
                            },
                        },
                    }}
                >
                    <ToggleButton value="simple" aria-label="simple view">
                        <Eye size={18} style={{ marginRight: 8 }} />
                        Simple View
                    </ToggleButton>
                    <ToggleButton value="advanced" aria-label="advanced view">
                        <Settings size={18} style={{ marginRight: 8 }} />
                        Advanced View
                    </ToggleButton>
                </ToggleButtonGroup>
            </Box>
            {isAdmin ? (
                <Box sx={{ maxWidth: 400 }}>
                    <UserSelection
                        selectedUser={selectedUser}
                        users={users}
                        handleUserChange={handleUserChange}
                    />
                </Box>
            ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Users size={18} style={{ color: '#6b7280' }} />
                    <Typography variant="body2" color="text.secondary" fontWeight={500}>
                        Viewing:
                    </Typography>
                    <Chip
                        label={selectedUser?.displayName ?? '...'}
                        size="small"
                        variant="outlined"
                        sx={{
                            borderRadius: 2,
                            bgcolor: 'transparent',
                            fontSize: '0.75rem',
                            border: 'none',
                            '& .MuiChip-label': {
                                color: 'primary.dark',
                                fontWeight: 500,
                            },
                        }}
                    />
                </Box>
            )}
        </Paper>
    );
};

export default HeaderSection;