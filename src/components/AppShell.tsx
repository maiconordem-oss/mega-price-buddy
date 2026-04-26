import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Topbar } from "@/components/Topbar";
import { PrecificacaoTab } from "@/components/tabs/PrecificacaoTab";
import { ConfiguracoesTab } from "@/components/tabs/ConfiguracoesTab";
import { PlaceholderTab } from "@/components/tabs/PlaceholderTab";

const TABS = [
  { id: "precificacao", label: "Precificação" },
  { id: "visitas", label: "Visitas & Vendas" },
  { id: "historico", label: "Histórico" },
  { id: "abc", label: "Curva ABC" },
  { id: "analise", label: "Análise" },
  { id: "promocoes", label: "Promoções" },
  { id: "config", label: "Configurações" },
];

export function AppShell() {
  return (
    <div className="min-h-screen bg-background">
      <Topbar />
      <main className="px-4 lg:px-6 py-6 max-w-[1600px] mx-auto">
        <Tabs defaultValue="precificacao" className="space-y-6">
          <TabsList className="bg-card border h-auto p-1 flex-wrap justify-start">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="precificacao"><PrecificacaoTab /></TabsContent>
          <TabsContent value="config"><ConfiguracoesTab /></TabsContent>
          {TABS.filter((t) => !["precificacao", "config"].includes(t.id)).map((t) => (
            <TabsContent key={t.id} value={t.id}>
              <PlaceholderTab name={t.label} />
            </TabsContent>
          ))}
        </Tabs>
      </main>
    </div>
  );
}
