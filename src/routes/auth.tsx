//C:\Users\lenovo\Downloads\jammawia-main (1)\jammawia-main\src\routes\auth.tsx

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Sparkles, Heart, Dumbbell } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "تسجيل الدخول — EVOLVA" },
      { name: "description", content: "سجّلي دخولك أو أنشئي حساب على منصة EVOLVA للياقة النسائية." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        toast.success("تم إنشاء حسابك بنجاح");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("مرحباً بعودتك");
      }
      navigate({ to: "/home" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "حدث خطأ";
      toast.error(msg.includes("Invalid login") ? "بيانات الدخول غير صحيحة" : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 gradient-blush">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <motion.div
  animate={{ scale: [1, 1.1, 1] }}
  transition={{ duration: 3, repeat: Infinity }}
  className="inline-flex mb-4"
>
  <img
    src="/favicon3.png"
    alt="EVOLVA"
    className="w-28 h-28 object-contain"
  />
</motion.div>
          <h1 className="text-4xl font-extrabold tracking-tight text-pink-800">
  EVOLVA
</h1>
          <p className="text-muted-foreground mt-2 text-sm">
         رحلتُكِ نحو نسخة أقوى من نفسكِ تبدأ من هنا.
          </p>
        </div>

        <div className="glass rounded-3xl p-6 shadow-elegant">
          <div className="flex gap-2 p-1 bg-muted rounded-2xl mb-6">
            <button
              onClick={() => setMode("signin")}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                mode === "signin" ? "bg-card shadow-soft" : "text-muted-foreground"
              }`}
            >
              تسجيل الدخول
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                mode === "signup" ? "bg-card shadow-soft" : "text-muted-foreground"
              }`}
            >
              إنشاء حساب
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <Label htmlFor="name">الاسم الكامل</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="mt-1.5 rounded-xl"
                  placeholder="مثال: نور"
                />
              </div>
            )}
            <div>
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-1.5 rounded-xl"
                placeholder="you@example.com"
                dir="ltr"
              />
            </div>
            <div>
              <Label htmlFor="password">كلمة المرور</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="mt-1.5 rounded-xl"
                dir="ltr"
              />
            </div>
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-2xl gradient-primary text-primary-foreground font-semibold shadow-soft hover:opacity-95 hover:scale-[1.01] transition"
            >
              {loading ? "جاري..." : mode === "signin" ? "دخول" : "إنشاء حسابي"}
            </Button>
          </form>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 text-center text-xs text-muted-foreground">
          <div className="p-3 rounded-2xl bg-card/50">
            <Heart className="w-5 h-5 mx-auto mb-1 text-primary" />
            مجتمع نسائي آمن
          </div>
          <div className="p-3 rounded-2xl bg-card/50">
            <Dumbbell className="w-5 h-5 mx-auto mb-1 text-primary" />
            خطط مخصصة لكِ
          </div>
        </div>
      </motion.div>
    </div>
  );
}
