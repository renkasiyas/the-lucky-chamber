// ABOUTME: TypeScript declarations for Kasware wallet browser extension
// ABOUTME: Defines window.kasware object and its methods

export interface KaswareWallet {
  requestAccounts: () => Promise<string[]>
  getAccounts: () => Promise<string[]>
  getNetwork: () => Promise<string>
  switchNetwork: (network: string) => Promise<void>
  getPublicKey: () => Promise<string>
  getBalance: () => Promise<{ total: string; confirmed: string; unconfirmed: string }>
  sendKaspa: (toAddress: string, amount: number) => Promise<string>
  signMessage: (message: string, type?: 'ecdsa' | 'schnorr') => Promise<string>
  on: (event: string, handler: (...args: any[]) => void) => void
  removeListener: (event: string, handler: (...args: any[]) => void) => void
}

declare global {
  interface Window {
    kasware?: KaswareWallet
  }
}

export {}
