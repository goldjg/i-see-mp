export { classifyTool } from './classifier.js';
export type { ClassificationResult } from './classifier.js';
export {
  runFindingsRules,
  deduplicateFindings,
  isKnownVerifiedServer,
  KNOWN_VERIFIED_SERVER_PATTERNS,
} from './findings-rules.js';
export {
  applyTrifectaAnalysis,
  applyTrifectaAnnotation,
  sortByTrifecta,
  classifyFindingTrifecta,
  deriveIsCrossServer,
} from './trifecta.js';
export type { TrifectaClassification } from './trifecta.js';
export {
  TrustLevel,
  SERVER_TRUST_MAP,
  getServerTrust,
  deriveTrustTransition,
  deriveCrossesTrustBoundary,
} from './trust.js';
export type { TrustTransition } from './trust.js';
