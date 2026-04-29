import { z } from 'zod';
import { NodeType, EdgeType, Capability, RiskCategory, TrustBoundary, Confidence } from './types.js';

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
  pathSummary: z.string().optional(),
  sourceCapabilities: z.array(CapabilitySchema).optional(),
  sinkCapabilities: z.array(CapabilitySchema).optional(),
  boundaryCrossed: TrustBoundarySchema.optional(),
  explanation: z.string().optional(),
  evidence: z.array(z.string()).optional(),
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
