import React from 'react';
import { Plus, FolderOpen, Globe, Terminal, Box, Zap, Shield, Layout, Github } from 'lucide-react';
import { motion } from 'framer-motion';
import './IntroPage.css';

interface IntroPageProps {
  onNewRequest: (type: 'REST' | 'GRPC') => void;
  onOpenCollection: () => void;
  onImportEnvironments: () => void;
}

const IntroPage: React.FC<IntroPageProps> = ({ onNewRequest, onOpenCollection, onImportEnvironments }) => {
  return (
    <div className="intro-page">
      <div className="intro-container">

        <div className="intro-content">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            UltraRPC
          </motion.h1>
          <motion.p
            className="intro-subtitle"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
          >
            A developer-first API client with native gRPC support
          </motion.p>

          <motion.button
            className="readme-link"
            onClick={() => window.ultraRpc.openExternal('https://github.com/CamelDev/ultra-rpc/blob/main/README.md')}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.5 }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--accent)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
              marginBottom: '32px',
              transition: 'opacity 0.2s ease',
              padding: 0,
              opacity: 0.8
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '0.8'}
          >
            <Github size={16} /> Read the Documentation
          </motion.button>

          <div className="action-grid">
            <motion.button
              className="action-card glass-card"
              whileHover={{ y: -4, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onNewRequest('REST')}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
            >
              <div className="card-icon rest"><Plus size={24} /></div>
              <div className="card-text">
                <h3>New REST Request</h3>
                <p>Build and test HTTP/S endpoints with full control.</p>
              </div>
            </motion.button>

            <motion.button
              className="action-card glass-card"
              whileHover={{ y: -4, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onNewRequest('GRPC')}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5, duration: 0.5 }}
            >
              <div className="card-icon grpc"><Zap size={24} /></div>
              <div className="card-text">
                <h3>New gRPC Call</h3>
                <p>Native reflection support. No proto management needed.</p>
              </div>
            </motion.button>

            <motion.button
              className="action-card glass-card"
              whileHover={{ y: -4, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onOpenCollection}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.5 }}
            >
              <div className="card-icon folder"><FolderOpen size={24} /></div>
              <div className="card-text">
                <h3>Open Collection</h3>
                <p>Import existing collections from your filesystem.</p>
              </div>
            </motion.button>

            <motion.button
              className="action-card glass-card"
              whileHover={{ y: -4, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={onImportEnvironments}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.5 }}
            >
              <div className="card-icon environment"><Globe size={24} /></div>
              <div className="card-text">
                <h3>Environments</h3>
                <p>Manage variables and secrets securely across scopes.</p>
              </div>
            </motion.button>
          </div>

          <motion.div
            className="intro-features"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 1 }}
          >
            <div className="feature-item">
              <Shield size={16} /> <span>Local-First & Secure</span>
            </div>
            <div className="feature-item">
              <Terminal size={16} /> <span>Powerful JavaScript Scripting</span>
            </div>
            <div className="feature-item">
              <Box size={16} /> <span>Encrypted Secrets Vault</span>
            </div>
            <div className="feature-item">
              <Layout size={16} /> <span>Fully Multi-Tab Interface</span>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default IntroPage;
