import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useCredentials } from "@/contexts/CredentialsContext";
import type { Channel } from "@/types/marketplace";
import { CHANNELS } from "@/types/marketplace";
import { toast } from "sonner";

export function ConfiguracoesTab() {
  const { credentials, updateCredential, setConnected } = useCredentials();
  const [testing, setTesting] = useState<Channel | null>(null);

  const handleTest = async (channel: Channel) => {
    setTesting(channel);
    await new Promise((r) => setTimeout(r, 700));
    setConnected(channel, true);
    setTesting(null);
    toast.success(`${CHANNELS.find((c) => c.id === channel)?.name} conectado`);
  };

  return (
    <div className="grid gap-5 md:grid-cols-2">
      {CHANNELS.map((c) => {
        const connected = credentials[c.id].connected;
        return (
          <Card key={c.id}>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>{c.name}</CardTitle>
                <CardDescription>Configure suas credenciais</CardDescription>
              </div>
              <Badge
                className={
                  connected
                    ? "bg-success/15 text-success border-0"
                    : "bg-muted text-muted-foreground border-0"
                }
              >
                {connected ? "Conectado" : "Desconectado"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {c.id === "ml" && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleTest("ml")}
                  disabled={testing === "ml"}
                >
                  Conectar via OAuth
                </Button>
              )}

              {c.id === "shopee" && (
                <>
                  <Field
                    label="Partner ID"
                    value={credentials.shopee.partnerId}
                    onChange={(v) => updateCredential("shopee", { partnerId: v })}
                  />
                  <Field
                    label="Partner Key"
                    type="password"
                    value={credentials.shopee.partnerKey}
                    onChange={(v) => updateCredential("shopee", { partnerKey: v })}
                  />
                  <Field
                    label="Shop ID"
                    value={credentials.shopee.shopId}
                    onChange={(v) => updateCredential("shopee", { shopId: v })}
                  />
                </>
              )}

              {c.id === "amazon" && (
                <>
                  <Field
                    label="Seller ID"
                    value={credentials.amazon.sellerId}
                    onChange={(v) => updateCredential("amazon", { sellerId: v })}
                  />
                  <Field
                    label="Auth Token"
                    type="password"
                    value={credentials.amazon.authToken}
                    onChange={(v) => updateCredential("amazon", { authToken: v })}
                  />
                  <Field
                    label="Marketplace ID"
                    value={credentials.amazon.marketplaceId}
                    onChange={(v) => updateCredential("amazon", { marketplaceId: v })}
                  />
                </>
              )}

              {c.id === "magalu" && (
                <>
                  <Field
                    label="Client ID"
                    value={credentials.magalu.clientId}
                    onChange={(v) => updateCredential("magalu", { clientId: v })}
                  />
                  <Field
                    label="Client Secret"
                    type="password"
                    value={credentials.magalu.clientSecret}
                    onChange={(v) => updateCredential("magalu", { clientSecret: v })}
                  />
                </>
              )}

              {c.id === "tiktok" && (
                <>
                  <Field
                    label="App Key"
                    value={credentials.tiktok.appKey}
                    onChange={(v) => updateCredential("tiktok", { appKey: v })}
                  />
                  <Field
                    label="App Secret"
                    type="password"
                    value={credentials.tiktok.appSecret}
                    onChange={(v) => updateCredential("tiktok", { appSecret: v })}
                  />
                  <Field
                    label="Shop ID"
                    value={credentials.tiktok.shopId}
                    onChange={(v) => updateCredential("tiktok", { shopId: v })}
                  />
                </>
              )}

              {c.id !== "ml" && (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => handleTest(c.id)}
                  disabled={testing === c.id}
                >
                  {testing === c.id ? "Testando..." : "Testar Conexão"}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
