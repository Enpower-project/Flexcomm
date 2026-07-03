import {React, useState} from 'react';
import { useNavigate } from 'react-router-dom';
import { useKeycloak } from "@react-keycloak/web";
import {
    Box,
    Container,
    Typography,
    Card,
    CardContent,
    CardActions,
    Button,
    Grid,
    Chip,
    useTheme,
    AppBar,
    Toolbar,
    Avatar,
    Menu,
    MenuItem,
    IconButton
} from '@mui/material';
import {
    Dashboard,
    WbSunny,
    TrendingUp,
    Lightbulb,
    Group,
    Person,
    AccountCircle,
    ExitToApp
} from '@mui/icons-material';
import { usePilot } from '../context/PilotContext';


const Homepage = () => {
    const navigate = useNavigate();
    const theme = useTheme();
    const { keycloak } = useKeycloak();
    const [anchorEl, setAnchorEl] = useState(null);
    const { pilot: currentPilot } = usePilot();

    const handleProfileMenuOpen = (event) => {
        setAnchorEl(event.currentTarget);
    };

    const handleProfileMenuClose = () => {
        setAnchorEl(null);
    };

    const handleSignOut = () => {
        keycloak.logout();
        handleProfileMenuClose();
    };

    const features = [
        {
            id: 'community',
            title: 'Community Dashboard',
            subtitle: 'Real-Time Energy Insights',
            description: 'Monitor your community\'s energy production and consumption in real-time. Track PV generation, optimize load distribution, and discover the best times for energy use.',
            icon: <Group sx={{ fontSize: 40 }} />,
            features: ['Real-time monitoring', 'PV production tracking', 'Load optimization', 'Community insights'],
            link: '/dashboard',
            color: 'primary'
        },
        {
            id: 'self-consumption',
            title: 'Self-Consumption Optimization',
            subtitle: 'Smart Energy Management',
            description: 'Maximize your personal energy efficiency with AI-driven recommendations. Optimize cooling loads, monitor consumption patterns, and maintain comfort while saving energy.',
            icon: <Person sx={{ fontSize: 40 }} />,
            features: ['Personal optimization', 'Smart recommendations', 'Comfort maintenance', 'Energy savings'],
            link: '/self-consumption-optimization',
            color: 'secondary'
        }
    ];

    return (
        <Box data-testid="homepageOverall" sx={{ minHeight: '100vh', bgcolor: 'grey.50' }}>
            {/* Top Header */}
            <AppBar position="static" elevation={0} sx={{ bgcolor: 'white', borderBottom: '1px solid', borderColor: 'grey.200' }}>
                <Container maxWidth="lg">
                    <Toolbar sx={{ py: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
                        {/* Logo on the left */}
                        <Box sx={{ position: 'absolute', left: 0 }}>
                            <img
                                src="/images/enpower2.png"
                                alt="ENPOWER logo"
                                height="35px"
                                style={{ objectFit: 'contain' }}
                            />
                        </Box>

                        {/* Centered title */}
                        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                            <Typography
                                variant="h5"
                                sx={{
                                    background: `linear-gradient(45deg, ${theme.palette.primary.main} 30%, ${theme.palette.secondary.main} 90%)`,
                                    backgroundClip: 'text',
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    fontWeight: 700,
                                    letterSpacing: '0.5px'
                                }}
                            >
                                FLEXCOMM: Smart Energy Optimization Tool
                            </Typography>
                        </Box>

                        {/* Profile on the right */}
                        {keycloak.authenticated && (
                            <Box sx={{ position: 'absolute', right: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="body2" sx={{ color: 'text.secondary', mr: 1 }}>
                                    Welcome, {keycloak?.tokenParsed?.preferred_username}
                                </Typography>
                                <IconButton
                                    onClick={handleProfileMenuOpen}
                                    sx={{ color: 'text.primary' }}
                                >
                                    <AccountCircle />
                                </IconButton>
                                <Menu
                                    anchorEl={anchorEl}
                                    open={Boolean(anchorEl)}
                                    onClose={handleProfileMenuClose}
                                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                                >
                                    <MenuItem onClick={handleSignOut}>
                                        <ExitToApp sx={{ mr: 1 }} />
                                        Sign Out
                                    </MenuItem>
                                </Menu>
                            </Box>
                        )}
                    </Toolbar>
                </Container>
            </AppBar>

            {/* Hero Section */}
            <Box
                sx={{
                    background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 100%)`,
                    color: 'white',
                    py: 5,
                    position: 'relative',
                    overflow: 'hidden'
                }}
            >
                <Container maxWidth="lg">
                    <Grid container spacing={4} alignItems="center">
                        <Grid item xs={12} md={8}>
                            <Typography variant="h2" component="h1" gutterBottom sx={{ fontWeight: 'bold' }}>
                                Smart Energy for
                                <br />
                                Sustainable Communities
                            </Typography>
                            <Typography variant="h5" sx={{ opacity: 0.9, mb: 4, fontWeight: 300 }}>
                                Optimize energy consumption, track community performance, and maximize renewable energy usage with intelligent insights.
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                <Chip icon={<WbSunny />} label="Renewable Energy" variant="outlined" sx={{ color: 'white', borderColor: 'white' }} />
                                <Chip icon={<TrendingUp />} label="Real-time Analytics" variant="outlined" sx={{ color: 'white', borderColor: 'white' }} />
                                <Chip icon={<Lightbulb />} label="Smart Optimization" variant="outlined" sx={{ color: 'white', borderColor: 'white' }} />
                            </Box>
                        </Grid>
                        <Grid item xs={12} md={4}>
                            <Box
                                sx={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    height: 250
                                }}
                            >
                                <Dashboard sx={{ fontSize: 180, opacity: 0.3 }} />
                            </Box>
                        </Grid>
                    </Grid>
                </Container>
            </Box>

            {/* Features Section */}
            <Container maxWidth="lg" sx={{ py: 8 }}>
                <Box sx={{ textAlign: 'center', mb: 6 }}>
                    {currentPilot === 'hu' ? (
                        <>
                            <Typography variant="h3" component="h2" gutterBottom sx={{ fontWeight: 'bold' }}>
                                Find out your personalized energy statistics and optimize your consumption.
                            </Typography>
                            <Typography variant="h6" color="text.secondary" sx={{ maxWidth: 700, mx: 'auto' }}>
                                In collaboration with{' '}
                                <a
                                    href="https://bcsenergia.hu"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: 'inherit', fontWeight: 600 }}
                                >
                                    BCS Energia
                                </a>
                            </Typography>
                        </>
                    ) : (
                        <>
                            <Typography variant="h3" component="h2" gutterBottom sx={{ fontWeight: 'bold' }}>
                                Choose Your Energy Journey
                            </Typography>
                            <Typography variant="h6" color="text.secondary" sx={{ maxWidth: 600, mx: 'auto' }}>
                                Whether you're managing community resources or optimizing personal consumption,
                                we have the tools to help you achieve your energy goals.
                            </Typography>
                        </>
                    )}
                </Box>

                <Grid container spacing={4} sx={{ justifyContent: "center" }}>
                    {
                    features.filter((feature) =>
                        !(currentPilot === 'hu' && feature.id === 'community')
                    )
                    .map((feature) => (
                        <Grid item xs={12} md={currentPilot === 'hu' ? 12 : 6} key={feature.id}>
                            <Card
                                data-testid="homepageItem"
                                sx={{
                                    height: '100%',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
                                    '&:hover': {
                                        transform: 'translateY(-4px)',
                                        boxShadow: theme.shadows[8]
                                    }
                                }}
                            >
                                <CardContent sx={{ flexGrow: 1, p: 4 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                                        <Box
                                            sx={{
                                                p: 1.5,
                                                borderRadius: 2,
                                                bgcolor: `${feature.color}.light`,
                                                color: `${feature.color}.contrastText`,
                                                mr: 2
                                            }}
                                        >
                                            {feature.icon}
                                        </Box>
                                        <Box>
                                            <Typography variant="h5" component="h3" gutterBottom sx={{ fontWeight: 'bold' }}>
                                                {feature.title}
                                            </Typography>
                                            <Typography variant="subtitle1" color="text.secondary">
                                                {feature.subtitle}
                                            </Typography>
                                        </Box>
                                    </Box>

                                    <Typography variant="body1" paragraph sx={{ mb: 3 }}>
                                        {feature.description}
                                    </Typography>

                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                        {feature.features.map((item, index) => (
                                            <Chip
                                                key={index}
                                                label={item}
                                                size="small"
                                                variant="outlined"
                                                color={feature.color}
                                            />
                                        ))}
                                    </Box>
                                </CardContent>

                                <CardActions sx={{ p: 4, pt: 0 }}>
                                    <Button
                                        variant="contained"
                                        color={feature.color}
                                        size="large"
                                        fullWidth
                                        onClick={() => navigate(feature.link)}
                                        sx={{ py: 1.5 }}
                                    >
                                        Get Started
                                    </Button>
                                </CardActions>
                            </Card>
                        </Grid>
                    ))}
                </Grid>
            </Container>
        </Box>
    );
}

export default Homepage;
