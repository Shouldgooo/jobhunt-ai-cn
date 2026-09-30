import { useEffect, useRef, useState } from 'react'
import { Loader2, Send } from 'lucide-react'
import { api, type QaMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { canSendQuestion, parseQaThread, QA_SUGGESTIONS } from '@/lib/job-qa'

export function JobQaPanel({
  appId,
  jdText,
  rawThread,
  onThread,
}: {
  appId: number
  jdText?: string | null
  rawThread?: string | QaMessage[] | null
  onThread: (thread: QaMessage[]) => void
}) {
  const [messages, setMessages] = useState<QaMessage[]>(() => parseQaThread(rawThread))
  const [draft, setDraft] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMessages(parseQaThread(rawThread))
  }, [rawThread])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, asking])

  async function send(question: string) {
    const text = question.trim()
    if (!canSendQuestion(text, asking)) return
    setAsking(true)
    setError(null)
    setDraft('')
    setMessages((prev) => [...prev, { role: 'user', content: text, created_at: new Date().toISOString() }])
    try {
      const result = await api.askApplication(appId, text)
      setMessages(result.qa_thread)
      onThread(result.qa_thread)
    } catch (err) {
      setError(err instanceof Error ? err.message : '回答失败，请重试。')
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col bg-[var(--bg)]">
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto space-y-4">
          <div>
            <h2 className="font-serif text-xl font-bold">岗位追问</h2>
            <p className="font-sans text-sm text-[var(--text-secondary)] mt-1">
              申请后如果雇主继续问「你为什么对这个岗位感兴趣」，可以把问题贴在这里。回答只依据这份 JD、简历和求职信，不会改你已生成的文档。
            </p>
          </div>

          {!jdText && (
            <div className="border border-[var(--border)] bg-neutral-100 px-4 py-3 font-mono text-xs uppercase tracking-wider">
              这份申请还没有职位描述，无法追问。
            </div>
          )}

          {messages.length === 0 && !asking && (
            <div className="flex flex-wrap gap-2">
              {QA_SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={!jdText || asking}
                  onClick={() => send(q)}
                  className="border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 font-sans text-sm hover:bg-[var(--primary-soft)] hover:text-[var(--text-primary)] disabled:opacity-40"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {messages.map((item, i) => (
            <div
              key={`${item.role}-${i}-${item.created_at || ''}`}
              className={`rounded-xl border border-[var(--border)] p-4 ${item.role === 'user' ? 'bg-[var(--primary-dark)] text-[var(--surface)] ml-8' : 'bg-[var(--surface)] mr-8'}`}
            >
              <p className="font-mono text-xs uppercase tracking-wider opacity-60 mb-1">
                {item.role === 'user' ? '问题' : '回答'}
              </p>
              <p className="font-sans text-sm whitespace-pre-wrap leading-relaxed">{item.content}</p>
            </div>
          ))}

          {asking && (
            <div className="border border-[var(--border)] bg-[var(--surface)] mr-8 p-4 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在根据这份岗位生成回答…
            </div>
          )}

          {error && (
            <div className="border border-[var(--border)] bg-neutral-200 px-4 py-3 font-mono text-xs uppercase tracking-wider">
              {error}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <form
        className="border-t border-[var(--border)] bg-[var(--surface)] p-4"
        onSubmit={(e) => {
          e.preventDefault()
          send(draft)
        }}
      >
        <div className="max-w-2xl mx-auto flex gap-2">
          <textarea
            className="flex-1 min-h-[4.5rem] resize-none border border-[var(--border)] px-3 py-2 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
            value={draft}
            disabled={asking || !jdText}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(draft)
              }
            }}
            placeholder="粘贴雇主的问题，例如：你为什么对这个岗位感兴趣？"
          />
          <Button type="submit" disabled={!canSendQuestion(draft, asking) || !jdText} className="self-end h-10">
            {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            提问
          </Button>
        </div>
      </form>
    </div>
  )
}
