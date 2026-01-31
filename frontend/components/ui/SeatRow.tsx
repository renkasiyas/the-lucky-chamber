// ABOUTME: Player seat display component for room player lists
// ABOUTME: Shows seat index, truncated address, status, and "You" indicator

'use client'

type SeatStatus = 'empty' | 'joined' | 'deposited' | 'confirmed' | 'alive' | 'dead'

interface SeatRowProps {
  index: number
  address?: string | null
  status: SeatStatus
  isYou?: boolean
  amount?: number
  className?: string
}

const statusConfig: Record<SeatStatus, {
  bg: string
  border: string
  text: string
  indicator: string
  label: string
}> = {
  empty: {
    bg: 'bg-smoke/50',
    border: 'border-edge',
    text: 'text-ember',
    indicator: 'bg-edge',
    label: 'Empty',
  },
  joined: {
    bg: 'bg-gold-muted',
    border: 'border-gold/30',
    text: 'text-gold',
    indicator: 'bg-gold animate-pulse',
    label: 'Joining',
  },
  deposited: {
    bg: 'bg-gold-muted',
    border: 'border-gold/30',
    text: 'text-gold',
    indicator: 'bg-gold animate-pulse',
    label: 'Pending',
  },
  confirmed: {
    bg: 'bg-alive-muted',
    border: 'border-alive/30',
    text: 'text-alive-light',
    indicator: 'bg-alive-light',
    label: 'Ready',
  },
  alive: {
    bg: 'bg-alive-muted',
    border: 'border-alive/30',
    text: 'text-alive-light',
    indicator: 'bg-alive-light',
    label: 'Alive',
  },
  dead: {
    bg: 'bg-blood-muted',
    border: 'border-blood/30',
    text: 'text-blood-light',
    indicator: 'bg-blood-light',
    label: 'Dead',
  },
}

function truncateAddress(address: string): string {
  if (address.length <= 16) return address
  return `${address.slice(0, 8)}...${address.slice(-6)}`
}

export function SeatRow({
  index,
  address,
  status,
  isYou = false,
  amount,
  className = '',
}: SeatRowProps) {
  const config = statusConfig[status]

  return (
    <div
      className={`
        relative flex items-center gap-3 p-4 rounded-xl
        border transition-all duration-200
        ${config.bg} ${config.border}
        ${status === 'dead' ? 'opacity-60' : ''}
        ${isYou ? 'ring-1 ring-gold/30' : ''}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {/* Chamber slot indicator */}
      <div className="relative flex-shrink-0">
        <div className={`
          w-10 h-10 rounded-full
          flex items-center justify-center
          bg-gradient-to-br from-gunmetal to-noir
          border-2 ${status === 'dead' ? 'border-blood/50' : 'border-edge-light'}
        `}>
          {/* Inner circle - bullet/empty */}
          <div className={`
            w-5 h-5 rounded-full
            ${status === 'dead'
              ? 'bg-gradient-to-br from-blood to-blood/50 shadow-blood'
              : status === 'empty'
                ? 'bg-gradient-to-br from-steel to-noir'
                : 'bg-gradient-to-br from-gunmetal to-noir border border-edge'
            }
          `} />
        </div>
        {/* Seat number */}
        <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-noir border border-edge flex items-center justify-center">
          <span className="text-[10px] font-mono text-ash">{index}</span>
        </div>
      </div>

      {/* Player info */}
      <div className="flex-1 min-w-0">
        {address ? (
          <div className="flex items-center gap-2">
            <span
              className={`
                font-mono text-sm ${status === 'dead' ? 'line-through' : ''}
                ${config.text}
              `.trim().replace(/\s+/g, ' ')}
            >
              {truncateAddress(address)}
            </span>
            {isYou && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase bg-gold text-void rounded">
                You
              </span>
            )}
          </div>
        ) : (
          <span className="text-sm text-ember italic font-light">Waiting for player...</span>
        )}
        {amount !== undefined && status !== 'empty' && (
          <span className="text-xs text-ash font-mono">{amount} KAS</span>
        )}
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${config.indicator}`} />
        <span className={`
          text-[10px] font-mono uppercase tracking-wider
          ${config.text}
        `}>
          {config.label}
        </span>
      </div>
    </div>
  )
}
