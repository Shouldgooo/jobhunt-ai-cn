import { useEffect, useState, useRef, useCallback } from 'react'
import { api } from '@/lib/api'
import { THEME_LABELS, PANEL_LABELS } from '@/lib/labels'
import { SidebarLayout } from '@/components/AppSidebar'
import { Button } from '@/components/ui/button'
import { Loader2, Check, RefreshCw } from 'lucide-react'

// ─── Scaled iframe preview ─────────────────────────────────────────────────────

const A4_W = 816

function ScaledPreview({ html, loading }: { html: string; loading: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const iframeRef    = useRef<HTMLIFrameElement>(null)
  const [scale, setScale]     = useState(1)
  const [iframeH, setIframeH] = useState(1155)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth - 32
      setScale(Math.min(1, w / A4_W))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function handleIframeLoad() {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    const h = doc.documentElement.scrollHeight || doc.body.scrollHeight
    if (h > 0) setIframeH(h)
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden bg-[#F0F0E8] p-4">
      {loading && (
        <div className="flex justify-center py-6 text-[#4B5563]">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      {!loading && html && (
        <div style={{ height: Math.ceil(iframeH * scale) }}>
          <iframe
            ref={iframeRef}
            srcDoc={html}
            title="样式预览"
            onLoad={handleIframeLoad}
            className="bg-white border-2 border-black shadow-[8px_8px_0px_0px_#000000] origin-top-left"
            style={{
              width:           A4_W,
              height:          iframeH,
              transform:       `scale(${scale})`,
              transformOrigin: 'top left',
              pointerEvents:   'none',
            }}
          />
        </div>
      )}
      {!loading && !html && (
        <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-wider text-[#4B5563]">
          [ 暂无预览 ]
        </div>
      )}
    </div>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────

type PanelTab = 'editor' | 'preview'

export default function Style() {
  const [templates, setTemplates]     = useState<{ name: string; label: string; css: string }[]>([])
  const [css, setCss]                 = useState('')
  const [activeName, setActiveName]   = useState<string | null>(null)
  const [preview, setPreview]         = useState('')
  const [loadingInit, setLoadingInit] = useState(true)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [panelTab, setPanelTab]       = useState<PanelTab>('editor')
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadPreview = useCallback(async (cssStr: string, theme?: string) => {
    setLoadingPreview(true)
    try {
      const { html } = await api.previewStyle(cssStr, theme)
      setPreview(html)
    } catch (e) {
      setError(e instanceof Error ? e.message : '预览失败')
    } finally {
      setLoadingPreview(false)
    }
  }, [])

  useEffect(() => {
    Promise.all([api.getStyle(), api.getThemes()])
      .then(([styleData, templateList]) => {
        setCss(styleData.css)
        setTemplates(templateList)
        const match = templateList.find(t => t.css.trim() === styleData.css.trim())
        setActiveName(match?.name ?? null)
        loadPreview(styleData.css, match?.name)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoadingInit(false))
  }, [])

  function handleCssChange(value: string) {
    setCss(value)
    setActiveName(null)
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => loadPreview(value), 1000)
  }

  function handleSelectTemplate(t: { name: string; css: string }) {
    setCss(t.css)
    setActiveName(t.name)
    loadPreview(t.css, t.name)
  }

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    try {
      await api.saveStyle(css, activeName ?? undefined)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loadingInit) {
    return (
      <SidebarLayout>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-700" />
            <span className="font-mono text-xs uppercase tracking-wider text-[#4B5563]">[ 加载中… ]</span>
          </div>
        </div>
      </SidebarLayout>
    )
  }

  return (
    <SidebarLayout>
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* ── Toolbar ── */}
        <div className="border-b-2 border-black bg-white px-4 h-12 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-1">
            <span className="font-mono text-xs text-[#4B5563] mr-2 hidden sm:inline uppercase tracking-wider">模板：</span>
            {templates.map(t => (
              <button
                key={t.name}
                onClick={() => handleSelectTemplate(t)}
                className={`px-3 py-1 font-mono text-xs uppercase tracking-wider border-2 transition-all ${
                  activeName === t.name
                    ? 'bg-black text-[#F0F0E8] border-black'
                    : 'bg-transparent text-[#4B5563] border-black hover:bg-black hover:text-[#F0F0E8]'
                }`}
              >
                {THEME_LABELS[t.name] || t.label}
              </button>
            ))}
            {activeName === null && css && (
              <span className="font-mono text-xs text-[#4B5563] italic ml-2">自定义</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {error && <span className="font-mono text-xs text-red-600 hidden sm:inline uppercase">{error}</span>}
            {saved && (
              <span className="flex items-center gap-1 font-mono text-xs text-green-700 uppercase tracking-wider">
                <Check className="h-3.5 w-3.5" /> 已保存
              </span>
            )}
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              保存
            </Button>
          </div>
        </div>

        {/* ── Mobile panel toggle ── */}
        <div className="sm:hidden flex border-b-2 border-black bg-[#F0F0E8] flex-shrink-0">
          {(['editor', 'preview'] as PanelTab[]).map(p => (
            <button
              key={p}
              onClick={() => { setPanelTab(p); if (p === 'preview') loadPreview(css, activeName ?? undefined) }}
              className={`flex-1 py-2 font-mono text-xs uppercase tracking-wider transition-colors ${
                panelTab === p
                  ? 'bg-white text-black border-b-2 border-black -mb-px'
                  : 'text-[#4B5563]'
              }`}
            >
              {PANEL_LABELS[p] ?? p}
            </button>
          ))}
        </div>

        {/* ── Split view ── */}
        <div className="flex flex-1 overflow-hidden">

          {/* CSS editor */}
          <div className={`flex flex-col border-r-2 border-black bg-white ${
            panelTab === 'preview' ? 'hidden' : 'flex-1'
          } sm:flex sm:flex-1`}>
            <div className="px-4 py-2 border-b border-black bg-[#F0F0E8] flex items-center gap-2 flex-shrink-0">
              <div className="w-2.5 h-2.5 bg-blue-700" />
              <span className="font-mono text-xs uppercase tracking-wider text-[#4B5563]">CSS</span>
            </div>
            <textarea
              className="flex-1 resize-none px-4 py-3 font-mono text-xs leading-relaxed bg-white focus:outline-none"
              spellCheck={false}
              value={css}
              onChange={e => handleCssChange(e.target.value)}
            />
          </div>

          {/* Scaled preview */}
          <div className={`flex flex-col ${
            panelTab === 'editor' ? 'hidden' : 'flex-1'
          } sm:flex sm:flex-1`}>
            <div className="px-4 py-2 border-b border-black bg-[#F0F0E8] flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 bg-green-700" />
                <span className="font-mono text-xs uppercase tracking-wider text-[#4B5563]">预览</span>
              </div>
              <button
                onClick={() => loadPreview(css, activeName ?? undefined)}
                className="text-[#4B5563] hover:text-black transition-colors"
                title="刷新"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingPreview ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <ScaledPreview html={preview} loading={loadingPreview} />
          </div>
        </div>
      </div>
    </SidebarLayout>
  )
}
