// ABOUTME: Transaction/address display with copy and explorer link
// ABOUTME: Truncates long values, provides copy feedback, and links to block explorer

'use client'

import { useState, useCallback } from 'react'

interface TxLinkProps {
  value: string
  type?: 'tx' | 'address' | 'hash'
  label?: string
  explorerBaseUrl?: string
  className?: string
  showFull?: boolean
}

function truncateValue(value: string, showFull: boolean): string {
  if (showFull || value.length <= 20) return value
  return `${value.slice(0, 8)}...${value.slice(-6)}`
}

function getExplorerUrl(
  baseUrl: string,
  value: string,
  type: 'tx' | 'address' | 'hash'
): string {
  const cleanBase = baseUrl.replace(/\/$/, '')
  switch (type) {
    case 'tx':
      return `${cleanBase}/transactions/${value}`
    case 'address':
      return `${cleanBase}/addresses/${value}`
    case 'hash':
      return `${cleanBase}/blocks/${value}`
    default:
      return cleanBase
  }
}

export function TxLink({
  value,
  type = 'tx',
  label,
  explorerBaseUrl = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://kaspa.stream',
  className = '',
  showFull = false,
}: TxLinkProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Silent fail - clipboard access may be blocked
    }
  }, [value])

  const explorerUrl = getExplorerUrl(explorerBaseUrl, value, type)

  return (
    <div
      className={`
        inline-flex items-center gap-2 text-sm
        ${className}
      `.trim().replace(/\s+/g, ' ')}
    >
      {label && <span className="text-muted">{label}:</span>}

      <span className="font-mono text-text" title={value}>
        {truncateValue(value, showFull)}
      </span>

      {/* Copy button */}
      <button
        onClick={handleCopy}
        className="p-1 rounded hover:bg-surface-2 transition-colors text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
        title={copied ? 'Copied!' : 'Copy to clipboard'}
        aria-label={copied ? 'Copied' : 'Copy to clipboard'}
      >
        {copied ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4 text-success"
          >
            <path
              fillRule="evenodd"
              d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4"
          >
            <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" />
            <path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" />
          </svg>
        )}
      </button>

      {/* Explorer link */}
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="p-1 rounded hover:bg-surface-2 transition-colors text-muted hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
        title="View on explorer"
        aria-label="View on block explorer"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-4 h-4"
        >
          <path
            fillRule="evenodd"
            d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z"
            clipRule="evenodd"
          />
          <path
            fillRule="evenodd"
            d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z"
            clipRule="evenodd"
          />
        </svg>
      </a>
    </div>
  )
}
