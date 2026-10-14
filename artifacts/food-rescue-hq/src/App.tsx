import { useEffect, useRef } from 'react';
import { mountDashboard } from './dashboard-runtime.js';

// Mounts the shared rescue chat; API calls go through this app's base path.
export default function App() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => (root.current ? mountDashboard(root.current, { apiBase: import.meta.env.BASE_URL.replace(/\/$/, '') }) : undefined), []);
  return <div ref={root} />;
}
