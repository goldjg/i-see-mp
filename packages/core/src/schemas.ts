import { z } from 'zod';
import {
  NodeType,
  EdgeType,
  Capability,
  RiskCategory,
  TrustBoundary,
  Confidence,
  PathStatus,
  TestProfile,
  TestStatus,
  TestOutcome,
  TrifectaStage,
} from './types.js';

export const NodeTypeSchema = z.enum(
  Object.values(NodeType) as [string, ...string[]],
) as z.ZodEnum<[NodeType, ...NodeType[]]>;

export const EdgeTypeSchema = z.enum(
  Object.values(EdgeType) as [string, ...string[]],
) as z.ZodEnum<[EdgeType, ...EdgeType[]]>;

export const CapabilitySchema = z.enum(
  Object.values(Capability) as [string, ...string[]],
) as z.ZodEnum<[Capability, ...Capability[]]>;

export const RiskCategorySchema = z.enum(
  Object.values(RiskCategory) as [string, ...string[]],
) as z.ZodEnum<[RiskCategory, ...RiskCategory[]]>;

export const TrustBoundarySchema = z.enum(
  Object.values(TrustBoundary) as [string, ...string[]],
) as z.ZodEnum<[TrustBoundary, ...TrustBoundary[]]>;

export const ConfidenceSchema = z.enum(
  Object.values(Confidence) as [string, ...string[]],
) as z.ZodEnum<[Confidence, ...Confidence[]]>;

export const PathStatusSchema = z.enum(
  Object.values(PathStatus) as [string, ...string[]],
) as z.ZodEnum<[PathStatus, ...PathStatus[]]>;

export const TestProfileSchema = z.enum(
  Object.values(TestProfile) as [string, ...string[]],
) as z.ZodEnum<[TestProfile, ...TestProfile[]]>;

export const TestStatusSchema = z.enum(
  Object.values(TestStatus) as [string, ...string[]],
) as z.ZodEnum<[TestStatus, ...TestStatus[]]>;

export const TestOutcomeSchema = z.enum(
  Object.values(TestOutcome) as [string, ...string[]],
) as z.ZodEnum<[TestOutcome, ...TestOutcome[]]>;

export const TrifectaStageSchema = z.enum(
  Object.values(TrifectaStage) as [string, ...string[]],
) as z.ZodEnum<[TrifectaStage, ...TrifectaStage[]]>;

export const McpToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.unknown()).optional(),
});
export type McpTool = z.infer<typeof McpToolSchema>;

export const McpResourceSchema = z.object({
  uri: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});
export type McpResource = z.infer<typeof McpResourceSchema>;

export const McpPromptSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  arguments: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        required: z.boolean().optional(),
      }),
    )
    .optional(),
});
export type McpPrompt = z.infer<typeof McpPromptSchema>;

export const ServerConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  transport: z.enum(['stdio', 'http', 'sse']),
});
export type ServerConfig = z.infer<typeof ServerConfigSchema>;

export const GraphNodeSchema = z.object({
  id: z.string(),
  type: NodeTypeSchema,
  label: z.string(),
  serverId: z.string().optional(),
  capabilities: z.array(CapabilitySchema).default([]),
  riskScore: z.number().min(0).max(100).default(0),
  trustBoundary: TrustBoundarySchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: EdgeTypeSchema,
  metadata: z.record(z.unknown()).optional(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const FindingSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  category: RiskCategorySchema,
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  title: z.string(),
  description: z.string(),
  affectedNodeIds: z.array(z.string()),
  affectedEdgeIds: z.array(z.string()).optional(),
  remediationHint: z.string().optional(),
  createdAt: z.string(),
  // New, optional fields for richer findings
  confidence: ConfidenceSchema.optional(),
  staticPossible: z.boolean().optional(),
  observed: z.boolean().optional(),
  tested: z.boolean().optional(),
  pathStatus: PathStatusSchema.optional(),
  testRunIds: z.array(z.string()).optional(),
  pathSummary: z.string().optional(),
  sourceCapabilities: z.array(CapabilitySchema).optional(),
  sinkCapabilities: z.array(CapabilitySchema).optional(),
  boundaryCrossed: TrustBoundarySchema.optional(),
  explanation: z.string().optional(),
  evidence: z.array(z.string()).optional(),
  candidatePathId: z.string().optional(),
  isCrossServer: z.boolean().optional(),
  sourceServerId: z.string().optional(),
  sinkServerId: z.string().optional(),
  crossesTrustBoundary: z.boolean().optional(),
  trustTransition: z.string().optional(),
  isHighSignal: z.boolean().optional(),
  trifectaStage: TrifectaStageSchema.optional(),
  trifectaScore: z.number().optional(),
  trifectaComplete: z.boolean().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const CollectionSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  serverCount: z.number().default(0),
  toolCount: z.number().default(0),
  resourceCount: z.number().default(0),
  promptCount: z.number().default(0),
  status: z.enum(['running', 'completed', 'failed']),
  error: z.string().optional(),
});
export type Collection = z.infer<typeof CollectionSchema>;

export const ToolCallSchema = z.object({
  step: z.number(),
  toolId: z.string().optional(),
  toolName: z.string(),
  serverId: z.string().optional(),
  input: z.record(z.unknown()),
  output: z.unknown(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const TestRunSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  profile: TestProfileSchema,
  testCaseId: z.string(),
  testCaseName: z.string(),
  findingId: z.string().optional(),
  candidatePathId: z.string().optional(),
  serverId: z.string().optional(),
  sourceToolId: z.string().optional(),
  sinkToolId: z.string().optional(),
  pathSummary: z.string().optional(),
  plan: z.string(),
  toolCalls: z.array(ToolCallSchema).default([]),
  canaryExpected: z.string().optional(),
  canaryObserved: z.boolean(),
  outcome: TestOutcomeSchema,
  status: TestStatusSchema,
  pathStatus: PathStatusSchema,
  timestamp: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  notes: z.string().optional(),
});
export type TestRun = z.infer<typeof TestRunSchema>;

export const EvidenceSchema = z.object({
  id: z.string(),
  testRunId: z.string(),
  candidatePathId: z.string().optional(),
  type: z.string(),
  stepIndex: z.number().optional(),
  toolName: z.string().optional(),
  redactedInput: z.record(z.unknown()).optional(),
  redactedOutput: z.unknown().optional(),
  content: z.record(z.unknown()),
  createdAt: z.string(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;
