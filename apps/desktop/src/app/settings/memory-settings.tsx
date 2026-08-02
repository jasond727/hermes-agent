import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Codicon } from '@/components/ui/codicon'
import { Trash2, Plus, Save, X } from '@/lib/icons'
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

function MemoryRow({
  entry,
  type,
  onSave,
  onDelete,
}: {
  entry: MemoryEntry
  type: MemoryType
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

  return (
    <div className="group flex flex-col gap-1.5 rounded-lg border border-(--ui-stroke-secondary) p-3 transition-colors hover:border-(--ui-stroke-primary)">
      {editing ? (
        <>
          <Textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={3}
            className="min-h-0 resize-y"
          />
          <div className="flex gap-2">
            <Button size="sm" variant="default" onClick={handleSave}>
              <Save className="size-3.5" />
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCancel}>
              <X className="size-3.5" />
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-(--ui-text-primary)">{entry.content}</p>
          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => setEditing(true)}
              title="Edit"
            >
              <Codicon name="edit" size="1em" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => onDelete(entry.index)}
              title="Delete"
              className="hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </Button>
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

  return (
    <>
      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        <Button
          size="sm"
          variant={activeTab === 'memory' ? 'default' : 'outline'}
          onClick={() => setActiveTab('memory')}
        >
          Agent Memories
        </Button>
        <Button
          size="sm"
          variant={activeTab === 'user' ? 'default' : 'outline'}
          onClick={() => setActiveTab('user')}
        >
          User Profile
        </Button>
      </div>

      {/* Add new entry */}
      {adding ? (
        <div className="mb-4 rounded-lg border border-(--ui-stroke-secondary) p-3">
          <Textarea
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            placeholder="Enter memory content..."
            rows={3}
            className="min-h-0 resize-y"
            autoFocus
          />
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="default" onClick={handleAdd}>
              <Plus className="size-3.5" />
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewContent('') }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="mb-4"
          onClick={() => setAdding(true)}
        >
          <Plus className="size-3.5" />
          Add Memory
        </Button>
      )}

      {/* Entries list */}
      {loading ? (
        <p className="text-muted-foreground text-sm">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No {activeTab === 'memory' ? 'agent' : 'user'} memories yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {entries.map(entry => (
            <MemoryRow
              key={entry.index}
              entry={entry}
              type={activeTab}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </>
  )
}
