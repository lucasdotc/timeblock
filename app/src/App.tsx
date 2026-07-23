import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, type PlannedBlock } from "./supabase";
import { Calendar } from "./Calendar";
import { Today } from "./Today";
import { Chat } from "./Chat";
import { BlockDetail } from "./BlockDetail";
import { AddForm } from "./AddForm";
import { FixedHours } from "./FixedHours";
import { Insights } from "./Insights";

function Logo({ className = "logo" }: { className?: string }) {
  // A calendar-column glyph: three time blocks stacked in a frame.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.6" />
      <rect x="6.5" y="6.5" width="5" height="4" rx="1" fill="currentColor" />
      <rect x="6.5" y="12.5" width="5" height="5" rx="1" fill="currentColor" opacity="0.55" />
      <rect x="13.5" y="6.5" width="4" height="7" rx="1" fill="currentColor" opacity="0.75" />
    </svg>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="center muted">Loading…</div>;
  if (!session) return <Login />;
  return <Dashboard email={session.user.email ?? ""} />;
}

function Login() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSignup = mode === "signup";

  function swap() {
    setMode(isSignup ? "signin" : "signup");
    setError(null);
    setNotice(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    if (isSignup) {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      // If email confirmation is on, there's no session yet — tell them to check mail.
      else if (!data.session) setNotice("Account created — check your email to confirm, then sign in.");
      // Otherwise onAuthStateChange logs them straight in.
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    }
    setBusy(false);
  }

  return (
    <div className="center">
      <form className="login" onSubmit={submit}>
        <div className="brand-mark">
          <Logo />
          <h1>Timeblock</h1>
        </div>
        <p className="sub">{isSignup ? "Create an account to plan your week." : "Sign in to plan your week."}</p>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={isSignup ? "new-password" : "current-password"} />
        {isSignup && <span className="faint small" style={{ marginTop: -6 }}>At least 6 characters.</span>}
        {error && <div className="error small">{error}</div>}
        {notice && <div className="notice small">{notice}</div>}
        <button type="submit" disabled={busy}>{busy ? (isSignup ? "Creating…" : "Signing in…") : isSignup ? "Create account" : "Sign in"}</button>
        <button type="button" className="link-btn" onClick={swap}>
          {isSignup ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </form>
    </div>
  );
}

function Dashboard({ email }: { email: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<"today" | "week">("today");
  const [selected, setSelected] = useState<PlannedBlock | null>(null);
  const [adding, setAdding] = useState(false);
  const [hours, setHours] = useState(false);
  const bump = () => setReloadKey((k) => k + 1);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          Timeblock
        </div>
        <nav className="tabs">
          <button className={`tab${tab === "today" ? " on" : ""}`} onClick={() => setTab("today")}>Today</button>
          <button className={`tab${tab === "week" ? " on" : ""}`} onClick={() => setTab("week")}>This week</button>
        </nav>
        <div className="spacer" />
        <button className="ghost hours-btn" onClick={() => setHours(true)} title="Fixed hours (work, sleep…)">Fixed hours</button>
        <button className="add-btn" onClick={() => setAdding(true)} title="Add a task or event" aria-label="Add">+</button>
        <span className="faint small">{email}</span>
        <button className="ghost" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <main className="content">
        <aside className="sidebar">
          <Chat onChanged={bump} />
        </aside>
        <div className="main-col">
          <Insights reloadKey={reloadKey} onChanged={bump} />
          {tab === "today" ? (
            <Today reloadKey={reloadKey} onSelect={setSelected} onChanged={bump} />
          ) : (
            <Calendar reloadKey={reloadKey} onSelect={setSelected} />
          )}
        </div>
      </main>
      {selected && <BlockDetail block={selected} onClose={() => setSelected(null)} onChanged={bump} />}
      {adding && <AddForm onClose={() => setAdding(false)} onChanged={bump} />}
      {hours && <FixedHours onClose={() => setHours(false)} onChanged={bump} />}
    </div>
  );
}
