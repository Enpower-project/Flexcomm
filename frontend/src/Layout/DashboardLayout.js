import React, { useState, useEffect } from 'react';
import { Box, AppBar, Toolbar, Typography } from '@mui/material';
import { styled } from '@mui/material/styles';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { Footer } from '../components/LayoutComponents';
import FooterContent from '../components/FooterContent';

const DashboardContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh', // Changed from height to minHeight
  backgroundColor: theme.palette.background.default
}));

const DashboardContent = styled(Box)(({ theme }) => ({
  flexGrow: 1,
  overflow: 'auto', // Changed from 'hidden' to 'auto'
  padding: theme.spacing(3),
  paddingTop: theme.spacing(2),
  // Add some padding at the bottom to ensure last elements are visible
  paddingBottom: theme.spacing(4)
}));

const DashboardLayout = ({ children }) => {
  const [currentTime, setCurrentTime] = useState(new Date(Date.now()));

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date(Date.now())); // Maintain one hour offset
    }, 60000); // Update every minute

    return () => clearInterval(timer); // Cleanup on unmount
  }, []);
  return (
    <DashboardContainer>
      <AppBar position="sticky" sx={{
        background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.7) 8%, #64CCA4 15%, #244C94 100%)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)'
      }}>
        <Toolbar sx={{ minHeight: '72px', py: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Link to="/">
              <img
                src="/images/enpower2.png"
                alt="ENPOWER logo"
                style={{ height: '24px' }}
              />
            </Link>
          </Box>

          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)'
          }}>
            {/* <Box sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 50,
              height: 50,
              borderRadius: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.15)',
              backdropFilter: 'blur(10px)'
            }}>
              <MapPin size={32} color="white" />
            </Box> */}
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h5" sx={{
                color: 'white',
                fontWeight: 700,
                fontSize: '1.5rem',
                lineHeight: 1.2,
                textShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
                letterSpacing: '0.02em'
              }}>
                CHALKION ENERGY COMMUNITY
              </Typography>
              <Typography variant="body1" sx={{
                color: 'rgba(255, 255, 255, 0.9)',
                fontWeight: 500,
                fontSize: '0.95rem',
                textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)'
              }}>
                Chalki District Dashboard
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', ml: 'auto' }}>
            <Box sx={{
              textAlign: 'right',
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(10px)',
              borderRadius: '8px',
              px: 2,
              py: 1
            }}>
              <Typography variant="body2" sx={{
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: '0.85rem',
                fontWeight: 500,
                lineHeight: 1.2
              }}>
                {new Date().toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </Typography>
              <Typography variant="h6" sx={{
                color: 'white',
                fontSize: '1.1rem',
                fontWeight: 600,
                textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)'
              }}>
                {currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </Typography>
            </Box>
          </Box>
        </Toolbar>
      </AppBar>
      <DashboardContent>
        {children}
      </DashboardContent>
      <Footer sx={{ position: 'sticky', mt: 'auto' }}>
        <FooterContent />
      </Footer>
    </DashboardContainer>

  );
};

export default DashboardLayout;