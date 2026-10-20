import { ReactNode } from 'react'
import { Health } from '../lib/types'

export function Kpi({ label, value, sub, tone = 'default', onClick, active }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' | 'info'; onClick?: () => void; active?: boolean }) {
  const ring = { default: 'text-slate-900', good: 'text-emerald-600', warn: 'text-amber-600', bad: 'text-rose-600', info: 'text-brand-600' }[tone]
  const Tag: any = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick} className={`card p-4 text-left ${onClick ? 'hover:border-brand-500 cursor-pointer' : ''} ${active ? 'ring-2 ring-brand-500' : ''}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${ring}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </Tag>
  )
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'purple' }) {
  const c = { slate: 'bg-slate-100 text-slate-700', green: 'bg-emerald-100 text-emerald-700', amber: 'bg-amber-100 text-amber-800', red: 'bg-rose-100 text-rose-700', blue: 'bg-sky-100 text-sky-700', purple: 'bg-violet-100 text-violet-700' }[tone]
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${c}`}>{children}</span>
}

export const HealthBadge = ({ h }: { h: Health }) =>
  h === 'low' ? <Badge tone="red">Low</Badge> : h === 'high' ? <Badge tone="amber">High</Badge> : <Badge tone="green">Healthy</Badge>

export function ChartCard({ title, children, height = 280, right }: { title: string; children: ReactNode; height?: number; right?: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2"><div className="text-sm font-semibold text-slate-700">{title}</div>{right}</div>
      <div style={{ height }}>{children}</div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-full items-center justify-center text-sm text-slate-400">{children}</div>
}
