import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RequestSchema, ResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  FormDefinition,
  FormSession,
} from "./formTypes.js";
import {
  InMemoryFormStore,
  getCurrentQuestionPath,
  moveToNextQuestion,
  moveToPreviousQuestion,
  runSchemaValidation,
  setFieldValue,
} from "./formEngine.js";

const store = new InMemoryFormStore();

// Simple no-op LLM client placeholder; you can later wire this
// to a real provider via MCP or environment-specific hooks.


// Example demo form so the agent has something to work with.
const demoForm: FormDefinition = {
  id: "demo-contact",
  name: "Demo Contact Form",
  schema: {
    type: "object",
    properties: {
      fullName: { type: "string" },
      age: { type: "integer", minimum: 0 },
      email: { type: "string", format: "email" },
      bio: { type: "string" },
    },
    required: ["fullName", "email"],
  },

};


store.registerForm(demoForm);

function loadFormsFromDir(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        const content = fs.readFileSync(path.join(dir, file), "utf-8");
        const formDef = JSON.parse(content) as FormDefinition;
        // Basic validation that it has id and schema
        if (formDef.id && formDef.schema) {
          store.registerForm(formDef);
          console.error(`Registered form: ${formDef.id} from ${file}`);
        }
      } catch (err: any) {
        console.error(`Failed to load form ${file}: ${err.message}`);
      }
    }
  }
}

function loadFormsFromDisk() {
  // Try to find forms in src/forms relative to the project root
  const projectRoot = path.resolve(__dirname, "..");
  const formsDir = path.join(projectRoot, "src", "forms");

  if (!fs.existsSync(formsDir)) {
    console.warn(`Forms directory not found at ${formsDir}`);
    // Fallback: try checking just "forms" next to index.js
    const localForms = path.join(__dirname, "forms");
    if (fs.existsSync(localForms)) {
      console.warn(`Found local forms dir at ${localForms}`);
      loadFormsFromDir(localForms);
    }
    return;
  }

  loadFormsFromDir(formsDir);
}

loadFormsFromDisk();

type SessionSummary = {
  sessionId: string;
  formId: string;
  status: string;
  overallValidity: string;
  currentQuestionPath: string | null;
};

function summarizeSession(session: FormSession): SessionSummary {
  return {
    sessionId: session.sessionId,
    formId: session.formId,
    status: session.status,
    overallValidity: session.overallValidity,
    currentQuestionPath: getCurrentQuestionPath(session),
  };
}

export async function createServer(): Promise<any> {
  const server = new Server(
    {
      name: "form-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {
          list: true,
        },
      },
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Helper to register a tool using MCP's Request/Result schemas
  type RegisteredTool = {
    name: string;
    description: string;
    inputSchema: Record<string, any>;
  };

  const registeredTools: RegisteredTool[] = [];

  function registerTool<In extends z.ZodObject<any>, Out extends z.ZodTypeAny>(
    name: string,
    description: string,
    inputSchema: In,
    outputSchema: Out,
    handler: (input: z.infer<In>) => Promise<z.infer<Out>> | z.infer<Out>,
    jsonSchemaStub: Record<string, any> = {}
  ) {
    registeredTools.push({ name, description, inputSchema: jsonSchemaStub });
    toolHandlers.set(name, async (args: any) => {
      const parsed = inputSchema.parse(args);
      const output = await handler(parsed);
      return output;
    });
  }

  const toolHandlers = new Map<string, (args: any) => Promise<any>>();

  // Standard MCP tools/call handler
  server.setRequestHandler(
    RequestSchema.extend({
      method: z.literal("tools/call"),
      params: z.object({
        name: z.string(),
        arguments: z.record(z.any()).optional(),
      }),
    }) as any,
    async (request: any) => {
      const { name, arguments: args } = request.params;
      const handler = toolHandlers.get(name);
      if (!handler) {
        throw new Error(`Tool not found: ${name}`);
      }
      try {
        const result = await handler(args ?? {});
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Implement the standard MCP tools/list method
  {
    const ToolsListRequestSchema = RequestSchema.extend({
      method: z.literal("tools/list"),
    });

    server.setRequestHandler(ToolsListRequestSchema as any, async () => {
      const tools = registeredTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      return { tools };
    });
  }

  // List available forms
  registerTool(
    "list_forms",
    "List all available form definitions.",
    z.object({}),
    z.object({
      forms: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
        }),
      ),
    }),
    async () => {
      const forms = store.listForms().map((f) => ({
        id: f.id,
        name: f.name,
        title: f.schema.title ?? undefined,
        description: f.schema.description ?? undefined,
      }));
      return { forms };
    },
    { type: "object", properties: {} }
  );

  // Start a new form session
  registerTool(
    "start_form_session",
    "Start a new form session for a given form id, optionally associated with a user.",
    z.object({
      formId: z.string(),
      userId: z.string().optional(),
    }),
    z.object({
      session: z.any(),
    }),
    async ({ formId, userId }: { formId: string; userId?: string }) => {
      const session = store.createSession(formId, userId);
      return { session: summarizeSession(session) };
    },
    {
      type: "object",
      properties: {
        formId: { type: "string" },
        userId: { type: "string" },
      },
      required: ["formId"],
    }
  );

  // List user's form sessions
  registerTool(
    "list_user_forms",
    "List all form sessions associated with a specific user.",
    z.object({
      userId: z.string(),
    }),
    z.object({
      sessions: z.array(z.any()),
    }),
    async ({ userId }: { userId: string }) => {
      const sessions = store.listSessions({ userId });
      return { sessions: sessions.map(summarizeSession) };
    },
    {
      type: "object",
      properties: {
        userId: { type: "string" },
      },
      required: ["userId"],
    }
  );

  // Get session state
  registerTool(
    "get_form_state",
    "Get full state for a form session, including field-level validity.",
    z.object({
      sessionId: z.string(),
    }),
    z.object({
      session: z.any(),
      data: z.record(z.any()),
      fields: z.record(z.any()),
    }),
    async ({ sessionId }: { sessionId: string }) => {
      const session = store.getSession(sessionId);
      if (!session) throw new Error("Session not found");
      return {
        session: summarizeSession(session),
        data: session.data,
        fields: session.fields,
      };
    },
    {
      type: "object",
      properties: {
        sessionId: { type: "string" },
      },
      required: ["sessionId"],
    }
  );

  // Set answer for a specific field (question)
  registerTool(
    "set_field_value",
    "Set or update the answer for a specific field path within a session.",
    z.object({
      sessionId: z.string(),
      path: z.string(),
      value: z.any(),
    }),
    z.object({
      session: z.any(),
      field: z.any(),
    }),
    async (input) => {
      const { sessionId, path, value } = input as {
        sessionId: string;
        path: string;
        value: unknown;
      };
      const session = store.getSession(sessionId);
      if (!session) throw new Error("Session not found");
      setFieldValue(session, path, value);
      return { session: summarizeSession(session), field: session.fields[path] };
    },
    {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        path: { type: "string" },
        value: {},
      },
      required: ["sessionId", "path", "value"],
    }
  );

  // Navigation tools
  registerTool(
    "next_question",
    "Move to the next question in the session.",
    z.object({ sessionId: z.string() }),
    z.object({ session: z.any() }),
    async ({ sessionId }: { sessionId: string }) => {
      const session = store.getSession(sessionId);
      if (!session) throw new Error("Session not found");
      moveToNextQuestion(session);
      return { session: summarizeSession(session) };
    },
    {
      type: "object",
      properties: {
        sessionId: { type: "string" },
      },
      required: ["sessionId"],
    }
  );

  registerTool(
    "previous_question",
    "Move to the previous question in the session.",
    z.object({ sessionId: z.string() }),
    z.object({ session: z.any() }),
    async ({ sessionId }: { sessionId: string }) => {
      const session = store.getSession(sessionId);
      if (!session) throw new Error("Session not found");
      moveToPreviousQuestion(session);
      return { session: summarizeSession(session) };
    },
    {
      type: "object",
      properties: {
        sessionId: { type: "string" },
      },
      required: ["sessionId"],
    }
  );

  // Run validations (schema + optional LLM)
  registerTool(
    "validate_form",
    "Run JSON Schema validation and optional LLM validation for the session.",
    z.object({
      sessionId: z.string(),
    }),
    z.object({
      session: z.any(),
      fields: z.record(z.any()),
    }),
    async ({
      sessionId,
    }: {
      sessionId: string;
    }) => {
      const session = store.getSession(sessionId);
      if (!session) throw new Error("Session not found");
      runSchemaValidation(session);

      return {
        session: summarizeSession(session),
        fields: session.fields,
      };
    },
    {
      type: "object",
      properties: {
        sessionId: { type: "string" },
      },
      required: ["sessionId"],
    }
  );

  return server;
}

export async function run(): Promise<void> {
  await createServer();
}
