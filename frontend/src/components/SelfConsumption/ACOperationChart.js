import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, Typography, Box, Chip } from '@mui/material';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { AirVent, Sun, Zap } from 'lucide-react';
import { isDemoMode } from '../../services/api';
import { demoPvUsageGainPct } from '../../services/demoData';


const ACOperationChart = ({ acData, pvData, startTime, forecast}) => {

  /* -------------------- Helpers -------------------- */
  const getStartHour = (timestamp) =>
    new Date(timestamp).getHours();

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
  function computeOptimizationMetrics(optimized, forecast, pvData) {
    if(!optimized || !forecast || !pvData) return;
    const pvOnThreshold = 0;      // PV is considered ON if pvProduction > 0
    const hvacOnThreshold = 0;    // HVAC is ON if hvac_mode > 0

    const n = Math.min(optimized.length, forecast.length);

    let comfortPctErrSum = 0;
    let comfortCount = 0;

    let pvOnCount = 0;
    let optPvUsageCount = 0;
    let fcPvUsageCount = 0;

    for (let i = 0; i < n; i++) {
      const o = optimized[i];
      const f = forecast[i];
      const pv = pvData[i]; // assuming aligned by index (as you said)

      if (!o || !f || !pv) continue;

      // ----------------------
      // 1) Comfort % difference (MAPE)
      // ----------------------
      const oCI = o.comfort_index;
      const fCI = f.comfort_index;

      if (typeof oCI === "number" && typeof fCI === "number") {
        comfortPctErrSum += Math.abs(fCI - oCI);
        comfortCount++;
      }

      // ----------------------
      // 2) PV usage comparison
      // ----------------------
      const pvOn = (pv.pvProduction || 0) > pvOnThreshold;

      if (pvOn) {
        pvOnCount++;

        const oMode = o.hvac_mode || 0;
        const fMode = f.hvac_mode || 0;

        if (oMode > hvacOnThreshold) optPvUsageCount++;
        if (fMode > hvacOnThreshold) fcPvUsageCount++;
      }
    }

    const avgComfortPctDiff = comfortCount > 0
      ? comfortPctErrSum / comfortCount
      : null;

    const optPvUsageRate = pvOnCount > 0 ? optPvUsageCount / pvOnCount : null;
    const fcPvUsageRate = pvOnCount > 0 ? fcPvUsageCount / pvOnCount : null;
    const pvUsageGainPctPoints = (optPvUsageRate - fcPvUsageRate) * 100;

    let pvUsageIncreasePct = null;

    if (optPvUsageRate !== null && fcPvUsageRate !== null && fcPvUsageRate > 0) {
      pvUsageIncreasePct = ((optPvUsageRate - fcPvUsageRate) / fcPvUsageRate) * 100;
    }

    return {
      avgComfortPctDiff,
      pvUsageIncreasePct,
      optPvUsageRate,
      fcPvUsageRate,
      pvOnCount,
      pvUsageGainPctPoints
    };
  }

  const alignedData = useMemo(() => {
    if (!acData || !pvData) return null;

    const startHour = getStartHour(acData[0].timestamp);

    let pv30;
    if (pvData.length >= 48) {
      // HU pilot: pvData is already 30-min aligned with timestamps — use directly
      pv30 = pvData;
    } else {
      // GR pilot: pvData is hourly (24 entries) — shift and interpolate to 30-min
      const shiftedPV = circularShift(pvData, startHour);
      pv30 = interpolateHourlyTo30Min(shiftedPV);
    }

    return acData.map((ac, i) => ({
      timeLabel: new Date(ac.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      }),
      acOn: ac.hvac_mode === 1 || ac.hvac_mode === 2 ? 1 : 0,
      pvProduction: ac.prod_pct != null ? ac.prod_pct : (pv30[i]?.pv_production ?? 0),
      energySource: ac.prod_pct != null
        ? (ac.prod_pct > 0 ? 'pv' : 'grid')
        : (pv30[i]?.energy_source ?? 'grid')
    }));
  }, [acData, pvData]);

  const metrics = useMemo(() => {
    if (!acData || !forecast || !alignedData) return null;
    return computeOptimizationMetrics(acData, forecast, alignedData);
  }, [acData, forecast, alignedData]);

  const nowIndex = useMemo(() => {
    if (!alignedData?.length) return null;

    const now = new Date();

    // find closest timestamp in alignedData
    let closestIdx = 0;
    let minDiff = Infinity;

    alignedData.forEach((d, i) => {
      const t = new Date(d.timeLabel); // this won't work directly
    });

    // Better: use acData timestamps instead of timeLabel
    acData.forEach((d, i) => {
      const diff = Math.abs(new Date(d.timestamp) - now);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    });

    return closestIdx;
  }, [acData, alignedData]);


  /* -------------------- Alignment Logic -------------------- */
 

  /* -------------------- Chart Options -------------------- */
  const chartOptions = useMemo(() => {
    if (!alignedData) return {};

    return {
      chart: {
        height: 400,
        backgroundColor: 'transparent'
      },
      title: {
        style: {
          color: 'gray',
          fontWeight: '600',
          fontSize: '18px'
        },
        text: 'Suggested AC Operation vs PV Production'
      },
      xAxis: {
        categories: alignedData.map(d => d.timeLabel),
        title: { text: 'Time' },
        plotLines: nowIndex !== null ? [{
          value: nowIndex,
        color: 'rgb(236, 59, 47)',
        width: 2.5,
        dashStyle: 'ShortDash' ,    
          zIndex: 5,
          label: {
            text: 'Now',
            rotation: 0,
            y: -10, 
            x: -10,
            style: {
              color: '#303030',
              fontWeight: '600'
            }
          }
        }] : []
      },
      yAxis: [
        {
          min: 0,
          max: 1,
          tickPositions: [0, 1],
          title: { text: 'AC Status' },
          labels: {
            formatter() {
              return this.value === 1 ? 'ON' : 'OFF';
            }
          }
        },
        {
          opposite: true,
          startOnTick: false,
          endOnTick: false,
          tickInterval: 20,
          title: { text: 'PV Production (%)' },
          labels: {
            format: '{value}%'
          },
          softMax: 100,
          softMin: 0,
        }
      ],
      series: [
        {
          type: 'column',
          name: 'AC Operation',
          yAxis: 0,
          data: alignedData.map(d => ({
            y: d.acOn,
            color: d.acOn
              ? d.energySource === 'pv'
                ? '#22c55e'
                : '#3b82f6'
              : '#e5e7eb'
          })),
          pointWidth: 14
        },
        {
          type: 'line',
          name: 'PV Production',
          yAxis: 1,
          data: alignedData.map(d => Math.max(0, Math.min(100, d.pvProduction))),
          dashStyle: 'ShortDash',
          color: '#f59e0b'
        }
      ],
      tooltip: {
        shared: true
      },
      credits: { enabled: false }
    };
  }, [alignedData]);

  /* -------------------- Render -------------------- */
  if (!alignedData) {
    return (
      <Card sx={{ p: 2 }}>
        <Typography>Loading data…</Typography>
      </Card>
    );
  }

  return (
    <Card sx={{mt:2, p: 0, boxShadow: 'none' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <AirVent  style={{ color: 'rgb(1, 123, 112)' }} />
        <Typography sx={{ color:'primary.dark' }} variant="h6">Smart AC Operation</Typography>
      </Box>

      <Box sx={{ mb: 2, display: 'flex', gap: 2 }}>
        <Chip icon={<Sun />}   sx={{color: "rgb(237, 108, 2)",borderColor: "rgb(237, 108, 2)","& .MuiChip-icon": {color: "rgb(237, 108, 2)",},
  }} label={`PV-usage: +${(isDemoMode() ? demoPvUsageGainPct() ?? metrics?.pvUsageGainPctPoints : metrics?.pvUsageGainPctPoints)?.toFixed(2)}%`} variant="outlined" />
        <Chip icon={<Zap />}  sx={{color: "rgb(2, 96, 237)",borderColor: "rgb(2, 96, 237)","& .MuiChip-icon": {color: "rgb(2, 96, 237)",},
  }} label={`Comfort improvement: +${metrics?.avgComfortPctDiff.toFixed(2)}%`} variant="outlined" />
      </Box>
      <CardContent sx={{ p: 0 }}>
        <HighchartsReact
          highcharts={Highcharts}
          options={chartOptions}
        />
      </CardContent>
    </Card>
  );
};

export default ACOperationChart;
