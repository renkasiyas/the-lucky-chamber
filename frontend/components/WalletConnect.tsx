// ABOUTME: Wallet connection button component
// ABOUTME: Displays connect/disconnect button and wallet address when connected

'use client'

import { useKasware } from '../hooks/useKasware'
import { Button } from './ui/Button'
import { formatAddress, formatBalance } from '../lib/format'
import { WalletSelectionModal } from './WalletSelectionModal'

export function WalletConnect() {
  const {
    address,
    connected,
    connecting,
    connect,
    disconnect,
    error,
    network,
    networkMismatch,
    expectedNetwork,
    balance,
    showWalletModal,
    closeWalletModal,
  } = useKasware()

  if (connected && address) {
    return (
      <div className="border border-edge bg-noir/80 rounded-lg p-5 backdrop-blur-sm">
        {/* Connected state */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gunmetal to-noir border border-edge-light flex items-center justify-center">
                <svg className="w-5 h-5 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-alive-light border-2 border-noir" />
            </div>
            <div>
              <div className="text-xs text-ash uppercase tracking-wide">Connected</div>
              <div className="font-mono text-gold text-sm">{formatAddress(address)}</div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={disconnect}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </Button>
        </div>

        {/* Balance */}
        {balance && (
          <div className="border-t border-edge pt-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-ash uppercase tracking-wide">Balance</span>
              {network && (
                <span className="text-xs text-ember font-mono">{network}</span>
              )}
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-display text-chalk">
                {formatBalance(Number(balance.total) || (Number(balance.confirmed) + Number(balance.unconfirmed)))}
              </span>
              <span className="text-sm text-ash">KAS</span>
            </div>
            {balance.unconfirmed !== '0' && (
              <div className="flex items-center gap-1 mt-1 text-xs text-gold">
                <svg className="w-3 h-3 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
                <span>+{formatBalance(balance.unconfirmed)} pending</span>
              </div>
            )}
          </div>
        )}

        {/* Network Mismatch Warning */}
        {networkMismatch && (
          <div className="mt-4 p-3 bg-blood/20 border border-blood/50 rounded-lg">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-blood-light flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-blood-light">Wrong Network</p>
                <p className="text-xs text-blood/80 mt-0.5">
                  Switch your wallet to {expectedNetwork.includes('testnet') ? 'Testnet' : 'Mainnet'} to play.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="border border-edge bg-noir/80 rounded-lg p-6 backdrop-blur-sm">
      {/* Wallet icon */}
      <div className="flex justify-center mb-5">
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-steel to-noir border-2 border-edge flex items-center justify-center">
          <svg className="w-8 h-8 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
      </div>

      <div className="text-center mb-5">
        <h3 className="font-display text-lg tracking-wide text-chalk mb-1">
          ENTER THE CHAMBER
        </h3>
        <p className="text-sm text-ash">
          Connect your wallet to play
        </p>
      </div>

      <Button
        variant="primary"
        onClick={connect}
        disabled={connecting}
        fullWidth
      >
        {connecting ? (
          <>
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>Connecting...</span>
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span>Connect Wallet</span>
          </>
        )}
      </Button>

      {error && (
        <div className="mt-4 p-3 border border-blood/30 bg-blood-muted rounded-lg">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-blood-light flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-ash">{error}</p>
          </div>
        </div>
      )}

      <WalletSelectionModal isOpen={showWalletModal} onClose={closeWalletModal} />
    </div>
  )
}
