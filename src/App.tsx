import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import IndexPage from "./Index";
import NotFound from "./pages/NotFound";
import { storage } from "./utils/storage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        {process.env.NODE_ENV === "development" && (
          <button
            onClick={() => {
              if (
                window.confirm(
                  "Are you sure you want to clear all local data and reset the application?"
                )
              ) {
                // ADDED: set reset flag so Index.tsx can safely skip persisting stale state
                try { sessionStorage.setItem('is_resetting', 'true'); } catch {}
                storage.clearAll();
                window.location.href = "/";
              }
            }}
            style={{
              position: "fixed",
              bottom: "10px",
              right: "10px",
              zIndex: 10000,
              padding: "8px 12px",
              backgroundColor: "rgba(220, 38, 38, 0.85)",
              color: "white",
              border: "1px solid rgba(255,255,255,0.4)",
              borderRadius: "8px",
              cursor: "pointer",
              fontSize: "12px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
            }}
          >
            Reset App
          </button>
        )}

        <Routes>
          <Route path="/" element={<IndexPage />} />
          <Route path="/table/:id" element={<IndexPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
