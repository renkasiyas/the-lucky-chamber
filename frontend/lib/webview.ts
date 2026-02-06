// ABOUTME: Utility to restore touch handling in mobile wallet webviews
// ABOUTME: Forces layout reflow after native wallet dialogs steal focus from WKWebView

export function forceWebviewReflow() {
  if (typeof window === 'undefined') return
  // Delay lets the native dialog fully dismiss before we attempt touch restoration
  setTimeout(() => {
    // Force synchronous layout reflow
    void document.body.offsetHeight
    // Scroll by 1px and back — an actual delta forces WKWebView to re-engage touch handlers
    // (scrollTo same position is optimized away as a no-op)
    window.scrollBy(0, 1)
    requestAnimationFrame(() => {
      window.scrollBy(0, -1)
    })
  }, 100)
}
