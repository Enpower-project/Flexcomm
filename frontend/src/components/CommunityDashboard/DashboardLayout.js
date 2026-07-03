import React from 'react';
import { Box, Grid } from '@mui/material';

const DashboardLayout = ({ children, ...props }) => {
  return (
    <Box sx={{
      p: 2,
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
      fontFamily: 'Inter, Poppins, sans-serif'
    }} {...props}>
      <Grid container spacing={1.5}>
        {children}
      </Grid>
    </Box>
  );
};

export default DashboardLayout;