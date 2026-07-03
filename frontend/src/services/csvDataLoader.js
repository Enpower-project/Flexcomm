/**
 * CSV Data Loader utility for Self Consumption Optimization
 * Loads and parses CSV files with timestamp,value format for chart consumption
 */

// CSV file paths (served from public/data folder)
const CSV_FILES = {
  pvParkHistorical: '/data/self-consumption/pv_real.csv',
  pvParkForecast: '/data/self-consumption/pv_fc.csv',
  dimarxeioHistorical: '/data/self-consumption/real.csv',
  dimarxeioForecast: '/data/self-consumption/fc.csv'
};

/**
 * Parses CSV text content into array of [timestamp, value] pairs
 * @param {string} csvText - CSV content as text
 * @returns {Array<[number, number]>} Array of [timestamp_ms, value] pairs
 */
const parseCsvData = (csvText) => {
  const lines = csvText.trim().split('\n');
  const dataLines = lines.slice(1); // Skip header row

  return dataLines
    .map(line => {
      const [timestampStr, valueStr] = line.split(',');

      const timestamp = new Date(timestampStr.trim()).getTime();
      const value = parseFloat(valueStr.trim());

      // Filter out invalid data
      if (isNaN(timestamp) || isNaN(value)) {
        return null;
      }

      return [timestamp, value];
    })
    .filter(entry => entry !== null)
    .sort((a, b) => a[0] - b[0]); // Sort by timestamp
};

/**
 * Preprocesses data based on data type
 * @param {Array<[number, number]>} data - Array of [timestamp, value] pairs
 * @param {string} dataType - Type of data for preprocessing rules
 * @returns {Array<[number, number]>} Preprocessed data
 */
const preprocessData = (data, dataType) => {
  if (!data || data.length === 0) return data;

  switch (dataType) {
    case 'pvParkHistorical':
      // Display only % of historical production data
      return data.map(([timestamp, value]) => [timestamp, value * 0.015]);
    case 'pvParkForecast':
      // Apply both the 0.42 multiplier and then reduce to %
      return data.map(([timestamp, value]) => [timestamp, value * 0.42 * 0.02]);
    default:
      return data;
  }
};

/**
 * Fetches and parses CSV file
 * @param {string} csvFile - Path to CSV file
 * @param {string} dataType - Optional data type for preprocessing
 * @returns {Promise<Array<[number, number]>>} Promise resolving to parsed data
 */
const loadCsvFile = async (csvFile, dataType = null) => {
  try {
    const response = await fetch(csvFile);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${csvFile}: ${response.statusText}`);
    }
    const csvText = await response.text();
    const parsedData = parseCsvData(csvText);

    // Apply preprocessing if dataType is specified
    return dataType ? preprocessData(parsedData, dataType) : parsedData;
  } catch (error) {
    console.error(`Error loading CSV file ${csvFile}:`, error);
    return [];
  }
};

/**
 * Loads all CSV data files and structures them for chart consumption
 * @returns {Promise<Object>} Promise resolving to structured data object
 */
export const loadAllCsvData = async () => {
  try {
    const [
      pvParkHistorical,
      pvParkForecast,
      dimarxeioHistorical,
      dimarxeioForecast
    ] = await Promise.all([
      loadCsvFile(CSV_FILES.pvParkHistorical, 'pvParkHistorical'),
      loadCsvFile(CSV_FILES.pvParkForecast, 'pvParkForecast'), // Apply 0.75 multiplier
      loadCsvFile(CSV_FILES.dimarxeioHistorical, 'dimarxeioHistorical'),
      loadCsvFile(CSV_FILES.dimarxeioForecast, 'dimarxeioForecast')
    ]);

    return {
      pvPark: {
        historical: pvParkHistorical,
        forecast: pvParkForecast,
        combined: [...pvParkHistorical, ...pvParkForecast]
      },
      dimarxeio: {
        historical: dimarxeioHistorical,
        forecast: dimarxeioForecast,
        combined: [...dimarxeioHistorical, ...dimarxeioForecast]
      }
    };
  } catch (error) {
    console.error('Error loading CSV data:', error);
    return {
      pvPark: { historical: [], forecast: [], combined: [] },
      dimarxeio: { historical: [], forecast: [], combined: [] }
    };
  }
};

/**
 * Transforms loaded data into chart series format
 * @param {Object} csvData - Data object from loadAllCsvData()
 * @returns {Array} Array of chart series objects
 */
export const transformDataForChart = (csvData) => {
  if (!csvData) {
    return [];
  }

  const series = [];

  // PV Park Production
  if (csvData.pvPark.historical.length > 0) {
    series.push({
      name: 'PV Park Production (Historical)',
      data: csvData.pvPark.historical,
      color: '#eab308', // Yellow
      fillOpacity: 0.3,
      type: 'line',
      dashStyle: 'Solid'
    });
  }

  if (csvData.pvPark.forecast.length > 0) {
    series.push({
      name: 'PV Park Production (Forecast)',
      data: csvData.pvPark.forecast,
      color: '#eab308', // Yellow
      fillOpacity: 0.2,
      type: 'line',
      dashStyle: 'Dash'
    });
  }

  // Dimarxeio Consumption Data
  if (csvData.dimarxeio.historical.length > 0) {
    series.push({
      name: 'Dimarxeio Consumption (Historical)',
      data: csvData.dimarxeio.historical,
      color: '#16a34a', // Green
      fillOpacity: 0.3,
      type: 'line',
      dashStyle: 'Solid'
    });
  }

  if (csvData.dimarxeio.forecast.length > 0) {
    series.push({
      name: 'Dimarxeio Consumption (Forecast)',
      data: csvData.dimarxeio.forecast,
      color: '#16a34a', // Green
      fillOpacity: 0.2,
      type: 'line',
      dashStyle: 'Dash'
    });
  }

  return series;
};

/**
 * Convenience function to load data and transform it for chart consumption
 * @returns {Promise<Array>} Promise resolving to chart series array
 */
export const loadChartData = async () => {
  const csvData = await loadAllCsvData();
  return transformDataForChart(csvData);
};