/**
 * Reads a permission's state without asking for it (Permissions API), for the
 * "Ready to drive" checklist. Browsers that cannot tell (older Safari) give "unknown".
 */
import { useEffect, useState } from 'react'

export type PermissionKind = 'camera' | 'geolocation'
export type PermissionStatusValue = 'granted' | 'prompt' | 'denied' | 'unknown'

export function usePermission(name: PermissionKind): PermissionStatusValue {
  const [value, setValue] = useState<PermissionStatusValue>('unknown')
  useEffect(() => {
    let status: PermissionStatus | null = null
    let alive = true
    const update = () => {
      if (alive && status !== null) setValue(status.state)
    }
    navigator.permissions
      ?.query({ name: name as PermissionName })
      .then((s) => {
        status = s
        update()
        s.addEventListener('change', update)
      })
      .catch(() => {
        // Not supported for this name in this browser: stays "unknown".
      })
    return () => {
      alive = false
      status?.removeEventListener('change', update)
    }
  }, [name])
  return value
}
