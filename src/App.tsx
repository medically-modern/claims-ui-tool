// app entry
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Claims from "./pages/Claims.tsx";
import ClaimDetail from "./pages/ClaimDetail.tsx";
import ReplayEra from "./pages/ReplayEra.tsx";
import { ThreadClaimsProvider } from "@/lib/claims/threadStore";
import { BuildBadge } from "@/components/BuildBadge";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <ThreadClaimsProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/claims" element={<Claims />} />
            <Route path="/claims/:claimId" element={<ClaimDetail />} />
            <Route path="/replay-era" element={<ReplayEra />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          <BuildBadge />
        </ThreadClaimsProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
