import { useState, useCallback } from 'react'

export type ValidationStatus = 'none' | 'success' | 'error'

export function useScriptValidation() {
  const [validationStatus, setValidationStatus] = useState<ValidationStatus>('none')
  const [validationError, setValidationError] = useState<string | null>(null)

  const validate = useCallback((content: string, options: { checkUltraLib?: boolean } = {}) => {
    if (!content.trim()) {
      setValidationStatus('none')
      setValidationError(null)
      return
    }

    try {
      // Basic syntax check using new Function
      new Function('ultra', 'console', content)
      
      if (options.checkUltraLib) {
        const registersSomething = content.includes('ultra.lib.')
        if (!registersSomething && !content.trim().startsWith('//')) {
          setValidationStatus('error')
          setValidationError('Script is syntactically valid, but does not seem to register any functions on "ultra.lib". Use "ultra.lib.myFunc = ..."')
          return
        }
      }

      setValidationStatus('success')
      setValidationError(null)
    } catch (err: any) {
      setValidationStatus('error')
      setValidationError(err.message || 'Unknown syntax error')
    }
  }, [])

  const resetValidation = useCallback(() => {
    setValidationStatus('none')
    setValidationError(null)
  }, [])

  return { validationStatus, validationError, validate, resetValidation }
}
