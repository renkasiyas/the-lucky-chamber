// ABOUTME: Pill-shaped badge component for status indicators
// ABOUTME: Supports room states (LOBBY, FUNDING, etc.) and network badges (TESTNET, MAINNET)

import { RoomState } from '../../../shared'

type BadgeVariant =
  | 'default'
  | 'gold'
  | 'success'
  | 'warning'
  | 'danger'
  | 'muted'
  | 'network-testnet'
  | 'network-mainnet'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
  size?: 'sm' | 'md'
  pulse?: boolean
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-smoke text-chalk border-edge',
  gold: 'bg-gold-muted text-gold border-gold/30',
  success: 'bg-alive-muted text-alive-light border-alive/30',
  warning: 'bg-gold-muted text-gold border-gold/30',
  danger: 'bg-blood-muted text-blood-light border-blood/30',
  muted: 'bg-smoke text-ember border-edge',
  'network-testnet': 'bg-gold-muted text-gold border-gold/30',
  'network-mainnet': 'bg-gold-muted text-gold border-gold/30',
}

const sizeStyles = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-3 py-1 text-xs',
}

export function Badge({
  variant = 'default',
  children,
  className = '',
  size = 'md',
  pulse = false,
}: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center gap-1.5
        font-mono uppercase tracking-wider rounded-full border
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${pulse ? 'animate-pulse' : ''}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {children}
    </span>
  )
}

const roomStateVariants: Record<RoomState, BadgeVariant> = {
  LOBBY: 'gold',
  FUNDING: 'warning',
  LOCKED: 'muted',
  PLAYING: 'success',
  SETTLED: 'success',
  ABORTED: 'muted',
}

const roomStateLabels: Record<RoomState, string> = {
  LOBBY: 'WAITING',
  FUNDING: 'FUNDING',
  LOCKED: 'LOCKED',
  PLAYING: 'LIVE',
  SETTLED: 'SETTLED',
  ABORTED: 'ABORTED',
}

interface RoomStateBadgeProps {
  state: RoomState
  className?: string
  size?: 'sm' | 'md'
}

export function RoomStateBadge({ state, className, size }: RoomStateBadgeProps) {
  const isPulsing = state === 'PLAYING' || state === 'FUNDING'
  return (
    <Badge variant={roomStateVariants[state]} className={className} size={size} pulse={isPulsing}>
      {state === 'PLAYING' && (
        <span className="w-1.5 h-1.5 rounded-full bg-alive-light" />
      )}
      {roomStateLabels[state]}
    </Badge>
  )
}

interface NetworkBadgeProps {
  network: 'mainnet' | 'testnet-10' | string
  className?: string
  size?: 'sm' | 'md'
}

export function NetworkBadge({ network, className, size }: NetworkBadgeProps) {
  const isTestnet = network.includes('testnet')
  return (
    <Badge
      variant={isTestnet ? 'network-testnet' : 'network-mainnet'}
      className={className}
      size={size}
    >
      {isTestnet ? 'TESTNET' : 'MAINNET'}
    </Badge>
  )
}
