import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, FilePlus, Clock, Palette, Settings, Menu, FileText } from 'lucide-react'

const NAV_MAIN = [
  { to: '/', label: '仪表盘', icon: LayoutDashboard, end: true },
  { to: '/new', label: '新建申请', icon: FilePlus },
  { to: '/history', label: '历史记录', icon: Clock },
  { to: '/resumes', label: '简历', icon: FileText },
]

const NAV_BOTTOM = [
  { to: '/style', label: '样式', icon: Palette },
  { to: '/settings', label: '设置', icon: Settings },
]

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `relative flex items-center gap-3 mx-2 px-3 py-2.5 rounded-xl font-sans text-sm tracking-wide transition-colors ${isActive
      ? 'bg-[var(--primary-soft)] text-[var(--text-primary)]'
      : 'text-[var(--text-secondary)] hover:bg-[var(--primary-soft)]/50 hover:text-[var(--text-primary)]'
    }`

  return (
    <div className="flex flex-col h-full">
      <NavLink to="/" className="px-5 py-6 flex-shrink-0 block" onClick={onClose}>
        <span className="font-serif font-bold text-lg leading-tight text-[var(--text-primary)]">Jobhunt AI</span>
        <p className="font-sans text-xs text-[var(--text-muted)] mt-1">求职申请跟踪</p>
      </NavLink>

      <nav className="flex-1 py-2 space-y-0.5">
        {NAV_MAIN.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end} className={linkClass} onClick={onClose}>
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--primary)]" />}
                <n.icon className="h-4 w-4 flex-shrink-0" />
                {n.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-[var(--border)] py-3 space-y-0.5">
        {NAV_BOTTOM.map(n => (
          <NavLink key={n.to} to={n.to} className={linkClass} onClick={onClose}>
            {({ isActive }) => (
              <>
                {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-[var(--primary)]" />}
                <n.icon className="h-4 w-4 flex-shrink-0" />
                {n.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </div>
  )
}

export function SidebarLayout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex h-dvh bg-[var(--bg)]">

      <aside className="hidden md:flex flex-col w-60 bg-[var(--sidebar)] flex-shrink-0 border-r border-[var(--border)]">
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-[var(--text-primary)]/30 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-60 bg-[var(--sidebar)] border-r border-[var(--border)] flex flex-col md:hidden">
            <SidebarContent onClose={() => setMobileOpen(false)} />
          </aside>
        </>
      )}

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <header className="md:hidden flex items-center gap-3 px-4 h-12 border-b border-[var(--border)] bg-[var(--sidebar)] flex-shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-[var(--text-primary)] hover:opacity-60 transition-opacity"
            aria-label="打开菜单"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-serif font-bold text-sm text-[var(--text-primary)]">Jobhunt AI</span>
        </header>

        {children}
      </div>
    </div>
  )
}
