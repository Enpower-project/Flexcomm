// ImpactCard.js
import { Leaf, Factory, TreePine } from 'lucide-react';
import React from 'react';
import { Card, Typography, Box, Grid } from '@mui/material';

// --- Helper function to format numbers ---
const formatNumber = (num, decimals = 1) => {
  if (num === null || num === undefined || isNaN(num)) return 'N/A'; // Added check for NaN
  // Handle large numbers with commas for thousands separators and specified decimals
  const options = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  };
  return Number(num).toLocaleString(undefined, options); // Using localeString handles commas
};


const ImpactCard = ({ impactData }) => {


  const {
    co2Saved = 0,
    treeEquivalent = 0,
    coalSavings = 0
  } = impactData || {};


  // --- Define metrics using the PROPS ---
  const metrics = [
    {
      title: 'CO₂ Savings',
      value: `${formatNumber(co2Saved, 1)} tons`,
      icon: <Leaf />,
      color: '#16A34A' // green
    },
    {
      title: 'Tree Equivalent',
      value: `${formatNumber(treeEquivalent, 0)} trees`,
      icon: <TreePine />,
      color: '#16A34A' // green
    },
    {
      title: 'Lignite Savings',
      value: `${formatNumber(coalSavings, 1)} tons`,
      icon: <Factory />,
      color: '#6B7280' // gray
    }
  ];

  return (
    <Grid container spacing={1}>
      {metrics.map((metric, index) => (
        <Grid item xs={4} key={index}>
          <Card
            sx={{
              display: 'flex',
              boxShadow: 0,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2,
              height: '100px',
              flexDirection: 'row'
            }}
          >
            <Box
              sx={{
                flex: 3,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center', // Center text vertically
                padding: 1,
                pl: 2, // Left padding
              }}
            >
              <Typography variant="subtitle2" fontWeight="bold" noWrap sx={{ fontSize: '1rem' }}> {/* Added noWrap, adjust font size */}
                {metric.title}
              </Typography>
              <Typography variant="h6" color="textSecondary" noWrap sx={{ fontSize: '1.3rem' }}> {/* Added noWrap, adjust font size */}
                {metric.value}
              </Typography>
            </Box>
            <Box
              sx={{
                flex: 1,
                display: 'flex',
                alignItems: 'center', // Center icon vertically
                justifyContent: 'center', // Center icon horizontally
                // backgroundColor: 'background.default', // Optional background
              }}
            >
              {React.cloneElement(metric.icon, {
                size: 26, // Adjust icon size if needed
                color: metric.color
              })}
            </Box>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
};

export default ImpactCard;