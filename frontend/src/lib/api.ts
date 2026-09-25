const BASE = '/api'

// ─── Demo mode ─────────────────────────────────────────────────────────────────

export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true'

/** Registered by App.tsx — called whenever a write action is attempted in demo mode */
let _demoModalTrigger: (() => void) | null = null
export function registerDemoModalTrigger(fn: () => void) { _demoModalTrigger = fn }
function triggerDemo() { _demoModalTrigger?.() }

// ─── Request ───────────────────────────────────────────────────────────────────

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || 'GET').toUpperCase()
  const url = `${BASE}${path}`
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const text = await res.text()
  let data: { error?: string }
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(
      `${method} ${url} 返回了非 JSON（HTTP ${res.status}）。后端是否已启动？`
    )
  }
  if (!res.ok) {
    throw new Error(data.error || `${method} ${url} 失败（${res.status}）：${res.statusText}`)
  }
  return data as T
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface Application {
  id: number
  created_at: string
  company: string
  job_title: string
  location?: string
  url: string
  source: string
  jd_text: string
  stack_used: string
  fit_score: number
  resume_md: string
  cover_md: string
  theme: string
  status: 'not_started' | 'applied' | 'followed_up' | 'interviewed' | 'rejected'
  status_log: string  // JSON: [{status, changed_at}]
  follow_up: number   // 0 | 1
  eval_score: number | null
  eval_recommendation: string | null
  eval_archetype: string | null
  eval_review: string | null  // JSON: {strengths, gaps, actions, summary}
}

export interface EvalResult {
  eval_score: number
  eval_recommendation: string
  eval_archetype: string
  eval_review: string
}

export interface ResumeTemplate {
  id: number
  name: string
  is_default: number
  created_at: string
  updated_at: string
  markdown?: string  // only present in GET /:id
}

export interface AnalyzeResult {
  id: number
  fit_score: number
  job_title: string
  company?: string
  location?: string
  detected_skills: string[]
  cover_letter_available: boolean
  theme: string
}

export const THEMES = ['classic', 'modern', 'executive', 'sidebar'] as const
export type ThemeName = typeof THEMES[number]


// ─── Applications ──────────────────────────────────────────────────────────────

export const api = {
  analyze(body: {
    job_title?: string
    company?: string
    location?: string
    jd: string
    url?: string
    source?: string
    theme?: string
    resume_template_id?: number
    generate_cover_letter?: boolean
  }, signal?: AbortSignal): Promise<AnalyzeResult> {
    if (DEMO_MODE) {
      triggerDemo()
      return import('./demo-data').then(m => m.DEMO_ANALYZE_RESULT)
    }
    return request('/analyze', { method: 'POST', body: JSON.stringify(body), signal })
  },

  createApplication(body: {
    job_title: string
    company: string
    location?: string
    resume_template_id?: number
    source?: string
    url?: string
    jd?: string
    theme?: string
  }): Promise<{ id: number }> {
    if (DEMO_MODE) { triggerDemo(); return Promise.resolve({ id: 1 }) }
    return request('/applications', { method: 'POST', body: JSON.stringify(body) })
  },

  getApplications(): Promise<Application[]> {
    if (DEMO_MODE) return import('./demo-data').then(m => m.DEMO_APPLICATIONS)
    return request('/applications')
  },

  getApplication(id: number): Promise<Application> {
    if (DEMO_MODE) return import('./demo-data').then(m => {
      const app = m.DEMO_APPLICATIONS.find(a => a.id === id) ?? m.DEMO_APPLICATIONS[0]
      return app
    })
    return request(`/applications/${id}`)
  },

  patchApplication(id: number, data: Partial<Application>): Promise<{ ok: boolean }> {
    if (DEMO_MODE) return Promise.resolve({ ok: true })
    return request(`/applications/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
  },

  deleteApplication(id: number): Promise<{ ok: boolean }> {
    if (DEMO_MODE) { triggerDemo(); return Promise.resolve({ ok: true }) }
    return request(`/applications/${id}`, { method: 'DELETE' })
  },

  rescoreApplication(id: number, jd?: string): Promise<{ fit_score: number }> {
    if (DEMO_MODE) { triggerDemo(); return Promise.resolve({ fit_score: 91 }) }
    return request(`/applications/${id}/rescore`, { method: 'POST', body: JSON.stringify(jd ? { jd } : {}) })
  },

  evaluateApplication(id: number): Promise<EvalResult> {
    if (DEMO_MODE) { triggerDemo(); return Promise.resolve({ eval_score: 78, eval_recommendation: 'Apply', eval_archetype: 'Backend / Platform Engineer', eval_review: '{}' }) }
    return request(`/applications/${id}/evaluate`, { method: 'POST' })
  },

  getPdfUrl(id: number, type: 'resume' | 'coverletter'): string {
    if (DEMO_MODE) return `${import.meta.env.BASE_URL}demo/${type === 'coverletter' ? 'coverletter' : 'resume'}.pdf`
    return `${BASE}/applications/${id}/pdf?type=${type}`
  },

  preview(markdown: string, type: 'resume' | 'coverletter', theme?: string): Promise<{ html: string }> {
    if (DEMO_MODE) return fetch(`${import.meta.env.BASE_URL}demo/preview.html`).then(r => r.text()).then(html => ({ html }))
    return request('/preview', { method: 'POST', body: JSON.stringify({ markdown, type, theme }) })
  },

  getProfile(): Promise<{ profile: string }> {
    if (DEMO_MODE) return Promise.resolve({ profile: '' })
    return request('/profile')
  },

  saveProfile(body: { profile: string }): Promise<{ ok: boolean }> {
    if (DEMO_MODE) { triggerDemo(); return Promise.resolve({ ok: true }) }
    return request('/profile', { method: 'PUT', body: JSON.stringify(body) })
  },

  getCv(): Promise<{ cv: string }> {
    if (DEMO_MODE) return Promise.resolve({ cv: '' })
    return request('/cv')
  },

  saveCv(body: { cv: string }): Promise<{ ok: boolean }> {
    if (DEMO_MODE) { triggerDemo(); return Promise.resolve({ ok: true }) }
    return request('/cv', { method: 'PUT', body: JSON.stringify(body) })
  },

  getCoverLetterTemplate(): Promise<{ template: string }> {
    if (DEMO_MODE) return Promise.resolve({ template: '' })
    return request('/cover-letter/template')
  },

  saveCoverLetterTemplate(body: { template: string }): Promise<{ ok: boolean }> {
    if (DEMO_MODE) { triggerDemo(); return Promise.resolve({ ok: true }) }
    return request('/cover-letter/template', { method: 'PUT', body: JSON.stringify(body) })
  },

  // ─── Style / Themes ─────────────────────────────────────────────────────────

  getStyle(): Promise<{ theme: string; css: string }> {
    if (DEMO_MODE) return Promise.resolve({ theme: 'classic', css: '' })
    return request('/style')
  },

  saveStyle(css: string, theme?: string): Promise<{ ok: boolean }> {
    if (DEMO_MODE) { triggerDemo(); return Promise.resolve({ ok: true }) }
    return request('/style', { method: 'PUT', body: JSON.stringify({ css, theme }) })
  },

  getThemes(): Promise<{ name: string; label: string; css: string }[]> {
    if (DEMO_MODE) return Promise.resolve(
      ['classic', 'modern', 'minimal', 'compact', 'bold'].map(name => ({ name, label: name.charAt(0).toUpperCase() + name.slice(1), css: '' }))
    )
    return request('/style/themes')
  },

  previewStyle(css: string, theme?: string): Promise<{ html: string }> {
    if (DEMO_MODE) return fetch(`${import.meta.env.BASE_URL}demo/preview.html`).then(r => r.text()).then(html => ({ html }))
    return request('/style/preview', { method: 'POST', body: JSON.stringify({ css, theme }) })
  },

  // ─── Resume Templates ────────────────────────────────────────────────────────

  getTemplates(): Promise<ResumeTemplate[]> {
    if (DEMO_MODE) return import('./demo-data').then(m => m.DEMO_TEMPLATES)
    return request('/resume-templates')
  },

  createTemplate(body: { name: string; markdown: string }): Promise<{ id: number }> {
    if (DEMO_MODE) { triggerDemo(); return Promise.resolve({ id: 1 }) }
    return request('/resume-templates', { method: 'POST', body: JSON.stringify(body) })
  },

  getTemplate(id: number): Promise<ResumeTemplate & { markdown: string }> {
    if (DEMO_MODE) return import('./demo-data').then(m => ({ ...m.DEMO_TEMPLATES[0], markdown: m.DEMO_RESUME_MD }))
    return request(`/resume-templates/${id}`)
  },

  updateTemplate(id: number, body: { name?: string; markdown?: string }): Promise<{ ok: boolean }> {
    if (DEMO_MODE) { triggerDemo(); return Promise.resolve({ ok: true }) }
    return request(`/resume-templates/${id}`, { method: 'PUT', body: JSON.stringify(body) })
  },

  deleteTemplate(id: number): Promise<{ ok: boolean }> {
    if (DEMO_MODE) { triggerDemo(); return Promise.resolve({ ok: true }) }
    return request(`/resume-templates/${id}`, { method: 'DELETE' })
  },

  setDefaultTemplate(id: number): Promise<{ ok: boolean }> {
    if (DEMO_MODE) { triggerDemo(); return Promise.resolve({ ok: true }) }
    return request(`/resume-templates/${id}/default`, { method: 'PATCH' })
  },

  buildTemplate(body: {
    name: string
    personal?: { name?: string; email?: string; phone?: string; location?: string; linkedin?: string; portfolio?: string }
    summary?: string
    skills?: { label: string; items: string }[]
    experience?: { title: string; company: string; location: string; start: string; end: string; current: boolean; bullets: string[] }[]
    education?: { degree: string; institution: string; location: string; year: string }[]
    certifications?: { name: string; date: string }[]
  }): Promise<{ id: number; markdown: string }> {
    if (DEMO_MODE) { triggerDemo(); return Promise.resolve({ id: 1, markdown: '' }) }
    return request('/resume-templates/build', { method: 'POST', body: JSON.stringify(body) })
  },
}
