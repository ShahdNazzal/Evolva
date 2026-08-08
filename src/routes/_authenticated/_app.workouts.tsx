import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dumbbell, Plus, CheckCircle2, Timer, X, Calendar, Trash2,
  ImagePlus, ChevronDown, ChevronUp, Play, Youtube, Moon, Pencil,
  Droplets, PartyPopper, GripVertical, Users, Sparkles, ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { uploadFile } from "@/lib/upload";

export const Route = createFileRoute("/_authenticated/_app/workouts")({
  head: () => ({ meta: [{ title: "التمارين — EVOLVA" }] }),
  component: WorkoutsPage,
});

const DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const DAYS_SHORT = ["أحد", "إثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];

// نستخرج معرف فيديو اليوتيوب من أي شكل رابط (watch / youtu.be / shorts / embed)
function getYouTubeId(url?: string | null): string | null {
  if (!url) return null;
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{6,})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{6,})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{6,})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

// خطة "أسبوع ثابت" هي الخطط الشخصية الجديدة: مصفوفة من 7 عناصر بالظبط، كل عنصر فيه day_of_week رقمي
function isFixedWeekPlan(plan: any): boolean {
  const days = Array.isArray(plan?.exercises) ? plan.exercises : [];
  return days.length === 7 && days.every((d: any) => typeof d?.day_of_week === "number");
}

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// جدول workout_logs فيه عمودين جديدين (day_index و exercise_index) مش موجودين بعد بملف الأنواع
// المولّد تلقائياً تبع Supabase (types.ts)، فبنعمل تحويل بسيط هون بدل "as any" بكل سطر.
// أفضل حل دائم هو تحديث types.ts عن طريق: npx supabase gen types typescript --project-id <PROJECT_ID> --schema public
const workoutLogsTable = () => (supabase as any).from("workout_logs");

// ---------- أدوات الصوت المشتركة (شغّالة على اللابتوب والموبايل) ----------

// AudioContext واحد مشترك بكل الصفحة، بنعيد استخدامه بدل ما نفتح واحد جديد كل مرة
let sharedAudioCtx: AudioContext | null = null;
function getSharedAudioContext(): AudioContext | null {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    if (!sharedAudioCtx) sharedAudioCtx = new Ctx();
    if (sharedAudioCtx.state === "suspended") sharedAudioCtx.resume();
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

// نغمة احتفال قصيرة (3 نغمات صاعدة) لما توكّدي إنجاز تمرين — لازم تتنادى مباشرة جوّا معالج ضغطة المستخدم عشان تشتغل عالموبايل
function playCompletionChime() {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
  notes.forEach((freq, i) => {
    const startAt = ctx.currentTime + i * 0.12;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.35, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.28);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + 0.3);
  });
}

// ---------- كونفيتي بسيط بدون أي مكتبة خارجية ----------

type ConfettiPiece = {
  x: number; y: number; w: number; h: number; color: string;
  speedY: number; speedX: number; rotation: number; rotationSpeed: number;
};

function ConfettiBurst({ triggerKey }: { triggerKey: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!triggerKey) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ["#ff6b9d", "#c06fdb", "#6bc5ff", "#ffd166", "#8affa0", "#ff9f6b"];
    const pieces: ConfettiPiece[] = Array.from({ length: 90 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.4,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedY: 2.5 + Math.random() * 3,
      speedX: (Math.random() - 0.5) * 2.5,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 12,
    }));

    let frameId: number;
    const duration = 1800;
    const start = performance.now();

    const draw = (now: number) => {
      const elapsed = now - start;
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach((p) => {
        p.x += p.speedX;
        p.y += p.speedY;
        p.rotation += p.rotationSpeed;
        ctx2d.save();
        ctx2d.translate(p.x, p.y);
        ctx2d.rotate((p.rotation * Math.PI) / 180);
        ctx2d.fillStyle = p.color;
        ctx2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx2d.restore();
      });
      if (elapsed < duration) {
        frameId = requestAnimationFrame(draw);
      } else {
        ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    frameId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameId);
  }, [triggerKey]);

  if (!triggerKey) return null;
  return <canvas ref={canvasRef} className="fixed inset-0 z-[9999] pointer-events-none" />;
}

// ---------- كارد الاحتفال بعد إنهاء تمارين اليوم بالكامل ----------

function WorkoutCompletionCard({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-xl flex items-center justify-center p-6"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="glass max-w-sm w-full rounded-3xl p-6 space-y-4 border border-white/30 shadow-2xl text-center"
          >
            <PartyPopper className="w-10 h-10 mx-auto text-primary" />
            <div>
              <h3 className="font-extrabold text-xl">أحسنتِ! 🎉</h3>
              <p className="text-sm text-muted-foreground mt-1">خلّصتِ تمارين اليوم بالكامل</p>
            </div>

            <div className="space-y-2.5 text-right">
              <div className="flex items-start gap-2">
                <Moon className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">
                  خذي قسط كافي من الراحة الليلة — عضلاتك بتنمو وقت الراحة مش وقت التمرين
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Dumbbell className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">
                  كمّلي احتياجك اليومي من البروتين عشان تدعمي عضلاتك وتسرّعي التعافي
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Droplets className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-xs leading-relaxed">اشربي مي كفاية لتعويض اللي فقدتيه أثناء التمرين</p>
              </div>
            </div>

            <p className="text-xs font-bold text-primary">
              كل يوم بتخلصي فيه تمرينك، بتقتربي خطوة أكتر من نسختك الأفضل ✨
            </p>

            <Button onClick={onClose} className="w-full rounded-2xl gradient-primary">تمام</Button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---------- بانر "اكتشفي مدربات" — نصيحة أنيقة توجّه المستخدمة لصفحة المدربات لاعتماد خطة تناسبها ----------

function DiscoverTrainersBanner() {
  return (
    <Link
      to="/trainers"
      className="flex items-center gap-3 p-3.5 rounded-2xl bg-muted/50 hover:bg-muted transition-colors border border-border/50"
    >
      <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center shrink-0">
        <Users className="w-4 h-4 text-primary-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold truncate">اكتشفي مدربات واعتمدي خطة تناسبك</p>
        <p className="text-[10px] text-muted-foreground truncate">خطط جاهزة صممتها مدربات محترفات</p>
      </div>

      <ArrowLeft className="w-4 h-4 text-muted-foreground shrink-0" />
    </Link>
  );
}

function WorkoutsPage() {
  const { user } = useAuth();
  const [active, setActive] = useState<any>(null);
  const [trainerPlan, setTrainerPlan] = useState<any>(null);
  const [personalPlans, setPersonalPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<any>(null);

  // سجلات اليوم الخام (workout_logs) — مصدر الحقيقة الوحيد لحالة الـ check لكل تمرين.
  // بيتصفّر تلقائياً كل يوم جديد (نفس فكرة meal_logs بصفحة التغذية)
  const [todayWorkoutLogs, setTodayWorkoutLogs] = useState<any[]>([]);
  const [completionCardOpen, setCompletionCardOpen] = useState(false);

  // ===== مؤقت الراحة — الحالة مركزية هنا عشان تضل شغالة حتى لو الديالوج مقفول أو التطبيق بالخلفية =====
  const [timerSec, setTimerSec] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerTargetTime, setTimerTargetTime] = useState<number | null>(null);
  const timerAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerFiredRef = useRef(false);

  // طلب إذن الإشعارات عند أول تحميل
  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  // مرجع دالة إطلاق المنبه (عشان نستخدمه جوّا useEffect بدون مشاكل الاعتماديات)
  const fireAlarmRef = useRef<() => void>(() => {});
  fireAlarmRef.current = () => {
    const audio = timerAudioRef.current;
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => playCompletionChime());
    } else {
      playCompletionChime();
    }
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("انتهى وقت الراحة ⏰", {
        body: "رجعي لتمارينك!",
        icon: "/favicon.ico",
      });
    }
    toast.success("انتهى وقت الراحة ⏰");
  };

  // عدّاد تنازلي يعمل لما التطبيق ظاهر
  useEffect(() => {
    if (!timerRunning || !timerTargetTime) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((timerTargetTime - Date.now()) / 1000));
      setTimerSec(remaining);
      if (remaining <= 0 && !timerFiredRef.current) {
        timerFiredRef.current = true;
        setTimerRunning(false);
        fireAlarmRef.current();
      }
    };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [timerRunning, timerTargetTime]);

  // لما المستخدم يرجع للتطبيق بعد ما كان بالخلفية، نتحقق إذا المنبه لازم ينطلق
  useEffect(() => {
    const handler = () => {
      if (!document.hidden && timerRunning && timerTargetTime && !timerFiredRef.current) {
        if (Date.now() >= timerTargetTime) {
          timerFiredRef.current = true;
          setTimerRunning(false);
          setTimerSec(0);
          fireAlarmRef.current();
        }
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [timerRunning, timerTargetTime]);

  const startTimer = (seconds: number) => {
    timerFiredRef.current = false;
    setTimerSec(seconds);
    setTimerTargetTime(Date.now() + seconds * 1000);
    setTimerRunning(true);
    // فك قفل الصوت جوّا معالج الضغطة (user gesture)
    const audio = timerAudioRef.current;
    if (audio) {
      audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
      }).catch(() => {});
    }
    getSharedAudioContext();
  };

  const stopTimer = () => {
    setTimerRunning(false);
    setTimerTargetTime(null);
    timerFiredRef.current = false;
  };
  // ===== نهاية المؤقت =====

  const loadAll = async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: sel }, { data: todayLogs }] = await Promise.all([
      supabase.from("active_plan_selection").select("*").eq("user_id", user.id).maybeSingle(),
      // نفس فكرة meal_logs: بنجيب بس سجلات اليوم، فلما يبلّش يوم جديد بترجع فاضية تلقائياً
      workoutLogsTable().select("*").eq("user_id", user.id).gte("completed_at", startOfTodayISO()),
    ]);
    setActive(sel);
    setTodayWorkoutLogs(todayLogs ?? []);
    setTrainerPlan(null);
    if (sel?.workout_plan_type === "trainer" && sel?.workout_plan_id) {
      const { data: w } = await supabase.from("workouts").select("*").eq("id", sel.workout_plan_id).maybeSingle();
      setTrainerPlan(w);
    }
    const { data: up } = await supabase.from("workouts").select("*").eq("owner_user_id", user.id).order("created_at", { ascending: false });
    setPersonalPlans(up ?? []);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [user]);

  // بتتنادى من ExerciseRow فور ما تنعمل صح على تمرين (بعد ما ينحفظ السجل فعلياً بقاعدة البيانات)
  const addTodayWorkoutLog = (logRow: any) => {
    if (!logRow) return;
    setTodayWorkoutLogs((prev) => [...prev, logRow]);
  };

  // بتتنادى من ExerciseRow فور ما ينشال صح عن تمرين (بعد ما ينحذف السجل فعلياً من قاعدة البيانات)
  const removeTodayWorkoutLog = (logId: string | null) => {
    if (!logId) return;
    setTodayWorkoutLogs((prev) => prev.filter((l: any) => l.id !== logId));
  };

  const activePersonal = personalPlans.find((p) => p.id === active?.workout_plan_id);
  const currentType = active?.workout_plan_type;
  const activePlan = currentType === "trainer" ? trainerPlan : currentType === "personal" ? activePersonal : null;
  const activeSourceType: "trainer" | "personal" | null = currentType === "trainer" ? "trainer" : currentType === "personal" ? "personal" : null;

  return (
    <div className="space-y-5">
      {/* عنصر الصوت مخفي دائمًا بالـ DOM حتى لو الديالوج مقفول */}
      <audio ref={timerAudioRef} src="/alarm.mp3" preload="auto" />

      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">تمارينك</h1>
        <Button size="sm" variant="outline" onClick={() => setTimerOpen(true)} className="rounded-xl shrink-0">
          <Timer className="w-4 h-4 ml-1" /> مؤقت
        </Button>
      </div>

      {loading && <Skeleton className="h-40 w-full rounded-3xl" />}

      {/* جدولك الأسبوعي */}
      {!loading && (
        <Card className="p-4 sm:p-5 rounded-3xl">
          <div className="font-bold text-sm flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4" /> جدولك الأسبوعي
          </div>

          {!activePlan ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              ما في خطة نشطة حالياً — اعتمدي خطة من "خططي الشخصية" بالأسفل
            </p>
          ) : (
            <ActiveScheduleView
              plan={activePlan}
              userId={user!.id}
              sourceType={activeSourceType!}
              sourceId={activePlan.id}
              todayLogs={todayWorkoutLogs}
              onAddLog={addTodayWorkoutLog}
              onRemoveLog={removeTodayWorkoutLog}
              onOpenTimer={() => setTimerOpen(true)}
              onAllTodayDone={() => setCompletionCardOpen(true)}
            />
          )}
        </Card>
      )}

      {/* نصيحة أنيقة بتوجّه المستخدمة لصفحة اكتشاف المدربات، بتظهر دايماً تحت الجدول الأسبوعي */}
      {!loading && <DiscoverTrainersBanner />}

      <div className="pt-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="font-bold">خططي الشخصية</h2>
          <Button size="sm" onClick={() => { setEditingPlan(null); setNewPlanOpen(true); }} className="rounded-xl gradient-primary shrink-0">
            <Plus className="w-4 h-4 ml-1" /> إنشاء
          </Button>
        </div>
        {personalPlans.length === 0 && (
          <Card className="p-6 text-center rounded-2xl border-dashed">
            <Dumbbell className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">لا توجد خطط شخصية بعد</p>
          </Card>
        )}
        {/* كل كارد بصير عمودي: صف فوق للمعلومات + زر التعديل، وصف تحت لأزرار التفعيل/الحذف full-width عشان يريح على الموبايل */}
        <div className="grid gap-2">
          {personalPlans.map((p) => {
            const daysCount = Array.isArray(p.exercises)
              ? isFixedWeekPlan(p)
                ? p.exercises.filter((d: any) => !d.is_rest).length
                : p.exercises.length
              : 0;
            const isActive = active?.workout_plan_id === p.id;
            return (
              <Card key={p.id} className="p-3 rounded-2xl">
                <div className="flex items-center gap-3">
                  {p.image_url ? (
                    <img src={p.image_url} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0"><Dumbbell className="w-4 h-4" /></div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{p.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {daysCount} يوم تمرين • {p.is_public ? "عام" : "خاص"}
                    </div>
                  </div>
                  {/* زر التعديل يضل صغير جنب الاسم */}
                  <button
                    onClick={() => { setEditingPlan(p); setNewPlanOpen(true); }}
                    className="p-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    title="تعديل الخطة"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>

                {/* صف الأزرار تحت — full-width عالموبايل بدل ما تكون متلزقة بصف واحد */}
                <div className="flex items-center gap-2 mt-3">
                  <Button
                    size="sm"
                    variant={isActive ? "default" : "outline"}
                    onClick={async () => {
                      await supabase.from("active_plan_selection").upsert({
                        user_id: user!.id,
                        workout_plan_type: "personal",
                        workout_plan_id: p.id,
                        nutrition_plan_type: active?.nutrition_plan_type,
                        nutrition_plan_id: active?.nutrition_plan_id,
                      });
                      toast.success("تم تفعيل الخطة، وجدولك الأسبوعي تحدّث تلقائياً");
                      loadAll();
                    }}
                    className="rounded-xl flex-1"
                  >
                    {isActive ? "نشطة" : "تفعيل"}
                  </Button>
                  <button
                    onClick={async () => {
                      if (!confirm("حذف الخطة؟")) return;
                      await supabase.from("workouts").delete().eq("id", p.id);
                      loadAll();
                    }}
                    className="p-2.5 rounded-xl border border-destructive/30 text-destructive shrink-0"
                    title="حذف الخطة"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* مؤقت عائم — يظهر لما الديالوج مقفول والمؤقت شغال */}
      <AnimatePresence>
        {timerRunning && !timerOpen && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="fixed bottom-4 left-4 right-4 z-50"
          >
            <Card className="p-3 rounded-2xl gradient-primary flex items-center justify-between shadow-lg shadow-primary/20">
              <div className="flex items-center gap-2">
                <Timer className="w-5 h-5 text-primary-foreground" />
                <span className="text-primary-foreground font-bold text-sm">مؤقت الراحة</span>
              </div>
              <div className="text-2xl font-extrabold text-primary-foreground tabular-nums">{timerSec}s</div>
              <Button size="sm" variant="secondary" onClick={stopTimer} className="rounded-xl font-bold">
                إيقاف
              </Button>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <SwitchDialog
        open={switchOpen}
        onClose={() => setSwitchOpen(false)}
        userId={user?.id ?? ""}
        activeId={active?.workout_plan_id}
        onSwitched={() => { setSwitchOpen(false); loadAll(); }}
        currentSelection={active}
      />
      <NewPlanDialog
        open={newPlanOpen}
        onClose={() => { setNewPlanOpen(false); setEditingPlan(null); }}
        userId={user?.id ?? ""}
        onSaved={() => { loadAll(); setEditingPlan(null); }}
        editPlan={editingPlan}
      />
      <RestTimerDialog
        open={timerOpen}
        onClose={() => setTimerOpen(false)}
        timerRunning={timerRunning}
        timerSec={timerSec}
        onStart={startTimer}
        onStop={stopTimer}
      />
      <WorkoutCompletionCard open={completionCardOpen} onClose={() => setCompletionCardOpen(false)} />
    </div>
  );
}

// ديالوج مشغّل الفيديو، مشترك بين كل الأماكن اللي بتعرض فيديو تمرين
function VideoPlayerDialog({ open, onClose, youtubeId, title }: { open: boolean; onClose: () => void; youtubeId: string | null; title: string }) {
  if (!youtubeId) return null;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-3xl max-w-lg p-0 overflow-hidden">
        <div className="w-full aspect-video bg-black">
          <iframe
            className="w-full h-full"
            src={`https://www.youtube.com/embed/${youtubeId}`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
        <div className="p-4">
          <div className="font-bold text-sm">{title}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// عنصر تمرين واحد: فيديو + اسم + شرح أداء + نصيحة + زر تسجيل/إلغاء الإنجاز
// بيتذكّر حالته من قاعدة البيانات (initialDone/initialLogId)، وبيقدر يتحط عليه صح ويتشال بحرية.
// لو التمرين تبع "اليوم" الحقيقي -> بيتحقق إذا هاد آخر تمرين ناقص فعلياً (بغض النظر عن ترتيبه بالقائمة)
// عن طريق مقارنة عدد التمارين المنجزة (todayDoneCount + 1) مع إجمالي عدد تمارين اليوم (todayItemsCount).
// لو هو فعلاً الأخير المتبقي -> بتظهر كارد الاحتفال. غير هيك -> بيفتح مؤقت الراحة.
function ExerciseRow({
  name, sets, reps, videoUrl, instruction, tips,
  userId, sourceType, sourceId, dayIndex, exerciseIndex, isToday, todayItemsCount, todayDoneCount,
  initialDone, initialLogId, onAddLog, onRemoveLog, onOpenTimer, onAllTodayDone,
}: any) {
  const [done, setDone] = useState(!!initialDone);
  const [logId, setLogId] = useState<string | null>(initialLogId ?? null);
  const [busy, setBusy] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [confettiKey, setConfettiKey] = useState(0);
  const youtubeId = getYouTubeId(videoUrl);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      if (!done) {
        // تسجيل التمرين — بنحتفظ بموقعه بالضبط (day_index + exercise_index) عشان يضل معروف
        // إنه هو بالذات لما نرجع نحمّل الصفحة، وعشان نقدر نميّز إذا هو تبع اليوم الحقيقي ولا لأ
        playCompletionChime();
        setConfettiKey(Date.now());
        const { data, error } = await workoutLogsTable()
          .insert({
            user_id: userId,
            source_type: sourceType,
            source_id: sourceId,
            exercise_name: name,
            day_index: dayIndex,
            exercise_index: exerciseIndex,
            sets, reps,
          })
          .select()
          .single();
        if (error) throw error;
        setDone(true);
        setLogId(data?.id ?? null);
        onAddLog?.(data);
        toast.success("تم تسجيل التمرين 🎉");

        if (!isToday) {
          toast("هاي تمارين ليوم تاني", {
            description: "تم تسجيلها، بس هاد الجدول مش خاص بيومك الحالي",
          });
        } else {
          // نحسب: هل هاد التمرين هو آخر واحد ناقص فعلياً من أصل تمارين اليوم، بغض النظر عن ترتيبه بالقائمة؟
          const newDoneCount = (todayDoneCount ?? 0) + 1;
          if (newDoneCount >= (todayItemsCount ?? 0)) {
            onAllTodayDone?.();
          } else {
            onOpenTimer?.();
          }
        }
      } else {
        // إلغاء الصح — بنحذف السجل بالضبط بالاعتماد على id تبعه
        if (logId) {
          const { error } = await workoutLogsTable().delete().eq("id", logId);
          if (error) throw error;
          onRemoveLog?.(logId);
        }
        setDone(false);
        setLogId(null);
        toast.success("تم إلغاء تسجيل التمرين");
      }
    } catch (err: any) {
      toast.error(err.message ?? "صار في خطأ، حاولي مرة ثانية");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="p-2.5 rounded-xl hover:bg-muted/50 relative">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            disabled={busy}
            onClick={handleToggle}
            className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition ${done ? "gradient-primary border-primary" : "border-border"} ${busy ? "opacity-60" : ""}`}
          >
            {done && <CheckCircle2 className="w-4 h-4 text-primary-foreground" />}
          </button>

          {youtubeId && (
            <button
              type="button"
              onClick={() => setVideoOpen(true)}
              className="relative w-14 h-9 rounded-lg overflow-hidden shrink-0 border border-border"
            >
              <img src={`https://img.youtube.com/vi/${youtubeId}/mqdefault.jpg`} className="w-full h-full object-cover" />
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <Play className="w-3.5 h-3.5 text-white fill-white" />
              </div>
            </button>
          )}

          <span className={`text-sm font-semibold truncate ${done ? "line-through text-muted-foreground" : ""}`}>{name}</span>
        </div>
        <span className="text-xs font-semibold text-muted-foreground shrink-0">{sets} × {reps}</span>
      </div>

      {(instruction || tips) && (
        <div className="mt-1.5 pr-8 space-y-1">
          {instruction && <p className="text-[11px] text-muted-foreground leading-relaxed">{instruction}</p>}
          {tips && <p className="text-[11px] text-primary leading-relaxed">💡 {tips}</p>}
        </div>
      )}

      <VideoPlayerDialog open={videoOpen} onClose={() => setVideoOpen(false)} youtubeId={youtubeId} title={name} />
      <ConfettiBurst triggerKey={confettiKey} />
    </li>
  );
}

// عرض الجدول الأسبوعي بالاعتماد الكامل على الخطة النشطة حالياً (شخصية أو مدربة)
function ActiveScheduleView({
  plan, userId, sourceType, sourceId, todayLogs, onAddLog, onRemoveLog, onOpenTimer, onAllTodayDone,
}: {
  plan: any; userId: string; sourceType: "trainer" | "personal"; sourceId: string;
  todayLogs: any[]; onAddLog: (row: any) => void; onRemoveLog: (id: string | null) => void;
  onOpenTimer: () => void; onAllTodayDone: () => void;
}) {
  const fixedWeek = isFixedWeekPlan(plan);
  const rawDays: any[] = Array.isArray(plan.exercises) ? plan.exercises : [];
  const days = fixedWeek ? [...rawDays].sort((a, b) => a.day_of_week - b.day_of_week) : rawDays;
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  // اليوم الحقيقي الفعلي (0 = الأحد ... 6 = السبت). بما إنه خطة "الأسبوع الثابت" دايماً فيها 7 عناصر
  // مرتبة حسب day_of_week من 0 لـ6، فموقع اليوم بالمصفوفة المرتبة بيطابق day_of_week نفسه تماماً
  const todayIdx = new Date().getDay();

  // بنحسب، لكل تمرين (بموقعه بالضبط day_index+exercise_index)، آخر سجل اليوم إله (لو موجود)
  // لنفس المصدر (trainer/personal + id) — هيك كل تمرين بتمييزه بدقة بغض النظر عن اسمه
  const logsByKey = new Map<string, any>();
  (todayLogs ?? [])
    .filter(
      (l: any) =>
        l.source_type === sourceType &&
        l.source_id === sourceId &&
        l.day_index !== null &&
        l.day_index !== undefined &&
        l.exercise_index !== null &&
        l.exercise_index !== undefined
    )
    .forEach((l: any) => {
      const key = `${l.day_index}-${l.exercise_index}`;
      const existing = logsByKey.get(key);
      if (!existing || new Date(l.completed_at) > new Date(existing.completed_at)) {
        logsByKey.set(key, l);
      }
    });

  return (
    <div className="space-y-4">
      <div className="rounded-2xl overflow-hidden">
        {plan.image_url && <img src={plan.image_url} className="w-full h-32 object-cover" />}
        <div className="p-3 gradient-blush rounded-b-2xl">
          <div className="font-extrabold">{plan.name}</div>
          {plan.description && <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>}
        </div>
      </div>


      <div className="space-y-2">
        {days.map((d: any, i: number) => {
          const isRest = !!d.is_rest;
          const items = Array.isArray(d.items) ? d.items : [];
          const isOpen = openIdx === i;
          // اسم اليوم الظاهر: "الأحد - قلوتس" لو محدد اسم عضلة، وإلا اسم اليوم لحاله
          const dayName = fixedWeek ? DAYS[d.day_of_week] : (d.name ?? `اليوم ${i + 1}`);
          const label = !isRest && d.muscle_group ? `${dayName} - ${d.muscle_group}` : dayName;

          // موقع اليوم الحقيقي: بس للخطط ذات الأسبوع الثابت، فيها معنى فعلي (day_of_week حقيقي)
          const dayIndex = fixedWeek ? Number(d.day_of_week) : i;
          const isToday = fixedWeek && dayIndex === todayIdx;

          // كم تمرين إجمالي عند هاد اليوم، وكم منه متأشر إنه خلص فعلياً (بغض النظر عن ترتيب الإنجاز)
          const todayItemsCount = isToday ? items.length : 0;
          const todayDoneCount = isToday
            ? items.reduce(
                (count: number, _: any, idx: number) =>
                  count + (logsByKey.has(`${dayIndex}-${idx}`) ? 1 : 0),
                0,
              )
            : 0;

          return (
            <div key={i} className={`rounded-2xl overflow-hidden bg-muted/50 ${isToday ? "ring-2 ring-primary/40" : ""}`}>
              <button
                type="button"
                disabled={isRest && items.length === 0}
                onClick={() => setOpenIdx((prev) => (prev === i ? null : i))}
                className="w-full flex items-center gap-2 p-3 text-right"
              >
                {isRest ? (
                  <Moon className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <Dumbbell className="w-4 h-4 text-primary shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate flex items-center gap-1.5">
                    <span className="truncate">{label}</span>
                    {isToday && (
                      <span className="text-[9px] font-bold bg-primary/15 text-primary px-1.5 py-0.5 rounded-full shrink-0">
                        اليوم
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {isRest ? "يوم راحة" : `${items.length} تمارين`}
                  </div>
                </div>
                {!isRest && items.length > 0 && (isOpen ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                ))}
              </button>

              <AnimatePresence initial={false}>
                {isOpen && !isRest && items.length > 0 && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <ul className="px-2 pb-2 space-y-1 border-t border-border/50 pt-2">
                      {items.map((ex: any, ei: number) => {
                        const key = `${dayIndex}-${ei}`;
                        const existingLog = logsByKey.get(key);
                        return (
                          <ExerciseRow
                            key={ei}
                            name={ex?.name ?? `تمرين ${ei + 1}`}
                            sets={ex?.sets}
                            reps={ex?.reps}
                            videoUrl={ex?.video_url}
                            instruction={ex?.instruction}
                            tips={ex?.tips}
                            userId={userId}
                            sourceType={sourceType}
                            sourceId={sourceId}
                            dayIndex={dayIndex}
                            exerciseIndex={ei}
                            isToday={isToday}
                            todayItemsCount={todayItemsCount}
                            todayDoneCount={todayDoneCount}
                            initialDone={!!existingLog}
                            initialLogId={existingLog?.id ?? null}
                            onAddLog={onAddLog}
                            onRemoveLog={onRemoveLog}
                            onOpenTimer={onOpenTimer}
                            onAllTodayDone={onAllTodayDone}
                          />
                        );
                      })}
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SwitchDialog({ open, onClose, userId, activeId, onSwitched, currentSelection }: any) {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase
      .from("workouts")
      .select("*, profiles!workouts_trainer_id_fkey(full_name)")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .then(({ data }) => { setPlans(data ?? []); setLoading(false); });
  }, [open]);

  const adopt = async (id: string) => {
    await supabase.from("active_plan_selection").upsert({
      user_id: userId,
      workout_plan_type: "trainer",
      workout_plan_id: id,
      nutrition_plan_type: currentSelection?.nutrition_plan_type,
      nutrition_plan_id: currentSelection?.nutrition_plan_id,
    });
    toast.success("تم اعتماد الخطة، وجدولك الأسبوعي تحدّث تلقائياً");
    onSwitched();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="rounded-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>خطط المدربات</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">اختاري خطة من المدربات لاعتمادها كبرنامجك الحالي، ورح تظهر جاهزة مقسّمة بالأيام بجدولك الأسبوعي.</p>
        {loading && <Skeleton className="h-24 rounded-2xl" />}
        {!loading && plans.length === 0 && (
          <Card className="p-6 text-center rounded-2xl border-dashed">
            <Dumbbell className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">لا توجد خطط منشورة بعد</p>
          </Card>
        )}
        <div className="grid gap-2">
          {plans.map((p) => (
            <Card key={p.id} className="p-3 rounded-2xl">
              <div className="flex items-center gap-2">
                {p.image_url ? (
                  <img src={p.image_url} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center shrink-0"><Dumbbell className="w-4 h-4" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm truncate">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {p.profiles?.full_name && `${p.profiles.full_name} • `}
                    {(Array.isArray(p.exercises) ? p.exercises : []).length} يوم
                  </div>
                </div>
              </div>
              <Button size="sm" variant={activeId === p.id ? "default" : "outline"} onClick={() => adopt(p.id)} className="rounded-xl w-full mt-3">
                {activeId === p.id ? "نشطة" : "اعتماد"}
              </Button>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type NewPlanExercise = { name: string; sets: number; reps: number; video_url: string; instruction: string; tips: string };
// muscle_group: اسم العضلة/التمرين الخاص باليوم، يظهر بشكل "الأحد - قلوتس" لما اليوم مش يوم راحة
type NewPlanDay = { day_of_week: number; is_rest: boolean; muscle_group: string; items: NewPlanExercise[] };

function emptyExercise(): NewPlanExercise {
  return { name: "", sets: 3, reps: 12, video_url: "", instruction: "", tips: "" };
}

function defaultDays(): NewPlanDay[] {
  return DAYS.map((_, i) => ({ day_of_week: i, is_rest: true, muscle_group: "", items: [] }));
}

function NewPlanDialog({ open, onClose, userId, onSaved, editPlan }: any) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [days, setDays] = useState<NewPlanDay[]>(defaultDays());
  const [saving, setSaving] = useState(false);

  // حالة السحب: بنحفظ مين التمرين يلي عم ينسحب حالياً (يوم + موقع)
  // بنسمح بالإفلات بس جوا نفس اليوم (dayIdx لازم يطابق)، منعاً لأي تداخل بين الأيام.
  // مبنية على Pointer Events (مش HTML5 Drag and Drop) عشان تشتغل على الموبايل واللابتوب بنفس الوقت —
  // HTML5 draggable/onDragStart ما بيشتغل على شاشات اللمس، فهاد كان سبب المشكلة الأصلية.
  const [dragInfo, setDragInfo] = useState<{ dayIdx: number; exIdx: number } | null>(null);
  const [dragOverExIdx, setDragOverExIdx] = useState<number | null>(null);

  // مرجع لعناصر الـ DOM تبع كل تمرين، مفتاحها "dayIdx-exIdx"، عشان نقدر نحسب موقع الإصبع/الماوس
  // بالنسبة لمكان كل تمرين أثناء السحب بدون ما نعتمد على أحداث DnD الأصلية
  const itemRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());

  const registerItemRef = (dayIdx: number, exIdx: number) => (el: HTMLDivElement | null) => {
    const key = `${dayIdx}-${exIdx}`;
    if (el) itemRefsMap.current.set(key, el);
    else itemRefsMap.current.delete(key);
  };

  // ref يضمن إننا نوصل لقيمة editPlan دايماً بدون مشاكل batching
  const editRef = useRef<any>(null);
  editRef.current = editPlan;

  useEffect(() => {
    if (!open) return;

    const ep = editRef.current;
    if (ep) {
      setName(ep.name || "");
      setDescription(ep.description || "");
      setIsPublic(!!ep.is_public);
      setImageFile(null);
      setExistingImageUrl(ep.image_url || null);

      const raw: any[] = Array.isArray(ep.exercises) ? [...ep.exercises] : [];

      // 1) أسبوع ثابت (7 أيام فيها day_of_week) — نستخدم != null بدل typeof number عشان نتجنب مشكلة الـ strings من Supabase
      if (raw.length === 7 && raw.every((d) => d.day_of_week != null)) {
        const sorted = raw.sort((a, b) => Number(a.day_of_week) - Number(b.day_of_week));
        setDays(
          sorted.map((d) => ({
            day_of_week: Number(d.day_of_week),
            is_rest: !!d.is_rest,
            muscle_group: d.muscle_group ?? "",
            items: Array.isArray(d.items)
              ? d.items.map((ex: any) => ({
                  name: ex.name ?? "",
                  sets: Number(ex.sets) || 3,
                  reps: Number(ex.reps) || 12,
                  video_url: ex.video_url ?? "",
                  instruction: ex.instruction ?? "",
                  tips: ex.tips ?? "",
                }))
              : [],
          }))
        );
      }
      // 2) بنية أخرى (قديمة أو مختلفة)
      else if (raw.length > 0) {
        setDays(
          raw.map((d, i) => ({
            day_of_week: d.day_of_week != null ? Number(d.day_of_week) : i,
            is_rest: !!d.is_rest,
            muscle_group: d.muscle_group ?? "",
            items: Array.isArray(d.items)
              ? d.items.map((ex: any) => ({
                  name: ex.name ?? "",
                  sets: Number(ex.sets) || 3,
                  reps: Number(ex.reps) || 12,
                  video_url: ex.video_url ?? "",
                  instruction: ex.instruction ?? "",
                  tips: ex.tips ?? "",
                }))
              : [],
          }))
        );
      }
      // 3) ما في بيانات تمارين
      else {
        setDays(defaultDays());
      }
    } else {
      setName("");
      setDescription("");
      setIsPublic(false);
      setImageFile(null);
      setExistingImageUrl(null);
      setDays(defaultDays());
    }
  }, [open]);

  const updateDay = (idx: number, patch: Partial<NewPlanDay>) => {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const updateExercise = (dayIdx: number, exIdx: number, patch: Partial<NewPlanExercise>) => {
    setDays((prev) =>
      prev.map((d, i) => {
        if (i !== dayIdx) return d;
        const items = d.items.map((ex, j) => (j === exIdx ? { ...ex, ...patch } : ex));
        return { ...d, items };
      })
    );
  };

  // بتبدّل موقع تمرينين جوا نفس اليوم بس (dayIdx ثابت)
  const reorderExercise = (dayIdx: number, fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    setDays((prev) =>
      prev.map((d, i) => {
        if (i !== dayIdx) return d;
        const items = [...d.items];
        const [moved] = items.splice(fromIdx, 1);
        items.splice(toIdx, 0, moved);
        return { ...d, items };
      })
    );
  };

  // بتحسب، أثناء السحب، مين التمرين المستهدف بالاعتماد على موقع الإصبع/الماوس الحالي (clientY)
  // مقارنةً بمنتصف كل تمرين تاني بنفس اليوم — هاد بيشتغل بنفس الطريقة سواء كان المصدر لمسة أو ماوس
  const computeTargetIdx = (dayIdx: number, clientY: number, fallback: number) => {
    const entries = Array.from(itemRefsMap.current.entries())
      .filter(([key]) => key.startsWith(`${dayIdx}-`))
      .map(([key, el]) => ({ idx: Number(key.split("-")[1]), el }))
      .sort((a, b) => a.idx - b.idx);

    let targetIdx = fallback;
    for (const { idx, el } of entries) {
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (clientY < mid) {
        targetIdx = idx;
        break;
      }
      targetIdx = idx;
    }
    return targetIdx;
  };

  const handleSave = async () => {
    if (!name.trim()) return toast.error("اكتبي اسم الخطة");

    const cleanedDays = days.map((d) => {
      const items = d.items
        .filter((ex) => ex.name?.trim())
        .map((ex) => ({
          name: ex.name.trim(),
          sets: ex.sets,
          reps: ex.reps,
          video_url: ex.video_url?.trim() || null,
          instruction: ex.instruction?.trim() || null,
          tips: ex.tips?.trim() || null,
        }));
      const isRest = d.is_rest || items.length === 0;
      const muscleGroup = !isRest ? d.muscle_group?.trim() || null : null;
      // اسم اليوم المركّب يلي بيتخزن وبيظهر بكل مكان: "الأحد - قلوتس"
      const dayLabel = muscleGroup ? `${DAYS[d.day_of_week]} - ${muscleGroup}` : DAYS[d.day_of_week];
      return {
        day_of_week: d.day_of_week,
        name: dayLabel,
        muscle_group: muscleGroup,
        is_rest: isRest,
        items: isRest ? [] : items,
      };
    });

    const hasAnyTraining = cleanedDays.some((d) => !d.is_rest);
    if (!hasAnyTraining) return toast.error("أضيفي تمريناً واحداً على الأقل بيوم واحد على الأقل");

    setSaving(true);
    try {
      let image_url = existingImageUrl;
      if (imageFile) {
        image_url = await uploadFile(imageFile, userId, "workouts");
      }

      if (editRef.current) {
        const result = await supabase
          .from("workouts")
          .update({
            name,
            description: description || null,
            goal: "fitness",
            activity_level: "moderate",
            equipment: "home",
            min_frequency: cleanedDays.filter((d) => !d.is_rest).length,
            exercises: cleanedDays,
            is_public: isPublic,
            image_url,
          })
          .eq("id", editRef.current.id);
        if (result.error) throw result.error;
        toast.success("تم تحديث الخطة ✏️");
      } else {
        const result = await supabase
          .from("workouts")
          .insert({
            owner_user_id: userId,
            name,
            description: description || null,
            goal: "fitness",
            activity_level: "moderate",
            equipment: "home",
            min_frequency: cleanedDays.filter((d) => !d.is_rest).length,
            exercises: cleanedDays,
            is_public: isPublic,
            image_url,
          });
        if (result.error) throw result.error;
        toast.success("تم حفظ الخطة");
      }

      setName("");
      setDescription("");
      setIsPublic(false);
      setImageFile(null);
      setExistingImageUrl(null);
      setDays(defaultDays());
      onClose();
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="rounded-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editRef.current ? "تعديل الخطة" : "خطة تمرين شخصية"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {editRef.current && existingImageUrl && !imageFile && (
            <div className="relative rounded-xl overflow-hidden">
              <img src={existingImageUrl} className="w-full h-32 object-cover" />
              <div className="absolute bottom-2 left-2 bg-black/60 text-white text-[10px] px-2 py-0.5 rounded-lg">
                الصورة الحالية — اختاري صورة جديدة إذا بدك تغيّريها
              </div>
            </div>
          )}

          <div>
            <Label>اسم الخطة</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl mt-1" />
          </div>
          <div>
            <Label>وصف مختصر (اختياري)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-xl mt-1" />
          </div>
          <div>
            <Label className="text-xs flex items-center gap-2"><ImagePlus className="w-4 h-4" /> صورة الخطة (اختياري)</Label>
            <Input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} className="rounded-xl mt-1" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="w-4 h-4" />
            جعل الخطة عامة (يستطيع الآخرون رؤيتها في ملفك)
          </label>

          <div className="space-y-3">
            <Label>أيام الأسبوع</Label>
            {days.map((d, di) => (
              <Card key={di} className="p-3 rounded-2xl">
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <div className="font-bold text-sm">
                    {DAYS[d.day_of_week]}
                    {!d.is_rest && d.muscle_group?.trim() && (
                      <span className="text-primary"> - {d.muscle_group.trim()}</span>
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-xs font-semibold shrink-0">
                    <input
                      type="checkbox"
                      checked={d.is_rest}
                      onChange={(e) => updateDay(di, { is_rest: e.target.checked, items: e.target.checked ? [] : d.items })}
                      className="w-4 h-4"
                    />
                    يوم راحة
                  </label>
                </div>

                {!d.is_rest && (
                  <div className="space-y-2">
                    {/* اسم العضلة/التمرين الخاص باليوم — هاد يلي بيبني "الأحد - قلوتس" */}
                    <Input
                      value={d.muscle_group}
                      onChange={(e) => updateDay(di, { muscle_group: e.target.value })}
                      placeholder="اسم العضلة أو التمرين لهاليوم (مثلاً: قلوتس، أرجل، صدر، ظهر)"
                      className="rounded-xl h-9"
                    />

                    {d.items.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">ما في تمارين بعد لهاد اليوم</p>
                    )}
                    {d.items.length > 1 && (
                      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <GripVertical className="w-3 h-3" /> اسحبي التمارين من المقبض لتغيير ترتيبها
                      </p>
                    )}
                    {d.items.map((ex, ei) => {
                      const isDragging = dragInfo?.dayIdx === di && dragInfo?.exIdx === ei;
                      const isDragOverTarget =
                        dragInfo?.dayIdx === di && dragInfo?.exIdx !== ei && dragOverExIdx === ei;
                      return (
                        <div
                          key={ei}
                          ref={registerItemRef(di, ei)}
                          className={`rounded-xl border p-2 space-y-2 bg-background transition-colors ${
                            isDragging ? "opacity-40" : ""
                          } ${isDragOverTarget ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
                        >
                          {/* اسم التمرين بسطر لحاله مع مقبض السحب وزر الحذف */}
                          <div className="flex items-start gap-2">
                            {/* مقبض السحب: مبني على Pointer Events (touch + mouse معاً) بدل HTML5 Drag and Drop
                                عشان يشتغل صح على الموبايل. touchAction: "none" يمنع تعارض السحب مع سكرول الصفحة */}
                            <span
                              className="p-2 -m-2 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing"
                              style={{ touchAction: "none" }}
                              title="اسحبي لتغيير الترتيب"
                              onPointerDown={(e) => {
                                e.preventDefault();
                                e.currentTarget.setPointerCapture(e.pointerId);
                                setDragInfo({ dayIdx: di, exIdx: ei });
                                setDragOverExIdx(ei);
                              }}
                              onPointerMove={(e) => {
                                if (!dragInfo || dragInfo.dayIdx !== di) return;
                                const target = computeTargetIdx(di, e.clientY, dragOverExIdx ?? ei);
                                setDragOverExIdx(target);
                              }}
                              onPointerUp={() => {
                                if (dragInfo && dragOverExIdx !== null && dragOverExIdx !== dragInfo.exIdx) {
                                  reorderExercise(dragInfo.dayIdx, dragInfo.exIdx, dragOverExIdx);
                                }
                                setDragInfo(null);
                                setDragOverExIdx(null);
                              }}
                              onPointerCancel={() => {
                                setDragInfo(null);
                                setDragOverExIdx(null);
                              }}
                            >
                              <GripVertical className="w-4 h-4" />
                            </span>
                            <Input
                              value={ex.name}
                              onChange={(e) => updateExercise(di, ei, { name: e.target.value })}
                              placeholder="اسم التمرين"
                              className="rounded-xl h-9 flex-1"
                            />
                            <button
                              onClick={() => updateDay(di, { items: d.items.filter((_, j) => j !== ei) })}
                              className="p-2 shrink-0 text-muted-foreground hover:text-destructive"
                              title="حذف التمرين"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          {/* المجموعات والتكرارات بصف مستقل مع Label واضح، مريح أكتر عالموبايل */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-[10px] text-muted-foreground">مجموعات</Label>
                              <Input
                                type="number"
                                value={ex.sets}
                                onChange={(e) => updateExercise(di, ei, { sets: +e.target.value })}
                                className="rounded-xl h-9 text-center mt-1"
                              />
                            </div>
                            <div>
                              <Label className="text-[10px] text-muted-foreground">تكرارات</Label>
                              <Input
                                type="number"
                                value={ex.reps}
                                onChange={(e) => updateExercise(di, ei, { reps: +e.target.value })}
                                className="rounded-xl h-9 text-center mt-1"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Youtube className="w-4 h-4 text-muted-foreground shrink-0" />
                            <Input
                              value={ex.video_url}
                              onChange={(e) => updateExercise(di, ei, { video_url: e.target.value })}
                              placeholder="رابط فيديو يوتيوب (اختياري)"
                              className="rounded-xl h-8 text-xs"
                            />
                          </div>
                          <Input
                            value={ex.instruction}
                            onChange={(e) => updateExercise(di, ei, { instruction: e.target.value })}
                            placeholder="شرح طريقة الأداء (اختياري)"
                            className="rounded-xl h-8 text-xs"
                          />
                          <Input
                            value={ex.tips}
                            onChange={(e) => updateExercise(di, ei, { tips: e.target.value })}
                            placeholder="نصيحة سريعة (اختياري)"
                            className="rounded-xl h-8 text-xs"
                          />
                        </div>
                      );
                    })}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateDay(di, { items: [...d.items, emptyExercise()] })}
                      className="rounded-xl w-full"
                    >
                      <Plus className="w-4 h-4 ml-1" /> إضافة تمرين
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>

          <Button
            disabled={saving}
            onClick={handleSave}
            className="w-full rounded-2xl gradient-primary"
          >
            {saving ? "جاري الحفظ..." : editRef.current ? "تحديث الخطة" : "حفظ الخطة"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// مؤقت الراحة — يأخذ كل الحالة من الأب عشان يضل شغال حتى لو الديالوج مقفول
function RestTimerDialog({ open, onClose, timerRunning, timerSec, onStart, onStop }: any) {
  const [selectedSec, setSelectedSec] = useState(60);

  // نزامن القيمة المحلية مع العدّاد الحي لما المؤقت شغال
  useEffect(() => {
    if (timerRunning && timerSec > 0) {
      setSelectedSec(timerSec);
    }
  }, [timerRunning, timerSec]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="rounded-3xl text-center">
        <DialogHeader><DialogTitle>مؤقت الراحة</DialogTitle></DialogHeader>

        <div className="text-6xl font-extrabold gradient-primary bg-clip-text text-transparent tabular-nums">
          {timerRunning ? timerSec : selectedSec}
        </div>

        {!timerRunning && (
          <div className="flex gap-2 justify-center flex-wrap">
            {[30, 60, 90, 120].map((v) => (
              <Button
                key={v}
                variant={selectedSec === v ? "default" : "outline"}
                onClick={() => setSelectedSec(v)}
                className="rounded-xl"
              >
                {v}s
              </Button>
            ))}
          </div>
        )}

        <Button
          onClick={() => {
            if (timerRunning) {
              onStop();
            } else {
              onStart(selectedSec);
            }
          }}
          className="rounded-2xl gradient-primary"
        >
          {timerRunning ? "إيقاف" : "ابدئي"}
        </Button>

        {timerRunning && (
          <p className="text-[11px] text-muted-foreground">
            تقدري تقفلي هالنافذة والمؤقت رح يكمل بالخلفية وينبّهك لما يخلص ⏰
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}