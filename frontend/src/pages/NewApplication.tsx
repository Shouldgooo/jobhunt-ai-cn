import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type AnalyzeResult, type ResumeTemplate, THEMES } from '@/lib/api'
import { themeLabel } from '@/lib/labels'
import { parseJd, nextAutoField, createGenerationLock } from '@/lib/parse-jd'
import {
  applyAnalyzeEvent,
  INITIAL_GEN_PROGRESS,
  outcomeFromAnalyzeError,
  shouldTickElapsed,
  type GenProgressState,
} from '@/lib/analyze-stream'
import { GenerationProgress } from '@/components/GenerationProgress'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, ArrowRight, Save, Download } from 'lucide-react'
import {
  canShowGenerationDownloads,
  DEFAULT_AI_COVER_LETTER,
  DEFAULT_AI_RESUME,
  downloadExistingPdf,
  editorPathForApplication,
  generationSuccessCopy,
  nextCoverLetterSelection,
  shouldShowCoverLetterDownload,
} from '@/lib/new-application'

export default function NewApplication() {
  const navigate = useNavigate()

  const [form, setForm] = useState({
    job_title: '',
    company: '',
    location: '',
    source: 'linkedin',
    url: '',
    jd: '',
    theme: 'classic',
    resume_template_id: 0,   // 0 = use default
    ai_customize: DEFAULT_AI_RESUME,
    ai_cover_letter: DEFAULT_AI_COVER_LETTER,
  })
  const lastAuto = useRef({ job_title: '', company: '', location: '' })
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [genProgress, setGenProgress] = useState<GenProgressState>(INITIAL_GEN_PROGRESS)
  const [elapsedMs, setElapsedMs] = useState(0)
  const elapsedOrigin = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const userCancelledRef = useRef(false)
  const [result, setResult]         = useState<AnalyzeResult | null>(null)
  const [pdfLoading, setPdfLoading] = useState<'resume' | 'coverletter' | null>(null)
  const [pdfError, setPdfError]     = useState<string | null>(null)
  const [templates, setTemplates]   = useState<ResumeTemplate[]>([])
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const genLock = useRef(createGenerationLock())

  useEffect(() => {
    api.getTemplates().then(list => {
      setTemplates(list)
      const def = list.find(t => Number(t.is_default) === 1)
      if (def) setForm(f => ({ ...f, resume_template_id: def.id }))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!shouldTickElapsed(genProgress.phase)) return
    if (elapsedOrigin.current == null) elapsedOrigin.current = Date.now()
    const tick = () => setElapsedMs(Date.now() - (elapsedOrigin.current ?? Date.now()))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [genProgress.phase])

  const set = (k: keyof typeof form) => (v: string | number | boolean) =>
    setForm(f => ({ ...f, [k]: v }))

  const setManualField = (k: 'job_title' | 'company' | 'location') => (value: string) => {
    setForm(f => ({ ...f, [k]: value }))
  }

  function handleJDChange(newJD: string) {
    const extracted = parseJd(newJD)
    setForm(f => {
      const job_title = nextAutoField(f.job_title, extracted.job_title, lastAuto.current.job_title)
      const company   = nextAutoField(f.company, extracted.company, lastAuto.current.company)
      const location  = nextAutoField(f.location, extracted.location, lastAuto.current.location)
      lastAuto.current = {
        job_title: job_title === extracted.job_title ? extracted.job_title : lastAuto.current.job_title,
        company:   company   === extracted.company   ? extracted.company   : lastAuto.current.company,
        location:  location  === extracted.location  ? extracted.location  : lastAuto.current.location,
      }
      return { ...f, jd: newJD, job_title, company, location }
    })
  }

  const hasJd = form.jd.trim().length > 0
  const useAI = hasJd && form.ai_customize
  const extracted = parseJd(form.jd)

  async function handleSubmit() {
    if (!genLock.current.tryStart() || loading) return

    if (useAI && !hasJd) {
      genLock.current.finish()
      setError('请先粘贴职位描述。')
      return
    }
    if (!useAI && (!form.job_title || !form.company)) {
      genLock.current.finish()
      setError('职位名称和公司为必填项。')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)
    setPdfError(null)
    setGenProgress(INITIAL_GEN_PROGRESS)
    elapsedOrigin.current = Date.now()
    setElapsedMs(0)

    if (useAI) {
      const controller = new AbortController()
      abortRef.current = controller
      userCancelledRef.current = false
      setGenProgress({
        ...INITIAL_GEN_PROGRESS,
        phase: 'running',
        progress: 5,
        message: '请求已接受…',
        stage: 'accepted',
      })
      try {
        const data = await api.analyzeWithProgress({
          job_title:           form.job_title,
          company:             form.company,
          location:            form.location,
          jd:                  form.jd,
          url:                 form.url,
          source:              form.source,
          theme:               form.theme,
          resume_template_id:  form.resume_template_id || undefined,
          generate_cover_letter: form.ai_cover_letter,
        }, {
          signal: controller.signal,
          onEvent: (event) => setGenProgress(s => applyAnalyzeEvent(s, event)),
        })
        setGenProgress(s => applyAnalyzeEvent(s, {
          type: 'complete',
          progress: 100,
          message: '生成完成',
          application: data,
        }))
        setResult(data)
        if (data.job_title) setForm(f => ({ ...f, job_title: f.job_title || data.job_title }))
        if (data.company) setForm(f => ({ ...f, company: f.company || data.company || '' }))
        if (data.location) setForm(f => ({ ...f, location: f.location || data.location || '' }))
      } catch (err) {
        const outcome = outcomeFromAnalyzeError(err, {
          userCancelled: userCancelledRef.current,
        })
        setGenProgress(s => ({
          ...s,
          phase: outcome.phase,
          message: outcome.message,
          waitingOnModel: false,
          error: outcome.phase === 'error' ? outcome.message : undefined,
        }))
        if (outcome.phase === 'error') setError(outcome.message)
        else setError(null)
      } finally {
        abortRef.current = null
        setLoading(false)
        genLock.current.finish()
      }
    } else {
      try {
        const { id } = await api.createApplication({
          job_title:          form.job_title,
          company:            form.company,
          location:           form.location,
          resume_template_id: form.resume_template_id || undefined,
          source:             form.source,
          url:                form.url,
          jd:                 form.jd,
          theme:              form.theme,
        })
        navigate(`/editor/${id}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : '未知错误')
        setLoading(false)
        genLock.current.finish()
      }
    }
  }

  async function handleDownloadGenerated(type: 'resume' | 'coverletter') {
    if (!result?.id || pdfLoading) return
    setPdfLoading(type)
    setPdfError(null)
    try {
      await downloadExistingPdf(result.id, type, {
        company: result.company || form.company,
        job_title: result.job_title || form.job_title,
      }, fetch, api.getPdfUrl(result.id, type))
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'PDF 下载失败')
    } finally {
      setPdfLoading(null)
    }
  }

  function handleCancelGeneration() {
    userCancelledRef.current = true
    console.info('[cancel] frontend explicit user cancel')
    abortRef.current?.abort('USER_CANCELLED')
    setGenProgress(s => ({
      ...s,
      phase: 'cancelled',
      message: '生成已取消',
      waitingOnModel: false,
    }))
    setError(null)
  }

  async function handlePreview() {
    const tplId = form.resume_template_id
    if (!tplId) return
    setPreviewLoading(true)
    setPreviewOpen(true)
    try {
      const tpl = await api.getTemplate(tplId)
      const { html } = await api.preview(tpl.markdown || '', 'resume', form.theme)
      setPreviewHtml(html)
    } catch {
      setPreviewHtml(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  return (
    <div className="space-y-8">

      {/* Page header */}
      <div className="border-b border-[var(--border)] pb-4">
        <h1 className="font-serif text-3xl font-bold">新建申请</h1>
        <p className="font-sans text-sm text-[var(--text-secondary)] mt-1">
          选择主简历，粘贴职位描述。系统会自动识别职位名称、公司和地点，再一次性生成定制申请。
        </p>
      </div>

      {/* Form */}
      <div className="space-y-5">

        {/* Resume Template */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>简历模板</Label>
            {form.resume_template_id > 0 && (
              <button
                onClick={handlePreview}
                className="font-mono text-xs text-[var(--text-primary)] hover:underline uppercase tracking-wider"
              >
                预览 →
              </button>
            )}
          </div>
          <Select
            value={templates.some(t => t.id === form.resume_template_id) ? String(form.resume_template_id) : undefined}
            onValueChange={v => set('resume_template_id')(Number(v))}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择模板" />
            </SelectTrigger>
            <SelectContent>
              {templates.map(t => (
                <SelectItem key={t.id} value={String(t.id)}>
                  {t.name}{t.is_default ? '（默认）' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Row 2 — Source + Theme + URL */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>来源</Label>
            <Select value={form.source} onValueChange={set('source')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="linkedin">LinkedIn</SelectItem>
                <SelectItem value="seek">Seek</SelectItem>
                <SelectItem value="other">其他</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>主题</Label>
              {form.resume_template_id > 0 && (
                <button
                  onClick={handlePreview}
                  className="font-mono text-[10px] text-[var(--text-primary)] hover:underline uppercase tracking-wider"
                >
                  预览 →
                </button>
              )}
            </div>
            <Select value={form.theme} onValueChange={set('theme')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {THEMES.map(t => (
                  <SelectItem key={t} value={t}>{themeLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="url">
              职位链接 <span className="text-[var(--text-secondary)] normal-case font-sans text-xs">（选填）</span>
            </Label>
            <Input
              id="url"
              placeholder="https://..."
              value={form.url}
              onChange={e => set('url')(e.target.value)}
            />
          </div>
        </div>

        {/* JD */}
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="jd">职位描述</Label>
          </div>
          <Textarea
            id="jd"
            placeholder="在此粘贴完整职位描述。系统会自动识别职位名称、公司和地点，不会在输入时调用 AI。"
            className="min-h-44 resize-y"
            value={form.jd}
            onChange={e => handleJDChange(e.target.value)}
          />
        </div>

        {/* Auto-extracted metadata — editable */}
        <div className="space-y-3">
          <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">
            自动识别
            {hasJd && (extracted.job_title || extracted.company || extracted.location)
              ? ' — 可修改'
              : ' — 粘贴职位描述后自动填写'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="job_title">职位名称</Label>
              <Input
                id="job_title"
                placeholder="粘贴职位描述后自动识别"
                value={form.job_title}
                onChange={e => setManualField('job_title')(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company">公司</Label>
              <Input
                id="company"
                placeholder="粘贴职位描述后自动识别"
                value={form.company}
                onChange={e => setManualField('company')(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="location">地点</Label>
              <Input
                id="location"
                placeholder="粘贴职位描述后自动识别"
                value={form.location}
                onChange={e => setManualField('location')(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* F1 — short JD warning */}
        {form.jd.trim().length > 0 && form.jd.trim().length < 100 && (
          <div className="border border-[var(--border)] bg-neutral-100 px-3 py-2 flex items-start gap-2">
            <div className="w-3 h-3 bg-neutral-1000 flex-shrink-0 mt-0.5" />
            <p className="font-mono text-xs text-[var(--text-primary)] uppercase tracking-wider">
              职位描述过短（{form.jd.trim().length} 字）— AI 分析结果可能不准确
            </p>
          </div>
        )}

        {/* AI checkboxes — only when JD has content */}
        {hasJd && (
          <div className="border border-[var(--border)] bg-[var(--surface)] px-4 py-3 space-y-2">
            <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">AI 选项</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.ai_customize}
                onChange={e => {
                  const checked = e.target.checked
                  setForm(f => ({
                    ...f,
                    ai_customize: checked,
                    ai_cover_letter: nextCoverLetterSelection(checked, f.ai_cover_letter, f.ai_cover_letter),
                  }))
                }}
                className="w-3.5 h-3.5"
              />
              <span className="font-sans text-sm">简历</span>
            </label>
            {form.ai_customize && (
              <label className="flex items-center gap-2 cursor-pointer ml-5">
                <input
                  type="checkbox"
                  checked={form.ai_cover_letter}
                  onChange={e => setForm(f => ({
                    ...f,
                    ai_cover_letter: nextCoverLetterSelection(f.ai_customize, f.ai_cover_letter, e.target.checked),
                  }))}
                  className="w-3.5 h-3.5"
                />
                <span className="font-sans text-sm">求职信</span>
              </label>
            )}
          </div>
        )}

        {useAI && (loading || ['running', 'cancelled', 'error', 'complete'].includes(genProgress.phase)) && (
          <GenerationProgress
            state={genProgress.phase === 'idle' && loading ? {
              ...genProgress,
              phase: 'running',
              progress: 5,
              message: '请求已接受…',
            } : genProgress}
            elapsedMs={elapsedMs}
            onCancel={genProgress.phase === 'running' ? handleCancelGeneration : undefined}
            onRetry={genProgress.phase === 'error' ? handleSubmit : undefined}
          />
        )}

        {error && genProgress.phase !== 'error' && genProgress.phase !== 'cancelled' && (
          <div className="border border-[var(--border)] bg-neutral-200 px-3 py-2 flex items-start gap-2">
            <div className="w-3 h-3 rounded-sm bg-[var(--primary)] flex-shrink-0 mt-0.5" />
            <p className="font-mono text-xs text-[var(--text-primary)] uppercase tracking-wider">{error}</p>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button onClick={handleSubmit} disabled={loading} className="gap-2">
            {loading && !useAI ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> 保存中…</>
            ) : useAI ? (
              <>分析并生成 <ArrowRight className="h-4 w-4" /></>
            ) : (
              <><Save className="h-4 w-4" /> 保存并跟踪</>
            )}
          </Button>
        </div>
      </div>

      {/* Result */}
      {result && canShowGenerationDownloads({
        phase: genProgress.phase,
        progress: genProgress.progress,
        applicationId: result.id,
      }) && (() => {
        const copy = generationSuccessCopy(shouldShowCoverLetterDownload(result.cover_letter_available))
        return (
          <>
            <div className="border-t border-[var(--border)]" />
            <div className="jh-card p-4 space-y-3">
              <div>
                <h2 className="font-serif text-xl font-bold">{copy.title}</h2>
                <p className="font-sans text-sm text-[var(--text-secondary)] mt-1">{copy.body}</p>
              </div>
              {pdfError && (
                <p className="font-sans text-xs text-[var(--text-primary)]">{pdfError}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => handleDownloadGenerated('resume')} disabled={pdfLoading !== null}>
                  {pdfLoading === 'resume' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  下载简历
                </Button>
                {shouldShowCoverLetterDownload(result.cover_letter_available) && (
                  <Button variant="outline" onClick={() => handleDownloadGenerated('coverletter')} disabled={pdfLoading !== null}>
                    {pdfLoading === 'coverletter' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    下载求职信
                  </Button>
                )}
                <Button variant="outline" onClick={() => navigate(editorPathForApplication(result.id))}>
                  查看分析结果 →
                </Button>
              </div>
            </div>
          </>
        )
      })()}

      {/* Template preview overlay */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 bg-[var(--text-primary)]/35 flex items-center justify-center p-4"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="bg-[var(--surface)] border border-[var(--border)] shadow-[var(--shadow)] w-full max-w-3xl h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] flex-shrink-0">
              <span className="font-mono text-xs uppercase tracking-wider">模板预览</span>
              <button
                onClick={() => setPreviewOpen(false)}
                className="font-mono text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] uppercase tracking-wider"
              >
                [ 关闭 ]
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              {previewLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-[var(--text-secondary)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="font-mono text-xs uppercase tracking-wider">[ 渲染中… ]</span>
                </div>
              ) : previewHtml ? (
                <iframe srcDoc={previewHtml} className="w-full h-full border border-[var(--border)]" title="模板预览" />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">[ 暂无法预览 ]</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
