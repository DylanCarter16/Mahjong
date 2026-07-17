// The reconnecting overlay (§7): a clear, CALM cover — not an error. On a PWA
// the socket dies every time the phone backgrounds, so players see this
// constantly; it must read as "hang on" not "something broke". While it's up,
// the seat is held (60s grace) and the game state is replayed on return.

import type { ConnStatus } from '../net/RemoteRoom'

export function ReconnectingOverlay({
  status,
  detail,
  onLeave,
}: {
  status: ConnStatus
  detail?: string
  onLeave: () => void
}) {
  if (status === 'open') return null

  const ended = status === 'ended'
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-emerald-950/80 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-live="assertive"
      aria-label={ended ? 'Disconnected' : 'Reconnecting'}
    >
      <div className="w-full max-w-sm rounded-2xl border border-emerald-700 bg-emerald-900 p-6 text-center shadow-2xl">
        {!ended && (
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-emerald-600 border-t-amber-300 motion-reduce:animate-none" />
        )}
        <h2 className="text-lg font-bold text-emerald-50">
          {ended ? 'Disconnected' : status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </h2>
        <p className="mt-2 text-sm text-emerald-200/80">
          {detail ??
            (ended
              ? 'The connection closed.'
              : 'Hang tight — your seat is held and the game will pick up where you left off.')}
        </p>
        {ended && (
          <button
            className="mt-5 min-h-11 w-full rounded-lg bg-amber-400 px-4 py-2.5 font-semibold text-amber-950 hover:bg-amber-300 cursor-pointer"
            onClick={onLeave}
          >
            Back to menu
          </button>
        )}
      </div>
    </div>
  )
}
