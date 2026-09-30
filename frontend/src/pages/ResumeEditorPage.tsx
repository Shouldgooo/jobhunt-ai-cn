import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, type ResumeTemplate } from '@/lib/api'
import { PANEL_LABELS } from '@/lib/labels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, ArrowLeft, RefreshCw, Star } from 'lucide-react'

export default function ResumeEditorPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const tplId    = Number(id)

  const [tpl, setTpl]               = useState<ResumeTemplate | null>(null)
  const [name, setName]             = useState('')
  const [markdown, setMarkdown]     = useState('')
  const [preview, setPreview]       = useState('')
  const [panelTab, setPanelTab]     = useState<'editor' | 'preview'>('editor')
  const [loadingTpl, setLoadingTpl] = useState(true)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState<string | null>(null)
  const [error, setError]           = useState<string | null>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    api.getTemplate(tplId)
      .then(data => {
        setTpl(data)
        setName(data.name)
        setMarkdown(data.markdown || '')
      })
      .catch(e => setError(e.message))
      .finally(() => setLoadingTpl(false))
  }, [tplId])

  async function refreshPreview(md: string) {
    if (!md) return
    setLoadingPreview(true)
    try {
      const { html } = await api.preview(md, 'resume')
      setPreview(html)
    } catch { /* ignore preview errors */ }
    finally { setLoadingPreview(false) }
  }

  const save = useCallback(async (newName: string, newMarkdown: string) => {
    setSaving(true)
    setSaveError(null)
    try {
      await api.updateTemplate(tplId, { name: newName, markdown: newMarkdown })
      setTpl(prev => prev ? { ...prev, name: newName } : prev)
    } catch {
      setSaveError('保存失败 — 更改未被保存')
    } finally {
      setSaving(false)
    }
  }, [tplId])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (saveTimer.current) clearTimeout(saveTimer.current)
        save(name, markdown)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [name, markdown, save])

  function handleMarkdownChange(value: string) {
    setMarkdown(value)
    setSaveError(null)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(name, value), 800)
  }

  function handleNameChange(value: string) {
    setName(value)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => save(value, markdown), 800)
  }

  async function handleSetDefault() {
    try {
      await api.setDefaultTemplate(tplId)
      setTpl(prev => prev ? { ...prev, is_default: 1 } : prev)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '设置默认失败')
    }
  }

  if (loadingTpl) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[var(--bg)]">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-[var(--primary)]" />
          <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">[ 加载中… ]</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[var(--bg)]">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-[var(--primary)]" />
          <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-primary)]">[ {error} ]</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-dvh bg-[var(--bg)]">

      {/* ── Header ── */}
      <header className="bg-[var(--surface)] border-b border-[var(--border)] px-4 sm:px-6 h-12 flex items-center justify-between flex-shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate('/resumes')}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <Input
            value={name}
            onChange={e => handleNameChange(e.target.value)}
            className="h-7 text-sm font-semibold w-48 sm:w-64"
            placeholder="模板名称"
          />
          {tpl?.is_default ? (
            <span className="font-mono text-[10px] text-[var(--text-secondary)] uppercase tracking-wider hidden sm:flex items-center gap-1">
              <Star className="h-3 w-3 fill-[var(--primary-dark)] text-[var(--primary-dark)]" /> 默认
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {saving && (
            <span className="font-mono text-xs text-[var(--text-secondary)] hidden sm:flex items-center gap-1 uppercase">
              <Loader2 className="h-3 w-3 animate-spin" /> 保存中
            </span>
          )}
          {!tpl?.is_default && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 hidden sm:flex" onClick={handleSetDefault}>
              <Star className="h-3.5 w-3.5" /> 设为默认
            </Button>
          )}
        </div>
      </header>

      {/* ── Save error banner ── */}
      {saveError && (
        <div className="border-b border-[var(--border)] bg-neutral-200 px-4 py-2 flex items-center gap-2 flex-shrink-0">
          <div className="w-2.5 h-2.5 rounded-sm bg-[var(--primary)] flex-shrink-0" />
          <span className="font-mono text-xs text-[var(--text-primary)] uppercase tracking-wider">{saveError}</span>
        </div>
      )}

      {/* ── Mobile panel toggle ── */}
      <div className="sm:hidden flex border-b border-[var(--border)] bg-[var(--bg)] flex-shrink-0">
        {(['editor', 'preview'] as const).map(p => (
          <button
            key={p}
            onClick={() => { setPanelTab(p); if (p === 'preview') refreshPreview(markdown) }}
            className={`flex-1 py-2 font-mono text-xs uppercase tracking-wider transition-colors ${
              panelTab === p ? 'bg-[var(--surface)] text-[var(--text-primary)] border-b border-[var(--border)] -mb-px' : 'text-[var(--text-secondary)]'
            }`}
          >
            {PANEL_LABELS[p] ?? p}
          </button>
        ))}
      </div>

      {/* ── Split view ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Editor panel */}
        <div className={`flex flex-col border-r border-[var(--border)] bg-[var(--surface)] ${
          panelTab === 'editor' ? 'flex-1' : 'hidden'
        } sm:flex sm:flex-1`}>
          <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--bg)] flex items-center gap-2 flex-shrink-0">
            <div className="w-2.5 h-2.5 rounded-sm bg-[var(--primary)]" />
            <span className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">Markdown</span>
          </div>
          <textarea
            className="flex-1 resize-none px-4 py-3 font-mono text-xs leading-relaxed bg-[var(--surface)] focus:outline-none"
            value={markdown}
            onChange={e => handleMarkdownChange(e.target.value)}
            spellCheck={false}
            placeholder="在此粘贴或编写简历 Markdown。可用 {{placeholder}} 标记 AI 可填充字段。"
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
              onClick={() => refreshPreview(markdown)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title="刷新"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingPreview ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {preview
              ? <iframe srcDoc={preview} className="w-full h-full border border-[var(--border)] shadow-[var(--shadow)] bg-[var(--surface)]" title="预览" />
              : (
                <div className="flex flex-col h-full items-center justify-center gap-3">
                  <p className="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">[ 暂无预览 — 点击刷新 ]</p>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => refreshPreview(markdown)}>
                    <RefreshCw className="h-3.5 w-3.5" /> 刷新预览
                  </Button>
                </div>
              )
            }
          </div>
        </div>
      </div>
    </div>
  )
}
