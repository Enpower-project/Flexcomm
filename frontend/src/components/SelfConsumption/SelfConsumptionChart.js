import React, { useEffect, useMemo, useState } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import highchartsMore from 'highcharts/highcharts-more';
import { Box, CircularProgress, Alert, Typography } from '@mui/material';
import { loadAllCsvData } from '../../services/csvDataLoader';

// Initialize modules
if (typeof Highcharts === 'object') {
  highchartsMore(Highcharts);
}

const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

// ---------- helpers ----------
const startOfTodayLocal = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
};

const roundToStep = (ts, stepMs) => Math.round(ts / stepMs) * stepMs;

/**
 * Get "now" as a timestamp in the pilot's timezone, expressed as if it were
 * browser-local. This aligns with the naive timestamps the backend returns.
 */
const nowInTimezone = (tz) => {
  // e.g. "2026-03-31 12:30:00" in Budapest
  const wallClock = new Date().toLocaleString('sv-SE', { timeZone: tz });
  return new Date(wallClock).getTime();
};

const normalizeApiProduction = (apiRows) => {
  if (!Array.isArray(apiRows) || apiRows.length === 0) return [];
  return apiRows
    .map((r) => {
      const val = r.energy_production ?? null;
      if (val == null || !r.timestamp) return null;
      return [new Date(r.timestamp).getTime(), Number(Number(val).toFixed(3))];
    })
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);
};

const makeTodayTimestampFrom = (srcDate) => {
  // keep local time-of-day from srcDate, apply to today (local)
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    srcDate.getHours(),
    srcDate.getMinutes(),
    srcDate.getSeconds(),
    0
  ).getTime();
};

const normalizeApiConsumption = (apiRows) => {
  if (!Array.isArray(apiRows) || apiRows.length === 0) return [];

  return apiRows
    .map((r) => {
      const wh = r.energy_consumption ?? r.value ?? null;
      if (wh == null || !r.timestamp) return null;

      const ts = new Date(r.timestamp).getTime(); 

      // Wh → kWh
      // const kwh = Number(wh) / 1000;

      return [ts, Number(wh.toFixed(3))];
    })
    .filter(Boolean)
    .sort((a, b) => a[0] - b[0]);
};


const splitPvByCutoff = (pvHistorical, pvForecast, cutoffTs) => {
  // Both inputs expected as [ts, val] arrays already “on today”
  const hist = (pvHistorical || []).filter(([ts, v]) => v != null && ts <= cutoffTs);
  const fcst = (pvForecast || []).filter(([ts, v]) => v != null && ts > cutoffTs);

  // // connect last hist to first forecast for a continuous line
  // if (hist.length && fcst.length && fcst[0][0] > hist[hist.length - 1][0]) {
  //   fcst.unshift(hist[hist.length - 1]);
  // }
  return { hist, fcst };
};


const SelfConsumptionChart = ({ title, username, yAxisTitle = 'Energy (kWh)', data, pilot = 'gr', pilotTimezone = 'Europe/Athens', selectedUser }) => {
  const isHuPilot = pilot === 'hu';
  const isSummerHome =
    Number(selectedUser?.id) === -1 &&
    String(selectedUser?.username || '').toLowerCase() === 'summer_home';
  const pvScale = isSummerHome ? 0.2 : 1;
  const [rawData, setRawData] = useState(null);
  const [loadingCsv, setLoadingCsv] = useState(true);
  const [error, setError] = useState(null);
  const [currentTimeTick, setCurrentTimeTick] = useState(() => Date.now());

  // Load PV CSV snapshot once (GR only — HU gets PV from API)
  useEffect(() => {
    if (isHuPilot) {
      setLoadingCsv(false);
      return;
    }
    const load = async () => {
      setLoadingCsv(true);
      setError(null);
      try {
        const csv = await loadAllCsvData();
        setRawData(csv);
      } catch (e) {
        console.error(e);
        setError('Failed to load PV chart data.');
      } finally {
        setLoadingCsv(false);
      }
    };
    load();
  }, [isHuPilot]);


  // Tick for cutoff line
  useEffect(() => {
    const id = setInterval(() => setCurrentTimeTick(Date.now()), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);


  // Compute time window for chart (today, in pilot's timezone)
  const { startTs, endTs, cutoffTs } = useMemo(() => {
    const start = startOfTodayLocal();
    const end = start + 24 * 60 * 60 * 1000;

    // cutoff = "now" in the pilot's timezone so it aligns with data timestamps
    const now = nowInTimezone(pilotTimezone);
    const cutoff = now

    return { startTs: start, endTs: end, cutoffTs: cutoff };
  }, [currentTimeTick, pilotTimezone]);

  // PV series: HU → from API data, GR → from CSV
  const pvData = useMemo(() => {
    const scale = (arr) =>
      pvScale === 1
        ? arr
        : (arr || []).map(([ts, v]) => [ts, Number((v * pvScale).toFixed(3))]);

    if (isHuPilot) {
      const apiPv = normalizeApiProduction(data);
      // Mirror historical into forecast: shift +24h with ±5% noise
      const forecast = apiPv.map(([ts, val]) => {
        const noise = 1 + (Math.random() - 0.5) * 0.50;
        return [ts + 24 * 60 * 60 * 1000, Math.max(0, Number((val * noise).toFixed(3)))];
      });
      return { historical: scale(apiPv), forecast: scale(forecast) };
    }

    // GR: remap CSV data onto today (local)
    if (!rawData?.pvPark) return { historical: [], forecast: [] };

    const mapToToday = (arr) =>
      (arr || [])
        .map(([ts, v]) => {
          if (v == null) return null;
          const src = new Date(ts);
          return [makeTodayTimestampFrom(src), Number(v)];
        })
        .filter(Boolean)
        .sort((a, b) => a[0] - b[0]);

    const mapToTomorrow = (arr) =>
      (arr || [])
        .map(([ts, v]) => {
          if (v == null) return null;
          const src = new Date(ts);
          const todayTs = makeTodayTimestampFrom(src);
          return [todayTs + 24 * 60 * 60 * 1000, Number(v)];
        })
        .filter(Boolean)
        .sort((a, b) => a[0] - b[0]);

    return {
      historical: scale(mapToToday(rawData.pvPark.historical)),
      forecast: scale(mapToTomorrow(rawData.pvPark.forecast)),
    };
  }, [rawData, data, isHuPilot, pvScale]);

  // Consumption historical: API for House_01, dummy for others
  const consumptionHistorical = useMemo(() => { 
    return normalizeApiConsumption(data);
  }, [username, data, startTs]);


  // Consumption forecast: mirror previous-day consumption shifted +24h, with a
  // slow sine drift (random phase) plus per-point noise so the forecast curve
  // diverges meaningfully from the historical shape across the day.
  const consumptionForecast = useMemo(() => {
    if (!consumptionHistorical?.length) return [];
    const driftPhase = Math.random() * Math.PI * 2;
    const driftPeriodMs = 10 * 60 * 60 * 1000; // ~10h → visible hump/trough across the day
    const driftAmp = 0.4;                       // ±40% slow drift
    const spikeAmp = 0.30;                      // ±15% per-point jitter
    return consumptionHistorical.map(([ts, val]) => {
      const drift = 1 + driftAmp * Math.sin((ts / driftPeriodMs) * Math.PI * 2 + driftPhase);
      const spike = 1 + (Math.random() - 0.5) * spikeAmp;
      const factor = Math.max(0, drift * spike);
      return [ts + 24 * 60 * 60 * 1000, Number((val * factor).toFixed(3))];
    });
  }, [consumptionHistorical]);


  // Build final Highcharts series
  const series = useMemo(() => {
    if (!isHuPilot && !rawData?.pvPark) return [];
    
    const todayEnd = startTs + 24 * 60 * 60 * 1000;

    // today PV curve (already mapped onto today)
    const pvToday = pvData.historical || [];

    // 1) actual up to cutoff
    const pvHist = pvToday.filter(([ts, v]) => v != null && ts <= cutoffTs);

    // 2) forecast remainder of today (dotted) = today curve after cutoff
    const pvRemainderToday = pvToday.filter(([ts, v]) => v != null && ts > cutoffTs);

    // 3) forecast: for HU, shifted points land on today so filter by cutoff;
    //    for GR, mapped to tomorrow so filter by todayEnd
    const pvTomorrow = (pvData.forecast || []).filter(([ts, v]) =>
      v != null && ts >= (isHuPilot ? cutoffTs : todayEnd)
    );

    // single “forecast PV” series: remainder-of-today + tomorrow
    const pvFcst = pvRemainderToday.concat(pvTomorrow);

    // optional: connect last hist -> first forecast for continuity
    if (pvHist.length && pvFcst.length && pvFcst[0][0] > pvHist[pvHist.length - 1][0]) {
      pvFcst.unshift(pvHist[pvHist.length - 1]);
    }
    // const { hist: pvHist, fcst: pvFcst } = splitPvByCutoff(
    //   pvData.historical,
    //   pvData.forecast,
    //   cutoffTs
    // );
    // Consumption: also split by cutoff for “actual vs forecast”
    // We treat: historical = up to cutoff, forecast = after cutoff
    const consHist = (consumptionHistorical || []).filter(([ts]) => ts <= cutoffTs);

    // Only show forecast consumption if there's actual historical consumption
    const consFcst = consHist.length
      ? (consumptionForecast || []).filter(([ts]) => ts >= cutoffTs)
      : [];

    // connect consumption lines too
    if (consHist.length && consFcst.length && consFcst[0][0] > consHist[consHist.length - 1][0]) {
      consFcst.unshift(consHist[consHist.length - 1]);
    }
    
    const out = [];

    if (pvHist.length) {
      out.push({
        name: 'Actual Allocated PV Production',
        data: pvHist,
        color: '#eab308',
        type: 'area',
        dashStyle: 'Solid',
        lineWidth: 2,
        fillOpacity: 0.3,
        zIndex: 3,
      });
    }

    if (pvFcst.length) {
      out.push({
        name: 'Forecast Allocated PV Production',
        data: pvFcst,
        color: '#facc15',
        type: 'line',
        dashStyle: 'ShortDot',
        lineWidth: 2,
        zIndex: 1,
        marker: { enabled: false },
      });
    }

    if (consHist.length) {
      out.push({
        name: 'Actual Consumption',
        data: consHist,
        color: '#16a34a',
        type: 'area',
        dashStyle: 'Solid',
        lineWidth: 2,
        fillOpacity: 0.3,
        zIndex: 2,
      });
    }

    if (consFcst.length) {
      out.push({
        name: 'Forecast Consumption',
        data: consFcst,
        color: '#4ade80',
        type: 'line',
        dashStyle: 'ShortDot',
        lineWidth: 2,
        zIndex: 0,
        marker: { enabled: false },
      });
    }

    return out;
  }, [rawData, pvData, cutoffTs, consumptionHistorical, consumptionForecast, username, isHuPilot]);

    
  // Fixed 48h window: 24h back, 24h ahead from "now" in pilot timezone
  const xAxisBounds = useMemo(() => {
    const now = cutoffTs;
    return {
      min: now - 24 * 60 * 60 * 1000,
      max: now + 24 * 60 * 60 * 1000,
    };
  }, [cutoffTs]);


  // UI states
  if (loadingCsv) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" sx={{ height: '400px' }}>
        <CircularProgress />
        <Typography sx={{ ml: 2 }}>Loading chart data...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" sx={{ height: '400px' }}>
        <Alert severity="error" sx={{ width: '100%' }}>
          {error}
        </Alert>
      </Box>
    );
  }

  if (!series.length) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        sx={{ height: '400px', border: '1px dashed grey', borderRadius: 1, p: 2 }}
      >
        <Typography color="textSecondary">No data available for chart.</Typography>
      </Box>
    );
  }

  // Title like before
  const today = new Date();
  const dateStr = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1)
    .toString()
    .padStart(2, '0')}`;

  const dynamicTitle =
    title || `Self-Consumption Optimization: ${username || 'User'} vs Allocated PV production for ${dateStr}`;

  const chartOptions = {
    chart: {
      type: 'line',
      height: 500,
      style: { fontFamily: 'Inter, sans-serif' },
      zoomType: 'x',
      backgroundColor: 'transparent',
      plotBackgroundColor: 'transparent',
    },
    time: { useUTC: false },
    title: {
      text: dynamicTitle,
      style: {
        fontSize: '18px',
        fontWeight: 'bold',
        color: '#64748b',
      },
    },
    subtitle: {
      text: 'PV Park Production vs Consumption - Dynamic Historical & Forecast Data',
      style: { fontSize: '12px', color: '#666' },
    },
    xAxis: {
      type: 'datetime',
      min: xAxisBounds.min,
      max: xAxisBounds.max,
      labels: { format: '{value:%H:%M}', style: { color: '#64748b' } },
      title: { text: 'Time of Day', style: { color: '#64748b' } },
      tickInterval: 1 * 3600 * 1000,
      plotLines: cutoffTs
        ? [
            {
              color: '#DC143C',
              dashStyle: 'Dot',
              width: 2,
              value: cutoffTs,
              zIndex: 5,
              label: {
                text: 'Current Period',
                align: 'right',
                style: { color: 'gray', fontWeight: 'bold' },
                y: 90,
                x: 5,
              },
            },
          ]
        : [],
    },
    yAxis: {
      title: { text: yAxisTitle, style: { color: '#64748b' } },
      min: 0,
      labels: { style: { color: '#64748b' } },
      gridLineColor: '#e2e8f0',
    },
    plotOptions: {
      line: {
        marker: { enabled: false, states: { hover: { enabled: true } } },
        lineWidth: 2,
        states: { hover: { lineWidth: 3 } },
      },
      area: {
        marker: { enabled: false, states: { hover: { enabled: true } } },
        lineWidth: 2,
        states: { hover: { lineWidth: 3 } },
        connectNulls: true,
      },
    },
    tooltip: {
      shared: true,
      crosshairs: true,
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      borderColor: '#ccc',
      borderRadius: 6,
      shadow: true,
      useHTML: true,
      formatter: function () {
        let tooltipContent = `<div style="margin-bottom: 5px;"><strong>${this.series.chart.time.dateFormat('%A, %b %e, %Y at %H:%M', this.x)}</strong></div>`;

        this.points.forEach((point) => {
          tooltipContent += `<div style="margin-bottom: 2px;">
            <span style="color: ${point.series.color};">●</span>
            ${point.series.name}: <strong>${point.y.toFixed(2)} ${
            yAxisTitle.includes('(') ? yAxisTitle.match(/\(([^)]+)\)/)?.[1] : 'kW'
          }</strong>
          </div>`;
        });

        return tooltipContent;
      },
    },
    legend: {
      enabled: true,
      layout: 'horizontal',
      align: 'center',
      verticalAlign: 'bottom',
      itemStyle: { fontWeight: 'normal', color: '#64748b' },
    },
    credits: { enabled: false },
    series,
  };

  return (
    <Box sx={{ width: '100%', height: '520px', backgroundColor: 'transparent' }}>
      <HighchartsReact
        highcharts={Highcharts}
        options={chartOptions}
        containerProps={{ style: { height: '100%', width: '100%' } }}
      />
    </Box>
  );
};

export default SelfConsumptionChart;
