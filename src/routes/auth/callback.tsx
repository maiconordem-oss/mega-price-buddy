import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

export const Route = createFileRoute("/auth/callback")({
  component: CallbackPage,
});

function CallbackPage() {
  const navigate = useNavigate();
  const { handleMLCallback } = useAuth();
  const [status, setStatus] = useState<"processing" | "error">("processing");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const errorParam = params.get("error");

    if (errorParam) {
      setStatus("error");
      setErrorMsg("Autorização negada: " + (params.get("error_description") || errorParam));
      return;
    }
    if (!code) {
      setStatus("error");
      setErrorMsg("Código de autorização não encontrado na URL.");
      return;
    }

    handleMLCallback(code)
      .then(() => navigate({ to: "/app" }))
      .catch((e: Error) => { setStatus("error"); setErrorMsg(e.message); });
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="text-center space-y-4 max-w-sm">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-[#2D3277] flex items-center justify-center">
          <span className="text-[#FFE600] font-black text-xl">ML</span>
        </div>
        {status === "processing" ? (
          <>
            <div className="flex items-center justify-center gap-2">
              <div className="h-5 w-5 border-2 border-[#2D3277] border-t-transparent rounded-full animate-spin" />
              <span className="text-sm font-medium text-muted-foreground">Conectando ao Mercado Livre...</span>
            </div>
            <p className="text-xs text-muted-foreground">Trocando código por token de acesso</p>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-destructive">Erro ao conectar</h2>
            <p className="text-sm text-muted-foreground bg-red-50 border border-red-200 rounded-lg p-3">{errorMsg}</p>
            <button onClick={() => window.location.href = "/app"} className="text-sm text-[#2D3277] hover:underline">
              Voltar ao app →
            </button>
          </>
        )}
      </div>
    </div>
  );
}
