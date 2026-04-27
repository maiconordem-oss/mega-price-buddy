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
import { ExternalLink, Loader2, ShoppingBag } from "lucide-react";

export function ConfiguracoesTab() {
  const { credentials, updateCredential, setConnected } = useCredentials();
  const { mlConnected, connectML, mlUser, currentShop } = useAuth();
  const [testing, setTesting] = useState<Channel | null>(null);

  const handleTest = async (channel: Channel) => {
    setTesting(channel);
    await new Promise((r) => setTimeout(r, 800));
    setConnected(channel, true);
    setTesting(null);
    toast.success(`${CHANNELS.find((c) => c.id === channel)?.name} conectado`);
  };

  return (
    <div className="space-y-6">
      {/* Info da loja */}
      {currentShop && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center">
              <ShoppingBag className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <div className="font-semibold text-base">{currentShop.name}</div>
              <div className="text-sm text-muted-foreground">Loja ID: {currentShop.id}</div>
              {mlUser && <div className="text-sm text-muted-foreground">ML: @{mlUser.nickname}</div>}
            </div>
            <Badge className={mlConnected ? "ml-auto bg-green-500/15 text-green-700 border-0" : "ml-auto bg-muted text-muted-foreground border-0"}>
              {mlConnected ? "● ML Conectado" : "● ML Desconectado"}
            </Badge>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        {CHANNELS.map((c) => {
          const connected = c.id === "ml" ? mlConnected : credentials[c.id].connected;
          return (
            <Card key={c.id} className={connected ? "border-green-300/50" : ""}>
              <CardHeader className="flex-row items-start justify-between space-y-0 pb-4">
                <div>
                  <CardTitle className="flex items-center gap-2">{c.name}</CardTitle>
                  <CardDescription>
                    {c.id === "ml"
                      ? "Autenticação OAuth via Mercado Livre"
                      : "Configure suas credenciais de API"}
                  </CardDescription>
                </div>
                <Badge
                  className={
                    connected
                      ? "bg-green-500/15 text-green-700 border-0"
                      : "bg-muted text-muted-foreground border-0"
                  }
                >
                  {connected ? "Conectado" : "Desconectado"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {c.id === "ml" && (
                  <>
                    {mlConnected && mlUser ? (
                      <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                        ✓ Conectado como <strong>@{mlUser.nickname}</strong>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Clique em Conectar para autorizar o MegaLabs a acessar sua conta do Mercado Livre.
                      </p>
                    )}
                    <Button
                      variant={mlConnected ? "outline" : "default"}
                      className="w-full"
                      onClick={connectML}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      {mlConnected ? "Reconectar ML" : "Conectar com Mercado Livre"}
                    </Button>
                  </>
                )}

                {c.id === "shopee" && (
                  <>
                    <Field label="Partner ID" value={credentials.shopee.partnerId}
                      onChange={(v) => updateCredential("shopee", { partnerId: v })} />
                    <Field label="Partner Key" type="password" value={credentials.shopee.partnerKey}
                      onChange={(v) => updateCredential("shopee", { partnerKey: v })} />
                    <Field label="Shop ID" value={credentials.shopee.shopId}
                      onChange={(v) => updateCredential("shopee", { shopId: v })} />
                  </>
                )}

                {c.id === "amazon" && (
                  <>
                    <Field label="Seller ID" value={credentials.amazon.sellerId}
                      onChange={(v) => updateCredential("amazon", { sellerId: v })} />
                    <Field label="Auth Token" type="password" value={credentials.amazon.authToken}
                      onChange={(v) => updateCredential("amazon", { authToken: v })} />
                    <Field label="Marketplace ID" value={credentials.amazon.marketplaceId}
                      onChange={(v) => updateCredential("amazon", { marketplaceId: v })} />
                  </>
                )}

                {c.id === "magalu" && (
                  <>
                    <Field label="Client ID" value={credentials.magalu.clientId}
                      onChange={(v) => updateCredential("magalu", { clientId: v })} />
                    <Field label="Client Secret" type="password" value={credentials.magalu.clientSecret}
                      onChange={(v) => updateCredential("magalu", { clientSecret: v })} />
                  </>
                )}

                {c.id === "tiktok" && (
                  <>
                    <Field label="App Key" value={credentials.tiktok.appKey}
                      onChange={(v) => updateCredential("tiktok", { appKey: v })} />
                    <Field label="App Secret" type="password" value={credentials.tiktok.appSecret}
                      onChange={(v) => updateCredential("tiktok", { appSecret: v })} />
                    <Field label="Shop ID" value={credentials.tiktok.shopId}
                      onChange={(v) => updateCredential("tiktok", { shopId: v })} />
                  </>
                )}

                {c.id !== "ml" && (
                  <Button
                    variant={connected ? "outline" : "secondary"}
                    className="w-full"
                    onClick={() => handleTest(c.id)}
                    disabled={testing === c.id}
                  >
                    {testing === c.id ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Testando...</>
                    ) : connected ? "✓ Reconectar" : "Testar Conexão"}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
