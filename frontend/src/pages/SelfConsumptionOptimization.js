import React, { useState, useEffect } from 'react';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
// Custom hook for data management
import { useSelfConsumptionData } from '../hooks/useSelfConsumptionData';

// Layout components
import Grid from '@mui/material/Grid2';

// Section components
import HeaderSection from '../components/SelfConsumption/sections/HeaderSection';
import EmptyStateSection from '../components/SelfConsumption/sections/EmptyStateSection';
import SelfConsumptionSection from '../components/SelfConsumption/sections/SelfConsumptionSection';
import MetricsSection from '../components/SelfConsumption/sections/MetricsSection';
import OptimizationSection from '../components/SelfConsumption/sections/OptimizationSection';
import LoadShiftingSection from '../components/SelfConsumption/sections/LoadShiftingSection';
import { getOptimizationRun, getOptimizationRunData, triggerDisaggregation, triggerOptimizationRun, cancelOptimizationRun, getLatestOptimizationRun, getConsumptionForecast, getForecastedMetricsForOptimization, isDemoMode } from '../services/api';
import { usePilot } from '../context/PilotContext';
const SelfConsumptionOptimization = () => {
    // View toggle state
    const [isAdvancedView, setIsAdvancedView] = useState(false);
    const [pvData, setPvData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [forecastedData, setForecastedData] = useState(null);
    const { pilot: PILOT, pilotTimezone: PILOT_TIMEZONE, isAdmin, userId } = usePilot();
    // Use custom hook for all data management
    const {
        users,
        selectedUser,
        setSelectedUser,
        handleUserChange,
        consumptionApiData,
        consumptionLoading,
        consumptionError,
        metricsData,
        loadChartSeries,
        ...pv
    } = useSelfConsumptionData();

    const [optimization, setOptimization] = useState({
        status: 'idle',
        runId: null,
        error: null,
        data: null,
        created_at: null,
        forecast: null
    });


    const optimizationInProgress =
        optimization.status === 'preparing' ||
        optimization.status === 'queued' ||
        optimization.status === 'running';


    function formatTimeAgo(iso) {
        const diffMs = Date.now() - new Date(iso).getTime();
        const minutes = Math.floor(diffMs / 60000);

        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes} min ago`;

        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;

        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    const getStartHour = (timestamp) => {
        return new Date(timestamp).getHours();
    }
        

    const getPreviousHalfHour = (timestamp) => {
        const d = new Date(timestamp);

        const minutes = d.getMinutes();
        const flooredMinutes = minutes < 30 ? 0 : 30;

        d.setMinutes(flooredMinutes, 0, 0); // set seconds & ms to zero

        return d;
    }

    // shift pv to match ac data and to make sense
    const circularShift = (array, shift) => {
        const n = array.length;
        return array.map((_, i) => array[(i + shift) % n]);
    };

    const interpolateHourlyTo30Min = (hourly) => {
        const result = [];
        for (let i = 0; i < hourly.length; i++) {
        const curr = hourly[i];
        const next = hourly[(i + 1) % hourly.length];

        result.push(curr);
        result.push({
            ...curr,
            pv_production: (curr.pv_production + next.pv_production) / 2
        });
        }
        return result;
    };

    /* -------------------- Load PV data -------------------- */
    // GR: static JSON schedule, HU: real production from API
    const loadPV = async () => {
        try {
            const res = await fetch('/data/self-consumption/ac-operation-suggestions.json');
            const json = await res.json();
            setPvData(json.ac_operation_suggestions.daily_schedule);
        } catch (e) {
            console.error('Failed to load PV data', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (PILOT !== 'hu') {
            loadPV();
        }
    }, [PILOT]);

    useEffect(() => {
        if (!isAdmin && userId && users.length > 0) {
            const match = users.find((u) => String(u.id) === String(userId));
            if (match) setSelectedUser(match);
        }
    }, [isAdmin, userId, users]);

    useEffect(() => {
        if (PILOT !== 'hu' || !consumptionApiData?.length) {
            if (PILOT === 'hu') setLoading(false);
            return;
        }
        // Last 48 half-hour rows of real production → binary PV indicator
        const tail = consumptionApiData.slice(-48);
        const pvBinary = tail.map((row) => ({
            pv_production: (row.energy_production ?? 0) > 0.05 ? 1 : 0,
            energy_source: (row.energy_production ?? 0) > 0.05 ? 'pv' : 'grid',
            timestamp: row.timestamp,
        }));
        setPvData(pvBinary);
        setLoading(false);
    }, [consumptionApiData]);


    useEffect(() => {
        if (!selectedUser) return;

        let cancelled = false;

        const loadLatest = async () => {
            setOptimization({
                runId: null,
                status: 'checking',
                data: null,
                error: null,
                created_at: null,
                forecast: null
            });

            setForecastedData(null);

            try {
                const res = await getLatestOptimizationRun(selectedUser?.id);

                if (!res.has_recent) {
                    if (!cancelled) {
                        setOptimization({
                            runId: null,
                            status: 'idle',
                            data: null,
                            error: null,
                            created_at: null,
                            forecast: null
                        });
                    }
                    return;
                }

                const dataRes = await getOptimizationRunData(res.run_id);
                let consumption_res = await getConsumptionForecast(selectedUser?.id, dataRes?.data[0].timestamp)
                if(PILOT !== 'hu'){
                    consumption_res = consumption_res.map((x) => {
                        x.hvac_mode = x.value > 1000 ? 2 : x.hvac_mode
                        return x
                    })
                }
                if (!cancelled) {
                    setOptimization({
                        runId: res.run_id,
                        status: 'completed',
                        data: dataRes.data,
                        error: null,
                        created_at: res.created_at,
                        forecast: consumption_res
                    });

                }
            } catch (e) {
                if (!cancelled) {
                    setOptimization({
                        runId: null,
                        status: 'error',
                        data: null,
                        error: e.message,
                        forecast: null
                    });
                }
            }
        };
       
        loadLatest();
        
        return () => {
            cancelled = true;
        };
    }, [selectedUser]);

    useEffect(() => {
        if (
            optimization.status !== 'completed' ||
            !selectedUser?.id ||
            !optimization?.data?.length ||
            !optimization?.forecast?.length
        ) {
            return;
        }

        let cancelled = false;

        const run = async () => {
            const start_time = optimization.forecast[0].timestamp;
            const hvac_48 = optimization.forecast.map(x => x.hvac_mode);

            const res = await getForecastedMetricsForOptimization(
                selectedUser?.id,
                hvac_48,
                start_time
            );
            if (!cancelled) {
                setForecastedData(res);
            }
        };

        run();

        return () => {
            cancelled = true;
        };
    }, [optimization?.runId, optimization?.status]);

    const startOptimization = async (siteId) => {
        if (!siteId) {
            setOptimization({ status: 'error', runId: null, error: 'Please select a user/site to optimize.', data: null });
            return;
        }
        if(!pvData.length && PILOT !== 'hu'){
            loadPV()
        }
        try {
            setOptimization({
                status: 'queued',
                runId: null,
                error: null,
                data: null,
                createdAt: new Date().toISOString(),
                forecast: null
            });

            let finalPv;
            if (PILOT === 'hu') {
                // HU: pvData is already 48 binary half-hour rows from real production
                if (pvData.length >= 48) {
                    finalPv = pvData.slice(-48).map((x) => x.pv_production > 0 ? 1 : 0);
                } else {
                    finalPv = Array(48).fill(0);
                }
            } else {
                // GR: static hourly JSON → shift, interpolate to 30min, binarize
                const pvStart = getStartHour(Date.now())
                let pvDataShifted = circularShift(pvData, pvStart)
                pvDataShifted = interpolateHourlyTo30Min(pvDataShifted)
                finalPv = pvDataShifted.map((x) => x.pv_production > 0 ? 1 : 0)
            }

            const runResp = await triggerOptimizationRun(siteId, finalPv);
            const runId = runResp.run_id;


            setOptimization({ status: 'running', runId, createdAt: new Date().toISOString() });

            const poll = setInterval(async () => {
            try {
                const run = await getOptimizationRun(runId);

                if (run.status === 'failed') {
                    clearInterval(poll);
                    setOptimization({ status: 'error', runId: null, error: run.error_message });
                }

                if (run.status === 'succeeded') {
                    const dataResp = await getOptimizationRunData(runId);
                    let consumption_res = await getConsumptionForecast(selectedUser?.id, dataResp?.data[0].timestamp)
                    consumption_res = consumption_res.map((x) => {
                        x.hvac_mode = x.value > 1000 ? 2 : x.hvac_mode
                        return x
                    })
                    clearInterval(poll);

                    setOptimization({
                        status: 'completed',
                        runId,
                        error: null,
                        data: dataResp.data,
                        created_at: run.created_at,
                        forecast: consumption_res
                    });
                }
            } catch (e) {
                clearInterval(poll);
                setOptimization({ status: 'error', runId: null, error: e.message, forecast:null, data:null });
            }
            }, isDemoMode() ? 2000 : 30000);
        } catch (err) {
            if (err?.response?.status === 409) {
                setOptimization({
                    status: 'error',
                    runId: null,
                    error: 'Optimization already running for this site.',
                    data: null,
                });
                return;
            }

            setOptimization({
                status: 'error',
                runId: null,
                error:
                    err?.response?.data?.detail ||
                    err?.message ||
                    'Unexpected optimization error.',
                data: null,
            });
    }
    };

    return (
        <Box sx={
            { py: 2, px: 4, minHeight: '100vh', width: '100%', overflow: 'visible', background: 'radial-gradient(ellipse at 50% 20%,#FFFFFF 0%, #E6F4F1 60%, #8FD1C7 85%, #017B70 100%)' }
        }>
            <HeaderSection
                selectedUser={selectedUser}
                users={users}
                handleUserChange={handleUserChange}
                isAdvancedView={isAdvancedView}
                onViewToggle={() => setIsAdvancedView(!isAdvancedView)}
                isAdmin={isAdmin}
            />
            {!selectedUser ? (
                <EmptyStateSection />
                ) : (
                <Grid
                    container
                    spacing={3}
                    direction="column"
                    alignItems="center"
                    sx={{ width: 1, mb: 2 }}
                >
                    {/* Main row: SelfConsumption + Metrics */}
                    <Grid
                        container
                        spacing={3}
                        direction={{ md: 'column', lg: 'row' }}
                        justifyContent="center"
                        alignItems="stretch"
                        sx={{ width: 1 }}
                    >
                    <Grid size={{ md: 12, lg: 9, xl: 10 }}>
                        <SelfConsumptionSection
                            selectedUser={selectedUser}
                            users={users}
                            isSimpleView={!isAdvancedView}
                            data={consumptionApiData ? consumptionApiData : []}
                            onOptimize={(siteId) => startOptimization(siteId)}
                            optimizationInProgress={optimizationInProgress}
                            optimizationStatus={optimization.status}
                            optimizationError={optimization.error}
                            pilot={PILOT}
                            pilotTimezone={PILOT_TIMEZONE}
                        />
                    </Grid>

                    <Grid size={{ md: 12, lg: 3, xl: 2 }}>
                        <MetricsSection
                            metricsData={metricsData}
                            isSimpleView={!isAdvancedView}
                        />
                    </Grid>
                    </Grid>

                    {/* Load shifting / optimization result */}
                    <Grid size={12}>
                        {optimization.status === 'completed' ? (
                            <LoadShiftingSection
                                selectedUser={selectedUser}
                                lastOptimized={formatTimeAgo(optimization?.created_at)}
                                optimization={optimization}
                                pvData={pvData}
                                forecastedData={forecastedData}
                            />
                        ) : optimizationInProgress ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <CircularProgress size={18} sx={{ color: 'gray' }} />
                                <Typography sx={{ color: 'gray', fontWeight: 'lighter' }}>
                                    Running optimization...
                                </Typography>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    onClick={async () => {
                                        try {
                                            if (optimization.runId && selectedUser?.id) {
                                                await cancelOptimizationRun(selectedUser.id, optimization.runId);
                                            }
                                        } catch (e) {
                                            console.error('Failed to cancel optimization:', e);
                                        }
                                        setOptimization({ status: 'idle', runId: null, error: null, data: null, created_at: null, forecast: null });
                                    }}
                                    sx={{ color: '#888', borderColor: '#ccc', textTransform: 'none', fontSize: '0.8rem', py: 0.25, px: 1.5, minWidth: 0 }}
                                >
                                    Cancel
                                </Button>
                            </Box>
                        ) : (
                            <Typography sx={{ color: 'gray', fontWeight: 'lighter' }}>
                                No optimization run found
                            </Typography>
                        )}
                    </Grid>
                    
                    {/* Advanced-only section */}
                    {isAdvancedView ? 
                    <Grid size={12}>
                        <OptimizationSection selectedUser={selectedUser} dataOptimized={optimization.data} dataForecasted={forecastedData}/>
                    </Grid>
                    : <div></div>
                    }
                </Grid>
                )}


        </Box>
    );
};

export default SelfConsumptionOptimization;

