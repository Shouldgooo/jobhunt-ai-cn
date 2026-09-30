import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Application, THEMES, type QaMessage } from '@/lib/api'
import { statusLabel, themeLabel, PANEL_LABELS } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Download, ArrowLeft, RefreshCw, Save, BookmarkPlus, Sparkles } from 'lucide-react'
import { VerifiedChangeSummary } from '@/components/VerifiedChangeSummary'
import { AnalysisPanel } from '@/components/AnalysisPanel'
import { JobQaPanel } from '@/components/JobQaPanel'

type Tab = 'resume' | 'coverletter' | 'analysis' | 'qa'
type PanelTab = 'editor' | 'preview'

const STATUS_VARIANT: Record<string, any> = {
  not_started: 'not_started', applied: 'applied',
  followed_up: 'followed_up', interviewed: 'interviewed', rejected: 'rejected',
}

export default function Editor() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const [searchParams] = useSearchParams()
  const appId     = Number(id)

  const [app, setApp]                   = useState<Application | null>(null)
  const [tab, setTab]                   = useState<Tab>(searchParams.get('tab') === 'qa' ? 'qa' : 'resume')
  const [panelTab, setPanelTab]         = useState<PanelTab>('editor')
  const [markdown, setMarkdown]         = useState('')
  const [preview, setPreview]           = useState('')
  const [loadingApp, setLoadingApp]     = useState(true)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [saving, setSaving]             = useState(false)
  const [saveError, setSaveError]       = useState<string | null>(null)
  const [pdfLoading, setPdfLoading]     = useState<'resume' | 'coverletter' | null>(null)
  const [error, setError]               = useState<string | null>(null)
  const [saveAsTplOpen, setSaveAsTplOpen] = useState(false)
  const [tplName, setTplName]           = useState('')
  const [tplSaving, setTplSaving]       = useState(false)
  const [tplError, setTplError]         = useState<string | null>(null)
  const [rescoreOpen, setRescoreOpen]   = useState(false)
  const [rescoring, setRescoring]       = useState(false)
  const [rescoreJd, setRescoreJd]       = useState('')
  const [rescoreError, setRescoreError] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    api.getApplication(appId)
      .then(data => {
        setApp(data)
        setMarkdown(data.resume_md || '')
        setTplName(`${data.company} — ${data.job_title}`)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoadingApp(false))
  }, [appId])

  async function refreshPreview(md: string, currentTab: Tab, currentTheme?: string) {
    if (!md || currentTab === 'analysis' || currentTab === 'qa') return
    setLoadingPreview(true)
    try {
      const theme = currentTheme ?? app?.theme
      const { html } = await api.preview(md, currentTab, currentTab === 'resume' ? theme : undefined)
      setPreview(html)
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览失败')
    } finally {
      setLoadingPreview(false)
    }
  }

  async function handleThemeChange(newTheme: string) {
    if (!app) return
    setApp({ ...app, theme: newTheme })
    await api.patchApplication(appId, { theme: newTheme })
    refreshPreview(markdown, tab, newTheme)
  }

  useEffect(() => {
    if (!app) return
    if (tab === 'analysis' || tab === 'qa') return
    const newMd = tab === 'resume' ? app.resume_md || '' : app.cover_md || ''
    setMarkdown(newMd)
    refreshPreview(newMd, tab)
  }, [tab, app])

  const save = useCallback(async (value: string, currentTab: Tab, currentApp: Application | null) => {
    if (currentTab === 'analysis' || currentTab === 'qa') return
    setSaving(true)
    setSaveError(null)
    try {
      const field = currentTab === 'resume' ? 'resume_md' : 'cover_md'
      await api.patchApplication(appId, { [field]: value })
      if (currentApp) setApp({ ...currentApp, [field]: value })
    } catch {
      setSaveError('保存失败 — 更改未被保存')
    } finally {
      setSaving(false)
    }
  }, [appId])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (saveTimer.current) clearTimeout(saveTimer.current)
        save(markdown, tab, app)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [markdown, tab, app, save])

  function handleMarkdownChange(value: string) {
    setMarkdown(value)
    setSaveError(null)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(value, tab, app), 800)
  }

  async function handleDownload(type: 'resume' | 'coverletter') {
    if (pdfLoading) return
    setPdfLoading(type)
    try {
      const res = await fetch(api.getPdfUrl(appId, type))
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'PDF 生成失败')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${app?.company}_${app?.job_title}_${type}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 100)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDF 生成失败')
    } finally {
      setPdfLoading(null)
    }
  }

  async function handleRescore(jd?: string) {
    if (!app) return
    setRescoring(true)
    setRescoreError(null)
    try {
      const { fit_score } = await api.rescoreApplication(appId, jd)
      setApp({ ...app, fit_score, jd_text: jd ?? app.jd_text })
      setRescoreOpen(false)
      setRescoreJd('')
    } catch (e) {
      setRescoreError(e instanceof Error ? e.message : '重新评分失败')
    } finally {
      setRescoring(false)
    }
  }

  if (loadingApp) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[var(--bg)]">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-[var(--primary)]" />
          <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">[ 加载中… ]</span>
        </div>
      </div>
    )
  }

  if (error && !app) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[var(--bg)]">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-[var(--primary)]" />
          <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-primary)]">[ {error || '未找到该申请'} ]</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg)]">

      {/* ── Header ── */}
      <header className="bg-[var(--surface)] border-b border-[var(--border)] px-4 sm:px-6 h-12 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/')}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          {app && (
            <div className="min-w-0">
              <p className="font-sans font-semibold text-sm truncate">
                {app.company} — {app.job_title}{app.location ? ` · ${app.location}` : ''}
              </p>
              <p className="font-mono text-xs text-[var(--text-secondary)] hidden sm:block">{app.created_at.slice(0, 10)}</p>
            </div>
          )}
          {app && (
            <Badge variant={STATUS_VARIANT[app.status]} className="hidden sm:inline-flex flex-shrink-0">
              {statusLabel(app.status)}
            </Badge>
          )}
          {app && (
            <span className="hidden sm:inline-flex font-mono text-xs text-[var(--text-secondary)] flex-shrink-0">
              匹配分：<span className={`ml-1 font-bold ${app.fit_score >= 70 ? 'text-[var(--text-primary)]' : app.fit_score >= 50 ? 'text-neutral-600' : app.fit_score > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                {app.fit_score > 0 ? app.fit_score : '暂无'}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {saving && (
            <span className="font-mono text-xs text-[var(--text-secondary)] hidden sm:flex items-center gap-1 uppercase">
              <Loader2 className="h-3 w-3 animate-spin" /> 保存中
            </span>
          )}
          <Button
            size="sm" variant="outline" className="h-7 text-xs hidden sm:flex"
            onClick={() => { if (saveTimer.current) clearTimeout(saveTimer.current); save(markdown, tab, app) }}
            disabled={saving}
          >
            <Save className="h-3.5 w-3.5" /> 保存
          </Button>
          {tab === 'resume' && (
            <Button
              size="sm" variant="outline" className="h-7 text-xs hidden sm:flex"
              onClick={() => setSaveAsTplOpen(true)}
            >
              <BookmarkPlus className="h-3.5 w-3.5" /> 另存为模板
            </Button>
          )}
          {tab === 'resume' && (
            <Button
              size="sm" variant="outline" className="h-7 text-xs hidden sm:flex"
              onClick={() => app?.jd_text ? handleRescore() : setRescoreOpen(true)}
              disabled={rescoring}
            >
              {rescoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              重新评分
            </Button>
          )}
          {tab === 'resume' && app && (
            <Select value={app.theme || 'classic'} onValueChange={handleThemeChange}>
              <SelectTrigger className="h-7 text-xs w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEMES.map(t => (
                  <SelectItem key={t} value={t}>{themeLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            size="sm" variant="outline" className="h-7 text-xs hidden sm:flex"
            onClick={() => handleDownload('resume')}
            disabled={pdfLoading !== null}
          >
            {pdfLoading === 'resume' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            简历
          </Button>
          <Button
            size="sm" variant="outline" className="h-7 text-xs hidden sm:flex"
            onClick={() => handleDownload('coverletter')}
            disabled={pdfLoading !== null}
          >
            {pdfLoading === 'coverletter' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            求职信
          </Button>
          <Button
            size="sm" variant="outline" className="h-7 text-xs sm:hidden"
            onClick={() => handleDownload(tab === 'resume' ? 'resume' : 'coverletter')}
            disabled={pdfLoading !== null}
          >
            {pdfLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            PDF
          </Button>
        </div>
      </header>

      {/* ── Document tabs ── */}
      <div className="flex border-b border-[var(--border)] bg-[var(--surface)] flex-shrink-0">
        {(['resume', 'coverletter', 'analysis', 'qa'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 font-mono text-xs uppercase tracking-wider border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-[var(--border)] text-[var(--text-primary)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t === 'coverletter' ? '求职信' : t === 'analysis' ? '分析' : t === 'qa' ? '追问' : '简历'}
          </button>
        ))}
      </div>

      {/* ── Banners ── */}
      {saveError && (
        <div className="border-b border-[var(--border)] bg-neutral-200 px-4 py-2 flex items-center gap-2 flex-shrink-0">
          <div className="w-2.5 h-2.5 rounded-sm bg-[var(--primary)] flex-shrink-0" />
          <span className="font-mono text-xs text-[var(--text-primary)] uppercase tracking-wider">{saveError}</span>
        </div>
      )}
      {app && tab !== 'analysis' && tab !== 'qa' && <VerifiedChangeSummary raw={app.change_summary} />}

      {tab === 'coverletter' && app && !app.cover_md && (
        <div className="border-b border-[var(--border)] bg-neutral-100 px-4 py-2 flex items-center gap-2 flex-shrink-0">
          <div className="w-2.5 h-2.5 bg-neutral-1000 flex-shrink-0" />
          <span className="font-mono text-xs text-[var(--text-primary)] uppercase tracking-wider">
            求职信模板未找到 — 请添加 <code className="normal-case">user/cover-letter/template.md</code> 以启用
          </span>
        </div>
      )}

      {/* ── Mobile panel toggle ── */}
      {tab !== 'analysis' && tab !== 'qa' && (
      <div className="sm:hidden flex border-b border-[var(--border)] bg-[var(--bg)] flex-shrink-0">
        {(['editor', 'preview'] as PanelTab[]).map(p => (
          <button
            key={p}
            onClick={() => { setPanelTab(p); if (p === 'preview') refreshPreview(markdown, tab) }}
            className={`flex-1 py-2 font-mono text-xs uppercase tracking-wider transition-colors ${
              panelTab === p ? 'bg-[var(--surface)] text-[var(--text-primary)] border-b border-[var(--border)] -mb-px' : 'text-[var(--text-secondary)]'
            }`}
          >
            {PANEL_LABELS[p] ?? p}
          </button>
        ))}
      </div>
      )}

      {/* ── Save as template modal ── */}
      {saveAsTplOpen && (
        <div
          className="fixed inset-0 z-50 bg-[var(--text-primary)]/35 flex items-center justify-center p-4"
          onClick={() => setSaveAsTplOpen(false)}
        >
          <div
            className="bg-[var(--surface)] border border-[var(--border)] shadow-[var(--shadow)] w-full max-w-sm p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="font-serif text-xl font-bold">另存为模板</h2>
            <div className="space-y-1.5">
              <label className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">模板名称</label>
              <Input
                value={tplName}
                onChange={e => setTplName(e.target.value)}
                placeholder="我的简历模板"
                autoFocus
              />
            </div>
            {tplError && (
              <p className="font-mono text-xs text-[var(--text-primary)] uppercase tracking-wider">{tplError}</p>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => { setSaveAsTplOpen(false); setTplError(null) }}>
                取消
              </Button>
              <Button
                disabled={tplSaving || !tplName.trim()}
                onClick={async () => {
                  setTplSaving(true)
                  setTplError(null)
                  try {
                    await api.createTemplate({ name: tplName.trim(), markdown })
                    setSaveAsTplOpen(false)
                  } catch (e) {
                    setTplError(e instanceof Error ? e.message : '保存失败')
                  } finally {
                    setTplSaving(false)
                  }
                }}
              >
                {tplSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                保存
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rescore dialog ── */}
      {rescoreOpen && (
        <div
          className="fixed inset-0 z-50 bg-[var(--text-primary)]/35 flex items-center justify-center p-4"
          onClick={() => { setRescoreOpen(false); setRescoreError(null); setRescoreJd('') }}
        >
          <div
            className="bg-[var(--surface)] border border-[var(--border)] shadow-[var(--shadow)] w-full max-w-sm p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="font-serif text-xl font-bold">重新评分简历</h2>
            <p className="font-mono text-xs text-[var(--text-secondary)] uppercase tracking-wider">尚未保存职位描述 — 请粘贴一份以便对照评分</p>
            <div className="space-y-1.5">
              <label className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">职位描述</label>
              <textarea
                className="w-full h-40 resize-none border border-[var(--border)] px-3 py-2 font-mono text-xs focus:outline-none"
                value={rescoreJd}
                onChange={e => setRescoreJd(e.target.value)}
                placeholder="在此粘贴职位描述…"
                autoFocus
              />
            </div>
            {rescoreError && (
              <p className="font-mono text-xs text-[var(--text-primary)] uppercase tracking-wider">{rescoreError}</p>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => { setRescoreOpen(false); setRescoreError(null); setRescoreJd('') }}>
                取消
              </Button>
              <Button
                disabled={rescoring || !rescoreJd.trim()}
                onClick={() => handleRescore(rescoreJd.trim())}
              >
                {rescoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                评分
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Analysis panel ── */}
      {tab === 'qa' && app && (
        <JobQaPanel
          appId={appId}
          jdText={app.jd_text}
          rawThread={app.qa_thread}
          onThread={(thread: QaMessage[]) => setApp({ ...app, qa_thread: JSON.stringify(thread) })}
        />
      )}

      {tab === 'analysis' && app && (
        <AnalysisPanel fitScore={app.fit_score} changeSummary={app.change_summary} />
      )}

      {/* ── Split view ── */}
      <div className={`flex flex-1 overflow-hidden ${tab === 'analysis' || tab === 'qa' ? 'hidden' : ''}`}>

        {/* Editor panel */}
        <div className={`flex flex-col border-r border-[var(--border)] bg-[var(--surface)] ${
          panelTab === 'editor' ? 'flex-1' : 'hidden'
        } sm:flex sm:flex-1`}>
          <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--bg)] flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm bg-[var(--primary)]" />
              <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">Markdown</span>
            </div>
            {saving && <span className="font-mono text-xs text-[var(--text-secondary)] sm:hidden uppercase">保存中…</span>}
          </div>
          <textarea
            className="flex-1 resize-none px-4 py-3 font-mono text-xs leading-relaxed bg-[var(--surface)] focus:outline-none"
            value={markdown}
            onChange={e => handleMarkdownChange(e.target.value)}
            spellCheck={false}
            placeholder="暂无内容。"
          />
        </div>

        {/* Preview panel */}
        <div className={`flex flex-col bg-[var(--bg)] ${
          panelTab === 'preview' ? 'flex-1' : 'hidden'
        } sm:flex sm:flex-1`}>
          <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--bg)] flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm bg-[var(--primary)]" />
              <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">预览</span>
            </div>
            <button
              onClick={() => refreshPreview(markdown, tab)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title="刷新"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingPreview ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {preview
              ? <iframe srcDoc={preview} className="w-full h-full border border-[var(--border)] shadow-[var(--shadow)] bg-[var(--surface)]" title="预览" />
              : <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">[ 暂无预览 ]</div>
            }
          </div>
        </div>
      </div>
    </div>
  )
}
