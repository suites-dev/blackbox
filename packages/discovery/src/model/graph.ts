export type Ownership = 'project' | 'organization' | 'third-party' | 'unknown';
export type Lifecycle = 'capsule-owned' | 'preexisting' | 'external' | 'unknown';
export type Relevance = 'required' | 'candidate' | 'excluded';
export type Binding =
  Readonly<{ kind: 'resolved'; value: string }> | Readonly<{ kind: 'unresolved'; reason: string }>;

type NodeIdentity = Readonly<{
  id: string;
  label: string;
  ownership: Ownership;
  lifecycle: Lifecycle;
  relevance: Relevance;
  evidenceIds: readonly string[];
}>;

/** Package/module nodes are evidence, not automatically runnable participants. */
export type GraphNode = NodeIdentity &
  (
    | Readonly<{ kind: 'participant'; runtime: string; service: Binding }>
    | Readonly<{ kind: 'resource'; resourceType: string; protocol: string }>
    | Readonly<{ kind: 'module'; language: string; path: string }>
    | Readonly<{ kind: 'package'; ecosystem: string; version: Binding }>
  );

type EdgeIdentity = Readonly<{
  id: string;
  from: string;
  to: string;
  evidenceIds: readonly string[];
}>;

/** Different relations must remain distinguishable in the normalized graph. */
export type GraphEdge = EdgeIdentity &
  (
    | Readonly<{ kind: 'behavioral'; protocol: string; operation: string }>
    | Readonly<{
        kind: 'requires';
        phase: 'build' | 'startup' | 'execution' | 'observation' | 'cleanup';
        necessity: 'mandatory' | 'conditional' | 'unknown';
        condition: string;
      }>
    | Readonly<{ kind: 'deployment'; relation: 'colocated' | 'connected' | 'exposed' }>
    | Readonly<{
        kind: 'source';
        relation: 'imports' | 'calls' | 'depends-on-package' | 'implements';
      }>
  );

export type Graph = Readonly<{
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
}>;

export type Confidence = Readonly<{
  kind: 'unknown' | 'low' | 'medium' | 'high';
  reasons: readonly string[];
  evidenceIds: readonly string[];
}>;

export type Substitution = Readonly<{
  original: string;
  replacement: string;
  approvalId: string;
  preserves: readonly string[];
  limitations: readonly string[];
}>;

export type Boundary =
  | Readonly<{ kind: 'unselected'; reason: string }>
  | Readonly<{
      kind: 'selected';
      nodeIds: readonly string[];
      excluded: readonly Readonly<{ nodeId: string; reason: string }>[];
      substitutions: readonly Substitution[];
      unresolvedRequiredIds: readonly string[];
      rationale: string;
      confidence: Confidence;
    }>;
