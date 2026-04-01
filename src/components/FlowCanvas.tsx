import React, { useState, useEffect, useRef } from 'react';
import { 
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { 
  Play, 
  Square, 
  Settings2,
  PlusCircle,
  Edit2,
  RotateCcw,
  Globe,
  Hourglass,
  ShieldCheck,
  Braces,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { FlowDefinition, FlowStep, StepType } from '../types/flow';
import { StepCard } from './StepCard';
import FlowSettingsDrawer from './FlowSettingsDrawer';
import FlowLogViewer from './FlowLogViewer';
import './FlowCanvas.css';
import Tooltip from './Tooltip';
import './Tooltip.css';

interface FlowCanvasProps {
  flow: FlowDefinition;
  onUpdate: (updates: Partial<FlowDefinition>) => void;
  collections: any[];
  environments: any[];
  libraries: any[];
  activeEnvId: string | null;
  onFollowDefinition?: (name: string) => void;
  onOpenRequest?: (requestId: string) => void;
}

export const FlowCanvas: React.FC<FlowCanvasProps> = ({ 
  flow, 
  onUpdate, 
  collections,
  environments,
  libraries,
  activeEnvId,
  onFollowDefinition,
  onOpenRequest
}) => {
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [runningStepId, setRunningStepId] = useState<string | null>(null);
  const [localStepStatuses, setLocalStepStatuses] = useState<Record<string, import('../types/flow').StepStatus>>({});
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAddDropdownOpen, setIsAddDropdownOpen] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const [logs, setLogs] = useState<{ timestamp: number; level: string; message: string }[]>([]);
  const [isLogsExpanded, setIsLogsExpanded] = useState(false);

  // Sync refs to avoid race conditions when multiple updates are fired rapidly
  const variablesRef = useRef<Record<string, any>>(flow.variables || {});
  const stepsRef = useRef<FlowStep[]>(flow.steps);
  
  useEffect(() => {
    variablesRef.current = flow.variables || {};
  }, [flow.variables]);

  useEffect(() => {
    stepsRef.current = flow.steps;
  }, [flow.steps]);

  const baselineVariablesRef = useRef<Record<string, any>>(flow.variables || {});
  const mergedSteps = flow.steps.map(s => ({ ...s, status: localStepStatuses[s.id]?.status || s.status }));
  const firstMoveableIndex = mergedSteps.findIndex(s => !s.status || s.status === 'idle' || s.status === 'error');
  const hasExecutionState = mergedSteps.some(s => s.status && s.status !== 'idle');
  const isStructuralLocked = isRunning; // Now only locks ALL structural changes while running

  useEffect(() => {
    // Synchronize baseline with manual edits only when flow is idle
    if (!hasExecutionState && !isRunning) {
      baselineVariablesRef.current = flow.variables || {};
    }
  }, [flow.variables, hasExecutionState, isRunning]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    const removeStatusListener = window.ultraRpc.flow.onStepStatus((stepId, data) => {
      if (data.status === 'running') {
        setRunningStepId(stepId);
      } else if (data.status !== 'running') {
        setRunningStepId(prev => prev === stepId ? null : prev);
      }

      setLocalStepStatuses(prev => ({ ...prev, [stepId]: data }));
    });

    const removeLogListener = window.ultraRpc.flow.onLog((logData) => {
      setLogs(prev => [...prev, logData]);
      setIsLogsExpanded(true);
    });

    const removeClearLogsListener = window.ultraRpc.flow.onClearLogs(() => {
      setLogs([]);
    });

    const removeVarListener = window.ultraRpc.flow.onVariableUpdate((data) => {
      if (data.type === 'set' && data.key) {
        const nextVars = { 
          ...variablesRef.current, 
          [data.key]: data.value 
        };
        variablesRef.current = nextVars;
        onUpdate({ variables: nextVars });
      } else if (data.type === 'delete' && data.key) {
        const nextVars = { ...variablesRef.current };
        delete nextVars[data.key];
        variablesRef.current = nextVars;
        onUpdate({ variables: nextVars });
      } else if (data.type === 'clear') {
        variablesRef.current = {};
        onUpdate({ variables: {} });
      }
    });

    return () => {
      removeStatusListener();
      removeLogListener();
      removeClearLogsListener();
      removeVarListener();
    };
  }, [flow.variables, flow.steps, onUpdate]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsAddDropdownOpen(false);
      }
    };

    if (isAddDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAddDropdownOpen]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id && !isRunning) {
      const oldIndex = flow.steps.findIndex((s) => s.id === active.id);
      const newIndex = flow.steps.findIndex((s) => s.id === over.id);
      
      // Safety: Cannot move locked steps, or move something into the locked prefix
      const moveableStartIndex = firstMoveableIndex === -1 ? flow.steps.length : firstMoveableIndex;
      if (oldIndex < moveableStartIndex || newIndex < moveableStartIndex) {
        return;
      }

      const newSteps = arrayMove(flow.steps, oldIndex, newIndex);
      onUpdate({ steps: newSteps });
    }
  };

  const addStep = (type: StepType) => {
    if (isRunning) return;
    const newStep: FlowStep = {
      id: Math.random().toString(36).substring(2, 11),
      type,
      name: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
      enabled: true,
      config: {
        requestId: '',
        bindings: []
      }
    };
    onUpdate({ steps: [...flow.steps, newStep] });
    setExpandedSteps(prev => ({ ...prev, [newStep.id]: true }));
    setIsAddDropdownOpen(false);
  };

  const deleteStep = (id: string) => {
    if (isRunning) return;
    const index = flow.steps.findIndex(s => s.id === id);
    const moveableStartIndex = firstMoveableIndex === -1 ? flow.steps.length : firstMoveableIndex;
    
    if (index >= 0 && index < moveableStartIndex) {
      return; 
    }
    
    onUpdate({ steps: flow.steps.filter(s => s.id !== id) });
  };

  const updateStep = (id: string, updates: Partial<FlowStep>) => {
    onUpdate({
      steps: flow.steps.map(s => s.id === id ? { ...s, ...updates } : s)
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedSteps(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Determines the first step index that should be run next (first idle/error enabled step)
  const getResumeIndex = (): number => {
    for (let i = 0; i < mergedSteps.length; i++) {
      const step = mergedSteps[i];
      if (!step.enabled) continue;
      const s = step.status;
      if (!s || s === 'idle' || s === 'error') return i;
    }
    return -1; // all done or no runnable steps
  };

  // Determines which step can currently be manually "Run" via its button.
  // A step is "potentially active" if it's the first idle/error enabled step.
  const getActiveStepIndex = (): number => {
    return getResumeIndex();
  };

  const runFlow = async (flowOverride?: FlowDefinition) => {
    if (isRunning) return;

    // Capture baseline before starting if fresh
    if (!hasExecutionState && !flowOverride) {
      baselineVariablesRef.current = flow.variables || {};
    }

    const baseline = baselineVariablesRef.current || {};
    const targetFlow = { ...(flowOverride || flow), variables: { ...baseline } };

    setIsRunning(true);
    setIsStopping(false);
    setShowSummary(false);
    
    try {
      const result = await window.ultraRpc.flow.execute(targetFlow, activeEnvId, environments, collections, libraries);
      if (result.variables || result.stepStatuses) {
        if (result.variables) {
          const varCount = Object.keys(result.variables).length;
          if (varCount > 0) {
            setLogs(prev => [...prev, {
              timestamp: Date.now(),
              level: 'info',
              message: `Updated ${varCount} flow variables.`
            }]);
          }
        }
        
        if (result.stepStatuses) {
          setLocalStepStatuses(result.stepStatuses);
        }

        onUpdate({ variables: result.variables || {} });
      }
    } catch (err: any) {
      console.error('Flow Execution Failed:', err);
    } finally {
      setIsRunning(false);
      setIsStopping(false);
      setRunningStepId(null);
      setShowSummary(true);
    }
  };

  const stopFlow = () => {
    setIsStopping(true);
    window.ultraRpc.flow.stop(flow.id);
    // isRunning will be cleared in the finally block of runFlow
  };

  const performReset = (noConfirm: boolean = false): FlowDefinition | null => {
    const hasVars = Object.keys(flow.variables || {}).length > 0;
    if (!noConfirm && (hasExecutionState || hasVars)) {
      if (!window.confirm('Are you sure you want to reset? This will clear all execution results and context variables.')) {
        return null;
      }
    }
    const resetSteps = flow.steps.map(s => ({ 
      ...s, 
      status: 'idle' as any,
      error: undefined,
      requestData: undefined,
      responseData: undefined
    }));
    
    const baseline = baselineVariablesRef.current || {};
    variablesRef.current = { ...baseline };
    
    onUpdate({ 
      variables: { ...baseline },
      steps: resetSteps
    });
    setLocalStepStatuses({});
    setRunningStepId(null);
    setShowSummary(false);
    setLogs([]);
    
    return { ...flow, steps: resetSteps, variables: { ...baseline } };
  };

  const resetFlow = () => performReset(false);

  const handleRunStep = async (stepId: string) => {
    if (isRunning) return;

    // Capture baseline before starting if fresh
    if (!hasExecutionState) {
      baselineVariablesRef.current = flow.variables || {};
    }

    const baseline = baselineVariablesRef.current || {};
    const targetFlow = { ...flow, variables: { ...baseline } };

    setIsRunning(true);
    setIsStopping(false);

    try {
      const result = await window.ultraRpc.flow.executeStep(targetFlow, stepId, activeEnvId, environments, collections, libraries);
      if (result.variables || result.stepStatuses) {
        if (result.variables) {
          const varCount = Object.keys(result.variables).length;
          if (varCount > 0) {
            setLogs(prev => [...prev, {
              timestamp: Date.now(),
              level: 'info',
              message: `Manual step run finished: Updated ${varCount} flow variables.`
            }]);
          }
        }
        
        if (result.stepStatuses) {
          setLocalStepStatuses(prev => ({ ...prev, ...result.stepStatuses }));
        }

        onUpdate({ variables: result.variables || {} });
      }
    } catch (err: any) {
      console.error('Step Execution Failed:', err);
    } finally {
      setIsRunning(false);
      setIsStopping(false);
      setRunningStepId(null);
    }
  };

  const handleCancelStep = (_stepId: string) => {
    window.ultraRpc.flow.cancelStep(flow.id);
  };

  const resumeIndex = getResumeIndex();
  const activeStepIndex = getActiveStepIndex();

  return (
    <div className="flow-canvas-wrapper">
      <div className="flow-canvas">
        <div className="flow-toolbar">
          <div className="flow-info">
            <div className="flow-name-wrapper">
              <input 
                type="text" 
                className="flow-name-input" 
                value={flow.name}
                onChange={(e) => onUpdate({ name: e.target.value })}
                disabled={isStructuralLocked}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                placeholder="Flow Name"
              />
              <Edit2 size={14} className="edit-icon-hint" />
            </div>
            <div className="flow-meta-row">
              <span className="step-count">{flow.steps.length} steps</span>
              {isStructuralLocked && (
              <Tooltip text="Structure (order, count) is locked during execution. Append more steps is allowed while stopped." position="top">
                <span className="flow-locked-badge">
                  <Lock size={11} />
                  Structural Changes Locked
                </span>
              </Tooltip>
              )}
            </div>
          </div>
          
          <div className="flow-controls">
            <Tooltip text="Reset execution state — start from step 1" position="bottom">
              <button 
                className="btn secondary reset-btn" 
                onClick={resetFlow}
                disabled={isRunning}
              >
                <RotateCcw size={15} /> Reset
              </button>
            </Tooltip>

            {isRunning ? (
              <Tooltip text="Stop after current step finishes" position="bottom">
                <button 
                  className={`btn stop ${isStopping ? 'stopping' : ''}`} 
                  onClick={stopFlow}
                  disabled={isStopping}
                >
                  <Square size={16} fill="currentColor" /> {isStopping ? 'Stopping…' : 'Stop'}
                </button>
              </Tooltip>
            ) : (
              <Tooltip 
                text={resumeIndex > 0 ? `Resume from step ${resumeIndex + 1}` : 'Run all steps'} 
                position="bottom"
              >
                <button 
                  className="btn run" 
                  onClick={() => runFlow()}
                  disabled={flow.steps.length === 0}
                >
                  <Play size={16} fill="currentColor" /> {resumeIndex > 0 ? 'Resume' : 'Run Flow'}
                </button>
              </Tooltip>
            )}

            <Tooltip text="Flow Execution Settings & Variables" position="bottom">
              <button 
                className="btn secondary" 
                onClick={() => setIsSettingsOpen(true)}
              >
                <Settings2 size={16} /> settings
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="flow-steps-container">
          <DndContext 
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext 
              items={flow.steps.map(s => s.id)}
              strategy={verticalListSortingStrategy}
            >
              {flow.steps.map((step, index) => {
                const moveableStartIndex = firstMoveableIndex === -1 ? flow.steps.length : firstMoveableIndex;
                const isStepLockedMetadata = index < moveableStartIndex;
                
                const locData = localStepStatuses[step.id];
                const displayStep = {
                  ...step,
                  status: locData?.status || step.status,
                  error: locData?.error || step.error,
                  requestData: locData?.requestData || step.requestData,
                  responseData: locData?.responseData || step.responseData
                };
                
                return (
                  <StepCard 
                    key={displayStep.id} 
                    step={displayStep} 
                    index={index}
                    isLocked={isStepLockedMetadata || isRunning}
                    isExpanded={expandedSteps[displayStep.id]}
                    onToggleExpand={() => toggleExpand(displayStep.id)}
                    onDelete={deleteStep}
                    onUpdate={updateStep}
                    collections={collections}
                    environments={environments}
                    isActiveStep={index === activeStepIndex}
                    onRunStep={handleRunStep}
                    onCancelStep={handleCancelStep}
                    onFollowDefinition={onFollowDefinition}
                    onOpenRequest={onOpenRequest}
                    runningStepId={runningStepId}
                    isFlowRunning={isRunning}
                    allSteps={flow.steps}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
          
          {!isRunning && <div className="add-step-area" ref={dropdownRef}>
            <button 
              className="btn-add-step" 
              onClick={() => setIsAddDropdownOpen(!isAddDropdownOpen)}
            >
              <PlusCircle size={18} /> Add Step
            </button>
            
            <AnimatePresence>
              {isAddDropdownOpen && (
                <motion.div 
                  className="add-step-dropdown glass"
                  initial={{ opacity: 0, y: 10, scale: 0.95, x: '-50%' }}
                  animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
                  exit={{ opacity: 0, y: 10, scale: 0.95, x: '-50%' }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                  <button onClick={() => addStep('request')}><Globe size={14} /> Request</button>
                  <button onClick={() => addStep('delay')}><Hourglass size={14} /> Delay</button>
                  <button onClick={() => addStep('assert')}><ShieldCheck size={14} /> Assertion</button>
                  <button onClick={() => addStep('script')}><Braces size={14} /> Script </button>
                  <button onClick={() => addStep('restart')}><RotateCcw size={14} /> Restart</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>}

          {showSummary && !isRunning && hasExecutionState && (
            <motion.div 
              className="flow-completion-panel glass fade-in-up"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="summary-status">
                <div className={`status-icon ${mergedSteps.some(s => s.status === 'error') ? 'error' : 'success'}`}>
                  {mergedSteps.some(s => s.status === 'error') ? <Square size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                </div>
                <div className="status-text">
                  <h4>Flow Finished</h4>
                  <div className="stats-row">
                    <span className="stat-item success">{mergedSteps.filter(s => s.status === 'success').length} passed</span>
                    <span className="stat-item error">{mergedSteps.filter(s => s.status === 'error').length} failed</span>
                    <span className="stat-item">{mergedSteps.filter(s => s.status === 'skipped').length} skipped</span>
                  </div>
                </div>
              </div>
              <div className="summary-actions">
                <span className="summary-hint">Flow finished</span>
                <button className="btn secondary" onClick={resetFlow}>
                  <RotateCcw size={14} /> Clear & Reset
                </button>
              </div>
            </motion.div>
          )}
        </div>

        <FlowLogViewer 
          logs={logs} 
          onClear={() => setLogs([])} 
          isExpanded={isLogsExpanded}
          onToggleExpand={() => setIsLogsExpanded(!isLogsExpanded)}
        />
      </div>

      {isSettingsOpen && (
        <FlowSettingsDrawer 
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          flow={flow}
          onUpdate={onUpdate}
          environments={environments}
        />
      )}
    </div>
  );
};
