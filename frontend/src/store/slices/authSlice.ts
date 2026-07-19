import { createSlice, createAsyncThunk, type PayloadAction } from "@reduxjs/toolkit";
import { apiService } from "@/services/api";

export interface User {
  id: string;
  email: string;
  name: string;
  role: "admin" | "operator" | "viewer";
  avatar?: string;
}

interface AuthState {
  user: User | null;
  token: string | null;
  status: "idle" | "loading" | "authenticated" | "error";
  error: string | null;
  mustChangePassword: boolean;
}

const persisted =
  typeof window !== "undefined" ? window.localStorage.getItem("pf_auth") : null;
const parsed = persisted ? JSON.parse(persisted) : null;

const initialState: AuthState = {
  user: parsed?.user ?? null,
  token: parsed?.token ?? null,
  status: parsed?.token ? "authenticated" : "idle",
  error: null,
  mustChangePassword: Boolean(parsed?.mustChangePassword),
};

export const login = createAsyncThunk(
  "auth/login",
  async (creds: { email: string; password: string }, { rejectWithValue }) => {
    try {
      return await apiService.login(creds.email, creds.password);
    } catch (e) {
      return rejectWithValue((e as Error).message);
    }
  },
);

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    logout(state) {
      state.user = null;
      state.token = null;
      state.status = "idle";
      state.error = null;
      state.mustChangePassword = false;
      if (typeof window !== "undefined") window.localStorage.removeItem("pf_auth");
    },
    hydrateAuth(state, action: PayloadAction<{ user: User; token: string; mustChangePassword?: boolean }>) {
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.status = "authenticated";
      state.mustChangePassword = Boolean(action.payload.mustChangePassword);
    },
    passwordChanged(state) {
      state.mustChangePassword = false;
      if (typeof window !== "undefined") {
        const persisted = window.localStorage.getItem("pf_auth");
        if (persisted) {
          const parsed = JSON.parse(persisted);
          window.localStorage.setItem("pf_auth", JSON.stringify({ ...parsed, mustChangePassword: false }));
        }
      }
    },
  },
  extraReducers: (b) => {
    b.addCase(login.pending, (s) => {
      s.status = "loading";
      s.error = null;
    });
    b.addCase(login.fulfilled, (s, a) => {
      s.status = "authenticated";
      s.user = a.payload.user;
      s.token = a.payload.token;
      s.mustChangePassword = Boolean((a.payload as { mustChangePassword?: boolean }).mustChangePassword);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("pf_auth", JSON.stringify(a.payload));
      }
    });
    b.addCase(login.rejected, (s, a) => {
      s.status = "error";
      s.error = (a.payload as string) ?? "Login failed";
    });
  },
});

export const { logout, hydrateAuth, passwordChanged } = authSlice.actions;
export default authSlice.reducer;
