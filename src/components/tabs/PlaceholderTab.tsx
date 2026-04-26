import { Card, CardContent } from "@/components/ui/card";
import { Construction } from "lucide-react";

export function PlaceholderTab({ name }: { name: string }) {
  return (
    <Card>
      <CardContent className="p-12 flex flex-col items-center justify-center text-center gap-3">
        <div className="h-14 w-14 rounded-2xl bg-accent/30 text-primary flex items-center justify-center">
          <Construction className="h-7 w-7" />
        </div>
        <h3 className="text-lg font-semibold">{name}</h3>
        <p className="text-sm text-muted-foreground">Em desenvolvimento</p>
      </CardContent>
    </Card>
  );
}
