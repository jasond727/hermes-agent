import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Codicon } from '@/components/ui/codicon'
import { Badge } from '@/components/ui/badge'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Trash2, Plus, Save, X, Search } from '@/lib/icons'
import { notify, notifyError } from '@/store/notifications'

type MemoryType = 'memory' | 'user'

interface MemoryEntry {
  index: number
  content: string
}

async function fetchEntries(type: MemoryType): Promise<MemoryEntry[]> {
  const resp = await window.hermesDesktop.api<{ entries: string[]; total: number }>({
    method: 'GET',
    path: `/api/memory/entries?target=${type}`
  })
  return (resp.entries || []).map((content, index) => ({ index, content }))
}

async function addEntry(type: MemoryType, content: string): Promise<void> {
  await window.hermesDesktop.api<{ ok: boolean }>({
    method: 'POST',
    path: `/api/memory/entries?target=${type}`,
    body: { content }
  })
}

async function updateEntry(type: MemoryType, index: number, content: string): Promise<void> {
  await window.hermesDesktop.api<{ ok: boolean }>({
    method: 'PUT',
    path: `/api/memory/entries/${index}?target=${type}`,
    body: { content }
  })
}

async function deleteEntry(type: MemoryType, index: number): Promise<void> {
  await window.hermesDesktop.api<{ ok: boolean }>({
    method: 'DELETE',
    path: `/api/memory/entries/${index}`
  })
}

function MemoryCard({
  entry,
  onSave,
  onDelete,
}: {
  entry: MemoryEntry
  onSave: (index: number, content: string) => void
  onDelete: (index: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.content)

  const handleSave = () => {
    if (draft.trim()) {
      onSave(entry.index, draft.trim())
      setEditing(false)
    }
  }

  const handleCancel = () => {
    setDraft(entry.content)
    setEditing(false)
  }

  const wordCount = entry.content.split(/\s+/).filter(Boolean).length

  return (
    <div className="group relative rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary)/50 p-4 transition-all hover:border-(--ui-stroke-primary) hover:bg-(--ui-bg-secondary)/80 hover:shadow-sm">
      {/* Index badge */}
      <div className="absolute -left-1.5 -top-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Badge variant="muted" className="size-6 rounded-full p-0 text-[0.6rem] font-mono">
          {entry.index}
        </Badge>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={3}
            className="min-h-0 resize-y rounded-lg border-(--ui-stroke-primary) bg-(--ui-chat-surface-background)"
            autoFocus
          />
          <div className="flex items-center justify-between">
            <span className="text-[0.65rem] text-muted-foreground/60">
              {draft.length} chars
            </span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={handleCancel}>
                <X className="size-3.5" />
              </Button>
              <Button size="sm" variant="default" onClick={handleSave}>
                <Save className="size-3.5" />
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className="pr-16 whitespace-pre-wrap text-[0.875rem] leading-relaxed text-(--ui-text-primary)">
            {entry.content}
          </p>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[0.65rem] text-muted-foreground/60">
              {wordCount} words · {entry.content.length} chars
            </span>
            <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => setEditing(true)}
                title="Edit"
                className="h-7 w-7"
              >
                <Codicon name="edit" size="1em" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => onDelete(entry.index)}
                title="Delete"
                className="h-7 w-7 hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** Standalone panel for managing memory entries (add/edit/delete). Embeds inside ConfigSettings. */
export function MemoryEntriesPanel() {
  const [activeTab, setActiveTab] = useState<MemoryType>('memory')
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [newContent, setNewContent] = useState('')
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')

  const loadEntries = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchEntries(activeTab)
      setEntries(data)
    } catch (err) {
      notifyError(err, 'Failed to load memories')
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    loadEntries()
  }, [loadEntries])

  const handleAdd = async () => {
    if (!newContent.trim()) return
    try {
      await addEntry(activeTab, newContent.trim())
      setNewContent('')
      setAdding(false)
      await loadEntries()
      notify({ message: 'Memory added' })
    } catch (err) {
      notifyError(err, 'Failed to add memory')
    }
  }

  const handleSave = async (index: number, content: string) => {
    try {
      await updateEntry(activeTab, index, content)
      await loadEntries()
      notify({ message: 'Memory updated' })
    } catch (err) {
      notifyError(err, 'Failed to update memory')
    }
  }

  const handleDelete = async (index: number) => {
    if (!window.confirm('Delete this memory?')) return
    try {
      await deleteEntry(activeTab, index)
      await loadEntries()
      notify({ message: 'Memory deleted' })
    } catch (err) {
      notifyError(err, 'Failed to delete memory')
    }
  }

  const filteredEntries = useMemo(() => {
    if (!query.trim()) return entries
    const needle = query.toLowerCase()
    return entries.filter(e => e.content.toLowerCase().includes(needle))
  }, [entries, query])

  const tabOptions = [
    { id: 'memory' as const, label: `Agent Memories (${entries.filter(e => activeTab === 'memory' ? true : false).length})` },
    { id: 'user' as const, label: `User Profile (${entries.filter(e => activeTab === 'user' ? true : false).length})` },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs with count */}
      <SegmentedControl
        onChange={id => { setActiveTab(id); setQuery('') }}
        options={[
          { id: 'memory', label: `Agent Memories${entries.length ? ` (${entries.length})` : ''}` },
          { id: 'user', label: `User Profile${entries.length ? ` (${entries.length})` : ''}` },
        ]}
        value={activeTab}
      />

      {/* Search */}
      {entries.length > 2 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search memories..."
            className="pl-9"
          />
          {query && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              onClick={() => setQuery('')}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Add new entry */}
      {adding ? (
        <div className="rounded-xl border border-(--ui-stroke-primary) bg-(--ui-bg-secondary)/60 p-4">
          <Textarea
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            placeholder={activeTab === 'memory' ? 'Environment fact, convention, or lesson...' : 'User preference, role, or style...'}
            rows={3}
            className="min-h-0 resize-y rounded-lg border-(--ui-stroke-secondary) bg-(--ui-chat-surface-background)"
            autoFocus
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[0.65rem] text-muted-foreground/60">
              {newContent.length} chars
            </span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewContent('') }}>
                Cancel
              </Button>
              <Button size="sm" variant="default" onClick={handleAdd}>
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAdding(true)}
          className="justify-start gap-2"
        >
          <Plus className="size-3.5" />
          Add {activeTab === 'memory' ? 'Agent Memory' : 'Profile Entry'}
        </Button>
      )}

      {/* Entries list */}
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
          <div className="size-3.5 animate-spin rounded-full border-2 border-(--ui-stroke-secondary) border-t-(--ui-text-secondary)" />
          Loading...
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-(--ui-stroke-secondary) py-8 text-center">
          <p className="text-muted-foreground text-sm">
            {query ? `No memories matching "${query}"` : `No ${activeTab === 'memory' ? 'agent' : 'user'} memories yet.`}
          </p>
          {query && (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setQuery('')}>
              Clear search
            </Button>
          )}
        </div>
      ) : (
        <>
          {query && (
            <p className="text-[0.7rem] font-medium text-muted-foreground/70">
              {filteredEntries.length} of {entries.length} memories
            </p>
          )}
          <div className="flex flex-col gap-2">
            {filteredEntries.map(entry => (
              <MemoryCard
                key={entry.index}
                entry={entry}
                onSave={handleSave}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
