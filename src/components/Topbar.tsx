import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CHANNELS } from "@/types/marketplace";
import { useCredentials } from "@/contexts/CredentialsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "@tanstack/react-router";
import { Search, RefreshCw, FileDown, LogOut } from "lucide-react";

export function Topbar() {
  const { credentials } = useCredentials();
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="bg-primary text-primary-foreground border-b border-primary/20">
      <div className="px-4 lg:px-6 h-16 flex items-center gap-4">
        <div className="flex items-center gap-2 font-bold text-lg">
          <div className="h-9 w-9 rounded-lg bg-accent text-accent-foreground flex items-center justify-center text-sm">
            ML
          </div>
          <span className="hidden sm:inline">MegaLabs</span>
        </div>

        <Select defaultValue="loja-1">
          <SelectTrigger className="w-[180px] bg-primary-foreground/10 border-primary-foreground/20 text-primary-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="loja-1">Loja Principal</SelectItem>
            <SelectItem value="loja-2">Loja Secundária</SelectItem>
          </SelectContent>
        </Select>

        <div className="hidden md:flex items-center gap-2 ml-2">
          {CHANNELS.map((c) => {
            const connected = credentials[c.id].connected;
            return (
              <div
                key={c.id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-foreground/10 text-xs font-medium"
              >
                <span
                  className={`h-2 w-2 rounded-full ${connected ? "bg-success" : "bg-muted-foreground/60"}`}
                />
                {c.short}
              </div>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-primary-foreground/10">
            <Search className="h-4 w-4 mr-1" /> Buscar
          </Button>
          <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-primary-foreground/10">
            <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
          </Button>
          <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-primary-foreground/10">
            <FileDown className="h-4 w-4 mr-1" /> CSV
          </Button>
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-accent text-accent-foreground text-xs font-bold">
              {user?.[0]?.toUpperCase() ?? "U"}
            </AvatarFallback>
          </Avatar>
          <Button
            variant="ghost"
            size="sm"
            className="text-primary-foreground hover:bg-primary-foreground/10"
            onClick={() => {
              logout();
              navigate({ to: "/" });
            }}
          >
            <LogOut className="h-4 w-4 mr-1" /> Sair
          </Button>
        </div>
      </div>
    </header>
  );
}
