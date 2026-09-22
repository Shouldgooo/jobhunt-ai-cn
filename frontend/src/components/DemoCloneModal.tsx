// DEMO_GITHUB_URL — update this before deploying
const DEMO_GITHUB_URL = 'https://github.com/tristachou/jobhunt-ai'

interface Props {
  open: boolean
  onClose: () => void
}

export default function DemoCloneModal({ open, onClose }: Props) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white border-2 border-black shadow-[8px_8px_0px_0px_#000] w-full max-w-sm p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-blue-700 flex-shrink-0" />
          <h2 className="font-mono text-xs uppercase tracking-wider text-[#4B5563]">只读演示</h2>
        </div>

        <p className="font-sans text-sm leading-relaxed">
          这是功能展示，所有数据均为虚构，不会保存任何修改。
        </p>
        <p className="font-sans text-sm leading-relaxed">
          想正式使用？克隆本项目，填入你的简历和 Gemini API 密钥即可开始。
        </p>

        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onClose}
            className="font-mono text-xs uppercase tracking-wider text-[#4B5563] hover:text-black transition-colors px-3 py-1.5"
          >
            关闭
          </button>
          <a
            href={DEMO_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-black text-white font-mono text-xs uppercase tracking-wider px-4 py-1.5 hover:bg-[#4B5563] transition-colors"
            onClick={onClose}
          >
            在 GitHub 查看 →
          </a>
        </div>
      </div>
    </div>
  )
}
