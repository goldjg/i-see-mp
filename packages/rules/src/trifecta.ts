import {
  Capability,
  DataflowClassification,
  LethalTrifectaStatus,
  RiskCategory,
  TrustBoundary,
  TrifectaStage,
} from '@iseemp/core';
import type { Confidence, Finding } from '@iseemp/core';
import { deriveCrossesTrustBoundary, deriveTrustTransition } from './trust.js';

const TRIFECTA_SOURCE_CAPS: Capability[] = [
  Capability.READ_CREDENTIAL_HIGH,
  Capability.READ_SECRET_HIGH,
  Capability.READ_SECRET,
  Capability.READ_LOCAL_FILE,
  Capability.READ_REMOTE_DATA,
  Capability.READ_SENSITIVE_MEDIUM,
  Capability.READ_METADATA_LOW,
  Capability.RUN_SHELL,
  Capability.EXECUTE_CODE,
];

const HIGH_SENSITIVITY_SOURCE_CAPS: Capability[] = [
  Capability.READ_CREDENTIAL_HIGH,
  Capability.READ_SECRET_HIGH,
  Capability.READ_SECRET,
  Capability.READ_LOCAL_FILE,
  Capability.RUN_SHELL,
  Capability.EXECUTE_CODE,
];

const TRIFECTA_SINK_CAPS: Capability[] = [
  Capability.SEND_EXTERNAL,
  Capability.SEND_HTTP,
  Capability.SEND_EMAIL,
  Capability.MUTATE_REPOSITORY,
  Capability.MUTATE_ISSUE_OR_PR,
  Capability.MUTATE_REMOTE_STATE,
  Capability.MUTATE_IDENTITY,
  Capability.MUTATE_CLOUD_RESOURCE,
  Capability.WRITE_LOCAL_FILE,
  Capability.WRITE_REMOTE_DATA,
  Capability.RUN_SHELL,
  Capability.EXECUTE_CODE,
];

const UNTRUSTED_CONTENT_CAPS: Capability[] = [Capability.UNTRUSTED_CONTENT_EXPOSURE];

const PRIVATE_DATA_CAPS: Capability[] = [
  Capability.READ_CREDENTIAL_HIGH,
  Capability.READ_SECRET_HIGH,
  Capability.READ_SECRET,
  Capability.READ_LOCAL_FILE,
  Capability.READ_SENSITIVE_MEDIUM,
];

const EXTERNAL_COMM_CAPS: Capability[] = [
  Capability.SEND_EXTERNAL,
  Capability.SEND_HTTP,
  Capability.SEND_EMAIL,
];

const SEVERITY_RANK: Record<Finding['severity'], number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const CONFIDENCE_RANK: Record<Confidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const STAGE_RANK: Record<(typeof TrifectaStage)[keyof typeof TrifectaStage], number> = {
  [TrifectaStage.COMPLETE]: 0,
  [TrifectaStage.PARTIAL]: 1,
  [TrifectaStage.CAPABILITY_ONLY]: 2,
};

export interface TrifectaClassification {
  trifectaStage: (typeof TrifectaStage)[keyof typeof TrifectaStage];
  dataflowClassification: (typeof DataflowClassification)[keyof typeof DataflowClassification];
  trifectaScore: number;
  trifectaComplete: boolean;
  isCrossServer: boolean;
  crossesTrustBoundary: boolean;
  trustTransition?: string;
  isHighSignal: boolean;
  hasPrivateDataAccess: boolean;
  hasUntrustedContentExposure: boolean;
  hasExternalCommunication: boolean;
  lethalTrifectaStatus: (typeof LethalTrifectaStatus)[keyof typeof LethalTrifectaStatus];
  subCategory?: string;
  injectionConfirmed: boolean;
  trustBoundaryConfirmed: boolean;
  injectionExploitChain: boolean;
  trustBoundaryExploitConfirmed: boolean;
}

export function deriveIsCrossServer(findingLike: {
  sourceServerId?: string;
  sinkServerId?: string;
  isCrossServer?: boolean;
}): boolean {
  return (
    typeof findingLike.sourceServerId === 'string' &&
    findingLike.sourceServerId.length > 0 &&
    typeof findingLike.sinkServerId === 'string' &&
    findingLike.sinkServerId.length > 0 &&
    findingLike.sourceServerId !== findingLike.sinkServerId
  );
}

export function classifyFindingTrifecta(finding: Finding): TrifectaClassification {
  const sourcePool = new Set<Capability>(finding.sourceCapabilities ?? []);
  const initialSinkPool = new Set<Capability>(finding.sinkCapabilities ?? []);
  const sinkPool = new Set<Capability>(initialSinkPool);

  if (finding.category === RiskCategory.CODE_EXECUTION) {
    const sourceCaps = finding.sourceCapabilities ?? [];
    for (const cap of sourceCaps) {
      if (cap === Capability.RUN_SHELL || cap === Capability.EXECUTE_CODE) {
        sourcePool.add(cap);
        sinkPool.add(cap);
      }
    }
  }

  if (finding.category === RiskCategory.PRIVILEGED_MUTATION) {
    sinkPool.add(Capability.MUTATE_REMOTE_STATE);
  }

  const hasSource = Array.from(sourcePool).some((cap) => TRIFECTA_SOURCE_CAPS.includes(cap));
  const hasSink = Array.from(sinkPool).some((cap) => TRIFECTA_SINK_CAPS.includes(cap));

  let trifectaStage: (typeof TrifectaStage)[keyof typeof TrifectaStage] =
    TrifectaStage.CAPABILITY_ONLY;
  // CODE_EXECUTION findings can infer sink capability from the same execution capability.
  // If no explicit sink capability is present on the finding, classify as PARTIAL instead of COMPLETE.
  const inferredExecutionSinkOnly =
    finding.category === RiskCategory.CODE_EXECUTION &&
    initialSinkPool.size === 0 &&
    sinkPool.size > 0 &&
    Array.from(sinkPool).every(
      (cap) => cap === Capability.RUN_SHELL || cap === Capability.EXECUTE_CODE,
    );
  if (hasSource && hasSink && !inferredExecutionSinkOnly) trifectaStage = TrifectaStage.COMPLETE;
  else if (hasSource || hasSink) trifectaStage = TrifectaStage.PARTIAL;
  const crossServer = deriveIsCrossServer(finding);
  const derivedCrossesTrustBoundary = deriveCrossesTrustBoundary(
    finding.sourceServerId,
    finding.sinkServerId,
  );
  const derivedTrustTransition = deriveTrustTransition(
    finding.sourceServerId,
    finding.sinkServerId,
  );
  const crossesTrustBoundary =
    typeof finding.crossesTrustBoundary === 'boolean'
      ? finding.crossesTrustBoundary
      : derivedCrossesTrustBoundary;
  const trustTransition = finding.trustTransition ?? derivedTrustTransition.transition;
  if (crossServer && trifectaStage === TrifectaStage.COMPLETE) {
    // Intentional: structural source+sink completeness across different servers is not treated
    // as a same-server complete chain.
    trifectaStage = TrifectaStage.PARTIAL;
  }

  const combinedPool = new Set<Capability>([...sourcePool, ...sinkPool]);
  const hasPrivateDataAccess = Array.from(combinedPool).some((cap) =>
    PRIVATE_DATA_CAPS.includes(cap),
  );
  const hasUntrustedContentExposure = Array.from(combinedPool).some((cap) =>
    UNTRUSTED_CONTENT_CAPS.includes(cap),
  );
  const hasExternalCommunication = Array.from(combinedPool).some((cap) =>
    EXTERNAL_COMM_CAPS.includes(cap),
  );
  const hasLethalTrifectaIngredients =
    hasPrivateDataAccess && hasUntrustedContentExposure && hasExternalCommunication;
  const lethalFromFinding = finding.lethalTrifectaStatus as string | undefined;
  const injectionConfirmed = finding.injectionConfirmed === true;
  const injectionExploitChain = finding.subCategory === 'PROMPT_INJECTION_EXPLOIT_CHAIN';
  const trustBoundaryConfirmed =
    finding.trustBoundaryConfirmed === true ||
    finding.pathStatus === 'trust_boundary_confirmed' ||
    finding.pathStatus === 'trust_boundary_exploit_confirmed';
  const trustBoundaryExploitConfirmed =
    finding.trustBoundaryExploitConfirmed === true ||
    finding.pathStatus === 'trust_boundary_exploit_confirmed' ||
    (injectionConfirmed &&
      crossesTrustBoundary === true &&
      Array.from(sinkPool).some((cap) => EXTERNAL_COMM_CAPS.includes(cap)));
  const lethalTrifectaStatus =
    injectionConfirmed || lethalFromFinding === 'CONFIRMED' || lethalFromFinding === 'COMPLETE'
      ? LethalTrifectaStatus.CONFIRMED
      : hasLethalTrifectaIngredients ||
          lethalFromFinding === 'POSSIBLE' ||
          lethalFromFinding === 'CANDIDATE'
        ? LethalTrifectaStatus.POSSIBLE
        : LethalTrifectaStatus.NONE;

  let trifectaScore = 0;
  if (hasSource) trifectaScore += 3;
  if (hasSink) trifectaScore += 3;
  // MODEL_CONTEXT transform is implicit in ISeeMP findings, so every finding gets this base +1.
  trifectaScore += 1;
  if (Array.from(sourcePool).some((cap) => HIGH_SENSITIVITY_SOURCE_CAPS.includes(cap))) {
    trifectaScore += 2;
  }
  if (
    finding.boundaryCrossed === TrustBoundary.EXTERNAL ||
    finding.boundaryCrossed === TrustBoundary.SAAS ||
    finding.boundaryCrossed === TrustBoundary.CONTROLLED_SAAS ||
    finding.boundaryCrossed === TrustBoundary.USER_CONTROLLED_SAAS
  ) {
    trifectaScore += 2;
  }

  let dataflowClassification: (typeof DataflowClassification)[keyof typeof DataflowClassification] =
    DataflowClassification.NONE;
  if (trifectaStage === TrifectaStage.COMPLETE)
    dataflowClassification = DataflowClassification.COMPLETE;
  else if (
    trifectaStage === TrifectaStage.PARTIAL ||
    trifectaStage === TrifectaStage.CAPABILITY_ONLY
  ) {
    dataflowClassification = DataflowClassification.PARTIAL;
  }

  return {
    trifectaStage,
    dataflowClassification,
    trifectaScore,
    trifectaComplete: trifectaStage === TrifectaStage.COMPLETE,
    isCrossServer: crossServer,
    crossesTrustBoundary,
    trustTransition,
    isHighSignal:
      injectionConfirmed ||
      injectionExploitChain ||
      trustBoundaryConfirmed ||
      trustBoundaryExploitConfirmed ||
      (trifectaStage === TrifectaStage.COMPLETE && crossesTrustBoundary === true),
    hasPrivateDataAccess,
    hasUntrustedContentExposure,
    hasExternalCommunication,
    lethalTrifectaStatus,
    subCategory: finding.subCategory,
    injectionConfirmed,
    trustBoundaryConfirmed,
    injectionExploitChain,
    trustBoundaryExploitConfirmed,
  };
}

export function applyTrifectaAnnotation(findings: Finding[]): Finding[] {
  return findings.map((finding) => ({
    ...finding,
    ...classifyFindingTrifecta(finding),
  }));
}

export function sortByTrifecta(findings: Finding[]): Finding[] {
  return [...findings]
    .map((finding, idx) => ({ finding, idx }))
    .sort((a, b) => {
      const aStage = a.finding.trifectaStage ?? TrifectaStage.CAPABILITY_ONLY;
      const bStage = b.finding.trifectaStage ?? TrifectaStage.CAPABILITY_ONLY;
      const stageDelta = STAGE_RANK[aStage] - STAGE_RANK[bStage];
      if (stageDelta !== 0) return stageDelta;

      const scoreDelta = (b.finding.trifectaScore ?? 0) - (a.finding.trifectaScore ?? 0);
      if (scoreDelta !== 0) return scoreDelta;

      const severityDelta = SEVERITY_RANK[b.finding.severity] - SEVERITY_RANK[a.finding.severity];
      if (severityDelta !== 0) return severityDelta;

      const confidenceDelta =
        (CONFIDENCE_RANK[b.finding.confidence ?? 'low'] ?? 0) -
        (CONFIDENCE_RANK[a.finding.confidence ?? 'low'] ?? 0);
      if (confidenceDelta !== 0) return confidenceDelta;

      const aTested = a.finding.tested === true ? 1 : 0;
      const bTested = b.finding.tested === true ? 1 : 0;
      const testedDelta = bTested - aTested;
      if (testedDelta !== 0) return testedDelta;

      return a.idx - b.idx;
    })
    .map(({ finding }) => finding);
}

export function applyTrifectaAnalysis(findings: Finding[]): Finding[] {
  return sortByTrifecta(applyTrifectaAnnotation(findings));
}
