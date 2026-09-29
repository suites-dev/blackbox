# Discovery diagrams

Mermaid sources are provided separately and repeated here for Markdown rendering.

## Skill router
[Source](skill-router.mmd)

```mermaid
flowchart TD
  R["Discovery router"] --> D{"Existing or partial setup"}
  D -->|No| I["Initial setup"]
  D -->|Yes| C["Reconcile existing setup"]
  I --> E["Repository inventory"]
  C --> E
  E --> L["Dependency inspector router"]
  E --> CI["CI inspection and attachment"]
  E --> IA["Infrastructure router"]
  E --> IO["I/O and environment"]
  L --> B["Behavioral boundary"]
  CI --> B
  IA --> B
  IO --> B
  B --> K["Catalog authoring"]
  K --> P["Static preflight"]
  P --> V["Authorized Capsule validation"]
  V --> A["Async completion when required"]
  P --> Q["Structured audit"]
  A --> Q
  Q --> X["Repair the failed stage"]
```

## Discovery state
[Source](discovery-state.mmd)

```mermaid
stateDiagram-v2
  [*] --> Detect
  Detect --> Initial: No existing assets
  Detect --> Reconcile: Existing or partial assets
  Initial --> Inspect
  Reconcile --> Inspect
  Inspect --> Blocked: Missing access or prerequisites
  Inspect --> SelectBoundary
  SelectBoundary --> AuthorCatalog: Scoped edit authorized
  SelectBoundary --> Audit: Inventory only
  AuthorCatalog --> Preflight
  Preflight --> Blocked: Unsupported or invalid setup
  Preflight --> Audit: Static task complete
  Preflight --> Acquire: Live scope authorized
  Acquire --> Exercise: Readiness and setup established
  Acquire --> Cleanup: Partial startup failure
  Exercise --> Cleanup: Terminal check or timeout
  Cleanup --> Audit: Retain all outcomes
  Blocked --> Audit
  Audit --> [*]
```

## Evidence model
[Source](evidence-model.mmd)

```mermaid
flowchart LR
  SRC["Source files and build metadata"] --> MOD["Package and module graph"]
  MOD --> MAP["Explicit build and launch mapping"]
  MAP --> N["Stable participant and resource IDs"]
  INF["CI and IaC declarations"] --> DEP["Deployment view"]
  DEP --> N
  OWN["Ownership, reset and cleanup"] --> LIFE["Lifecycle-control view"]
  LIFE --> N
  Q["Accepted input and terminal predicate"] --> BEH["Behavioral view"]
  BEH --> N
  RUN["Exact Capsule runtime records"] --> EV["Occurrence evidence"]
  EV --> BEH
  N --> CAT["Supported catalog fields"]
  N --> AUD["Separate audit with provenance and uncertainty"]
```

## Sut reduction
[Source](sut-reduction.mmd)

```mermaid
flowchart TD
  Q["Fix accepted behavior and initial state"] --> S["Forward input reachability intersects backward terminal reachability"]
  S --> C["Expand startup, state, observation and cleanup prerequisites"]
  C --> U{"Unresolved required dependency"}
  U -->|Yes| R["Retain dependency and report uncertainty"]
  R --> P["Source-backed candidate boundary"]
  U -->|No| P
  P --> A{"Execution authorized"}
  A -->|No| AUD["Return unexercised audit"]
  A -->|Yes| BASE["Fresh positive baseline"]
  BASE --> TRY["Propose one admissible removal group"]
  TRY --> TEST["Fresh state and unchanged terminal predicates"]
  TEST --> GOOD{"Behavior, observation and cleanup supported"}
  GOOD -->|Yes| KEEP["Retain scoped reduction and receipts"]
  GOOD -->|No or inconclusive| RESTORE["Restore group and record limitation"]
  KEEP --> BUDGET{"Budget remaining"}
  RESTORE --> BUDGET
  BUDGET -->|Yes| TRY
  BUDGET -->|No| DONE["Selected boundary, not a universal minimum"]
```

## Capsule sequence
[Source](capsule-sequence.mmd)

```mermaid
sequenceDiagram
  actor User
  participant Agent
  participant CLI as Installed CLI
  participant Capsule
  participant SUT
  participant Records
  Agent->>CLI: Validate catalog and inspect capabilities
  CLI-->>Agent: Static result, no behavioral claim
  Agent->>User: Request missing code/resource/external scope
  User-->>Agent: Explicit scoped approval or denial
  alt Live probe approved
    Agent->>CLI: Acquire selected catalog entry
    CLI->>Capsule: Acquire resources and wait for supported readiness
    Capsule->>SUT: Start owned participants
    CLI-->>Agent: Exact Capsule/session identity
    Agent->>CLI: Setup activity, then one stimulus activity
    CLI->>SUT: Execute through selected driver
    Agent->>CLI: Bounded terminal inspections
    SUT-->>Records: State witnesses and runtime observations
    Agent->>Records: Inspect exact attempt and required observation scope
    Agent->>CLI: Export report and release exact Capsule
    CLI->>Capsule: Cleanup owned resources even after failure
    Capsule-->>Records: Cleanup result
    Agent-->>User: Audit with independent stage outcomes
  else Static only or blocked
    Agent-->>User: Audit without invented runtime receipts
  end
```

## Queue flow
[Source](queue-flow.mmd)

```mermaid
flowchart LR
  F["Fresh namespace and unique business ID"] --> I["Input queue"]
  I -->|One message| W["Worker participant"]
  W --> DB["Required durable state"]
  W --> O["Output queue"]
  O -->|Matching payload and business ID| T["Bounded terminal inspection"]
  P["Recorded stimulus activity"] --> I
  W -.-> TR["Possibly separate downstream trace"]
  TR --> C["Same Capsule evidence scope"]
  P --> C
  T --> C
  C --> A["Audit preserves causality and coverage limits"]
  T --> R["Owned-state cleanup"]
```

## Permission boundaries
[Source](permission-boundaries.mmd)

```mermaid
flowchart TD
  Q["Requested task scope"] --> L["Read authorized local repository"]
  L --> E["Unresolved reference to another repository"]
  E --> G{"Explicit read/search approval"}
  G -->|Denied| U["Preserve unresolved edge"]
  G -->|Approved| F["Fetch only approved sources"]
  F --> PLAN["Proposed setup and behavior"]
  L --> PLAN
  PLAN --> W{"Project or CI edit approval"}
  W --> WRITE["Scoped edits only"]
  PLAN --> X{"Code and local-resource approval"}
  X --> LIVE["Bounded Capsule"]
  LIVE --> REMOTE{"Specific external-service approval"}
  REMOTE -->|Denied| BLOCK["Block external operation"]
  REMOTE -->|Approved| EXT["Permitted test endpoint only"]
  LIVE --> CLEAN["Cleanup recorded owned resources"]
```

## Audit pipeline
[Source](audit-pipeline.mmd)

```mermaid
flowchart LR
  A["Agent-proposed audit"] --> S["Closed JSON schema"]
  S --> G["Graph, boundary and outcome consistency"]
  R["Runner-owned sanitized raw records"] --> N["Version-specific receipt normalization"]
  N --> L["Scope, activity and witness linkage"]
  G --> L
  L --> O["Accepted structural and record consistency"]
  L --> F["Rejected with diagnostics"]
  O --> H["Caller authenticates provenance and evaluates accepted predicate"]
  E["Illustrative records"] --> N
  E -.-> MARK["Example provenance remains explicit"]
  MARK --> O
```
