import { createFileRoute, redirect } from "@tanstack/react-router";
import { store } from "@/store";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: () => {
    const { token } = store.getState().auth;
    throw redirect({ to: token ? "/dashboard" : "/login" });
  },
  component: () => null,
});
