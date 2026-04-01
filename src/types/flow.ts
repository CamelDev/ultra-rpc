export type StepType = 'request' | 'delay' | 'assert' | 'script' | 'restart';

export interface ResponseBinding {
  extractor: string; // JSONPath (e.g. $.data.id) or Header Name
  targetVariable: string; // The key in the scoped store
}

export type StepStatusValue = 'idle' | 'running' | 'success' | 'error' | 'skipped';

export interface StepStatus {
  stepId: string;
  status: StepStatusValue;
  error?: string;
  startTime?: number;
  endTime?: number;
  responseTime?: number; // For request steps
  requestData?: any;
  responseData?: any;
}

export type AssertionOperator = '==' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'not_contains' | 'matches' | 'exists' | 'not_exists' | 'is_null' | 'is_not_null';

export type AssertionSource = 'constant' | 'variable' | 'step_response';

export interface AssertionOperand {
  type: AssertionSource;
  value: string; // The constant value, variable name, or JSONPath
  stepId?: string; // Only for 'step_response'
}

export interface Assertion {
  id: string;
  left: AssertionOperand;
  operator: AssertionOperator;
  right?: AssertionOperand; // Optional for unary/existence operators
  enabled: boolean;
}

export interface FlowStep {
  id: string;
  type: StepType;
  name: string;
  enabled: boolean;
  config: {
    requestId?: string;      // ID of saved request
    collectionId?: string;   // Collection of the request
    envId?: string;          // Env override 
    bindings?: ResponseBinding[];
    durationMs?: number;     // For 'delay'
    assertion?: {            // Legacy: For 'assert'
      left: string;
      operator: '==' | '!=' | '>' | '<' | 'contains';
      right: string;
    };
    assertions?: Assertion[]; // New: Multi-assertion support
    code?: string;           // For 'script'
  };
  status?: StepStatusValue;
  error?: string;
  lastExecutionTime?: number;
  requestData?: any;
  responseData?: any;
}

export interface FlowExecutionResult {
  success: boolean;
  startTime: number;
  endTime: number;
  variables: Record<string, any>;
  stepStatuses: Record<string, StepStatus>;
  error?: string;
}

export interface FlowDefinition {
  id: string;
  name?: string;
  steps: FlowStep[];
  settings: {
    timeoutMs: number;
    onFailure: 'stop' | 'continue' | 'retry';
    retryCount?: number;
    repeat: number;
    environmentId?: string | null;
  };
  variables: Record<string, any>; // The "Variable Store"
}
