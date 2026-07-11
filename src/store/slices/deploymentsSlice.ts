import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { apiService, type Deployment } from "@/services/api";

interface State {
  items: Deployment[];
  status: "idle" | "loading" | "ready" | "error";
}

const initialState: State = { items: [], status: "idle" };

export const fetchDeployments = createAsyncThunk("deployments/fetch", () =>
  apiService.listDeployments(),
);

const slice = createSlice({
  name: "deployments",
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchDeployments.pending, (s) => {
      s.status = "loading";
    });
    b.addCase(fetchDeployments.fulfilled, (s, a) => {
      s.status = "ready";
      s.items = a.payload;
    });
  },
});

export default slice.reducer;
