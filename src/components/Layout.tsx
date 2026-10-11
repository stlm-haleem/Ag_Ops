import { ReactNode, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { BarChart3, ChevronDown, ChevronRight, Database, FileText, LayoutDashboard, Settings, Users, Globe2, Loader2, AlertTriangle } from 'lucide-react'
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
  const { loading, progress, error, dataset } = useData()
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
        <div className="mt-auto px-3 pt-4 text-xs text-slate-500">
          {loading ? <span className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" />{progress || 'Loading…'}</span>
            : dataset ? <>Data: {dataset.source === 'sheet' ? 'Google Sheet (live)' : dataset.source === 'drive' ? 'Google Drive import' : dataset.source === 'excel' ? 'Excel import' : 'Browser cache'}</> : 'No data loaded'}
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        {/* mobile nav */}
        <div className="flex gap-2 overflow-x-auto bg-slate-900 p-2 md:hidden">
          {[['/', 'Dashboard'], ['/currency/bdt/ssg', 'BDT-SSG'], ['/admin/data-sources', 'Data'], ['/admin/settings', 'Settings']].map(([to, l]) => (
            <NavLink key={to} to={to} end className={({ isActive }) => `whitespace-nowrap rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-brand-600 text-white' : 'text-slate-300'}`}>{l}</NavLink>
          ))}
        </div>
        {error && (
          <div className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>
        )}
        <div className="mx-auto max-w-[1500px] space-y-6 p-4 md:p-6">{children}</div>
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
