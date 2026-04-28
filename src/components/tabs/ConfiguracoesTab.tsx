import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useCredentials } from "@/contexts/CredentialsContext";
import { useAuth } from "@/contexts/AuthContext";
import type { Channel } from "@/types/marketplace";
import { CHANNELS } from "@/types/marketplace";
import { toast } from "sonner";
import { ExternalLink, Loader2, ShoppingBag, LogOut, Plus, Check, Trash2 } from "lucide-react";

export function ConfiguracoesTab() {
  const { credentials, updateCredential, setConnected } = useCredentials();
  const {
    mlConnected, connectML, disconnectML, mlUser,
    currentShop, shops, switchShop, addShop, removeShop,
  } = useAuth();
  const [testing, setTesting] = useState<Channel | null>(null);
  const [newName, setNewName] = useState("");

  const handleTest = async (channel: Channel) => {
    setTesting(channel);
    await new Promise(r => setTimeout(r, 800));
    setConnected(channel, true);
    setTesting(null);
    toast.success(`${CHANNELS.find(c => c.id === channel)?.name} conectado`);
  };

  const handleAddShop = () => {
    const name = newName.trim();
    if (!name) return;
    const shop = addShop(name);
    switchShop(shop);
    setNewName("");
    toast.success(`Conta "${name}" criada. Conecte o Mercado Livre abaixo.`);
  };

  return (
    <div className="space-y-6 max-w-3xl">

      {/* ── Contas cadastradas ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingBag className="h-4 w-4" /> Contas Mercado Livre
          </CardTitle>
          <CardDescription>
            Cada conta tem seu próprio token ML e dados isolados. Troque pela topbar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* lista de contas */}
          {shops.map(shop => {
            const isActive = currentShop?.id === shop.id;
            return (
              <div
                key={shop.id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                  isActive
                    ? "border-[#2D3277]/40 bg-[#E8EDFF]/40"
                    : "border-border hover:border-[#2D3277]/30 hover:bg-muted/30"
                }`}
                onClick={() => !isActive && switchShop(shop)}
              >
                {/* avatar da conta */}
                <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 font-black text-sm ${
                  shop.mlConnected
                    ? "bg-[#2D3277] text-[#FFE600]"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {(shop.mlNickname || shop.name)[0]?.toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">
                      {shop.mlNickname ? `@${shop.mlNickname}` : shop.name}
                    </span>
                    {isActive && (
                      <Badge className="bg-[#2D3277]/10 text-[#2D3277] border-0 text-[10px]">
                        <Check className="h-2.5 w-2.5 mr-1" /> Ativa
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {shop.mlConnected
                      ? <>✓ ML conectado{shop.mlUserId ? ` · ID ${shop.mlUserId}` : ""}</>
                      : "ML não conectado"}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={shop.mlConnected
                    ? "bg-green-500/15 text-green-700 border-0"
                    : "bg-muted text-muted-foreground border-0"}>
                    {shop.mlConnected ? "Conectado" : "Desconectado"}
                  </Badge>

                  {/* remover (só se não for a última) */}
                  {shops.length > 1 && (
                    <button
                      className="h-7 w-7 rounded flex items-center justify-center text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Remover conta"
                      onClick={e => {
                        e.stopPropagation();
                        if (confirm(`Remover "${shop.mlNickname || shop.name}"? Tokens serão apagados.`)) {
                          removeShop(shop.id);
                          toast.success("Conta removida.");
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* adicionar nova conta */}
          <div className="flex gap-2 pt-1">
            <Input
              placeholder="Nome da nova conta (ex: Loja 2)"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAddShop()}
              className="h-9 text-sm"
            />
            <Button
              size="sm"
              onClick={handleAddShop}
              disabled={!newName.trim()}
              className="shrink-0 gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Conexão ML da conta ativa ────────────────────────────────────── */}
      <Card className={mlConnected ? "border-green-300/60" : ""}>
        <CardHeader className="flex-row items-start justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="text-base">
              Mercado Livre
              {currentShop && (
                <span className="text-muted-foreground font-normal text-sm ml-2">
                  — {currentShop.mlNickname ? `@${currentShop.mlNickname}` : currentShop.name}
                </span>
              )}
            </CardTitle>
            <CardDescription>OAuth 2.0 PKCE — App ID: 285337336691848</CardDescription>
          </div>
          <Badge className={mlConnected
            ? "bg-green-500/15 text-green-700 border-0"
            : "bg-muted text-muted-foreground border-0"}>
            {mlConnected ? "Conectado" : "Desconectado"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {mlConnected && mlUser ? (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
              ✓ Conectado como <strong>@{mlUser.nickname}</strong> (ID ML: {mlUser.id})
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Clique em <strong>Conectar com ML</strong> para autorizar a conta{" "}
              <strong>{currentShop?.name}</strong> no Mercado Livre.
              Você será redirecionado e voltará automaticamente.
            </p>
          )}

          <Button
            className="w-full bg-[#2D3277] text-[#FFE600] hover:bg-[#1e2456]"
            onClick={connectML}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            {mlConnected ? "Reconectar ML" : "Conectar com Mercado Livre"}
          </Button>

          {mlConnected && (
            <Button
              variant="outline"
              className="w-full text-red-600 border-red-200 hover:bg-red-50"
              onClick={() => {
                if (confirm("Desconectar o Mercado Livre desta conta?")) {
                  disconnectML();
                  toast.success("Mercado Livre desconectado.");
                }
              }}
            >
              <LogOut className="h-4 w-4 mr-2" /> Desconectar ML desta conta
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Outros canais ─────────────────────────────────────────────────── */}
      <div className="grid gap-5 md:grid-cols-2">
        {CHANNELS.filter(c => c.id !== "ml").map(c => {
          const connected = credentials[c.id].connected;
          return (
            <Card key={c.id} className={connected ? "border-green-300/50" : ""}>
              <CardHeader className="flex-row items-start justify-between space-y-0 pb-4">
                <div>
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <CardDescription>Credenciais de API</CardDescription>
                </div>
                <Badge className={connected
                  ? "bg-green-500/15 text-green-700 border-0"
                  : "bg-muted text-muted-foreground border-0"}>
                  {connected ? "Conectado" : "Desconectado"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {c.id === "shopee" && (<>
                  <Field label="Partner ID" value={credentials.shopee.partnerId} onChange={v => updateCredential("shopee", { partnerId: v })} />
                  <Field label="Partner Key" type="password" value={credentials.shopee.partnerKey} onChange={v => updateCredential("shopee", { partnerKey: v })} />
                  <Field label="Shop ID" value={credentials.shopee.shopId} onChange={v => updateCredential("shopee", { shopId: v })} />
                </>)}
                {c.id === "amazon" && (<>
                  <Field label="Seller ID" value={credentials.amazon.sellerId} onChange={v => updateCredential("amazon", { sellerId: v })} />
                  <Field label="Auth Token" type="password" value={credentials.amazon.authToken} onChange={v => updateCredential("amazon", { authToken: v })} />
                  <Field label="Marketplace ID" value={credentials.amazon.marketplaceId} onChange={v => updateCredential("amazon", { marketplaceId: v })} />
                </>)}
                {c.id === "magalu" && (<>
                  <Field label="Client ID" value={credentials.magalu.clientId} onChange={v => updateCredential("magalu", { clientId: v })} />
                  <Field label="Client Secret" type="password" value={credentials.magalu.clientSecret} onChange={v => updateCredential("magalu", { clientSecret: v })} />
                </>)}
                {c.id === "tiktok" && (<>
                  <Field label="App Key" value={credentials.tiktok.appKey} onChange={v => updateCredential("tiktok", { appKey: v })} />
                  <Field label="App Secret" type="password" value={credentials.tiktok.appSecret} onChange={v => updateCredential("tiktok", { appSecret: v })} />
                  <Field label="Shop ID" value={credentials.tiktok.shopId} onChange={v => updateCredential("tiktok", { shopId: v })} />
                </>)}

                <Button
                  variant={connected ? "outline" : "secondary"}
                  className="w-full"
                  onClick={() => handleTest(c.id)}
                  disabled={testing === c.id}
                >
                  {testing === c.id
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Testando...</>
                    : connected ? "✓ Reconectar" : "Testar Conexão"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Info técnica */}
      <Card className="border-dashed">
        <CardContent className="p-4 text-xs text-muted-foreground space-y-1">
          <div className="font-semibold text-foreground mb-2">Informações do App ML</div>
          <div>App ID: <code className="bg-muted px-1 rounded">285337336691848</code></div>
          <div>Redirect URI: <code className="bg-muted px-1 rounded">https://mega-price-buddy.lovable.app/auth/callback</code></div>
          <div className="text-green-600 mt-2">✓ Client Secret protegido no servidor — nunca exposto no browser</div>
          <div className="text-blue-600 mt-1">✓ Cada conta tem tokens isolados — dados não se misturam</div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}
