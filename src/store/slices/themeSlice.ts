import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type Theme = "dark" | "light";

const getInitial = (): Theme => {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem("pf_theme") as Theme | null;
  if (stored) return stored;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
};

const themeSlice = createSlice({
  name: "theme",
  initialState: { mode: getInitial() as Theme },
  reducers: {
    setTheme(state, action: PayloadAction<Theme>) {
      state.mode = action.payload;
      if (typeof window !== "undefined")
        window.localStorage.setItem("pf_theme", action.payload);
    },
    toggleTheme(state) {
      state.mode = state.mode === "dark" ? "light" : "dark";
      if (typeof window !== "undefined")
        window.localStorage.setItem("pf_theme", state.mode);
    },
  },
});

export const { setTheme, toggleTheme } = themeSlice.actions;
export default themeSlice.reducer;
