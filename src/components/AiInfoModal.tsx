import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Sparkles, Terminal, Zap, Info, ExternalLink, Settings, Copy, Check } from 'lucide-react'
import './AiInfoModal.css'

interface AiInfoModalProps {
  isOpen: boolean
  onClose: () => void
}

const AiInfoModal: React.FC<AiInfoModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<'gemini' | 'claude' | 'codex'>('gemini')

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  const mcpUrl = 'http://127.0.0.1:3000/mcp'
  const sseUrl = 'http://127.0.0.1:3000/sse'

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="modal-overlay" onClick={onClose}>
          <motion.div
            className="modal-content ai-info-modal glass"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="ai-header-title">
                <Sparkles size={20} className="icon-pulse-purple" />
                <h3>AI Model Context Protocol (MCP)</h3>
              </div>
              <button className="btn-ghost" onClick={onClose}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-body ai-info-body">
              <section className="ai-hero">
                <div className="ai-icon-wrapper">
                  <Zap size={32} />
                </div>
                <h2>Supercharge Your AI Assistant</h2>
                <p>
                  UltraRPC hosts a built-in MCP server that allows AI agents like 
                  <strong> Claude</strong>, <strong>Gemini</strong>, and <strong>Codex</strong> to 
                  interact directly with your local API collections.
                </p>
              </section>

              <div className="ai-info-grid-main">
                <section className="info-section">
                  <div className="section-title">
                    <Settings size={16} />
                    <h4>1. Enable Server</h4>
                  </div>
                  <p>
                    Go to <strong>Global Settings</strong> (gear icon) and toggle 
                    <strong> MCP Server</strong> to Enabled. The default port is <code>3000</code>.
                  </p>
                  <div className="url-box">
                    <span>{activeTab === 'gemini' ? mcpUrl : sseUrl}</span>
                    <button onClick={() => copyToClipboard(activeTab === 'gemini' ? mcpUrl : sseUrl, 'url')}>
                      {copied === 'url' ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </section>

                <section className="info-section">
                  <div className="section-title">
                    <Terminal size={16} />
                    <h4>2. Connect Agents</h4>
                  </div>
                  
                  <div className="agent-tabs-header">
                    <button 
                      className={`agent-tab-btn ${activeTab === 'gemini' ? 'active' : ''}`}
                      onClick={() => setActiveTab('gemini')}
                    >
                      Gemini CLI
                    </button>
                    <button 
                      className={`agent-tab-btn ${activeTab === 'claude' ? 'active' : ''}`}
                      onClick={() => setActiveTab('claude')}
                    >
                      Claude Desktop / Code
                    </button>
                    <button 
                      className={`agent-tab-btn ${activeTab === 'codex' ? 'active' : ''}`}
                      onClick={() => setActiveTab('codex')}
                    >
                      Codex / Copilot
                    </button>
                  </div>

                  <div className="agent-tab-content">
                    {activeTab === 'gemini' && (
                      <div className="agent-instruction fade-in">
                        <strong>Quick Integration (Recommended)</strong>
                        <p>Run this command in your terminal — Gemini uses the Streamable HTTP endpoint (<code>/mcp</code>):</p>
                        <div className="code-block">
                          <pre>{`gemini mcp add --transport http ultrarpc ${mcpUrl}`}</pre>
                          <button className="copy-btn" onClick={() => copyToClipboard(`gemini mcp add --transport http ultrarpc ${mcpUrl}`, 'gemini')}>
                            {copied === 'gemini' ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                        <p style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>Or add manually to <code>~/.gemini/settings.json</code> under <code>mcpServers</code>.</p>
                      </div>
                    )}

                    {activeTab === 'claude' && (
                      <div className="agent-instruction fade-in">
                        <strong>JSON Configuration</strong>
                        <p>Both Claude Desktop and <strong>Claude Code</strong> use <code>stdio</code>. Add this bridge to your config (<code>claude_desktop_config.json</code> or <code>~/.claude.json</code>):</p>
                        <div className="code-block">
                          <pre>
{`{
  "mcpServers": {
    "ultrarpc": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${sseUrl}"]
    }
  }
}`}
                          </pre>
                          <button className="copy-btn" onClick={() => copyToClipboard(`{
  "mcpServers": {
    "ultrarpc": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${sseUrl}"]
    }
  }
}`, 'claude')}>
                            {copied === 'claude' ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                      </div>
                    )}

                    {activeTab === 'codex' && (
                      <div className="agent-instruction fade-in">
                        <strong>CLI Integration</strong>
                        <p>To add UltraRPC to Codex, use the built-in CLI to bridge the SSE connection via <code>mcp-remote</code>:</p>
                        <div className="code-block">
                          <pre>{`codex mcp add ultrarpc -- npx -y mcp-remote ${sseUrl}`}</pre>
                          <button className="copy-btn" onClick={() => copyToClipboard(`codex mcp add ultrarpc -- npx -y mcp-remote ${sseUrl}`, 'codex')}>
                            {copied === 'codex' ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                        <p style={{ marginTop: '12px' }}>Or add it to your <code>config.toml</code> manually.</p>
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <section className="info-section ops-section">
                <div className="section-title">
                  <Zap size={16} />
                  <h4>Supported Operations</h4>
                </div>
                <div className="ops-grid">
                  <div className="op-card">
                    <div className="op-tag">Tool</div>
                    <h5>list_collections</h5>
                    <p>Returns a list of all local API collections and their IDs.</p>
                  </div>
                  <div className="op-card">
                    <div className="op-tag">Tool</div>
                    <h5>create_collection</h5>
                    <p>Initializes a new empty collection on your local disk.</p>
                  </div>
                  <div className="op-card">
                    <div className="op-tag">Tool</div>
                    <h5>list_environments</h5>
                    <p>Lists all saved environments (excluding vault secrets).</p>
                  </div>
                  <div className="op-card">
                    <div className="op-tag">Tool</div>
                    <h5>create_environment</h5>
                    <p>Creates a new environment with variables and settings.</p>
                  </div>
                  <div className="op-card">
                    <div className="op-tag">Tool</div>
                    <h5>update_environment</h5>
                    <p>Modifies an existing environment by ID.</p>
                  </div>
                  <div className="op-card">
                    <div className="op-tag">Tool</div>
                    <h5>add_rest_request</h5>
                    <p>Adds a new REST request with headers, body, and params.</p>
                  </div>
                  <div className="op-card">
                    <div className="op-tag">Tool</div>
                    <h5>update_rest_request</h5>
                    <p>Updates an existing REST request by ID in a specific collection.</p>
                  </div>
                  <div className="op-card">
                    <div className="op-tag">Tool</div>
                    <h5>add_grpc_request</h5>
                    <p>Adds a new gRPC request with service, method, and payload.</p>
                  </div>
                  <div className="op-card">
                    <div className="op-tag">Tool</div>
                    <h5>update_grpc_request</h5>
                    <p>Updates an existing gRPC request by ID in a specific collection.</p>
                  </div>
                </div>
              </section>

              <div className="ai-footer-note">
                <Info size={14} />
                <span>The MCP server runs locally and never sends your data to external clouds.</span>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-ghost" onClick={() => window.ultraRpc.openExternal('https://modelcontextprotocol.io')}>
                Read Docs <ExternalLink size={12} />
              </button>
              <button className="btn-primary" onClick={onClose} style={{ background: 'var(--accent)', border: 'none' }}>
                Got it!
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export default AiInfoModal
