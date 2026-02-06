// ABOUTME: Utility to restore touch handling in mobile wallet webviews
// ABOUTME: Forces layout reflow after native wallet dialogs steal focus from WKWebView

const isWebview = typeof window !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

export function forceWebviewReflow() {
  if (!isWebview) return
  // Reading offsetHeight forces a synchronous layout reflow
  void document.body.offsetHeight
  // Scroll to current position re-engages touch event handling
  window.scrollTo(window.scrollX, window.scrollY)
}
