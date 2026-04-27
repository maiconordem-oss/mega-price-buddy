import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CHANNELS } from "@/types/marketplace";
import { useCredentials } from "@/contexts/CredentialsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProducts } from "@/contexts/ProductsContext";
import { useNavigate } from "@tanstack/react-router";
import { RefreshCw, LogOut, Store, Loader2 } from "lucide-react";

export function Topbar() {
  const { credentials } = useCredentials();
  const { user, mlUser, shops, currentShop, setCurrentShop, logout, mlConnected } = useAuth();
  const { loadMLProducts, loadingProducts } = useProducts();
  const navigate = useNavigate();

  const displayName = mlUser?.nickname || user || "U";

  return (
    <header className="bg-primary text-primary-foreground border-b border-primary/20 sticky top-0 z-50">
      <div className="px-4 lg:px-6 h-16 flex items-center gap-3">
        {/* Logo */}
        <div className="flex items-center gap-2 font-bold text-lg shrink-0">
          <div className="h-9 w-9 rounded-lg bg-yellow-400 text-primary flex items-center justify-center text-sm font-black">
            M
          </div>
          <span className="hidden sm:inline">MegaLabs</span>
        </div>

        {/* Shop selector */}
        {shops.length > 0 && (
          <Select
            value={currentShop?.id || ""}
            onValueChange={(id) => {
              const s = shops.find((x) => x.id === id);
              if (s) setCurrentShop(s);
            }}
          >
            <SelectTrigger className="w-[170px] bg-primary-foreground/10 border-primary-foreground/20 text-primary-foreground h-9">
              <Store className="h-3.5 w-3.5 mr-1.5 shrink-0" />
              <SelectValue placeholder="Loja" />
            </SelectTrigger>
            <SelectContent>
              {shops.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Channel status dots */}
        <div className="hidden lg:flex items-center gap-2 ml-1">
          {CHANNELS.map((c) => {
            const connected = c.id === "ml" ? mlConnected : credentials[c.id].connected;
            return (
              <div
                key={c.id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-foreground/10 text-xs font-medium"
                title={connected ? `${c.name} conectado` : `${c.name} desconectado`}
              >
                <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-400" : "bg-white/30"}`} />
                {c.short}
              </div>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Atualizar produtos ML */}
          <Button
            variant="ghost"
            size="sm"
            className="text-primary-foreground hover:bg-primary-foreground/10 hidden sm:flex"
            onClick={() => loadMLProducts(true)}
            disabled={loadingProducts}
            title="Recarregar produtos do ML"
          >
            {loadingProducts
              ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
              : <RefreshCw className="h-4 w-4 mr-1" />}
            <span className="hidden md:inline">Atualizar</span>
          </Button>

          {/* Avatar + nome */}
          <div className="flex items-center gap-2 px-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-yellow-400 text-primary text-xs font-bold">
                {displayName[0]?.toUpperCase() ?? "U"}
              </AvatarFallback>
            </Avatar>
            <span className="hidden md:inline text-sm font-medium">{displayName}</span>
          </div>

          {/* Sair */}
          <Button
            variant="ghost"
            size="sm"
            className="text-primary-foreground hover:bg-primary-foreground/10"
            onClick={() => { logout(); navigate({ to: "/" }); }}
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline ml-1">Sair</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
