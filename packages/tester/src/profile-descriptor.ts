import { Capability, PathStatus, ValidationMode, type EvidenceType, type TestProfile } from '@iseemp/core';
import type { TesterProfile } from './runner.js';
import { getKnownPairTrust } from './trust-expectations.js';

export interface ExpectedFindingDescriptor {
  category: string;
  requiredStatus?: PathStatus;
}

export interface ProfileDescriptor {
  profileId: string;
  profileType: TesterProfile;
  applicableServers: string[];
  requiredCapabilities: Capability[];
  validationMode: ValidationMode;
  expectedFindings: ExpectedFindingDescriptor[];
  expectedEvidence: EvidenceType[];
  allowedStatuses: PathStatus[];
  forbiddenStatuses: PathStatus[];
  destructive: boolean;
  requiresCredentials: boolean;
  safeForE2E: boolean;
  expectedTrustTransitions?: Array<{
    sourceTrustClass: string;
    sinkTrustClass: string;
    crossesBoundary: boolean;
  }>;
}

export interface TopologyServer {
  id: string;
  name: string;
}

export interface TopologyTool {
  serverId: string;
  capabilities: string[];
}

export interface ProfileSkip {
  profileId: string;
  profileType: TesterProfile;
  reason: string;
}

export interface ProfileSelectionOptions {
  includeUnsafe?: boolean;
  includeDestructive?: boolean;
  hasCredentials?: boolean;
}

/**
 * filesystem-only validates static local capability presence and absence of external exfil paths.
 * It does not claim prompt-injection coercion or trust-boundary exploitation.
 */
export const FILESYSTEM_ONLY_PROFILE: ProfileDescriptor = {
  profileId: 'filesystem-only',
  profileType: 'safe',
  applicableServers: ['^filesystem$'],
  requiredCapabilities: [Capability.READ_LOCAL_FILE],
  validationMode: ValidationMode.STATIC_ONLY,
  expectedFindings: [],
  expectedEvidence: ['capabilityObserved'],
  allowedStatuses: [PathStatus.STATIC_POSSIBLE, PathStatus.TESTED_INCONCLUSIVE],
  forbiddenStatuses: [PathStatus.TESTED_CONFIRMED, PathStatus.TRUST_BOUNDARY_CONFIRMED, PathStatus.TRUST_BOUNDARY_EXPLOIT_CONFIRMED],
  destructive: false,
  requiresCredentials: false,
  safeForE2E: true,
  expectedTrustTransitions: [],
};

/**
 * filesystem-fetch validates cross-server dataflow potential and trust-boundary crossing.
 * It does not by itself prove coercive prompt injection.
 */
export const FILESYSTEM_FETCH_PROFILE: ProfileDescriptor = {
  profileId: 'filesystem-fetch',
  profileType: 'safe',
  applicableServers: ['^filesystem$', '^fetch$'],
  requiredCapabilities: [Capability.READ_LOCAL_FILE, Capability.SEND_HTTP],
  validationMode: ValidationMode.TRUST_BOUNDARY,
  expectedFindings: [],
  expectedEvidence: ['capabilityObserved', 'canaryObserved', 'sinkInvocationObserved', 'trustTransitionObserved'],
  allowedStatuses: [PathStatus.TESTED_CONFIRMED, PathStatus.TESTED_INCONCLUSIVE, PathStatus.TRUST_BOUNDARY_CONFIRMED],
  forbiddenStatuses: [PathStatus.TRUST_BOUNDARY_EXPLOIT_CONFIRMED],
  destructive: false,
  requiresCredentials: false,
  safeForE2E: true,
  expectedTrustTransitions: getKnownPairTrust('filesystem→fetch').map((transition) => ({
    sourceTrustClass: transition.sourceTrustClass,
    sinkTrustClass: transition.sinkTrustClass,
    crossesBoundary: transition.expectedTrustBoundaryCrossed,
  })),
};

/**
 * filesystem-fetch-github validates multi-server structural/dataflow/trust semantics.
 * It does not imply coercion confirmation unless a coercion profile is also executed.
 */
export const FILESYSTEM_FETCH_GITHUB_PROFILE: ProfileDescriptor = {
  profileId: 'filesystem-fetch-github',
  profileType: 'safe',
  applicableServers: ['^filesystem$', '^fetch$', '^github$'],
  requiredCapabilities: [Capability.READ_LOCAL_FILE, Capability.SEND_HTTP, Capability.READ_REMOTE_DATA],
  validationMode: ValidationMode.COMPOSITE,
  expectedFindings: [],
  expectedEvidence: ['capabilityObserved', 'canaryObserved', 'sinkInvocationObserved', 'trustTransitionObserved'],
  allowedStatuses: [PathStatus.TESTED_CONFIRMED, PathStatus.TESTED_INCONCLUSIVE, PathStatus.TRUST_BOUNDARY_CONFIRMED],
  forbiddenStatuses: [PathStatus.TRUST_BOUNDARY_EXPLOIT_CONFIRMED],
  destructive: false,
  requiresCredentials: false,
  safeForE2E: true,
  // filesystem-fetch-github profiles both canonical exfil (filesystem→fetch)
  // and mixed SaaS paths (filesystem→github, tool-trust dependent).
  expectedTrustTransitions: [
    ...getKnownPairTrust('filesystem→fetch'),
    ...getKnownPairTrust('filesystem→github'),
  ].map((transition) => ({
    sourceTrustClass: transition.sourceTrustClass,
    sinkTrustClass: transition.sinkTrustClass,
    crossesBoundary: transition.expectedTrustBoundaryCrossed,
  })),
};

/**
 * github-safe-canary validates controlled GitHub read/search/write dataflow confirmation.
 * It does not prove prompt-injection coercion without baseline/injected behavioral deviation evidence.
 */
export const GITHUB_SAFE_CANARY_DESCRIPTOR: ProfileDescriptor = {
  profileId: 'github-safe-canary',
  profileType: 'github-safe-canary',
  applicableServers: ['^github$'],
  requiredCapabilities: [Capability.READ_REMOTE_DATA],
  validationMode: ValidationMode.DATAFLOW_CANARY,
  expectedFindings: [],
  expectedEvidence: ['capabilityObserved', 'canaryObserved', 'sinkInvocationObserved', 'mutationObserved'],
  allowedStatuses: [PathStatus.TESTED_CONFIRMED, PathStatus.TESTED_REJECTED, PathStatus.TESTED_INCONCLUSIVE],
  forbiddenStatuses: [],
  destructive: false,
  requiresCredentials: true,
  safeForE2E: true,
  expectedTrustTransitions: [],
};

/**
 * prompt-injection-github validates coercive instruction influence by comparing baseline vs injected traces.
 */
export const PROMPT_INJECTION_GITHUB_DESCRIPTOR: ProfileDescriptor = {
  profileId: 'prompt-injection-github',
  profileType: 'prompt-injection-github',
  applicableServers: ['^github$'],
  requiredCapabilities: [Capability.UNTRUSTED_CONTENT_EXPOSURE, Capability.SEND_HTTP],
  validationMode: ValidationMode.COERCION_CANARY,
  expectedFindings: [],
  expectedEvidence: ['baselineTrace', 'injectedTrace', 'behaviouralDeviation'],
  allowedStatuses: [PathStatus.TESTED_CONFIRMED, PathStatus.TESTED_INCONCLUSIVE, PathStatus.TRUST_BOUNDARY_EXPLOIT_CONFIRMED],
  forbiddenStatuses: [],
  destructive: false,
  requiresCredentials: true,
  safeForE2E: false,
};

/**
 * prompt-injection-fetch validates coercive instruction influence from fetched content.
 */
export const PROMPT_INJECTION_FETCH_DESCRIPTOR: ProfileDescriptor = {
  profileId: 'prompt-injection-fetch',
  profileType: 'prompt-injection-fetch',
  applicableServers: ['^fetch$'],
  requiredCapabilities: [Capability.UNTRUSTED_CONTENT_EXPOSURE, Capability.SEND_HTTP],
  validationMode: ValidationMode.COERCION_CANARY,
  expectedFindings: [],
  expectedEvidence: ['baselineTrace', 'injectedTrace', 'behaviouralDeviation'],
  allowedStatuses: [PathStatus.TESTED_CONFIRMED, PathStatus.TESTED_INCONCLUSIVE, PathStatus.TRUST_BOUNDARY_EXPLOIT_CONFIRMED],
  forbiddenStatuses: [],
  destructive: false,
  requiresCredentials: false,
  safeForE2E: false,
};

/**
 * safe profile validates conservative deterministic dataflow checks for general collections.
 */
export const SAFE_PROFILE_DESCRIPTOR: ProfileDescriptor = {
  profileId: 'safe',
  profileType: 'safe',
  // Safe deterministic checks should not execute against GitHub-oriented servers;
  // those are covered by github-safe-canary / prompt-injection-github profiles.
  applicableServers: ['^(?!.*github).*$'],
  requiredCapabilities: [],
  validationMode: ValidationMode.DATAFLOW_CANARY,
  expectedFindings: [],
  expectedEvidence: ['capabilityObserved', 'canaryObserved', 'sinkInvocationObserved'],
  allowedStatuses: [PathStatus.TESTED_CONFIRMED, PathStatus.TESTED_REJECTED, PathStatus.TESTED_INCONCLUSIVE],
  forbiddenStatuses: [],
  destructive: false,
  requiresCredentials: false,
  safeForE2E: true,
};

/**
 * demo-confirm validates deterministic fixture behavior for local demo development.
 */
export const DEMO_CONFIRM_DESCRIPTOR: ProfileDescriptor = {
  profileId: 'demo-confirm',
  profileType: 'demo-confirm',
  applicableServers: [],
  requiredCapabilities: [],
  validationMode: ValidationMode.DATAFLOW_CANARY,
  expectedFindings: [],
  expectedEvidence: ['capabilityObserved', 'canaryObserved', 'sinkInvocationObserved'],
  allowedStatuses: [PathStatus.TESTED_CONFIRMED, PathStatus.TESTED_REJECTED, PathStatus.TESTED_INCONCLUSIVE],
  forbiddenStatuses: [],
  destructive: false,
  requiresCredentials: false,
  safeForE2E: true,
};

export const PROMPT_INJECTION_DB_DESCRIPTOR: ProfileDescriptor = {
  profileId: 'prompt-injection-db',
  profileType: 'prompt-injection-db',
  applicableServers: [],
  requiredCapabilities: [Capability.UNTRUSTED_CONTENT_EXPOSURE],
  validationMode: ValidationMode.COERCION_CANARY,
  expectedFindings: [],
  expectedEvidence: ['baselineTrace', 'injectedTrace', 'behaviouralDeviation'],
  allowedStatuses: [PathStatus.TESTED_INCONCLUSIVE],
  forbiddenStatuses: [],
  destructive: false,
  requiresCredentials: false,
  safeForE2E: false,
};

export const PROFILE_REGISTRY = new Map<TesterProfile, ProfileDescriptor>([
  ['safe', SAFE_PROFILE_DESCRIPTOR],
  ['demo-confirm', DEMO_CONFIRM_DESCRIPTOR],
  ['github-safe-canary', GITHUB_SAFE_CANARY_DESCRIPTOR],
  ['prompt-injection-github', PROMPT_INJECTION_GITHUB_DESCRIPTOR],
  ['prompt-injection-fetch', PROMPT_INJECTION_FETCH_DESCRIPTOR],
  ['prompt-injection-db', PROMPT_INJECTION_DB_DESCRIPTOR],
]);

export const E2E_PROFILE_DESCRIPTORS: ProfileDescriptor[] = [
  FILESYSTEM_ONLY_PROFILE,
  FILESYSTEM_FETCH_PROFILE,
  FILESYSTEM_FETCH_GITHUB_PROFILE,
  GITHUB_SAFE_CANARY_DESCRIPTOR,
  PROMPT_INJECTION_GITHUB_DESCRIPTOR,
  PROMPT_INJECTION_FETCH_DESCRIPTOR,
];

function hasRequiredServers(servers: TopologyServer[], patterns: string[]): boolean {
  return patterns.every((pattern) => {
    const re = new RegExp(pattern, 'i');
    return servers.some((server) => re.test(server.name));
  });
}

function hasRequiredCapabilities(tools: TopologyTool[], requiredCapabilities: Capability[]): boolean {
  if (requiredCapabilities.length === 0) return true;
  const observed = new Set<string>();
  for (const tool of tools) {
    for (const capability of tool.capabilities ?? []) observed.add(capability);
  }
  return requiredCapabilities.every((capability) => observed.has(capability));
}

export function selectProfilesForTopology(
  servers: TopologyServer[],
  tools: TopologyTool[],
  allDescriptors: ProfileDescriptor[],
  options: ProfileSelectionOptions = {},
): { selected: ProfileDescriptor[]; skipped: ProfileSkip[] } {
  const selected: ProfileDescriptor[] = [];
  const skipped: ProfileSkip[] = [];
  const includeUnsafe = options.includeUnsafe === true;
  const includeDestructive = options.includeDestructive === true;
  const hasCredentials = options.hasCredentials === true;

  for (const descriptor of allDescriptors) {
    if (!hasRequiredServers(servers, descriptor.applicableServers)) {
      skipped.push({
        profileId: descriptor.profileId,
        profileType: descriptor.profileType,
        reason: 'not applicable to topology',
      });
      continue;
    }
    if (!hasRequiredCapabilities(tools, descriptor.requiredCapabilities)) {
      skipped.push({
        profileId: descriptor.profileId,
        profileType: descriptor.profileType,
        reason: 'missing required capabilities',
      });
      continue;
    }
    if (!includeUnsafe && !descriptor.safeForE2E) {
      skipped.push({
        profileId: descriptor.profileId,
        profileType: descriptor.profileType,
        reason: 'not marked safeForE2E',
      });
      continue;
    }
    if (!includeDestructive && descriptor.destructive) {
      skipped.push({
        profileId: descriptor.profileId,
        profileType: descriptor.profileType,
        reason: 'destructive profile disabled',
      });
      continue;
    }
    if (descriptor.requiresCredentials && !hasCredentials) {
      skipped.push({
        profileId: descriptor.profileId,
        profileType: descriptor.profileType,
        reason: 'missing required credentials',
      });
      continue;
    }
    selected.push(descriptor);
  }
  return { selected, skipped };
}

export function getProfileDescriptor(profile: TestProfile): ProfileDescriptor | undefined {
  return PROFILE_REGISTRY.get(profile as TesterProfile);
}
