type NavigationGuard = (url: string) => boolean | Promise<boolean>

const guards = new Set<NavigationGuard>()

export const registerNavigationGuard = (guard: NavigationGuard): () => void => {
  guards.add(guard)
  return () => {
    guards.delete(guard)
  }
}

export const canNavigate = async (url: string): Promise<boolean> => {
  for (const guard of guards) {
    if (!await guard(url)) return false
  }

  return true
}
