import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, FilePlus, Clock, Palette, Settings, Menu, FileText } from 'lucide-react'

// ─── Nav config ────────────────────────────────────────────────────────────────

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

// ─── Sidebar content ───────────────────────────────────────────────────────────

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 px-3 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors ${isActive
      ? 'bg-black text-[#F0F0E8]'
      : 'text-[#4B5563] hover:bg-black/5 hover:text-black'
    }`

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <NavLink to="/" className="px-4 py-4 border-b-2 border-black flex-shrink-0 block hover:bg-black/5 transition-colors" onClick={onClose}>
        <span className="font-serif font-bold text-base leading-tight">Jobhunt AI</span>
        <p className="font-mono text-xs text-[#4B5563] mt-0.5">[ 求职申请跟踪 ]</p>
      </NavLink>

      {/* Main nav */}
      <nav className="flex-1 py-3">
        {NAV_MAIN.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end} className={linkClass} onClick={onClose}>
            <n.icon className="h-4 w-4 flex-shrink-0" />
            {n.label}
          </NavLink>
        ))}
      </nav>

      {/* Bottom nav */}
      <div className="border-t-2 border-black py-3">
        {NAV_BOTTOM.map(n => (
          <NavLink key={n.to} to={n.to} className={linkClass} onClick={onClose}>
            <n.icon className="h-4 w-4 flex-shrink-0" />
            {n.label}
          </NavLink>
        ))}
      </div>
    </div>
  )
}

// ─── SidebarLayout ─────────────────────────────────────────────────────────────

export function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="flex h-dvh bg-[#F0F0E8]">

      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 border-r-2 border-black bg-white flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-60 bg-white border-r-2 border-black flex flex-col md:hidden">
            <SidebarContent onClose={() => setMobileOpen(false)} />
          </aside>
        </>
      )}

      {/* Main area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 h-12 border-b-2 border-black bg-white flex-shrink-0">
          <button
            onClick={() => setMobileOpen(true)}
            className="text-black hover:opacity-60 transition-opacity"
            aria-label="打开菜单"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-serif font-bold text-sm">Jobhunt AI</span>
        </header>

        {children}
      </div>
    </div>
  )
}
