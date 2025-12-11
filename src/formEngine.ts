import AjvModule, { type ErrorObject } from "ajv";
import addFormatsModule from "ajv-formats";
import { v4 as uuidv4 } from "uuid";
import {
  FormDefinition,
  FormFieldState,
  FormOverallValidity,
  FormSession,
  JsonSchema,
} from "./formTypes.js";

const Ajv = (AjvModule as any).default ?? AjvModule;
const addFormats = (addFormatsModule as any).default ?? addFormatsModule;
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);



export class InMemoryFormStore {
  private forms = new Map<string, FormDefinition>();
  private sessions = new Map<string, FormSession>();

  registerForm(def: FormDefinition): void {
    this.forms.set(def.id, def);
  }

  listForms(): FormDefinition[] {
    return [...this.forms.values()];
  }

  getForm(id: string): FormDefinition | undefined {
    return this.forms.get(id);
  }

  createSession(formId: string, userId?: string): FormSession {
    const form = this.forms.get(formId);
    if (!form) throw new Error(`Form not found: ${formId}`);

    const questionOrder = deriveQuestionOrder(form.schema);
    const sessionId = uuidv4();
    const session: FormSession = {
      sessionId,
      userId,
      formId,
      definitionSnapshot: form,
      data: {},
      fields: {},
      status: "not-started",
      overallValidity: "unknown",
      questionOrder,
      currentQuestionIndex: 0,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): FormSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(filter?: { userId?: string }): FormSession[] {
    const all = [...this.sessions.values()];
    if (!filter?.userId) return all;
    return all.filter((s) => s.userId === filter.userId);
  }
}

export function deriveQuestionOrder(schema: JsonSchema, basePath = ""): string[] {
  const paths: string[] = [];
  if (schema.type === "object" && schema.properties) {
    for (const key of Object.keys(schema.properties)) {
      const child = schema.properties[key];
      const childPath = basePath ? `${basePath}.${key}` : key;
      paths.push(childPath);
      paths.push(...deriveQuestionOrder(child as JsonSchema, childPath));
    }
  }
  return paths;
}

export function setFieldValue(session: FormSession, path: string, value: unknown): void {
  session.data[path] = value;
  const existing = session.fields[path];
  const updated: FormFieldState = {
    path,
    value,
    schemaValid: existing?.schemaValid ?? false,

    messages: existing?.messages ?? [],
    touched: true,
  };
  session.fields[path] = updated;
  if (session.status === "not-started") session.status = "in-progress";

  // Auto-validate to consistently update schemaValid / messages
  runSchemaValidation(session);
}

export function moveToNextQuestion(session: FormSession): void {
  if (session.currentQuestionIndex < session.questionOrder.length - 1) {
    session.currentQuestionIndex += 1;
  }
}

export function moveToPreviousQuestion(session: FormSession): void {
  if (session.currentQuestionIndex > 0) {
    session.currentQuestionIndex -= 1;
  }
}

export function getCurrentQuestionPath(session: FormSession): string | null {
  return session.questionOrder[session.currentQuestionIndex] ?? null;
}

export function runSchemaValidation(session: FormSession): void {
  const schema = session.definitionSnapshot.schema;
  const grouped: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(session.data)) {
    setDeepValue(grouped, path, value);
  }

  const validate = ajv.compile(schema as any);
  const valid = validate(grouped);
  const errors = (validate.errors ?? []) as ErrorObject[];

  const fieldErrors = new Map<string, string[]>();
  for (const err of errors) {
    const path = normalizeAjvPath(err.instancePath);
    if (!fieldErrors.has(path)) fieldErrors.set(path, []);
    fieldErrors.get(path)!.push(err.message ?? "Validation error");
  }

  for (const path of session.questionOrder) {
    const existing = session.fields[path] ?? {
      path,
      value: undefined,
      schemaValid: true,

      messages: [],
      touched: false,
    };
    const errs = fieldErrors.get(path) ?? [];
    session.fields[path] = {
      ...existing,
      schemaValid: errs.length === 0,
      messages: [...errs],
    };
  }

  session.overallValidity = valid ? "valid" : "invalid";
  if (valid) session.status = "complete";
}



function setDeepValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current: any = target;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    if (i === parts.length - 1) {
      current[key] = value;
    } else {
      if (!current[key] || typeof current[key] !== "object") {
        current[key] = {};
      }
      current = current[key];
    }
  }
}

function normalizeAjvPath(instancePath: string): string {
  if (!instancePath) return "";
  const noSlash = instancePath.replace(/^\//, "");
  return noSlash.replace(/\//g, ".");
}
