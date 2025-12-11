export type JsonSchema = {
  $id?: string;
  $schema?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  enum?: unknown[];
  [key: string]: unknown;
};



export type FormFieldState = {
  path: string; // JSON Pointer or dot path
  value: unknown;
  /** JSON Schema structural validity */
  schemaValid: boolean;

  /** Textual feedback from schema/LLM validators */
  messages: string[];
  /** Whether the field has ever been touched/edited */
  touched: boolean;
};

export type FormStatus = "not-started" | "in-progress" | "complete";

export type FormOverallValidity = "unknown" | "valid" | "invalid";

export type FormDefinition = {
  id: string;
  name: string;
  schema: JsonSchema;

};

export type FormSession = {
  sessionId: string;
  formId: string;
  definitionSnapshot: FormDefinition;
  data: Record<string, unknown>;
  fields: Record<string, FormFieldState>;
  status: FormStatus;
  overallValidity: FormOverallValidity;
  /**
   * A linearized list of form field paths representing the question order.
   */
  questionOrder: string[];
  currentQuestionIndex: number;
};
