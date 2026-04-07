import React from 'react';
import { createPortal } from 'react-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { 
  GripVertical, 
  Trash2, 
  ChevronDown, 
  ChevronUp, 
  Settings,
  Zap,
  Hourglass,
  CheckCircle2,
  FileCode,
  Copy,
  Check,
  X,
  Maximize2,
  Play,
  Square,
  RotateCcw,
  Database,
  Search,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { FlowStep } from '../types/flow';
import Editor from './Editor';
import { RequestSelectorModal } from './RequestSelectorModal';
import { JsonResponsePickerModal } from './JsonResponsePickerModal';
import Tooltip from './Tooltip';
import './StepCard.css';

interface StepCardProps {
  step: FlowStep;
  index: number;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<FlowStep>) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  collections?: any[];
  environments?: any[];
  onFollowDefinition?: (name: string) => void;
  onOpenRequest?: (requestId: string) => void;
  /** Whether the full flow is currently running */
  isFlowRunning?: boolean;
  /** Whether this is the next eligible step to run manually */
  isActiveStep?: boolean;
  /** The step ID that is currently executing */
  runningStepId?: string | null;
  onRunStep?: (step_id: string) => void;
  onCancelStep?: (stepId: string) => void;
  /** Whether the flow is locked due to execution state */
  isLocked?: boolean;
  /** All steps in the flow (for cross-step referencing) */
  allSteps?: FlowStep[];
}

export const StepCard: React.FC<StepCardProps> = ({ 
  step, 
  index,
  onDelete, 
  onUpdate, 
  isExpanded, 
  onToggleExpand,
  collections,
  environments,
  onFollowDefinition,
  onOpenRequest,
  isFlowRunning = false,
  isActiveStep = false,
  runningStepId,
  onRunStep,
  onCancelStep,
  isLocked = false,
  allSteps = []
}) => {
  const [modalData, setModalData] = React.useState<{ title: string, content: string } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [showRequestSelector, setShowRequestSelector] = React.useState(false);
  const [pickerConfig, setPickerConfig] = React.useState<{ 
    assertionId: string, 
    side: 'left' | 'right', 
    stepId: string,
    stepName: string
  } | null>(null);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Helpers for multi-assertion UI
  const addAssertion = () => {
    const newAssertions = [...(step.config.assertions || [])];
    newAssertions.push({
      id: Math.random().toString(36).substring(2, 11),
      left: { type: 'constant', value: '' },
      operator: '==',
      right: { type: 'constant', value: '' },
      enabled: true
    });
    onUpdate(step.id, { config: { ...step.config, assertions: newAssertions } });
  };

  const removeAssertion = (id: string) => {
    onUpdate(step.id, { 
      config: { 
        ...step.config, 
        assertions: step.config.assertions?.filter(a => a.id !== id) 
      } 
    });
  };

  const updateAssertion = (id: string, updates: any) => {
    onUpdate(step.id, {
      config: {
        ...step.config,
        assertions: step.config.assertions?.map(a => a.id === id ? { ...a, ...updates } : a)
      }
    });
  };

  const previousSteps = React.useMemo(() => {
    return allSteps.slice(0, index).filter(s => s.type === 'request');
  }, [allSteps, index]);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 1,
    opacity: isDragging ? 0.5 : 1,
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalData) {
        setModalData(null);
      }
    };

    if (modalData) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [modalData]);

  const statusColor = step.status === 'success' ? '#10b981' : 
                      step.status === 'error' ? '#ef4444' : 
                      step.status === 'running' ? '#3b82f6' : 
                      '#71717a';

  const getIcon = () => {
    switch (step.type) {
      case 'request': return <Zap size={18} />;
      case 'delay': return <Hourglass size={18} />;
      case 'assert': return <CheckCircle2 size={18} />;
      case 'script': return <FileCode size={18} />;
      case 'restart': return <RotateCcw size={18} />;
      default: return <Settings size={18} />;
    }
  };

  const currentRequestName = React.useMemo(() => {
    if (!step.config.requestId || !collections) return 'Select a saved request...';
    let name = 'Unknown Request';
    const find = (items: any[]) => {
      for (const item of items) {
        if (item.id === step.config.requestId) { name = item.name; return true; }
        if (item.type === 'folder' && item.children && find(item.children)) return true;
      }
      return false;
    };
    collections.forEach(c => find(c.children || []));
    return name;
  }, [step.config.requestId, collections]);

  return (
    <div ref={setNodeRef} style={style} className={`step-card ${step.type} ${step.status || 'idle'}`}>
      <div className="step-card-header">
        {!isLocked && (
          <div className="step-drag-handle" {...attributes} {...listeners}>
            <GripVertical size={16} />
          </div>
        )}
        
        <div className="step-icon" style={{ color: statusColor }}>
          {getIcon()}
        </div>

        <div className="step-title">
          <input 
            type="text" 
            value={step.name} 
            onChange={(e) => onUpdate(step.id, { name: e.target.value })}
            placeholder="Step Name"
            disabled={isLocked}
          />
        </div>

      <div className="step-actions">
          {/* Cancel button — active only when THIS step is running */}
          {runningStepId === step.id && (
            <button 
              className="step-action-btn cancel-step-btn"
              title="Cancel current operation"
              onClick={() => onCancelStep?.(step.id)}
            >
              <Square size={13} fill="currentColor" /> Cancel
            </button>
          )}

          {/* Run button — active only for the next eligible step when flow is idle */}
          {isActiveStep && !isFlowRunning && (
            <button 
              className="step-action-btn run-step-btn"
              title="Run this step only"
              onClick={() => onRunStep?.(step.id)}
            >
              <Play size={13} fill="currentColor" /> Run this step
            </button>
          )}

          <button onClick={onToggleExpand} className="icon-btn">
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button 
            onClick={() => onDelete(step.id)} 
            className="icon-btn delete"
            disabled={isLocked}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="step-card-content-wrapper"
          >
            <div className="step-card-content">
              {step.type === 'request' && (
                <>
                  <div className="step-config-row">
                  <label>Request</label>
                  <div className="request-picker-container">
                    <button 
                      className="selector-trigger"
                      onClick={() => setShowRequestSelector(true)}
                      disabled={isLocked}
                    >
                      <Database size={14} className="trigger-icon" />
                      <span className="trigger-text">{currentRequestName}</span>
                      <ChevronDown size={14} className="trigger-chevron" />
                    </button>

                    {step.type === 'request' && step.config.requestId && onOpenRequest && (
                      <button 
                        className="edit-request-btn"
                        onClick={() => onOpenRequest(step.config.requestId!)}
                        title="Edit original request"
                        disabled={isLocked}
                      >
                        <ExternalLink size={14} />
                        Edit Request
                      </button>
                    )}
                    
                    <AnimatePresence>
                      {showRequestSelector && collections && (
                        <RequestSelectorModal
                          collections={collections}
                          currentRequestId={step.config.requestId}
                          onClose={() => setShowRequestSelector(false)}
                          onSelect={(reqId, colId) => {
                            onUpdate(step.id, { 
                              config: { ...step.config, requestId: reqId, collectionId: colId } 
                            });
                          }}
                        />
                      )}
                    </AnimatePresence>
                  </div>

                  <label className="env-label">Environment</label>
                  <div className="env-picker-container">
                    <select
                      value={step.config.envId || ''}
                      onChange={(e) => onUpdate(step.id, { config: { ...step.config, envId: e.target.value || undefined } })}
                      disabled={isLocked}
                    >
                      <option value="">(Flow Environment)</option>
                      {environments?.map(env => (
                        <option key={env.id} value={env.id}>{env.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                
                {(step.requestData || step.responseData) && (
                  <div className="step-results-split">
                    {/* Request Side */}
                    <div className="result-pane">
                      <div className="result-pane-header">
                        <span className="result-pane-title">Request</span>
                        {step.requestData?.payload && (
                          <button 
                            className="btn-inspect" 
                            onClick={() => setModalData({ 
                              title: 'Request Payload', 
                              content: typeof step.requestData.payload === 'string' ? step.requestData.payload : JSON.stringify(step.requestData.payload, null, 2) 
                            })}
                          >
                            <Maximize2 size={12} /> Show Payload
                          </button>
                        )}
                      </div>
                      
                      {step.requestData && (
                        <div className="metadata-container">
                          <div className="metadata-group">
                            <div className="metadata-item">
                              <label>Host</label>
                              <span>{step.requestData.host || 'N/A'}</span>
                            </div>
                            <div className="metadata-item">
                              <label>Service</label>
                              <span title={step.requestData.service}>{step.requestData.service?.split('.').pop() || 'N/A'}</span>
                            </div>
                            <div className="metadata-item">
                              <label>Method</label>
                              <span className="method-badge">{step.requestData.method || 'N/A'}</span>
                            </div>
                          </div>

                          {step.requestData.headers && Object.keys(step.requestData.headers).length > 0 && (
                            <div className="metadata-group headers">
                              <label className="group-label">Headers</label>
                              {Object.entries(step.requestData.headers).map(([k, v]) => (
                                <div key={k} className="metadata-item tiny">
                                  <label>{k}</label>
                                  <span>{String(v)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Response Side */}
                    <div className="result-pane">
                      <div className="result-pane-header">
                        <span className="result-pane-title">Response</span>
                        {step.responseData?.body && (
                          <button 
                            className="btn-inspect" 
                            onClick={() => setModalData({ 
                              title: 'Response Body', 
                              content: typeof step.responseData.body === 'string' ? step.responseData.body : JSON.stringify(step.responseData.body, null, 2) 
                            })}
                          >
                            <Maximize2 size={12} /> Show Body
                          </button>
                        )}
                      </div>

                      {step.responseData && (
                        <div className="metadata-container">
                          <div className="metadata-group">
                            <div className="metadata-item">
                              <label>Status</label>
                              <span className={`status-badge ${step.responseData.status === 0 ? 'success' : 'error'}`}>
                                {step.responseData.status} {step.responseData.statusText}
                              </span>
                            </div>
                            <div className="metadata-item">
                              <label>Type</label>
                              <span>{step.responseData.type || 'N/A'}</span>
                            </div>
                          </div>

                          {step.responseData.headers && Object.keys(step.responseData.headers).length > 0 && (
                            <div className="metadata-group headers">
                              <label className="group-label">Headers</label>
                              {Object.entries(step.responseData.headers).map(([k, v]) => (
                                <div key={k} className="metadata-item tiny">
                                  <label>{k}</label>
                                  <span>{String(v)}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {step.responseData.trailers && Object.keys(step.responseData.trailers).length > 0 && (
                            <div className="metadata-group headers trailers">
                              <label className="group-label">Trailers</label>
                              {Object.entries(step.responseData.trailers).map(([k, v]) => (
                                <div key={k} className="metadata-item tiny">
                                  <label>{k}</label>
                                  <span>{String(v)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

              {step.type === 'delay' && (
                <div className="step-config-row">
                  <label>Duration (ms)</label>
                  <input 
                    type="number" 
                    value={step.config.durationMs || 0}
                    onChange={(e) => onUpdate(step.id, { config: { ...step.config, durationMs: parseInt(e.target.value) } })}
                    disabled={isLocked}
                  />
                </div>
              )}

              {step.type === 'assert' && (
                <div className="step-config-column assertion-list">
                  <div className="assertion-header">
                    <label>Assertions</label>
                    <button className="btn-add-assertion" onClick={addAssertion} disabled={isLocked}>
                      + Add Item
                    </button>
                  </div>
                  
                  {(!step.config.assertions || step.config.assertions.length === 0) && !step.config.assertion && (
                    <div className="assertion-empty-state">
                      No assertions defined. Add one to start testing results.
                    </div>
                  )}

                  {/* Backward compatibility fallback display */}
                  {(!step.config.assertions || step.config.assertions.length === 0) && step.config.assertion && (
                    <div className="assertion-row legacy">
                      <div className="assertion-legacy-badge">Legacy</div>
                      <input 
                        value={step.config.assertion.left}
                        onChange={(e) => onUpdate(step.id, { config: { ...step.config, assertion: { ...step.config.assertion!, left: e.target.value } } })}
                        disabled={isLocked}
                      />
                      <span className="legacy-operator">{step.config.assertion.operator}</span>
                      <input 
                        value={step.config.assertion.right}
                        onChange={(e) => onUpdate(step.id, { config: { ...step.config, assertion: { ...step.config.assertion!, right: e.target.value } } })}
                        disabled={isLocked}
                      />
                      <Tooltip text="This is an old-style assertion. Add a new one above to modernize." position="top">
                        <span className="legacy-hint">!</span>
                      </Tooltip>
                    </div>
                  )}

                  <div className="assertions-container">
                    {step.config.assertions?.map((assertion) => (
                      <div key={assertion.id} className="assertion-row-complex">
                        <div className="assertion-main">
                          {/* Left Operand */}
                          <div className="operand-group">
                            <select 
                              value={assertion.left.type}
                              onChange={(e) => updateAssertion(assertion.id, { left: { ...assertion.left, type: e.target.value as any, stepId: undefined } })}
                              disabled={isLocked}
                              className="source-select"
                            >
                              <option value="constant">Value</option>
                              <option value="variable">Variable</option>
                              <option value="step_response">Step Result</option>
                            </select>
                            
                            {assertion.left.type === 'step_response' ? (
                              <div className="step-response-inputs">
                                <select 
                                  value={assertion.left.stepId || ''}
                                  onChange={(e) => updateAssertion(assertion.id, { left: { ...assertion.left, stepId: e.target.value } })}
                                  disabled={isLocked}
                                  className="step-select"
                                >
                                  <option value="" disabled>Pick Step</option>
                                  {previousSteps.map(ps => (
                                    <option key={ps.id} value={ps.id}>{ps.name}</option>
                                  ))}
                                </select>
                                <div className="step-path-picker-group">
                                  <input 
                                    placeholder="JSONPath ($.id)" 
                                    value={assertion.left.value}
                                    onChange={(e) => updateAssertion(assertion.id, { left: { ...assertion.left, value: e.target.value } })}
                                    disabled={isLocked}
                                    className="path-input"
                                  />
                                  {assertion.left.stepId && (
                                    <button 
                                      className="btn-picker-trigger"
                                      onClick={() => {
                                        const ps = allSteps.find(s => s.id === assertion.left.stepId);
                                        if (ps) {
                                          setPickerConfig({ 
                                            assertionId: assertion.id, 
                                            side: 'left', 
                                            stepId: ps.id,
                                            stepName: ps.name 
                                          });
                                        }
                                      }}
                                      title="Pick from Response"
                                      disabled={isLocked}
                                    >
                                      <span>Select from response</span>
                                      <Search size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <input 
                                placeholder={assertion.left.type === 'variable' ? "Variable Name" : "Constant Value"}
                                value={assertion.left.value}
                                onChange={(e) => updateAssertion(assertion.id, { left: { ...assertion.left, value: e.target.value } })}
                                disabled={isLocked}
                              />
                            )}
                          </div>

                          {/* Row 2: Operator + Right Operand */}
                          <div className="assertion-operator-row">
                          {/* Operator */}
                          <select 
                            value={assertion.operator}
                            onChange={(e) => updateAssertion(assertion.id, { operator: e.target.value as any })}
                            disabled={isLocked}
                            className="operator-select"
                          >
                            <option value="==">is equal to</option>
                            <option value="!=">is not equal to</option>
                            <option value=">">is greater than</option>
                            <option value="<">is less than</option>
                            <option value=">=">is greater or equal</option>
                            <option value="<=">is less or equal</option>
                            <option value="contains">contains</option>
                            <option value="not_contains">does not contain</option>
                            <option value="matches">matches regex</option>
                            <option value="exists">exists</option>
                            <option value="not_exists">does not exist</option>
                            <option value="is_null">is null</option>
                            <option value="is_not_null">is not null</option>
                          </select>

                          {/* Right Operand */}
                          <div className="operand-group">
                            {assertion.operator !== 'exists' && 
                             assertion.operator !== 'not_exists' && 
                             assertion.operator !== 'is_null' && 
                             assertion.operator !== 'is_not_null' && 
                             assertion.right && (
                              <>
                                <select 
                                  value={assertion.right.type}
                                  onChange={(e) => updateAssertion(assertion.id, { 
                                    right: { ...assertion.right!, type: e.target.value as any, stepId: undefined } 
                                  })}
                                  disabled={isLocked}
                                  className="source-select"
                                >
                                  <option value="constant">Value</option>
                                  <option value="variable">Variable</option>
                                  <option value="step_response">Step Result</option>
                                </select>
                                
                                {assertion.right.type === 'step_response' ? (
                                  <div className="step-response-inputs">
                                    <select 
                                      value={assertion.right.stepId || ''}
                                      onChange={(e) => updateAssertion(assertion.id, { 
                                        right: { ...assertion.right!, stepId: e.target.value } 
                                      })}
                                      disabled={isLocked}
                                      className="step-select"
                                    >
                                      <option value="" disabled>Pick Step</option>
                                      {previousSteps.map(ps => (
                                        <option key={ps.id} value={ps.id}>{ps.name}</option>
                                      ))}
                                    </select>
                                    <div className="step-path-picker-group">
                                      <input 
                                        placeholder="JSONPath" 
                                        value={assertion.right.value}
                                        onChange={(e) => updateAssertion(assertion.id, { 
                                          right: { ...assertion.right!, value: e.target.value } 
                                        })}
                                        disabled={isLocked}
                                        className="path-input"
                                      />
                                      {assertion.right.stepId && (
                                        <button 
                                          className="btn-picker-trigger"
                                          onClick={() => {
                                            const ps = allSteps.find(s => s.id === assertion.right!.stepId);
                                            if (ps) {
                                              setPickerConfig({ 
                                                assertionId: assertion.id, 
                                                side: 'right', 
                                                stepId: ps.id,
                                                stepName: ps.name 
                                              });
                                            }
                                          }}
                                          title="Pick from Response"
                                          disabled={isLocked}
                                        >
                                          <span>Select from response</span>
                                          <Search size={14} />
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ) : (
                                  <input 
                                    placeholder={assertion.right.type === 'variable' ? "Variable Name" : "Constant Value"}
                                    value={assertion.right.value}
                                    onChange={(e) => updateAssertion(assertion.id, { 
                                      right: { ...assertion.right!, value: e.target.value } 
                                    })}
                                    disabled={isLocked}
                                  />
                                )}
                              </>
                            )}
                          </div>
                          </div>
                        </div>
                        <button 
                          className="btn-remove-assertion" 
                          onClick={() => removeAssertion(assertion.id)}
                          disabled={isLocked}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {step.type === 'script' && (
                <div className="step-config-column" style={{ height: '200px' }}>
                  <label>Script (ultra.context, ultra.log, ultra.lib)</label>
                  <Editor
                    value={step.config.code || ''}
                    onChange={(val) => onUpdate(step.id, { config: { ...step.config, code: val } })}
                    placeholder="ultra.context.set('foo', 'bar'); ultra.lib.myFunc();"
                    language="javascript"
                    onFollowDefinition={onFollowDefinition}
                    readOnly={isLocked}
                  />
                </div>
              )}

              {step.type === 'restart' && (
                <div className="step-config-row info-row">
                  <div className="info-badge">
                    <RotateCcw size={14} />
                    <span>This step will reset all variables to baseline and clear results. If running as part of a flow, it jumps back to step 1.</span>
                  </div>
                </div>
              )}
              </div>
              </motion.div>        )}
      </AnimatePresence>

      {step.error && (
        <div className="step-error">
          {step.error}
        </div>
      )}

      {createPortal(
        <AnimatePresence>
          {modalData && (
            <div className="modal-overlay" onClick={() => setModalData(null)}>
              <motion.div
                className="modal-content payload-modal glass"
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="modal-header">
                  <h3>{modalData.title}</h3>
                  <div className="modal-header-actions">
                    <button className="btn-ghost" onClick={() => handleCopy(modalData.content)}>
                      {copied ? <Check size={16} color="var(--success)" /> : <Copy size={16} />}
                    </button>
                    <button className="btn-ghost" onClick={() => setModalData(null)}>
                      <X size={20} />
                    </button>
                  </div>
                </div>
                <div className="modal-body payload-body">
                  <div className="payload-editor-container">
                    <Editor
                      value={modalData.content}
                      language="json"
                      readOnly={true}
                    />
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {pickerConfig && (
        <JsonResponsePickerModal 
          isOpen={true}
          onClose={() => setPickerConfig(null)}
          title={pickerConfig.stepName}
          jsonData={(() => {
            const ps = allSteps.find(s => s.id === pickerConfig.stepId);
            const body = ps?.responseData?.body;
            if (!body) return {};
            try {
              return typeof body === 'string' ? JSON.parse(body) : body;
            } catch {
              return body;
            }
          })()}
          onSelectPath={(path) => {
            const assertion = step.config.assertions?.find(a => a.id === pickerConfig.assertionId);
            if (assertion) {
              if (pickerConfig.side === 'left') {
                updateAssertion(pickerConfig.assertionId, { left: { ...assertion.left, value: path } });
              } else if (assertion.right) {
                updateAssertion(pickerConfig.assertionId, { right: { ...assertion.right, value: path } });
              }
            }
          }}
        />
      )}
    </div>
  );
};
