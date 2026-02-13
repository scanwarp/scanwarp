import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import { Layout } from './components/Layout';
import { Overview } from './pages/Overview';
import { Monitors } from './pages/Monitors';
import { MonitorDetail } from './pages/MonitorDetail';
import { Events } from './pages/Events';
import { Incidents } from './pages/Incidents';
import { IncidentDetail } from './pages/IncidentDetail';
import { Traces } from './pages/Traces';
import { TraceDetail } from './pages/TraceDetail';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Overview />} />
          <Route path="/monitors" element={<Monitors />} />
          <Route path="/monitors/:id" element={<MonitorDetail />} />
          <Route path="/events" element={<Events />} />
          <Route path="/incidents" element={<Incidents />} />
          <Route path="/incidents/:id" element={<IncidentDetail />} />
          <Route path="/traces" element={<Traces />} />
          <Route path="/traces/:traceId" element={<TraceDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
