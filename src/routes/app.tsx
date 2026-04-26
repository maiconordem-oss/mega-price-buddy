import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/contexts/AuthContext";

export const Route = createFileRoute("/app")({
  component: AppPage,
});

function AppPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!user) navigate({ to: "/" });
  }, [user, navigate]);
  if (!user) return null;
  return <AppShell />;
}
