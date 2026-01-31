// ABOUTME: Reusable button component with variants and loading state
// ABOUTME: Supports primary, secondary, danger, ghost variants with accessible focus states

'use client'

import { forwardRef, ButtonHTMLAttributes } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: `
    bg-gradient-to-r from-gold to-gold-dark text-void font-semibold
    hover:from-gold-light hover:to-gold
    shadow-md hover:shadow-gold
    disabled:from-gold/40 disabled:to-gold-dark/40 disabled:cursor-not-allowed disabled:shadow-none
  `,
  secondary: `
    bg-transparent border-2 border-edge text-chalk
    hover:border-gold/50 hover:text-gold hover:bg-gold/5
    disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-edge disabled:hover:text-chalk disabled:hover:bg-transparent
  `,
  danger: `
    bg-gradient-to-r from-blood to-blood-light text-chalk font-semibold
    hover:from-blood-light hover:to-blood
    shadow-md hover:shadow-blood
    disabled:from-blood/40 disabled:to-blood/40 disabled:cursor-not-allowed disabled:shadow-none
  `,
  ghost: `
    bg-transparent text-ash
    hover:text-chalk hover:bg-steel/50
    disabled:opacity-50 disabled:cursor-not-allowed
  `,
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-lg gap-1.5',
  md: 'px-5 py-2.5 text-base rounded-lg gap-2',
  lg: 'px-7 py-3.5 text-lg rounded-xl gap-2.5',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      fullWidth = false,
      disabled,
      children,
      className = '',
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        className={`
          inline-flex items-center justify-center
          transition-all duration-200 ease-out
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-void
          active:scale-[0.98]
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${fullWidth ? 'w-full' : ''}
          ${className}
        `.trim().replace(/\s+/g, ' ')}
        {...props}
      >
        {loading && (
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
