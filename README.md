# form-mcp

An MCP server that manages JSON Schema-driven forms with optional LLM-assisted validation, designed for agents to iteratively fill out complex forms.

## Features (MVP)

- Register JSON Schema-based forms (currently an in-memory demo form).
- Start form sessions and track partial data per field.
- Navigate questions (next/previous) via MCP tools.
- Run JSON Schema validation and record per-field validity.
- Optional LLM validation prompts per field (stubbed client in MVP).

## MCP Tools

- `list_forms`: list available form definitions.
- `start_form_session`: create a new session for a form.
- `get_form_state`: inspect session status, data, and field validity.
- `set_field_value`: set or update a specific field value by path.
- `next_question` / `previous_question`: move between questions.
- `validate_form`: run schema and optional LLM validation.

## Development

Install dependencies and build:

```powershell
npm install
npm run build
```

Run the MCP server (stdio mode):

```powershell
npm start
```

You can then configure your MCP-compatible client to use this server.

## LLM Validation Feature Reference

This section contains the code for the optional LLM validation feature that was removed from the MVP. You can use this to re-implement the feature later.

### 1. Types (`src/formTypes.ts`)

Add these types back to support LLM validation configuration and status.

```typescript
export type LlmValidationConfig = {
  prompt: string;
  model?: string;
  /**
   * Optional threshold in [0,1] that the model should treat as pass/fail
   * if the scoring output is numeric.
   */
  passThreshold?: number;
};

// Update FormFieldState
export type FormFieldState = {
  // ... existing fields ...
  /** LLM quality validity (true = passes prompt check) */
  llmValid: boolean | null;
};

// Update FormDefinition
export type FormDefinition = {
  // ... existing fields ...
  /** Map from JSON path to LLM validation config. */
  llmValidators?: Record<string, LlmValidationConfig>;
};
```

### 2. Logic (`src/formEngine.ts`)

#### Interface
```typescript
export type MinimalLlmClient = {
  validateWithPrompt: (config: {
    prompt: string;
    value: unknown;
    path: string;
    model?: string;
  }) => Promise<{ valid: boolean; message?: string }>;
};
```

#### Validation Function
```typescript
export async function runLlmValidation(
  session: FormSession,
  llmClient: MinimalLlmClient,
  paths?: string[],
): Promise<void> {
  const validators = session.definitionSnapshot.llmValidators ?? {};
  const targetPaths = paths ?? Object.keys(validators);

  for (const path of targetPaths) {
    const config = validators[path];
    if (!config) continue;
    const value = session.data[path];
    
    // Skip empty values or handle as needed
    if (value === undefined || value === null || value === "") continue;

    const result = await llmClient.validateWithPrompt({
      prompt: config.prompt,
      value,
      path,
      model: config.model,
    });
    
    const existing = session.fields[path] ?? {
      path,
      value,
      schemaValid: true,
      llmValid: null,
      messages: [],
      touched: !!value,
    };
    
    session.fields[path] = {
      ...existing,
      llmValid: result.valid,
      messages: result.message
        ? [...existing.messages, result.message]
        : existing.messages,
    };
  }
}
```

### 3. Example Usage (`src/mcpServer.ts`)

#### Stub Client
```typescript
const llmClient: MinimalLlmClient = {
  async validateWithPrompt({ prompt, value }) {
    // Connect to real LLM here
    return {
      valid: true,
      message: `Checked against: ${prompt}`,
    };
  },
};
```

#### Form Definition
```typescript
const demoForm: FormDefinition = {
  // ...
  llmValidators: {
    bio: {
      prompt: "Evaluate whether this biography is clear, concise, and professional.",
    },
  },
};
```
