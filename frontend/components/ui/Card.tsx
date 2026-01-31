// ABOUTME: Card component for content sections with header and badge support
// ABOUTME: Used for room details, player lists, deposit info, and provably fair data

import { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  variant?: 'default' | 'elevated' | 'danger'
  style?: React.CSSProperties
}

interface CardHeaderProps {
  children: ReactNode
  className?: string
}

interface CardTitleProps {
  children: ReactNode
  className?: string
}

interface CardContentProps {
  children: ReactNode
  className?: string
}

interface CardFooterProps {
  children: ReactNode
  className?: string
}

const cardVariants = {
  default: 'bg-noir/80 border-edge',
  elevated: 'bg-noir/90 border-edge-light shadow-lg shadow-black/30',
  danger: 'bg-blood-muted border-blood/30',
}

export function Card({ children, className = '', variant = 'default', style }: CardProps) {
  return (
    <div
      className={`
        border rounded-xl backdrop-blur-sm
        ${cardVariants[variant]}
        ${className}
      `.trim().replace(/\s+/g, ' ')}
      style={style}
    >
      {children}
    </div>
  )
}

export function CardHeader({ children, className = '' }: CardHeaderProps) {
  return (
    <div
      className={`
        flex items-center justify-between gap-4
        px-5 py-4 border-b border-edge
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {children}
    </div>
  )
}

export function CardTitle({ children, className = '' }: CardTitleProps) {
  return (
    <h3
      className={`
        font-display text-lg tracking-wide text-chalk
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {children}
    </h3>
  )
}

export function CardContent({ children, className = '' }: CardContentProps) {
  return (
    <div
      className={`
        px-5 py-5
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {children}
    </div>
  )
}

export function CardFooter({ children, className = '' }: CardFooterProps) {
  return (
    <div
      className={`
        flex items-center gap-4
        px-5 py-4 border-t border-edge
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {children}
    </div>
  )
}
