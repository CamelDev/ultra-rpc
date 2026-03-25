import React from 'react'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import './ValidationBanner.css'

interface ValidationBannerProps {
  status: 'none' | 'success' | 'error'
  error?: string | null
  style?: React.CSSProperties
}

const ValidationBanner: React.FC<ValidationBannerProps> = ({ status, error, style }) => {
  if (status === 'none') return null

  return (
    <div className={`validation-banner ${status}`} style={style}>
      {status === 'success' ? (
        <>
          <CheckCircle2 size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />
          <div style={{ color: 'var(--success)', fontWeight: 500 }}>Script is syntactically valid</div>
        </>
      ) : (
        <>
          <AlertCircle size={15} style={{ color: 'var(--danger)', flexShrink: 0 }} />
          <div style={{ color: 'var(--danger)' }}>
            <strong>Validation Error:</strong> {error}
          </div>
        </>
      )}
    </div>
  )
}

export default ValidationBanner
