import { describe, it, expect } from 'vitest';
import {
  NodeType,
  EdgeType,
  Capability,
  RiskCategory,
  TrifectaStage,
  LethalTrifectaStatus,
  DataflowClassification,
} from '../types.js';
import {
  NodeTypeSchema,
  EdgeTypeSchema,
  CapabilitySchema,
  RiskCategorySchema,
  McpToolSchema,
  GraphNodeSchema,
  FindingSchema,
  CollectionSchema,
  TrifectaStageSchema,
  LethalTrifectaStatusSchema,
  DataflowClassificationSchema,
} from '../schemas.js';

describe('NodeType', () => {
  it('has expected values', () => {
    expect(NodeType.AGENT).toBe('agent');
    expect(NodeType.MCP_SERVER).toBe('mcp_server');
    expect(NodeType.TOOL).toBe('tool');
  });

  it('schema parses valid value', () => {
    expect(NodeTypeSchema.parse('agent')).toBe('agent');
  });

  it('schema rejects invalid value', () => {
    expect(() => NodeTypeSchema.parse('invalid')).toThrow();
  });
});

describe('EdgeType', () => {
  it('has post-MVP reserved edge types', () => {
    expect(EdgeType.OBSERVED_CALL).toBe('observed_call');
    expect(EdgeType.TESTED_PATH).toBe('tested_path');
    expect(EdgeType.CARRIES_INSTRUCTION).toBe('carries_instruction');
  });
});

describe('Capability', () => {
  it('has all expected capabilities', () => {
    expect(Capability.RUN_SHELL).toBe('RUN_SHELL');
    expect(Capability.READ_SECRET).toBe('READ_SECRET');
    expect(Capability.SEND_HTTP).toBe('SEND_HTTP');
    expect(Capability.INSTRUCTION_SOURCE).toBe('INSTRUCTION_SOURCE');
  });

  it('schema parses valid value', () => {
    expect(CapabilitySchema.parse('RUN_SHELL')).toBe('RUN_SHELL');
  });
});

describe('RiskCategory', () => {
  it('has all expected categories', () => {
    expect(RiskCategory.DATA_EXFILTRATION).toBe('DATA_EXFILTRATION');
    expect(RiskCategory.CODE_EXECUTION).toBe('CODE_EXECUTION');
  });

  it('schema parses valid value', () => {
    expect(RiskCategorySchema.parse('CODE_EXECUTION')).toBe('CODE_EXECUTION');
  });
});

describe('TrifectaStage', () => {
  it('has expected values', () => {
    expect(TrifectaStage.COMPLETE).toBe('COMPLETE');
    expect(TrifectaStage.PARTIAL).toBe('PARTIAL');
    expect(TrifectaStage.CAPABILITY_ONLY).toBe('CAPABILITY_ONLY');
  });

  it('schema parses valid value', () => {
    expect(TrifectaStageSchema.parse('COMPLETE')).toBe('COMPLETE');
  });
});

describe('LethalTrifectaStatus', () => {
  it('supports POSSIBLE/CONFIRMED and compatibility aliases', () => {
    expect(LethalTrifectaStatus.POSSIBLE).toBe('POSSIBLE');
    expect(LethalTrifectaStatus.CONFIRMED).toBe('CONFIRMED');
    expect(LethalTrifectaStatus.CANDIDATE).toBe('POSSIBLE');
    expect(LethalTrifectaStatusSchema.parse('POSSIBLE')).toBe('POSSIBLE');
  });
});

describe('DataflowClassification', () => {
  it('supports COMPLETE/PARTIAL/NONE', () => {
    expect(DataflowClassification.COMPLETE).toBe('COMPLETE');
    expect(DataflowClassification.PARTIAL).toBe('PARTIAL');
    expect(DataflowClassification.NONE).toBe('NONE');
    expect(DataflowClassificationSchema.parse('NONE')).toBe('NONE');
  });
});

describe('McpToolSchema', () => {
  it('parses a tool with all fields', () => {
    const tool = McpToolSchema.parse({
      name: 'read_file',
      description: 'Reads a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    });
    expect(tool.name).toBe('read_file');
  });

  it('parses a tool with only name', () => {
    const tool = McpToolSchema.parse({ name: 'simple_tool' });
    expect(tool.name).toBe('simple_tool');
    expect(tool.description).toBeUndefined();
  });
});

describe('GraphNodeSchema', () => {
  it('parses a node with defaults', () => {
    const node = GraphNodeSchema.parse({
      id: 'n1',
      type: 'tool',
      label: 'My Tool',
    });
    expect(node.capabilities).toEqual([]);
    expect(node.riskScore).toBe(0);
  });
});

describe('FindingSchema', () => {
  it('parses a valid finding', () => {
    const finding = FindingSchema.parse({
      id: 'f1',
      collectionId: 'c1',
      category: 'CODE_EXECUTION',
      severity: 'critical',
      title: 'RCE possible',
      description: 'Tool allows shell execution',
      affectedNodeIds: ['tool:run_shell'],
      createdAt: new Date().toISOString(),
    });
    expect(finding.severity).toBe('critical');
  });

  it('parses extended prompt-injection/trust fields', () => {
    const finding = FindingSchema.parse({
      id: 'f2',
      collectionId: 'c1',
      category: 'PROMPT_INJECTION',
      severity: 'high',
      title: 'Prompt injection',
      description: 'desc',
      affectedNodeIds: ['tool:t1'],
      createdAt: new Date().toISOString(),
      subCategory: 'PROMPT_INJECTION_POSSIBLE',
      injectionConfirmed: false,
      trustBoundaryConfirmed: true,
      trustBoundaryExploitConfirmed: false,
      injectionExploitChain: false,
      baselinePlan: [
        {
          step: 1,
          toolName: 'issue_read',
          input: { issue: 1 },
          output: { text: 'ok' },
        },
      ],
    });
    expect(finding.subCategory).toBe('PROMPT_INJECTION_POSSIBLE');
    expect(finding.trustBoundaryConfirmed).toBe(true);
    expect(finding.trustBoundaryExploitConfirmed).toBe(false);
    expect(finding.baselinePlan?.length).toBe(1);
  });
});

describe('CollectionSchema', () => {
  it('parses a valid collection', () => {
    const col = CollectionSchema.parse({
      id: 'col1',
      startedAt: new Date().toISOString(),
      status: 'completed',
    });
    expect(col.serverCount).toBe(0);
  });
});

describe('EdgeTypeSchema', () => {
  it('includes reserved post-MVP types', () => {
    expect(EdgeTypeSchema.parse('observed_call')).toBe('observed_call');
    expect(EdgeTypeSchema.parse('tested_path')).toBe('tested_path');
  });
});
