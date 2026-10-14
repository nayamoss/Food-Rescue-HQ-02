import { useEffect, useRef } from 'react';
import { mountDashboard } from './_runtime';
import './_group.css';

// Extracted from the existing public/index.html, not redesigned.
export function Current() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current ? mountDashboard(root.current) : undefined, []);
  return <div ref={root}>
<div className="shell">
    <header className="topbar">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 36 38" fill="none" aria-hidden="true"><path d="M18 33S4 25 4 15a8 8 0 0 1 14-5 8 8 0 0 1 14 5c0 10-14 18-14 18Z" fill="currentColor"/><path d="m12 18 4 4 8-9" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span>food rescue<span style={{color:"#2f6b50"}}> hq.</span></span>
      </div>
      <div className="live" id="connection" role="status"><span className="dot"></span><span id="connection-text">Connecting to HQ</span></div>
    </header>
    <main className="loading" id="dashboard" aria-busy="true">
      <div className="page-heading">
        <div><h1>A little coordination. A lot less waste.</h1><p className="subtitle">Your live command center for getting good food to good people.</p></div>
        <div className="workspace-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 21V8l9-5 9 5v13M8 21v-6h8v6M8 9h1m6 0h1"/></svg>Conference operations</div>
      </div>
      <div className="error" id="error" role="alert" hidden><span id="error-text"></span><button type="button" id="retry">Retry</button></div>
      <section className="incident card" aria-labelledby="incident-title">
        <div>
          <div className="incident-top"><span className="eyebrow">Current incident</span><span className="status" id="status" data-state="idle"><span className="dot"></span><span id="status-text">Idle</span></span></div>
          <h2 id="incident-title">Checking the kitchen…</h2>
          <p className="incident-note" id="incident-note">Getting the latest from your rescue team.</p>
          <div className="location" id="location" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><span id="location-text"></span></div>
        </div>
        <div className="timer-panel">
          <div className="timer-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>Safety window</div>
          <div className="timer" id="countdown" aria-label="Time remaining">--:--</div>
          <p className="timer-help" id="timer-help">Time remaining to rescue food</p>
        </div>
      </section>
      <section className="metrics" aria-label="Rescue totals">
        <div className="metric card"><div className="metric-label">Total<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 7 9-5 9 5v10l-9 5-9-5V7Zm0 0 9 5 9-5M12 12v10M7.5 4.5l9 5"/></svg></div><span className="metric-value" id="total">0</span><span className="metric-unit">portions</span></div>
        <div className="metric card"><div className="metric-label">Unclaimed<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7v5h4"/></svg></div><span className="metric-value" id="unclaimed">0</span><span className="metric-unit">portions</span></div>
        <div className="metric card"><div className="metric-label">Claimed<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 10h4v11H4zM8 11l6-8c2 0 2 2 1 6h4c2 0 2 2 1 5l-2 7H8"/></svg></div><span className="metric-value" id="claimed">0</span><span className="metric-unit">portions</span></div>
        <div className="metric card"><div className="metric-label">Rescued<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/></svg></div><span className="metric-value" id="rescued">0</span><span className="metric-unit">portions</span></div>
      </section>
      <section className="progress-card card" aria-label="Rescue progress">
        <div className="progress-title"><span>Rescue progress</span><strong id="progress-text">0% rescued</strong></div>
        <div className="progress-track" id="progress" role="progressbar" aria-label="Portions rescued" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}><div className="progress-fill" id="progress-fill"></div></div>
        <p className="progress-caption" id="progress-caption">Every portion picked up is a portion saved.</p>
      </section>
      <div className="lower-grid">
        <section className="card" aria-labelledby="volunteers-heading">
          <div className="section-heading"><h2 id="volunteers-heading">The rescue team</h2><span className="count-tag" id="volunteer-count">Loading team</span></div>
          <div className="table-wrap"><table><thead><tr><th scope="col">Name</th><th scope="col">Claimed</th><th scope="col">Picked up</th><th scope="col">Status</th></tr></thead><tbody id="volunteers"><tr><td colSpan={4} className="table-empty">Getting the team ready…</td></tr></tbody></table></div>
        </section>
        <section className="card feed-card" aria-labelledby="feed-heading">
          <div className="section-heading"><h2 id="feed-heading">Activity feed</h2><span className="eyebrow" style={{fontSize:8}}>Live updates</span></div>
          <ul className="feed" id="feed"></ul>
          <div className="empty-feed" id="feed-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M4 5h16v12H4zM8 21h8M12 17v4M7 11h3l2-3 2 6 2-3h2"/></svg><p>Quiet for now.</p><small>Rescue activity will appear here.</small></div>
        </section>
      </div>
      <section className="demo card" aria-label="Demo controls">
        <div className="demo-copy"><div className="demo-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 3h8M10 3v6l-6 10a1.3 1.3 0 0 0 1 2h14a1.3 1.3 0 0 0 1-2L14 9V3M7 15h10"/></svg></div><div><p className="demo-title">Take it for a test run</p><p className="demo-description">400 tacos. 45 minutes. See how a rescue unfolds.</p></div></div>
        <div className="actions">
          <button className="primary" type="button" id="create" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Create sample incident</button>
          <button type="button" id="fast-forward" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m3 5 8 7-8 7V5Zm10 0 8 7-8 7V5Z"/></svg>Fast-forward</button>
          <button className="reset" type="button" id="reset" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></svg>Reset</button>
        </div>
      </section>
    </main>
    <footer><span>Good food deserves a second chance.</span><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 12a7 7 0 0 1 14 0M3 12h3v7H3zM18 12h3v7h-3zM18 19c0 3-6 3-6 3"/></svg>Demo mode · No messages are sent</span></footer>
  </div>
  </div>;
}
