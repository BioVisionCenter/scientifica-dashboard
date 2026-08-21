import type { ChannelMeta, ChannelSettings } from '../../api/types'

const PRESET_COLORS = ['#00AAFF', '#FF00FF', '#FFE94F', '#39C98E', '#FFFFFF']

export function defaultChannelSettings(channels: ChannelMeta[]): Record<string, ChannelSettings> {
  return Object.fromEntries(
    channels.map((ch) => [ch.key, { visible: true, color: ch.color, min: 0, max: 255 }]),
  )
}

/** Per-channel display controls: visibility, color, min/max contrast window. */
export function ChannelPanel({
  channels,
  settings,
  onChange,
}: {
  channels: ChannelMeta[]
  settings: Record<string, ChannelSettings>
  onChange: (next: Record<string, ChannelSettings>) => void
}) {
  const set = (key: string, patch: Partial<ChannelSettings>) =>
    onChange({ ...settings, [key]: { ...settings[key], ...patch } })

  return (
    <div className="card flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <span className="eyebrow">channels — mix them yourself</span>
        <button
          className="btn"
          style={{ padding: '5px 10px', fontSize: 12.5 }}
          onClick={() => onChange(defaultChannelSettings(channels))}
        >
          reset
        </button>
      </div>
      {channels.map((ch) => {
        const s = settings[ch.key]
        if (!s) return null
        return (
          <div key={ch.key} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label className="flex flex-1 items-center gap-2 text-[13px]" style={{ color: 'var(--ngio-ink-2)' }}>
                <input
                  type="checkbox"
                  checked={s.visible}
                  onChange={(e) => set(ch.key, { visible: e.target.checked })}
                />
                <span className="font-medium">{ch.label}</span>
              </label>
              <div className="flex items-center gap-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    className="h-4 w-4 rounded-full border"
                    style={{
                      background: c,
                      borderColor: s.color.toUpperCase() === c ? 'var(--ngio-ink)' : 'transparent',
                    }}
                    title={c}
                    onClick={() => set(ch.key, { color: c })}
                  />
                ))}
                <input
                  type="color"
                  value={s.color}
                  className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0"
                  onChange={(e) => set(ch.key, { color: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-7 text-right font-mono text-[11px]" style={{ color: 'var(--ngio-muted)' }}>
                {s.min}
              </span>
              <input
                type="range"
                className="flex-1"
                min={0}
                max={254}
                step={1}
                value={s.min}
                disabled={!s.visible}
                onChange={(e) => {
                  const v = parseInt(e.target.value)
                  set(ch.key, { min: v, max: Math.max(s.max, v + 1) })
                }}
              />
              <input
                type="range"
                className="flex-1"
                min={1}
                max={255}
                step={1}
                value={s.max}
                disabled={!s.visible}
                onChange={(e) => {
                  const v = parseInt(e.target.value)
                  set(ch.key, { max: v, min: Math.min(s.min, v - 1) })
                }}
              />
              <span className="w-7 font-mono text-[11px]" style={{ color: 'var(--ngio-muted)' }}>
                {s.max}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
