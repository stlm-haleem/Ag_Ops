import { ReactNode, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { BarChart3, ChevronDown, ChevronRight, Database, FileText, LayoutDashboard, Settings, Users, Globe2, Loader2, AlertTriangle, Menu, X } from 'lucide-react'
import { useData } from '../lib/store'

const link = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-brand-600 text-white' : 'text-slate-300 hover:bg-white/10'}`
const sub = ({ isActive }: { isActive: boolean }) =>
  `block rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'}`

function Group({ icon, label, open: initial, children, match }: { icon: ReactNode; label: string; open?: boolean; children: ReactNode; match?: string }) {
  const loc = useLocation()
  const [open, setOpen] = useState(initial ?? false)
  const isOpen = open || (match ? loc.pathname.startsWith(match) : false)
  return (
    <div>
      <button onClick={() => setOpen(!isOpen)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-white/10">
        {icon}<span className="flex-1 text-left">{label}</span>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {isOpen && <div className="ml-6 mt-1 space-y-0.5 border-l border-white/10 pl-2">{children}</div>}
    </div>
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { loading, refreshing, progress, error, dataset, needsPasscode, submitPasscode } = useData()
  const [pw, setPw] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  if (needsPasscode) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <form className="card w-full max-w-sm space-y-4 p-6" onSubmit={e => { e.preventDefault(); submitPasscode(pw) }}>
        <div className="text-lg font-semibold">Payment Ops Monitor</div>
        <div className="text-sm text-slate-500">Enter the app passcode to continue.</div>
        <input autoFocus type="password" className="input w-full" value={pw} onChange={e => setPw(e.target.value)} placeholder="Passcode" />
        {pw && !loading && <div className="hidden" />}
        <button className="btn-primary w-full justify-center" disabled={loading || !pw}>{loading ? 'Checking…' : 'Unlock'}</button>
      </form>
    </div>
  )
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto bg-slate-900 p-3 md:flex">
        <div className="px-3 py-3 text-base font-semibold text-white">Payment Ops Monitor</div>
        <nav className="mt-2 space-y-1">
          <NavLink to="/" end className={link}><LayoutDashboard size={16} />Executive Dashboard</NavLink>

          <Group icon={<Users size={16} />} label="Operations" match="/operations">
            <NavLink to="/operations/all" className={sub}>All Agents</NavLink>
            <NavLink to="/operations/low" className={sub}>Low Balance</NavLink>
            <NavLink to="/operations/high" className={sub}>High Balance</NavLink>
            <NavLink to="/operations/alerts" className={sub}>Alerts</NavLink>
          </Group>

          <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Currencies</div>
          <Group icon={<Globe2 size={16} />} label="BDT" match="/currency/bdt" open>
            <NavLink to="/currency/bdt" end className={sub}>Overview</NavLink>
            <NavLink to="/currency/bdt/ssg" className={sub}>SSG</NavLink>
            <NavLink to="/currency/bdt/mcg" className={sub}>MCG <span className="text-[10px] text-slate-500">soon</span></NavLink>
            <NavLink to="/currency/bdt/local-bank" className={sub}>Local Bank <span className="text-[10px] text-slate-500">soon</span></NavLink>
          </Group>
          <Group icon={<Globe2 size={16} />} label="PKR" match="/currency/pkr">
            <NavLink to="/currency/pkr" end className={sub}>Overview</NavLink>
            <NavLink to="/currency/pkr/ssg" className={sub}>SSG</NavLink>
            <NavLink to="/currency/pkr/bangkok-pay" className={sub}>Bangkok-Pay</NavLink>
            <NavLink to="/currency/pkr/local-bank" className={sub}>Local Bank</NavLink>
          </Group>
          <Group icon={<Globe2 size={16} />} label="INR" match="/currency/inr">
            <NavLink to="/currency/inr" end className={sub}>Coming soon</NavLink>
          </Group>

          <div className="pt-4" />
          <NavLink to="/reports" className={link}><FileText size={16} />Reports</NavLink>
          <Group icon={<Settings size={16} />} label="Admin" match="/admin">
            <NavLink to="/admin/data-sources" className={sub}>Data Sources</NavLink>
            <NavLink to="/admin/settings" className={sub}>System Settings</NavLink>
          </Group>
        </nav>
        <div className="mt-auto space-y-1 px-3 pt-4 text-xs text-slate-500">
          {refreshing && <span className="flex items-center gap-1 text-sky-300"><Loader2 size={12} className="animate-spin" />{progress || (dataset ? 'Refreshing data in background…' : 'Loading…')}</span>}
          {dataset ? <>
            <div>Data: {dataset.source === 'sheet' ? 'Google Sheet (live)' : dataset.source === 'drive' ? 'Google Drive import' : dataset.source === 'excel' ? 'Excel import' : 'Browser cache'}</div>
            {dataset.updatedAt && <div>Data timestamp: {new Date(dataset.updatedAt).toLocaleString()}</div>}
            {dataset.source === 'cache' && <div className="text-amber-300">Saved copy · refresh in progress</div>}
          </> : !loading ? 'No data loaded' : null}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {/* Mobile header and full navigation drawer */}
        <header className="mobile-header md:hidden">
          <button type="button" className="mobile-menu-button" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileOpen} onClick={() => setMobileOpen(v => !v)}>
            {mobileOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">Payment Ops Monitor</div>
            <div className="truncate text-[11px] text-slate-400">{refreshing ? (progress || 'Updating data…') : dataset ? `Updated ${new Date(dataset.updatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Monitoring dashboard'}</div>
          </div>
          <NavLink to="/" end onClick={() => setMobileOpen(false)} className={({ isActive }) => `rounded-lg px-3 py-2 text-xs font-medium ${isActive ? 'bg-brand-600 text-white' : 'bg-white/10 text-slate-200'}`}>Dashboard</NavLink>
        </header>
        {mobileOpen && <>
          <button className="mobile-nav-backdrop md:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />
          <nav className="mobile-nav-drawer md:hidden" aria-label="Mobile navigation">
            <div className="mb-3 flex items-center justify-between px-2">
              <span className="text-sm font-semibold text-white">Navigation</span>
              <button className="rounded-lg p-2 text-slate-300 hover:bg-white/10" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={19} /></button>
            </div>
            <NavLink to="/" end onClick={() => setMobileOpen(false)} className={link}><LayoutDashboard size={16} />Executive Dashboard</NavLink>
            <div className="mobile-nav-section">Operations</div>
            <NavLink to="/operations/all" onClick={() => setMobileOpen(false)} className={link}><Users size={16} />All Agents</NavLink>
            <NavLink to="/operations/low" onClick={() => setMobileOpen(false)} className={link}>Low Balance</NavLink>
            <NavLink to="/operations/high" onClick={() => setMobileOpen(false)} className={link}>High Balance</NavLink>
            <NavLink to="/operations/alerts" onClick={() => setMobileOpen(false)} className={link}>Alerts</NavLink>
            <div className="mobile-nav-section">Currencies</div>
            <NavLink to="/currency/bdt" end onClick={() => setMobileOpen(false)} className={link}><Globe2 size={16} />BDT Overview</NavLink>
            <NavLink to="/currency/bdt/ssg" onClick={() => setMobileOpen(false)} className={link}>BDT · SSG</NavLink>
            <NavLink to="/currency/bdt/mcg" onClick={() => setMobileOpen(false)} className={link}>BDT · MCG</NavLink>
            <NavLink to="/currency/bdt/local-bank" onClick={() => setMobileOpen(false)} className={link}>BDT · Local Bank</NavLink>
            <NavLink to="/currency/pkr" end onClick={() => setMobileOpen(false)} className={link}><Globe2 size={16} />PKR Overview</NavLink>
            <NavLink to="/currency/pkr/ssg" onClick={() => setMobileOpen(false)} className={link}>PKR · SSG</NavLink>
            <NavLink to="/currency/pkr/bangkok-pay" onClick={() => setMobileOpen(false)} className={link}>PKR · Bangkok-Pay</NavLink>
            <NavLink to="/currency/pkr/local-bank" onClick={() => setMobileOpen(false)} className={link}>PKR · Local Bank</NavLink>
            <NavLink to="/currency/inr" onClick={() => setMobileOpen(false)} className={link}><Globe2 size={16} />INR</NavLink>
            <div className="mobile-nav-section">Reports & Admin</div>
            <NavLink to="/reports" onClick={() => setMobileOpen(false)} className={link}><FileText size={16} />Reports</NavLink>
            <NavLink to="/admin/data-sources" onClick={() => setMobileOpen(false)} className={link}><Database size={16} />Data Sources / Import</NavLink>
            <NavLink to="/admin/settings" onClick={() => setMobileOpen(false)} className={link}><Settings size={16} />System Settings</NavLink>
            <div className="mt-4 border-t border-white/10 px-3 pt-3 text-xs leading-5 text-slate-400">
              {dataset ? <><div>Source: {dataset.source === 'sheet' ? 'Google Sheets' : dataset.source === 'drive' ? 'Google Drive' : dataset.source === 'excel' ? 'Excel import' : 'Browser cache'}</div>{dataset.updatedAt && <div>Updated: {new Date(dataset.updatedAt).toLocaleString()}</div>}</> : loading ? 'Loading data…' : 'No data loaded'}
              {error && <div className="mt-1 text-amber-300">{error}</div>}
            </div>
          </nav>
        </>}
        {error && (
          <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>
        )}
        <div className="page-content mx-auto max-w-[1500px] space-y-6 p-4 md:p-6">{children}</div>
      </main>
    </div>
  )
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold text-slate-900">{title}</h1>{subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}</div>
      {right}
    </div>
  )
}

export function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <>
      <PageTitle title={title} />
      <div className="card flex flex-col items-center justify-center gap-2 p-16 text-center">
        <BarChart3 className="text-slate-300" size={40} />
        <div className="font-medium text-slate-600">Coming soon</div>
        <div className="max-w-md text-sm text-slate-400">{note ?? 'This page is a placeholder. We are starting with BDT-SSG; the rest will follow the same structure.'}</div>
      </div>
    </>
  )
}
export { Database }
