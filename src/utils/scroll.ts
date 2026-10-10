export function scrollToSettingCard(sectionId: string, smooth = true): boolean {
  const container =
    document.getElementById('setting-scroll-container') ??
    document.querySelector('main')
  const targetEl = document.getElementById(sectionId)
  if (!container || !targetEl) return false

  const containerRect = container.getBoundingClientRect()
  const targetRect = targetEl.getBoundingClientRect()
  const targetScrollTop =
    container.scrollTop + (targetRect.top - containerRect.top) - 16

  container.scrollTo({
    top: Math.max(0, targetScrollTop),
    behavior: smooth ? 'smooth' : 'auto',
  })
  return true
}
