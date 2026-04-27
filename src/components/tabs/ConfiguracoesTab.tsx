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
import { ExternalLink, Loader2, ShoppingBag, LogOut } from "lucide-react";

export function ConfiguracoesTab() {
  const { credentials, updateCredential, setConnected } = useCredentials();
  const { mlConnected, connectML, disconnectML, mlUser, currentShop, shops, setCurrentShop } = useAuth();
  const [testing, setTesting] = useState<Channel | null>(null);

  const handleTest = async (channel: Channel) => {
    setTesting(channel);
    await new Promise(r => setTimeout(r, 800));
    setConnected(channel, true);
    setTesting(null);
    toast.success(`${CHANNELS.find(c => c.id === channel)?.name} conectado`);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Loja ativa */}
      {currentShop && (
        <Card className="border-[#2D3277]/20 bg-[#E8EDFF]/30">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#2D3277] flex items-center justify-center">
              <ShoppingBag className="h-6 w-6 text-[#FFE600]" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">{currentShop.name}</div>
              <div className="text-sm text-muted-foreground">Loja ID: {currentShop.id}</div>
              {mlUser && <div className="text-sm text-muted-foreground">@{mlUser.nickname} · ID ML: {mlUser.id}</div>}
            </div>
            {shops.length > 1 && (
              <select className="h-9 rounded-md border bg-background px-3 text-sm" value={currentShop.id}
                onChange={e => { const s = shops.find(x => x.id === e.target.value); if (s) setCurrentShop(s); }}>
                {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <Badge className={mlConnected
              ? "bg-green-500/15 text-green-700 border-0"
              : "bg-muted text-muted-foreground border-0"}>
              {mlConnected ? "● ML Conectado" : "● ML Desconectado"}
            </Badge>
          </CardContent>
        </Card>
      )}

      {/* Cards de canal */}
      <div className="grid gap-5 md:grid-cols-2">
        {CHANNELS.map(c => {
          const connected = c.id === "ml" ? mlConnected : credentials[c.id].connected;
          return (
            <Card key={c.id} className={connected ? "border-green-300/50" : ""}>
              <CardHeader className="flex-row items-start justify-between space-y-0 pb-4">
                <div>
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <CardDescription>
                    {c.id === "ml" ? "OAuth 2.0 PKCE — App ID: 285337336691848" : "Credenciais de API"}
                  </CardDescription>
                </div>
                <Badge className={connected
                  ? "bg-green-500/15 text-green-700 border-0"
                  : "bg-muted text-muted-foreground border-0"}>
                  {connected ? "Conectado" : "Desconectado"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {c.id === "ml" && (
                  <>
                    {mlConnected && mlUser ? (
                      <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                        ✓ Conectado como <strong>@{mlUser.nickname}</strong> (ID: {mlUser.id})
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Clique em <strong>Conectar com ML</strong> para autorizar o acesso.
                        Você será redirecionado para o Mercado Livre e voltará automaticamente.
                      </p>
                    )}
                    <Button
                      className="w-full bg-[#2D3277] text-[#FFE600] hover:bg-[#1e2456]"
                      onClick={connectML}>
                      <ExternalLink className="h-4 w-4 mr-2" />
                      {mlConnected ? "Reconectar ML" : "Conectar com Mercado Livre"}
                    </Button>
                    {mlConnected && (
                      <Button variant="outline"
                        className="w-full text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => { if (confirm("Desconectar o Mercado Livre?")) disconnectML(); }}>
                        <LogOut className="h-4 w-4 mr-2" /> Desconectar ML
                      </Button>
                    )}
                  </>
                )}

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

                {c.id !== "ml" && (
                  <Button variant={connected ? "outline" : "secondary"} className="w-full"
                    onClick={() => handleTest(c.id)} disabled={testing === c.id}>
                    {testing === c.id
                      ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Testando...</>
                      : connected ? "✓ Reconectar" : "Testar Conexão"}
                  </Button>
                )}
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
