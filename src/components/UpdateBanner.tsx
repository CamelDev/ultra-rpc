import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowUpCircle, Download, X, SkipForward } from 'lucide-react'
import type { UpdateInfo } from '../types/electron'
import './UpdateBanner.css'

interface UpdateBannerProps {
  info: UpdateInfo
  onDownload: (url: string) => void
  onSkip: (version: string) => void
  onDismiss: () => void
}

const UpdateBanner: React.FC<UpdateBannerProps> = ({
  info,
  onDownload,
  onSkip,
  onDismiss,
}) => {
  return (
    <AnimatePresence>
      <motion.div
        className="update-banner glass"
        initial={{ opacity: 0, y: 24, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      >
        <div className="update-banner__icon">
          <ArrowUpCircle size={20} />
        </div>
        <div className="update-banner__content">
          <div className="update-banner__title">
            Get UltraRPC <strong>{info.latest}</strong> 
            
          </div>
     
          <div className="update-banner__notes">
            New version is available
          </div>

        </div>
        <div className="update-banner__actions">
          <button
            className="update-banner__btn update-banner__btn--primary"
            onClick={() => onDownload(info.url)}
          >
            <Download size={14} /> Download
          </button>
          <button
            className="update-banner__btn"
            onClick={() => onSkip(info.latest)}
            title="Skip this version"
          >
            <SkipForward size={14} /> Skip
          </button>
          <button
            className="update-banner__close"
            onClick={onDismiss}
            title="Remind me later"
          >
            <X size={14} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

export default UpdateBanner