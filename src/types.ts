import { ArchitectureResult } from './analyzer/architecture';
import { DependenciesResult } from './analyzer/dependencies';
import { ModulesResult } from './analyzer/modules';
import { ConventionsResult } from './analyzer/conventions';
import { DetectedStack } from './scanner/detector';

export interface AnalysisResult {
  repoName: string;
  rootDir: string;
  scannedAt: string;
  totalFiles: number;
  stack: DetectedStack;
  architecture: ArchitectureResult;
  dependencies: DependenciesResult;
  modules: ModulesResult;
  conventions: ConventionsResult;
}
