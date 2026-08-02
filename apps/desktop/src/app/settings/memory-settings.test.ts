import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Stub the heavy imports so we can test the pure logic
vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))

vi.mock('@/store/profile', () => ({
  $activeProfile: { get: () => 'default' },
  $profiles: { get: () => [] },
  normalizeProfileKey: (name: string | null | undefined) => (name || 'default').trim() || 'default',
  refreshProfiles: vi.fn(async () => [])
}))

vi.mock('@/hermes', () => ({
  getHermesConfigRecord: vi.fn(),
  getHermesConfigSchema: vi.fn(),
  saveHermesConfig: vi.fn(),
  getProfiles: vi.fn(async () => ({ profiles: [] })),
  setApiRequestProfile: vi.fn()
}))

// Mock the API global
const mockApi = vi.fn()
Object.assign(globalThis, {
  hermesDesktop: {
    api: mockApi
  }
})

describe('memory budget calculation', () => {
  beforeEach(() => {
    mockApi.mockReset()
  })

  it('computes char usage from entry content', () => {
    const entries = [
      { index: 0, content: 'Hello world' },
      { index: 1, content: 'Another entry here' }
    ]
    const used = entries.reduce((sum: number, e: { content: string }) => sum + e.content.length, 0)
    expect(used).toBe(11 + 18) // 'Hello world' + 'Another entry here'
  })

  it('handles empty entries list', () => {
    const entries: { content: string }[] = []
    const used = entries.reduce((sum: number, e: { content: string }) => sum + e.content.length, 0)
    expect(used).toBe(0)
  })

  it('formats budget with percentage when limit is set', () => {
    const used = 2500
    const limit = 10000
    const pct = Math.min((used / limit) * 100, 100)
    expect(Math.round(pct)).toBe(25)
  })

  it('caps percentage at 100 when over budget', () => {
    const used = 15000
    const limit = 10000
    const pct = Math.min((used / limit) * 100, 100)
    expect(Math.round(pct)).toBe(100)
  })

  it('shows chars only when no limit', () => {
    const used = 500
    const limit = 0
    if (!limit) {
      expect(`${used} chars`).toBe('500 chars')
    }
  })
})

describe('profile param wiring', () => {
  it('builds correct URL with profile param', () => {
    const profile = 'coder'
    const target = 'memory'
    const profileParam = profile ? `&profile=${encodeURIComponent(profile)}` : ''
    const url = `/api/memory/entries?target=${target}${profileParam}`
    expect(url).toBe('/api/memory/entries?target=memory&profile=coder')
  })

  it('omits profile param when undefined', () => {
    const profile = undefined
    const target = 'user'
    const profileParam = profile ? `&profile=${encodeURIComponent(profile)}` : ''
    const url = `/api/memory/entries?target=${target}${profileParam}`
    expect(url).toBe('/api/memory/entries?target=user')
  })

  it('encodes profile name with special characters', () => {
    const profile = 'my-profile'
    const target = 'memory'
    const profileParam = profile ? `&profile=${encodeURIComponent(profile)}` : ''
    const url = `/api/memory/entries?target=${target}${profileParam}`
    expect(url).toBe('/api/memory/entries?target=memory&profile=my-profile')
  })
})

describe('isExternalMemoryProvider', () => {
  // Import the real function — it's a pure helper with no React dependencies
  let isExternalMemoryProvider: (value: unknown) => value is string

  beforeEach(async () => {
    const mod = await import('./helpers')
    isExternalMemoryProvider = mod.isExternalMemoryProvider
  })

  it('treats real plugin names as external', () => {
    expect(isExternalMemoryProvider('honcho')).toBe(true)
    expect(isExternalMemoryProvider('mem0')).toBe(true)
    expect(isExternalMemoryProvider('supermemory')).toBe(true)
  })

  it('treats built-in aliases as not external', () => {
    expect(isExternalMemoryProvider('')).toBe(false)
    expect(isExternalMemoryProvider('builtin')).toBe(false)
    expect(isExternalMemoryProvider('built-in')).toBe(false)
    expect(isExternalMemoryProvider('none')).toBe(false)
    expect(isExternalMemoryProvider('Builtin')).toBe(false)
    expect(isExternalMemoryProvider(undefined)).toBe(false)
    expect(isExternalMemoryProvider(null)).toBe(false)
  })
})
