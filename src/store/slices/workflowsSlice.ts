import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiService, type Workflow } from "@/services/api";

interface WorkflowsState {
  items: Workflow[];
  current: Workflow | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
}

const initialState: WorkflowsState = {
  items: [],
  current: null,
  status: "idle",
  error: null,
};

export const fetchWorkflows = createAsyncThunk("workflows/fetchAll", () =>
  apiService.listWorkflows(),
);

export const fetchWorkflow = createAsyncThunk("workflows/fetchOne", (id: string) =>
  apiService.getWorkflow(id),
);

const slice = createSlice({
  name: "workflows",
  initialState,
  reducers: {
    clearCurrent(state) {
      state.current = null;
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
      s.current = a.payload;
    });
  },
});

export const { clearCurrent } = slice.actions;
export default slice.reducer;
