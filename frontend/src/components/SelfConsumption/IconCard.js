import React from 'react';
import { Card, Typography, Box, IconButton, Tooltip } from '@mui/material';
import { Info } from 'lucide-react';

const IconCard = ({ title, description, icon, showInfoButton = false, infoTooltip = '' }) => {
  return (
    <Card
      sx={{
        display: 'flex',
        boxShadow: '-2px 2px 12px 4px rgba(0,0,0,0.3)',
        // border: '0.5px solid',
        // borderColor: 'rgba(148, 105, 71, 0.4)',
        borderRadius: 3,
        // height: '100%',
        width: '100%',
        height: 100,
        background: 'linear-gradient(135deg, #3A799A 0%, #5696b9 35%, #79aeca 100%)',
        backdropFilter: 'blur(16px) saturate(160%)'
      }}
    >
      {/* Left Side: Title and Description */}
      <Box
        sx={{
          flex: 2,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center', // Align items to the top
          alignItems: 'flex-start',
          paddingX: 3,
          paddingY: 1,
          overflow: 'hidden',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6" fontWeight="semiBold" color='rgb(255, 255, 255)'>
            {title}
          </Typography>
          {showInfoButton && infoTooltip && (
            <Tooltip title={infoTooltip} arrow placement="top">
              <IconButton size="small" sx={{ color: 'white', ml: 0.5, p: 0.5 }}>
                <Info size={16} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <Typography variant="body1" color="rgb(255, 255, 255)">
          {description}
        </Typography>
      </Box>

      {/* Right Side: Icon */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center', // Stretch to fill vertical space
          justifyContent: 'center',
          backgroundColor: 'transparent',
          padding: 1,
          maxWidth: '30%'
        }}
      >
        {icon && (
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'primary.main',
              width: '100%',
              height: '100%',
              padding: 1
            }}
          >
            {React.cloneElement(icon, { style: { height: '80%', width: 'auto' } })}
          </Box>
        )}
      </Box>
    </Card>
  );
};

export default IconCard;
