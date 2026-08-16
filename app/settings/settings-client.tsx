"use client";

import { FormEvent, useEffect, useState } from "react";
import ThemeToggle from "../theme-toggle";

type AccountProfile = "paper" | "live";
type ProfileSummary = { configured: boolean; autoTrade: boolean; keyHint: string | null; source: "stored" | "legacy" | "none" };
type SettingsAccount = { user: { email: string; displayName: string }; profiles: Record<AccountProfile, ProfileSummary> };

const emptyProfiles: Record<AccountProfile, ProfileSummary> = {
  paper:{ configured:false,autoTrade:false,keyHint:null,source:"none" },
  live:{ configured:false,autoTrade:false,keyHint:null,source:"none" },
};

export default function SettingsClient({ displayName, email }:{ displayName:string;email:string }) {
  const [account,setAccount] = useState<SettingsAccount>({ user:{ displayName,email },profiles:emptyProfiles });
  const [profile,setProfile] = useState<AccountProfile>("paper");
  const [keyId,setKeyId] = useState("");
  const [secretKey,setSecretKey] = useState("");
  const [autoTrade,setAutoTrade] = useState(false);
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");

  useEffect(() => {
    const preferred = window.localStorage.getItem("pulse-active-profile");
    const initial:AccountProfile = preferred === "live" ? "live" : "paper";
    setProfile(initial);
    fetch("/api/settings").then(async (response) => {
      const result = await response.json() as SettingsAccount & { error?:string };
      if (!response.ok) throw new Error(result.error || "Account settings are unavailable.");
      setAccount(result);
      setAutoTrade(result.profiles[initial].autoTrade);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Account settings are unavailable.")).finally(() => setLoading(false));
  },[]);

  const chooseProfile = (next:AccountProfile) => {
    setProfile(next);
    setKeyId("");
    setSecretKey("");
    setAutoTrade(account.profiles[next].autoTrade);
    setMessage("");
    setError("");
    try { window.localStorage.setItem("pulse-active-profile",next); } catch { /* Selection remains active for this page. */ }
  };

  const save = async (event:FormEvent) => {
    event.preventDefault();setSaving(true);setMessage("Verifying this profile with Alpaca…");setError("");
    try {
      const response = await fetch("/api/settings",{ method:"PUT",headers:{ "content-type":"application/json" },body:JSON.stringify({ profile,keyId,secretKey,autoTrade }) });
      const result = await response.json() as SettingsAccount & { error?:string };
      if (!response.ok) throw new Error(result.error || "Settings could not be saved.");
      setAccount(result);setKeyId("");setSecretKey("");
      try { window.localStorage.setItem("pulse-active-profile",profile); } catch { /* Selection remains active for this page. */ }
      setMessage(`${profile === "live" ? "Live" : "Paper"} settings saved. This is now the preferred trading profile on this device.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Settings could not be saved.");setMessage(""); }
    finally { setSaving(false); }
  };

  const summary=account.profiles[profile];

  return <main className="settings-page">
    <header className="topbar">
      <a className="brand" href="/command-center" aria-label="Pulse command center"><span className="brand-mark">P</span><span>PULSE<span className="brand-dot">•</span>AI</span></a>
      <nav aria-label="Primary navigation">
        <a className="nav-home-item" href="/command-center">Command Center</a>
        <a className="nav-signals-item" href="/signals">Signals</a>
        <a className="nav-company-item" href="/company-analysis">Company Analysis</a>
        <a href="/market-intelligence">Market Intelligence</a>
        <a href="/valuation">Valuation</a>
        <a href="/mass-valuation">Mass Valuation</a>
        <a className="nav-overflow-item" href="/why-these-decisions">Why These Decisions</a>
        <a className="nav-overflow-item" href="/strategy-lab">Strategy Lab</a>
        <a className="nav-overflow-item" href="/positions">Positions</a>
        <a className="nav-tag nav-overflow-item" href="/transactions">Transactions</a>
        <a className="nav-overflow-item" href="/news-radar">News Radar</a>
        <a className="nav-active nav-overflow-item" href="/settings">Settings</a>
        <details className="nav-more nav-more-active">
          <summary aria-label="Open more navigation links">More <span aria-hidden="true">⌄</span></summary>
          <div className="nav-more-menu">
            <a className="nav-more-home" href="/command-center">Command Center</a>
            <a className="nav-more-signals" href="/signals">Signals</a>
            <a className="nav-more-company" href="/company-analysis">Company Analysis</a>
            <a href="/market-intelligence">Market Intelligence</a>
            <a href="/mass-valuation">Mass Valuation</a>
            <a href="/candlestick">Candlestick</a>
            <a href="/why-these-decisions">Why These Decisions</a><a href="/strategy-lab">Strategy Lab</a><a href="/positions">Positions</a><a href="/transactions">Transactions</a><a href="/news-radar">News Radar</a><a className="nav-active" href="/settings">Settings</a>
          </div>
        </details>
      </nav>
      <ThemeToggle />
      <div className="market-state"><span className="live-dot" /> ACCOUNT CONTROL <b>ALPACA</b><a className="account-button analysis-account" href="/command-center">{displayName}</a></div>
    </header>

    <section className="settings-hero">
      <div><div className="eyebrow">SECURE ACCOUNT CONTROL</div><h1>Choose the environment.<br /><em>Control the keys.</em></h1><p>Keep Paper and Live Alpaca credentials separate, choose which profile Pulse uses, and decide whether strategies may submit orders.</p></div>
      <aside><small>ACTIVE ON THIS DEVICE</small><strong>{profile.toUpperCase()}</strong><p>{profile === "live" ? "Production endpoint · real-money orders are possible when auto-trading is enabled." : "Sandbox endpoint · simulated orders only."}</p></aside>
    </section>

    <section className="settings-workspace" aria-label="Alpaca account settings">
      <aside className="settings-profile-panel">
        <small>TRADING ENVIRONMENT</small><h2>Paper or Live</h2><p>Selecting a profile changes the credentials you edit and makes it the preferred environment when you return to the dashboard.</p>
        <div className="environment-options" role="radiogroup" aria-label="Preferred Alpaca trading environment">
          <button type="button" role="radio" aria-checked={profile==="paper"} onClick={() => chooseProfile("paper")}><span><b>PAPER</b><small>Sandbox · simulated capital</small></span><i>{account.profiles.paper.configured?"CONNECTED":"SET UP"}</i></button>
          <button type="button" role="radio" aria-checked={profile==="live"} onClick={() => chooseProfile("live")}><span><b>LIVE</b><small>Production · real money</small></span><i>{account.profiles.live.configured?"CONNECTED":"SET UP"}</i></button>
        </div>
        <div className="profile-separation-note"><strong>Profiles stay isolated</strong><p>Credentials, positions, transactions, strategy controls, and performance history remain separate between Paper and Live.</p></div>
      </aside>

      <div className="settings-credentials-panel">
        <header><div><small>ALPACA {profile.toUpperCase()} PROFILE</small><h2>{profile === "live" ? "Production credentials" : "Paper credentials"}</h2></div><span className={summary.configured?"status-connected":"status-unconfigured"}>{summary.configured?"CONNECTED":"NOT CONNECTED"}</span></header>
        {loading ? <div className="settings-loading" role="status">Loading secure profile status…</div> : error && !summary.configured ? <div className="settings-page-error" role="alert">{error}</div> : <>
          {profile === "live" && <div className="live-account-warning"><strong>REAL-MONEY ACCOUNT</strong><p>Live keys connect to Alpaca’s production endpoint. Leave auto-trading disabled until you are ready for strategies to place real orders.</p></div>}
          {summary.configured && <div className="connection-status"><span>CONNECTED</span><strong>{summary.keyHint}</strong><small>{summary.source === "legacy" ? "Managed by the hosted environment" : "Encrypted for your signed-in account"}</small></div>}
          {summary.source === "legacy" ? <div className="owner-managed"><strong>HOST-MANAGED PAPER PROFILE</strong><p>These environment credentials are read-only here. You can still configure an independent Live profile.</p></div> : <form className="settings-page-form" onSubmit={save}>
            <label><span>API KEY ID</span><input value={keyId} onChange={(event) => setKeyId(event.target.value)} autoComplete="off" placeholder={summary.source === "stored"?"Leave blank to keep the current key":`Enter your ${profile} API key ID`} required={summary.source!=="stored"} /></label>
            <label><span>SECRET KEY</span><input type="password" value={secretKey} onChange={(event) => setSecretKey(event.target.value)} autoComplete="new-password" placeholder={summary.source === "stored"?"Leave blank to keep the current secret":`Enter your ${profile} secret key`} required={summary.source!=="stored"} /></label>
            <label className={`trade-toggle ${profile==="live"?"live-trade-toggle":""}`}><input type="checkbox" checked={autoTrade} onChange={(event) => setAutoTrade(event.target.checked)} /><span><strong>Enable {profile} auto-trading</strong><small>{profile === "live" ? "Permits real-money orders from enabled strategies." : "Permits simulated orders in the Alpaca sandbox."}</small></span></label>
            <button className="save-settings" disabled={saving}>{saving?"VERIFYING WITH ALPACA…":summary.source==="stored"?`SAVE ${profile.toUpperCase()} SETTINGS`:`CONNECT ${profile.toUpperCase()} ACCOUNT`}</button>
          </form>}
          {message && <p className="settings-message" role="status">{message}</p>}{error && <p className="settings-page-error" role="alert">{error}</p>}
        </>}
        <footer><span>Keys are verified against the matching Alpaca endpoint before saving.</span><span>Secrets are encrypted and never returned to the browser.</span></footer>
      </div>
    </section>
  </main>;
}
