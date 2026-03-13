import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Zap, Github, Heart, Info, ExternalLink } from 'lucide-react'
import './AboutModal.css'

interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
  version: string
}

const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose, version }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="modal-overlay" onClick={onClose}>
          <motion.div
            className="modal-content about-modal glass"
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="about-header-title">
                <Info size={18} className="icon-pulse" />
                <h3>About UltraRPC</h3>
              </div>
              <button className="btn-ghost" onClick={onClose}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body about-body">
              <div className="about-brand">
                <div className="about-logo-wrapper">
                  <Zap size={48} color="var(--accent)" fill="var(--accent)" />
                </div>
                <h2 className="about-app-name">UltraRPC</h2>
                <p className="about-version">Version {version}</p>
                <div className="about-badge">Stable Release</div>
              </div>

              <div className="about-description">
                <p>
                  A premium API client for <strong>REST</strong> and <strong>gRPC</strong> testing. 
                  Built for developers who demand speed, elegance, and native gRPC reflection support 
                  without the bloat.
                </p>
              </div>

              <div className="about-info-grid">
                <div className="info-card">
                  <h4>License</h4>
                  <p>MIT License</p>
                </div>
                <div className="info-card">
                  <h4>Platform</h4>
                  <p>Electron + React</p>
                </div>
                <div className="info-card">
                  <h4>Developer</h4>
                  <p>CamelDev</p>
                </div>
              </div>

              <div className="about-links">
                <button 
                  className="about-link btn-ghost" 
                  onClick={() => window.ultraRpc.openExternal('https://github.com/CamelDev/ultra-rpc')}
                >
                  <Github size={16} /> GitHub Repository <ExternalLink size={12} />
                </button>
              </div>
            </div>

            <div className="modal-footer about-footer">
              <div className="made-with">
                Made with <Heart size={14} color="#ef4444" fill="#ef4444" /> for the developer community
              </div>
              <button className="btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export default AboutModal
