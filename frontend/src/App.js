import { Route, Routes, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { PilotProvider, usePilot } from './context/PilotContext';

import Homepage from "./pages/Homepage";
import Layout from "./Layout/Layout";
import DashboardLayout from "./Layout/DashboardLayout";
import CommunityDashboard from './pages/CommunityDashboard';
import SelfConsumptionOptimization from './pages/SelfConsumptionOptimization';
import AnimatedChart from './pages/AnimatedChart';

// Get theme colors from CSS
let primary = getComputedStyle(document.documentElement).getPropertyValue('--primary-color').trim();
let secondary = getComputedStyle(document.documentElement).getPropertyValue('--secondary-color').trim();
let tertiary = getComputedStyle(document.documentElement).getPropertyValue('--tertiary-color').trim();
let selection = getComputedStyle(document.documentElement).getPropertyValue('--selection-color').trim();
let selectionHover = getComputedStyle(document.documentElement).getPropertyValue('--selection-hover-color').trim();
let primaryDark = getComputedStyle(document.documentElement).getPropertyValue('--primary-dark-color').trim();
let errorColor = getComputedStyle(document.documentElement).getPropertyValue('--error-color').trim();
let warningColor = getComputedStyle(document.documentElement).getPropertyValue('--warning-color').trim();
let successColor = getComputedStyle(document.documentElement).getPropertyValue('--success-color').trim();

const theme = createTheme({
    palette: {
        primary: {
            main: primary,
            dark: primaryDark
        },
        secondary: {
            main: secondary
        },
        background: {
            default: '#f5f5f5'
        },
        selection:{
            main: selection,
            hover: selectionHover
        },
        error: {
            main: errorColor
        },
        warning: {
            main: warningColor
        },
        success: {
            main: successColor
        }
    },
    typography: {
        fontFamily: [
            'Inter',
            'Poppins',
            'Segoe UI',
            'Roboto',
            '-apple-system',
            'BlinkMacSystemFont'
        ].join(','),
        h1: {
            fontWeight: 600,
            fontSize: '2.5rem',
        },
        h2: {
            fontWeight: 600,
            fontSize: '2rem',
        },
        h3: {
            fontWeight: 500,
            fontSize: '1.75rem',
        },
        h4: {
            fontWeight: 500,
            fontSize: '1.5rem',
        },
        h5: {
            fontWeight: 500,
            fontSize: '1.25rem',
        },
        h6: {
            fontWeight: 500,
            fontSize: '1.1rem',
        },
        body1: {
            fontSize: '1rem',
            lineHeight: 1.5,
        },
        body2: {
            fontSize: '0.875rem',
            lineHeight: 1.4,
        }
    }
});

function DashboardRoute() {
    const { pilot } = usePilot();
    if (pilot === 'hu') return <Navigate to="/" replace />;
    return (
        <DashboardLayout>
            <CommunityDashboard />
        </DashboardLayout>
    );
}

function App() {
    return (
        <PilotProvider>
        <ThemeProvider theme={theme}>
            <Routes>
                <Route path="/dashboard" element={<DashboardRoute />} />

                <Route path="/" element={<Homepage />} />

                <Route path="/self-consumption-optimization" element={
                    <Layout>
                        <SelfConsumptionOptimization />
                    </Layout>
                } />

                <Route path="/animated-chart" element={<AnimatedChart />} />

            </Routes>
        </ThemeProvider>
        </PilotProvider>
    );
}

export default App;