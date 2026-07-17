import { createSlice, createAsyncThunk, type PayloadAction, nanoid } from "@reduxjs/toolkit";
import { apiService, type Workflow, type WorkflowNode, type NodeType } from "@/services/api";
import { getDefaults } from "@/lib/nodeSchemas";

interface WorkflowsState {
  items: Workflow[];
  current: Workflow | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  deployStatus: "idle" | "deploying" | "success" | "failed";
}

const initialState: WorkflowsState = {
  items: [],
  current: null,
  status: "idle",
  error: null,
  saveStatus: "idle",
  deployStatus: "idle",
};

export const fetchWorkflows = createAsyncThunk("workflows/fetchAll", () =>
  apiService.listWorkflows(),
);

export const fetchWorkflow = createAsyncThunk("workflows/fetchOne", (id: string) =>
  apiService.getWorkflow(id),
);

export const createWorkflowThunk = createAsyncThunk(
  "workflows/create",
  (args: { name: string; description?: string }) =>
    apiService.createWorkflow(args.name, args.description),
);

export const saveWorkflowThunk = createAsyncThunk(
  "workflows/save",
  (args: { id: string; nodes: WorkflowNode[]; edges: Workflow["edges"] }) =>
    apiService.saveWorkflow(args.id, { nodes: args.nodes, edges: args.edges }),
);

export const deployWorkflowThunk = createAsyncThunk("workflows/deploy", (id: string) =>
  apiService.deployWorkflow(id),
);

export const rollbackWorkflowThunk = createAsyncThunk(
  "workflows/rollback",
  (args: { id: string; toVersion: number }) =>
    apiService.rollbackWorkflow(args.id, args.toVersion),
);

// Merge defaults into properties so old seed nodes have all fields.
function hydrateNode(n: WorkflowNode): WorkflowNode {
  const defaults = getDefaults(n.type);
  return { ...n, properties: { ...defaults, ...n.properties } };
}

function hydrate(w: Workflow): Workflow {
  return { ...w, nodes: w.nodes.map(hydrateNode) };
}

const slice = createSlice({
  name: "workflows",
  initialState,
  reducers: {
    clearCurrent(state) {
      state.current = null;
    },
    addNode(
      state,
      action: PayloadAction<{ type: NodeType; x: number; y: number }>,
    ) {
      if (!state.current) return;
      const { type, x, y } = action.payload;
      const node: WorkflowNode = {
        id: `n_${nanoid(6)}`,
        type,
        label: type,
        x,
        y,
        properties: getDefaults(type),
      };
      state.current.nodes.push(node);
    },
    moveNode(
      state,
      action: PayloadAction<{ id: string; x: number; y: number }>,
    ) {
      if (!state.current) return;
      const n = state.current.nodes.find((x) => x.id === action.payload.id);
      if (n) {
        n.x = action.payload.x;
        n.y = action.payload.y;
      }
    },
    updateNodeProperties(
      state,
      action: PayloadAction<{ id: string; properties: Record<string, unknown> }>,
    ) {
      if (!state.current) return;
      const n = state.current.nodes.find((x) => x.id === action.payload.id);
      if (n) n.properties = { ...n.properties, ...action.payload.properties };
    },
    updateNodeLabel(state, action: PayloadAction<{ id: string; label: string }>) {
      if (!state.current) return;
      const n = state.current.nodes.find((x) => x.id === action.payload.id);
      if (n) n.label = action.payload.label;
    },
    deleteNode(state, action: PayloadAction<string>) {
      if (!state.current) return;
      state.current.nodes = state.current.nodes.filter((n) => n.id !== action.payload);
      state.current.edges = state.current.edges.filter(
        (e) => e.from !== action.payload && e.to !== action.payload,
      );
    },
    addEdge(state, action: PayloadAction<{ from: string; to: string }>) {
      if (!state.current) return;
      const { from, to } = action.payload;
      if (from === to) return;
      const exists = state.current.edges.some((e) => e.from === from && e.to === to);
      if (exists) return;
      state.current.edges.push({ id: `e_${nanoid(6)}`, from, to });
    },
    deleteEdge(state, action: PayloadAction<string>) {
      if (!state.current) return;
      state.current.edges = state.current.edges.filter((e) => e.id !== action.payload);
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchWorkflows.pending, (s) => {
      s.status = "loading";
    });
    b.addCase(fetchWorkflows.fulfilled, (s, a) => {
      s.status = "ready";
      s.items = a.payload;
    });
    b.addCase(fetchWorkflows.rejected, (s, a) => {
      s.status = "error";
      s.error = a.error.message ?? "Failed";
    });
    b.addCase(fetchWorkflow.fulfilled, (s, a) => {
      s.current = hydrate(a.payload);
      s.saveStatus = "idle";
      s.deployStatus = "idle";
    });
    b.addCase(createWorkflowThunk.fulfilled, (s, a) => {
      s.items.unshift(a.payload);
    });
    b.addCase(saveWorkflowThunk.pending, (s) => {
      s.saveStatus = "saving";
    });
    b.addCase(saveWorkflowThunk.fulfilled, (s, a) => {
      s.saveStatus = "saved";
      s.current = hydrate(a.payload);
      const idx = s.items.findIndex((w) => w.id === a.payload.id);
      if (idx >= 0) s.items[idx] = a.payload;
    });
    b.addCase(saveWorkflowThunk.rejected, (s) => {
      s.saveStatus = "error";
    });
    b.addCase(deployWorkflowThunk.pending, (s) => {
      s.deployStatus = "deploying";
    });
    b.addCase(deployWorkflowThunk.fulfilled, (s, a) => {
      s.deployStatus = a.payload.status === "success" ? "success" : "failed";
    });
    b.addCase(deployWorkflowThunk.rejected, (s) => {
      s.deployStatus = "failed";
    });
    b.addCase(rollbackWorkflowThunk.fulfilled, (s, a) => {
      s.current = hydrate(a.payload);
    });
  },
});

export const {
  clearCurrent,
  addNode,
  moveNode,
  updateNodeProperties,
  updateNodeLabel,
  deleteNode,
  addEdge,
  deleteEdge,
} = slice.actions;
export default slice.reducer;
