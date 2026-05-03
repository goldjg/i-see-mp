import { PathStatus, type Finding, type TestRun, type Capability, ValidationMode } from '@iseemp/core';
import type { ProfileDescriptor } from './profile-descriptor.js';

export interface ProfileSummaryLike {
  profilesPlanned: number;
  profilesRun: number;
  profilesSkipped: number;
  profilesPassed: number;
  profilesFailed: number;
}

export interface ProfileSummaryExpected {
  profilesPlanned?: number;
  profilesRun?: number;
  profilesSkipped?: number;
  profilesPassed?: number;
  profilesFailed?: number;
}

export interface ApiServerLike {
  id: string;
  name: string;
}

export interface ApiToolLike {
  serverId: string;
  capabilities?: string[];
  name?: string;
}

function fail(message: string): never {
  throw new Error(message);
}

export function assertProfileSummary(summary: ProfileSummaryLike, opts: ProfileSummaryExpected): void {
  if (typeof opts.profilesPlanned === 'number' && summary.profilesPlanned !== opts.profilesPlanned) {
    fail(`Expected profilesPlanned=${opts.profilesPlanned}, got ${summary.profilesPlanned}.`);
  }
  if (typeof opts.profilesRun === 'number' && summary.profilesRun !== opts.profilesRun) {
    fail(`Expected profilesRun=${opts.profilesRun}, got ${summary.profilesRun}.`);
  }
  if (typeof opts.profilesSkipped === 'number' && summary.profilesSkipped !== opts.profilesSkipped) {
    fail(`Expected profilesSkipped=${opts.profilesSkipped}, got ${summary.profilesSkipped}.`);
  }
  if (typeof opts.profilesPassed === 'number' && summary.profilesPassed !== opts.profilesPassed) {
    fail(`Expected profilesPassed=${opts.profilesPassed}, got ${summary.profilesPassed}.`);
  }
  if (typeof opts.profilesFailed === 'number' && summary.profilesFailed !== opts.profilesFailed) {
    fail(`Expected profilesFailed=${opts.profilesFailed}, got ${summary.profilesFailed}.`);
  }
}

export function assertHasServer(servers: ApiServerLike[], name: string): ApiServerLike {
  const server = servers.find((candidate) => candidate.name === name);
  if (!server) fail(`Expected server '${name}' to be present.`);
  return server;
}

export function assertHasCapability(
  tools: ApiToolLike[],
  serverId: string,
  capability: Capability | string,
): void {
  const found = tools.some(
    (tool) =>
      tool.serverId === serverId &&
      Array.isArray(tool.capabilities) &&
      tool.capabilities.includes(capability),
  );
  if (!found) fail(`Expected capability '${capability}' on server '${serverId}'.`);
}

export function assertHasFindingWithStatus(findings: Finding[], status: PathStatus | string): Finding {
  const finding = findings.find((candidate) => candidate.pathStatus === status);
  if (!finding) fail(`Expected at least one finding with pathStatus='${status}'.`);
  return finding;
}

export function assertNoFindingWithStatus(findings: Finding[], status: PathStatus | string): void {
  const count = findings.filter((candidate) => candidate.pathStatus === status).length;
  if (count > 0) fail(`Expected no findings with pathStatus='${status}', found ${count}.`);
}

export function assertHasTrustTransition(findings: Finding[], from: string, to: string): Finding {
  const expected = `${from} → ${to}`;
  const finding = findings.find((candidate) => candidate.trustTransition === expected);
  if (!finding) fail(`Expected trust transition '${expected}'.`);
  return finding;
}

export function assertCanaryEvidence(testRuns: TestRun[]): void {
  const observed = testRuns.some((run) => run.canaryObserved === true);
  if (!observed) fail('Expected at least one test run with canaryObserved=true.');
}

export function assertNoCoercionEvidence(testRuns: TestRun[]): void {
  const coercion = testRuns.filter(
    (run) => run.deviationDetected === true || run.injectionConfirmed === true,
  );
  if (coercion.length > 0) {
    fail(`Expected no coercion evidence, found ${coercion.length} run(s) with deviation/injection markers.`);
  }
}

function descriptorAllowsPromptInjectionConfirmation(descriptor: ProfileDescriptor): boolean {
  return (
    descriptor.validationMode === ValidationMode.COERCION_CANARY ||
    descriptor.validationMode === ValidationMode.COMPOSITE
  );
}

export function assertNoUnexpectedPromptInjectionConfirmed(
  findings: Finding[],
  descriptor: ProfileDescriptor,
): void {
  if (descriptorAllowsPromptInjectionConfirmation(descriptor)) return;
  const confirmed = findings.filter((finding) => finding.injectionConfirmed === true);
  if (confirmed.length > 0) {
    fail(
      `Profile '${descriptor.profileId}' does not allow prompt-injection confirmation, but found ${confirmed.length} injectionConfirmed finding(s).`,
    );
  }
}

export function assertNoUnexpectedLethalTrifectaConfirmed(
  findings: Finding[],
  descriptor: ProfileDescriptor,
): void {
  if (descriptorAllowsPromptInjectionConfirmation(descriptor)) return;
  const confirmed = findings.filter((finding) => finding.lethalTrifectaStatus === 'CONFIRMED');
  if (confirmed.length > 0) {
    fail(
      `Profile '${descriptor.profileId}' does not allow coercion-only lethal confirmation, but found ${confirmed.length} lethalTrifectaStatus=CONFIRMED finding(s).`,
    );
  }
}
