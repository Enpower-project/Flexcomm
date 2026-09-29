import { Route, Routes, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { PilotProvider, usePilot } from './context/PilotContext';

import Homepage from "./pages/Homepage";
import Layout from "./Layout/Layout";
import DashboardLayout from "./Layout/DashboardLayout";
import CommunityDashboard from './pages/CommunityDashboard';
import SelfConsumptionOptimization from './pages/SelfConsumptionOptimization';
import AnimatedChart from './pages/AnimatedChart';

// Get theme colors from CSS. The fallbacks mirror src/index.css: Safari can
// return an empty value while the page is still loading (e.g. right after the
// Keycloak login redirect), and MUI's createTheme crashes on an empty color.
const cssColor = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

let primary = cssColor('--primary-color', '#76c893');
let secondary = cssColor('--secondary-color', '#244C94');
let selection = cssColor('--selection-color', '#619DBE');
let selectionHover = cssColor('--selection-hover-color', '#1a759f');
let primaryDark = cssColor('--primary-dark-color', '#444444');
let errorColor = cssColor('--error-color', '#ff5c5c');
let warningColor = cssColor('--warning-color', '#ffc814');
let successColor = cssColor('--success-color', '#75d16f');

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