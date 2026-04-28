import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CHANNELS } from "@/types/marketplace";
import { useCredentials } from "@/contexts/CredentialsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProducts } from "@/contexts/ProductsContext";
import { useNavigate } from "@tanstack/react-router";
import { RefreshCw, LogOut, ChevronDown, Plus, Check, Store, Loader2, Trash2 } from "lucide-react";

export function Topbar() {
  const { credentials } = useCredentials();
  const { user, mlUser, shops, currentShop, switchShop, addShop, removeShop, logout, mlConnected } = useAuth();
  const { loadMLProducts, loadingProducts } = useProducts();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [addingName, setAddingName] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // fechar ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowAdd(false);
        setAddingName("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleAddShop = () => {
    const name = addingName.trim();
    if (!name) return;
    const newShop = addShop(name);
    switchShop(newShop);
    setShowAdd(false);
    setAddingName("");
    setOpen(false);
  };

  const displayName = mlUser?.nickname || currentShop?.mlNickname || currentShop?.name || user || "U";
  const shopLabel   = currentShop
    ? (currentShop.mlNickname ? `@${currentShop.mlNickname}` : currentShop.name)
    : "Conta";

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

        {/* ── Shop selector dropdown ── */}
        <div className="relative" ref={dropRef}>
          <button
            onClick={() => { setOpen(o => !o); setShowAdd(false); setAddingName(""); }}
            className="flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary-foreground/10 hover:bg-primary-foreground/20 border border-primary-foreground/20 text-primary-foreground text-sm font-medium transition-colors"
          >
            <Store className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[130px] truncate">{shopLabel}</span>
            {mlConnected && (
              <span className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0" />
            )}
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>

          {open && (
            <div className="absolute left-0 top-full mt-1 w-64 rounded-lg border bg-white shadow-lg z-50 py-1 text-foreground">
              {/* lista de contas */}
              {shops.map(shop => (
                <div
                  key={shop.id}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/60 group ${currentShop?.id === shop.id ? "bg-[#E8EDFF]" : ""}`}
                  onClick={() => { switchShop(shop); setOpen(false); }}
                >
                  {/* ícone da conta */}
                  <div className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-black ${shop.mlConnected ? "bg-[#2D3277] text-[#FFE600]" : "bg-muted text-muted-foreground"}`}>
                    {(shop.mlNickname || shop.name)[0]?.toUpperCase() ?? "C"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {shop.mlNickname ? `@${shop.mlNickname}` : shop.name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {shop.mlConnected
                        ? <span className="text-green-600 font-medium">● ML conectado</span>
                        : <span className="text-muted-foreground">● ML desconectado</span>}
                    </div>
                  </div>
                  {/* check da conta ativa */}
                  {currentShop?.id === shop.id && (
                    <Check className="h-4 w-4 text-[#2D3277] shrink-0" />
                  )}
                  {/* botão remover (só aparece no hover e se não for a única) */}
                  {shops.length > 1 && currentShop?.id !== shop.id && (
                    <button
                      className="opacity-0 group-hover:opacity-100 h-5 w-5 rounded flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 transition-all"
                      onClick={e => {
                        e.stopPropagation();
                        if (confirm(`Remover a conta "${shop.mlNickname || shop.name}"? Os tokens serão apagados.`)) {
                          removeShop(shop.id);
                        }
                      }}
                      title="Remover conta"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}

              <div className="border-t my-1" />

              {/* adicionar nova conta */}
              {showAdd ? (
                <div className="px-3 py-2 flex gap-2">
                  <input
                    autoFocus
                    type="text"
                    placeholder="Nome da conta"
                    value={addingName}
                    onChange={e => setAddingName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleAddShop(); if (e.key === "Escape") { setShowAdd(false); setAddingName(""); } }}
                    className="flex-1 h-7 text-xs border rounded px-2 outline-none focus:border-[#2D3277]"
                  />
                  <button
                    onClick={handleAddShop}
                    disabled={!addingName.trim()}
                    className="h-7 px-2 text-xs rounded bg-[#2D3277] text-[#FFE600] font-bold disabled:opacity-40"
                  >
                    OK
                  </button>
                </div>
              ) : (
                <button
                  onClick={e => { e.stopPropagation(); setShowAdd(true); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  <Plus className="h-4 w-4" />
                  Adicionar conta
                </button>
              )}
            </div>
          )}
        </div>

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
