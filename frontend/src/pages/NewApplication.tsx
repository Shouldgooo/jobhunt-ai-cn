import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type AnalyzeResult, type ResumeTemplate, THEMES } from '@/lib/api'
import { themeLabel } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, ArrowRight, Save } from 'lucide-react'

const scoreColor = (s: number) =>
  s >= 70 ? 'text-green-700' : s >= 50 ? 'text-orange-500' : 'text-red-600'

const scoreLabel = (s: number) =>
  s >= 70 ? '强匹配' : s >= 50 ? '中等匹配' : '弱匹配'

export default function NewApplication() {
  const navigate = useNavigate()

  const [form, setForm] = useState({
    job_title: '',
    company: '',
    source: 'linkedin',
    url: '',
    jd: '',
    theme: 'classic',
    resume_template_id: 0,   // 0 = use default
    ai_customize: true,
    ai_cover_letter: true,
  })
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [result, setResult]         = useState<AnalyzeResult | null>(null)
  const [templates, setTemplates]   = useState<ResumeTemplate[]>([])
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)

  useEffect(() => {
    api.getTemplates().then(list => {
      setTemplates(list)
      const def = list.find(t => Number(t.is_default) === 1)
      if (def) setForm(f => ({ ...f, resume_template_id: def.id }))
    }).catch(() => {})
  }, [])

  const set = (k: keyof typeof form) => (v: string | number | boolean) =>
    setForm(f => ({ ...f, [k]: v }))

  const hasJd = form.jd.trim().length > 0
  const useAI = hasJd && form.ai_customize

  async function handleSubmit() {
    if (!form.job_title || !form.company) {
      setError('职位名称和公司为必填项。')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)

    if (useAI) {
      // Persona B: AI analyze flow
      const controller = new AbortController()
      const timeoutMs = parseInt(import.meta.env.VITE_ANALYZE_TIMEOUT_MS || '300000', 10)
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const data = await api.analyze({
          job_title:           form.job_title,
          company:             form.company,
          jd:                  form.jd,
          url:                 form.url,
          source:              form.source,
          theme:               form.theme,
          resume_template_id:  form.resume_template_id || undefined,
          generate_cover_letter: form.ai_cover_letter,
        }, controller.signal)
        setResult(data)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setError(`请求超时（${timeoutMs / 1000} 秒）。请重试或换用更快的模型。`)
        } else {
          setError(err instanceof Error ? err.message : '未知错误')
        }
      } finally {
        clearTimeout(timeout)
        setLoading(false)
      }
    } else {
      // Persona A: direct save, no AI
      try {
        const { id } = await api.createApplication({
          job_title:          form.job_title,
          company:            form.company,
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
      }
    }
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
      <div className="border-b-2 border-black pb-4">
        <h1 className="font-serif text-3xl font-bold">新建申请</h1>
        <p className="font-sans text-sm text-[#4B5563] mt-1">
          记录一份新的求职申请。粘贴职位描述后，可由 AI 为你定制简历。
        </p>
      </div>

      {/* Form */}
      <div className="space-y-5">

        {/* Row 1 — Job title + Company */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="job_title">职位名称</Label>
            <Input
              id="job_title"
              placeholder="软件工程师"
              value={form.job_title}
              onChange={e => set('job_title')(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company">公司</Label>
            <Input
              id="company"
              placeholder="某某公司"
              value={form.company}
              onChange={e => set('company')(e.target.value)}
            />
          </div>
        </div>

        {/* Resume Template */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>简历模板</Label>
            {form.resume_template_id > 0 && (
              <button
                onClick={handlePreview}
                className="font-mono text-xs text-blue-700 hover:underline uppercase tracking-wider"
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
                  className="font-mono text-[10px] text-blue-700 hover:underline uppercase tracking-wider"
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
              职位链接 <span className="text-[#4B5563] normal-case font-sans text-xs">（选填）</span>
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
            <Label htmlFor="jd">
              职位描述 <span className="text-[#4B5563] normal-case font-sans text-xs">（选填）</span>
            </Label>
          </div>
          <Textarea
            id="jd"
            placeholder="在此粘贴完整职位描述。留空则跳过 AI 分析。"
            className="min-h-44 resize-y"
            value={form.jd}
            onChange={e => set('jd')(e.target.value)}
          />
        </div>

        {/* F1 — short JD warning */}
        {form.jd.trim().length > 0 && form.jd.trim().length < 100 && (
          <div className="border-2 border-yellow-500 bg-yellow-50 px-3 py-2 flex items-start gap-2">
            <div className="w-3 h-3 bg-yellow-500 flex-shrink-0 mt-0.5" />
            <p className="font-mono text-xs text-yellow-700 uppercase tracking-wider">
              职位描述过短（{form.jd.trim().length} 字）— AI 分析结果可能不准确
            </p>
          </div>
        )}

        {/* AI checkboxes — only when JD has content */}
        {hasJd && (
          <div className="border-2 border-black bg-white px-4 py-3 space-y-2">
            <p className="font-mono text-xs uppercase tracking-wider text-[#4B5563]">AI 选项</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.ai_customize}
                onChange={e => set('ai_customize')(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              <span className="font-sans text-sm">AI 定制简历</span>
            </label>
            {form.ai_customize && (
              <label className="flex items-center gap-2 cursor-pointer ml-5">
                <input
                  type="checkbox"
                  checked={form.ai_cover_letter}
                  onChange={e => set('ai_cover_letter')(e.target.checked)}
                  className="w-3.5 h-3.5"
                />
                <span className="font-sans text-sm">AI 生成求职信</span>
              </label>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="border-2 border-red-600 bg-red-100 px-3 py-2 flex items-start gap-2">
            <div className="w-3 h-3 bg-red-600 flex-shrink-0 mt-0.5" />
            <p className="font-mono text-xs text-red-600 uppercase tracking-wider">{error}</p>
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button onClick={handleSubmit} disabled={loading} className="gap-2">
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> {useAI ? '分析中…' : '保存中…'}</>
            ) : useAI ? (
              <>分析 <ArrowRight className="h-4 w-4" /></>
            ) : (
              <><Save className="h-4 w-4" /> 保存并跟踪</>
            )}
          </Button>
        </div>
      </div>

      {/* Result */}
      {result && (
        <>
          <div className="border-t-2 border-black" />

          <div className="space-y-5">
            <div className="border-b-2 border-black pb-4">
              <h2 className="font-serif text-2xl font-bold">分析结果</h2>
            </div>

            {/* Score card */}
            <div className="bg-white border-2 border-black shadow-[4px_4px_0px_0px_#000000] p-4">
              <div className="flex items-baseline gap-4">
                <span className={`font-serif text-5xl font-bold tabular-nums ${scoreColor(result.fit_score)}`}>
                  {result.fit_score}
                </span>
                <div>
                  <p className="font-mono text-xs uppercase tracking-wider text-[#4B5563]">匹配分</p>
                  <p className={`font-mono text-xs font-bold ${scoreColor(result.fit_score)}`}>
                    {scoreLabel(result.fit_score)}
                  </p>
                </div>
                <span className="ml-auto font-mono text-xs text-[#4B5563] uppercase tracking-wider">
                  职位：<span className="text-black font-bold">{result.job_title}</span>
                </span>
              </div>
            </div>

            {/* Detected skills */}
            {result.detected_skills.length > 0 && (
              <div className="space-y-2">
                <p className="font-mono text-xs uppercase tracking-wider text-[#4B5563]">匹配技能</p>
                <div className="flex flex-wrap gap-1.5">
                  {result.detected_skills.map(s => (
                    <Badge key={s} variant="applied">{s}</Badge>
                  ))}
                </div>
                <p className="font-mono text-xs text-[#4B5563]">[ 职位描述中与简历相符的技能 ]</p>
              </div>
            )}

            {result.cover_letter_available === false && (
              <div className="border-2 border-yellow-500 bg-yellow-50 px-3 py-2 flex items-start gap-2">
                <div className="w-3 h-3 bg-yellow-500 flex-shrink-0 mt-0.5" />
                <p className="font-mono text-xs text-yellow-700 uppercase tracking-wider">
                  已跳过求职信 — 请添加 <code className="normal-case">user/cover-letter/template.md</code> 以启用
                </p>
              </div>
            )}

            <Button onClick={() => navigate(`/editor/${result.id}`)} className="gap-2 w-full sm:w-auto">
              打开编辑器并导出 PDF
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </>
      )}

      {/* Template preview overlay */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="bg-white border-2 border-black shadow-[8px_8px_0px_0px_#000] w-full max-w-3xl h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b-2 border-black flex-shrink-0">
              <span className="font-mono text-xs uppercase tracking-wider">模板预览</span>
              <button
                onClick={() => setPreviewOpen(false)}
                className="font-mono text-xs text-[#4B5563] hover:text-black uppercase tracking-wider"
              >
                [ 关闭 ]
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              {previewLoading ? (
                <div className="flex h-full items-center justify-center gap-2 text-[#4B5563]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="font-mono text-xs uppercase tracking-wider">[ 渲染中… ]</span>
                </div>
              ) : previewHtml ? (
                <iframe srcDoc={previewHtml} className="w-full h-full border border-black" title="模板预览" />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="font-mono text-xs uppercase tracking-wider text-[#4B5563]">[ 暂无法预览 ]</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
