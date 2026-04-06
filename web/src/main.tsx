import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import './index.css';

// Single QueryClient for the app. Defaults:
//   - staleTime 30s: most restaurant data (menu, tables) changes rarely; avoid
//     hammering the backend on every navigation.
//   - retry 1: backend errors are usually real; don't mask them with retries.
//   - refetchOnWindowFocus false: kiosk-style tablet POS doesn't need it and
//     it's noisy in dev.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
