import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type ResumeTemplate } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Loader2, FilePlus, Edit, Star, Copy, Trash2, FileText, PenLine } from 'lucide-react'

export default function Resumes() {
  const navigate = useNavigate()

  const [templates, setTemplates] = useState<ResumeTemplate[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [menuOpen, setMenuOpen]   = useState<number | null>(null)
  const [creating, setCreating]   = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)

  useEffect(() => {
    api.getTemplates()
      .then(setTemplates)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleNewMarkdown() {
    setShowNewModal(false)
    setCreating(true)
    try {
      const { id } = await api.createTemplate({ name: '新建模板', markdown: '' })
      navigate(`/resumes/${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建模板失败')
      setCreating(false)
    }
  }

  function handleNewForm() {
    setShowNewModal(false)
    navigate('/resumes/build')
  }

  async function handleSetDefault(id: number) {
    setMenuOpen(null)
    try {
      await api.setDefaultTemplate(id)
      setTemplates(prev => prev.map(t => ({ ...t, is_default: t.id === id ? 1 : 0 })))
    } catch (e) {
      setError(e instanceof Error ? e.message : '设置默认失败')
    }
  }

  async function handleDuplicate(tpl: ResumeTemplate) {
    setMenuOpen(null)
    try {
      const full = await api.getTemplate(tpl.id)
      const { id } = await api.createTemplate({ name: `${tpl.name}（副本）`, markdown: full.markdown })
      const updated = await api.getTemplates()
      setTemplates(updated)
      navigate(`/resumes/${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '复制失败')
    }
  }

  async function handleDelete(id: number) {
    setMenuOpen(null)
    if (!window.confirm('确定删除此模板？此操作无法撤销。')) return
    try {
      await api.deleteTemplate(id)
      setTemplates(prev => prev.filter(t => t.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[#4B5563] py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="font-mono text-xs uppercase tracking-wider">[ 加载中… ]</span>
      </div>
    )
  }

  return (
    <div className="space-y-8" onClick={() => setMenuOpen(null)}>

      {/* Header */}
      <div className="border-b-2 border-black pb-4 flex items-end justify-between">
        <div>
          <h1 className="font-serif text-3xl font-bold">简历</h1>
          <p className="font-sans text-sm text-[#4B5563] mt-1">
            管理简历模板。新建申请时会使用默认模板。
          </p>
        </div>
        <Button onClick={() => setShowNewModal(true)} disabled={creating} className="gap-2 flex-shrink-0">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus className="h-4 w-4" />}
          新建简历
        </Button>
      </div>

      {error && (
        <div className="border-2 border-red-600 bg-red-100 px-3 py-2 flex items-start gap-2">
          <div className="w-3 h-3 bg-red-600 flex-shrink-0 mt-0.5" />
          <p className="font-mono text-xs text-red-600 uppercase tracking-wider">{error}</p>
        </div>
      )}

      {/* Template list */}
      {templates.length === 0 ? (
        <div className="border-2 border-dashed border-black px-6 py-12 text-center">
          <p className="font-mono text-xs uppercase tracking-wider text-[#4B5563]">
            暂无模板。点击「新建简历」创建一份。
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map(tpl => (
            <div
              key={tpl.id}
              className="bg-white border-2 border-black shadow-[2px_2px_0px_0px_#000] flex items-center px-4 py-3 gap-4"
            >
              {/* Default indicator */}
              <div className="flex-shrink-0 w-5 flex justify-center">
                {tpl.is_default ? (
                  <Star className="h-4 w-4 fill-black text-black" aria-label="默认模板" />
                ) : (
                  <Star className="h-4 w-4 text-[#D1D5DB]" />
                )}
              </div>

              {/* Name + meta */}
              <div className="flex-1 min-w-0">
                <p className="font-sans font-semibold text-sm truncate">{tpl.name}</p>
                <p className="font-mono text-xs text-[#4B5563]">
                  编辑于 {tpl.updated_at?.slice(0, 10) || '—'}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button
                  size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                  onClick={() => navigate(`/resumes/${tpl.id}`)}
                >
                  <Edit className="h-3.5 w-3.5" /> 编辑
                </Button>

                {/* Dropdown */}
                <div className="relative">
                  <Button
                    size="sm" variant="outline" className="h-7 text-xs px-2"
                    onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === tpl.id ? null : tpl.id) }}
                  >
                    ···
                  </Button>
                  {menuOpen === tpl.id && (
                    <div
                      className="absolute right-0 top-8 z-10 bg-white border-2 border-black shadow-[4px_4px_0px_0px_#000] min-w-40"
                      onClick={e => e.stopPropagation()}
                    >
                      {!tpl.is_default && (
                        <button
                          className="w-full text-left px-3 py-2 font-mono text-xs uppercase tracking-wider hover:bg-black hover:text-white flex items-center gap-2"
                          onClick={() => handleSetDefault(tpl.id)}
                        >
                          <Star className="h-3.5 w-3.5" /> 设为默认
                        </button>
                      )}
                      <button
                        className="w-full text-left px-3 py-2 font-mono text-xs uppercase tracking-wider hover:bg-black hover:text-white flex items-center gap-2"
                        onClick={() => handleDuplicate(tpl)}
                      >
                        <Copy className="h-3.5 w-3.5" /> 创建副本
                      </button>
                      {templates.length > 1 && (
                        <button
                          className="w-full text-left px-3 py-2 font-mono text-xs uppercase tracking-wider hover:bg-red-600 hover:text-white flex items-center gap-2 text-red-600"
                          onClick={() => handleDelete(tpl.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> 删除
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="font-mono text-xs text-[#4B5563]">
        [ ★ = 新建申请时使用的默认模板 ]
      </p>

      {/* New Resume modal */}
      {showNewModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowNewModal(false)}
        >
          <div
            className="bg-white border-2 border-black shadow-[6px_6px_0px_0px_#000] w-full max-w-lg mx-4 p-6"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="font-serif text-xl font-bold mb-1">你想如何创建简历？</h2>
            <p className="font-sans text-sm text-[#4B5563] mb-6">选择一种开始方式。</p>

            <div className="grid grid-cols-2 gap-4">
              {/* Build with form */}
              <button
                onClick={handleNewForm}
                className="border-2 border-black p-5 text-left hover:bg-black hover:text-white group transition-colors"
              >
                <PenLine className="h-6 w-6 mb-3" />
                <p className="font-sans font-semibold text-sm mb-1">表单填写</p>
                <p className="font-sans text-xs text-[#4B5563] group-hover:text-white/80">
                  逐步填写个人信息 — 推荐大多数用户使用
                </p>
              </button>

              {/* Edit as markdown */}
              <button
                onClick={handleNewMarkdown}
                className="border-2 border-black p-5 text-left hover:bg-black hover:text-white group transition-colors"
              >
                <FileText className="h-6 w-6 mb-3" />
                <p className="font-sans font-semibold text-sm mb-1">编辑 Markdown</p>
                <p className="font-sans text-xs text-[#4B5563] group-hover:text-white/80">
                  直接编写或粘贴 Markdown — 适合已有模板的进阶用户
                </p>
              </button>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowNewModal(false)}
                className="font-mono text-xs uppercase tracking-wider text-[#4B5563] hover:text-black"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
