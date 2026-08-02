import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '@nanostores/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Codicon } from '@/components/ui/codicon'
import { Trash2, Plus, Save, X, Search, RefreshCw, Brain, Cloud, ChevronDown } from '@/lib/icons'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import { $activeProfile, $profiles, normalizeProfileKey, refreshProfiles } from '@/store/profile'
import { $memoryChangeTick } from '@/store/live-sync'
import { isExternalMemoryProvider } from './helpers'
import { MemoryConnect } from './memory/connect'
import { ProviderConfigPanel } from './memory/provider-config-panel'

type MemoryType = 'memory' | 'user'

interface MemoryEntry {
  index: number
  content: string
}

async function fetchEntries(type: MemoryType, profile?: string): Promise<MemoryEntry[]> {
  const profileParam = profile ? `&profile=${encodeURIComponent(profile)}` : ''
  const resp = await window.hermesDesktop.api<{ entries: string[]; total: number }>({
    method: 'GET',
    path: `/api/memory/entries?target=${type}${profileParam}`
  })
  return (resp.entries || []).map((content, index) => ({ index, content }))
}

/** Lightweight stats bar showing budget usage (chars used vs limit). Renders above the segmented tabs. */
export function MemoryStats({ onRefresh, profile, memoryLimit, userLimit }: { onRefresh?: () => void; profile?: string; memoryLimit?: number; userLimit?: number }) {
  const [state, setState] = useState<{ memoryUsed: number; memoryLimit: number; userUsed: number; userLimit: number; loading: boolean }>({
    memoryUsed: 0, memoryLimit: 0, userUsed: 0, userLimit: 0, loading: true
  })

  // Reactively update limits from props without re-fetching entries.
  useEffect(() => {
    if (memoryLimit != null || userLimit != null) {
      setState(s => ({
        ...s,
        memoryLimit: memoryLimit ?? s.memoryLimit,
        userLimit: userLimit ?? s.userLimit
      }))
    }
  }, [memoryLimit, userLimit])

  const load = useCallback(async () => {
    try {
      const [memEntries, userEntries] = await Promise.all([
        fetchEntries('memory', profile),
        fetchEntries('user', profile)
      ])

      const memUsed = memEntries.reduce((sum: number, e: MemoryEntry) => sum + e.content.length, 0)
      const userUsed = userEntries.reduce((sum: number, e: MemoryEntry) => sum + e.content.length, 0)

      setState(s => ({ ...s, memoryUsed: memUsed, userUsed: userUsed, loading: false }))
    } catch {
      setState(s => ({ ...s, loading: false }))
    }
  }, [profile])

  useEffect(() => {
    let cancelled = false
    void load().then(() => { if (!cancelled) return })
    return () => { cancelled = true }
  }, [load])

  // Event-driven budget refresh on memory.changed
  const memoryTick = useStore($memoryChangeTick)
  useEffect(() => {
    void load()
  }, [memoryTick, load])

  const formatBudget = (used: number, limit: number) => {
    if (!limit) return `${used} chars`
    const pct = Math.min((used / limit) * 100, 100)
    return `${used} / ${limit} chars (${Math.round(pct)}%)`
  }

  if (state.loading) {
    return (
      <div className="mb-2 flex items-center gap-4 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary)/40 px-3 py-2">
        <div className="size-3 animate-spin rounded-full border-2 border-(--ui-stroke-secondary) border-t-(--ui-text-secondary)" />
        <span className="text-[0.7rem] text-muted-foreground">Loading budget…</span>
      </div>
    )
  }

  return (
    <div className="mb-2 flex items-center gap-4 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary)/40 px-3 py-2">
      <span className="text-[length:var(--conversation-caption-font-size)] font-medium text-(--ui-text-secondary)">
        Budget usage
      </span>
      <span className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
        Agent: {formatBudget(state.memoryUsed, state.memoryLimit)}
      </span>
      <span className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
        User Profile: {formatBudget(state.userUsed, state.userLimit)}
      </span>
      {onRefresh && (
        <button
          className="ml-auto rounded p-1 text-muted-foreground/60 hover:text-foreground hover:bg-(--ui-bg-secondary)"
          onClick={() => void load()}
          title="Refresh budget"
          type="button"
        >
          <RefreshCw className="size-3" />
        </button>
      )}
    </div>
  )
}

async function addEntry(type: MemoryType, content: string, profile?: string): Promise<void> {
  const profileParam = profile ? `&profile=${encodeURIComponent(profile)}` : ''
  await window.hermesDesktop.api<{ ok: boolean }>({
    method: 'POST',
    path: `/api/memory/entries?target=${type}${profileParam}`,
    body: { content }
  })
}

async function updateEntry(type: MemoryType, oldContent: string, content: string, profile?: string): Promise<void> {
  const profileParam = profile ? `&profile=${encodeURIComponent(profile)}` : ''
  await window.hermesDesktop.api<{ ok: boolean }>({
    method: 'PUT',
    path: `/api/memory/entries?target=${type}${profileParam}`,
    body: { old_content: oldContent, content }
  })
}

async function deleteEntry(type: MemoryType, content: string, profile?: string): Promise<void> {
  const profileParam = profile ? `&profile=${encodeURIComponent(profile)}` : ''
  await window.hermesDesktop.api<{ ok: boolean }>({
    method: 'DELETE',
    path: `/api/memory/entries?target=${type}${profileParam}`,
    body: { content }
  })
}

function MemoryCard({
  entry,
  onSave,
  onDelete,
  onEditStart,
  onEditEnd,
}: {
  entry: MemoryEntry
  onSave: (index: number, content: string) => void
  onDelete: (index: number) => void
  onEditStart: (index: number) => void
  onEditEnd: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.content)

  const handleSave = () => {
    if (draft.trim()) {
      onSave(entry.index, draft.trim())
      setEditing(false)
      onEditEnd()
    }
  }

  const handleCancel = () => {
    setDraft(entry.content)
    setEditing(false)
    onEditEnd()
  }

  const wordCount = entry.content.split(/\s+/).filter(Boolean).length

  return (
    <div className="group flex flex-col rounded-xl border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary)/50 transition-all hover:border-(--ui-stroke-primary) hover:bg-(--ui-bg-secondary)/80 hover:shadow-sm">
      {/* Header: index + actions */}
      <div className="flex items-center justify-between border-b border-(--ui-stroke-secondary) px-4 py-2">
        <span className="font-mono text-[0.65rem] font-medium text-muted-foreground">
          #{entry.index + 1}
        </span>
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => { setEditing(true); onEditStart(entry.index) }}
            title="Edit"
            className="h-6 w-6"
          >
            <Codicon name="edit" size="0.85em" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => onDelete(entry.index)}
            title="Delete"
            className="h-6 w-6 hover:text-destructive"
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col p-4">
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
          <p className="flex-1 whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-(--ui-text-primary)">
            {entry.content}
          </p>
        )}
      </div>

      {/* Footer: metadata */}
      {!editing && (
        <div className="flex items-center gap-3 border-t border-(--ui-stroke-secondary) px-4 py-1.5">
          <span className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">{wordCount} words</span>
          <span className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">{entry.content.length} chars</span>
        </div>
      )}
    </div>
  )
}

/** Standalone panel for managing memory entries (add/edit/delete). Embeds inside ConfigSettings. */
export function MemoryEntriesPanel({ onRefresh, profile, memoryLimit, userLimit }: { onRefresh?: () => void; profile?: string; memoryLimit?: number; userLimit?: number }) {
  const [activeTab, setActiveTab] = useState<MemoryType>('memory')
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [counts, setCounts] = useState<{ memory: number; user: number }>({ memory: 0, user: 0 })
  const [loading, setLoading] = useState(true)
  const [newContent, setNewContent] = useState('')
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)  // pause poll while editing

  const loadEntries = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchEntries(activeTab, profile)
      setEntries(data)
      setCounts(prev => ({ ...prev, [activeTab]: data.length }))
    } catch (err) {
      notifyError(err, 'Failed to load memories')
    } finally {
      setLoading(false)
    }
  }, [activeTab, profile])

  useEffect(() => {
    loadEntries()
    // Preload the other tab's count so both badge numbers show on mount.
    void (async () => {
      try {
        const other = activeTab === 'memory' ? 'user' : 'memory'
        const data = await fetchEntries(other, profile)
        setCounts(prev => ({ ...prev, [other]: data.length }))
      } catch { /* ignore */ }
    })()
  }, [loadEntries])

  // Event-driven refresh: the backend broadcasts memory.changed when MEMORY.md/USER.md moves.
  // Skip refresh while an entry is being edited to avoid losing the draft.
  const memoryTick = useStore($memoryChangeTick)
  useEffect(() => {
    if (editingIndex === null) {
      void loadEntries()
    }
  }, [memoryTick, editingIndex, loadEntries])

  // Reload both counts when adding so the other tab stays fresh
  const reloadAllCounts = useCallback(async () => {
    try {
      const [memData, userData] = await Promise.all([
        fetchEntries('memory', profile),
        fetchEntries('user', profile)
      ])
      setCounts({ memory: memData.length, user: userData.length })
    } catch { /* ignore */ }
  }, [profile])

  const handleAdd = async () => {
    if (!newContent.trim()) return
    try {
      await addEntry(activeTab, newContent.trim(), profile)
      setNewContent('')
      setAdding(false)
      await loadEntries()
      await reloadAllCounts()
      onRefresh?.()
      notify({ message: 'Memory added' })
    } catch (err) {
      notifyError(err, 'Failed to add memory')
    }
  }

  const handleSave = async (index: number, content: string) => {
    try {
      const oldContent = entries.find(e => e.index === index)?.content ?? ''
      await updateEntry(activeTab, oldContent, content, profile)
      await loadEntries()
      onRefresh?.()
      notify({ message: 'Memory updated' })
    } catch (err) {
      notifyError(err, 'Failed to update memory')
    }
  }

  const handleDelete = async (index: number) => {
    if (!window.confirm('Delete this memory?')) return
    try {
      const content = entries.find(e => e.index === index)?.content ?? ''
      await deleteEntry(activeTab, content, profile)
      await loadEntries()
      await reloadAllCounts()
      onRefresh?.()
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

  const totalEntries = counts.memory + counts.user

  return (
    <div className="flex flex-col gap-4">
      {/* Stats bar above tabs */}
      <MemoryStats onRefresh={onRefresh} profile={profile} memoryLimit={memoryLimit} userLimit={userLimit} />

      {/* Tabs with count */}
      <SegmentedControl
        onChange={id => { setActiveTab(id); setQuery('') }}
        options={[
          { id: 'memory', label: `Agent Memories${counts.memory ? ` (${counts.memory})` : ''}` },
          { id: 'user', label: `User Profile Memories${counts.user ? ` (${counts.user})` : ''}` },
        ]}
        value={activeTab}
      />

      {/* Search */}
      {totalEntries > 2 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${activeTab === 'memory' ? 'agent memories' : 'user profile memories'}...`}
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
          Add {activeTab === 'memory' ? 'Agent Memory' : 'User Profile Memory'}
        </Button>
      )}

      {/* Entries grid */}
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
          <div className="size-3.5 animate-spin rounded-full border-2 border-(--ui-stroke-secondary) border-t-(--ui-text-secondary)" />
          Loading...
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-(--ui-stroke-secondary) py-8 text-center">
          <p className="text-muted-foreground text-sm">
            {query ? `No ${activeTab === 'memory' ? 'memories' : 'user profile memories'} matching "${query}"` : `No ${activeTab === 'memory' ? 'agent' : 'user profile'} memories yet.`}
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
              {filteredEntries.length} of {entries.length} entries
            </p>
          )}
          <div className={cn(
            'grid gap-3',
            filteredEntries.length >= 3 ? 'grid-cols-3' :
            filteredEntries.length === 2 ? 'grid-cols-2' : 'grid-cols-1'
          )}>
            {filteredEntries.map(entry => (
              <MemoryCard
                key={entry.index}
                entry={entry}
                onSave={handleSave}
                onDelete={handleDelete}
                onEditStart={setEditingIndex}
                onEditEnd={() => setEditingIndex(null)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** Top-level memory management: built-in (always on) + external provider when configured. */
export function MemoryManagement({ config }: { config: Record<string, unknown> }) {
  const memConfig = config?.memory as Record<string, unknown> | undefined
  const provider = memConfig?.provider as string | undefined
  const hasExternal = isExternalMemoryProvider(provider)

  const activeProfile = useStore($activeProfile)
  const profiles = useStore($profiles)
  const [selectedProfile, setSelectedProfile] = useState<string | undefined>(undefined)
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    void refreshProfiles()
  }, [])

  useEffect(() => {
    // If the currently selected profile no longer exists, reset to active
    if (selectedProfile && !profiles.some(p => p.name === selectedProfile)) {
      setSelectedProfile(undefined)
    }
  }, [profiles, selectedProfile])

  const displayProfile = selectedProfile || normalizeProfileKey(activeProfile)
  const displayName = selectedProfile || activeProfile

  const handleProfileSelect = (name: string) => {
    setSelectedProfile(name === normalizeProfileKey(activeProfile) ? undefined : name)
    setShowPicker(false)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Profile selector */}
      {profiles.length > 1 && (
        <div className="relative">
          <span className="mb-1 block text-[0.7rem] font-medium text-muted-foreground">Viewing memories for</span>
          <button
            className="flex items-center gap-1.5 rounded-lg border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary)/40 px-2.5 py-1.5 text-[0.7rem] font-medium text-(--ui-text-secondary) hover:bg-(--ui-bg-secondary)/60"
            onClick={() => setShowPicker(open => !open)}
            type="button"
          >
            <Codicon name="person" size="0.85em" />
            {displayName}
            {selectedProfile && <span className="text-muted-foreground/50">(viewing)</span>}
            <ChevronDown className="ml-1 size-3 text-muted-foreground/50" />
          </button>
          {showPicker && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowPicker(false)} />
              <div className="absolute left-0 z-50 mt-1 w-56 origin-top-left rounded-lg border border-(--ui-stroke-secondary) bg-popover shadow-lg">
                {profiles.map(p => {
                  const pName = normalizeProfileKey(p.name)
                  const isActive = pName === normalizeProfileKey(activeProfile)
                  const isSelected = pName === displayProfile
                  return (
                    <button
                      key={pName}
                      className={cn(
                        'flex w-full items-center justify-between rounded-tl-lg rounded-tr-lg px-3 py-2 text-sm first:rounded-tl-lg last:rounded-bl-lg',
                        isSelected
                          ? 'bg-(--ui-accent-secondary)/20 text-foreground'
                          : 'text-muted-foreground hover:bg-(--ui-bg-tertiary)'
                      )}
                      onClick={() => void handleProfileSelect(pName)}
                      type="button"
                    >
                      <span className="font-medium">{pName}</span>
                      <span className="flex items-center gap-1.5">
                        {isActive && (
                          <span className="rounded bg-(--ui-accent-secondary)/20 px-1.5 py-0.5 text-[0.6rem] font-medium text-(--ui-text-secondary)">
                            active
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Built-in memory — always active */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Brain className="size-3.5 text-(--ui-text-secondary)" />
          <h3 className="text-sm font-medium text-foreground">Built-in Memory</h3>
          <span className="text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
            (MEMORY.md / USER.md)
          </span>
        </div>
        <MemoryEntriesPanel profile={displayProfile} memoryLimit={memConfig?.memory_char_limit as number} userLimit={memConfig?.user_char_limit as number} />
      </section>

      {/* External provider — shown when a non-builtin provider is selected */}
      {hasExternal && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Cloud className="size-3.5 text-(--ui-text-secondary)" />
            <h3 className="text-sm font-medium text-foreground">{provider} Provider</h3>
            <MemoryConnect provider={provider} />
          </div>
          <ProviderConfigPanel provider={provider} />
        </section>
      )}
    </div>
  )
}
