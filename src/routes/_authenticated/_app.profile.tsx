import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
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
  Ruler,
  Weight,
  Target,
  CalendarClock,
  History,
  Pencil,
  Trash2,
  Instagram,
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

// خطة "أسبوع ثابت" (خطط شخصية أنشأناها من صفحة التمارين): مصفوفة 7 عناصر بالظبط، كل عنصر فيه day_of_week رقمي
function isFixedWeekPlan(plan: any): boolean {
  const days = Array.isArray(plan?.exercises) ? plan.exercises : [];
  return days.length === 7 && days.every((d: any) => typeof d?.day_of_week === "number");
}

// نحاول نطابق اسم اليوم (زي "الأحد - صدر وترايسبس") مع أحد أيام الأسبوع، ونستخرج اسم العضلة المستهدفة بعد الفاصل
function parseDayName(dayName: string): { dayIndex: number | null; muscle: string } {
  const trimmed = (dayName ?? "").trim();
  for (let i = 0; i < DAYS.length; i++) {
    if (trimmed.startsWith(DAYS[i])) {
      const rest = trimmed.slice(DAYS[i].length).replace(/^[\s-–—:]+/, "").trim();
      return { dayIndex: i, muscle: rest };
    }
  }
  return { dayIndex: null, muscle: trimmed };
}

type WeekSlot = { label: string; isRest: boolean; subtitle?: string };

// نبني عرض 7 أيام من الخطة المعتمدة حالياً، بغض النظر عن نوعها — مستخدمة للمشتركات فقط
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

// نحسب BMI بنفس الصيغة القياسية: الوزن(كغ) ÷ (الطول بالمتر)^2
function computeBmi(weightKg: number, heightCm: number): string {
  if (!weightKg || !heightCm) return "";
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  return bmi.toFixed(1);
}

// بعد أي إضافة/تعديل/حذف بسجل الوزن، نجيب أحدث نقطة متبقية فعلياً من الداتابيس
// (مش بس نفترض إنه آخر عملية هي الأحدث) ونزامن بيها "بياناتك" (الوزن + BMI).
// إذا ما بقي ولا سجل، منسيب الوزن المحفوظ متل ما هو.
// ملاحظة: نطابق بعمود user_id (مش id) لأنه هو المضمون موجود دايماً بجدول
// user_fitness_profile، وهو نفسه يلي صفحة الإعدادات بتعتمد عليه.
async function syncFitnessProfileWithLatestLog(userId: string, heightCm: number | undefined) {
  const { data: latest, error } = await supabase
    .from("progress_logs")
    .select("weight")
    .eq("user_id", userId)
    .order("logged_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("syncFitnessProfileWithLatestLog fetch error:", error);
    return;
  }
  if (!latest) return;

  const newBmi = heightCm ? computeBmi(+latest.weight, heightCm) : undefined;
  const { error: updateErr } = await supabase
    .from("user_fitness_profile")
    .update({ weight: latest.weight, ...(newBmi ? { bmi: newBmi } : {}) })
    .eq("user_id", userId);
  if (updateErr) console.error("syncFitnessProfileWithLatestLog update error:", updateErr);
}

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
  const avatarInput = useRef<HTMLInputElement>(null);

  const load = async () => {
    if (!user) return;
    const [{ data: p }, { data: f }, { data: pr }, { data: ps }, sel] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("user_fitness_profile").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("progress_logs").select("*").eq("user_id", user.id).order("logged_at"),
      supabase.from("posts").select("*").eq("author_id", user.id).order("created_at", { ascending: false }),
      // الجدول الأسبوعي خاص بالمشتركات حصراً — ما في داعي نجيب بيانات خطة تمرين لحساب مدربة
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

  return (
    <div className="space-y-5 pb-6">
      {/* ============ رأس البروفايل الغامر ============ */}
      <div className="relative -mx-4 sm:mx-0">
        <div className="relative overflow-hidden sm:rounded-[2rem] gradient-blush pt-10 pb-16 px-5">
          <div className="absolute -top-16 -left-10 w-56 h-56 bg-white/25 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -right-10 w-64 h-64 bg-primary/20 rounded-full blur-3xl pointer-events-none" />

          <div className="relative flex items-start justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-primary/80 bg-white/50 backdrop-blur px-3 py-1 rounded-full">
              {isTrainer ? "لوحة المدربة" : "ملفي الشخصي"}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate({ to: "/settings" })}
              className="rounded-2xl bg-white/50 backdrop-blur hover:bg-white/70 h-9 w-9"
            >
              <SettingsIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* بطاقة الهوية — عائمة فوق حافة الغلاف */}
        <div className="relative -mt-14 px-5">
          <Card className="p-5 rounded-3xl border-none shadow-elegant">
            <div className="flex items-start gap-4">
              <button onClick={() => avatarInput.current?.click()} className="relative shrink-0 -mt-10">
                {profile?.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt="avatar"
                    className="w-24 h-24 rounded-3xl object-cover ring-4 ring-background shadow-elegant"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-3xl gradient-primary ring-4 ring-background shadow-elegant flex items-center justify-center text-3xl font-extrabold text-primary-foreground">
                    {profile?.full_name?.[0] ?? "؟"}
                  </div>
                )}
                <div className="absolute -bottom-1 -left-1 bg-primary text-primary-foreground rounded-full p-1.5 shadow-soft">
                  <Camera className="w-3.5 h-3.5" />
                </div>
                <input ref={avatarInput} type="file" accept="image/*" className="hidden" onChange={onAvatar} />
              </button>

              <div className="flex-1 min-w-0 pt-1">
                <div className="font-extrabold text-xl truncate">{profile?.full_name ?? "…"}</div>
                <div className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full bg-secondary text-primary mt-1">
                  {isTrainer ? "مدربة معتمدة" : "عضوة"}
                </div>
              </div>
            </div>

            {profile?.bio && <p className="text-sm mt-4 leading-relaxed text-muted-foreground">{profile.bio}</p>}

            {/* شريط الإحصائيات — flex-wrap عشان ينضبط بشاشات الموبايل الضيقة جداً بدون ضغط أو تجاوز للعرض */}
            <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-border/60">
              <StatPill value={posts.length} label="منشور" />
              {!isTrainer && <StatPill value={scheduledDaysCount} label="أيام مجدولة" />}
              {!isTrainer && fp && <StatPill value={`${fp.weight}`} label="كغم حالياً" />}
              <div className="flex-1" />
              {user && (
                <Link
                  to="/u/$id"
                  params={{ id: user.id }}
                  className="flex items-center gap-1 text-xs text-primary font-bold whitespace-nowrap bg-secondary px-3 py-1.5 rounded-xl"
                >
                  عرض للعامة <ChevronLeft className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ============ روابط سريعة — للمدربة حصراً، بديل الجدول الأسبوعي ============ */}
      {isTrainer && (
        <div className="grid grid-cols-2 gap-3">
          <Link to="/billing" className="block">
            <Card className="p-4 rounded-2xl border-none shadow-soft flex items-center gap-3 active:scale-[0.98] transition">
              <div className="w-10 h-10 rounded-xl bg-secondary text-primary flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-sm">الاشتراكات</div>
                <div className="text-[10px] text-muted-foreground">المصاريف والأرباح</div>
              </div>
            </Card>
          </Link>
          <Link to="/trainer-plans" className="block">
            <Card className="p-4 rounded-2xl border-none shadow-soft flex items-center gap-3 active:scale-[0.98] transition">
              <div className="w-10 h-10 rounded-xl bg-secondary text-primary flex items-center justify-center shrink-0">
                <ClipboardList className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-sm">خططي</div>
                <div className="text-[10px] text-muted-foreground">خطط التمارين</div>
              </div>
            </Card>
          </Link>
        </div>
      )}

      {/* ============ بيانات جسمانية + تطور الوزن — للمشتركات فقط ============ */}
      {!isTrainer && fp && (
        <>
          <Card className="p-5 rounded-3xl border-none shadow-soft">
            <div className="text-sm font-bold mb-3.5">بياناتك</div>
            <div className="grid grid-cols-3 gap-2.5">
              <MiniStat icon={<Weight className="w-3.5 h-3.5" />} label="الوزن" value={`${fp.weight} كغ`} />
              <MiniStat icon={<Ruler className="w-3.5 h-3.5" />} label="الطول" value={`${fp.height} سم`} />
              <MiniStat icon={<TrendingUp className="w-3.5 h-3.5" />} label="BMI" value={fp.bmi} />
              <MiniStat icon={<Target className="w-3.5 h-3.5" />} label="الهدف" value={GOAL_LABELS[fp.goal as keyof typeof GOAL_LABELS]} />
              <MiniStat icon={<CalendarClock className="w-3.5 h-3.5" />} label="العمر" value={fp.age} />
              <MiniStat icon={<Calendar className="w-3.5 h-3.5" />} label="أيام/أسبوع" value={fp.frequency} />
            </div>
          </Card>

          <Card className="p-5 rounded-3xl border-none shadow-soft">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-bold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary" /> تطور الوزن</div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)} className="rounded-xl font-bold px-2.5">
                  <History className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)} className="rounded-xl font-bold">
                  <Plus className="w-4 h-4 ml-1" /> تسجيل
                </Button>
              </div>
            </div>
            {chartData.length < 2 ? (
              <p className="text-xs text-muted-foreground text-center py-6">سجّلي وزنك مرتين على الأقل لرؤية المخطط</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip content={<WeightTooltip />} />
                  <Line type="monotone" dataKey="weight" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* ============ الجدول الأسبوعي — حصراً للمشتركات ============ */}
          <Card className="p-5 rounded-3xl overflow-hidden border-none shadow-soft">
            <div className="font-bold text-sm flex items-center gap-2 mb-5">
              <Calendar className="w-4 h-4 text-primary" /> جدولي الأسبوعي
            </div>

            {!activePlan ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                ما في خطة معتمدة حالياً — اعتمدي خطة من صفحة التمارين ليظهر جدولك هون تلقائياً
              </p>
            ) : (
              <div className="-mx-5 px-5 sm:mx-0 sm:px-0 overflow-x-auto sm:overflow-visible scrollbar-none">
                <div className="flex gap-2.5 sm:gap-3 min-w-max sm:min-w-0 sm:justify-between">
                  {weekSlots.map((slot, i) => (
                    <WeekDayCell key={i} slot={slot} isToday={new Date().getDay() === i} />
                  ))}
                </div>
              </div>
            )}
          </Card>
        </>
      )}

      {/* ============ منشوراتي ============ */}
      <Card className="p-5 rounded-3xl border-none shadow-soft">
        <div className="flex items-center justify-between mb-3.5">
          <div className="font-bold text-sm">منشوراتي</div>
          <Button size="sm" onClick={() => setNewPostOpen(true)} className="rounded-xl gradient-primary font-bold">
            <ImagePlus className="w-4 h-4 ml-1" /> منشور جديد
          </Button>
        </div>

        {posts.length === 0 ? (
          <div className="text-center py-10 px-4">
            <div className="w-14 h-14 rounded-2xl bg-secondary text-primary flex items-center justify-center mx-auto mb-3">
              <ImagePlus className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold">لسا ما نشرتي شي</p>
            <p className="text-xs text-muted-foreground mt-1">شاركي أول لحظة إلك مع متابعينك</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {posts.map((p) => (
              <PostTile key={p.id} post={p} onOpen={() => setOpenPost(p)} />
            ))}
          </div>
        )}
      </Card>

      {/* لايتبوكس عرض المنشور موسّعاً */}
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

      <Button
        variant="outline"
        onClick={async () => { await signOut(); navigate({ to: "/auth" }); }}
        className="w-full rounded-2xl font-bold"
      >
        تسجيل الخروج
      </Button>

      {/* ============ تواصلي معنا — ملاحظات عن الموقع/التطبيق عبر انستقرام (آخر عنصر بالصفحة) ============ */}
      <a
        href="https://www.instagram.com/shahd.nazzal_/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition py-2"
      >
        <Instagram className="w-3.5 h-3.5" />
        عندك ملاحظة؟ تواصلي معنا على انستقرام
      </a>

      <AddWeightDialog
        open={addOpen || !!editingLog}
        editingLog={editingLog}
        onClose={() => {
          setAddOpen(false);
          setEditingLog(null);
        }}
        userId={user?.id ?? ""}
        fp={fp}
        onSaved={load}
      />
      <WeightHistoryDialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        logs={progress}
        onEdit={(log: any) => {
          setHistoryOpen(false);
          setEditingLog(log);
        }}
        userId={user?.id ?? ""}
        fp={fp}
        onSaved={load}
      />
      <NewPostDialog open={newPostOpen} onClose={() => setNewPostOpen(false)} userId={user?.id ?? ""} onSaved={load} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* عنصر إحصائية صغيرة برأس البروفايل                                    */
/* ------------------------------------------------------------------ */

function StatPill({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="text-center px-3 py-1.5 rounded-xl bg-muted/60">
      <div className="font-extrabold text-sm leading-none">{value}</div>
      <div className="text-[9px] text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* بلاطة منشور واحدة — تصميم غامر يفرّق بين منشور صورة ومنشور نصي         */
/* ------------------------------------------------------------------ */

function PostTile({ post, onOpen }: { post: any; onOpen: () => void }) {
  const hasImage = !!post.image_url;

  if (hasImage) {
    return (
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={onOpen}
        className="relative aspect-[4/5] rounded-2xl overflow-hidden text-right group"
      >
        <img src={post.image_url} className="w-full h-full object-cover transition group-hover:scale-105" />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
        {post.content && (
          <p className="absolute bottom-2 right-2.5 left-2.5 text-[11px] text-white font-semibold leading-tight line-clamp-2">
            {post.content}
          </p>
        )}
      </motion.button>
    );
  }

  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onOpen}
      className="relative aspect-[4/5] rounded-2xl overflow-hidden text-right p-3.5 flex flex-col justify-between gradient-blush border border-white/40"
    >
      <Quote className="w-5 h-5 text-primary/50 shrink-0" />
      <p className="text-[12.5px] font-bold leading-snug line-clamp-5 text-foreground/90">{post.content}</p>
      <span className="text-[9px] text-muted-foreground">
        {new Date(post.created_at).toLocaleDateString("ar", { day: "numeric", month: "short" })}
      </span>
    </motion.button>
  );
}

/* ------------------------------------------------------------------ */
/* يوم بالجدول الأسبوعي                                                */
/* ------------------------------------------------------------------ */

function WeekDayCell({ slot, isToday }: { slot: WeekSlot; isToday: boolean }) {
  return (
    <div className="flex flex-col items-center w-16 sm:w-auto sm:flex-1 sm:max-w-[6.5rem] shrink-0">
      <div
        className={`relative w-full h-24 sm:h-28 rounded-2xl flex flex-col items-center justify-center gap-1.5 px-1
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
            <span className="text-[8.5px] sm:text-[10px] text-primary font-bold text-center leading-tight line-clamp-2">
              {slot.subtitle ?? "تمرين"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: any }) {
  return (
    <div className="p-3 rounded-2xl bg-muted/60 flex flex-col items-center text-center gap-1">
      <span className="w-6 h-6 rounded-lg bg-background text-primary flex items-center justify-center">{icon}</span>
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className="font-bold text-xs">{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* تولتيب مخصص للرسم البياني — يعرض التاريخ والوزن، وكمان الملاحظة        */
/* المرتبطة بهاي النقطة (إذا كانت موجودة) لما نحط الماوس/نلمس فوقها       */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* حوار تسجيل/تعديل وزن — يشتغل بوضعين:                                  */
/*  - إضافة جديدة: بيعمل insert بـ progress_logs                         */
/*  - تعديل (editingLog موجود): بيعمل update لنفس السجل                  */
/* بالحالتين، بعدها منزامن "بياناتك ← الوزن" مع أحدث سجل فعلي بالداتابيس  */
/* (مش بالضرورة القيمة يلي توّنا حفظناها، لأنه ممكن تكون قديمة بالتعديل)   */
/* ------------------------------------------------------------------ */

function AddWeightDialog({ open, onClose, userId, fp, editingLog, onSaved }: any) {
  const isEditing = !!editingLog;
  const [weight, setWeight] = useState<number>(fp?.weight ?? 60);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // كل ما ينفتح الحوار، نعبّي القيم: إذا تعديل نجيبها من السجل، وإلا آخر وزن محفوظ
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
        const { error } = await supabase
          .from("progress_logs")
          .update({ weight, notes: notes || null })
          .eq("id", editingLog.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("progress_logs")
          .insert({ user_id: userId, weight, notes: notes || null });
        if (error) throw error;
      }

      // نزامن "بياناتك" مع أحدث سجل فعلي (مو بالضرورة اللي حفظناه توّنا)
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

/* ------------------------------------------------------------------ */
/* حوار سجل الوزن الكامل — عرض كل النقاط، وتعديل/حذف أي وحدة منها         */
/* بعد الحذف منزامن "بياناتك" مع أحدث نقطة متبقية تلقائياً                */
/* ------------------------------------------------------------------ */

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