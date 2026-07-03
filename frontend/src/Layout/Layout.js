import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '@mui/material/styles';
import { useKeycloak } from "@react-keycloak/web";

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Drawer from '@mui/material/Drawer';
import CssBaseline from '@mui/material/CssBaseline';
import Toolbar from '@mui/material/Toolbar';
import List from '@mui/material/List';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ProfileIcon from '@mui/icons-material/AccountCircle';

import MenuIcon from '@mui/icons-material/Menu';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import HomeIcon from '@mui/icons-material/Home';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import BoltIcon from '@mui/icons-material/Bolt';
import TuneIcon from '@mui/icons-material/Tune';

import { Main, AppBar, DrawerHeader, Footer } from '../components/LayoutComponents';
import FooterContent from '../components/FooterContent';
import MenuButton from "./MenuButton";
import { appbarMenuButtonItems } from "./appbarMenuButtonItems";
import { usePilot } from '../context/PilotContext';

const drawerWidth = 240;

export default function Layout({ children }) {
    const { keycloak } = useKeycloak();
    const theme = useTheme();
    const [open, setOpen] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();
    const { pilot } = usePilot();

    const handleDrawerOpen = () => {
        setOpen(true)
    };
    const handleDrawerClose = () => setOpen(false);

    const navItems = [
        {
            title: 'Homepage',
            icon: <HomeIcon sx={{ color: theme.palette.primary.main }} />,
            path: '/'
        },
        ...(pilot !== 'hu' ? [{
            title: 'Dashboard',
            icon: <TuneIcon sx={{ color: theme.palette.primary.main }} />,
            path: '/dashboard'
        }] : []),
        {
            title: 'CLOC (Closed Loop Optimal Control)',
            icon: <BoltIcon sx={{ color: theme.palette.primary.main }} />,
            path: '/self-consumption-optimization'
        },
        {
            title: 'Profile',
            icon: <ProfileIcon sx={{ color: theme.palette.primary.main }} />,
            path: '/kek'
        },
    ];

    const handleSignOut = () => keycloak.logout();

    return (
        // 1. Overall Page Wrapper: Flex column, min 100vh height
        <Box 
            sx={{ 
                // display: 'flex', flexDirection: 'column', minHeight: '100vh' 
                minHeight: '100vh',
                width: '100%',
            }}>
            <CssBaseline />

            <AppBar position="fixed" open={open} sx={{
                background: 'linear-gradient(90deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.7) 8%, #64CCA4 15%, #244C94 100%)',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)'
            }}>
                <Toolbar sx={{ minHeight: '72px', py: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <IconButton
                            color="inherit"
                            aria-label="open drawer"
                            onClick={handleDrawerOpen}
                            edge="start"
                            sx={{ mr: 2, color: 'black', ...(open && { display: 'none' }) }}
                        >
                            <MenuIcon />
                        </IconButton>
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
                        <Box sx={{ textAlign: 'center' }}>
                            <Typography variant="h5" sx={{
                                color: 'white',
                                fontWeight: 700,
                                fontSize: '1.5rem',
                                lineHeight: 1.2,
                                textShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
                                letterSpacing: '0.02em'
                            }}>
                                SELF-CONSUMPTION & COMFORT OPTIMIZATION TOOL
                            </Typography>
                            <Typography variant="body1" sx={{
                                color: 'rgba(255, 255, 255, 0.9)',
                                fontWeight: 500,
                                fontSize: '0.95rem',
                                textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)'
                            }}>
                                Chalkion Energy Community Personalized System
                            </Typography>
                        </Box>
                    </Box>

                    {keycloak.authenticated === true && (
                        <Box sx={{ display: 'flex', alignItems: 'center', ml: 'auto' }}>
                            <Box sx={{
                                textAlign: 'right',
                                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                backdropFilter: 'blur(10px)',
                                borderRadius: '8px',
                                px: 2,
                                py: 1,
                                mr: 2
                            }}>
                                <Typography variant="body2" sx={{
                                    color: 'rgba(255, 255, 255, 0.9)',
                                    fontSize: '0.85rem',
                                    fontWeight: 500,
                                    lineHeight: 1.2
                                }}>
                                    Welcome, {keycloak?.tokenParsed?.preferred_username}
                                </Typography>
                            </Box>
                            <MenuButton subLinks={appbarMenuButtonItems} signout={handleSignOut} />
                        </Box>
                    )}
                </Toolbar>
            </AppBar>
            <Box 
            sx={{ width: '100%', minHeight: '100vh' }}
                // sx={{ display: 'flex', overflow: 'visible' }}
            >
                <Drawer
                    sx={{
                        width: '100%',
                        // flexShrink: 0,
                        '& .MuiDrawer-paper': {
                            width: '100%',
                            boxSizing: 'border-box',
                            // position: 'relative', // If drawer needs to scroll independently with Main
                            // height: '100%',
                        },
                    }}
                    variant="persistent"
                    anchor="left"
                    open={open}
                >
                    <DrawerHeader>
                        <IconButton onClick={handleDrawerClose}>
                            {theme.direction === 'ltr' ? <ChevronLeftIcon /> : <ChevronRightIcon />}
                        </IconButton>
                    </DrawerHeader>
                    <Divider />
                    <List>
                        {navItems.map(menuItem => (
                            <ListItem key={menuItem.path} disablePadding
                                sx={{
                                    background: location.pathname === menuItem.path ? `linear-gradient(290deg, ${theme.palette.primary.main} 5%, rgba(255,255,255,1) 100%)` : 'transparent',
                                    border: location.pathname === menuItem.path ? `1px solid ${theme.palette.primary.dark}` : '1px solid transparent', // Use theme colors
                                    borderRadius: '10px', margin: theme.spacing(1), width: `calc(100% - ${theme.spacing(2)})`
                                }}>
                                <ListItemButton onClick={() => navigate(menuItem.path)} sx={{ borderRadius: 'inherit' }}>
                                    <ListItemIcon>{menuItem.icon}</ListItemIcon>
                                    <ListItemText primary={
                                        <Typography fontWeight={500} fontSize={17} align={'left'}
                                            color={location.pathname === menuItem.path ? 'white' : 'text.primary'}>
                                            {menuItem.title}
                                        </Typography>} />
                                </ListItemButton>
                            </ListItem>
                        ))}
                    </List>
                    <Divider />
                </Drawer>

                <Main open={open} sx={{
                    flexGrow: 1, // Main from LayoutComponents should already have this for horizontal expansion
                    // background: '#fefefe',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'visible',
                    width: '100%',
                    width: '100%',
                    minHeight: '100vh',
                }}>
                    <DrawerHeader />
                    {children}
                </Main>
            </Box> 
           

         
            <Footer open={open} /* sx={{ position: 'sticky', mt: 'auto' }} NO - let it be pushed down */ >
                <FooterContent />
            </Footer>
        </Box>
    );
}