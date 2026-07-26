import { Link, useLocation } from "@tanstack/react-router";
import { Home, Dumbbell, Apple, Users, User, ClipboardList, Search } from "lucide-react";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth-context";
import { Bot } from "lucide-react";



const baseItems = [
  { to: "/home", label: "الرئيسية", icon: Home },
  { to: "/workouts", label: "تمارين", icon: Dumbbell },
{ to: "/search", label: "بحث", icon: Search },
  // 👇👇👇 هذا هو الشاتبوت
  { to: "/ai-coach", label: "AIVA", icon: Bot },

  //{ to: "/nutrition", label: "تغذيتي", icon: Apple },
  //{ to: "/trainers", label: "مدربات", icon: Users },
  
  { to: "/profile", label: "ملفي", icon: User },
] as const;

const trainerItems = [
  { to: "/home", label: "الرئيسية", icon: Home },
  { to: "/trainer-plans", label: "خططي", icon: ClipboardList },
  { to: "/search", label: "بحث", icon: Search },
  { to: "/chat", label: "الرسائل", icon: Users },
 
  { to: "/profile", label: "ملفي", icon: User },
] as const;

function useNavItems() {
  const { role } = useAuth();
  return role === "trainer" ? trainerItems : baseItems;
}

export function BottomNav() {
  const { pathname } = useLocation();
  const items = useNavItems();
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 lg:hidden">
      <div className="mx-3 mb-3 glass rounded-3xl shadow-elegant border">
        <ul className="grid py-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
          {items.map((it) => {
            const active = pathname === it.to || pathname.startsWith(it.to + "/");
            const Icon = it.icon;
            return (
              <li key={it.to} className="flex justify-center">
                <Link to={it.to} className="relative flex flex-col items-center gap-1 py-1.5 px-2 min-w-12">
                  {active && (
                    <motion.div
                      layoutId="nav-active"
                      className="absolute inset-0 gradient-primary rounded-2xl -z-10"
                      transition={{ type: "spring", stiffness: 350, damping: 30 }}
                    />
                  )}
                  <Icon className={`w-5 h-5 ${active ? "text-primary-foreground" : "text-muted-foreground"}`} />
                  <span className={`text-[10px] font-semibold ${active ? "text-primary-foreground" : "text-muted-foreground"}`}>
                    {it.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

export function DesktopSidebar() {
  const { pathname } = useLocation();
  const items = useNavItems();
  return (
    <aside className="hidden lg:flex fixed right-0 top-0 h-screen w-64 border-l border-border bg-sidebar flex-col p-6">
      <div className="mb-8">
        <div className="flex items-center gap-2">
  <img
  src="/favicon.png"
  alt="EVOLVA"
  className="w-70  object-contain block"
/>
</div>
      </div>
      <ul className="space-y-1 flex-1">
        {items.map((it) => {
          const active = pathname === it.to || pathname.startsWith(it.to + "/");
          const Icon = it.icon;
          return (
            <li key={it.to}>
              <Link
                to={it.to}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition ${
                  active ? "gradient-primary text-primary-foreground shadow-soft" : "hover:bg-accent"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-semibold text-sm">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
