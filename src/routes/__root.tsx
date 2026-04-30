import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/contexts/AuthContext";
import { CredentialsProvider } from "@/contexts/CredentialsContext";
import { ProductsProvider } from "@/contexts/ProductsContext";
import { AnalyticsProvider } from "@/contexts/AnalyticsContext";
import { PromocoesProvider } from "@/contexts/PromocoesContext";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "PRECIFIQ" },
      { name: "description", content: "Precificação inteligente em todos os marketplaces" },
      { name: "author", content: "MegaLabs" },
      { property: "og:title", content: "PRECIFIQ" },
      { property: "og:description", content: "Precificação inteligente em todos os marketplaces" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "PRECIFIQ" },
      { name: "twitter:description", content: "Precificação inteligente em todos os marketplaces" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/efa945e6-4dad-4c92-ad5d-e9cf5e0e147b/id-preview-4f4e233a--8b08e896-4995-4523-b394-54f5d10d4060.lovable.app-1777207769529.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/efa945e6-4dad-4c92-ad5d-e9cf5e0e147b/id-preview-4f4e233a--8b08e896-4995-4523-b394-54f5d10d4060.lovable.app-1777207769529.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <CredentialsProvider>
        <ProductsProvider>
          <AnalyticsProvider>
            <PromocoesProvider>
              <Outlet />
              <Toaster />
            </PromocoesProvider>
          </AnalyticsProvider>
        </ProductsProvider>
      </CredentialsProvider>
    </AuthProvider>
  );
}
