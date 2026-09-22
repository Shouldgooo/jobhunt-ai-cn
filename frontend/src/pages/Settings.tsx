import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2, Check } from 'lucide-react'

type SettingsTab = 'cover-letter' | 'cv' | 'profile'

export default function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('cover-letter')

  const TAB_LABELS: Record<SettingsTab, string> = {
    'cover-letter': '求职信模板',
    'cv': '简历 (cv.md)',
    'profile': '个人档案',
  }

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="border-b-2 border-black pb-4">
        <h1 className="font-serif text-3xl font-bold">设置</h1>
        <p className="font-sans text-sm text-[#4B5563] mt-1">
          编辑求职信模板和基础简历。
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex border-b-2 border-black -mt-2">
        {(Object.keys(TAB_LABELS) as SettingsTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 font-mono text-xs uppercase tracking-wider border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-black text-black'
                : 'border-transparent text-[#4B5563] hover:text-black'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'cover-letter' && <CoverLetterPanel />}
      {activeTab === 'cv'           && <CvPanel />}
      {activeTab === 'profile'      && <ProfilePanel />}
    </div>
  )
}

// ─── Shared editor panel layout ────────────────────────────────────────────────

function EditorPanel({
  label,
  hint,
  value,
  onChange,
  placeholder,
  loading,
  saving,
  saved,
  error,
  onSave,
  saveLabel,
}: {
  label: string
  hint: React.ReactNode
  value: string
  onChange: (v: string) => void
  placeholder: string
  loading: boolean
  saving: boolean
  saved: boolean
  error: string | null
  onSave: () => void
  saveLabel: string
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[#4B5563] text-sm py-8">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="font-mono text-xs uppercase tracking-wider">[ 加载中… ]</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{label}</Label>
        <p className="font-mono text-xs text-[#4B5563]">{hint}</p>
        <textarea
          className="w-full min-h-[calc(100vh-22rem)] rounded-none border border-black bg-white px-3 py-2.5 font-mono text-xs leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-blue-700"
          spellCheck={false}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
        />
      </div>

      {error && (
        <div className="border-2 border-red-600 bg-red-100 px-3 py-2 flex items-start gap-2">
          <div className="w-3 h-3 bg-red-600 flex-shrink-0 mt-0.5" />
          <p className="font-mono text-xs text-red-600 uppercase tracking-wider">{error}</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={onSave} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
          {saveLabel}
        </Button>
        {saved && (
          <span className="flex items-center gap-1.5 font-mono text-xs text-green-700 uppercase tracking-wider">
            <Check className="h-4 w-4" /> 已保存
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Cover letter template panel ───────────────────────────────────────────────

function CoverLetterPanel() {
  const [template, setTemplate] = useState('')
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    api.getCoverLetterTemplate()
      .then(d => setTemplate(d.template))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    try {
      await api.saveCoverLetterTemplate({ template })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditorPanel
      label="求职信模板"
      hint={<>
        每次创建申请时都会使用 — 无论是否启用 AI。
        可用 <code className="text-blue-700">{'{{company}}'}</code> 和{' '}
        <code className="text-blue-700">{'{{job_title}}'}</code> 作为占位符，系统会自动填充。
      </>}
      value={template}
      onChange={setTemplate}
      placeholder={'尊敬的招聘经理：\n\n我对贵公司的 {{job_title}} 职位很感兴趣。\n\n...'}
      loading={loading}
      saving={saving}
      saved={saved}
      error={error}
      onSave={handleSave}
      saveLabel="保存模板"
    />
  )
}

// ─── Profile panel ─────────────────────────────────────────────────────────────

function ProfilePanel() {
  const [profile, setProfile] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    api.getProfile()
      .then(d => setProfile(d.profile))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    try {
      await api.saveProfile({ profile })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditorPanel
      label="个人档案 (user/profile.md)"
      hint="定义你的目标岗位、适配侧重和职业叙事。AI 在每次定制简历前都会读取此文件，以决定强调哪些内容。"
      value={profile}
      onChange={setProfile}
      placeholder="## 目标岗位&#10;&#10;| 原型 | 主题轴 | 对方看重的能力 |&#10;|-----------|---------------|---------------|&#10;| **全栈工程师** | React, Node, REST APIs | 能同时负责前后端的人 |"
      loading={loading}
      saving={saving}
      saved={saved}
      error={error}
      onSave={handleSave}
      saveLabel="保存档案"
    />
  )
}

// ─── CV panel ──────────────────────────────────────────────────────────────────

function CvPanel() {
  const [cv, setCv]           = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    api.getCv()
      .then(d => setCv(d.cv))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true); setError(null); setSaved(false)
    try {
      await api.saveCv({ cv })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditorPanel
      label="基础简历 (user/cv.md)"
      hint="完整简历，使用 Oh My CV 的 Markdown 格式。每次分析职位时，AI 会基于此文件改写摘要并调整技能与要点顺序。"
      value={cv}
      onChange={setCv}
      placeholder="在此粘贴 Oh My CV 格式的 Markdown 简历…"
      loading={loading}
      saving={saving}
      saved={saved}
      error={error}
      onSave={handleSave}
      saveLabel="保存简历"
    />
  )
}
