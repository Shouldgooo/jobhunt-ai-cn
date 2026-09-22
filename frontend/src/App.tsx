import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { SidebarLayout } from './components/AppSidebar'
import Dashboard from './pages/Dashboard'
import NewApplication from './pages/NewApplication'
import History from './pages/History'
import Settings from './pages/Settings'
import Editor from './pages/Editor'
import Style from './pages/Style'
import Resumes from './pages/Resumes'
import ResumeEditorPage from './pages/ResumeEditorPage'
import ResumeBuilderPage from './pages/ResumeBuilderPage'
import DemoCloneModal from './components/DemoCloneModal'
import { DEMO_MODE, registerDemoModalTrigger } from './lib/api'

// ─── Layout — adds scroll + padding for regular pages ──────────────────────────

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarLayout>
      <main className="flex-1 overflow-auto px-6 py-6 md:px-10 lg:px-14">
        <div className="max-w-6xl mx-auto w-full">
          {children}
        </div>
      </main>
    </SidebarLayout>
  )
}

// ─── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [demoModalOpen, setDemoModalOpen] = useState(false)

  useEffect(() => {
    if (DEMO_MODE) registerDemoModalTrigger(() => setDemoModalOpen(true))
  }, [])

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        {/* Full-screen pages — no sidebar */}
        <Route path="/editor/:id" element={<Editor />} />
        <Route path="/resumes/build" element={<ResumeBuilderPage />} />
        <Route path="/resumes/:id" element={<ResumeEditorPage />} />

        {/* Style — has its own SidebarLayout inside */}
        <Route path="/style" element={<Style />} />

        {/* Sidebar layout pages */}
        <Route path="*" element={
          <Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/new" element={<NewApplication />} />
              <Route path="/history" element={<History />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/resumes" element={<Resumes />} />
            </Routes>
          </Layout>
        } />
      </Routes>

      {DEMO_MODE && (
        <DemoCloneModal open={demoModalOpen} onClose={() => setDemoModalOpen(false)} />
      )}
    </BrowserRouter>
  )
}
