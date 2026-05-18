import { createRickySdk, type LocalResponse, type RickySdk } from '@agentworkforce/ricky';
import type { OpenKarenConfig } from './types.js';

export type OpenKarenRickyGenerateInput = {
  spec: string;
  cwd?: string;
  workflowName?: string;
  run?: boolean;
  bestJudgement?: boolean;
  refine?: false | { model?: string };
  autoFixAttempts?: number;
};

export type OpenKarenRickyRunInput = {
  workflowPath: string;
  cwd?: string;
  autoFixAttempts?: number;
  startFromStep?: string;
  previousRunId?: string;
};

export type OpenKarenRicky = {
  generateLocalWorkflow(input: OpenKarenRickyGenerateInput): Promise<LocalResponse>;
  runLocalWorkflow(input: OpenKarenRickyRunInput): Promise<LocalResponse>;
};

export type OpenKarenRickyOptions = {
  sdk?: Pick<RickySdk, 'generateLocalWorkflow' | 'runLocalWorkflow'>;
};

export function createOpenKarenRicky(
  config: Pick<OpenKarenConfig, 'agentCwd'>,
  options: OpenKarenRickyOptions = {},
): OpenKarenRicky {
  const defaultCwd = config.agentCwd;
  const sdk = options.sdk ?? createRickySdk({ cwd: defaultCwd });

  return {
    generateLocalWorkflow(input) {
      return sdk.generateLocalWorkflow({
        cwd: defaultCwd,
        ...input,
      });
    },
    runLocalWorkflow(input) {
      return sdk.runLocalWorkflow({
        cwd: defaultCwd,
        ...input,
      });
    },
  };
}

export function isRickySdkAvailable(): boolean {
  return typeof createRickySdk === 'function';
}
