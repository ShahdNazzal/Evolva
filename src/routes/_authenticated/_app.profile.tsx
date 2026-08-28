import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Plus,
  Settings as SettingsIcon,
  TrendingUp,
  Camera,
  ImagePlus,
  Calendar,
  X,
  Quote,
  Wallet,
  ClipboardList,
  ChevronLeft,
  ChevronDown,
  Ruler,
  Weight,
  Target,
  CalendarClock,
  History,
  Pencil,
  Trash2,
  Instagram,
  Menu,
} from "lucide-react";
import { toast } from "sonner";
import { GOAL_LABELS } from "@/lib/workout-rules";
import { uploadFile } from "@/lib/upload";
import { motion, AnimatePresence } from "framer-motion";

export const Route = createFileRoute("/_authenticated/_app/profile")({
  head: () => ({ meta: [{ title: "ملفي — EVOLVA" }] }),
  component: ProfilePage,
});

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function isFixedWeekPlan(plan: any): boolean {
  const days = Array.isArray(plan?.exercises) ? plan.exercises : [];
  return days.length === 7 && days.every((d: any) => typeof d?.day_of_week === "number");
}

function parseDayName(dayName: string): { dayIndex: number | null; muscle: string } {
  const trimmed = (dayName ?? "").trim();
  for (let i = 0; i < DAYS.length; i++) {
    if (trimmed.startsWith(DAYS[i])) {
      const rest = trimmed.slice(DAYS[i].length).replace(/^[\s\-–—:]+/, "").trim();
      return { dayIndex: i, muscle: rest };
    }
  }
  return { dayIndex: null, muscle: trimmed };
}

type WeekSlot = { label: string; isRest: boolean; subtitle?: string };

function buildWeekSlots(plan: any): WeekSlot[] {
  if (!plan) return DAYS.map((label) => ({ label, isRest: true }));
  const rawDays: any[] = Array.isArray(plan.exercises) ? plan.exercises : [];

  if (isFixedWeekPlan(plan)) {
    const sorted = [...rawDays].sort((a, b) => a.day_of_week - b.day_of_week);
    return sorted.map((d) => {
      const itemsCount = Array.isArray(d.items) ? d.items.length : 0;
      const isRest = !!d.is_rest || itemsCount === 0;
      return {
        label: DAYS[d.day_of_week],
        isRest,
        subtitle: !isRest ? (d.muscle_group?.trim() || `${itemsCount} تمارين`) : undefined,
      };
    });
  }

  const parsed = rawDays.map((d: any) => ({ ...parseDayName(String(d?.name ?? "")), raw: d }));
  const anyMatchedByName = parsed.some((p) => p.dayIndex !== null);

  if (anyMatchedByName) {
    return DAYS.map((label, i) => {
      const match = parsed.find((p) => p.dayIndex === i);
      if (!match) return { label, isRest: true };
      return { label, isRest: false, subtitle: match.muscle || plan.name };
    });
  }

  return DAYS.map((label, i) => {
    const d = rawDays[i];
    if (!d) return { label, isRest: true };
    const dayLabel = typeof d?.name === "string" && d.name.trim() ? d.name.trim() : plan.name;
    return { label, isRest: false, subtitle: dayLabel };
  });
}

function computeBmi(weightKg: number, heightCm: number): string {
  if (!weightKg || !heightCm) return "";
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  return bmi.toFixed(1);
}

async function syncFitnessProfileWithLatestLog(userId: string, heightCm: number | undefined) {
  const { data: latest, error } = await supabase
    .from("progress_logs")
    .select("weight")
    .eq("user_id", userId)
    .order("logged_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.error("syncFitnessProfileWithLatestLog fetch error:", error); return; }
  if (!latest) return;
  const newBmi = heightCm ? computeBmi(+latest.weight, heightCm) : undefined;
  const { error: updateErr } = await supabase
    .from("user_fitness_profile")
    .update({ weight: latest.weight, ...(newBmi ? { bmi: newBmi } : {}) })
    .eq("user_id", userId);
  if (updateErr) console.error("syncFitnessProfileWithLatestLog update error:", updateErr);
}

/* ================================================================ */
/*                    الصفحة الرئيسية                                 */
/* ================================================================ */

function ProfilePage() {
  const { user, role, signOut } = useAuth();
  const navigate = useNavigate();
  const isTrainer = role === "trainer";

  const [profile, setProfile] = useState<any>(null);
  const [fp, setFp] = useState<any>(null);
  const [progress, setProgress] = useState<any[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<any>(null);
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [posts, setPosts] = useState<any[]>([]);
  const [activePlan, setActivePlan] = useState<any>(null);
  const [openPost, setOpenPost] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!user) return;
    const [{ data: p }, { data: f }, { data: pr }, { data: ps }, sel] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("user_fitness_profile").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("progress_logs").select("*").eq("user_id", user.id).order("logged_at"),
      supabase.from("posts").select("*").eq("author_id", user.id).order("created_at", { ascending: false }),
      isTrainer
        ? Promise.resolve({ data: null })
        : supabase.from("active_plan_selection").select("*").eq("user_id", user.id).maybeSingle(),
    ]);
    setProfile(p);
    setFp(f);
    setProgress(pr ?? []);
    setPosts(ps ?? []);
    setActivePlan(null);
    if (!isTrainer && sel?.data?.workout_plan_type && sel?.data?.workout_plan_id) {
      const { data: w } = await supabase.from("workouts").select("*").eq("id", sel.data.workout_plan_id).maybeSingle();
      setActivePlan(w ?? null);
    }
  };
  useEffect(() => { load(); }, [user, role]);

  const onAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    try {
      const url = await uploadFile(file, user.id, "avatars");
      await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id);
      toast.success("تم تحديث الصورة");
      load();
    } catch (err: any) { toast.error(err.message); }
  };

  const chartData = progress.map((p) => ({
    date: new Date(p.logged_at).toLocaleDateString("ar", { day: "numeric", month: "short" }),
    weight: +p.weight,
    notes: p.notes as string | null,
  }));

  const weekSlots = !isTrainer ? buildWeekSlots(activePlan) : [];
  const scheduledDaysCount = weekSlots.filter((s) => !s.isRest).length;

  const toggleSection = (section: string) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  const closeSidebarAnd = (action: () => void) => {
    setSidebarOpen(false);
    setTimeout(action, 200);
  };

  return (
    <div className="pb-6 max-w-lg mx-auto">

      {/* ============================================================ */}
      {/* 1. الرأس — اسم + زر القائمة الجانبية + الإعدادات              */}
      {/* ============================================================ */}
      <div className="flex items-center justify-between px-4 pt-5">
        <div className="font-extrabold text-lg truncate">{profile?.full_name ?? "…"}</div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            className="rounded-full h-9 w-9"
          >
            <Menu className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: "/settings" })}
            className="rounded-full h-9 w-9"
          >
            <SettingsIcon className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 2. الصورة الشخصية + الإحصائيات                                */}
      {/* ============================================================ */}
      <div className="flex items-center gap-5 px-4 mt-3">
        <button onClick={() => avatarInput.current?.click()} className="relative shrink-0">
          {profile?.avatar_url ? (
            <img
              src={profile.avatar_url}
              alt="avatar"
              className="w-20 h-20 rounded-full object-cover ring-2 ring-primary/25 shadow-soft"
            />
          ) : (
            <div className="w-20 h-20 rounded-full gradient-primary ring-2 ring-primary/25 shadow-soft flex items-center justify-center text-2xl font-extrabold text-primary-foreground">
              {profile?.full_name?.[0] ?? "؟"}
            </div>
          )}
          <div className="absolute -bottom-1 -left-1 bg-primary text-primary-foreground rounded-full p-1.5 shadow-soft">
            <Camera className="w-3.5 h-3.5" />
          </div>
          <input ref={avatarInput} type="file" accept="image/*" className="hidden" onChange={onAvatar} />
        </button>

        <div className="flex-1 grid grid-cols-3">
          <StatCol value={posts.length} label="منشور" />
          {!isTrainer && <StatCol value={scheduledDaysCount} label="أيام مجدولة" />}
          {!isTrainer && fp && <StatCol value={`${fp.weight}`} label="كغم حالياً" />}
        </div>
      </div>

      {/* ============================================================ */}
      {/* 3. النبذة                                                     */}
      {/* ============================================================ */}
      <div className="px-4 space-y-1.5 mt-3">
        <div className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full bg-secondary text-primary">
          {isTrainer ? "مدربة معتمدة" : "عضوة"}
        </div>
        {profile?.bio && <p className="text-sm leading-relaxed text-muted-foreground">{profile.bio}</p>}
      </div>

      {/* ============================================================ */}
      {/* 4. رابط الملف العام — نص صغير                                 */}
      {/* ============================================================ */}
      {user && (
        <div className="px-4 mt-2">
          <Link
            to="/u/$id"
            params={{ id: user.id }}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition font-medium"
          >
            عرض الملف العام <ChevronLeft className="w-3 h-3" />
          </Link>
        </div>
      )}

      <div className="border-t border-border/60 mx-4 mt-4" />

      {/* ============================================================ */}
      {/* 5. منشوراتي — فيد كبير بأسلوب إنستقرام                        */}
      {/* ============================================================ */}
      <div className="px-10 mt-6">
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-sm">منشوراتي</div>
          <Button size="sm" onClick={() => setNewPostOpen(true)} className="rounded-xl gradient-primary font-bold">
            <ImagePlus className="w-4 h-4 ml-1" /> منشور جديد
          </Button>
        </div>

        {posts.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-14 h-14 rounded-2xl bg-secondary text-primary flex items-center justify-center mx-auto mb-3">
              <ImagePlus className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold">لسا ما نشرتي شي</p>
            <p className="text-xs text-muted-foreground mt-1">شاركي أول لحظة إلك مع متابعينك</p>
          </div>
        ) : (
          <div className="space-y-3">
            {posts.map((p) => (
              <PostCard key={p.id} post={p} onOpen={() => setOpenPost(p)} />
            ))}
          </div>
        )}
      </div>

      {/* ============================================================ */}
                                 
      {/* ============================================================ */}
      <AnimatePresence>
        {openPost && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpenPost(null)}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-background rounded-3xl overflow-hidden max-w-sm w-full max-h-[85vh] overflow-y-auto shadow-elegant"
            >
              {openPost.image_url ? (
                <div className="relative">
                  <img src={openPost.image_url} className="w-full aspect-square object-cover" />
                  <button
                    onClick={() => setOpenPost(null)}
                    className="absolute top-3 left-3 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center"
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>
              ) : (
                <div className="relative gradient-primary text-primary-foreground p-8 min-h-[220px] flex items-center">
                  <Quote className="w-8 h-8 opacity-40 absolute top-5 right-5" />
                  <button
                    onClick={() => setOpenPost(null)}
                    className="absolute top-3 left-3 w-8 h-8 rounded-full bg-black/20 flex items-center justify-center"
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                  <p className="text-base font-bold leading-relaxed relative">{openPost.content}</p>
                </div>
              )}
              {openPost.image_url && openPost.content && (
                <div className="p-4 text-sm leading-relaxed">{openPost.content}</div>
              )}
              <div className="px-4 pb-4 pt-1 text-[10px] text-muted-foreground">
                {new Date(openPost.created_at).toLocaleDateString("ar", { day: "numeric", month: "long", year: "numeric" })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============================================================ */}
      {/* الشريط الجانبي — كل المعلومات الإضافية هون                     */}
      {/* ============================================================ */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            {/* خلفية معتمة */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            />
            {/* اللوحة الجانبية */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="fixed top-0 right-0 bottom-0 z-50 w-[85vw] max-w-sm bg-background border-l border-border shadow-2xl overflow-y-auto"
              dir="rtl"
            >
              {/* رأس الشريط الجانبي */}
              <div className="flex items-center justify-between px-4 pt-6 pb-4 sticky top-0 bg-background/95 backdrop-blur-md z-10">
                <div className="font-extrabold text-base">المزيد</div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSidebarOpen(false)}
                  className="rounded-full h-8 w-8"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="px-4 pb-8 space-y-2.5">
                {/* —— بيانات اللياقة (عضوة فقط) —— */}
                {!isTrainer && fp && (
                  <>
                    <ExpandableSection
                      icon={<Ruler className="w-4 h-4" />}
                      title="بياناتك"
                      subtitle={`الوزن ${fp.weight} كغ · الطول ${fp.height} سم · BMI ${fp.bmi}`}
                      isExpanded={expandedSection === "stats"}
                      onToggle={() => toggleSection("stats")}
                    >
                      <div className="grid grid-cols-3 gap-2">
                        <MiniStat icon={<Weight className="w-3.5 h-3.5" />} label="الوزن" value={`${fp.weight} كغ`} />
                        <MiniStat icon={<Ruler className="w-3.5 h-3.5" />} label="الطول" value={`${fp.height} سم`} />
                        <MiniStat icon={<TrendingUp className="w-3.5 h-3.5" />} label="BMI" value={fp.bmi} />
                        <MiniStat icon={<Target className="w-3.5 h-3.5" />} label="الهدف" value={GOAL_LABELS[fp.goal as keyof typeof GOAL_LABELS]} />
                        <MiniStat icon={<CalendarClock className="w-3.5 h-3.5" />} label="العمر" value={fp.age} />
                        <MiniStat icon={<Calendar className="w-3.5 h-3.5" />} label="أيام/أسبوع" value={fp.frequency} />
                      </div>
                    </ExpandableSection>

                    <ExpandableSection
                      icon={<TrendingUp className="w-4 h-4" />}
                      title="تطور الوزن"
                      subtitle={`${chartData.length} تسجيلات محفوظة`}
                      isExpanded={expandedSection === "weight"}
                      onToggle={() => toggleSection("weight")}
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => closeSidebarAnd(() => setHistoryOpen(true))}
                            className="rounded-xl font-bold px-2.5"
                          >
                            <History className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => closeSidebarAnd(() => setAddOpen(true))}
                            className="rounded-xl font-bold"
                          >
                            <Plus className="w-4 h-4 ml-1" /> تسجيل
                          </Button>
                        </div>
                        {chartData.length < 2 ? (
                          <p className="text-xs text-muted-foreground text-center py-6">سجّلي وزنك مرتين على الأقل لرؤية المخطط</p>
                        ) : (
                          <div style={{ height: 200 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={chartData}>
                                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                                <YAxis tick={{ fontSize: 10 }} />
                                <Tooltip content={<WeightTooltip />} />
                                <Line type="monotone" dataKey="weight" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 4 }} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </div>
                    </ExpandableSection>

                    <ExpandableSection
                      icon={<Calendar className="w-4 h-4" />}
                      title="جدولي الأسبوعي"
                      subtitle={activePlan ? `${scheduledDaysCount} أيام تمرين هالأسبوع` : "ما في خطة معتمدة حالياً"}
                      isExpanded={expandedSection === "schedule"}
                      onToggle={() => toggleSection("schedule")}
                    >
                      {!activePlan ? (
                        <p className="text-xs text-muted-foreground text-center py-6">
                          ما في خطة معتمدة حالياً — اعتمدي خطة من صفحة التمارين ليظهر جدولك هون تلقائياً
                        </p>
                      ) : (
                        <div className="-mx-1.5 px-1.5 overflow-x-auto scrollbar-none">
                          <div className="flex gap-2 min-w-max">
                            {weekSlots.map((slot: WeekSlot, i: number) => (
                              <WeekDayCell key={i} slot={slot} isToday={new Date().getDay() === i} />
                            ))}
                          </div>
                        </div>
                      )}
                    </ExpandableSection>

                    <div className="border-t border-border/60 my-1" />
                  </>
                )}

                {/* —— روابط المدربة —— */}
                {isTrainer && (
                  <>
                    <Link
                      to="/billing"
                      onClick={() => setSidebarOpen(false)}
                      className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-muted/60 hover:bg-muted transition text-right"
                    >
                      <span className="w-9 h-9 rounded-xl bg-background text-primary flex items-center justify-center shrink-0">
                        <Wallet className="w-4 h-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm">الاشتراكات</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">المصاريف والأرباح</div>
                      </div>
                      <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0" />
                    </Link>
                    <Link
                      to="/trainer-plans"
                      onClick={() => setSidebarOpen(false)}
                      className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-muted/60 hover:bg-muted transition text-right"
                    >
                      <span className="w-9 h-9 rounded-xl bg-background text-primary flex items-center justify-center shrink-0">
                        <ClipboardList className="w-4 h-4" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm">خططي</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">خطط التمارين</div>
                      </div>
                      <ChevronLeft className="w-4 h-4 text-muted-foreground shrink-0" />
                    </Link>
                    <div className="border-t border-border/60 my-1" />
                  </>
                )}

                {/* —— تسجيل الخروج —— */}
                <Button
                  variant="outline"
                  onClick={async () => {
                    setSidebarOpen(false);
                    await signOut();
                    navigate({ to: "/auth" });
                  }}
                  className="w-full rounded-2xl font-bold mt-2"
                >
                  تسجيل الخروج
                </Button>

                {/* —— تذييل —— */}
                <a
                  href="https://www.instagram.com/shahd.nazzal_/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition pt-3"
                >
                  <Instagram className="w-3.5 h-3.5" />
                  عندك ملاحظة؟ تواصلي معنا على انستقرام
                </a>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ============================================================ */}
                                               
      {/* ============================================================ */}
      <AddWeightDialog
        open={addOpen || !!editingLog}
        editingLog={editingLog}
        onClose={() => { setAddOpen(false); setEditingLog(null); }}
        userId={user?.id ?? ""}
        fp={fp}
        onSaved={load}
      />
      <WeightHistoryDialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        logs={progress}
        onEdit={(log: any) => { setHistoryOpen(false); setEditingLog(log); }}
        userId={user?.id ?? ""}
        fp={fp}
        onSaved={load}
      />
      <NewPostDialog open={newPostOpen} onClose={() => setNewPostOpen(false)} userId={user?.id ?? ""} onSaved={load} />
    </div>
  );
}

/* ================================================================ */
/* مكونات مساعدة                                                     */
/* ================================================================ */

function StatCol({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="font-extrabold text-base leading-none">{value}</div>
      <div className="text-[10px] text-muted-foreground mt-1 text-center">{label}</div>
    </div>
  );
}

/* قائمة قابلة للطي — داخل الشريط الجانبي */
function ExpandableSection({
  icon,
  title,
  subtitle,
  isExpanded,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-muted/50 overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 p-3.5 text-right">
        <span className="w-9 h-9 rounded-xl bg-background text-primary flex items-center justify-center shrink-0">
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm">{title}</div>
          {subtitle && <div className="text-[11px] text-muted-foreground truncate mt-0.5">{subtitle}</div>}
        </div>
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.25 }}
          className="shrink-0"
        >
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3.5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: any }) {
  return (
    <div className="p-3 rounded-2xl bg-background/80 flex flex-col items-center text-center gap-1">
      <span className="w-6 h-6 rounded-lg bg-muted text-primary flex items-center justify-center">{icon}</span>
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className="font-bold text-xs">{value}</div>
    </div>
  );
}

/* ================================================================ */
/* بطاقة منشور كبيرة — بأسلوب إنستقرام (فيد)                          */
/* ================================================================ */

function PostCard({ post, onOpen }: { post: any; onOpen: () => void }) {
  const hasImage = !!post.image_url;
  const dateStr = new Date(post.created_at).toLocaleDateString("ar", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onOpen}
      className="w-full rounded-2xl overflow-hidden bg-card border border-border/50 shadow-sm text-right"
    >
      {hasImage ? (
        <img
          src={post.image_url}
          alt=""
          className="w-full aspect-[4/5] object-cover"
        />
      ) : (
        <div className="relative gradient-primary text-primary-foreground p-8 min-h-[300px] flex items-center">
          <Quote className="w-10 h-10 opacity-30 absolute top-5 right-5" />
          <p className="text-base font-bold leading-relaxed relative">{post.content}</p>
        </div>
      )}
      <div className="p-3.5 space-y-1">
        {post.content && hasImage && (
          <p className="text-sm leading-relaxed line-clamp-3">{post.content}</p>
        )}
        <div className="text-[11px] text-muted-foreground">{dateStr}</div>
      </div>
    </motion.button>
  );
}

/* ================================================================ */
/* يوم بالجدول الأسبوعي                                                */
/* ================================================================ */

function WeekDayCell({ slot, isToday }: { slot: WeekSlot; isToday: boolean }) {
  return (
    <div className="flex flex-col items-center w-16 shrink-0">
      <div
        className={`relative w-full h-24 rounded-2xl flex flex-col items-center justify-center gap-1.5 px-1
        backdrop-blur-xl border transition-all
        ${isToday ? "shadow-lg shadow-primary/20" : ""}
        ${slot.isRest
          ? "bg-white/30 border-white/40 text-muted-foreground"
          : "bg-primary/15 border-primary/25"
        }
        ${isToday ? "border-primary/60 bg-white/50" : ""}
        `}
      >
        <span className={`text-[11px] font-extrabold ${slot.isRest ? "text-muted-foreground" : "text-primary"}`}>
          {slot.label}
        </span>
        {slot.isRest ? (
          <span className="text-[9px] text-muted-foreground/70 font-medium">راحة</span>
        ) : (
          <>
            <span className="text-lg leading-none">🏋️</span>
            <span className="text-[8.5px] text-primary font-bold text-center leading-tight line-clamp-2">
              {slot.subtitle ?? "تمرين"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/* ================================================================ */
/* تولتيب مخصص للرسم البياني                                         */
/* ================================================================ */

function WeightTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="bg-background border border-border rounded-xl shadow-soft px-3 py-2 text-xs max-w-[180px]">
      <div className="font-extrabold text-sm">{point.weight} كغ</div>
      <div className="text-muted-foreground mt-0.5">{point.date}</div>
      {point.notes && (
        <div className="mt-1.5 pt-1.5 border-t border-border/60 text-foreground/90 leading-relaxed">
          {point.notes}
        </div>
      )}
    </div>
  );
}

/* ================================================================ */
/* حوار تسجيل/تعديل وزن                                              */
/* ================================================================ */

function AddWeightDialog({ open, onClose, userId, fp, editingLog, onSaved }: any) {
  const isEditing = !!editingLog;
  const [weight, setWeight] = useState<number>(fp?.weight ?? 60);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editingLog) {
      setWeight(+editingLog.weight);
      setNotes(editingLog.notes ?? "");
    } else {
      setWeight(fp?.weight ?? 60);
      setNotes("");
    }
  }, [open, editingLog, fp]);

  const handleSave = async () => {
    if (!userId || !weight) return toast.error("أدخلي وزناً صحيحاً");
    setSaving(true);
    try {
      if (isEditing) {
        const { error } = await supabase.from("progress_logs").update({ weight, notes: notes || null }).eq("id", editingLog.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("progress_logs").insert({ user_id: userId, weight, notes: notes || null });
        if (error) throw error;
      }
      await syncFitnessProfileWithLatestLog(userId, fp?.height);
      toast.success(isEditing ? "تم تعديل الوزن" : "تم تسجيل الوزن");
      onClose();
      onSaved();
    } catch (err: any) {
      console.error("save weight error:", err);
      toast.error(err.message ?? "صار في خطأ أثناء الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-3xl w-[92vw] max-w-md" dir="rtl">
        <DialogHeader><DialogTitle>{isEditing ? "تعديل الوزن" : "تسجيل وزن جديد"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>الوزن (كغ)</Label>
            <Input type="number" value={weight} onChange={(e) => setWeight(+e.target.value)} className="rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label>ملاحظات (اختياري)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-xl" placeholder="مثلاً: بعد رجعة من سفر، قبل الدورة..." />
          </div>
          <Button disabled={saving} onClick={handleSave} className="rounded-2xl gradient-primary w-full font-bold">
            {saving ? "جارِ الحفظ..." : "حفظ"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================ */
/* حوار سجل الوزن الكامل                                              */
/* ================================================================ */

function WeightHistoryDialog({ open, onClose, logs, onEdit, userId, fp, onSaved }: any) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const sorted = [...logs].sort((a, b) => new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime());

  const handleDelete = async (log: any) => {
    setDeletingId(log.id);
    try {
      const { error } = await supabase.from("progress_logs").delete().eq("id", log.id);
      if (error) throw error;
      await syncFitnessProfileWithLatestLog(userId, fp?.height);
      toast.success("تم حذف السجل");
      onSaved();
    } catch (err: any) {
      console.error("delete weight log error:", err);
      toast.error(err.message ?? "تعذّر الحذف");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-3xl max-h-[75vh] overflow-y-auto w-[92vw] max-w-md" dir="rtl">
        <DialogHeader><DialogTitle>سجل الوزن</DialogTitle></DialogHeader>
        {sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">ما في سجلات وزن بعد</p>
        ) : (
          <div className="space-y-2">
            {sorted.map((log) => (
              <div key={log.id} className="flex items-center gap-2.5 p-3 rounded-2xl bg-muted/60">
                <div className="w-10 h-10 rounded-xl bg-background text-primary flex items-center justify-center shrink-0 font-extrabold text-sm">
                  {log.weight}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold">
                    {new Date(log.logged_at).toLocaleDateString("ar", { day: "numeric", month: "long", year: "numeric" })}
                  </div>
                  {log.notes && <div className="text-[11px] text-muted-foreground truncate mt-0.5">{log.notes}</div>}
                </div>
                <button onClick={() => onEdit(log)} className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-background transition">
                  <Pencil className="w-4 h-4 text-primary" />
                </button>
                <button
                  onClick={() => handleDelete(log)}
                  disabled={deletingId === log.id}
                  className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-background transition"
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================ */
/* حوار منشور جديد                                                    */
/* ================================================================ */

function NewPostDialog({ open, onClose, userId, onSaved }: any) {
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-3xl w-[92vw] max-w-md" dir="rtl">
        <DialogHeader><DialogTitle>منشور جديد</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} className="rounded-xl min-h-24" placeholder="اكتبي كابشن..." />
          <div className="space-y-1.5">
            <Label className="text-xs">صورة (اختياري)</Label>
            <Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="rounded-xl" />
            {file && <div className="text-xs text-muted-foreground">{file.name}</div>}
          </div>







          <Button
            disabled={saving}
            onClick={async () => {
              if (!content && !file) return toast.error("أضيفي نصاً أو صورة");
              setSaving(true);
              try {
                let image_url: string | null = null;
                if (file) image_url = await uploadFile(file, userId, "posts");
                const { error } = await supabase.from("posts").insert({ author_id: userId, trainer_id: userId, content: content || "", image_url });
                if (error) throw error;
                toast.success("تم النشر");
                setContent(""); setFile(null); onClose(); onSaved();
              } catch (err: any) { toast.error(err.message); }
              finally { setSaving(false); }
            }}
            className="rounded-2xl gradient-primary w-full font-bold"
          >{saving ? "جاري النشر..." : "نشر"}</Button>
        </div>








      </DialogContent>








    </Dialog>



 



  );
}

