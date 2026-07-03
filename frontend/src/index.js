import React from 'react';
import ReactDOM from 'react-dom/client';
import {BrowserRouter, Routes, Route} from 'react-router-dom';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import {ReactKeycloakProvider} from "@react-keycloak/web";
import my_keycloak from "./Keycloak";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // sensible default for dashboards
      retry: 1,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <QueryClientProvider client={queryClient}>
        <ReactKeycloakProvider authClient={my_keycloak} initOptions={{onLoad: 'login-required', checkLoginIframe: false}}>
            <BrowserRouter basename={''}>
                <Routes>
                    <Route path={'/*'} element={<App/>}/>
                </Routes>
            </BrowserRouter>
        </ReactKeycloakProvider>
    </QueryClientProvider>
);

reportWebVitals();
