import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Topbar } from "@/components/Topbar";
import { PrecificacaoTab } from "@/components/tabs/PrecificacaoTab";
import { VisitasTab } from "@/components/tabs/VisitasTab";
import { HistoricoTab } from "@/components/tabs/HistoricoTab";
import { CurvaAbcTab } from "@/components/tabs/CurvaAbcTab";
import { AnaliseTab } from "@/components/tabs/AnaliseTab";
import { PromocoesTab } from "@/components/tabs/PromocoesTab";
import { ConfiguracoesTab } from "@/components/tabs/ConfiguracoesTab";

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
        <Tabs defaultValue="precificacao" className="space-y-5">
          <TabsList className="bg-card border h-auto p-1 flex-wrap justify-start gap-0.5">
            {TABS.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-sm"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="precificacao"><PrecificacaoTab /></TabsContent>
          <TabsContent value="visitas"><VisitasTab /></TabsContent>
          <TabsContent value="historico"><HistoricoTab /></TabsContent>
          <TabsContent value="abc"><CurvaAbcTab /></TabsContent>
          <TabsContent value="analise"><AnaliseTab /></TabsContent>
          <TabsContent value="promocoes"><PromocoesTab /></TabsContent>
          <TabsContent value="config"><ConfiguracoesTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
