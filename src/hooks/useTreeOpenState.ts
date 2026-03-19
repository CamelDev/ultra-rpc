import { useState, useEffect, useRef, useCallback } from 'react'
import type { TreeApi } from 'react-arborist'

export function useTreeOpenState() {
  const [initialOpenState, setInitialOpenState] = useState<Record<string, true> | null>(null)
  const treeRef = useRef<TreeApi<any>>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load saved state once on mount
  useEffect(() => {
    if (!window.ultraRpc) {
      console.log('[TreeState] window.ultraRpc not available, skipping load')
      setInitialOpenState({})
      return
    }
    console.log('[TreeState] fetching initial state...')
    window.ultraRpc.getTreeOpenState().then((saved) => {
      console.log('[TreeState] initial state received:', saved)
      setInitialOpenState(saved ?? {})
    }).catch((err) => {
      console.error('[TreeState] error fetching state:', err)
      setInitialOpenState({})
    })
  }, [])

  // Collect currently open node IDs from the tree and persist them
  const persistOpenState = useCallback(() => {
    if (!treeRef.current || !window.ultraRpc) {
      console.log('[TreeState] treeRef.current or window.ultraRpc not ready, skipping save')
      return
    }

    const openState: Record<string, true> = {}
    
    // We iterate visibleNodes to capture those currently displayed.
    const nodes = treeRef.current.visibleNodes
    nodes.forEach((node) => {
      if (node.isOpen && node.children && node.children.length > 0) {
        openState[node.id] = true
      }
    })

    console.log('[TreeState] persisting state from', nodes.length, 'visible nodes:', openState)
    window.ultraRpc.setTreeOpenState(openState)
  }, [])

  // Debounced version — call this on every toggle
  const onToggle = useCallback(() => {
    console.log('[TreeState] onToggle called, queueing debounced save')
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(persistOpenState, 300)
  }, [persistOpenState])

  return { treeRef, initialOpenState, onToggle }
}
