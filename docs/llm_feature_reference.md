# LLM Validation Feature Reference

This document contains the code for the optional LLM validation feature that was removed from the MVP. You can use this to re-implement the feature later.

## 1. Types (`src/formTypes.ts`)

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

## 2. Logic (`src/formEngine.ts`)

### Interface
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

### Validation Function
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

## 3. Example Usage (`src/mcpServer.ts`)

### Stub Client
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

### Form Definition
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
