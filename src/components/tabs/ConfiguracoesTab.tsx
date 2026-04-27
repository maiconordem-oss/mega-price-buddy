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
import { ExternalLink, Loader2, ShoppingBag, LogOut, AlertTriangle } from "lucide-react";

export function ConfiguracoesTab() {
  const { credentials, updateCredential, setConnected } = useCredentials();
  const { mlConnected, connectML, disconnectML, mlUser, currentShop, shops, setCurrentShop } = useAuth();
  const [testing, setTesting] = useState<Channel | null>(null);

  const mlClientId = import.meta.env.VITE_ML_CLIENT_ID || "";

  const handleTest = async (channel: Channel) => {
    setTesting(channel);
    await new Promise((r) => setTimeout(r, 800));
    setConnected(channel, true);
    setTesting(null);
    toast.success(`${CHANNELS.find((c) => c.id === channel)?.name} conectado`);
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
              {mlUser && <div className="text-sm text-muted-foreground">@{mlUser.nickname} · ID: {mlUser.id}</div>}
            </div>
            {shops.length > 1 && (
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={currentShop.id}
                onChange={(e) => {
                  const s = shops.find((x) => x.id === e.target.value);
                  if (s) setCurrentShop(s);
                }}
              >
                {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <Badge className={mlConnected ? "bg-green-500/15 text-green-700 border-0" : "bg-muted text-muted-foreground border-0"}>
              {mlConnected ? "● ML Conectado" : "● ML Desconectado"}
            </Badge>
          </CardContent>
        </Card>
      )}

      {/* Alerta se client_id não configurado */}
      {!mlClientId && (
        <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-300 rounded-lg p-4 text-sm">
          <AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-yellow-800">VITE_ML_CLIENT_ID não configurado</div>
            <div className="text-yellow-700 mt-1">
              Siga o guia abaixo para criar o app ML e adicionar o Client ID no arquivo <code className="bg-yellow-100 px-1 rounded">.env</code>.
            </div>
          </div>
        </div>
      )}

      {/* Guia de criação do app ML */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="text-lg">🟡</span> Como criar o App no Mercado Livre
          </CardTitle>
          <CardDescription>Siga os passos para gerar o Client ID da nova aplicação</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Step n={1} title="Acesse o portal de desenvolvedores">
            <a href="https://developers.mercadolivre.com.br/pt_br/api-docs-en" target="_blank" rel="noreferrer"
              className="text-blue-600 hover:underline flex items-center gap-1">
              developers.mercadolivre.com.br <ExternalLink className="h-3 w-3" />
            </a>
            {" "}→ clique em <strong>"Criar app"</strong>
          </Step>

          <Step n={2} title="Preencha os dados do app">
            <ul className="list-disc pl-4 space-y-1 text-muted-foreground mt-1">
              <li>Nome: <strong>MegaLabs Precificação</strong> (ou qualquer nome)</li>
              <li>Descrição: sistema interno de precificação</li>
              <li>Modelo de negócio: <strong>Marketplace</strong></li>
            </ul>
          </Step>

          <Step n={3} title="Configure o Redirect URI">
            <div className="mt-1">
              <div className="text-muted-foreground mb-1">Cole exatamente esta URL no campo <strong>"URI de redirecionamento OAuth"</strong>:</div>
              <div className="bg-gray-100 border rounded px-3 py-2 font-mono text-xs break-all select-all">
                {typeof window !== "undefined" ? window.location.origin : "https://SEU-DOMINIO.com"}/auth/callback
              </div>
            </div>
          </Step>

          <Step n={4} title="Ative os escopos necessários">
            <ul className="list-disc pl-4 space-y-1 text-muted-foreground mt-1">
              <li>✅ <strong>offline_access</strong> — para refresh token</li>
              <li>✅ <strong>read_orders</strong> — para visitas e vendas</li>
              <li>✅ <strong>write_items</strong> — para atualizar preços</li>
              <li>✅ <strong>read_items</strong> — para listar anúncios</li>
              <li>✅ <strong>seller_promotions</strong> — para promoções</li>
            </ul>
          </Step>

          <Step n={5} title="Copie o Client ID e configure no projeto">
            <div className="text-muted-foreground mt-1">
              Após salvar, copie o <strong>App ID (Client ID)</strong> e adicione no arquivo <code className="bg-gray-100 px-1 rounded">.env</code>:
            </div>
            <div className="bg-gray-900 text-green-400 font-mono text-xs rounded-lg p-3 mt-2">
              VITE_ML_CLIENT_ID=<span className="text-yellow-300">SEU_CLIENT_ID_AQUI</span>
            </div>
            <div className="text-muted-foreground mt-2 text-xs">
              Depois execute <code className="bg-gray-100 px-1 rounded">bun run dev</code> (desenvolvimento) ou faça o deploy novamente.
            </div>
          </Step>

          <Step n={6} title="Configure o token.php">
            <div className="text-muted-foreground mt-1">
              No servidor <code>megalabs.shop/token.php</code>, certifique-se que o novo <strong>App ID</strong> e <strong>Client Secret</strong> estão configurados.
              O endpoint <code>action: "exchange"</code> precisa usar as credenciais do novo app.
            </div>
          </Step>

          {mlClientId && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-800">
              ✅ <strong>Client ID configurado:</strong> <code className="font-mono text-sm">{mlClientId}</code>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cards de canal */}
      <div className="grid gap-5 md:grid-cols-2">
        {CHANNELS.map((c) => {
          const connected = c.id === "ml" ? mlConnected : credentials[c.id].connected;
          return (
            <Card key={c.id} className={connected ? "border-green-300/50" : ""}>
              <CardHeader className="flex-row items-start justify-between space-y-0 pb-4">
                <div>
                  <CardTitle className="text-base">{c.name}</CardTitle>
                  <CardDescription>
                    {c.id === "ml" ? "OAuth 2.0 PKCE — fluxo seguro" : "Credenciais de API"}
                  </CardDescription>
                </div>
                <Badge className={connected ? "bg-green-500/15 text-green-700 border-0" : "bg-muted text-muted-foreground border-0"}>
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
                        Clique em <strong>Conectar com ML</strong> para autorizar o acesso à sua conta.
                        Você será redirecionado para o Mercado Livre e voltará automaticamente.
                      </p>
                    )}
                    <Button
                      className="w-full bg-[#2D3277] text-[#FFE600] hover:bg-[#1e2456]"
                      onClick={connectML}
                      disabled={!mlClientId}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      {mlConnected ? "Reconectar ML" : "Conectar com Mercado Livre"}
                    </Button>
                    {mlConnected && (
                      <Button variant="outline" className="w-full text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => { if (confirm("Desconectar o Mercado Livre?")) disconnectML(); }}>
                        <LogOut className="h-4 w-4 mr-2" /> Desconectar ML
                      </Button>
                    )}
                    {!mlClientId && (
                      <p className="text-xs text-muted-foreground text-center">
                        Configure o VITE_ML_CLIENT_ID seguindo o guia acima
                      </p>
                    )}
                  </>
                )}

                {c.id === "shopee" && (
                  <>
                    <Field label="Partner ID" value={credentials.shopee.partnerId} onChange={(v) => updateCredential("shopee", { partnerId: v })} />
                    <Field label="Partner Key" type="password" value={credentials.shopee.partnerKey} onChange={(v) => updateCredential("shopee", { partnerKey: v })} />
                    <Field label="Shop ID" value={credentials.shopee.shopId} onChange={(v) => updateCredential("shopee", { shopId: v })} />
                  </>
                )}
                {c.id === "amazon" && (
                  <>
                    <Field label="Seller ID" value={credentials.amazon.sellerId} onChange={(v) => updateCredential("amazon", { sellerId: v })} />
                    <Field label="Auth Token" type="password" value={credentials.amazon.authToken} onChange={(v) => updateCredential("amazon", { authToken: v })} />
                    <Field label="Marketplace ID" value={credentials.amazon.marketplaceId} onChange={(v) => updateCredential("amazon", { marketplaceId: v })} />
                  </>
                )}
                {c.id === "magalu" && (
                  <>
                    <Field label="Client ID" value={credentials.magalu.clientId} onChange={(v) => updateCredential("magalu", { clientId: v })} />
                    <Field label="Client Secret" type="password" value={credentials.magalu.clientSecret} onChange={(v) => updateCredential("magalu", { clientSecret: v })} />
                  </>
                )}
                {c.id === "tiktok" && (
                  <>
                    <Field label="App Key" value={credentials.tiktok.appKey} onChange={(v) => updateCredential("tiktok", { appKey: v })} />
                    <Field label="App Secret" type="password" value={credentials.tiktok.appSecret} onChange={(v) => updateCredential("tiktok", { appSecret: v })} />
                    <Field label="Shop ID" value={credentials.tiktok.shopId} onChange={(v) => updateCredential("tiktok", { shopId: v })} />
                  </>
                )}

                {c.id !== "ml" && (
                  <Button variant={connected ? "outline" : "secondary"} className="w-full"
                    onClick={() => handleTest(c.id)} disabled={testing === c.id}>
                    {testing === c.id ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Testando...</> : connected ? "✓ Reconectar" : "Testar Conexão"}
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

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="h-6 w-6 rounded-full bg-[#2D3277] text-[#FFE600] flex items-center justify-center text-xs font-black shrink-0 mt-0.5">
        {n}
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-muted-foreground mt-0.5">{children}</div>
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
